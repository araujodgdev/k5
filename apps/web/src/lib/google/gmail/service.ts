import 'server-only';
import { createHash } from 'node:crypto';
import type { CapabilityInput as Input, CapabilityOutput as Output } from '@/lib/capabilities/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { database } from '@/lib/database';
import { readVaultDocumentFile } from '@/lib/vault';
import { objectStorage } from '@/lib/storage';
import { googleJson, requireConnection, type ConnectionRow } from '../connections';
import { runGoogleOperation, markOperationEffect, digest, operationDto, operationResult, reconcileOperationById,
  type OperationRecord, type Reconciler, type ReconcileOutcome, type RunningOperation } from '../operations';
import type { GoogleAction } from '../policy';
import { technicalLimits } from '../policy';
import { importFormatFor } from '../drive/formats';
import { attachmentParts, decodeBase64Url, gmailHeader, messageHtml, messageText, mimeMessage, safeAddress, safeMessageId,
  type GmailMessage, type MailFile } from './mime';

const root = '/users/me';
type Draft = { id: string; message: GmailMessage };
type DraftView = Output<'k5_gmail_get_draft'>['draft'];
type ComposeInput = Input<'k5_gmail_send'> | Input<'k5_gmail_save_draft'>;
type Prepared = { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; replyToMessageId: string | null;
  threadId: string | null; replyHeader: string | null; references: string | null; draftId: string | null; files: MailFile[]; draftVersion: string | null };
function idPath(id: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new CapabilityError('INVALID', 'Identificador do Gmail inválido.');
  return encodeURIComponent(id);
}
const dateOf = (message: GmailMessage) => message.internalDate && Number.isFinite(Number(message.internalDate))
  ? new Date(Number(message.internalDate)).toISOString() : null;
const addresses = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean).map(s => (s.match(/<([^<>]+)>/)?.[1] ?? s).trim());
function messageDto(message: GmailMessage): Output<'k5_gmail_get_thread'>['thread']['messages'][number] {
  return { id: message.id, threadId: message.threadId ?? '', from: gmailHeader(message.payload, 'From'),
    to: addresses(gmailHeader(message.payload, 'To')), cc: addresses(gmailHeader(message.payload, 'Cc')),
    date: dateOf(message), subject: gmailHeader(message.payload, 'Subject'), text: messageText(message),
    html: null, remoteContentBlocked: true,
    attachments: attachmentParts(message).map(p => ({ partId: p.partId, filename: p.filename, mimeType: p.mimeType,
      size: p.size, importable: p.size > 0 && p.size <= 50 * 1024 * 1024 && Boolean(importFormatFor(p.mimeType)) })) };
}
export async function listThreads(context: WorkspaceContext, input: Input<'k5_gmail_list_threads'>): Promise<Output<'k5_gmail_list_threads'>> {
  const connection = await requireConnection(context, 'gmail');
  const listed = await googleJson<{ threads?: { id: string }[]; nextPageToken?: string }>(connection, {
    service: 'gmail', path: `${root}/threads`, query: { maxResults: input.limit, pageToken: input.pageToken,
      q: input.query, labelIds: input.label === 'ALL' ? undefined : input.label }, maxBytes: 200_000 });
  const threads = await Promise.all((listed.threads ?? []).map(async t => {
    const thread = await googleJson<{ id: string; messages?: GmailMessage[]; snippet?: string }>(connection, {
      service: 'gmail', path: `${root}/threads/${idPath(t.id)}`,
      query: { format: 'full', fields: 'id,snippet,messages(id,internalDate,labelIds,snippet,payload(headers,parts(partId,filename,mimeType,body(size,attachmentId),parts)))' },
      maxBytes: 350_000 });
    const messages = thread.messages ?? [];
    const newest = messages.at(-1);
    return { id: thread.id, subject: gmailHeader(messages[0]?.payload, 'Subject'),
      snippet: String(thread.snippet ?? newest?.snippet ?? '').slice(0, 500), from: gmailHeader(newest?.payload, 'From'),
      date: newest ? dateOf(newest) : null, unread: messages.some(m => m.labelIds?.includes('UNREAD')),
      messageCount: messages.length, hasAttachments: messages.some(m => attachmentParts(m).length > 0) };
  }));
  return { threads, nextPageToken: listed.nextPageToken ?? null, untrustedContent: true };
}
export async function getThread(context: WorkspaceContext, input: Input<'k5_gmail_get_thread'>): Promise<Output<'k5_gmail_get_thread'>> {
  const connection = await requireConnection(context, 'gmail');
  const thread = await googleJson<{ id: string; messages?: GmailMessage[] }>(connection, {
    service: 'gmail', path: `${root}/threads/${idPath(input.threadId)}`, query: { format: 'full' }, maxBytes: 12_000_000 });
  const messages = (thread.messages ?? []).map(messageDto);
  return { thread: { id: thread.id, subject: messages[0]?.subject ?? '', messages }, untrustedContent: true };
}
/**
 * The reader's view of a thread: the capability's messages plus each one's original HTML. It is a
 * separate path so the HTML reaches only the sandboxed frame in the browser, never the agent.
 */
