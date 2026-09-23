import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { accessToken, completeGoogleConnect, disconnectGoogle, startGoogleConnect, requireConnection, reencryptGoogleSecrets } from '../src/lib/google/connections';
import { runGoogleOperation, markOperationEffect, type OperationSpec } from '../src/lib/google/operations';
import { setGoogleTransport, GoogleNetworkError } from '../src/lib/google/transport';
import { approveProposal, approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { googleApprovalReview } from '../src/lib/google/approval-review';
import { withGoogleEnvironment, googleEnvironment } from '../src/lib/google/environment';
import { googleMaintenance } from '../src/lib/google/worker';
import { dueProcessors } from '../src/lib/processor-schedule';

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

test('resposta perdida mantém unknown e bloqueia envio equivalente com chave nova', async () => {
  const f=await googleFixture(); await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  let calls=0;
  const uncertain: Partial<OperationSpec<string>>={ effectKey:'draft:one',execute:async()=>{calls++;throw new GoogleNetworkError('response');},reconcile:async()=>({state:'unknown'}) };
  assert.equal((await runGoogleOperation(f.context,spec({idempotencyKey:'unknown-key'},uncertain))).operation.status,'unknown');
  await assert.rejects(()=>runGoogleOperation(f.context,spec({idempotencyKey:'different-key'},uncertain)),/equivalente/);
  await assert.rejects(()=>runGoogleOperation(f.context,spec({idempotencyKey:'delete-while-unknown'}, {...uncertain,capabilityName:'k5_gmail_delete_draft',actions:['gmail.draft']})),/equivalente/);
  assert.equal((await runGoogleOperation(f.context,spec({idempotencyKey:'unknown-key'},uncertain))).operation.status,'unknown');
  assert.equal(calls,1);
});

test('checkpoint de efeito parcial permanece cifrado; falha posterior não libera repetição', async()=>{
  const f=await googleFixture(); await setRule(f.officeId,'gmail.send',{mode:'automatic'});
  const result=await runGoogleOperation(f.context,spec({}, {execute:async op=>{await markOperationEffect(op,{private:'sigiloso'});throw new Error('failure');}}));
  assert.equal(result.operation.status,'unknown');
  const row=await testDb.prepare('SELECT checkpoint_json FROM google_operation WHERE id=?').get<{checkpoint_json:string}>(result.operation.id);
  assert.ok(row); assert.ok(!row.checkpoint_json.includes('sigiloso'));
  assert.deepEqual(JSON.parse(decryptCredential(row.checkpoint_json,parseCredentialKeyring())),{private:'sigiloso'});
  await reencryptGoogleSecrets(testDb,parseCredentialKeyring());
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
