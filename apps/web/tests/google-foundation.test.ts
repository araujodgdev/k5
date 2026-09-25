import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { accessToken, completeGoogleConnect, disconnectGoogle, startGoogleConnect, requireConnection } from '../src/lib/google/connections';
import { runGoogleOperation, markOperationEffect, type OperationSpec } from '../src/lib/google/operations';
import { GoogleApiError, setGoogleTransport } from '../src/lib/google/transport';
import { approveProposal, approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { googleApprovalReview } from '../src/lib/google/approval-review';
import { withGoogleEnvironment, googleEnvironment } from '../src/lib/google/environment';
import { googleMaintenance } from '../src/lib/google/worker';
import { dueProcessors } from '../src/lib/processor-schedule';
import { enqueueGoogleJob } from '../src/lib/google/jobs';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { getCurrentScope } from '@sentry/core';

afterEach(() => setGoogleTransport(undefined));
function spec(input: Record<string, unknown> = {}, more: Partial<OperationSpec<string>> = {}): OperationSpec<string> {
  return { module: 'gmail', actions: ['gmail.send'], capabilityName: 'k5_gmail_send', input: { body: 'Conteúdo', ...input },
    bound: { review: [{ label: 'Destinatário', value: 'pessoa@example.com' }] }, describe: 'Enviar e-mail', execute: async () => ({ result: 'sent' }), ...more };
}
async function proposal(action: () => Promise<unknown>) {
  try { await action(); assert.fail('Esperava aprovação'); }
  catch (error) { const id = approvalIdFromMessage((error as Error).message); assert.ok(id, (error as Error).message); return id; }
}
async function session(userId: string) {
  const id = randomUUID();
  await testDb.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(id,userId,randomUUID());
  return id;
}

test('OAuth: state pessoal, uso único, consentimento parcial e logout não desconecta', async () => {
  const f = await googleFixture({ connect: false });
  const sessionId = await session(f.userId);
  const owner = { ...f.context, sessionId };
  const fake = installFakeGoogle();
  const scopes = 'openid email https://www.googleapis.com/auth/gmail.readonly';
  const payload = Buffer.from(JSON.stringify({ sub: 'stable-sub', email: 'google@example.com', email_verified: true, aud: process.env.GOOGLE_OAUTH_CLIENT_ID, iss: 'https://accounts.google.com', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  fake.on('POST', /\/token$/, () => respond(200, { access_token: 'secret-access', refresh_token: 'secret-refresh', scope: scopes, expires_in: 3600, id_token: `a.${payload}.c` }));
  const started = await startGoogleConnect(owner, ['gmail']);
  const url = new URL(started.url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('prompt'), 'consent select_account');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await completeGoogleConnect({ ...owner, sessionId: 'wrong' }, { state, code: 'code' })).outcome, 'invalid');
  assert.equal((await completeGoogleConnect(owner, { state, code: 'code' })).outcome, 'partial');
  assert.equal((await completeGoogleConnect(owner, { state, code: 'code' })).outcome, 'invalid');
  const row = await testDb.prepare('SELECT * FROM google_connection WHERE user_id=?').get<{ id:string; encrypted_refresh_token: string; status: string }>(f.userId);
  assert.ok(row); assert.ok(!row.encrypted_refresh_token.includes('secret-refresh'));
  await testDb.prepare('DELETE FROM session WHERE id=?').run(sessionId);
  assert.equal(await accessToken(row.id), 'secret-access');
  await assert.rejects(() => requireConnection(owner, 'gmail'), /autorizou/);
});

test('OAuth: a token redirect is reported as a Google refusal with its status, a lost request as a network failure', async (t) => {
  const f = await googleFixture({ connect: false });
  const owner = { ...f.context, sessionId: await session(f.userId) };
  const fake = installFakeGoogle();
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
  fake.on('POST', /\/token$/, () => { throw new GoogleApiError(302, 'redirect', 'Google recusou a operação (302).'); }, 1);
  let state = new URL((await startGoogleConnect(owner, ['gmail'])).url).searchParams.get('state');
  assert.equal((await completeGoogleConnect(owner, { state, code: 'code' })).outcome, 'failed');
  assert.deepEqual(warnings.at(-1), ['google.oauth.callback failed: token_rejected', { status: '302', google_error: 'redirect' }]);
  fake.failNetwork('POST', /\/token$/);
  state = new URL((await startGoogleConnect(owner, ['gmail'])).url).searchParams.get('state');
  assert.equal((await completeGoogleConnect(owner, { state, code: 'code' })).outcome, 'failed');
  assert.equal(warnings.at(-1)?.[0], 'google.oauth.callback failed: token_network');
});

test('renovação concorrente usa um refresh; desconexão impede retorno tardio do token', async () => {
  const f = await googleFixture({ accessValid: false }); const fake = installFakeGoogle();
  const tokens = await Promise.all(Array.from({ length: 5 }, () => accessToken(f.connectionId)));
  assert.equal(new Set(tokens).size, 1); assert.equal(fake.tokenCounter, 1);
  await testDb.prepare('UPDATE google_connection SET access_expires_at=CURRENT_TIMESTAMP WHERE id=?').run(f.connectionId);
  let release!: () => void; const wait = new Promise<void>(resolve => { release=resolve; });
  let started!: () => void; const seen = new Promise<void>(resolve => { started=resolve; });
  fake.on('POST', /\/token$/, async () => { started(); await wait; return respond(200,{ access_token:'late',expires_in:3600 }); });
  const pending = accessToken(f.connectionId); const rejected = assert.rejects(pending, /encerrada/);
  await seen; await disconnectGoogle(f.context); release(); await rejected;
  assert.equal((await testDb.prepare('SELECT encrypted_access_token FROM google_connection WHERE id=?').get<{ encrypted_access_token: string|null }>(f.connectionId))?.encrypted_access_token,null);
});

for (const [status, errorBody] of [[401, { error: 'invalid_client' }], [400, { error: 'unauthorized_client' }], [400, '<html>gateway</html>'], [401, { error: { invalid: true } }]] as const) {
  test(`OAuth refresh preserves tokens and jobs after ${status} ${JSON.stringify(errorBody)}`, async t => {
    const owner = await googleFixture({ accessValid: false });
    const fake = installFakeGoogle();
    const jobId = await enqueueGoogleJob({ officeId: owner.officeId, userId: owner.userId, connectionId: owner.connectionId, kind: 'calendar_list' }, testDb);
    const snapshot = () => testDb.prepare('SELECT status,encrypted_refresh_token,encrypted_access_token,token_generation FROM google_connection WHERE id=?').get(owner.connectionId);
    const before = await snapshot();
    const captured: Error[] = [];
    t.mock.method(getCurrentScope(), 'captureException', (error: Error) => { captured.push(error); return 'test-event'; });
    fake.on('POST', /\/token$/, () => respond(status, errorBody), 1);
    await assert.rejects(accessToken(owner.connectionId), (error: unknown) => error instanceof CapabilityError && error.code === 'NOT_READY');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await testDb.prepare('SELECT status FROM google_job WHERE id=?').get<{ status: string }>(jobId))?.status, 'queued');
    assert.equal((await testDb.prepare('SELECT refresh_lease_token FROM google_connection WHERE id=?').get<{ refresh_lease_token: string | null }>(owner.connectionId))?.refresh_lease_token, null);
    assert.equal(captured.length, 1);
    assert.match(captured[0].message, /google.oauth.refresh/);
    assert.equal(await accessToken(owner.connectionId), 'access-1');
  });
}

