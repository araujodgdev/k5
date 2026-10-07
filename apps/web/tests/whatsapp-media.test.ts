import { FakeWhatsApp, testDb, whatsappFixture, whatsappIdentity, whatsappJson, whatsappThread } from './whatsapp-send-fixture';
import {personRequestContext,recordingWriter} from './shared-writing-fixture';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { withTransaction } from '../src/lib/database';
import { uploadWhatsAppAttachment, readWhatsAppAttachment, type AttachmentRow } from '../src/lib/whatsapp/media';
import { sendWhatsAppText } from '../src/lib/whatsapp/send';
import { readThread } from '../src/lib/whatsapp/history';
import { providerAttachment, providerAttachmentSchema } from '../src/lib/whatsapp/provider';
import { withWhatsAppTransport, zernioMediaBytes } from '../src/lib/whatsapp/transport';
import { projectMessage, type MessageProjection } from '../src/lib/whatsapp/projection';
import { runWhatsAppPass } from '../src/lib/whatsapp/worker';
import { validateWhatsAppFile } from '../src/lib/whatsapp/media-validation';
import { validateOfficeZip } from '../src/lib/file-preview-validation';
import type { ConnectionRow } from '../src/lib/whatsapp/domain';
import { approveProposal, approvalIdFromMessage, getApprovalProposal } from '../src/lib/application/approvals-service';
import { CapabilityError } from '../src/lib/capabilities/errors';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const file = () => new File([new Uint8Array(png)], 'foto.png', { type: 'image/png' });
afterEach(async () => { await testDb.prepare("UPDATE whatsapp_job SET status='done',locked_until=NULL WHERE status IN ('queued','running')").run(); });

test('private upload is author-only until sent; office, account, generation and session are checked', async () => {
  const fixture = await whatsappFixture(), other = await whatsappFixture();
  const disconnected = await whatsappIdentity();
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file());
    assert.ok(uploaded.id); assert.equal(uploaded.state, 'ready'); assert.equal(uploaded.byteLength, png.length);
    assert.equal('storageKey' in uploaded, false);
    await assert.rejects(readWhatsAppAttachment(other.context, uploaded.id), { code: 'NOT_FOUND' });
    await assert.rejects(readWhatsAppAttachment(disconnected.context, uploaded.id), { code: 'NOT_READY' });
    await assert.rejects(uploadWhatsAppAttachment(disconnected.context, fixture.threadId, file()), { code: 'NOT_READY' });
    await assert.rejects(readWhatsAppAttachment({ ...other.context, officeId: fixture.officeId }, uploaded.id), { code: 'FORBIDDEN' });
    await assert.rejects(uploadWhatsAppAttachment(other.context, fixture.threadId, file()), { code: 'NOT_FOUND' });
    const range = await readWhatsAppAttachment(fixture.context, uploaded.id, { range: 'bytes=0-7' });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-7/${png.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(0, 8));
    assert.equal((await readWhatsAppAttachment(fixture.context, uploaded.id, { range: 'bytes=0-1,4-5' })).status, 416);
    assert.equal((await readWhatsAppAttachment(fixture.context, uploaded.id, { range: 'bytes=-0' })).status, 416);
    provider.enabled = false;
    await assert.rejects(readWhatsAppAttachment(fixture.context, uploaded.id), { code: 'NOT_FOUND' });
    provider.enabled = true;
    await testDb.prepare('UPDATE whatsapp_connection SET generation=generation+1 WHERE id=?').run(fixture.connectionId);
    await assert.rejects(readWhatsAppAttachment(fixture.context, uploaded.id), { code: 'NOT_FOUND' });
    await testDb.prepare('DELETE FROM session WHERE id=?').run(fixture.sessionId);
    await assert.rejects(readWhatsAppAttachment(fixture.context, uploaded.id), { code: 'UNAUTHENTICATED' });
  });
});

