import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from './database';
import { aclReadTransaction } from './acl-transaction';
import { CapabilityError } from './capabilities/errors';
import { dependenciesSchema, sourceDependency, type SourceDependency } from './case-pages/contracts';
import { materialSnapshot } from './research/case-material';
import type { WorkspaceContext } from './application/context';

const MAX_GUARDS = 2048;
const pin = z.object({ kind: z.enum(['page', 'artifact', 'document', 'instruction', 'knowledge-note', 'attachment', 'research']), id: z.string(), version: z.string(), digest: z.string() });
const policySchema = z.object({
  format: z.literal(1), digest: z.string(), origin: z.enum(['person', 'generated', 'legacy-human', 'uncertain']),
  eligible: z.boolean(), owners: z.array(z.string()), guards: z.array(sourceDependency).max(MAX_GUARDS), observed: z.array(pin).max(MAX_GUARDS),
  receipt: z.string(),
});
export type ContentPolicy = z.infer<typeof policySchema>;
export type SubmittedImage = { attachmentId: string; digest: string; mediaType: string; imageIndex?: number; containerDigest?: string };
export type ContentSource = { title: string; content: string; policy: ContentPolicy; images?: SubmittedImage[]; unsupported?: 'audio' };
const exposures = new WeakMap<object, ContentPolicy[]>();
const sourceExposures = new WeakMap<object, Record<string, ContentPolicy>>();
export function exposeContent<T extends object>(result: T, policies: ContentPolicy[], sources?: Record<string, ContentPolicy>): T {
  exposures.set(result, policies);
  if (sources) sourceExposures.set(result, sources);
  return result;
}
export function exposedSourcePolicies(result: unknown) {
  return result && typeof result === 'object' ? sourceExposures.get(result) : undefined;
}
export function exposedPolicies(result: unknown) {
  return result && typeof result === 'object' ? exposures.get(result) : undefined;
}
export const contentDigest = (title: string, content: string) => createHash('sha256').update(JSON.stringify([title, content])).digest('hex');
export const bytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const policyUnavailable = () => new CapabilityError('NOT_FOUND', 'Documento ou fonte não encontrado ou acesso removido.');
const unique = <T>(values: T[]) => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];

export function parsePolicy(value: unknown, digest?: string): ContentPolicy {
  const result = policySchema.safeParse(value);
  if (!result.success || digest !== undefined && result.data.digest !== digest) throw policyUnavailable();
  return result.data;
}

export function personPolicy(title: string, content: string): ContentPolicy {
  return { format: 1, digest: contentDigest(title, content), origin: 'person', eligible: true, owners: [], guards: [], observed: [], receipt: randomUUID() };
}

function legacyPolicy(kind: string, id: string, version: number | string, title: string, content: string, digest = contentDigest(title, content)): ContentPolicy {
  return { ...personPolicy(title, content), digest, receipt: contentDigest(kind, JSON.stringify([id, version, digest])) };
}

export function combinePolicy(title: string, content: string, policies: ContentPolicy[], origin: ContentPolicy['origin'], receipt: string = randomUUID()): ContentPolicy {
  const guards = unique(policies.flatMap(policy => policy.guards));
  const observed = unique(policies.flatMap(policy => policy.observed));
  if (guards.length > MAX_GUARDS || observed.length > MAX_GUARDS) throw new CapabilityError('INVALID', 'Há fontes demais neste documento. Divida o pedido em documentos menores.');
  return { format: 1, digest: contentDigest(title, content), origin, eligible: policies.every(policy => policy.eligible),
    owners: [...new Set(policies.flatMap(policy => policy.owners))], guards, observed, receipt };
}

export function uncertainPolicy(userId: string, policies: ContentPolicy[] = []): ContentPolicy {
  return { ...combinePolicy('', '', policies, 'uncertain'), eligible: false, owners: [...new Set([userId, ...policies.flatMap(policy => policy.owners)])] };
}

export function requireShareEligible(policy: ContentPolicy) {
  if (!policy.eligible) throw new CapabilityError('FORBIDDEN', 'Este texto tem origem não verificável. O original continua particular. Faça um novo pedido nesta conversa e selecione as fontes que deseja usar.');
}

/** Guards authorize resource ACL only. Observed bytes already carry their historical obligations. */
export async function assertPolicyAccess(userId: string, policy: ContentPolicy, db: Transaction = database) {
  if (policy.owners.some(owner => owner !== userId)) throw policyUnavailable();
  await assertSourceGuards(userId, policy.guards, db);
}

