import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { acceptWebhook, MAX_WHATSAPP_WEBHOOK_BYTES } from '../src/lib/whatsapp/webhooks';
import { runWhatsAppPass } from '../src/lib/whatsapp/worker';
import { whatsappFixture, whatsappTestEnvironment, signWebhook, webhookMessage } from './whatsapp-ingestion-fixture';

test('webhook confere os bytes assinados, limites, timestamp e identidade do cabeçalho antes de gravar', async () => {
  const fixture = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    const payload = webhookMessage(fixture);
    const signed = signWebhook(payload);
    await assert.rejects(acceptWebhook(new TextEncoder().encode(JSON.stringify({ ...payload, extra: 'tampered' })), signed.headers), /Assinatura/);
    await assert.rejects(acceptWebhook(signed.body, new Headers({ 'x-zernio-signature': 'x'.repeat(64) })), /Assinatura/);
    const wrongId = new Headers(signed.headers); wrongId.set('x-zernio-event-id', randomUUID());
    await assert.rejects(acceptWebhook(signed.body, wrongId), /Identificador/);
    const future = signWebhook(webhookMessage(fixture, { timestamp: new Date(Date.now() + 120_000).toISOString() }));
    await assert.rejects(acceptWebhook(future.body, future.headers), /inválido/);
    await assert.rejects(acceptWebhook(new Uint8Array(MAX_WHATSAPP_WEBHOOK_BYTES + 1), signed.headers), /Tamanho/);
    assert.equal((await testDb.prepare('SELECT count(*) AS total FROM whatsapp_event WHERE office_id=?').get<{ total: number }>(fixture.officeId))?.total, 0);
  });
});

test('ACK persiste evento cifrado e job atomicamente, mesmo com flag desligada; duplicatas não duplicam mensagens', async () => {
  const fixture = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    const payload = webhookMessage(fixture);
    const signed = signWebhook(payload, JSON.stringify(payload, null, 2));
    assert.deepEqual(await acceptWebhook(signed.body, signed.headers), { accepted: true, duplicate: false });
    assert.equal((await testDb.prepare('SELECT count(*) AS total FROM whatsapp_message WHERE office_id=?').get<{ total: number }>(fixture.officeId))?.total, 0);
    const stored = await testDb.prepare('SELECT encrypted_payload FROM whatsapp_event WHERE id=?').get<{ encrypted_payload: string }>(payload.id);
    assert.ok(stored); assert.ok(!stored.encrypted_payload.includes(payload.message.text));
    assert.equal(decryptCredential(stored.encrypted_payload, parseCredentialKeyring()), JSON.stringify(payload, null, 2));
    assert.equal((await testDb.prepare(`SELECT count(*) AS total FROM whatsapp_job WHERE subject_id=? AND kind='event'`).get<{ total: number }>(payload.id))?.total, 1);
    const duplicated = await Promise.all([acceptWebhook(signed.body, signed.headers), acceptWebhook(signed.body, signed.headers)]);
    assert.ok(duplicated.every(item => item.duplicate));
    await runWhatsAppPass();
    const repeatedMessage = signWebhook({ ...payload, id: randomUUID() });
    await acceptWebhook(repeatedMessage.body, repeatedMessage.headers); await runWhatsAppPass();
    const message = await testDb.prepare('SELECT provider_id,text,attachments FROM whatsapp_message WHERE office_id=?')
      .get<{ provider_id: string; text: string; attachments: unknown }>(fixture.officeId);
    assert.deepEqual(message, { provider_id: 'wamid-synthetic', text: 'Mensagem sintética',
      attachments: [{ kind: 'image', filename: 'foto.jpg', mimeType: 'image/jpeg' }] });
    assert.equal((await testDb.prepare('SELECT unread_count FROM whatsapp_thread WHERE office_id=?').get<{ unread_count: number }>(fixture.officeId))?.unread_count, 1);
  }, false);
});

test('falha ao criar job desfaz também a persistência do evento', async () => {
  const fixture = await whatsappFixture();
  const payload = webhookMessage(fixture);
  await testDb.exec(`CREATE FUNCTION fail_whatsapp_job_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.subject_id='${payload.id}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_whatsapp_job_test BEFORE INSERT ON whatsapp_job FOR EACH ROW EXECUTE FUNCTION fail_whatsapp_job_test()`);
  try {
    await whatsappTestEnvironment(async () => {
      const signed = signWebhook(payload);
      await assert.rejects(acceptWebhook(signed.body, signed.headers), /synthetic failure/);
      assert.equal(await testDb.prepare('SELECT id FROM whatsapp_event WHERE id=?').get(payload.id), undefined);
    });
  } finally { await testDb.exec('DROP TRIGGER fail_whatsapp_job_test ON whatsapp_job; DROP FUNCTION fail_whatsapp_job_test()'); }
});

