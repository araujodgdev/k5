import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { withTransaction } from '../src/lib/database';
import { listThreads, readThread, refreshInbox } from '../src/lib/whatsapp/history';
import { claimWhatsAppJob, completeWhatsAppJob, enqueueWhatsAppJob, failWhatsAppJob } from '../src/lib/whatsapp/jobs';
import { projectMessage, projectConversation, type MessageProjection } from '../src/lib/whatsapp/projection';
import { runWhatsAppPass } from '../src/lib/whatsapp/worker';
import { withWhatsAppTransport } from '../src/lib/whatsapp/transport';
import { fixtureConnection, whatsappFixture, whatsappTestEnvironment } from './whatsapp-ingestion-fixture';

afterEach(async () => { await testDb.prepare(`UPDATE whatsapp_job SET status='done',locked_until=NULL WHERE status IN ('queued','running')`).run(); });

function fact(options: Partial<MessageProjection> = {}): MessageProjection {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  return { kind: 'received', thread: { providerId: 'peer-5511999990000', participantId: '5511999990000', participantName: 'Contato' },
    providerId: randomUUID(), direction: 'inbound', source: 'provider', text: 'Mensagem sintética', status: 'received',
    deleted: false, edited: false, attachments: [], unread: true, createdAt, contentUpdatedAt: createdAt, ...options };
}
async function seedMessage(fixture: Awaited<ReturnType<typeof whatsappFixture>>, input: MessageProjection) {
  const connection = await fixtureConnection(fixture.connectionId);
  const id = await withTransaction(tx => projectMessage(tx, connection, input));
  assert.ok(id); return id;
}
function responseMessage(fixture: Awaited<ReturnType<typeof whatsappFixture>>, id: string, text: string, createdAt: string) {
  return { id, conversationId: 'internal-thread-id', accountId: fixture.accountId, platform: 'whatsapp',
    message: text, direction: 'incoming', createdAt, attachments: [] };
}

test('páginas locais têm ordem estável, isolamento por escritório/conta e não aceitam cursor de outra conversa', async () => {
  const fixture = await whatsappFixture(), other = await whatsappFixture();
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const threadId = await seedMessage(fixture, fact({ providerId: 'one', createdAt, contentUpdatedAt: createdAt }));
  await seedMessage(fixture, fact({ providerId: 'two', createdAt, contentUpdatedAt: createdAt }));
  await seedMessage(fixture, fact({ providerId: 'three', createdAt, contentUpdatedAt: createdAt }));
  await seedMessage(other, fact({ providerId: 'private', text: 'Outro escritório' }));
  await testDb.prepare('UPDATE whatsapp_thread SET history_complete=true WHERE id=?').run(threadId);
  await whatsappTestEnvironment(async () => {
    const first = await readThread(fixture.context, { threadId, limit: 2 });
    assert.equal(first.items.length, 2); assert.ok(first.nextCursor); assert.equal(first.canSend, true);
    const second = await readThread(fixture.context, { threadId, limit: 2, cursor: first.nextCursor });
    assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 3);
    await assert.rejects(readThread(other.context, { threadId, limit: 2 }), /não encontrada/);
    await assert.rejects(listThreads(fixture.context, { cursor: first.nextCursor, limit: 2 }), /não pertence/);
    assert.equal((await listThreads(fixture.context, { limit: 2 })).items.length, 1);
    await testDb.prepare('UPDATE whatsapp_connection SET account_id=? WHERE id=?').run('new-account', fixture.connectionId);
    assert.equal((await listThreads(fixture.context, { limit: 2 })).items.length, 0);
    await assert.rejects(readThread(fixture.context, { threadId, limit: 2 }), /não encontrada/);
  });
});