export async function assertSourceGuards(userId: string, raw: SourceDependency[], db: Transaction = database) {
  const sources = unique(dependenciesSchema.parse(raw));
  if (sources.length > MAX_GUARDS) throw policyUnavailable();
  if (!sources.length) return;
  const row = await db.prepare(`SELECT bool_and(lume_resource_visible(r.kind,r.id,r."caseId",?)) AS allowed
    FROM jsonb_to_recordset(?::jsonb) AS r(kind text,id text,"caseId" text)`).get<{ allowed: boolean }>(userId, JSON.stringify(sources));
  if (!row?.allowed) throw policyUnavailable();
}

async function ancestors(folderId: string | null, caseId: string | null, db: Transaction): Promise<SourceDependency[]> {
  if (!folderId) return [];
  if (!caseId) throw policyUnavailable();
  const rows = await db.prepare(`WITH RECURSIVE chain AS (
    SELECT id,parent_id,case_id,office_id,deleted_at,ARRAY[id] AS path,false AS cycle FROM vault_folder WHERE id=?
    UNION ALL SELECT f.id,f.parent_id,f.case_id,f.office_id,f.deleted_at,c.path||f.id,f.id=ANY(c.path)
      FROM vault_folder f JOIN chain c ON f.id=c.parent_id WHERE NOT c.cycle AND cardinality(c.path)<64
  ) SELECT * FROM chain`).all<{ id: string; parent_id: string | null; case_id: string; office_id: string; deleted_at: string | null; cycle: boolean }>(folderId);
  if (!rows.length || rows.some(row => row.cycle || row.deleted_at || row.case_id !== caseId || row.office_id !== rows[0].office_id) || rows.at(-1)?.parent_id) throw policyUnavailable();
  return rows.map(row => ({ kind: 'folder', id: row.id, caseId }));
}

async function flattenLegacySourceObligations(raw: unknown, db: Transaction) {
  try {
    const row = await db.prepare('SELECT lume_legacy_obligations(?::jsonb) AS obligations').get<{ obligations: { guards: SourceDependency[]; owners: string[] } }>(JSON.stringify(raw));
    if (!row) throw policyUnavailable();
    return { guards: dependenciesSchema.parse(row.obligations.guards), owners: z.array(z.string()).parse(row.obligations.owners) };
  } catch { throw policyUnavailable(); }
}
export async function legacyGuards(raw: unknown, db: Transaction = database): Promise<SourceDependency[]> {
  return (await flattenLegacySourceObligations(dependenciesSchema.parse(raw), db)).guards;
}

type TextRow = { id: string; title: string; content: string; version: number; content_policy?: unknown };
export async function pagePolicy(row: TextRow & { source_dependencies: unknown }, db: Transaction = database) {
  if (row.content_policy) return parsePolicy(row.content_policy, contentDigest(row.title, row.content));
  return { ...legacyPolicy('page', row.id, row.version, row.title, row.content), origin: 'uncertain' as const, eligible: false, ...await flattenLegacySourceObligations(row.source_dependencies, db) };
}

export async function artifactPolicy(context: Pick<WorkspaceContext, 'officeId' | 'userId' | 'caseScope'>, id: string, db: Transaction = database, version?: number): Promise<ContentPolicy> {
  const row = await db.prepare('SELECT * FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?')
    .get<TextRow & { created_by_agent: boolean; run_id: string | null; conversation_id: string | null; source_refs: string }>(id, context.caseScope?.homeOfficeId ?? context.officeId, context.userId);
  if (!row) throw policyUnavailable();
  const text = version && version !== row.version ? await db.prepare('SELECT title,content,content_policy FROM ai_artifact_version WHERE artifact_id=? AND version=?')
    .get<{ title: string; content: string; content_policy: unknown }>(id, version) : row;
  if (!text) {
    const pinned = await db.prepare('SELECT content_policy FROM ai_artifact_policy WHERE artifact_id=? AND version=?').get<{ content_policy: unknown }>(id, version);
    if (pinned) return parsePolicy(pinned.content_policy);
    throw policyUnavailable();
  }
  if (text.content_policy) return parsePolicy(text.content_policy, contentDigest(text.title, text.content));
  const refs = z.array(z.unknown()).safeParse(JSON.parse(row.source_refs));
  if (!refs.success) throw policyUnavailable();
  const obligations = await flattenLegacySourceObligations([{ kind: 'artifact-version', id, version: version ?? row.version }], db);
  const human = !row.created_by_agent && !row.run_id && !row.conversation_id && refs.success && !refs.data.length;
  return { ...legacyPolicy('artifact', id, version ?? row.version, text.title, text.content), origin: human ? 'legacy-human' : 'uncertain', eligible: human && !obligations.owners.length,
    ...obligations, owners: [...new Set([...obligations.owners, ...(human ? [] : [context.userId])])] };
}

