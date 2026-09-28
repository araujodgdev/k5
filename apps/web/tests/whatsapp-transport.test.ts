import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { whatsappEnvironment, withWhatsAppEnvironment } from '../src/lib/whatsapp/environment';
import { connectionUrl, createProfile, createProfileKey, deleteAccount, getAccount,
  listProviderConversations, listProviderMessages, revokeKey, sendProviderText } from '../src/lib/whatsapp/provider';
import { withWhatsAppTransport, zernioRequest, ZernioError } from '../src/lib/whatsapp/transport';

const json = (value: unknown, status = 200) => Response.json(value, { status });
const answer = z.object({ value: z.string() });
const deniedGroups = ['publishing', 'engagement', 'contacts', 'analytics', 'ads', 'telephony', 'accounts', 'billing', 'webhooks'];

test('WhatsApp transport keeps bearer credentials on its fixed endpoint and parses the schema', async () => {
  const result = await withWhatsAppTransport(async (input, init) => {
    assert.equal(String(input), 'https://zernio.com/api/v1/inbox/conversations?accountId=account-a&cursor=opaque%2Fcursor');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tenant-a');
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.cache, 'no-store');
    return json({ value: 'parsed', ignored: 'discarded' });
  }, () => zernioRequest('tenant-a', '/inbox/conversations', {
    query: { accountId: 'account-a', cursor: 'opaque/cursor', omitted: undefined }, schema: answer,
  }));
  assert.deepEqual(result, { value: 'parsed' });
  for (const path of ['https://evil.example/x', '//evil.example/x', '/../../outside', '/accounts?redirect=evil', '/a\\b']) {
    await assert.rejects(() => withWhatsAppTransport(async () => json({ value: 'unexpected' }),
      () => zernioRequest('tenant-a', path, { schema: answer })), { code: 'invalid_request', isAmbiguous: false });
  }
});

test('WhatsApp transport classifies refusals without retaining response bodies or keys', async () => {
  const cases: [number, string, boolean][] = [
    [302, 'redirect', false], [401, 'unauthorized', false], [403, 'forbidden', false],
    [404, 'not_found', false], [409, 'conflict', false], [429, 'rate_limited', false], [503, 'http_error', true],
  ];
  for (const [status, code, ambiguous] of cases) {
    await assert.rejects(() => withWhatsAppTransport(async () => new Response('secret-body-tenant', {
      status, headers: { location: 'https://evil.example/secret-key' },
    }), () => zernioRequest('secret-key-tenant', '/profiles', { schema: answer })), (error: unknown) => {
      assert.ok(error instanceof ZernioError);
      assert.deepEqual([error.status, error.code, error.isAmbiguous], [status, code, ambiguous]);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /secret-|evil\.example/);
      return true;
    });
  }
});

test('WhatsApp transport treats malformed success and network errors as uncertain', async () => {
  for (const response of [new Response('{"secret":"private"'), json({ secret: 'private' })]) {
    await assert.rejects(() => withWhatsAppTransport(async () => response,
      () => zernioRequest('tenant-key', '/profiles', { schema: answer })),
    { status: 200, code: 'invalid_response', isAmbiguous: true });
  }
  await assert.rejects(() => withWhatsAppTransport(async () => { throw new Error('secret-network-detail'); },
    () => zernioRequest('tenant-key', '/profiles', { schema: answer })), (error: unknown) => {
    assert.ok(error instanceof ZernioError);
    assert.equal(error.code, 'network_error');
    assert.equal(error.isAmbiguous, true);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /secret-network-detail/);
    return true;
  });
});

test('WhatsApp transport cancels streamed and declared oversized responses', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(() => withWhatsAppTransport(async () => response,
    () => zernioRequest('key', '/profiles', { schema: answer })),
  { code: 'response_too_large', isAmbiguous: true });
  assert.equal(cancelled, true);
  await assert.rejects(() => withWhatsAppTransport(async () => new Response('{}', {
    headers: { 'content-length': '1048577' },
  }), () => zernioRequest('key', '/profiles', { schema: answer })), { code: 'response_too_large' });
});

