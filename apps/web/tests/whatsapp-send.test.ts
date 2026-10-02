import { FakeWhatsApp, testDb, whatsappFixture, whatsappIdentity, whatsappJson, whatsappThread, type WhatsAppFixture } from './whatsapp-send-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sendWhatsAppText } from '../src/lib/whatsapp/send';
import { beginWhatsAppConnect, completeWhatsAppConnect, whatsappStatus } from '../src/lib/whatsapp/connection';
import { isReplyWindowOpen, replyWindow, type SendInput } from '../src/lib/whatsapp/domain';
import { approveProposal, approvalIdFromMessage, getApprovalProposal } from '../src/lib/application/approvals-service';
import { CapabilityError } from '../src/lib/capabilities/errors';
import type { WorkspaceContext } from '../src/lib/application/context';

function intent(fixture: WhatsAppFixture, text = 'Recebemos seu documento.'): SendInput {
  return { threadId: fixture.threadId, text, idempotencyKey: randomUUID() };
}

async function proposal(operation: Promise<unknown>) {
  try { await operation; }
  catch (error) {
    assert.ok(error instanceof CapabilityError);
    assert.equal(error.code, 'APPROVAL_REQUIRED');
    const id = approvalIdFromMessage(error.message);
    assert.ok(id, 'the approval refusal identifies a stored human decision');
    return id;
  }
  assert.fail('the message must wait for a human approval');
}

test('WhatsApp send: a lawyer sends to the office account with its profile key and gets a durable receipt', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  const input = intent(fixture, '  Recebemos seu documento.  ');
  await provider.run(async () => {
    const result = await sendWhatsAppText(fixture.context, input);
    assert.equal(result.status, 'accepted');
    assert.equal(result.threadId, fixture.threadId);
    assert.equal(result.error, null);
    assert.equal(provider.sends.length, 1);
    const request = provider.sends[0];
    assert.ok(request);
    assert.deepEqual(request.body, { accountId: fixture.accountId, message: 'Recebemos seu documento.' });
    assert.equal(request.headers.get('authorization'), `Bearer ${fixture.profileKey}`);
    assert.equal(request.headers.get('idempotency-key'), result.id);
    const stored = await testDb.prepare('SELECT status,text,provider_id,user_id FROM whatsapp_send WHERE id=?').get(result.id);
    assert.deepEqual(stored, { status: 'accepted', text: 'Recebemos seu documento.', provider_id: provider.messageId, user_id: fixture.userId });
    assert.deepEqual(await sendWhatsAppText(fixture.context, input), result);
    assert.equal(provider.sends.length, 1);
    assert.equal((await testDb.prepare("SELECT status FROM whatsapp_job WHERE office_id=? AND kind='history_refresh'").get<{ status: string }>(fixture.officeId))?.status, 'queued');
  });
});

test('WhatsApp send: office isolation also scopes idempotency and ALS credentials under parallel requests', async () => {
  const first = await whatsappFixture();
  const second = await whatsappFixture();
  const firstProvider = new FakeWhatsApp(first);
  const secondProvider = new FakeWhatsApp(second);
  const sharedKey = randomUUID();
  await firstProvider.run(async () => {
    await assert.rejects(sendWhatsAppText(first.context, { threadId: second.threadId, text: 'Outro escritório.', idempotencyKey: sharedKey }), { code: 'NOT_FOUND' });
    await assert.rejects(sendWhatsAppText({ ...first.context, officeId: second.officeId }, intent(second)), { code: 'FORBIDDEN' });
    assert.equal(firstProvider.calls.length, 0);
  });
  const [one, two] = await Promise.all([
    firstProvider.run(() => sendWhatsAppText(first.context, { ...intent(first, 'Primeiro escritório.'), idempotencyKey: sharedKey })),
    secondProvider.run(() => sendWhatsAppText(second.context, { ...intent(second, 'Segundo escritório.'), idempotencyKey: sharedKey })),
  ]);
  assert.equal(one.status, 'accepted'); assert.equal(two.status, 'accepted');
  assert.notEqual(one.id, two.id);
  assert.equal(firstProvider.sends[0]?.headers.get('authorization'), `Bearer ${first.profileKey}`);
  assert.equal(secondProvider.sends[0]?.headers.get('authorization'), `Bearer ${second.profileKey}`);
  assert.deepEqual(firstProvider.sends[0]?.body, { accountId: first.accountId, message: 'Primeiro escritório.' });
  assert.deepEqual(secondProvider.sends[0]?.body, { accountId: second.accountId, message: 'Segundo escritório.' });
});

