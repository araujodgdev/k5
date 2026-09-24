import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { googleFixture, installFakeGoogle, respond } from './google-fixture';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { connectionView, saveConnection } from '../src/lib/typesafe/config';
import type { DecisionRequest, DecisionTransport } from '../src/lib/typesafe/client';
import { triageMail } from '../src/lib/google/gmail/triage';
import { emailTriageInput } from '../src/lib/google/gmail/triage-contracts';

async function setup(mode: 'off' | 'enabled' | 'shadow' = 'enabled') {
  const fixture = await googleFixture();
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(fixture.userId);
  await saveConnection(fixture.userId, connectionSettings.parse({ apiKey: 'synthetic-typesafe-key', enabled: true, email: mode, version: (await connectionView()).version }));
  const google = installFakeGoogle();
  let snippet = 'Trecho confidencial sintético';
  google.on('GET', /\/threads\/([a-z0-9]+)$/, (request, match) => {
    assert.equal(request.query.get('format'), 'metadata');
    assert.equal(request.query.get('fields')?.includes('body'), false);
    return respond(200, { id: match[1], messages: [{ id: 'm1', internalDate: '1790160000000', snippet,
      payload: { headers: [{ name: 'Subject', value: 'Assunto privado sintético' }, { name: 'From', value: 'Cliente <client@example.test>' }] } }] });
  });
  return { ...fixture, google, changeSnippet: (value: string) => { snippet = value; } };
}
function answer(request: DecisionRequest, uncertain = false) {
  return { model: request.model, usage: { input_tokens: 50, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    if (question.type === 'choice') return [name, { type: 'choice', choice: 'clients', confidence: uncertain ? 0.4 : 0.95,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === 'clients' ? 1 : 0])) }];
    if (question.type === 'score') return [name, { type: 'score', score: 2, confidence: 0.95, probabilities: { '0': 0, '1': 0, '2': 1 } }];
    return [name, { type: 'noul', noul: uncertain ? 0.5 : 0.9 }];
  })) };
}
const send: DecisionTransport = async (_key, request) => answer(request);

test('mail triage: bounds input, fetches metadata, caches judgments and invalidates changed snippets', async () => {
  assert.equal(emailTriageInput.safeParse({ threadIds: Array(21).fill('abc') }).success, false);
  assert.equal(emailTriageInput.safeParse({ threadIds: ['../other'] }).success, false);
  assert.equal(emailTriageInput.safeParse({ threadIds: ['abc'], officeId: 'other' }).success, false);
  const a = await setup(); let calls = 0;
  const transport: DecisionTransport = async (_key, request) => { calls++; assert.ok(JSON.stringify(request.state).includes('Trecho confidencial')); return answer(request); };
  const first = await triageMail(a.context, { threadIds: ['abc', 'abc'] }, { send: transport });
  assert.equal(first.status, 'evaluated'); assert.equal(first.items.length, 1);
  assert.equal(first.items[0].priority, 'high'); assert.equal(first.items[0].needsReply, true);
  assert.deepEqual(await triageMail(a.context, { threadIds: ['abc'] }, { send: transport }), first);
  assert.equal(calls, 1);
  const stored = await testDb.prepare('SELECT * FROM google_email_triage WHERE connection_id=?').all(a.connectionId);
  assert.equal(JSON.stringify(stored).includes('confidencial'), false);
  assert.equal(JSON.stringify(stored).includes('Assunto privado'), false);
  a.changeSnippet('A conversa mudou.');
  await triageMail(a.context, { threadIds: ['abc'] }, { send: async (_key, request) => { calls++; return answer(request); } });
  assert.equal(calls, 2);
});

test('mail triage: same thread ids never share judgments across users; uncertainty is explicit', async () => {
  const a = await setup();
  await triageMail(a.context, { threadIds: ['abc'] }, { send });
  const b = await googleFixture({ officeId: a.officeId }); let calls = 0;
  const result = await triageMail(b.context, { threadIds: ['abc'] }, { send: async (_key, request) => { calls++; return answer(request, true); } });
  assert.equal(calls, 1); assert.equal(result.items[0].uncertain, true); assert.equal(result.items[0].needsReply, null);
  assert.equal((await testDb.prepare('SELECT * FROM google_email_triage WHERE office_id=?').all(a.officeId)).length, 2);
});

