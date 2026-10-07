import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, type Transaction } from '@/lib/database';
import { documentTransaction } from '@/lib/documents/service';
import { assertCapabilityAllowed, assertLumeAdmission, type WorkspaceContext } from '@/lib/application/context';
import { canonicalInput, createApprovalProposal, type ApprovalRow } from '@/lib/application/approvals-service';
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';
import { documentHref } from '@/lib/document-ref';
import type { CapabilityInput } from '@/lib/capabilities/contracts';
import type { CasePage } from './contracts';
import { unavailable } from './provenance';
import { exposeContent, observePage, artifactPolicy, assertPolicyAccess, combinePolicy, pagePolicy, parsePolicy, personPolicy, requireShareEligible, type ContentPolicy } from '@/lib/content-policy';
import { prepareSharedWriting } from '@/lib/documents/shared-writing';

type PageRow = {
  id: string; office_id: string; case_id: string; folder_id: string | null;
  title: string; content: string; version: number; source_dependencies: unknown; content_policy: unknown; updated_at: string;
};
type WriteName = 'k5_case_pages_create' | 'k5_case_pages_update' | 'k5_case_pages_publish' | 'k5_case_pages_restore';
type Mutation = { caseId: string; folderId: string | null; pageId?: string; version?: number; title: string; content: string; policy: ContentPolicy };
type PageApproval = { mutation: Mutation | null; content_policy: unknown; source_dependencies: unknown; conversation_id: string | null; result_page_id: string | null; result_version: number | null };
const view = (row: PageRow): CasePage => ({ id: row.id, caseId: row.case_id, folderId: row.folder_id, title: row.title, content: row.content, version: row.version, updatedAt: String(row.updated_at) });
const conflict = () => new CapabilityError('CONFLICT', 'Esta página mudou. Suas alterações foram preservadas. Leia a versão atual antes de salvar.');

async function destination(context: WorkspaceContext, caseId: string, folderId: string | null, db: Transaction = database) {
  if (context.caseScope && context.caseScope.caseId !== caseId) throw unavailable();
  const access = await caseAccess(context.userId, caseId, db);
  if(context.invocation)await assertLumeAdmission(caseId,db);
  if (folderId && !await db.prepare('SELECT 1 FROM vault_folder WHERE id=? AND office_id=? AND case_id=? AND deleted_at IS NULL AND vault_folder_visible(id,?)')
    .get(folderId, access.officeId, caseId, context.userId)) throw unavailable();
  return access;
}

async function requirePage(context: WorkspaceContext, caseId: string, pageId: string, db: Transaction = database, lock = false, checkContent = true) {
  const row = await db.prepare(`SELECT * FROM case_page WHERE id=? AND case_id=?${lock ? ' FOR UPDATE' : ''}`).get<PageRow>(pageId, caseId);
  if (!row) throw unavailable();
  const access = await destination(context, caseId, row.folder_id, db);
  if (row.office_id !== access.officeId) throw unavailable();
  if (checkContent) await assertPolicyAccess(context.userId, await pagePolicy(row, db), db);
  return row;
}

export async function getPage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_get'>) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_case_pages_get', tx);
    const row = await requirePage(context, input.caseId, input.pageId, tx);
    const policy = (await observePage(context.userId, row.id, row.case_id, tx, row.version)).policy;
    return exposeContent({ page: view(row), untrustedContent: true as const }, [policy]);
  });
}

export async function listPages(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_list'>) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_case_pages_list', tx);
    const access = await destination(context, input.caseId, input.folderId ?? null, tx);
    const rows = await tx.prepare('SELECT id FROM case_page WHERE office_id=? AND case_id=? AND folder_id IS NOT DISTINCT FROM ? ORDER BY updated_at DESC,id')
      .all<{ id: string }>(access.officeId, input.caseId, input.folderId ?? null);
    const pages: Omit<CasePage, 'content'>[] = [];
    const policies: ContentPolicy[] = [];
    for (const item of rows) {
      try {
        const row = await requirePage(context, input.caseId, item.id, tx);
        if (input.query && !`${row.title}\n${row.content}`.toLocaleLowerCase('pt-BR').includes(input.query.toLocaleLowerCase('pt-BR'))) continue;
        policies.push((await observePage(context.userId, row.id, row.case_id, tx, row.version)).policy);
        pages.push({ id: row.id, caseId: row.case_id, folderId: row.folder_id, title: row.title, version: row.version, updatedAt: String(row.updated_at), preview: row.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) });
      } catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
    }
    return exposeContent({ pages }, policies);
  });
}