test('consultas revalidam flag, papel e sessão e mostram anexo sem mídia como indisponível', async () => {
  const fixture = await whatsappFixture();
  const threadId = await seedMessage(fixture, fact({ attachments: [{ kind: 'file', filename: 'arquivo.pdf', mimeType: 'application/pdf' }] }));
  await testDb.prepare('UPDATE whatsapp_thread SET history_complete=true WHERE id=?').run(threadId);
  await whatsappTestEnvironment(async () => {
    const history = await readThread(fixture.context, { threadId, limit: 10 });
    assert.equal(history.canSend, true);
    const attachment = history.items[0]?.attachments[0];
    assert.ok(attachment?.id);
    assert.deepEqual(attachment, { id: attachment.id, kind: 'file', filename: 'arquivo.pdf', mimeType: 'application/pdf', byteLength: null,
      state: 'unavailable', contentUrl: null });
    await testDb.prepare('DELETE FROM session WHERE id=?').run(fixture.context.sessionId);
    await assert.rejects(listThreads(fixture.context, { limit: 10 }), /sessão/);
  });
  const another = await whatsappFixture();
  await whatsappTestEnvironment(() => assert.rejects(listThreads(another.context, { limit: 10 }), /não está disponível/), false);
});

test('importação inicial e próxima página são jobs; polling não repete consultas externas', async () => {
  const fixture = await whatsappFixture();
  const connection = await fixtureConnection(fixture.connectionId);
  const latestAt = new Date(Date.now() - 60_000).toISOString();
  await withTransaction(tx => projectConversation(tx, connection, { id: 'peer-5511999990000', participantId: '5511999990000',
    participantName: 'Contato', lastText: 'Recente', updatedAt: latestAt, unreadCount: 0 }));
  const row = await testDb.prepare('SELECT id FROM whatsapp_thread WHERE office_id=?').get<{ id: string }>(fixture.officeId);
  assert.ok(row);
  let calls = 0;
  await whatsappTestEnvironment(() => withWhatsAppTransport(async url => {
    const request = new URL(url); calls += 1;
    assert.match(request.pathname, /\/inbox\/conversations\/peer-5511999990000\/messages$/);
    assert.equal(request.searchParams.get('accountId'), fixture.accountId);
    if (request.searchParams.get('cursor') === 'older-page') return Response.json({
      messages: [responseMessage(fixture, 'old', 'Antiga', new Date(Date.now() - 3_600_000).toISOString())],
      pagination: { hasMore: false },
    });
    return Response.json({ messages: [responseMessage(fixture, 'new', 'Recente', latestAt)],
      pagination: { hasMore: true, nextCursor: 'older-page' } });
  }, async () => {
    const pending = await readThread(fixture.context, { threadId: row.id, limit: 1 });
    assert.equal(pending.items.length, 0); assert.equal(pending.syncState, 'pending'); assert.equal(calls, 0);
    await readThread(fixture.context, { threadId: row.id, limit: 1 });
    assert.equal((await testDb.prepare(`SELECT count(*) AS total FROM whatsapp_job WHERE connection_id=? AND kind='history' AND status='queued'`)
      .get<{ total: number }>(fixture.connectionId))?.total, 1);
    await runWhatsAppPass(); assert.equal(calls, 1);
    let page = await readThread(fixture.context, { threadId: row.id, limit: 1 });
    assert.equal(page.thread.historyComplete, false); assert.ok(page.nextCursor); assert.equal(page.items[0]?.text, 'Recente');
    await readThread(fixture.context, { threadId: row.id, limit: 1 }); await runWhatsAppPass(); assert.equal(calls, 1);
    const cursor = page.nextCursor;
    page = await readThread(fixture.context, { threadId: row.id, limit: 1, cursor });
    assert.equal(page.syncState, 'pending'); await runWhatsAppPass(); assert.equal(calls, 2);
    page = await readThread(fixture.context, { threadId: row.id, limit: 1, cursor });
    assert.equal(page.items[0]?.text, 'Antiga'); assert.equal(page.thread.historyComplete, true); assert.equal(page.nextCursor, null);
  }));
});

