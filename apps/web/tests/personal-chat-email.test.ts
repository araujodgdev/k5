import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { withPersonalChatEnvironment } from '../src/lib/personal-chat/environment';
import { sendPersonalEmail, withPersonalEmailTransport } from '../src/lib/personal-chat/email-transport';
import { runPersonalEmailPass } from '../src/lib/personal-chat/email-worker';

const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_EMAIL_API_TOKEN: 'test-email-token', TISES_MESSAGES_FROM: 'mensagens@tises.test', BETTER_AUTH_URL: 'https://tises.test', K5_CREDENTIALS_KEY: Buffer.alloc(32, 61).toString('base64') };
const input = { to: 'destino@example.test', subject: 'Mensagem', text: 'Conteúdo', html: '<p>Conteúdo</p>' };
const accepted = (to = input.to) => Response.json({ success: true, result: { delivered: [], queued: [to], permanent_bounces: [], message_id: 'provider-message' } });

async function fixture() {
  const userId = randomUUID(), sessionId = randomUUID(), threadId = randomUUID(), invitationId = randomUUID(), messageId = randomUUID(), outboxId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const encrypted = encryptCredential(token, parseCredentialKeyring(env.K5_CREDENTIALS_KEY));
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@tises.test`, 'Advogada de teste');
  await testDb.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(sessionId, userId, randomUUID());
  await testDb.prepare('INSERT INTO personal_thread(id,created_by) VALUES(?,?)').run(threadId, userId);
  await testDb.prepare('INSERT INTO personal_thread_participant(thread_id,user_id) VALUES(?,?)').run(threadId, userId);
  await testDb.prepare(`INSERT INTO personal_thread_invitation(id,thread_id,normalized_email,token_hash,encrypted_token,invited_by,expires_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '7 days')`).run(invitationId, threadId, input.to, createHash('sha256').update(token).digest('hex'), encrypted, userId);
  await testDb.prepare(`INSERT INTO personal_message(id,thread_id,sequence,sender_user_id,sender_session_id,client_message_id,input_hash,body_kind,body_json) VALUES(?,?,1,?,?,?,?,'text',?::jsonb)`).run(messageId, threadId, userId, sessionId, randomUUID(), 'hash', JSON.stringify({ kind: 'text', text: 'Olá <cliente> & equipe' }));
  await testDb.prepare(`INSERT INTO personal_email_outbox(id,message_id,thread_id,invitation_id,recipient_email,encrypted_action_token) VALUES(?,?,?,?,?,?)`).run(outboxId, messageId, threadId, invitationId, input.to, encrypted);
  return { userId, sessionId, threadId, invitationId, outboxId, token };
}
async function state(id: string) { return testDb.prepare('SELECT state,error_code,attempts,encrypted_action_token FROM personal_email_outbox WHERE id=?').get<{ state: string; error_code: string | null; attempts: number; encrypted_action_token: string }>(id); }
function run<T>(fetcher: Parameters<typeof withPersonalEmailTransport>[0], action: () => T) { return withPersonalChatEnvironment(env, () => withPersonalEmailTransport(fetcher, action)); }

test('external text is delivered once with an escaped body, authenticated claim link and outbound-only notice', async () => {
  const f = await fixture(); let calls = 0;
  await run(async (url, init) => {
    calls += 1;
    assert.equal(url.href, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`);
    assert.equal(init.redirect, 'manual');
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.to, input.to);
    assert.ok(payload.text.includes(`https://tises.test/messages/claim/${f.token}`));
    assert.ok(payload.text.includes('Respostas por e-mail não entram na conversa.'));
    assert.ok(payload.html.includes('&lt;cliente&gt; &amp; equipe'));
    assert.equal(payload.attachments, undefined);
    return accepted();
  }, async () => { assert.equal(await runPersonalEmailPass({ max: 1 }), 1); assert.equal(await runPersonalEmailPass({ max: 1 }), 0); });
  assert.equal(calls, 1); assert.equal((await state(f.outboxId))?.state, 'accepted');
  assert.equal((await state(f.outboxId))?.encrypted_action_token, '');
});

test('network ambiguity and provider 5xx never become automatic retries', async () => {
  for (const fetcher of [async () => { throw new Error('connection lost'); }, async () => Response.json({ success: false }, { status: 500 })]) {
    const f = await fixture(); let calls = 0;
    await run(async () => { calls += 1; return fetcher(); }, async () => { await runPersonalEmailPass({ max: 1 }); await runPersonalEmailPass({ max: 1 }); });
    assert.equal(calls, 1); assert.equal((await state(f.outboxId))?.state, 'unknown');
  }
});