export async function observePage(userId: string, id: string, caseId: string, db: Transaction = database, version?: number): Promise<ContentSource> {
  if (db === database) return aclReadTransaction(tx => observePage(userId, id, caseId, tx, version));
  let row = await db.prepare('SELECT * FROM case_page WHERE id=? AND case_id=?')
    .get<TextRow & { source_dependencies: unknown; folder_id: string | null }>(id, caseId);
  if (!row) throw policyUnavailable();
  if (version !== undefined && version !== row.version) {
    const saved = await db.prepare('SELECT title,content,version,source_dependencies,content_policy FROM case_page_version WHERE page_id=? AND version=?')
      .get<TextRow & { source_dependencies: unknown }>(id, version);
    if (!saved) throw policyUnavailable();
    row = { ...row, ...saved };
  }
  const policy = await pagePolicy(row, db);
  const observation = { kind: 'page' as const, id, version: String(row.version), digest: policy.digest };
  const result = combinePolicy(row.title, row.content, [policy, { ...personPolicy('', ''), guards: [{ kind: 'page', id, caseId }, ...await ancestors(row.folder_id, caseId, db)], observed: [observation] }], policy.origin, policy.receipt);
  await assertPolicyAccess(userId, result, db);
  return { title: row.title, content: row.content, policy: result };
}

export async function vaultPolicy(documentId: string, version?: number, db: Transaction = database): Promise<ContentPolicy> {
  const row = await db.prepare(`SELECT v.version,v.content_policy,v.sha256,o.source_kind,o.source_id,o.source_version,o.user_id,d.office_id
    FROM vault_document_version v JOIN vault_document d ON d.id=v.document_id LEFT JOIN vault_agent_origin o ON o.document_id=d.id
    WHERE v.document_id=? AND ${version ? 'v.version=?' : 'v.is_active=1'}`)
    .get<{ version: number; content_policy: unknown; sha256: string; source_kind: string | null; source_id: string; source_version: number; user_id: string; office_id: string }>(documentId, ...(version ? [version] : []));
  if (!row) throw policyUnavailable();
  if (row.content_policy) return parsePolicy(row.content_policy, row.sha256);
  if (row.source_kind?.startsWith('artifact_')) {
    const owner = await db.prepare('SELECT office_id FROM ai_artifact WHERE id=? AND user_id=?').get<{ office_id: string }>(row.source_id, row.user_id);
    if (!owner) throw policyUnavailable();
    const inherited = await artifactPolicy({ officeId: owner.office_id, userId: row.user_id }, row.source_id, db, row.source_version);
    return { ...inherited, digest: row.sha256 };
  }
  return { ...legacyPolicy('document', documentId, row.version, '', '', row.sha256), origin: 'legacy-human' };
}

export async function observeDocument(userId: string, id: string, db: Transaction = database): Promise<ContentSource> {
  if (db === database) return aclReadTransaction(tx => observeDocument(userId, id, tx));
  const row = await db.prepare(`SELECT d.original_name,d.case_id,d.folder_id,d.status,d.extracted_version,d.extracted_sha256,v.version,v.sha256 FROM vault_document d
    JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1 WHERE d.id=? AND d.deleted_at IS NULL FOR SHARE OF d`)
    .get<{ original_name: string; case_id: string | null; folder_id: string | null; status: string; extracted_version: number | null; extracted_sha256: string | null; version: number; sha256: string }>(id);
  if (!row) throw policyUnavailable();
  const inherited = await vaultPolicy(id, row.version, db);
  const guards: SourceDependency[] = [{ kind: 'document', id }, ...await ancestors(row.folder_id, row.case_id, db)];
  const policy = combinePolicy('', '', [inherited, { ...personPolicy('', ''), guards,
    observed: [{ kind: 'document', id, version: String(row.version), digest: row.sha256 }] }], inherited.origin, inherited.receipt);
  await assertPolicyAccess(userId, policy, db);
  if (row.status !== 'ready' || row.extracted_version !== row.version || row.extracted_sha256 !== row.sha256)
    throw new CapabilityError('NOT_READY', 'A versão atual desta fonte ainda não foi processada. Aguarde o processamento e envie o pedido novamente.');
  const chunks = await db.prepare('SELECT content FROM vault_document_chunk WHERE document_id=? ORDER BY ordinal').all<{ content: string }>(id);
  const content = chunks.map(chunk => chunk.content).join('\n');
  return { title: row.original_name, content, policy: { ...policy, digest: contentDigest(row.original_name, content) } };
}