export async function listVersions(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_versions'>) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_case_pages_versions', tx);
    await requirePage(context, input.caseId, input.pageId, tx, false, false);
    const rows = await tx.prepare('SELECT *,page_id AS id FROM case_page_version WHERE page_id=? ORDER BY version DESC')
      .all<PageRow & { created_at: string }>(input.pageId);
    const versions: { version: number; title: string; createdAt: string }[] = [];
    const policies: ContentPolicy[] = [];
    for (const row of rows) {
      try {
        policies.push((await observePage(context.userId, input.pageId, input.caseId, tx, row.version)).policy);
        versions.push({ version: row.version, title: row.title, createdAt: String(row.created_at) });
      } catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
    }
    return exposeContent({ versions }, policies);
  });
}

async function resolveMutation(context: WorkspaceContext, name: WriteName, input: Record<string, unknown>, db: Transaction = database): Promise<Mutation> {
  const caseId = String(input.caseId);
  let mutation: Mutation;
  if (name === 'k5_case_pages_publish') {
    const artifact = await db.prepare('SELECT title,content,version FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?')
      .get<{ title: string; content: string; version: number }>(input.artifactId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId);
    if (!artifact) throw unavailable();
    if (artifact.version !== input.artifactVersion) throw conflict();
    const policy = await artifactPolicy(context, String(input.artifactId), db);
    requireShareEligible(policy);
    mutation = { caseId, folderId: input.folderId as string | null ?? null, title: artifact.title, content: artifact.content, policy };
  } else if (name === 'k5_case_pages_create') {
    mutation = { caseId, folderId: input.folderId as string | null ?? null, title: String(input.title), content: String(input.content), policy: personPolicy(String(input.title), String(input.content)) };
  } else {
    const row = await requirePage(context, caseId, String(input.pageId), db);
    if (row.version !== input.version) throw conflict();
    mutation = { caseId, folderId: row.folder_id, pageId: row.id, version: row.version, title: String(input.title), content: String(input.content), policy: await pagePolicy(row, db) };
    if (name === 'k5_case_pages_restore') {
      const historical = await db.prepare('SELECT *,page_id AS id FROM case_page_version WHERE page_id=? AND version=?')
        .get<PageRow>(row.id, input.restoreVersion);
      if (!historical) throw unavailable();
      mutation.title = historical.title;
      mutation.content = historical.content;
      mutation.policy = combinePolicy(historical.title, historical.content, [mutation.policy, await pagePolicy(historical, db)], 'person');
    }
  }
  await destination(context, caseId, mutation.folderId, db);
  mutation.policy = combinePolicy(mutation.title, mutation.content, [mutation.policy], 'person');
  await assertPolicyAccess(context.userId, mutation.policy, db);
  return mutation;
}

async function writePage(context: WorkspaceContext, name: WriteName, mutation: Mutation, tx: Transaction) {
  const access = await destination(context, mutation.caseId, mutation.folderId, tx);
  await assertPolicyAccess(context.userId, mutation.policy, tx);
  const id = mutation.pageId ?? randomUUID();
  if (mutation.pageId) {
    const current = await requirePage(context, mutation.caseId, id, tx, true);
    if (current.version !== mutation.version) throw conflict();
    await assertCapabilityAllowed(context, name, tx);
    const changed = await tx.prepare('UPDATE case_page SET title=?,content=?,version=version+1,source_dependencies=?::jsonb,content_policy=?::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?')
      .run(mutation.title, mutation.content, JSON.stringify(mutation.policy.guards), JSON.stringify(mutation.policy), id, mutation.version);
    if (!changed.changes) throw conflict();
  } else {
    await assertCapabilityAllowed(context, name, tx);
    await tx.prepare('INSERT INTO case_page(id,office_id,case_id,folder_id,title,content,source_dependencies,content_policy,created_by) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?)')
      .run(id, access.officeId, mutation.caseId, mutation.folderId, mutation.title, mutation.content, JSON.stringify(mutation.policy.guards), JSON.stringify(mutation.policy), context.userId);
  }
  const row = await requirePage(context, mutation.caseId, id, tx);
  await tx.prepare('INSERT INTO case_page_version(page_id,version,title,content,source_dependencies,content_policy,user_id) VALUES(?,?,?,?,?::jsonb,?::jsonb,?)')
    .run(id, row.version, row.title, row.content, JSON.stringify(mutation.policy.guards), JSON.stringify(mutation.policy), context.userId);
  return { page: view(row) };
}