test('OAuth invalid_grant still requires reconnection and cancels queued work', async () => {
  const owner = await googleFixture({ accessValid: false });
  const fake = installFakeGoogle();
  const jobId = await enqueueGoogleJob({ officeId: owner.officeId, userId: owner.userId, connectionId: owner.connectionId, kind: 'calendar_list' }, testDb);
  fake.on('POST', /\/token$/, () => respond(400, { error: 'invalid_grant' }));
  await assert.rejects(accessToken(owner.connectionId), (error: unknown) => error instanceof CapabilityError && error.code === 'SCOPE_REQUIRED');
  const row = await testDb.prepare('SELECT status,encrypted_access_token,refresh_lease_token FROM google_connection WHERE id=?').get(owner.connectionId);
  assert.deepEqual(row, { status: 'reauth_required', encrypted_access_token: null, refresh_lease_token: null });
  assert.equal((await testDb.prepare('SELECT status FROM google_job WHERE id=?').get<{ status: string }>(jobId))?.status, 'cancelled');
});

test('UI exige aprovação exata; mudança de conteúdo ou política invalida; proprietário isolado', async () => {
  const f = await googleFixture();
  const id = await proposal(() => runGoogleOperation(f.context, spec()));
  const row = await testDb.prepare('SELECT * FROM capability_approval WHERE id=?').get(id);
  assert.deepEqual(googleApprovalReview(row as never), [{ label:'Destinatário',value:'pessoa@example.com' }]);
  const other = await googleFixture({ officeId: f.officeId });
  await assert.rejects(() => approveProposal(other.context,id), /não encontrada/);
  await approveProposal(f.context,id);
  await assert.rejects(() => runGoogleOperation(f.context,spec({ approvalId:id,body:'Alterado' })), /alterados/);
  const result = await runGoogleOperation(f.context,spec({ approvalId:id })); assert.equal(result.operation.status,'succeeded');
  assert.equal((await runGoogleOperation(f.context,spec({ approvalId:id }))).operation.id,result.operation.id);
  const second = await proposal(() => runGoogleOperation(f.context,spec({ body:'Outro' })));
  await approveProposal(f.context,second); await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  await assert.rejects(() => runGoogleOperation(f.context,spec({body:'Outro',approvalId:second})), /alterados/);
});