export async function observeVaultFile(userId: string, id: string, db: Transaction = database, exactVersion?: number): Promise<{
  original_name: string; case_id: string | null; folder_id: string | null; version: number; sha256: string; stored_name: string; policy: ContentPolicy;
}> {
  if (db === database) return aclReadTransaction(tx => observeVaultFile(userId, id, tx, exactVersion));
  const row = await db.prepare(`SELECT v.original_name,d.case_id,d.folder_id,v.version,v.sha256,v.stored_name
    FROM vault_document d JOIN vault_document_version v ON v.document_id=d.id AND ${exactVersion === undefined ? 'v.is_active=1' : 'v.version=?'}
    WHERE d.id=? AND d.deleted_at IS NULL FOR SHARE OF d`)
    .get<{ original_name: string; case_id: string | null; folder_id: string | null; version: number; sha256: string; stored_name: string }>(...(exactVersion === undefined ? [] : [exactVersion]), id);
  if (!row) throw policyUnavailable();
  const inherited = await vaultPolicy(id, row.version, db);
  const policy = combinePolicy('', '', [inherited, { ...personPolicy('', ''),
    guards: [{ kind: 'document', id }, ...await ancestors(row.folder_id, row.case_id, db)],
    observed: [{ kind: 'document', id, version: String(row.version), digest: row.sha256 }] }], inherited.origin, inherited.receipt);
  await assertPolicyAccess(userId, policy, db);
  return { ...row, policy };
}

export async function observeResearch(userId: string, id: string, caseId: string, db: Transaction = database): Promise<ContentSource> {
  if (db === database) return aclReadTransaction(tx => observeResearch(userId, id, caseId, tx));
  const row = await db.prepare('SELECT material_version_id FROM research_case_reference WHERE id=? AND case_id=? AND deleted_at IS NULL')
    .get<{ material_version_id: string }>(id, caseId);
  if (!row) throw policyUnavailable();
  const material = await materialSnapshot(row.material_version_id, db);
  if (!material?.aiAllowed || !material.text) throw policyUnavailable();
  const policy = legacyPolicy('research', id, material.versionId, material.title, material.text);
  policy.guards = [{ kind: 'research', id, caseId }, { kind: 'research-material', id: material.versionId }];
  policy.observed = [{ kind: 'research', id, version: material.versionId, digest: material.sha256 }];
  await assertPolicyAccess(userId, policy, db);
  return { title: material.title, content: material.text, policy };
}

export async function privateGenerationPolicy(context: WorkspaceContext, db: Transaction = database): Promise<ContentPolicy> {
  if (context.contentSources) return uncertainPolicy(context.userId, context.contentSources);
  const previous = context.conversationId ? await db.prepare("SELECT dependencies FROM ai_source_provenance WHERE resource_kind='conversation' AND resource_id=? AND office_id=? AND user_id=?")
    .get<{ dependencies: unknown }>(context.conversationId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId) : undefined;
  return uncertainPolicy(context.userId, previous ? [{ ...personPolicy('', ''), ...await flattenLegacySourceObligations(previous.dependencies, db) }] : []);
}

export async function assertExternalDelivery(userId: string, policy: ContentPolicy, db: Transaction = database) {
  await assertPolicyAccess(userId, policy, db);
  if (!policy.eligible || policy.owners.length || policy.guards.length) throw new CapabilityError('FORBIDDEN', 'Este conteúdo tem fontes com acesso restrito. O envio externo não permite conferir o acesso do destinatário.');
}

export async function settingWritePolicy(context: WorkspaceContext, title: string, content: string, base: { title: string; content: string; content_policy: unknown } | undefined, db: Transaction) {
  const sources: ContentPolicy[] = [];
  if (base) sources.push(base.content_policy ? parsePolicy(base.content_policy, contentDigest(base.title, base.content)) : uncertainPolicy(context.userId));
  if (context.invocation) sources.push(await privateGenerationPolicy(context, db));
  const policy = combinePolicy(title, content, sources, context.invocation ? 'uncertain' : 'person');
  await assertPolicyAccess(context.userId, policy, db);
  if (context.invocation) {
    const { assertSourcesAdmitted } = await import('./application/context');
    await assertSourcesAdmitted(policy, db);
  }
  return policy;
}