test('conta e perfil precisam pertencer ao mesmo escritório; contas antigas e desconectadas não são reativadas', async () => {
  const a = await whatsappFixture(), b = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    const mismatched = webhookMessage(a); mismatched.account.profileId = b.profileId;
    const signed = signWebhook(mismatched);
    assert.deepEqual(await acceptWebhook(signed.body, signed.headers), { accepted: true, duplicate: false });
    await testDb.prepare(`UPDATE whatsapp_connection SET status='disconnected' WHERE id=?`).run(a.connectionId);
    const disconnected = signWebhook(webhookMessage(a));
    await acceptWebhook(disconnected.body, disconnected.headers);
    await testDb.prepare(`UPDATE whatsapp_connection SET status='connected',account_id=? WHERE id=?`).run('replacement-account', a.connectionId);
    const oldAccount = signWebhook(webhookMessage(a));
    await acceptWebhook(oldAccount.body, oldAccount.headers);
    assert.equal((await testDb.prepare('SELECT count(*) AS total FROM whatsapp_event WHERE office_id IN (?,?)')
      .get<{ total: number }>(a.officeId, b.officeId))?.total, 0);
  });
});

test('ordem de chegada não regride leitura, edições ou tombstones e só entradas abrem a janela', async () => {
  const fixture = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    const created = new Date(Date.now() - 3_600_000).toISOString();
    const edited = new Date(Date.now() - 2_400_000).toISOString();
    const deleted = new Date(Date.now() - 1_200_000).toISOString();
    const events = [
      webhookMessage(fixture, { event: 'message.read', direction: 'outgoing', statusAt: edited, sentAt: created, source: 'whatsapp_business_app' }),
      webhookMessage(fixture, { event: 'message.sent', direction: 'outgoing', sentAt: created, source: 'whatsapp_business_app' }),
      webhookMessage(fixture, { event: 'message.failed', direction: 'outgoing', statusAt: deleted, sentAt: created }),
      webhookMessage(fixture, { event: 'message.edited', direction: 'outgoing', editedAt: edited, sentAt: created, text: 'Editada' }),
      webhookMessage(fixture, { event: 'message.deleted', direction: 'outgoing', deletedAt: deleted, sentAt: created, text: 'Editada' }),
      webhookMessage(fixture, { event: 'message.sent', direction: 'outgoing', sentAt: created, text: 'Original atrasada' }),
    ];
    for (const payload of events) { const signed = signWebhook(payload); await acceptWebhook(signed.body, signed.headers); await runWhatsAppPass(); }
    assert.deepEqual(await testDb.prepare('SELECT status,deleted,edited,text,attachments,source FROM whatsapp_message WHERE office_id=?').get(fixture.officeId),
      { status: 'read', deleted: true, edited: true, text: '', attachments: [], source: 'whatsapp_business_app' });
    assert.deepEqual(await testDb.prepare('SELECT last_customer_message_at,unread_count,last_text FROM whatsapp_thread WHERE office_id=?').get(fixture.officeId),
      { last_customer_message_at: null, unread_count: 0, last_text: '' });
    const incoming = signWebhook(webhookMessage(fixture, { providerId: 'incoming-window', sentAt: created }));
    await acceptWebhook(incoming.body, incoming.headers); await runWhatsAppPass();
    assert.equal((await testDb.prepare('SELECT last_customer_message_at FROM whatsapp_thread WHERE office_id=?')
      .get<{ last_customer_message_at: string }>(fixture.officeId))?.last_customer_message_at, created);
  });
});

test('disconnect invalida envios antes do worker e eventos atrasados não derrubam a reconexão verificada', async () => {
  const fixture = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    const incoming = signWebhook(webhookMessage(fixture));
    await acceptWebhook(incoming.body, incoming.headers); await runWhatsAppPass();
    const thread = await testDb.prepare('SELECT id FROM whatsapp_thread WHERE office_id=?').get<{ id: string }>(fixture.officeId);
    assert.ok(thread);
    for (const status of ['pending', 'dispatching']) await testDb.prepare(`INSERT INTO whatsapp_send
      (id,office_id,connection_id,generation,thread_id,user_id,idempotency_key,input_hash,text,status)
      VALUES(?,?,?,1,?,?,?,?,?,?)`).run(randomUUID(), fixture.officeId, fixture.connectionId, thread.id,
      fixture.userId, randomUUID(), 'synthetic', 'Mensagem de teste', status);
    const disconnected = { id: randomUUID(), event: 'account.disconnected', timestamp: new Date().toISOString(), account: incomingAccount(fixture) };
    const signed = signWebhook(disconnected);
    await acceptWebhook(signed.body, signed.headers);
    assert.deepEqual(await testDb.prepare('SELECT status,generation FROM whatsapp_connection WHERE id=?').get(fixture.connectionId),
      { status: 'reconnect_required', generation: 2 });
    assert.deepEqual((await testDb.prepare('SELECT status FROM whatsapp_send WHERE office_id=? ORDER BY status').all<{ status: string }>(fixture.officeId))
      .map(row => row.status), ['failed', 'unknown']);
    await testDb.prepare(`UPDATE whatsapp_connection SET status='connected',verified_at=CURRENT_TIMESTAMP+INTERVAL '1 second' WHERE id=?`).run(fixture.connectionId);
    const delayed = signWebhook({ ...disconnected, id: randomUUID() });
    await acceptWebhook(delayed.body, delayed.headers);
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_connection WHERE id=?').get<{ status: string }>(fixture.connectionId))?.status, 'connected');
  });
});

function incomingAccount(fixture: Awaited<ReturnType<typeof whatsappFixture>>) {
  return { accountId: fixture.accountId, profileId: fixture.profileId, platform: 'whatsapp', username: 'synthetic',
    disconnectionType: 'unintentional', reason: 'synthetic' };
}
