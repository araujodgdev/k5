import { FakeWhatsApp, testDb, whatsappFixture, whatsappIdentity, whatsappJson, whatsappSession } from './whatsapp-send-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  beginWhatsAppConnect, completeWhatsAppConnect, connectedCredential, disconnectWhatsApp,
  finishDisconnect, requireWhatsApp, whatsappStatus,
} from '../src/lib/whatsapp/connection';
import type { ConnectionRow } from '../src/lib/whatsapp/domain';
import { CapabilityError } from '../src/lib/capabilities/errors';

test('WhatsApp connection: an administrator connects the office through a single-use callback and an encrypted profile key', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    assert.deepEqual(await beginWhatsAppConnect(fixture.context), { url: 'https://zernio.com/connect/whatsapp-test' });
    const input = provider.callback();
    const pending = await testDb.prepare('SELECT state_hash,status,user_id,session_id FROM whatsapp_connect_state WHERE office_id=?')
      .get<{ state_hash: string; status: string; user_id: string; session_id: string }>(fixture.officeId);
    assert.deepEqual(pending, { state_hash: createHash('sha256').update(input.state).digest('hex'), status: 'pending', user_id: fixture.userId, session_id: fixture.sessionId });
    assert.deepEqual(await completeWhatsAppConnect(fixture.context, input), { connected: true });
    const connection = await requireWhatsApp(fixture.context);
    assert.equal(connection.account_id, fixture.accountId);
    assert.equal(connection.profile_id, fixture.profileId);
    assert.equal(connection.status, 'connected');
    assert.notEqual(connection.encrypted_api_key, fixture.profileKey);
    assert.equal(connectedCredential(connection), fixture.profileKey);
    const status = await whatsappStatus(fixture.context);
    assert.equal(status.canManage, true);
    assert.equal(status.connection?.number, '+55 11 99999-9999');
    assert.equal(status.connection?.label, 'Escritório WhatsApp');
    assert.equal(JSON.stringify(status).includes(fixture.profileKey), false);
    const jobs = await testDb.prepare('SELECT kind,status,generation FROM whatsapp_job WHERE office_id=?').all(fixture.officeId);
    assert.deepEqual(jobs, [{ kind: 'conversations', status: 'queued', generation: 1 }]);
    const calls = provider.calls.length;
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'CONFLICT' });
    assert.equal(provider.calls.length, calls);
    const provisioned = await testDb.prepare('SELECT key_operation_id,key_provisioning_state FROM whatsapp_connection WHERE office_id=?')
      .get<{ key_operation_id: string | null; key_provisioning_state: string }>(fixture.officeId);
    assert.ok(provisioned?.key_operation_id);
    assert.match(provisioned.key_operation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(provisioned.key_provisioning_state, 'ready');
    const keyRequest = provider.calls.find(call => call.url.pathname === '/api/v1/api-keys');
    assert.ok(keyRequest);
    assert.deepEqual(keyRequest.body, { name: `Tises-${fixture.profileId}-${provisioned.key_operation_id}`, scope: 'profiles', profileIds: [fixture.profileId], permission: 'read-write',
      disabledResourceGroups: ['publishing', 'engagement', 'contacts', 'analytics', 'ads', 'telephony', 'accounts', 'billing', 'webhooks'] });
  });
});

test('WhatsApp connection: callback state is bound to its office, person and live session', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const otherOffice = await whatsappIdentity();
  const colleague = await whatsappIdentity();
  const anotherSession = await whatsappSession(fixture.userId);
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    await beginWhatsAppConnect(fixture.context);
    const input = provider.callback();
    const calls = provider.calls.length;
    for (const context of [otherOffice.context, colleague.context, { ...fixture.context, sessionId: anotherSession }]) {
      await assert.rejects(completeWhatsAppConnect(context, input), { code: 'CONFLICT' });
    }
    assert.equal(provider.calls.length, calls);
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_connect_state WHERE office_id=?').get<{ status: string }>(fixture.officeId))?.status, 'pending');
    assert.deepEqual(await completeWhatsAppConnect(fixture.context, input), { connected: true });
    assert.equal((await whatsappStatus(otherOffice.context)).connection, null);
  });
});