export async function getThreadForReading(context: WorkspaceContext, threadId: string): Promise<Output<'k5_gmail_get_thread'>> {
  const authorized = await assertCapabilityAllowed(context, 'k5_gmail_get_thread');
  const connection = await requireConnection(authorized, 'gmail');
  const thread = await googleJson<{ id: string; messages?: GmailMessage[] }>(connection, {
    service: 'gmail', path: `${root}/threads/${idPath(threadId)}`, query: { format: 'full' }, maxBytes: 12_000_000 });
  const messages = (thread.messages ?? []).map(message => ({ ...messageDto(message), html: messageHtml(message) }));
  return { thread: { id: thread.id, subject: messages[0]?.subject ?? '', messages }, untrustedContent: true };
}
async function fetchDraft(connection: ConnectionRow, id: string): Promise<Draft> {
  return googleJson<Draft>(connection, { service: 'gmail', path: `${root}/drafts/${idPath(id)}`,
    query: { format: 'full' }, maxBytes: 12_000_000 });
}
function draftView(draft: Draft): DraftView {
  const m = draft.message;
  return { id: draft.id, threadId: m.threadId ?? null, to: addresses(gmailHeader(m.payload, 'To')),
    cc: addresses(gmailHeader(m.payload, 'Cc')), bcc: addresses(gmailHeader(m.payload, 'Bcc')),
    subject: gmailHeader(m.payload, 'Subject'), body: messageText(m), replyToMessageId: null,
    updatedAt: dateOf(m), attachments: attachmentParts(m).map(p => ({ partId: p.partId, filename: p.filename,
      mimeType: p.mimeType, size: p.size })) };
}
export async function listDrafts(context: WorkspaceContext, input: Input<'k5_gmail_list_drafts'>): Promise<Output<'k5_gmail_list_drafts'>> {
  const connection = await requireConnection(context, 'gmail');
  const listed = await googleJson<{ drafts?: { id: string }[]; nextPageToken?: string }>(connection, {
    service: 'gmail', path: `${root}/drafts`, query: { maxResults: input.limit, pageToken: input.pageToken }, maxBytes: 200_000 });
  const drafts = await Promise.all((listed.drafts ?? []).map(async row => {
    const draft = await fetchDraft(connection, row.id);
    const view = draftView(draft);
    return { id: view.id, threadId: view.threadId, subject: view.subject, to: view.to,
      snippet: String(draft.message.snippet ?? view.body).slice(0, 300), updatedAt: view.updatedAt };
  }));
  return { drafts, nextPageToken: listed.nextPageToken ?? null };
}
export async function getDraft(context: WorkspaceContext, input: Input<'k5_gmail_get_draft'>): Promise<Output<'k5_gmail_get_draft'>> {
  return { draft: draftView(await fetchDraft(await requireConnection(context, 'gmail'), input.draftId)) };
}
async function fileFromPart(connection: ConnectionRow, message: GmailMessage, part: ReturnType<typeof attachmentParts>[number]): Promise<MailFile> {
  const data = part.data ? decodeBase64Url(part.data, technicalLimits.maxAttachmentBytes)
    : decodeBase64Url((await googleJson<{ data: string }>(connection, {
      service: 'gmail', path: `${root}/messages/${idPath(message.id)}/attachments/${idPath(part.attachmentId ?? '')}`,
      maxBytes: 35_000_000 })).data, technicalLimits.maxAttachmentBytes);
  return { filename: part.filename, mimeType: part.mimeType, data, digest: createHash('sha256').update(data).digest('hex'), partId: part.partId };
}
async function preparedFiles(context: WorkspaceContext, connection: ConnectionRow, input: ComposeInput, draft?: Draft, preserveDraftFiles = false): Promise<MailFile[]> {
  const files: MailFile[] = [];
  if (draft && preserveDraftFiles) {
    for (const part of attachmentParts(draft.message)) files.push(await fileFromPart(connection, draft.message, part));
  } else for (const ref of input.attachments ?? []) {
    if (ref.kind === 'vault') {
      const file = await readVaultDocumentFile(context.officeId, ref.documentId);
      files.push({ filename: file.name, mimeType: file.mimeType, data: file.buffer,
        digest: createHash('sha256').update(file.buffer).digest('hex') });
    } else if (ref.kind === 'upload') {
      const upload = await database.prepare(`SELECT storage_key,file_name,mime_type FROM google_mail_upload
        WHERE id=? AND office_id=? AND user_id=? AND expires_at>CURRENT_TIMESTAMP`).get<{ storage_key: string; file_name: string; mime_type: string }>(
        ref.uploadId, context.officeId, context.userId);
      if (!upload) throw new CapabilityError('NOT_FOUND', 'Anexo enviado não encontrado ou expirado.');
      const data = await (await objectStorage()).get(upload.storage_key);
      files.push({ filename: upload.file_name, mimeType: upload.mime_type, data,
        digest: createHash('sha256').update(data).digest('hex') });
    } else {
      if (!draft) throw new CapabilityError('INVALID', 'Abra um rascunho para reutilizar o anexo.');
      const part = attachmentParts(draft.message).find(p => p.partId === ref.partId);
      if (!part) throw new CapabilityError('NOT_FOUND', 'Anexo do rascunho não encontrado.');
      files.push(await fileFromPart(connection, draft.message, part));
    }
    if (files.length > technicalLimits.maxAttachments || files.reduce((sum, f) => sum + f.data.length, 0) > technicalLimits.maxAttachmentBytes)
      throw new CapabilityError('INVALID', 'Use no máximo 10 anexos e 25 MB ao todo.');
  }
  if (files.length > technicalLimits.maxAttachments || files.reduce((sum, f) => sum + f.data.length, 0) > technicalLimits.maxAttachmentBytes)
    throw new CapabilityError('INVALID', 'Use no máximo 10 anexos e 25 MB ao todo.');
  return files;
}
async function prepare(context: WorkspaceContext, connection: ConnectionRow, input: ComposeInput): Promise<Prepared> {
  const draft = input.draftId ? await fetchDraft(connection, input.draftId) : undefined;
  const existing = draft ? draftView(draft) : null;
  const useDraft = Boolean(draft && !(input.to ?? []).length && !(input.cc ?? []).length && !(input.bcc ?? []).length && !input.subject && !input.body && !input.replyToMessageId);
  const to = (useDraft ? existing!.to : input.to ?? []).map(safeAddress);
  const cc = (useDraft ? existing!.cc : input.cc ?? []).map(safeAddress);
  const bcc = (useDraft ? existing!.bcc : input.bcc ?? []).map(safeAddress);
  const subject = useDraft ? existing!.subject : input.subject ?? '';
  const body = useDraft ? existing!.body : input.body ?? '';
  const replyId = useDraft ? null : input.replyToMessageId ?? null;
  const reply = replyId ? await googleJson<GmailMessage>(connection, { service: 'gmail',
    path: `${root}/messages/${idPath(replyId)}`, query: { format: 'metadata' }, maxBytes: 100_000 }) : null;
  const replyHeader = reply ? safeMessageId(gmailHeader(reply.payload, 'Message-ID'))
    : draft && gmailHeader(draft.message.payload, 'In-Reply-To') ? safeMessageId(gmailHeader(draft.message.payload, 'In-Reply-To')) : null;
  const referenceHeader = reply ? gmailHeader(reply.payload, 'References')
    : draft ? gmailHeader(draft.message.payload, 'References') : null;
  if (reply && subject.replace(/^re:\s*/i, '').trim().toLowerCase() !== gmailHeader(reply.payload, 'Subject').replace(/^re:\s*/i, '').trim().toLowerCase())
    throw new CapabilityError('INVALID', 'O assunto da resposta deve corresponder à conversa original.');
  const files = await preparedFiles(context, connection, input, draft, useDraft);
  return { to, cc, bcc, subject, body, replyToMessageId: replyId, threadId: reply?.threadId ?? draft?.message.threadId ?? null,
    replyHeader, references: replyHeader ? `${referenceHeader} ${replyHeader}`.trim() : null, draftId: draft?.id ?? null, files,
    draftVersion: draft ? versionOfDraft(draft) : null };
}
function versionOfDraft(draft: Draft) {
  return digest({ id: draft.message.id, date: draft.message.internalDate, subject: gmailHeader(draft.message.payload, 'Subject'),
    body: messageText(draft.message), attachments: attachmentParts(draft.message).map(p => [p.partId, p.size]) });
}
async function assertDraftVersion(connection: ConnectionRow, prepared: Prepared) {
  if (!prepared.draftId) return;
  const current = await fetchDraft(connection, prepared.draftId);
  const version = versionOfDraft(current);
  if (version !== prepared.draftVersion)
    throw new CapabilityError('CONFLICT', 'O rascunho mudou no Gmail. Revise antes de continuar.');
}
function review(prepared: Prepared, sender: string) {
  return { to: prepared.to, cc: prepared.cc, bcc: prepared.bcc, subject: prepared.subject, body: prepared.body,
    draftId: prepared.draftId, draftVersion: prepared.draftVersion, replyToMessageId: prepared.replyToMessageId,
    attachments: prepared.files.map(f => ({ name: f.filename, mimeType: f.mimeType, size: f.data.length, sha256: f.digest })),
    review: [{ label: 'Remetente', value: sender }, { label: 'Para', value: prepared.to.join(', ') },
      { label: 'Cc', value: prepared.cc.join(', ') }, { label: 'Cco', value: prepared.bcc.join(', ') },
      { label: 'Assunto', value: prepared.subject }, { label: 'Corpo', value: prepared.body },
      { label: 'Anexos', value: prepared.files.map(f => `${f.filename} (${f.data.length} bytes, SHA-256 ${f.digest})`).join('; ') || 'Nenhum' },
      { label: 'Versão do rascunho', value: prepared.draftVersion ?? 'Nova mensagem' }] };
}
function messageId(handle: RunningOperation) { return `<${handle.reconcileKey.replace(/[^a-zA-Z0-9-]/g, '')}@mail.lume.invalid>`; }
function rawFor(handle: RunningOperation, prepared: Prepared, allowNoRecipients = false) {
  return mimeMessage({ ...prepared, from: handle.connection.email, messageId: messageId(handle),
    replyHeader: prepared.replyHeader ?? undefined, references: prepared.references ?? undefined,
    threadId: prepared.threadId ?? undefined, allowNoRecipients });
}
const resultFrom = (message: { id?: string; threadId?: string }) => ({ messageId: message.id ?? null, threadId: message.threadId ?? null });
async function findByMessageId(handle: RunningOperation, label: 'SENT' | 'DRAFT') {
  const id = messageId(handle);
  const listed = await googleJson<{ messages?: { id: string }[] }>(handle.connection, { service: 'gmail', path: `${root}/messages`,
    query: { q: `rfc822msgid:${id}`, labelIds: label, maxResults: 10 }, maxBytes: 100_000 });
  for (const candidate of listed.messages ?? []) {
    const message = await googleJson<GmailMessage>(handle.connection, { service: 'gmail',
      path: `${root}/messages/${idPath(candidate.id)}`, query: { format: 'metadata' }, maxBytes: 100_000 });
    if (gmailHeader(message.payload, 'Message-ID') === id && message.labelIds?.includes(label)) return message;
  }
  return null;
}
const sendReconciler = async (handle: RunningOperation): Promise<ReconcileOutcome<{ messageId: string | null; threadId: string | null }>> => {
  const found = await findByMessageId(handle, 'SENT');
  return found ? { state: 'found', externalRef: found.id, result: resultFrom(found) } : { state: 'unknown' };
};
const draftReconciler = async (handle: RunningOperation): Promise<ReconcileOutcome<{ draft: DraftView }>> => {
  const listed = await googleJson<{ drafts?: { id: string }[] }>(handle.connection, { service: 'gmail', path: `${root}/drafts`,
    query: { q: `rfc822msgid:${messageId(handle)}`, maxResults: 10 }, maxBytes: 100_000 });
  for (const candidate of listed.drafts ?? []) {
    const draft = await fetchDraft(handle.connection, candidate.id);
    if (gmailHeader(draft.message.payload, 'Message-ID') === messageId(handle))
      return { state: 'found', externalRef: draft.id, result: { draft: draftView(draft) } };
  }
  return { state: 'unknown' };
};
const gmailDraftReconciler: Reconciler = async handle => {
  if (handle.args.__gmailKind === 'delete') {
    const draftId = String(handle.args.draftId ?? '');
    try { await fetchDraft(handle.connection, draftId); return { state: 'unknown' }; }
    catch (error) {
      if ((error as { status?: number }).status === 404)
        return { state: 'found', externalRef: draftId, result: { success: true } };
      throw error;
    }
  }
  return draftReconciler(handle);
};
/** A sent Gmail draft no longer exists, so idempotent replay must precede loading its content. */
async function completedOrUnknown<T>(context: WorkspaceContext, connection: ConnectionRow,
  capability: string, input: { approvalId?: string; idempotencyKey?: string; [key: string]: unknown }): Promise<{ operation: ReturnType<typeof operationDto>; result: T | null } | null> {
  const key = input.approvalId ? `approval:${input.approvalId}` : input.idempotencyKey ? `key:${input.idempotencyKey}` : null;
  if (!key) return null;
  const { approvalId: _approvalId, idempotencyKey: _idempotencyKey, ...args } = input;
  void _approvalId; void _idempotencyKey;
  let row = await database.prepare(`SELECT * FROM google_operation WHERE office_id=? AND user_id=? AND idempotency_key=?`)
    .get<OperationRecord>(context.officeId, context.userId, key);
  if (!row) return null;
  if (row.capability_name !== capability || row.connection_id !== connection.id ||
    row.request_hash !== digest({ capability, args }))
    throw new CapabilityError('CONFLICT', 'Esta chave de idempotência pertence a outra operação ou conexão.');
  if (row.status === 'unknown') {
    await reconcileOperationById(row.id, gmailReconcilers);
    row = (await database.prepare('SELECT * FROM google_operation WHERE id=? AND office_id=? AND user_id=?')
      .get<OperationRecord>(row.id, context.officeId, context.userId))!;
  }
  if (row.status === 'succeeded' || row.status === 'unknown')
    return { operation: operationDto(row), result: row.status === 'succeeded' ? operationResult<T>(row) : null };
  if (row.status === 'pending' || row.status === 'running')
    throw new CapabilityError('CONFLICT', 'A operação ainda está em andamento.');
  return null;
}
export async function sendMail(context: WorkspaceContext, input: Input<'k5_gmail_send'>): Promise<Output<'k5_gmail_send'>> {
  const connection = await requireConnection(context, 'gmail');
  const replay = await completedOrUnknown<{ messageId: string | null; threadId: string | null }>(context, connection, 'k5_gmail_send', input);
  if (replay) return { messageId: replay.result?.messageId ?? null, threadId: replay.result?.threadId ?? null, operation: replay.operation };
  const prepared = await prepare(context, connection, input);
  mimeMessage({ ...prepared, from: connection.email, messageId: '<preview@mail.lume.invalid>', files: prepared.files,
    replyHeader: prepared.replyHeader ?? undefined, references: prepared.references ?? undefined, threadId: prepared.threadId ?? undefined });
  const snapshot = review(prepared, connection.email);
  const outcome = await runGoogleOperation<{ messageId: string | null; threadId: string | null }>(context, {
    module: 'gmail', actions: prepared.files.length ? ['gmail.send', 'gmail.send_attachments'] : ['gmail.send'],
    capabilityName: 'k5_gmail_send', input, bound: snapshot,
    effectKey: prepared.draftId ? `draft:${prepared.draftId}` : `mail:${digest(snapshot)}`,
    metrics: { recipients: prepared.to.length + prepared.cc.length + prepared.bcc.length,
      attachments: prepared.files.length, attachmentBytes: prepared.files.reduce((n, f) => n + f.data.length, 0) },
    describe: `Enviar e-mail para ${[...prepared.to, ...prepared.cc, ...prepared.bcc].join(', ')}: ${prepared.subject}`,
    execute: async handle => {
      await assertDraftVersion(handle.connection, prepared);
      const raw = rawFor(handle, prepared).raw;
      const message = await googleJson<{ id: string; threadId?: string }>(handle.connection, { service: 'gmail', method: 'POST',
        path: prepared.draftId ? `${root}/drafts/send` : `${root}/messages/send`,
        json: prepared.draftId ? { id: prepared.draftId, message: { raw, ...(prepared.threadId ? { threadId: prepared.threadId } : {}) } }
          : { raw, ...(prepared.threadId ? { threadId: prepared.threadId } : {}) }, maxBytes: 200_000, timeoutMs: 30_000 });
      return { externalRef: message.id, result: resultFrom(message) };
    }, reconcile: sendReconciler,
  });
  return { messageId: outcome.result?.messageId ?? null, threadId: outcome.result?.threadId ?? null, operation: outcome.operation };
}
export async function saveDraft(context: WorkspaceContext, input: Input<'k5_gmail_save_draft'>): Promise<Output<'k5_gmail_save_draft'>> {
  const connection = await requireConnection(context, 'gmail');
  const replay = await completedOrUnknown<{ draft: DraftView }>(context, connection, 'k5_gmail_save_draft', input);
  if (replay) return { draft: replay.result?.draft ?? null, operation: replay.operation };
  const prepared = await prepare(context, connection, input);
  mimeMessage({ ...prepared, from: connection.email, messageId: '<preview@mail.lume.invalid>', files: prepared.files,
    replyHeader: prepared.replyHeader ?? undefined, references: prepared.references ?? undefined, threadId: prepared.threadId ?? undefined,
    allowNoRecipients: true });
  const outcome = await runGoogleOperation<{ draft: DraftView }>(context, { module: 'gmail', actions: ['gmail.draft'], capabilityName: 'k5_gmail_save_draft',
    input, bound: review(prepared, connection.email), effectKey: prepared.draftId ? `draft:${prepared.draftId}` : undefined,
    metrics: { recipients: prepared.to.length + prepared.cc.length + prepared.bcc.length, attachments: prepared.files.length,
      attachmentBytes: prepared.files.reduce((n, f) => n + f.data.length, 0) },
    describe: `Salvar rascunho: ${prepared.subject}`,
    execute: async handle => {
      await assertDraftVersion(handle.connection, prepared);
      const raw = rawFor(handle, prepared, true).raw;
      const draft = await googleJson<Draft>(handle.connection, { service: 'gmail', method: prepared.draftId ? 'PUT' : 'POST',
        path: prepared.draftId ? `${root}/drafts/${idPath(prepared.draftId)}` : `${root}/drafts`,
        json: { ...(prepared.draftId ? { id: prepared.draftId } : {}), message: { raw, ...(prepared.threadId ? { threadId: prepared.threadId } : {}) } },
        maxBytes: 200_000, timeoutMs: 30_000 });
      await markOperationEffect(handle, { draftId: draft.id });
      return { externalRef: draft.id, result: { draft: draftView(await fetchDraft(handle.connection, draft.id)) } };
    }, reconcile: draftReconciler,
  });
  return { draft: outcome.result?.draft ?? null, operation: outcome.operation };
}
export async function deleteDraft(context: WorkspaceContext, input: Input<'k5_gmail_delete_draft'>): Promise<Output<'k5_gmail_delete_draft'>> {
  const connection = await requireConnection(context, 'gmail');
  const replay = await completedOrUnknown<{ success: boolean }>(context, connection, 'k5_gmail_delete_draft', {
    ...input, __gmailKind: 'delete' });
  if (replay) return { success: replay.operation.status === 'succeeded' && Boolean(replay.result?.success) };
  const draft = await fetchDraft(connection, input.draftId);
  const view = draftView(draft);
  const version = versionOfDraft(draft);
  const outcome = await runGoogleOperation(context, { module: 'gmail', actions: ['gmail.draft'], capabilityName: 'k5_gmail_delete_draft',
    input: { ...input, __gmailKind: 'delete' }, effectKey: `draft:${input.draftId}`, describe: `Excluir rascunho: ${view.subject}`,
    bound: { draftId: input.draftId, version, to: view.to, cc: view.cc, bcc: view.bcc, subject: view.subject, body: view.body,
      attachments: view.attachments,
      review: [{ label: 'Rascunho', value: input.draftId }, { label: 'Para', value: view.to.join(', ') },
        { label: 'Cc', value: view.cc.join(', ') }, { label: 'Cco', value: view.bcc.join(', ') },
        { label: 'Assunto', value: view.subject }, { label: 'Corpo', value: view.body },
        { label: 'Anexos', value: view.attachments.map(a => `${a.filename} (${a.size} bytes)`).join('; ') || 'Nenhum' },
        { label: 'Versão', value: version }] },
    execute: async handle => { if (versionOfDraft(await fetchDraft(handle.connection, input.draftId)) !== version)
        throw new CapabilityError('CONFLICT', 'O rascunho mudou no Gmail. Revise antes de excluir.');
      await googleJson(handle.connection, { service: 'gmail', method: 'DELETE', path: `${root}/drafts/${idPath(input.draftId)}` });
      return { result: { success: true } }; },
    reconcile: gmailDraftReconciler,
  });
  return { success: outcome.operation.status === 'succeeded' };
}
export async function importAttachment(context: WorkspaceContext, input: Input<'k5_gmail_import_attachment'>): Promise<Output<'k5_gmail_import_attachment'>> {
  const connection = await requireConnection(context, 'gmail');
  const message = await googleJson<GmailMessage>(connection, { service: 'gmail', path: `${root}/messages/${idPath(input.messageId)}`,
    query: { format: 'full' }, maxBytes: 12_000_000 });
  const part = attachmentParts(message).find(p => p.partId === input.partId);
  if (!part || part.size <= 0 || part.size > 50 * 1024 * 1024) throw new CapabilityError('NOT_FOUND', 'Anexo não encontrado ou incompatível.');
  const { queueGmailAttachmentImport } = await import('../drive/import');
  return queueGmailAttachmentImport(context, { ...input, sourceName: part.filename, sourceMimeType: part.mimeType,
    sourceVersion: message.internalDate ?? null });
}
export const gmailReconcilers: Partial<Record<GoogleAction, Reconciler>> = {
  'gmail.send': sendReconciler, 'gmail.send_attachments': sendReconciler, 'gmail.draft': gmailDraftReconciler,
};
export { createMailUpload, sweepExpiredMailUploads } from './uploads';