test('WhatsApp transport bounds a hung fetch and aborts it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const pending = withWhatsAppTransport(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; });
    return new Promise<Response>(() => undefined);
  }, () => zernioRequest('key', '/profiles', { schema: answer }));
  t.mock.timers.tick(10_001);
  await assert.rejects(pending, { code: 'timeout', status: null, isAmbiguous: true });
  assert.equal(aborted, true);
});

test('WhatsApp environment and transport remain isolated across concurrent requests', async () => {
  const barrier = Promise.withResolvers<void>();
  let arrived = 0;
  const run = (officeId: string) => withWhatsAppEnvironment({ ZERNIO_API_KEY: officeId },
    () => withWhatsAppTransport(async (_input, init) => {
      arrived++;
      if (arrived === 2) barrier.resolve();
      await barrier.promise;
      assert.equal(whatsappEnvironment().ZERNIO_API_KEY, officeId);
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${officeId}`);
      return json({ profile: { _id: `profile-${officeId}`, name: `Tises-${officeId}` } });
    }, () => createProfile(officeId)));
  assert.deepEqual(await Promise.all([run('office-a'), run('office-b')]), [{ id: 'profile-office-a' }, { id: 'profile-office-b' }]);
});

test('profile administration uses only the master key and stable creation idempotency', async () => {
  await withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master-key' }, () => withWhatsAppTransport(async (input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer master-key');
    assert.equal(String(input), 'https://zernio.com/api/v1/profiles');
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'tises-profile-office-a');
    const body: unknown = JSON.parse(String(init?.body));
    assert.deepEqual(body, { name: 'Tises-office-a' });
    return json({ profile: { _id: 'profile-a', name: 'Tises-office-a' } }, 201);
  }, async () => { assert.deepEqual(await createProfile('office-a'), { id: 'profile-a' }); }));
  await assert.rejects(() => withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master-key' },
    () => withWhatsAppTransport(async () => json({ details: { existingProfileId: 'foreign-profile' } }, 409),
      () => createProfile('office-a'))), { code: 'conflict' });
  await assert.rejects(() => withWhatsAppEnvironment({}, () => createProfile('office-a')), { code: 'not_configured' });
});

test('profile key grants message read/write only within its one profile', async () => {
  const result = await withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master-key' },
    () => withWhatsAppTransport(async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer master-key');
      const body: unknown = JSON.parse(String(init?.body));
      assert.deepEqual(body, { name: 'Tises-profile-a', scope: 'profiles', profileIds: ['profile-a'],
        permission: 'read-write', disabledResourceGroups: deniedGroups });
      return json({ apiKey: { id: 'key-id', key: 'tenant-key', scope: 'profiles',
        profileIds: [{ _id: 'profile-a', name: 'Tises-office-a' }], permission: 'read-write', disabledResourceGroups: deniedGroups } }, 201);
    }, () => createProfileKey('profile-a')));
  assert.deepEqual(result, { id: 'key-id', key: 'tenant-key' });
});

test('a broader profile key is revoked and never returned', async () => {
  let revoked = false;
  await assert.rejects(() => withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master-key' },
    () => withWhatsAppTransport(async (input, init) => {
      if (init?.method === 'DELETE') {
        assert.equal(String(input), 'https://zernio.com/api/v1/api-keys/broad-key');
        revoked = true;
        return json({ message: 'deleted' });
      }
      return json({ apiKey: { id: 'broad-key', key: 'secret', scope: 'full', profileIds: [],
        permission: 'read-write', disabledResourceGroups: [] } }, 201);
    }, () => createProfileKey('profile-a'))), { code: 'key_scope_mismatch', isAmbiguous: false });
  assert.equal(revoked, true);
});

test('a malformed key scope is revoked while missing or unsafe headers never leave the request boundary', async () => {
  let revoked = false;
  await assert.rejects(() => withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master-key' },
    () => withWhatsAppTransport(async (_input, init) => {
      if (init?.method === 'DELETE') { revoked = true; return json({ message: 'deleted' }); }
      return json({ apiKey: { id: 'key-id', key: 'secret', scope: { invalid: true } } }, 201);
    }, () => createProfileKey('profile-a'))), { code: 'key_scope_mismatch' });
  assert.equal(revoked, true);
  for (const key of ['', 'secret\nkey', 'secret\u0100']) {
    await assert.rejects(() => withWhatsAppTransport(async () => json({ value: 'unexpected' }),
      () => zernioRequest(key, '/profiles', { schema: answer })), { code: 'invalid_request', isAmbiguous: false });
  }
});

test('connection URL permits only trusted HTTPS origins and requests hosted pt-BR coexistence', async () => {
  for (const authUrl of ['https://zernio.com/connect/token', 'https://www.facebook.com/dialog/oauth', 'https://facebook.com/dialog/oauth']) {
    const result = await withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master' },
      () => withWhatsAppTransport(async (input) => {
        const url = new URL(input);
        assert.equal(url.searchParams.get('onboarding'), 'business_app');
        assert.equal(url.searchParams.get('language'), 'pt-BR');
        assert.equal(url.searchParams.get('signup'), 'hosted');
        assert.equal(url.searchParams.get('redirect_url'), 'https://tises.example/callback?state=opaque');
        return json({ authUrl });
      }, () => connectionUrl('profile-a', 'https://tises.example/callback?state=opaque')));
    assert.equal(result, authUrl);
  }
  for (const authUrl of ['http://zernio.com/c', 'https://zernio.com.evil.example/c', 'https://secret@zernio.com/c', 'https://zernio.com:444/c']) {
    await assert.rejects(() => withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master' },
      () => withWhatsAppTransport(async () => json({ authUrl }),
        () => connectionUrl('profile-a', 'https://tises.example/callback'))), { code: 'unsafe_auth_url' });
  }
});

test('account verification checks returned profile, account, platform and active state', async () => {
  const account = { _id: 'account-a', profileId: { _id: 'profile-a' }, platform: 'whatsapp',
    isActive: true, username: '+5511999999999', displayName: 'Escritório' };
  const result = await withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master' },
    () => withWhatsAppTransport(async (input, init) => {
      const url = new URL(input);
      assert.equal(url.searchParams.get('profileId'), 'profile-a');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer master');
      return json({ accounts: [account] });
    }, () => getAccount('account-a', 'profile-a')));
  assert.deepEqual(result, { id: 'account-a', profileId: 'profile-a', number: '+5511999999999', label: 'Escritório' });
  for (const changed of [{ _id: 'foreign' }, { profileId: { _id: 'foreign' } }, { platform: 'instagram' }, { isActive: false }, { needsReconnection: true }]) {
    await assert.rejects(() => withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master' },
      () => withWhatsAppTransport(async () => json({ accounts: [{ ...account, ...changed }] }),
        () => getAccount('account-a', 'profile-a'))), { code: 'account_mismatch' });
  }
});

test('conversation and message reads normalize official fields, canonical IDs and attachments', async () => {
  const thread = { id: 'platform-thread', accountId: 'account-a', platform: 'whatsapp', participantId: '5511888888888',
    participantName: 'Ana', lastMessage: 'Olá', updatedTime: '2026-09-27T08:00:00-03:00', unreadCount: 2 };
  const conversations = await withWhatsAppTransport(async (input, init) => {
    assert.equal(new URL(input).searchParams.get('profileId'), 'profile-a');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tenant');
    return json({ data: [thread, { ...thread, id: 'group', isGroup: true }], pagination: { hasMore: true, nextCursor: 'opaque' } });
  }, () => listProviderConversations('tenant', 'account-a', 'profile-a'));
  assert.deepEqual(conversations, { items: [{ id: 'platform-thread', participantId: '5511888888888',
    participantName: 'Ana', lastText: 'Olá', updatedAt: '2026-09-27T11:00:00.000Z', unreadCount: 2 }], nextCursor: 'opaque' });

  const messages = await withWhatsAppTransport(async (input) => {
    assert.equal(new URL(input).searchParams.get('sortOrder'), 'desc');
    return json({ messages: [{ id: 'wamid.1', conversationId: 'zernio-internal-thread', accountId: 'account-a', platform: 'whatsapp',
      message: 'Resposta', direction: 'outgoing', createdAt: '2026-09-27T11:00:00Z', deliveryStatus: 'read',
      metadata: { source: 'whatsapp_business_app' }, isEdited: true, attachments: [
        { type: 'file', filename: 'petição.pdf', mimeType: 'application/pdf', url: 'https://secret.example/media' },
      ] }], pagination: { hasMore: false, nextCursor: null } });
  }, () => listProviderMessages('tenant', 'account-a', 'platform-thread'));
  assert.deepEqual(messages, { items: [{ id: 'wamid.1', conversationId: 'platform-thread', text: 'Resposta',
    direction: 'outbound', source: 'whatsapp_business_app', createdAt: '2026-09-27T11:00:00.000Z', contentUpdatedAt: '2026-09-27T11:00:00.000Z', status: 'read',
    deleted: false, edited: true, attachments: [{ kind: 'file', filename: 'petição.pdf', mimeType: 'application/pdf' }] }], nextCursor: null });
});

test('partial, cross-account and invalid-date reads cannot become completed history', async () => {
  const thread = { id: 'thread', accountId: 'account-a', platform: 'whatsapp', participantId: 'person', updatedTime: '2026-09-27T11:00:00Z' };
  for (const response of [
    { data: [thread], pagination: { hasMore: false }, meta: { accountsFailed: 1 } },
    { data: [{ ...thread, accountId: 'foreign' }], pagination: { hasMore: false } },
    { data: [thread], pagination: { hasMore: true, nextCursor: null } },
    { data: [{ ...thread, updatedTime: 'invalid' }], pagination: { hasMore: false } },
  ]) {
    await assert.rejects(() => withWhatsAppTransport(async () => json(response),
      () => listProviderConversations('tenant', 'account-a', 'profile-a')), { isAmbiguous: true });
  }
});

test('text send uses the tenant key, text-only body and caller idempotency without retrying errors', async () => {
  const result = await withWhatsAppTransport(async (input, init) => {
    assert.equal(String(input), 'https://zernio.com/api/v1/inbox/conversations/thread%2Fopaque/messages');
    const body: unknown = JSON.parse(String(init?.body));
    assert.deepEqual(body, { accountId: 'account-a', message: 'Pode revisar o documento?' });
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'send-id');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tenant');
    return json({ success: true, data: { messageId: 'wamid.sent', conversationId: 'internal' } });
  }, () => sendProviderText('tenant', 'account-a', 'thread/opaque', 'Pode revisar o documento?', 'send-id'));
  assert.deepEqual(result, { messageId: 'wamid.sent' });
  let attempts = 0;
  await assert.rejects(() => withWhatsAppTransport(async () => { attempts++; return json({ secret: 'x' }, 503); },
    () => sendProviderText('tenant', 'account-a', 'thread', 'Mensagem', 'send-id')), { isAmbiguous: true });
  assert.equal(attempts, 1);
});

test('account disconnect and key revocation accept already absent resources', async () => {
  const removed: string[] = [];
  await withWhatsAppEnvironment({ ZERNIO_API_KEY: 'master' }, () => withWhatsAppTransport(async (input, init) => {
    assert.equal(init?.method, 'DELETE');
    removed.push(new URL(input).pathname);
    return json({ error: 'absent' }, 404);
  }, async () => { await deleteAccount('account-a'); await revokeKey('key-a'); }));
  assert.deepEqual(removed, ['/api/v1/accounts/account-a', '/api/v1/api-keys/key-a']);
});