test('histórico atrasado preserva edição, tombstone, leitura e origem Tises com correlação exata', async () => {
  const fixture = await whatsappFixture();
  const createdAt = new Date(Date.now() - 3_600_000).toISOString();
  const editedAt = new Date(Date.now() - 1_800_000).toISOString();
  const threadId = await seedMessage(fixture, fact({ providerId: 'edited', text: 'Texto novo', createdAt,
    contentUpdatedAt: editedAt, kind: 'edit', edited: true, unread: false }));
  await seedMessage(fixture, fact({ providerId: 'deleted', text: '', createdAt,
    contentUpdatedAt: editedAt, kind: 'delete', deleted: true, unread: false }));
  await testDb.prepare(`INSERT INTO whatsapp_send(id,office_id,connection_id,generation,thread_id,user_id,
    idempotency_key,input_hash,text,provider_id,status) VALUES(?,?,?,1,?,?,?,?,?,?,'read')`)
    .run(randomUUID(), fixture.officeId, fixture.connectionId, threadId, fixture.userId, randomUUID(), 'synthetic', 'Enviada', 'tises-provider-id');
  await seedMessage(fixture, fact({ providerId: 'tises-provider-id', text: 'Enviada', direction: 'outbound', status: 'sent',
    kind: 'history', createdAt, contentUpdatedAt: createdAt, unread: false }));
  await seedMessage(fixture, fact({ providerId: 'edited', text: 'Texto antigo', kind: 'history', createdAt, contentUpdatedAt: createdAt, unread: false }));
  await seedMessage(fixture, fact({ providerId: 'deleted', text: 'Conteúdo removido', kind: 'history', createdAt, contentUpdatedAt: createdAt, unread: false }));
  await testDb.prepare('UPDATE whatsapp_thread SET history_complete=true WHERE id=?').run(threadId);
  await whatsappTestEnvironment(async () => {
    const page = await readThread(fixture.context, { threadId, limit: 10 });
    assert.equal(page.items.length, 3);
    assert.ok(page.items.some(item => item.text === 'Texto novo' && item.edited));
    assert.ok(page.items.some(item => item.deleted && item.text === ''));
    assert.ok(page.items.some(item => item.text === 'Enviada' && item.status === 'read' && item.source === 'tises'));
    assert.ok(!JSON.stringify(page).includes('Conteúdo removido'));
  });
});

test('atualização recente sem cruzamento com o cache mantém o histórico parcial até importar o intervalo ausente', async () => {
  const fixture = await whatsappFixture();
  const threadId = await seedMessage(fixture, fact({ providerId: 'old-anchor', createdAt: new Date(Date.now() - 86_400_000).toISOString() }));
  await testDb.prepare('UPDATE whatsapp_thread SET history_complete=true WHERE id=?').run(threadId);
  await enqueueWhatsAppJob(testDb, { officeId: fixture.officeId, connectionId: fixture.connectionId, generation: 1,
    kind: 'history_refresh', subjectId: threadId, dedupeKey: `refresh-gap-${randomUUID()}` });
  await whatsappTestEnvironment(() => withWhatsAppTransport(async () => Response.json({
    messages: [responseMessage(fixture, 'new-page', 'Mensagem após interrupção', new Date(Date.now() - 60_000).toISOString())],
    pagination: { hasMore: true, nextCursor: 'gap-page' },
  }), async () => {
    await runWhatsAppPass();
    assert.deepEqual(await testDb.prepare('SELECT history_complete,history_cursor FROM whatsapp_thread WHERE id=?').get(threadId),
      { history_complete: false, history_cursor: 'gap-page' });
  }));
});

test('desconectar durante consulta descarta a resposta tardia sem segurar transação na rede', async () => {
  const fixture = await whatsappFixture();
  const threadId = await seedMessage(fixture, fact());
  await enqueueWhatsAppJob(testDb, { officeId: fixture.officeId, connectionId: fixture.connectionId, generation: 1,
    kind: 'history', subjectId: threadId, dedupeKey: `disconnect-race-${randomUUID()}` });
  let release: (() => void) | undefined, started: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const observed = new Promise<void>(resolve => { started = resolve; });
  await whatsappTestEnvironment(() => withWhatsAppTransport(async () => {
    started?.(); await gate;
    return Response.json({ messages: [responseMessage(fixture, 'late', 'Resposta tardia', new Date().toISOString())], pagination: { hasMore: false } });
  }, async () => {
    const running = runWhatsAppPass({ max: 1 }); await observed;
    try {
      await withTransaction(async tx => {
        await tx.prepare(`SET LOCAL lock_timeout='500ms'`).run();
        await tx.prepare(`UPDATE whatsapp_connection SET status='disconnected',generation=generation+1 WHERE id=?`).run(fixture.connectionId);
      });
    } finally { release?.(); }
    await running;
    assert.equal(await testDb.prepare(`SELECT id FROM whatsapp_message WHERE office_id=? AND provider_id='late'`).get(fixture.officeId), undefined);
  }));
});