export async function proposePageWrite(context: WorkspaceContext, name: WriteName, input: Record<string, unknown>) {
  await assertCapabilityAllowed(context, name);
  let generated: Awaited<ReturnType<typeof prepareSharedWriting>> | undefined;
  if (context.invocation && (name === 'k5_case_pages_create' || name === 'k5_case_pages_update')) {
    generated = await prepareSharedWriting(context, name, input);
    if (generated.approvalId) return { approvalId: generated.approvalId, ...await approvalPreview(context, generated.approvalId) };
    input = { ...input, title: generated.title, content: generated.content };
  }
  const approvalId = await documentTransaction(context, async tx => {
    if (generated) {
      const attempt = await tx.prepare('SELECT approval_id FROM content_generation_attempt WHERE id=? FOR UPDATE').get<{ approval_id: string | null }>(generated.attemptId);
      if (attempt?.approval_id) return attempt.approval_id;
    }
    const mutation = await resolveMutation(context, name, input, tx);
    if (generated) mutation.policy = combinePolicy(mutation.title, mutation.content, [mutation.policy, generated.policy], 'generated', generated.attemptId);
    await assertCapabilityAllowed(context, name, tx);
    await assertPolicyAccess(context.userId, mutation.policy, tx);
    const proposal = await createApprovalProposal(context, name, input, mutation.pageId ?? mutation.caseId, mutation.version ?? (input.artifactVersion as number | undefined), 600_000, tx);
    await tx.prepare('INSERT INTO case_page_approval(approval_id,source_dependencies,conversation_id,mutation,content_policy) VALUES(?,?::jsonb,?,?::jsonb,?::jsonb)')
      .run(proposal.id, JSON.stringify(mutation.policy.guards), context.invocation ? context.conversationId ?? null : null, JSON.stringify(mutation), JSON.stringify(mutation.policy));
    if (generated) await tx.prepare('UPDATE content_generation_attempt SET approval_id=? WHERE id=?').run(proposal.id, generated.attemptId);
    return proposal.id;
  });
  return { approvalId, ...await approvalPreview(context, approvalId) };
}

async function reviewedMutation(context: WorkspaceContext, approval: ApprovalRow, record: PageApproval, db: Transaction) {
  if (approval.status !== 'consumed') {
    const submission = await db.prepare(`SELECT s.input_format FROM content_generation_attempt a
      JOIN content_submission s ON s.id=a.submission_id WHERE a.approval_id=?`).get<{ input_format: number }>(approval.id);
    if (submission && submission.input_format !== 2) throw new CapabilityError('NOT_READY', 'Envie o pedido novamente para registrar seus textos e anexos com a versão correta.');
  }
  if (record.mutation) {
    const mutation = record.mutation;
    mutation.policy = parsePolicy(record.content_policy, personPolicy(mutation.title, mutation.content).digest);
    await destination(context, mutation.caseId, mutation.folderId, db);
    await assertPolicyAccess(context.userId, mutation.policy, db);
    return mutation;
  }
  if (record.conversation_id) throw new CapabilityError('FORBIDDEN', 'Esta proposta antiga precisa ser refeita com um novo pedido e fontes selecionadas.');
  return resolveMutation(context, approval.capability_name as WriteName, JSON.parse(approval.normalized_input), db);
}

export async function approvalPreview(context: WorkspaceContext, approvalId: string) {
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get<ApprovalRow>(approvalId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId);
  const record = await database.prepare('SELECT * FROM case_page_approval WHERE approval_id=?').get<PageApproval>(approvalId);
  if (!row || !record) throw unavailable();
  const input = JSON.parse(row.normalized_input) as Record<string, unknown>;
  const mutation = await reviewedMutation(context, row, record, database);
  const access = await destination(context, mutation.caseId, mutation.folderId);
  const target = await database.prepare('SELECT name FROM vault_case WHERE id=? AND office_id=?').get<{ name: string }>(mutation.caseId, access.officeId);
  const folder = mutation.folderId ? await database.prepare('SELECT name FROM vault_folder WHERE id=?').get<{ name: string }>(mutation.folderId) : null;
  return { title: mutation.title, content: mutation.content, caseId: mutation.caseId, folderId: mutation.folderId, destination: `${target!.name}${folder ? ` / ${folder.name}` : ''}`,
    audience: mutation.policy.guards.length ? 'Participantes com acesso à pasta e a todas as fontes utilizadas.' : 'Participantes com acesso a esta pasta do caso.',
    version: mutation.version ?? null, artifactVersion: typeof input.artifactVersion === 'number' ? input.artifactVersion : null };
}