test('WhatsApp send: unrelated lawyers and disabled rollout are refused before a provider request', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  const input = intent(fixture);
  await provider.run(async () => {
    await assert.rejects(sendWhatsAppText({ ...fixture.context, userId: 'unrelated-lawyer', sessionId: undefined }, input), { code: 'FORBIDDEN' });
    assert.equal(provider.calls.length, 0);
    provider.enabled = false;
    await assert.rejects(sendWhatsAppText(fixture.context, input), { code: 'NOT_FOUND' });
    assert.equal(provider.calls.length, 0);
    assert.equal((await testDb.prepare('SELECT count(*)::int AS count FROM whatsapp_send WHERE office_id=?').get<{ count: number }>(fixture.officeId))?.count, 0);
    provider.enabled = true;
    assert.equal((await sendWhatsAppText(fixture.context, input)).status, 'accepted');
    assert.equal(provider.sends.length, 1);
  });
});

test('WhatsApp send: concurrent copies of one intent produce one external message and one durable operation', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  const input = intent(fixture);
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  provider.on('POST', provider.sendPath, async () => {
    entered.resolve();
    await released.promise;
    return whatsappJson({ success: true, data: { messageId: 'one-delivered-message' } });
  });
  await provider.run(async () => {
    const results = Promise.all(Array.from({ length: 8 }, () => sendWhatsAppText(fixture.context, input)));
    try {
      await Promise.race([entered.promise, results.then(() => assert.fail('A new send must reach the provider.'))]);
      const stored = await testDb.prepare('SELECT status,text FROM whatsapp_send WHERE office_id=?').all(fixture.officeId);
      assert.deepEqual(stored, [{ status: 'dispatching', text: input.text }]);
    } finally { released.resolve(); }
    const receipts = await results;
    assert.equal(new Set(receipts.map(result => result.id)).size, 1);
    assert.equal(receipts.some(result => result.status === 'accepted'), true);
    assert.equal(receipts.every(result => result.status === 'accepted' || result.status === 'dispatching'), true);
    assert.equal(provider.sends.length, 1);
    const row = await testDb.prepare('SELECT status,provider_id FROM whatsapp_send WHERE office_id=?').get(fixture.officeId);
    assert.deepEqual(row, { status: 'accepted', provider_id: 'one-delivered-message' });
    assert.equal((await sendWhatsAppText(fixture.context, input)).status, 'accepted');
    assert.equal(provider.sends.length, 1);
  });
});

for (const failure of ['lost response', 'upstream 503', 'invalid success body']) {
  test(`WhatsApp send: ${failure} stays unknown and the same intent never retries externally`, async () => {
    const fixture = await whatsappFixture();
    const provider = new FakeWhatsApp(fixture);
    const input = intent(fixture);
    provider.on('POST', provider.sendPath, () => {
      if (failure === 'lost response') throw new Error('The provider accepted the request but the response was lost.');
      return failure === 'upstream 503' ? whatsappJson({ error: 'Unavailable' }, 503) : whatsappJson({ success: true });
    });
    await provider.run(async () => {
      const first = await sendWhatsAppText(fixture.context, input);
      assert.equal(first.status, 'unknown');
      assert.match(first.error ?? '', /confirmar o envio/);
      const retried = await Promise.all(Array.from({ length: 3 }, () => sendWhatsAppText(fixture.context, input)));
      for (const result of retried) assert.deepEqual(result, first);
      assert.equal(provider.sends.length, 1);
      assert.deepEqual(provider.sends[0]?.body, { accountId: fixture.accountId, message: input.text });
      const stored = await testDb.prepare('SELECT status,provider_id FROM whatsapp_send WHERE id=?').get(first.id);
      assert.deepEqual(stored, { status: 'unknown', provider_id: null });
    });
  });
}