test('WhatsApp connection: a callback for another profile is consumed without requesting an account or key', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    await beginWhatsAppConnect(fixture.context);
    const input = provider.callback();
    const calls = provider.calls.length;
    await assert.rejects(completeWhatsAppConnect(fixture.context, { ...input, profileId: 'another-office-profile' }), { code: 'FORBIDDEN' });
    assert.equal(provider.calls.length, calls);
    assert.equal((await whatsappStatus(fixture.context)).connection?.status, 'reconnect_required');
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_connect_state WHERE office_id=?').get<{ status: string }>(fixture.officeId))?.status, 'consumed');
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'CONFLICT' });
  });
});

test('WhatsApp connection: provider account ownership is checked before issuing a profile key', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture).on('GET', '/api/v1/accounts', () => whatsappJson({ accounts: [{
    _id: fixture.accountId, profileId: 'another-office-profile', platform: 'whatsapp', isActive: true,
  }] }));
  await provider.run(async () => {
    await beginWhatsAppConnect(fixture.context);
    await assert.rejects(completeWhatsAppConnect(fixture.context, provider.callback()), { code: 'account_mismatch' });
    const row = await testDb.prepare('SELECT status,encrypted_api_key,account_id FROM whatsapp_connection WHERE office_id=?').get(fixture.officeId);
    assert.deepEqual(row, { status: 'reconnect_required', encrypted_api_key: null, account_id: null });
    assert.equal(provider.calls.filter(call => call.url.pathname === '/api/v1/api-keys').length, 0);
  });
});

test('WhatsApp connection: expired or revoked sessions and expired state cannot finish onboarding', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    await beginWhatsAppConnect(fixture.context);
    const input = provider.callback();
    await testDb.prepare("UPDATE session SET expiresAt=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?").run(fixture.sessionId);
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'UNAUTHENTICATED' });
    await testDb.prepare("UPDATE session SET expiresAt=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE id=?").run(fixture.sessionId);
    await testDb.prepare("UPDATE whatsapp_connect_state SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE office_id=?").run(fixture.officeId);
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'CONFLICT' });
    assert.equal(provider.calls.length, 2);
    assert.equal((await whatsappStatus(fixture.context)).connection?.status, 'pending');
    await testDb.prepare('DELETE FROM session WHERE id=?').run(fixture.sessionId);
    await assert.rejects(whatsappStatus(fixture.context), { code: 'UNAUTHENTICATED' });
  });
});

test('WhatsApp connection: the lawyer manages their connection and outsiders are denied', async () => {
  const lawyer = await whatsappFixture();
  const provider = new FakeWhatsApp(lawyer);
  await provider.run(async () => {
    assert.equal((await whatsappStatus(lawyer.context)).canManage, true);
    assert.equal((await requireWhatsApp(lawyer.context)).account_id, lawyer.accountId);
    const outsider = { ...lawyer.context, userId: 'another-lawyer', sessionId: undefined };
    await assert.rejects(beginWhatsAppConnect(outsider), { code: 'FORBIDDEN' });
    await assert.rejects(disconnectWhatsApp(outsider), { code: 'FORBIDDEN' });
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(await disconnectWhatsApp(lawyer.context), { status: 'disconnecting' });
    assert.equal((await whatsappStatus(lawyer.context)).connection?.status, 'disconnecting');
  });
  const fresh = await whatsappFixture({ connected: false });
  await new FakeWhatsApp(fresh).run(async () => {
    assert.deepEqual(await beginWhatsAppConnect(fresh.context), { url: 'https://zernio.com/connect/whatsapp-test' });
    assert.equal((await whatsappStatus(fresh.context)).connection?.status, 'pending');
  });
});

