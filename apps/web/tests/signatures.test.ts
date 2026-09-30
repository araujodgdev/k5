import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as signatures from '../src/lib/signatures/service';
import * as portal from '../src/lib/client-portal/service';
import { objectStorage, resetObjectStorageForTests } from '../src/lib/storage';
import type { WorkspaceContext } from '../src/lib/application/context';
import type { SignatureTransport } from '../src/lib/signatures/zapsign';
import { ZapSign } from '../src/lib/signatures/zapsign';
import { processNextSignatureWebhook } from '../src/lib/signatures/webhooks';
import { dueProcessors } from '../src/lib/processor-schedule';

async function fixture() {
  const context: WorkspaceContext = { officeId: randomUUID(), userId: randomUUID(), role: 'administrator' }, clientId = randomUUID(), clientUserId = randomUUID(), accessId = randomUUID();
  const client: portal.ClientContext = { userId: clientUserId, sessionId: randomUUID() }, email = `${clientUserId}@client.test`;
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(context.userId, `${context.userId}@office.test`, 'Ana Advogada');
  await testDb.prepare('INSERT INTO "user"(id,email,name,accountKind) VALUES(?,?,?,?)').run(clientUserId, email, 'Maria Cliente', 'client');
  await testDb.prepare('INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL \'1 hour\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(client.sessionId, clientUserId, randomUUID());
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(context.officeId, 'Escritório Ana');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), context.officeId, context.userId, context.role);
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, context.officeId, 'Maria Cliente');
  await testDb.prepare('INSERT INTO client_portal_access(id,office_id,client_id,email,user_id,invited_by,accepted_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(accessId, context.officeId, clientId, email, clientUserId, context.userId);
  await signatures.saveSignatureConnection(context, { apiKey: 'synthetic-private-api-key', environment: 'sandbox', enabled: true, version: 0 });
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const file = await portal.publishPortalFile(context, clientId, new File([bytes], 'contrato.pdf', { type: 'application/pdf' }), randomUUID());
  return { context, clientId, client, accessId, email, bytes, fileId: file.id };
}
function provider(f: Awaited<ReturnType<typeof fixture>>) {
  let document: Record<string, unknown> | null = null, posts = 0, getFileCalls = 0;
  const remoteToken = randomUUID(), signerToken = randomUUID(), signedBytes = Buffer.concat([f.bytes, Buffer.from('\n% provider signature evidence')]);
  const transport: SignatureTransport = { fetch: async (url, options) => {
    if (String(url).startsWith('https://zapsign.s3.amazonaws.com/')) {
      getFileCalls++; assert.equal(options?.headers, undefined, 'API credentials must never go to storage');
      return new Response(new Uint8Array(String(url).includes('original') ? f.bytes : signedBytes));
    }
    assert.match(String(url), /^https:\/\/sandbox.zapsign.com.br\/api\/v1\/docs\//);
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic-private-api-key');
    assert.equal(options?.redirect, 'manual');
    if (options?.method === 'POST') {
      posts++; const body = JSON.parse(String(options.body)); assert.equal(body.base64_pdf, f.bytes.toString('base64')); assert.equal(body.url_pdf, undefined);
      assert.equal(body.signers[0].email, f.email); assert.equal(body.signers[0].lock_email, true); assert.equal(body.signers[0].send_automatic_email, true);
      document = { token: remoteToken, external_id: body.external_id, sandbox: true, status: 'pending', deleted: false,
        original_file: 'https://zapsign.s3.amazonaws.com/original.pdf', signed_file: null,
        signers: [{ token: signerToken, name: body.signers[0].name, email: f.email, auth_mode: body.signers[0].auth_mode, status: 'new', signed_at: null,
          sign_url: `https://sandbox.app.zapsign.com.br/verificar/${signerToken}` }] };
    }
    assert.ok(document);
    if (options?.method === 'DELETE') document = { ...document, deleted: true };
    return Response.json(document);
  } };
  return { transport, remoteToken, signedBytes, posts: () => posts, fileCalls: () => getFileCalls, document: () => document,
    change: (value: Record<string, unknown>) => { assert.ok(document); document = { ...document, ...value }; },
    complete: () => { assert.ok(document); const signers = document.signers as Record<string, unknown>[];
      document = { ...document, status: 'signed', signed_file: 'https://zapsign.s3.amazonaws.com/signed.pdf', signers: [{ ...signers[0], status: 'signed', signed_at: '2026-09-29T18:00:00Z' }] }; } };
}
const request = (f: Awaited<ReturnType<typeof fixture>>) => ({ clientId: f.clientId, fileId: f.fileId, method: 'email' as const, idempotencyKey: randomUUID() });
async function webhookPost(request: Request) {
  process.env.BETTER_AUTH_SECRET ??= randomBytes(48).toString('base64url');
  const { POST } = await import('../src/app/api/signatures/webhook/route'); return POST(request);
}
async function webhook(f: Awaited<ReturnType<typeof fixture>>, document: unknown, url?: string) {
  const target = url ?? (await signatures.getSignatureConnection(f.context)).webhookUrl;
  assert.ok(target); return webhookPost(new Request(target, { method: 'POST', body: JSON.stringify(document) }));
}

test('ZapSign uses the redirect mode accepted by Workers and never follows a redirect with credentials or PDF access', async () => {
  let calls = 0;
  const provider = new ZapSign({ apiKey: 'synthetic-private-api-key', environment: 'sandbox' }, { fetch: async (_url, options) => {
    calls++; assert.equal(options?.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://other.test/collect' } });
  } });
  await assert.rejects(provider.detail(randomUUID()), { code: 'NOT_READY' });
  await assert.rejects(provider.pdf('https://zapsign.s3.amazonaws.com/signed.pdf'), { code: 'NOT_READY' });
  assert.equal(calls, 2);
});

test('signature sends immutable private PDF once, checks the provider and archives bytes and audit evidence', async () => {
  const f = await fixture(), p = provider(f), input = request(f);
  await Promise.all([signatures.requestSignature(f.context, input, p.transport), signatures.requestSignature(f.context, input, p.transport)]);
  assert.equal(p.posts(), 1);
  const row = (await signatures.managedSignatures(f.context, f.clientId)).signatures[0]; assert.equal(row.state, 'pending'); assert.equal(row.signUrl, null);
  const own = (await signatures.clientSignatures(f.client, f.accessId)).signatures[0]; assert.match(own.signUrl ?? '', /sandbox.app.zapsign.com.br/); assert.equal(own.providerToken, null);
  await assert.rejects(signatures.downloadClientSignature(f.client, f.accessId, row.id, 'pdf'), { code: 'NOT_READY' });
  p.complete(); const synced = await signatures.refreshClientSignature(f.client, f.accessId, row.id, p.transport);
  assert.equal(synced.signatures[0].state, 'signed'); assert.ok(synced.signatures[0].downloadUrl); assert.equal(synced.signatures[0].signUrl, null);
  assert.deepEqual((await signatures.downloadManagedSignature(f.context, f.clientId, row.id, 'pdf')).bytes, p.signedBytes);
  const evidence = JSON.parse((await signatures.downloadClientSignature(f.client, f.accessId, row.id, 'evidence')).bytes.toString());
  assert.equal(evidence.providerToken, p.remoteToken); assert.ok(evidence.originalSha256); assert.ok(evidence.signedSha256); assert.ok(evidence.events.some((item: { event: string }) => item.event === 'archived'));
  assert.equal(JSON.stringify(evidence).includes('synthetic-private-api-key'), false);
  p.change({ signed_file: 'https://zapsign.s3.amazonaws.com/changed.pdf' });
  await signatures.refreshManagedSignature(f.context, f.clientId, row.id, p.transport); assert.equal(p.fileCalls(), 1, 'archived signatures remain immutable');
  const encrypted = await testDb.prepare('SELECT encrypted_sign_url FROM signature_request WHERE id=?').get<{ encrypted_sign_url: string }>(row.id); assert.ok(encrypted);
  assert.equal(encrypted.encrypted_sign_url.includes('verificar'), false);
});

test('an ambiguous create never sends again; recovery binds the external ID, recipient, method and original bytes', async () => {
  const f = await fixture(), p = provider(f), input = request(f);
  const uncertain: SignatureTransport = { fetch: async (url, options) => { await p.transport.fetch(url, options); throw new TypeError('lost response'); } };
  const result = await signatures.requestSignature(f.context, input, uncertain), row = result.signatures[0]; assert.equal(row.state, 'uncertain');
  await signatures.requestSignature(f.context, input, p.transport); assert.equal(p.posts(), 1);
  p.change({ external_id: randomUUID() }); await assert.rejects(signatures.recoverSignature(f.context, f.clientId, row.id, p.remoteToken, p.transport), { code: 'NOT_READY' });
  p.change({ external_id: row.id, original_file: 'https://127.0.0.1/private.pdf' });
  await assert.rejects(signatures.recoverSignature(f.context, f.clientId, row.id, p.remoteToken, p.transport), { code: 'NOT_READY' }); assert.equal(p.fileCalls(), 0);
  p.change({ original_file: 'https://zapsign.s3.amazonaws.com/original.pdf' });
  const recovered = await signatures.recoverSignature(f.context, f.clientId, row.id, p.remoteToken, p.transport); assert.equal(recovered.signatures[0].state, 'pending');
  await signatures.cancelSignature(f.context, f.clientId, row.id, p.transport); assert.equal((await signatures.clientSignatures(f.client, f.accessId)).signatures[0].state, 'cancelled');
});

test('certificate mode, office isolation, live roles and disabled connections', async () => {
  const f = await fixture(), other = await fixture(), p = provider(f), input = { ...request(f), method: 'certificate' as const };
  await assert.rejects(signatures.requestSignature(other.context, input, p.transport), { code: 'NOT_FOUND' });
  await signatures.requestSignature(f.context, input, p.transport);
  const row = (await signatures.managedSignatures(f.context, f.clientId)).signatures[0]; assert.equal(row.method, 'certificate');
  await assert.rejects(signatures.clientSignatures(other.client, f.accessId), { code: 'NOT_FOUND' });
  await assert.rejects(signatures.downloadManagedSignature(other.context, f.clientId, row.id, 'evidence'), { code: 'NOT_FOUND' });
  await testDb.prepare("UPDATE office_member SET role='reviewer' WHERE office_id=? AND user_id=?").run(f.context.officeId, f.context.userId);
  await assert.rejects(signatures.refreshManagedSignature(f.context, f.clientId, row.id, p.transport), { code: 'FORBIDDEN' });
  await testDb.prepare("UPDATE office_member SET role='administrator' WHERE office_id=? AND user_id=?").run(f.context.officeId, f.context.userId);
  await signatures.saveSignatureConnection(f.context, { environment: 'sandbox', enabled: false, version: 1 });
  const extra = await portal.publishPortalFile(f.context, f.clientId, new File([f.bytes], 'proposta.pdf', { type: 'application/pdf' }), randomUUID());
  await assert.rejects(signatures.requestSignature(f.context, { ...request(f), fileId: extra.id }, p.transport), { code: 'NOT_READY' });
});

test('revoking access during a private signed PDF read blocks completion and a replacement email cannot get the signature link', async () => {
  const f = await fixture(), p = provider(f); const { signatures: [row] } = await signatures.requestSignature(f.context, request(f), p.transport);
  p.complete(); await signatures.refreshManagedSignature(f.context, f.clientId, row.id, p.transport);
  const storage = await objectStorage(); let entered!: () => void, resume!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; }), release = new Promise<void>(resolve => { resume = resolve; });
  resetObjectStorageForTests({ put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async key => { entered(); await release; return storage.get(key); } });
  try {
    const download = signatures.downloadClientSignature(f.client, f.accessId, row.id, 'pdf'); await reading;
    await portal.revokePortal(f.context, { clientId: f.clientId, version: 1 }); resume(); await assert.rejects(download, { code: 'NOT_FOUND' });
  } finally { resume(); resetObjectStorageForTests(storage); }
  await portal.invitePortal(f.context, { clientId: f.clientId, email: 'new@client.test', version: 2 });
  await testDb.prepare('UPDATE client_portal_access SET user_id=?,accepted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.client.userId, f.accessId);
  assert.equal((await signatures.clientSignatures(f.client, f.accessId)).signatures.length, 0);
});

test('webhook authenticates its office, ignores unrelated documents and only API-confirmed bytes can become signed', async () => {
  const f = await fixture(), other = await fixture(), p = provider(f);
  const { signatures: [row] } = await signatures.requestSignature(f.context, request(f), p.transport);
  const config = await signatures.getSignatureConnection(f.context); assert.ok(config.webhookUrl);
  await testDb.prepare("UPDATE office_member SET role='reviewer' WHERE office_id=? AND user_id=?").run(f.context.officeId, f.context.userId);
  assert.equal((await signatures.getSignatureConnection(f.context)).webhookUrl, null);
  await testDb.prepare("UPDATE office_member SET role='administrator' WHERE office_id=? AND user_id=?").run(f.context.officeId, f.context.userId);
  const body = { event_type: 'doc_signed', token: p.remoteToken, external_id: row.id, sandbox: true, status: 'signed', signed_file: 'https://other.test/forged.pdf' };
  assert.equal((await webhook(f, body, 'https://localhost/api/signatures/webhook')).status, 401);
  assert.equal((await webhook(f, body, config.webhookUrl.replace(/secret=.*/, 'secret=' + 'a'.repeat(43)))).status, 401);
  assert.equal((await webhook(other, body)).status, 200);
  assert.equal((await webhook(f, { ...body, sandbox: false })).status, 200);
  assert.equal((await webhook(f, { ...body, external_id: randomUUID() })).status, 200);
  assert.equal((await webhook(f, { event_type: 'signature_notification_sent' })).status, 200);
  assert.equal((await testDb.prepare('SELECT count(*) AS count FROM signature_webhook_job').get<{ count: number }>())?.count, 0);
  const received = await Promise.all([webhook(f, body), webhook(f, body)]); assert.ok(received.every(response => response.status === 200));
  const queued = await testDb.prepare('SELECT generation,state FROM signature_webhook_job WHERE request_id=?').get<{ generation: number; state: string }>(row.id);
  assert.deepEqual(queued, { generation: 1, state: 'pending' });
  assert.equal((await dueProcessors(testDb, Date.now(), false)).documents, true);
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'pending');
  await processNextSignatureWebhook(p.transport);
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'pending', 'the webhook body cannot assert a signature');
  const deferred = await testDb.prepare('SELECT state,last_error,run_after>CURRENT_TIMESTAMP AS delayed FROM signature_webhook_job WHERE request_id=?')
    .get<{ state: string; last_error: string; delayed: boolean }>(row.id);
  assert.deepEqual(deferred, { state: 'pending', last_error: 'awaiting_provider', delayed: true });
  await webhook(f, { ...body, event_type: 'doc_created', status: 'pending' });
  await processNextSignatureWebhook(p.transport);
  assert.deepEqual(await testDb.prepare('SELECT event_type,state,last_error FROM signature_webhook_job WHERE request_id=?').get(row.id),
    { event_type: 'doc_signed', state: 'pending', last_error: 'awaiting_provider' }, 'late creation events must preserve reconciliation of an unconfirmed signature');
  p.complete(); await testDb.prepare('UPDATE signature_webhook_job SET run_after=CURRENT_TIMESTAMP WHERE request_id=?').run(row.id);
  await processNextSignatureWebhook(p.transport);
  assert.deepEqual((await signatures.downloadManagedSignature(f.context, f.clientId, row.id, 'pdf')).bytes, p.signedBytes);
  const evidence = JSON.parse((await signatures.downloadManagedSignature(f.context, f.clientId, row.id, 'evidence')).bytes.toString());
  assert.equal(evidence.events.filter((item: { event: string }) => item.event === 'archived').length, 1);
  assert.ok(evidence.events.some((item: { details: { source?: string } }) => item.details.source === 'webhook'));
  await webhook(f, { ...body, event_type: 'doc_created', status: 'pending' }); assert.equal(await processNextSignatureWebhook(p.transport), false);
  const tooLarge = await webhookPost(new Request(config.webhookUrl, { method: 'POST', body: JSON.stringify({ ...body, padding: 'x'.repeat(512_000) }) }));
  assert.equal(tooLarge.status, 413);
});