test('WhatsApp send: a known rejection needs a new user intent, while changed text or owner cannot reuse a key', async () => {
  const fixture = await whatsappFixture();
  const colleague = await whatsappIdentity();
  const provider = new FakeWhatsApp(fixture).on('POST', `/api/v1/inbox/conversations/${fixture.providerThreadId}/messages`, () => whatsappJson({ error: 'Forbidden' }, 403));
  const input = intent(fixture);
  await provider.run(async () => {
    const failed = await sendWhatsAppText(fixture.context, input);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(await sendWhatsAppText(fixture.context, input), failed);
    await assert.rejects(sendWhatsAppText(fixture.context, { ...input, text: 'Texto alterado.' }), { code: 'CONFLICT' });
    await assert.rejects(sendWhatsAppText(colleague.context, input), { code: 'NOT_READY' });
    assert.equal(provider.sends.length, 1);
    provider.on('POST', provider.sendPath, () => whatsappJson({ success: true, data: { messageId: 'explicit-new-intent' } }));
    const next = await sendWhatsAppText(fixture.context, { ...input, idempotencyKey: randomUUID() });
    assert.equal(next.status, 'accepted'); assert.notEqual(next.id, failed.id);
    assert.equal(provider.sends.length, 2);
  });
});

const invocations: NonNullable<WorkspaceContext['invocation']>[] = ['agent', 'webmcp'];
for (const invocation of invocations) {
  test(`WhatsApp send: ${invocation} waits for the person's exact text, recipient and intent approval`, async () => {
    const fixture = await whatsappFixture();
    const colleague = await whatsappIdentity();
    const otherThread = await whatsappThread(fixture, { participantName: 'Outra cliente' });
    const provider = new FakeWhatsApp(fixture);
    const input = intent(fixture);
    const agent: WorkspaceContext = { ...fixture.context, invocation };
    await provider.run(async () => {
      const approvalId = await proposal(sendWhatsAppText(agent, input));
      const pending = await getApprovalProposal(fixture.context, approvalId);
      assert.equal(pending.status, 'pending');
      assert.equal(pending.capability_name, 'k5_whatsapp_send');
      assert.deepEqual(JSON.parse(pending.normalized_input), { ...input, connectionId: fixture.connectionId, generation: 1, recipientId: fixture.participantId });
      await assert.rejects(sendWhatsAppText(agent, { ...input, approvalId }), { code: 'APPROVAL_REQUIRED' });
      await assert.rejects(approveProposal(colleague.context, approvalId), { code: 'NOT_FOUND' });
      assert.equal(provider.sends.length, 0);
      assert.equal((await approveProposal(fixture.context, approvalId)).status, 'approved');
      for (const changed of [{ ...input, text: 'Outro texto.' }, { ...input, threadId: otherThread.threadId }, { ...input, idempotencyKey: randomUUID() }]) {
        await assert.rejects(sendWhatsAppText(agent, { ...changed, approvalId }), { code: 'FORBIDDEN' });
      }
      const result = await sendWhatsAppText(agent, { ...input, approvalId });
      assert.equal(result.status, 'accepted');
      assert.equal((await getApprovalProposal(fixture.context, approvalId)).status, 'consumed');
      assert.deepEqual(provider.sends[0]?.body, { accountId: fixture.accountId, message: input.text });
      assert.deepEqual(await sendWhatsAppText(agent, { ...input, approvalId }), result);
      assert.equal(provider.sends.length, 1);
    });
  });
}

test('WhatsApp send: reconnecting the same account invalidates approvals from the previous generation', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  const input = intent(fixture);
  const agent: WorkspaceContext = { ...fixture.context, invocation: 'agent' };
  await provider.run(async () => {
    const oldApproval = await proposal(sendWhatsAppText(agent, input));
    await approveProposal(fixture.context, oldApproval);
    await testDb.prepare("UPDATE whatsapp_connection SET status='reconnect_required' WHERE id=?").run(fixture.connectionId);
    await beginWhatsAppConnect(fixture.context);
    assert.deepEqual(await completeWhatsAppConnect(fixture.context, provider.callback()), { connected: true });
    assert.equal((await testDb.prepare('SELECT generation FROM whatsapp_connection WHERE id=?').get<{ generation: number }>(fixture.connectionId))?.generation, 2);
    await assert.rejects(sendWhatsAppText(agent, { ...input, approvalId: oldApproval }), { code: 'FORBIDDEN' });
    assert.equal(provider.sends.length, 0);
    const newApproval = await proposal(sendWhatsAppText(agent, input));
    await approveProposal(fixture.context, newApproval);
    assert.equal((await sendWhatsAppText(agent, { ...input, approvalId: newApproval })).status, 'accepted');
    assert.equal(provider.sends.length, 1);
  });
});

