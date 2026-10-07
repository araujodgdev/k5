import 'server-only';
import { capabilities, type Capability, type CapabilityName } from '@/lib/capabilities/contracts';
import { database, withTransaction, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { artifactPolicy, assertSourceGuards, exposedPolicies, legacyGuards, observeVaultFile, observePage, uncertainPolicy } from '@/lib/content-policy';
import { dependenciesSchema, type SourceDependency } from './contracts';

export type Provenance = { complete: boolean; dependencies: SourceDependency[] };
export function mergeDependencies(...sets: SourceDependency[][]): SourceDependency[] {
  return [...new Map(sets.flat().map(source => [JSON.stringify(source), source])).values()];
}
export async function sourceAccess(userId: string, sources: SourceDependency[], db: Transaction = database) {
  await assertSourceGuards(userId, await legacyGuards(sources, db), db);
}
export function unavailable() { return new CapabilityError('NOT_FOUND', 'Página ou fonte não encontrada ou acesso removido.'); }

export async function documentDependencies(ids: string[], db: Transaction = database): Promise<SourceDependency[]> {
  const dependencies: SourceDependency[] = [];
  for (const id of ids) {
    const row = await db.prepare('SELECT case_id,folder_id FROM vault_document WHERE id=? AND deleted_at IS NULL')
      .get<{ case_id: string | null; folder_id: string | null }>(id);
    if (!row) throw unavailable();
    dependencies.push({ kind: 'document', id });
    if (row.case_id) dependencies.push({ kind: 'case', id: row.case_id });
    if (row.folder_id && row.case_id) dependencies.push({ kind: 'folder', id: row.folder_id, caseId: row.case_id });
  }
  return dependencies;
}

export async function readProvenance(context: WorkspaceContext, kind: 'conversation' | 'artifact', id: string, db: Transaction = database): Promise<Provenance | undefined> {
  const row = await db.prepare('SELECT complete,dependencies FROM ai_source_provenance WHERE office_id=? AND user_id=? AND resource_kind=? AND resource_id=?')
    .get<{ complete: boolean; dependencies: unknown }>(context.caseScope?.homeOfficeId ?? context.officeId, context.userId, kind, id);
  return row ? { complete: row.complete, dependencies: dependenciesSchema.parse(row.dependencies) } : undefined;
}

export async function recordProvenance(context: WorkspaceContext, kind: 'conversation' | 'artifact', id: string, value: Provenance) {
  const officeId = context.caseScope?.homeOfficeId ?? context.officeId;
  await withTransaction(async tx => {
    await tx.prepare(`INSERT INTO ai_source_provenance(office_id,user_id,resource_kind,resource_id,complete,dependencies)
      VALUES(?,?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING`).run(officeId, context.userId, kind, id, value.complete, JSON.stringify(value.dependencies));
    const row = await tx.prepare('SELECT complete,dependencies FROM ai_source_provenance WHERE office_id=? AND user_id=? AND resource_kind=? AND resource_id=? FOR UPDATE')
      .get<{ complete: boolean; dependencies: unknown }>(officeId, context.userId, kind, id);
    await tx.prepare('UPDATE ai_source_provenance SET complete=?,dependencies=?::jsonb WHERE office_id=? AND user_id=? AND resource_kind=? AND resource_id=?')
      .run(row!.complete && value.complete, JSON.stringify(mergeDependencies(dependenciesSchema.parse(row!.dependencies), value.dependencies)), officeId, context.userId, kind, id);
  });
}

export async function artifactProvenance(context: WorkspaceContext, artifactId: string, db: Transaction = database): Promise<Provenance> {
  const policy = await artifactPolicy(context, artifactId, db);
  return { complete: policy.eligible, dependencies: policy.guards };
}

export async function recordToolProvenance(context: WorkspaceContext, name: string, input: Record<string, unknown>, result: unknown) {
  if (!context.invocation || !context.conversationId) return;
  const exposure = (capabilities[name as CapabilityName] as Capability | undefined)?.exposure;
  const dependencies: SourceDependency[] = [];
  let complete = true;
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const returned = exposedPolicies(result);
  if (returned) {
    dependencies.push(...returned.flatMap(policy => policy.guards));
    complete = returned.every(policy => policy.eligible);
    context.contentSources?.push(...returned);
  } else if (exposure === 'page') {
    const page = value.page as { id: string; caseId: string } | undefined;
    if (page) dependencies.push({ kind: 'page', id: page.id, caseId: page.caseId });
    if (typeof input.pageId === 'string' && typeof input.caseId === 'string') dependencies.push({ kind: 'page', id: input.pageId, caseId: input.caseId });
    if (Array.isArray(value.pages)) for (const page of value.pages as { id: string; caseId: string }[]) dependencies.push({ kind: 'page', id: page.id, caseId: page.caseId });
    if (typeof input.caseId === 'string') dependencies.push({ kind: 'case', id: input.caseId });
    if (typeof input.folderId === 'string' && typeof input.caseId === 'string') dependencies.push({ kind: 'folder', id: input.folderId, caseId: input.caseId });
  } else if (exposure === 'artifact' && typeof input.artifactId === 'string') {
    const provenance = await artifactProvenance(context, input.artifactId);
    dependencies.push(...provenance.dependencies); complete = provenance.complete;
  } else if (exposure === 'document') {
    const sources = Array.isArray(value.sources) ? value.sources as { documentId?: string }[] : value.source ? [value.source as { documentId?: string }] : [];
    const documents = Array.isArray(value.documents) ? value.documents as { id: string }[] : [];
    const ids = [...sources.flatMap(s => s.documentId ? [s.documentId] : []), ...documents.map(d => d.id), ...(typeof input.documentId === 'string' ? [input.documentId] : [])];
    dependencies.push(...await documentDependencies([...new Set(ids)]));
    if (typeof input.caseId === 'string') dependencies.push({ kind: 'case', id: input.caseId });
    if (sources.some(source => !source.documentId) || !ids.length && name === 'k5_knowledge_get_source') complete = false;
  } else if (exposure !== 'none') {
    complete = false;
  }
  if (context.contentSources && !returned) {
    for (const dependency of dependencies) {
      if (dependency.kind === 'page') {
        const pages = [...(value.page ? [value.page] : []), ...(Array.isArray(value.pages) ? value.pages : [])] as { id: string; version: number }[];
        const version = pages.find(page => page.id === dependency.id)?.version;
        context.contentSources.push((await observePage(context.userId, dependency.id, dependency.caseId, database, version)).policy);
      }
      else if (dependency.kind === 'document') context.contentSources.push((await observeVaultFile(context.userId, dependency.id)).policy);
    }
    if (exposure === 'artifact' && typeof input.artifactId === 'string') context.contentSources.push(await artifactPolicy(context, input.artifactId, database, (value.artifact as { version?: number } | undefined)?.version));
    if (!complete) context.contentSources.push(uncertainPolicy(context.userId));
  }
  await recordProvenance(context, 'conversation', context.conversationId, { complete, dependencies });
}