test('mail triage: disabled and shadow never apply suggestions; outages do not fabricate labels', async () => {
  const disabled = await setup('off');
  assert.deepEqual(await triageMail(disabled.context, { threadIds: ['abc'] }, { send }), { status: 'disabled', items: [] });
  assert.equal(disabled.google.calls.length, 0);
  const shadow = await setup('shadow');
  assert.deepEqual(await triageMail(shadow.context, { threadIds: ['abc'] }, { send }), { status: 'disabled', items: [] });
  assert.equal((await testDb.prepare('SELECT * FROM google_email_triage WHERE connection_id=?').all(shadow.connectionId)).length, 0);
  const failed = await setup();
  const result = await triageMail(failed.context, { threadIds: ['abc'] }, { send: async () => { throw new Error('private provider detail'); } });
  assert.deepEqual(result, { status: 'unavailable', items: [] });
});

test('mail triage: missing messages are partial, and batches stay bounded', async () => {
  const a = await setup();
  a.google.on('GET', /\/threads\/gone$/, () => respond(404, { error: { message: 'gone' } }));
  let calls = 0;
  const result = await triageMail(a.context, { threadIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'gone'] }, { send: async (_key, request) => {
    calls++; assert.ok(Object.keys(request.questions).length <= 12); return answer(request);
  } });
  assert.equal(calls, 2); assert.equal(result.status, 'partial'); assert.equal(result.items.length, 5);
});

test('mail triage: removed membership or disconnected consent while evaluating never returns or caches results', async () => {
  for (const revoke of ['member', 'connection']) {
    const a = await setup();
    await assert.rejects(triageMail(a.context, { threadIds: ['abc'] }, { send: async (_key, request) => {
      if (revoke === 'member') await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(a.officeId, a.userId);
      else await testDb.prepare("UPDATE google_connection SET status='disconnected' WHERE id=?").run(a.connectionId);
      return answer(request);
    } }));
    assert.equal((await testDb.prepare('SELECT * FROM google_email_triage WHERE connection_id=?').all(a.connectionId)).length, 0);
  }
});

test('mail triage: budget and changed configuration fail without applying suggestions', async () => {
  const a = await setup();
  await testDb.prepare('UPDATE typesafe_platform_connection SET daily_tokens=1000 WHERE id=1').run();
  assert.deepEqual(await triageMail(a.context, { threadIds: ['abc'] }, { send }), { status: 'budget_exceeded', items: [] });
  const b = await setup();
  const result = await triageMail(b.context, { threadIds: ['abc'] }, { send: async (_key, request) => {
    await testDb.prepare('UPDATE typesafe_platform_connection SET version=version+1 WHERE id=1').run(); return answer(request);
  } });
  assert.deepEqual(result, { status: 'unavailable', items: [] });
});

test('mail triage: a reply draft does not hide the last sent alias message and today uses Sao Paulo', async () => {
  const a = await setup();
  a.google.on('GET', /\/threads\/abc$/, () => respond(200, { id: 'abc', messages: [
    { id: 'sent', internalDate: '1790160000000', labelIds: ['SENT'], snippet: 'Pergunta já enviada por mim', payload: { headers: [{ name: 'From', value: 'alias@example.test' }] } },
    { id: 'draft', internalDate: '1790160300000', labelIds: ['DRAFT'], snippet: 'Texto do rascunho' },
  ] }));
  const result = await triageMail(a.context, { threadIds: ['abc'] }, { now: Date.parse('2026-09-24T01:00:00Z'), send: async (_key, request) => {
    const state = request.state as { today: string; emails: { fromSelf: boolean }[] };
    assert.equal(state.today, '2026-09-23'); assert.equal(state.emails[0].fromSelf, true);
    assert.equal(JSON.stringify(state).includes('Texto do rascunho'), false);
    return answer(request);
  } });
  assert.equal(result.items[0].needsReply, false);
});

test('mail triage: revocation while metadata loads prevents transmitting it to TypeSafe', async () => {
  const a = await setup();
  a.google.on('GET', /\/threads\/abc$/, async () => {
    await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(a.officeId, a.userId);
    return respond(200, { id: 'abc', messages: [{ id: 'm1', snippet: 'Do not transmit', internalDate: '1790160000000' }] });
  });
  let calls = 0;
  await assert.rejects(triageMail(a.context, { threadIds: ['abc'] }, { send: async (_key, request) => { calls++; return answer(request); } }));
  assert.equal(calls, 0);
});