test('WhatsApp connection: rollout false blocks onboarding before provider fetch and preserves existing disconnect', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    provider.enabled = false;
    await assert.rejects(beginWhatsAppConnect(fixture.context), { code: 'NOT_FOUND' });
    assert.equal(provider.calls.length, 0);
    assert.equal((await whatsappStatus(fixture.context)).enabled, false);
    assert.equal((await whatsappStatus(fixture.context)).connection, null);
    assert.deepEqual(provider.flags[0], { key: 'whatsapp-integration', fallback: false,
      context: { office_id: fixture.officeId, targetingKey: fixture.officeId } });
    provider.enabled = true;
    assert.deepEqual(await beginWhatsAppConnect(fixture.context), { url: 'https://zernio.com/connect/whatsapp-test' });
    provider.enabled = false;
    await assert.rejects(completeWhatsAppConnect(fixture.context, provider.callback()), { code: 'NOT_FOUND' });
    assert.equal(provider.calls.length, 2);
  });
  const connected = await whatsappFixture();
  const connectedProvider = new FakeWhatsApp(connected);
  connectedProvider.enabled = false;
  await connectedProvider.run(async () => {
    assert.equal((await whatsappStatus(connected.context)).connection?.status, 'connected');
    assert.deepEqual(await disconnectWhatsApp(connected.context), { status: 'disconnecting' });
    const row = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(connected.connectionId);
    assert.ok(row);
    await finishDisconnect(row.id, row.generation);
    assert.equal((await whatsappStatus(connected.context)).connection?.status, 'disconnected');
    assert.deepEqual(connectedProvider.calls.map(call => [call.method, call.url.pathname]), [
      ['DELETE', `/api/v1/accounts/${connected.accountId}`], ['DELETE', `/api/v1/api-keys/${connected.apiKeyId}`],
    ]);
  });
});

test('WhatsApp connection: two concurrent starts reserve only one state and one provider profile', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture);
  await provider.run(async () => {
    const results = await Promise.allSettled([beginWhatsAppConnect(fixture.context), beginWhatsAppConnect(fixture.context)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.ok(rejected.reason instanceof CapabilityError);
    assert.equal(rejected.reason.code, 'CONFLICT');
    assert.equal(provider.calls.filter(call => call.url.pathname === '/api/v1/profiles').length, 1);
    assert.equal((await testDb.prepare('SELECT count(*)::int AS count FROM whatsapp_connect_state WHERE office_id=?').get<{ count: number }>(fixture.officeId))?.count, 1);
    assert.deepEqual(await completeWhatsAppConnect(fixture.context, provider.callback()), { connected: true });
  });
});

test('WhatsApp connection: a lost key creation response blocks a second key until the first is reconciled', async () => {
  const fixture = await whatsappFixture({ connected: false });
  const provider = new FakeWhatsApp(fixture).on('POST', '/api/v1/api-keys', () => {
    throw new Error('The key was created, but its response was lost.');
  });
  await provider.run(async () => {
    await beginWhatsAppConnect(fixture.context);
    const input = provider.callback();
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'network_error' });
    assert.deepEqual(await testDb.prepare('SELECT status,key_provisioning_state,encrypted_api_key,api_key_id FROM whatsapp_connection WHERE office_id=?').get(fixture.officeId), {
      status: 'reconnect_required', key_provisioning_state: 'unknown', encrypted_api_key: null, api_key_id: null,
    });
    await assert.rejects(completeWhatsAppConnect(fixture.context, input), { code: 'CONFLICT' });
    await assert.rejects(beginWhatsAppConnect(fixture.context), { code: 'NOT_READY' });
    assert.equal(provider.calls.filter(call => call.method === 'POST' && call.url.pathname === '/api/v1/api-keys').length, 1);
    assert.equal((await testDb.prepare('SELECT status FROM whatsapp_connect_state WHERE office_id=?').get<{ status: string }>(fixture.officeId))?.status, 'consumed');
  });
});