test('a webhook recovers a lost create response without sending a second document', async () => {
  const f = await fixture(), p = provider(f), input = request(f);
  const lost: SignatureTransport = { fetch: async (url, options) => { await p.transport.fetch(url, options); throw new TypeError('lost response'); } };
  const { signatures: [row] } = await signatures.requestSignature(f.context, input, lost);
  assert.equal(row.state, 'uncertain'); p.complete();
  const body = { event_type: 'doc_signed', token: p.remoteToken, external_id: row.id, sandbox: true, status: 'signed' };
  p.change({ external_id: randomUUID() }); await webhook(f, body); await processNextSignatureWebhook(p.transport);
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'uncertain');
  p.change({ external_id: row.id }); await testDb.prepare('UPDATE signature_webhook_job SET run_after=CURRENT_TIMESTAMP WHERE request_id=?').run(row.id);
  await processNextSignatureWebhook(p.transport);
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'signed'); assert.equal(p.posts(), 1);
});

test('an event that supersedes a paused webhook lease prevents its PDF from being published', async () => {
  const f = await fixture(), p = provider(f); const { signatures: [row] } = await signatures.requestSignature(f.context, request(f), p.transport);
  p.complete(); const body = { event_type: 'doc_signed', token: p.remoteToken, external_id: row.id, sandbox: true, status: 'signed' };
  await webhook(f, body);
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), release = new Promise<void>(resolve => { resume = resolve; });
  const paused: SignatureTransport = { fetch: async (url, options) => {
    if (String(url).includes('signed.pdf')) { entered(); await release; } return p.transport.fetch(url, options);
  } };
  const processing = processNextSignatureWebhook(paused); await started;
  await webhook(f, { ...body, event_type: 'doc_created', status: 'pending' }); resume(); await processing;
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'pending');
  await assert.rejects(signatures.downloadManagedSignature(f.context, f.clientId, row.id, 'pdf'), { code: 'NOT_READY' });
  await processNextSignatureWebhook(p.transport);
  assert.equal((await signatures.managedSignatures(f.context, f.clientId)).signatures[0].state, 'signed');
});