test('fila reserva jobs uma vez, recupera lease com fencing e encerra tentativas finitas', async () => {
  const fixture = await whatsappFixture();
  const input = { officeId: fixture.officeId, connectionId: fixture.connectionId, generation: 1,
    kind: 'conversations', dedupeKey: `fence-${randomUUID()}` } satisfies Parameters<typeof enqueueWhatsAppJob>[1];
  const ids = await Promise.all([enqueueWhatsAppJob(testDb, input), enqueueWhatsAppJob(testDb, input)]);
  assert.equal(ids[0], ids[1]);
  const claimed = await Promise.all([claimWhatsAppJob(), claimWhatsAppJob()]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const first = claimed.find(item => item !== null); assert.ok(first);
  await testDb.prepare(`UPDATE whatsapp_job SET locked_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?`).run(first.id);
  const replacement = await claimWhatsAppJob(); assert.ok(replacement); assert.equal(replacement.attempts, 2);
  await completeWhatsAppJob(first);
  assert.equal((await testDb.prepare('SELECT status FROM whatsapp_job WHERE id=?').get<{ status: string }>(first.id))?.status, 'running');
  await testDb.prepare('UPDATE whatsapp_job SET attempts=6 WHERE id=?').run(replacement.id);
  await failWhatsAppJob({ ...replacement, attempts: 6 }, 'synthetic_failure');
  assert.equal((await testDb.prepare('SELECT status FROM whatsapp_job WHERE id=?').get<{ status: string }>(first.id))?.status, 'failed');
  assert.equal(await claimWhatsAppJob(), null);
});

test('envio interrompido torna-se incerto e permanece visível sem repetição automática', async () => {
  const fixture = await whatsappFixture();
  const threadId = await seedMessage(fixture, fact());
  await testDb.prepare('UPDATE whatsapp_thread SET history_complete=true WHERE id=?').run(threadId);
  await testDb.prepare(`INSERT INTO whatsapp_send(id,office_id,connection_id,generation,thread_id,user_id,idempotency_key,input_hash,text,status,updated_at)
    VALUES(?,?,?,1,?,?,?,?,?,'dispatching',CURRENT_TIMESTAMP-INTERVAL '10 minutes')`)
    .run(randomUUID(), fixture.officeId, fixture.connectionId, threadId, fixture.userId, randomUUID(), 'synthetic', 'Envio sem confirmação');
  await whatsappTestEnvironment(() => withWhatsAppTransport(async () => { assert.fail('Envio incerto não pode ser repetido.'); }, async () => {
    await runWhatsAppPass();
    const history = await readThread(fixture.context, { threadId, limit: 10 });
    assert.ok(history.items.some(item => item.text === 'Envio sem confirmação' && item.status === 'unknown'));
  }));
});

test('atualização explícita deduplica importação e respeita intervalo mínimo', async () => {
  const fixture = await whatsappFixture();
  await whatsappTestEnvironment(async () => {
    assert.deepEqual(await refreshInbox(fixture.context), { queued: true });
    assert.deepEqual(await refreshInbox(fixture.context), { queued: true });
    assert.equal((await testDb.prepare(`SELECT count(*) AS total FROM whatsapp_job WHERE connection_id=? AND kind='conversations' AND status='queued'`)
      .get<{ total: number }>(fixture.connectionId))?.total, 1);
    await testDb.prepare(`UPDATE whatsapp_job SET status='done' WHERE connection_id=?`).run(fixture.connectionId);
    assert.deepEqual(await refreshInbox(fixture.context), { queued: false });
  });
});