test('lease expiry after dispatch fences both recovery and a late provider response', async () => {
  const f = await fixture(); let calls = 0;
  let release: (response: Response) => void = () => { throw new Error('not started'); };
  let started: () => void = () => {};
  const boundary = new Promise<void>(resolve => { started = resolve; });
  await run(async () => { calls += 1; started(); return new Promise<Response>(resolve => { release = resolve; }); }, async () => {
    const first = runPersonalEmailPass({ max: 1 });
    await boundary;
    await testDb.prepare("UPDATE personal_email_outbox SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?").run(f.outboxId);
    assert.equal(await runPersonalEmailPass({ max: 1 }), 0);
    release(accepted()); await first;
    assert.equal(await runPersonalEmailPass({ max: 1 }), 0);
  });
  assert.equal(calls, 1); assert.equal((await state(f.outboxId))?.state, 'unknown');
});

test('expired lease before dispatch can be recovered without duplicating a send', async () => {
  const f = await fixture(); let calls = 0;
  await testDb.prepare("UPDATE personal_email_outbox SET state='leased',lease_token=?,lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second',dispatched_at=NULL WHERE id=?").run(randomUUID(), f.outboxId);
  await run(async () => { calls += 1; return accepted(); }, () => runPersonalEmailPass({ max: 1 }));
  assert.equal(calls, 1); assert.equal((await state(f.outboxId))?.state, 'accepted');
});

test('revoked session and blocked conversation cancel pending external sends', async () => {
  for (const revoke of ['session', 'block'] as const) {
    const f = await fixture();
    if (revoke === 'session') await testDb.prepare('DELETE FROM session WHERE id=?').run(f.sessionId);
    else await testDb.prepare('UPDATE personal_thread_participant SET blocked_at=CURRENT_TIMESTAMP WHERE thread_id=?').run(f.threadId);
    await run(async () => { assert.fail('The provider must not receive revoked messages.'); }, () => runPersonalEmailPass({ max: 1 }));
    assert.equal((await state(f.outboxId))?.state, 'cancelled');
  }
});

test('missing configuration is a known failure before any provider call', async () => {
  const f = await fixture();
  await withPersonalChatEnvironment({}, () => withPersonalEmailTransport(async () => { assert.fail('No configured transport.'); }, () => runPersonalEmailPass({ max: 1 })));
  assert.equal((await state(f.outboxId))?.state, 'failed'); assert.equal((await state(f.outboxId))?.error_code, 'not_configured');
});

test('only an explicit recipient outcome is treated as accepted', async () => {
  const cases = [
    { body: { success: true, result: { queued: ['someone-else@example.test'] } }, status: 200, expected: 'unknown' },
    { body: { success: true, result: { permanent_bounces: [input.to] } }, status: 200, expected: 'failed' },
    { body: { success: false, errors: [{ code: 10004 }] }, status: 429, expected: 'retry' },
    { body: { success: false, errors: [{ code: 10001 }] }, status: 400, expected: 'failed' },
    { body: { success: true, result: { queued: [input.to] } }, status: 200, expected: 'accepted' },
  ];
  for (const item of cases) {
    const result = await run(async () => Response.json(item.body, { status: item.status }), () => sendPersonalEmail(input));
    assert.equal(result.state, item.expected);
  }
});

test('the web Worker sends through its send_email binding, with only the sender configured', async () => {
  const sent: unknown[] = [];
  const binding = { send: async (message: unknown) => { sent.push(message); return { messageId: 'msg-1' }; } };
  const message = { to: 'ana@example.test', subject: 'Confirme seu e-mail no Lume', text: 'texto', html: '<p>texto</p>' };
  const accepted = await withPersonalChatEnvironment({ EMAIL: binding, TISES_MESSAGES_FROM: 'nao-responda@notify.lume.software' }, () => sendPersonalEmail(message));
  assert.deepEqual(accepted, { state: 'accepted', providerRef: 'msg-1' });
  assert.deepEqual(sent, [{ from: 'nao-responda@notify.lume.software', ...message }]);

  const throttled = { send: async () => { throw Object.assign(new Error('rate'), { code: 'E_RATE_LIMIT_EXCEEDED' }); } };
  assert.deepEqual(await withPersonalChatEnvironment({ EMAIL: throttled, TISES_MESSAGES_FROM: 'nao-responda@notify.lume.software' }, () => sendPersonalEmail(message)),
    { state: 'retry', code: 'throttled' });
  const unverified = { send: async () => { throw Object.assign(new Error('sender'), { code: 'E_SENDER_NOT_VERIFIED' }); } };
  assert.deepEqual(await withPersonalChatEnvironment({ EMAIL: unverified, TISES_MESSAGES_FROM: 'nao-responda@notify.lume.software' }, () => sendPersonalEmail(message)),
    { state: 'failed', code: 'e_sender_not_verified' });
  assert.deepEqual(await withPersonalChatEnvironment({ EMAIL: binding }, () => sendPersonalEmail(message)), { state: 'failed', code: 'not_configured' }, 'no sender, no e-mail');
});