test('multipart sends exact immutable bytes once and keeps authorized local preview before provider echo', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  const colleague = await whatsappFixture();
  await testDb.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?),(?,?,?)')
    .run(fixture.officeId, colleague.userId, fixture.userId, colleague.officeId, fixture.userId, fixture.userId);
  let uploads = 0;
  await provider.run(() => withWhatsAppTransport(async (url, init) => {
    if (init?.body instanceof FormData) {
      uploads += 1;
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${fixture.profileKey}`);
      assert.equal(new Headers(init.headers).has('content-type'), false);
      assert.equal(init.body.get('accountId'), fixture.accountId); assert.equal(init.body.get('message'), 'Documento recebido.');
      const sent = init.body.get('attachment'); assert.ok(sent instanceof File);
      assert.equal(sent.name, 'foto.png'); assert.equal(sent.type, 'image/png'); assert.deepEqual(Buffer.from(await sent.arrayBuffer()), png);
    }
    return provider.fetch(url, init);
  }, async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    await assert.rejects(readWhatsAppAttachment(colleague.context, uploaded.id), { code: 'NOT_FOUND' });
    const input = { threadId: fixture.threadId, text: 'Documento recebido.', attachmentId: uploaded.id, idempotencyKey: randomUUID() };
    const results = await Promise.all(Array.from({ length: 4 }, () => sendWhatsAppText(fixture.context, input)));
    assert.equal(new Set(results.map(result => result.id)).size, 1); assert.equal(uploads, 1);
    assert.equal((await sendWhatsAppText(fixture.context, input)).status, 'accepted');
    assert.deepEqual(Buffer.from(await (await readWhatsAppAttachment(fixture.context, uploaded.id)).arrayBuffer()), png);
    await assert.rejects(readWhatsAppAttachment(colleague.context, uploaded.id), { code: 'NOT_FOUND' });
    await assert.rejects(readThread(colleague.context, { threadId: fixture.threadId, limit: 10 }), { code: 'NOT_FOUND' });
    const page = await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 });
    assert.equal(page.items[0]?.attachments[0]?.id, uploaded.id);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
    const second = await whatsappThread(fixture);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, threadId: second.threadId, idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
    const connection = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(fixture.connectionId); assert.ok(connection);
    const at = new Date(Date.now() - 1000).toISOString();
    await withTransaction(tx => projectMessage(tx, connection, { kind: 'sent', providerId: provider.messageId,
      thread: { providerId: fixture.providerThreadId, participantId: fixture.participantId, participantName: 'Pessoa' },
      direction: 'outbound', source: 'provider', text: input.text, status: 'sent', deleted: false, edited: false,
      attachments: [{ kind: 'image', filename: 'foto.png', mimeType: 'image/png' }], unread: false, createdAt: at, contentUpdatedAt: at }));
    assert.equal((await sendWhatsAppText(fixture.context, input)).status, 'sent');
    assert.equal((await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 })).items[0]?.attachments[0]?.id, uploaded.id);
    assert.deepEqual(Buffer.from(await (await readWhatsAppAttachment(fixture.context, uploaded.id)).arrayBuffer()), png);
  }));
});

test('agent approval binds the attachment digest, filename, type, bytes and admitted caption', async t => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    const input = { threadId: fixture.threadId, text: 'Legenda aprovada', attachmentId: uploaded.id, idempotencyKey: randomUUID() };
    const agent = await personRequestContext({ ...fixture.context, invocation: 'agent' as const },'Encaminhe a imagem com a legenda aprovada.');
    const wire=await recordingWriter(t,fixture.userId,[{title:'Mensagem',content:'Legenda aprovada'}]);
    let approvalId = '';
    try { await sendWhatsAppText(agent, input); assert.fail('human approval required'); }
    catch (error) { assert.ok(error instanceof CapabilityError); assert.equal(error.code, 'APPROVAL_REQUIRED'); approvalId = approvalIdFromMessage(error.message) ?? ''; }
    assert.ok(approvalId);
    const proposal = await getApprovalProposal(fixture.context, approvalId); assert.ok(proposal);
    const original=await testDb.prepare('SELECT sha256 FROM whatsapp_attachment WHERE id=?').get<{sha256:string}>(uploaded.id);assert.ok(original);
    assert.match(proposal.normalized_input, /sha256/); assert.match(proposal.normalized_input, /foto.png/);
    await approveProposal(fixture.context, approvalId);
    await testDb.prepare('UPDATE whatsapp_attachment SET sha256=? WHERE id=?').run('b'.repeat(64),uploaded.id);
    await assert.rejects(sendWhatsAppText(agent, { ...input, approvalId }), { code: 'FORBIDDEN' });
    await testDb.prepare('UPDATE whatsapp_attachment SET sha256=? WHERE id=?').run(original.sha256,uploaded.id);
    assert.equal(provider.sends.length, 0);
    assert.equal((await sendWhatsAppText(agent, { ...input, text:'PRIVATE_PLANNER_CHANGED', approvalId })).status, 'accepted');
    assert.equal(wire.length,1);assert.doesNotMatch(JSON.stringify(provider.sends),/PRIVATE_PLANNER_CHANGED/);
  });
});

test('definite provider refusal releases the same private file for a corrected new intent', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    const input = { threadId: fixture.threadId, text: 'Legenda inicial', attachmentId: uploaded.id, idempotencyKey: randomUUID() };
    provider.on('POST', provider.sendPath, () => whatsappJson({ error: 'rejected' }, 400));
    const failed = await sendWhatsAppText(fixture.context, input); assert.equal(failed.status, 'failed');
    assert.equal((await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 })).items[0]?.attachments[0]?.id, uploaded.id);
    assert.equal((await testDb.prepare('SELECT send_id FROM whatsapp_attachment WHERE id=?').get<{ send_id: string | null }>(uploaded.id))?.send_id, null);
    provider.on('POST', provider.sendPath, () => whatsappJson({ success: true, data: { messageId: 'accepted-corrected-file' } }));
    const corrected = await sendWhatsAppText(fixture.context, { ...input, text: 'Legenda corrigida', idempotencyKey: randomUUID() });
    assert.equal(corrected.status, 'accepted'); assert.equal(provider.sends.length, 2);
    assert.deepEqual(await sendWhatsAppText(fixture.context, input), failed);
    const page = await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 });
    assert.equal(page.items.length, 2); assert.equal(page.items.every(item => item.attachments[0]?.id === uploaded.id), true);
  });
});

test('expired uploads, excessive captions and audio captions are rejected before dispatch', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    const input = { threadId: fixture.threadId, text: 'a'.repeat(1025), attachmentId: uploaded.id, idempotencyKey: randomUUID() };
    await assert.rejects(sendWhatsAppText(fixture.context, input));
    await testDb.prepare("UPDATE whatsapp_attachment SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE id=?").run(uploaded.id);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, text: '' }), { code: 'CONFLICT' });
    const audio = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, new File([Buffer.from('#!AMR\nexample')], 'audio.amr', { type: 'audio/amr' })); assert.ok(audio.id);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, text: 'Não pode ser descartado', attachmentId: audio.id }), { code: 'INVALID' });
    assert.equal(provider.sends.length, 0);
  });
});

async function seedMedia(fixture: Awaited<ReturnType<typeof whatsappFixture>>) {
  const connection = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(fixture.connectionId); assert.ok(connection);
  const at = new Date(Date.now() - 60_000).toISOString();
  const fact: MessageProjection = { kind: 'received', providerId: `wamid-${randomUUID()}`,
    thread: { providerId: fixture.providerThreadId, participantId: fixture.participantId, participantName: 'Pessoa' },
    direction: 'inbound', source: 'provider', text: '', status: 'received', deleted: false, edited: false,
    attachments: [{ kind: 'image', filename: 'foto.png', mimeType: 'image/png', mediaId: 'media123' }], unread: true, createdAt: at, contentUpdatedAt: at };
  await withTransaction(tx => projectMessage(tx, connection, fact));
  const row = await testDb.prepare(`SELECT a.* FROM whatsapp_attachment a JOIN whatsapp_message m ON m.id=a.message_id
    WHERE a.office_id=? AND m.provider_id=?`).get<AttachmentRow>(fixture.officeId, fact.providerId); assert.ok(row);
  return { connection, fact, row };
}

test('inbound binary endpoint uses the profile key, persists once and hides content after deletion', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  provider.on('GET', '/api/v1/whatsapp/media/media123', request => {
    assert.equal(request.url.searchParams.get('accountId'), fixture.accountId);
    assert.equal(request.headers.get('authorization'), `Bearer ${fixture.profileKey}`);
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  });
  await provider.run(async () => {
    const { connection, fact, row } = await seedMedia(fixture);
    await withTransaction(tx => projectMessage(tx, connection, fact));
    assert.equal(await runWhatsAppPass({ max: 1 }), 1);
    assert.deepEqual(Buffer.from(await (await readWhatsAppAttachment(fixture.context, row.id)).arrayBuffer()), png);
    assert.equal(provider.calls.length, 1);
    await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'delete', deleted: true, contentUpdatedAt: new Date().toISOString() }));
    await assert.rejects(readWhatsAppAttachment(fixture.context, row.id), { code: 'NOT_FOUND' });
    await withTransaction(tx => projectMessage(tx, connection, fact));
    assert.equal((await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 })).items[0]?.attachments.length, 0);
  });
});

for (const legacy of [false, true]) test(`same-version history materializes media without editing text (${legacy ? 'pre-migration message' : 'webhook without media id'})`, async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const connection = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(fixture.connectionId); assert.ok(connection);
    const at = new Date(Date.now() - 60_000).toISOString();
    const fact: MessageProjection = { kind: 'received', providerId: randomUUID(),
      thread: { providerId: fixture.providerThreadId, participantId: fixture.participantId, participantName: 'Pessoa' },
      direction: 'inbound', source: 'provider', text: 'Mesmo texto', status: 'received', deleted: false, edited: false,
      attachments: [{ kind: 'image', filename: 'foto.png', mimeType: 'image/png' }], unread: false, createdAt: at, contentUpdatedAt: at };
    await withTransaction(tx => projectMessage(tx, connection, fact));
    if (legacy) await testDb.prepare('DELETE FROM whatsapp_attachment WHERE office_id=?').run(fixture.officeId);
    const enriched = { ...fact, kind: 'history' as const, attachments: [{ kind: 'image', filename: 'foto.png', mimeType: 'image/png', mediaId: 'media123' }] };
    await withTransaction(tx => projectMessage(tx, connection, enriched));
    await withTransaction(tx => projectMessage(tx, connection, enriched));
    const attachment = await testDb.prepare('SELECT state,media_id FROM whatsapp_attachment WHERE office_id=?').get(fixture.officeId);
    assert.deepEqual(attachment, { state: 'pending', media_id: 'media123' });
    assert.equal((await testDb.prepare("SELECT count(*)::int AS count FROM whatsapp_job WHERE office_id=? AND kind='media'").get<{ count: number }>(fixture.officeId))?.count, 1);
    provider.on('GET', '/api/v1/whatsapp/media/media123', () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }));
    await runWhatsAppPass({ max: 1 });
    assert.equal((await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 })).items[0]?.attachments[0]?.state, 'ready');
  });
});

test('older history cannot assign an obsolete media id to a newer attachment or resurrect a tombstone', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const { connection, fact, row } = await seedMedia(fixture);
    await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'edit', edited: true,
      contentUpdatedAt: new Date(Date.now() - 1000).toISOString(), attachments: [{ kind: 'file', filename: 'novo.pdf', mimeType: 'application/pdf' }] }));
    await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'history' }));
    const current = await testDb.prepare(`SELECT media_id,filename FROM whatsapp_attachment WHERE office_id=? AND message_id IS NOT NULL`).get(fixture.officeId);
    assert.deepEqual(current, { media_id: null, filename: 'novo.pdf' });
    assert.equal((await testDb.prepare('SELECT state FROM whatsapp_attachment WHERE id=?').get<{ state: string }>(row.id))?.state, 'unavailable');
    await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'delete', deleted: true, contentUpdatedAt: new Date().toISOString() }));
    await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'history', contentUpdatedAt: new Date().toISOString() }));
    assert.equal((await testDb.prepare("SELECT count(*)::int AS count FROM whatsapp_attachment WHERE office_id=? AND state='pending'").get<{ count: number }>(fixture.officeId))?.count, 0);
  });
});

test('deletion during inbound download wins and permanent expiry is not retried', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const { connection, fact, row } = await seedMedia(fixture);
    provider.on('GET', '/api/v1/whatsapp/media/media123', async () => {
      await withTransaction(tx => projectMessage(tx, connection, { ...fact, kind: 'delete', deleted: true, contentUpdatedAt: new Date().toISOString() }));
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    });
    await runWhatsAppPass({ max: 1 });
    assert.deepEqual(await testDb.prepare('SELECT state,storage_key FROM whatsapp_attachment WHERE id=?').get(row.id), { state: 'unavailable', storage_key: null });
    const expired = await seedMedia(fixture);
    provider.on('GET', '/api/v1/whatsapp/media/media123', () => whatsappJson({ private: 'not exposed' }, 400));
    await runWhatsAppPass({ max: 1 });
    assert.equal((await testDb.prepare('SELECT state FROM whatsapp_attachment WHERE id=?').get<{ state: string }>(expired.row.id))?.state, 'unavailable');
    assert.equal((await testDb.prepare("SELECT status FROM whatsapp_job WHERE office_id=? AND kind='media' ORDER BY created_at DESC LIMIT 1").get<{ status: string }>(fixture.officeId))?.status, 'failed');
  });
});

test('ambiguous multipart acceptance is durable and never automatically resends the file', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  provider.on('POST', provider.sendPath, () => { throw new Error('private upstream timeout'); });
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    const input = { threadId: fixture.threadId, text: '', attachmentId: uploaded.id, idempotencyKey: randomUUID() };
    const first = await sendWhatsAppText(fixture.context, input);
    assert.equal(first.status, 'unknown');
    assert.deepEqual(await sendWhatsAppText(fixture.context, input), first);
    assert.equal(provider.sends.length, 1);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
    assert.equal((await readWhatsAppAttachment(fixture.context, uploaded.id)).status, 200);
  });
});

test('provider echo before HTTP acceptance preserves the uploaded file without duplicate attachment rows', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const uploaded = await uploadWhatsAppAttachment(fixture.context, fixture.threadId, file()); assert.ok(uploaded.id);
    const connection = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(fixture.connectionId); assert.ok(connection);
    provider.on('POST', provider.sendPath, async () => {
      const at = new Date(Date.now() - 1000).toISOString();
      await withTransaction(tx => projectMessage(tx, connection, { kind: 'sent', providerId: provider.messageId,
        thread: { providerId: fixture.providerThreadId, participantId: fixture.participantId, participantName: 'Pessoa' },
        direction: 'outbound', source: 'provider', text: '', status: 'sent', deleted: false, edited: false,
        attachments: [{ kind: 'image', filename: 'foto.png', mimeType: 'image/png' }], unread: false, createdAt: at, contentUpdatedAt: at }));
      return whatsappJson({ success: true, data: { messageId: provider.messageId } });
    });
    const sent = await sendWhatsAppText(fixture.context, { threadId: fixture.threadId, text: '', attachmentId: uploaded.id, idempotencyKey: randomUUID() });
    assert.equal(sent.status, 'accepted');
    const page = await readThread(fixture.context, { threadId: fixture.threadId, limit: 10 });
    assert.equal(page.items.length, 1); assert.equal(page.items[0]?.attachments.length, 1);
    assert.equal(page.items[0]?.attachments[0]?.id, uploaded.id); assert.equal(page.items[0]?.attachments[0]?.state, 'ready');
    assert.equal((await readWhatsAppAttachment(fixture.context, uploaded.id)).status, 200);
  });
});

test('a changed connection generation discards an in-flight media download', async () => {
  const fixture = await whatsappFixture(), provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const { row } = await seedMedia(fixture);
    provider.on('GET', '/api/v1/whatsapp/media/media123', async () => {
      await testDb.prepare('UPDATE whatsapp_connection SET generation=generation+1 WHERE id=?').run(fixture.connectionId);
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    });
    await runWhatsAppPass({ max: 1 });
    assert.equal((await testDb.prepare('SELECT storage_key FROM whatsapp_attachment WHERE id=?').get<{ storage_key: string | null }>(row.id))?.storage_key, null);
    await assert.rejects(readWhatsAppAttachment(fixture.context, row.id), { code: 'NOT_FOUND' });
  });
});

test('provider metadata never becomes an arbitrary URL proxy, and binary reads reject redirects and oversized streams', async () => {
  assert.deepEqual(providerAttachment(providerAttachmentSchema.parse({ type: 'image', url: 'http://127.0.0.1/private' }), 'account'), { kind: 'image', filename: null, mimeType: null });
  assert.equal(providerAttachment(providerAttachmentSchema.parse({ type: 'image', url: 'https://zernio.com/api/v1/whatsapp/media/123?accountId=other' }), 'account').mediaId, undefined);
  assert.equal(providerAttachment(providerAttachmentSchema.parse({ type: 'image', url: 'https://zernio.com/api/v1/whatsapp/media/123?accountId=account' }), 'account').mediaId, '123');
  await withWhatsAppTransport(async (_url, init) => { assert.equal(init?.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); },
    () => assert.rejects(zernioMediaBytes('profile-key', 'account', '123', 100), { code: 'redirect' }));
  await withWhatsAppTransport(async () => new Response(new Uint8Array(101), { headers: { 'content-length': '1' } }),
    () => assert.rejects(zernioMediaBytes('profile-key', 'account', '123', 100), { code: 'response_too_large' }));
});

test('media validator rejects disguised files, oversized images, ZIP bombs, DTD and incompatible Office packages', () => {
  assert.throws(() => validateWhatsAppFile(Buffer.from('<svg/>'), 'foto.png', 'image/png'), { code: 'INVALID' });
  assert.throws(() => validateWhatsAppFile(Buffer.alloc(5_000_001), 'foto.png', 'image/png'), { code: 'INVALID' });
  const zip = new PizZip(); zip.file('[Content_Types].xml', '<Types/>'); zip.file('word/document.xml', '<document/>');
  validateOfficeZip(zip.generate({ type: 'nodebuffer' }), '.docx');
  assert.throws(() => validateOfficeZip(zip.generate({ type: 'nodebuffer' }), '.xlsx'), { code: 'INVALID' });
  zip.file('word/document.xml', '<!DOCTYPE x [<!ENTITY bad "bad">]><document/>');
  assert.throws(() => validateOfficeZip(zip.generate({ type: 'nodebuffer' }), '.docx'), { code: 'INVALID' });
  zip.file('word/document.xml', 'x'.repeat(16_000_001));
  assert.throws(() => validateOfficeZip(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), '.docx'), { code: 'INVALID' });
});