test('limite automático concorrente reserva somente uma unidade e não revela conteúdo na operação', async () => {
  const f = await googleFixture(); await setRule(f.officeId,'gmail.send',{mode:'automatic',dailyLimit:1});
  const results = await Promise.allSettled([1,2].map(i => runGoogleOperation(f.context,spec({body:`Segredo ${i}`,idempotencyKey:`unique-key-${i}`}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.message,/Proposta registrada/);
  const row = await testDb.prepare('SELECT encrypted_args FROM google_operation WHERE user_id=?').get<{encrypted_args:string}>(f.userId);
  assert.ok(row); assert.ok(!row.encrypted_args.includes('Segredo'));
});

test('checkpoint de efeito parcial permanece cifrado; falha posterior não libera repetição', async()=>{
  const f=await googleFixture(); await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  const result=await runGoogleOperation(f.context,spec({}, {execute:async op=>{await markOperationEffect(op,{private:'sigiloso'});throw new Error('failure');}}));
  assert.equal(result.operation.status,'unknown');
  const row=await testDb.prepare('SELECT checkpoint_json FROM google_operation WHERE id=?').get<{checkpoint_json:string}>(result.operation.id);
  assert.ok(row); assert.ok(!row.checkpoint_json.includes('sigiloso'));
  assert.deepEqual(JSON.parse(decryptCredential(row.checkpoint_json,parseCredentialKeyring())),{private:'sigiloso'});
});

test('sessão encerrada e papel removido interrompem ações interativas',async()=>{
  const f=await googleFixture(); await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  await assert.rejects(()=>runGoogleOperation({...f.context,sessionId:'revoked'},spec()),/sessão/);
  await testDb.prepare("UPDATE office_member SET role='reviewer' WHERE user_id=?").run(f.userId);
  await assert.rejects(()=>runGoogleOperation(f.context,spec()),/escrita/);
});

test('bindings de Worker não vazam entre execuções simultâneas',async()=>{
  const results=await Promise.all(['one','two'].map(value=>withGoogleEnvironment({GOOGLE_OAUTH_CLIENT_ID:value},async()=>{await Promise.resolve();return googleEnvironment().GOOGLE_OAUTH_CLIENT_ID;})));
  assert.deepEqual(results,['one','two']);
});

test('manutenção recupera admissão interrompida e trabalhos Google acordam Node',async()=>{
  const f=await googleFixture();await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  const outcome=await runGoogleOperation(f.context,spec({idempotencyKey:'pending-recovery'}));
  // Reproduce a crash after admission (reservation exists, execution has never started).
  await testDb.prepare(`UPDATE google_operation SET status='pending',attempts=0,encrypted_result=NULL,finished_at=NULL,updated_at=CURRENT_TIMESTAMP-INTERVAL '6 minutes' WHERE id=?`).run(outcome.operation.id);
  await googleMaintenance(testDb);
  const operation=await testDb.prepare('SELECT status FROM google_operation WHERE id=?').get<{status:string}>(outcome.operation.id);
  assert.equal(operation?.status,'failed');
  const usage=await testDb.prepare('SELECT used FROM google_usage_counter WHERE user_id=?').get<{used:number}>(f.userId);
  assert.equal(usage?.used,0);
  await googleMaintenance(testDb);
  assert.equal((await testDb.prepare('SELECT used FROM google_usage_counter WHERE user_id=?').get<{used:number}>(f.userId))?.used,0);
  await testDb.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,runtime,status,run_after) VALUES(?,?,?,?,'drive_import','node','queued',CURRENT_TIMESTAMP)`).run(randomUUID(),f.officeId,f.userId,f.connectionId);
  assert.equal((await dueProcessors(testDb,Date.now(),false)).documents,true);
});

test('the fetch transport never asks Workers for redirect "error" and treats a Google redirect as a refusal', async () => {
  const original = globalThis.fetch;
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    redirect = init.redirect;
    return new Response(null, { status: 302, headers: { location: 'https://example.com/' } });
  }) as typeof fetch;
  try {
    const { fetchTransport, GoogleApiError } = await import('../src/lib/google/transport');
    await assert.rejects(
      fetchTransport.request({ url: 'https://oauth2.googleapis.com/token', method: 'POST', headers: {}, body: '', timeoutMs: 1_000, maxBytes: 1_000 }),
      (error: unknown) => error instanceof GoogleApiError && error.status === 302,
    );
    assert.equal(redirect, 'manual');
  } finally { globalThis.fetch = original; }
});