async function mutate(context: WorkspaceContext, name: WriteName, raw: Record<string, unknown>) {
  await assertCapabilityAllowed(context, name);
  const { approvalId, ...input } = raw;
  if (!approvalId && (context.invocation || name === 'k5_case_pages_publish')) {
    const proposal = await proposePageWrite(context, name, input);
    throw new CapabilityError('APPROVAL_REQUIRED', `Confira o conteúdo e o destino antes de compartilhar. Proposta registrada [id: ${proposal.approvalId}].`);
  }
  return documentTransaction(context, async tx => {
    let approval: ApprovalRow | undefined;
    let record: PageApproval | undefined;
    if (approvalId) {
      approval = await tx.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
        .get<ApprovalRow>(approvalId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId);
      record = await tx.prepare('SELECT * FROM case_page_approval WHERE approval_id=?').get<PageApproval>(approvalId);
      if (!approval || !record || approval.capability_name !== name || approval.normalized_input !== canonicalInput(input)) throw new CapabilityError('FORBIDDEN', 'Esta aprovação não corresponde ao conteúdo e destino solicitados.');
      context = { ...context, ...approval.origin_context, userId: context.userId, sessionId: context.sessionId };
      await assertCapabilityAllowed(context, name, tx);
      await reviewedMutation(context, approval, record, tx);
      if (approval.status === 'consumed' && record.result_page_id && record.result_version) {
        const current = await requirePage(context, String(input.caseId), record.result_page_id, tx, false, false);
        const historical = await tx.prepare('SELECT *,page_id AS id,created_at AS updated_at FROM case_page_version WHERE page_id=? AND version=?').get<PageRow>(record.result_page_id, record.result_version);
        if (!historical) throw unavailable();
        await assertPolicyAccess(context.userId, await pagePolicy(historical, tx), tx);
        return { page: view({ ...current, ...historical }) };
      }
      if (approval.status !== 'approved') throw new CapabilityError('APPROVAL_REQUIRED', 'Confirme o conteúdo antes de compartilhar.');
      if (approval.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'A confirmação expirou. Revise novamente.');
    }
    const mutation = approval && record ? await reviewedMutation(context, approval, record, tx) : await resolveMutation(context, name, input, tx);
    context.signal?.throwIfAborted();
    const result = await writePage(context, name, mutation, tx);
    if (approval) {
      await tx.prepare("UPDATE capability_approval SET status='consumed',consumed_at=CURRENT_TIMESTAMP,chat_result=? WHERE id=?")
        .run(JSON.stringify({ state: 'confirmed', result: 'Página compartilhada salva.', href: documentHref({ kind: 'case-page', caseId: result.page.caseId, id: result.page.id }) }), approval.id);
      await tx.prepare('UPDATE case_page_approval SET result_page_id=?,result_version=? WHERE approval_id=?').run(result.page.id, result.page.version, approval.id);
    }
    return result;
  });
}

export function createPage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_create'>) { return mutate(context, 'k5_case_pages_create', { ...input, folderId: input.folderId ?? null }); }
export function updatePage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_update'>) { return mutate(context, 'k5_case_pages_update', input); }
export function publishPage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_publish'>) { return mutate(context, 'k5_case_pages_publish', { ...input, folderId: input.folderId ?? null }); }
export function restorePage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_restore'>) { return mutate(context, 'k5_case_pages_restore', input); }
export async function exportPage(context: WorkspaceContext, input: CapabilityInput<'k5_case_pages_export'>) {
  const { page } = await getPage(context, input);
  if (page.version !== input.version) throw conflict();
  return { downloadUrl: `/api/cases/${encodeURIComponent(page.caseId)}/pages/${encodeURIComponent(page.id)}/export?format=${input.format}&version=${page.version}`, fileName: `${page.title}.${input.format}` };
}