test('WhatsApp send: the 24-hour boundary is exclusive and untrusted future timestamps do not open it', async () => {
  const now = Date.parse('2026-09-27T12:00:00.000Z');
  assert.equal(isReplyWindowOpen('2026-09-26T12:00:00.000Z', now), false);
  assert.equal(isReplyWindowOpen('2026-09-26T12:00:00.001Z', now), true);
  assert.equal(replyWindow('2026-09-27T12:01:00.001Z', now), null);
  assert.equal(isReplyWindowOpen(null, now), false);
  assert.equal(isReplyWindowOpen('not-a-date', now), false);
  for (const lastCustomerMessageAt of [null, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 120_000).toISOString()]) {
    const fixture = await whatsappFixture({ lastCustomerMessageAt });
    const provider = new FakeWhatsApp(fixture);
    await provider.run(async () => {
      await assert.rejects(sendWhatsAppText(fixture.context, intent(fixture)), { code: 'SCOPE_REQUIRED' });
      assert.equal(provider.sends.length, 0);
      await testDb.prepare("UPDATE whatsapp_thread SET last_customer_message_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE id=?").run(fixture.threadId);
      assert.equal((await sendWhatsAppText(fixture.context, intent(fixture))).status, 'accepted');
      assert.equal(provider.sends.length, 1);
    });
  }
});

test('WhatsApp send: the reply window is checked again immediately before dispatch', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  let evaluations = 0;
  await provider.run(async () => {
    await assert.rejects(sendWhatsAppText(fixture.context, intent(fixture)), { code: 'SCOPE_REQUIRED' });
    assert.equal(provider.sends.length, 0);
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_send WHERE office_id=?').get<{ status: string }>(fixture.officeId))?.status, 'failed');
  }, { FLAGS: { getBooleanValue: async () => {
    evaluations += 1;
    if (evaluations === 2) await testDb.prepare("UPDATE whatsapp_thread SET last_customer_message_at=CURRENT_TIMESTAMP-INTERVAL '25 hours' WHERE id=?").run(fixture.threadId);
    return true;
  } } });
});

test('WhatsApp send: a revoked membership during the operation prevents dispatch even with a stale trusted context', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    await assert.rejects(sendWhatsAppText(fixture.context, intent(fixture)), { code: 'FORBIDDEN' });
    assert.equal(provider.sends.length, 0);
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_send WHERE office_id=?').get<{ status: string }>(fixture.officeId))?.status, 'failed');
  }, { FLAGS: { getBooleanValue: async () => {
    await testDb.prepare("DELETE FROM office_member WHERE office_id=? AND user_id=?").run(fixture.officeId, fixture.userId);
    return true;
  } } });
});

test('WhatsApp send: provider authentication loss requires reconnect and never retries the rejected message', async () => {
  const fixture = await whatsappFixture();
  const provider = new FakeWhatsApp(fixture).on('POST', `/api/v1/inbox/conversations/${fixture.providerThreadId}/messages`, () => whatsappJson({ error: 'Unauthorized' }, 401));
  await provider.run(async () => {
    assert.equal((await sendWhatsAppText(fixture.context, intent(fixture))).status, 'failed');
    assert.equal((await whatsappStatus(fixture.context)).connection?.status, 'reconnect_required');
    await assert.rejects(sendWhatsAppText(fixture.context, intent(fixture)), { code: 'NOT_READY' });
    assert.equal(provider.sends.length, 1);
    assert.equal((await testDb.prepare('SELECT generation FROM whatsapp_connection WHERE id=?').get<{ generation: number }>(fixture.connectionId))?.generation, 2);
  });
});
