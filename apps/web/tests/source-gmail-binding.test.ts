import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { recordingWriter, personRequestContext } from './shared-writing-fixture';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';
import { emailInsight } from '../src/lib/google/gmail/insights';
import { sendMail, saveDraft, getDraft } from '../src/lib/google/gmail/service';
import { runCapability } from '../src/lib/agent-tools';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { operationArgs, type OperationRecord } from '../src/lib/google/operations';

async function fixture() {
  const f = await googleFixture(); await setRule(f.officeId, 'gmail.send', { mode: 'automatic' });
  const google = installFakeGoogle();
  const message = { id: 'private-message', threadId: 'thread', payload: { mimeType: 'text/plain', headers: [
    { name: 'Subject', value: 'REMOTE_PRIVATE_SUBJECT' }, { name: 'Message-ID', value: '<private@example.test>' },
    { name: 'From', value: 'cliente@example.test' }, { name: 'To', value: f.email },
  ], body: { data: Buffer.from('Mensagem particular do cliente.').toString('base64url') } } };
  google.on('GET', /\/users\/me\/threads\/thread$/, () => respond(200, { id: 'thread', messages: [message] }));
  google.on('GET', /\/users\/me\/messages\/private-message$/, () => respond(200, message));
  google.on('POST', /\/users\/me\/messages\/send$/, () => respond(200, { id: 'sent', threadId: 'thread' }));
  return { ...f, google, message };
}
const composition = () => ({ to: ['cliente@example.test'], cc: [], bcc: [], subject: 'Re: REMOTE_PRIVATE_SUBJECT', body: 'Recebido.', replyToMessageId: 'private-message', attachments: [], idempotencyKey: randomUUID() });
async function seed(t: Parameters<typeof recordingWriter>[0], f: Awaited<ReturnType<typeof fixture>>) {
  await recordingWriter(t, f.userId, [{ overview: 'Resumo.', points: [], replies: [{ intent: 'confirm', label: 'Confirmar', body: 'Recebido.' }] }]);
  const connection = await db.prepare('SELECT id FROM ai_connection WHERE name=?').get<{ id: string }>(`Writer fixture ${f.userId}`);
  await updateModelAssignment(db, f.userId, { scope: 'task', target: 'summary.email_thread', model: { mode: 'explicit', connectionId: connection!.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  const result = await emailInsight(f.context, { kind: 'thread', threadId: 'thread' });
  assert.ok('insight' in result && result.insight.replies[0]?.seedId);
  return result.insight.replies[0].seedId!;
}

test('ordinary agent reply preserves bounded subject bytes, with seeded and direct human replies still dispatching', async t => {
  const f = await fixture();
  const wire = await recordingWriter(t, f.userId, [{ title: 'Confirmação independente', content: 'Recebido, obrigada.' }]);
  const actor = await personRequestContext(f.context, 'Responda com uma confirmação independente de recebimento.');
  const reply = await sendMail({ ...actor, invocation: 'agent' }, { ...composition(), to: ['nova@example.test'], subject: 'PLANNER_SUBJECT', body: 'PLANNER_BODY' });
  assert.equal(reply.operation.status, 'succeeded'); assert.equal(wire.length, 1);
  const dispatched = f.google.calls.find(call => call.method === 'POST' && /\/messages\/send$/.test(call.path))!;
  const payload = dispatched.json() as { raw: string; threadId?: string };
  const mime = Buffer.from(payload.raw, 'base64url').toString();
  assert.doesNotMatch(mime, /REMOTE_PRIVATE_SUBJECT|PLANNER_SUBJECT/);
  assert.match(mime, /In-Reply-To: <private@example.test>/); assert.equal(payload.threadId, undefined);
  t.mock.restoreAll();
  const seedId = await seed(t, f);
  assert.equal((await sendMail(f.context, { ...composition(), seedId })).operation.status, 'succeeded');
  await assert.rejects(sendMail(f.context, { ...composition(), seedId, to: ['nova@example.test'] }), { code: 'FORBIDDEN' });
  assert.equal((await sendMail(f.context, { ...composition(), to: ['nova@example.test'], body: 'Texto independente digitado pela pessoa.' })).operation.status, 'succeeded');
  assert.equal(f.google.count('POST', /\/messages\/send$/), 3);
});

test('same-account authorization generation changing during remote preparation prevents final seeded dispatch', async t => {
  const f = await fixture(), seedId = await seed(t, f);
  const initial = await db.prepare('SELECT authorization_generation FROM google_connection WHERE id=?').get<{ authorization_generation: number }>(f.connectionId);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.google.on('GET', /\/users\/me\/messages\/private-message$/, async () => { entered.resolve(); await release.promise; return respond(200, f.message); });
  const input = { ...composition(), seedId };
  const sending = assert.rejects(sendMail(f.context, input), { code: 'CONFLICT' });
  await entered.promise;
  await db.prepare('UPDATE google_connection SET authorization_generation=authorization_generation+1 WHERE id=?').run(f.connectionId);
  release.resolve();
  await sending;
  assert.equal(f.google.count('POST', /\/messages\/send$/), 0);
  const operation = await db.prepare('SELECT * FROM google_operation WHERE office_id=? AND capability_name=\'k5_gmail_send\' ORDER BY created_at DESC LIMIT 1').get<OperationRecord>(f.officeId);
  assert.equal(operation?.connection_id, f.connectionId);
  assert.equal(operation?.status, 'failed');
  assert.equal((operationArgs(operation!).__bound as { authorizationGeneration: number }).authorizationGeneration, initial!.authorization_generation);
  await assert.rejects(sendMail(f.context, { ...composition(), seedId }), { code: 'FORBIDDEN' });
  assert.equal((await sendMail(f.context, { ...composition(), subject: 'Composição humana independente' })).operation.status, 'succeeded');
  assert.equal(f.google.count('POST', /\/messages\/send$/), 1);
});


test('saved Gmail draft reuses the bound V1 original after V2 and rejects changed bytes or revoked sender access', async () => {
  const f = await googleFixture(), caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Draft binding',f.userId);
  for (const action of ['gmail.draft','gmail.send','gmail.send_attachments'] as const) await setRule(f.officeId,action,{mode:'automatic'});
  const v1 = 'BOUND_ORIGINAL_V1', v2 = 'BOUND_ORIGINAL_V2';
  const upload = await createUploadRef(f.context,new File([v1],'original.txt',{type:'text/plain'}));
  const { document } = await runCapability(f.context,'k5_vault_ingest_upload',{uploadRef:upload.id,scope:'case',caseId}) as {document:{id:string}};
  const fake = installFakeGoogle();
  let remoteBytes = v1;
  const remoteDraft = () => ({id:'managed-draft',message:{id:'managed-message',internalDate:'1790160000000',payload:{
    headers:[{name:'To',value:'outside@example.test'},{name:'Subject',value:'Own original'}],
    parts:[{mimeType:'text/plain',body:{data:Buffer.from('Human text').toString('base64url')}},
      {partId:'2',filename:'original.txt',mimeType:'text/plain',body:{size:remoteBytes.length,data:Buffer.from(remoteBytes).toString('base64url')}}],
  }}});
  fake.on('GET',/\/users\/me\/drafts\/managed-draft$/,()=>respond(200,remoteDraft()));
  fake.on('POST',/\/users\/me\/drafts$/,request=>{
    const mime=Buffer.from((request.json() as {message:{raw:string}}).message.raw,'base64url').toString();
    assert.match(mime,new RegExp(Buffer.from(v1).toString('base64')));return respond(200,remoteDraft());
  });
  const sent:string[]=[];
  fake.on('POST',/\/users\/me\/drafts\/send$/,request=>{
    sent.push(Buffer.from((request.json() as {message:{raw:string}}).message.raw,'base64url').toString());
    return respond(200,{id:'sent-bound',threadId:'bound-thread'});
  });
  const saved = await saveDraft(f.context,{to:['outside@example.test'],cc:[],bcc:[],subject:'Own original',body:'Human text',replyToMessageId:null,
    attachments:[{kind:'vault',documentId:document.id}],idempotencyKey:randomUUID()});
  assert.equal(saved.operation.status,'succeeded');
  const nextUpload=await createUploadRef(f.context,new File([v2],'original.txt',{type:'text/plain'}));
  assert.equal((await runCapability(f.context,'k5_vault_add_document_version',{documentId:document.id,uploadRef:nextUpload.id,idempotencyKey:randomUUID()}) as {version:number}).version,2);
  const reuse=()=>({draftId:'managed-draft',to:[],cc:[],bcc:[],subject:'',body:'',replyToMessageId:null,attachments:[],idempotencyKey:randomUUID()});
  remoteBytes=v2;
  await assert.rejects(sendMail(f.context,reuse()),{code:'CONFLICT'});assert.equal(sent.length,0);
  remoteBytes=v1;
  assert.equal((await getDraft(f.context,{draftId:'managed-draft'})).draft.attachments.length,1);
  assert.equal((await sendMail(f.context,reuse())).operation.status,'succeeded');
  assert.equal(sent.length,1);assert.match(sent[0],new RegExp(Buffer.from(v1).toString('base64')));assert.doesNotMatch(sent[0],new RegExp(Buffer.from(v2).toString('base64')));
  const operation=await db.prepare("SELECT * FROM google_operation WHERE user_id=? AND capability_name='k5_gmail_send' AND status='succeeded'").get<OperationRecord>(f.userId);
  const bound=operationArgs(operation!).__bound as {fileBindings:Array<{managed:{version:number;documentId:string}}>};
  assert.equal(bound.fileBindings[0].managed.version,1);assert.equal(bound.fileBindings[0].managed.documentId,document.id);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  await assert.rejects(getDraft(f.context,{draftId:'managed-draft'}),{code:'NOT_FOUND'});
  await assert.rejects(sendMail(f.context,reuse()),{code:'NOT_FOUND'});assert.equal(sent.length,1);
});
