import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { fixtureSession } from './session-fixture';
import { ensureOfficeForUser } from '../src/lib/offices';
import { invite, respond, changeAccess } from '../src/lib/collaboration/service';
import { contextForCase } from '../src/lib/collaboration/access';
import type { WorkspaceContext } from '../src/lib/application/context';
import { runCapability } from '../src/lib/agent-tools';
import { caseTaskFields, type CaseTask } from '../src/lib/case-tasks/contracts';
import { createCaseTask, getCaseTask, listCaseTasks, updateCaseTask } from '../src/lib/case-tasks/service';
import { getCasePolicy, setCasePolicy, caseActivity, caseHonorarios } from '../src/lib/case-collaboration';
import { delegateTask } from '../src/lib/application/task-delegation';
import { projectNextNotification, deliverNextNotification, reconcileNotificationReminders } from '../src/lib/notifications/worker';
import { ensureNotificationDefaults, listNotifications, unreadCount, resolveNotificationDestination, registerPushSubscription, updateNotificationPreferences } from '../src/lib/notifications/repository';
import { createHonorario, getHonorario, receiveHonorario } from '../src/lib/honorarios/service';
import { createPage, updatePage } from '../src/lib/case-pages/service';
import { contentAdmission } from '../src/lib/content-admission';
import { observePage, personPolicy } from '../src/lib/content-policy';
import { createConversation } from '../src/lib/ai-store';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { recordingWriter } from './shared-writing-fixture';
import { approvalIdFromMessage, approveProposal, getApprovalProposal } from '../src/lib/application/approvals-service';
import { decideAgentApproval } from '../src/lib/application/agent-approvals';
import { publishPortalCharge } from '../src/lib/client-portal/service';
import { prepareCharge } from '../src/lib/honorarios/charges';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { addKnowledge, knowledgePrompt, listKnowledge } from '../src/lib/agent-knowledge';
import { retryRun } from '../src/lib/application/runs-service';
import { chatPromptMessages } from '../src/lib/chat-prompt';
import type { UIMessage } from 'ai';
import { homeOverview } from '../src/lib/home-overview';

async function fixture() {
  async function person(name:string) {
    const id=randomUUID(),email=id+'@case.test';
    await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id,name,email);
    const {officeId}=await ensureOfficeForUser(db,{id,officeName:name});
    return {id,email,context:{userId:id,officeId,sessionId:await fixtureSession(id)} satisfies WorkspaceContext};
  }
  const owner=await person('Ana'),guest=await person('Bia'),outsider=await person('Clara'),caseId=randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,owner.context.officeId,'Caso colaborativo',owner.id);
  await respond(guest.context,(await invite(owner.context,{email:guest.email})).id,true);
  await changeAccess(owner.context,{action:'participant',caseId,userId:guest.id,add:true});
  const task=async(actor=owner.context,extra:Record<string,unknown>={})=>(await createCaseTask(actor,{caseId,title:'Revisar contrato',notes:'Conferir multa.',idempotencyKey:randomUUID(),...extra})).task;
  const revoke=()=>changeAccess(owner.context,{action:'participant',caseId,userId:guest.id,add:false});
  return {owner,guest,outsider,caseId,task,revoke};
}
const update=(task:CaseTask,extra:Record<string,unknown>={})=>({...caseTaskFields.parse(task),caseId:task.caseId,activityId:task.id,version:task.version,...extra});

test('home projects current shared work without personal agenda, private drafts or revoked case access', async () => {
  const f = await fixture();
  const today = '2026-10-07';
  const current = await f.task(f.owner.context, { dueOn: today, assigneeId: f.guest.id });
  await f.task(f.owner.context, { dueOn: '2026-10-08', title: 'Amanhã' });
  await f.task(f.owner.context, { dueOn: today, status: 'completed', title: 'Terminada' });
  await runCapability(f.owner.context, 'k5_agenda_create_activity', { kind: 'task', title: 'Estratégia pessoal secreta', caseId: f.caseId, dueOn: today });
  const { folder } = await runCapability(f.owner.context, 'k5_vault_create_folder', { caseId: f.caseId, name: 'Privada', visibility: 'private' }) as { folder: { id: string } };
  await createPage(f.owner.context, { caseId: f.caseId, folderId: folder.id, title: 'Página privada', content: 'Texto privado que não pode virar prévia.' });
  const shared = (await createPage(f.owner.context, { caseId: f.caseId, folderId: null, title: 'Página acessível', content: 'Conteúdo autorizado.' })).page;
  const result = await homeOverview(f.guest.context, today);
  assert.deepEqual(result.tasks, [{ id: current.id, caseId: f.caseId, caseName: 'Caso colaborativo', title: 'Revisar contrato', dueOn: today }]);
  assert.equal(result.cases[0].id, f.caseId);
  assert.ok(result.activity.some(item => item.title === shared.title));
  assert.equal(JSON.stringify(result).includes('Estratégia pessoal secreta'), false);
  assert.equal(JSON.stringify(result).includes('Página privada'), false);
  assert.equal(JSON.stringify(result).includes('agentConversationId'), false);
  assert.deepEqual(result.partial, { tasks: false, activity: false });
  await f.revoke();
  const revoked = await homeOverview(f.guest.context, today);
  assert.deepEqual(revoked.cases, []); assert.deepEqual(revoked.tasks, []); assert.deepEqual(revoked.activity, []);
});
async function drainProjection(){for(let i=0;i<100 && await projectNextNotification(db);i++){} }

test('shared tasks use case ownership, current participants and eligible assignees while personal tasks remain private',async()=>{
  const f=await fixture();
  const privateTask=await runCapability(f.owner.context,'k5_agenda_create_activity',{kind:'task',title:'Estratégia pessoal',caseId:f.caseId}) as {activity:{id:string}};
  const task=await f.task(f.guest.context,{assigneeId:f.owner.id});
  assert.equal((await db.prepare('SELECT office_id,visibility FROM agenda_activity WHERE id=?').get(task.id))?.office_id,f.owner.context.officeId);
  assert.equal((await db.prepare('SELECT visibility FROM agenda_activity WHERE id=?').get(privateTask.activity.id))?.visibility,'personal');
  assert.deepEqual((await listCaseTasks(f.guest.context,{caseId:f.caseId})).tasks.map(task=>task.id),[task.id]);
  for(const actor of [f.owner.context,f.guest.context]) {
    const personal=await runCapability(actor,'k5_agenda_list_activities',{caseId:f.caseId}) as {activities:{id:string}[]};
    assert.equal(personal.activities.some(row=>row.id===task.id),false);
    await assert.rejects(runCapability(actor,'k5_agenda_get_activity',{activityId:task.id}),{code:'NOT_FOUND'});
    await assert.rejects(runCapability(actor,'k5_agenda_update_activity',{activityId:task.id,version:1,status:'completed'}),{code:'NOT_FOUND'});
  }
  await assert.rejects(f.task(f.owner.context,{assigneeId:f.outsider.id}),{code:'NOT_FOUND'});
  await assert.rejects(listCaseTasks(f.outsider.context,{caseId:f.caseId}),{code:'NOT_FOUND'});
  await assert.rejects(getCaseTask(f.outsider.context,{caseId:f.caseId,activityId:task.id}),{code:'NOT_FOUND'});
  await assert.rejects(runCapability(await contextForCase(f.guest.context,f.caseId),'k5_crm_list_clients',{}),{code:'FORBIDDEN'});
  await f.revoke();
  await assert.rejects(updateCaseTask(f.guest.context,update(task,{title:'Acesso removido'})),{code:'NOT_FOUND'});
});

test('task creation is idempotent and concurrent edits commit one version and one event',async()=>{
  const f=await fixture(),input={caseId:f.caseId,title:'Preparar petição',assigneeId:f.guest.id,idempotencyKey:randomUUID()};
  const [a,b]=await Promise.all([createCaseTask(f.owner.context,input),createCaseTask(f.owner.context,input)]);
  assert.equal(a.task.id,b.task.id);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_event WHERE source_id=?').get(a.task.id))?.n,1);
  await assert.rejects(createCaseTask(f.owner.context,{...input,title:'Outra tarefa'}),{code:'CONFLICT'});
  const saves=await Promise.allSettled([updateCaseTask(f.owner.context,update(a.task,{status:'completed'})),updateCaseTask(f.guest.context,update(a.task,{status:'in_progress'}))]);
  assert.equal(saves.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(saves.filter(result=>result.status==='rejected' && result.reason.code==='CONFLICT').length,1);
  const current=(await getCaseTask(f.guest.context,{caseId:f.caseId,activityId:a.task.id})).task;
  assert.equal(current.version,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_event WHERE source_id=?').get(a.task.id))?.n,2);
  const replay=await createCaseTask(f.owner.context,input);assert.equal(replay.task.version,2);
});

test('notifications project to recipient home office, resolve shared destinations and disappear on current revocation',async()=>{
  const f=await fixture();await ensureNotificationDefaults(f.guest.context,db);
  const task=await f.task(f.owner.context,{assigneeId:f.guest.id});
  await drainProjection();
  const inbox=await listNotifications(f.guest.context,{unreadOnly:true,limit:25},db);
  assert.equal(inbox.notifications.length,1);
  assert.match(inbox.notifications[0].summary,/Revisar contrato/);
  const row=await db.prepare('SELECT office_id FROM notification_recipient WHERE event_id=? AND user_id=?').get(inbox.notifications[0].id,f.guest.id);
  assert.equal(row?.office_id,f.guest.context.officeId);
  assert.equal(await resolveNotificationDestination(f.guest.context,inbox.notifications[0].id,db),`/app/vault/cases/${f.caseId}?section=tasks&task=${task.id}`);
  assert.equal((await listNotifications(f.outsider.context,{unreadOnly:false,limit:25},db)).notifications.length,0);
  const next=await updateCaseTask(f.owner.context,update(task,{notes:'Conferir prazo.'}));
  assert.equal(next.task.version,2);await drainProjection();
  await f.revoke();
  assert.deepEqual((await listNotifications(f.guest.context,{unreadOnly:false,limit:25},db)).notifications,[]);
  assert.equal(await unreadCount(f.guest.context,db),0);
  assert.equal(await resolveNotificationDestination(f.guest.context,inbox.notifications[0].id,db),null);
});

test('revocation before projection and reassignment suppress stale assignment and keep private event isolation',async()=>{
  const f=await fixture();const task=await f.task(f.owner.context,{assigneeId:f.guest.id});
  const next=await updateCaseTask(f.owner.context,update(task,{assigneeId:f.owner.id}));
  await updateCaseTask(f.owner.context,update(next.task,{notes:'Dados atuais'}));
  await drainProjection();
  assert.equal((await listNotifications(f.guest.context,{unreadOnly:false,limit:25},db)).notifications.length,0);
  const revoked=await f.task(f.owner.context,{assigneeId:f.guest.id});await f.revoke();await drainProjection();
  assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_recipient WHERE event_id IN (SELECT id FROM notification_event WHERE source_id=?) AND user_id=?').get(revoked.id,f.guest.id))?.n,0);
  const privateTask=await runCapability(f.owner.context,'k5_agenda_create_activity',{kind:'task',title:'Pessoal',caseId:f.caseId}) as {activity:{id:string}};
  await db.prepare(`INSERT INTO notification_event(id,office_id,event_type,source_kind,source_id,intended_recipients_json,data_json,dedupe_key,created_at)
    VALUES(?,?,'agenda.activity.changed','activity',?,?,? ,?,CURRENT_TIMESTAMP)`).run(randomUUID(),f.owner.context.officeId,privateTask.activity.id,JSON.stringify([f.guest.id]),JSON.stringify({activityTitle:'Pessoal'}),randomUUID());
  await drainProjection();assert.equal((await listNotifications(f.guest.context,{unreadOnly:false,limit:25},db)).notifications.length,0);
});

test('cross-office push and due reminders use home preferences and recheck case access before sending',async()=>{
  const f=await fixture();
  process.env.K5_VAPID_KEY_ID='case-test';process.env.K5_VAPID_PUBLIC_KEY='case-test-public';
  await registerPushSubscription(f.guest.context,{deviceId:randomUUID(),endpoint:'https://fcm.googleapis.com/fcm/send/'+randomUUID(),expirationTime:null,
    keys:{p256dh:Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url'),auth:randomBytes(16).toString('base64url')},vapidKeyId:'case-test',authorizationGeneration:1},db);
  await updateNotificationPreferences(f.guest.context,{pushEnabled:true,quietEnabled:false},db);
  await db.prepare('UPDATE notification_rollout SET push_enabled=1,reminders_enabled=1 WHERE office_id IN (?,?)').run(f.guest.context.officeId,f.owner.context.officeId);
  await ensureNotificationDefaults(f.owner.context,db);await db.prepare('UPDATE notification_rollout SET reminders_enabled=1 WHERE office_id=?').run(f.owner.context.officeId);
  await f.task(f.owner.context,{assigneeId:f.guest.id,dueOn:'2026-10-08'});await drainProjection();
  let sends=0;const sender={send:async()=>{sends++;return {accepted:true as const,statusCode:201};}};
  assert.equal(await deliverNextNotification(db,sender),true);assert.equal(sends,1);
  const task=await f.task(f.owner.context,{assigneeId:f.guest.id,dueOn:'2026-10-09'});await drainProjection();
  await reconcileNotificationReminders(db);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM notification_reminder WHERE activity_id=? AND user_id=? AND state='scheduled'").get(task.id,f.guest.id))?.n,1);
  await f.revoke();while(await deliverNextNotification(db,sender)){}
  assert.equal(sends,1);
  assert.equal((await db.prepare("SELECT state FROM notification_delivery WHERE event_id IN (SELECT id FROM notification_event WHERE source_id=?)").get(task.id))?.state,'cancelled');
});

test('shared delegation keeps each conversation and receipt in requester home office and never exposes another requester link',async()=>{
  const f=await fixture(),task=await f.task(f.owner.context,{assigneeId:f.guest.id});let starts=0;
  const options={ready:async()=>true,start:async(turn:import('../src/lib/chat-turn').ChatTurn)=>{
    starts++;assert.equal(turn.workspace.officeId,f.guest.context.officeId);assert.equal(turn.request.caseId,f.caseId);
  }};
  const [a,b]=await Promise.all([delegateTask(f.guest.context,{activityId:task.id},options),delegateTask(f.guest.context,{activityId:task.id},options)]);
  assert.equal(a.conversationId,b.conversationId);assert.equal(starts,1);
  assert.equal((await db.prepare('SELECT office_id FROM ai_conversation WHERE id=?').get(a.conversationId))?.office_id,f.guest.context.officeId);
  assert.equal((await db.prepare('SELECT office_id FROM agenda_delegation WHERE activity_id=?').get(task.id))?.office_id,f.guest.context.officeId);
  assert.equal((await getCaseTask(f.owner.context,{caseId:f.caseId,activityId:task.id})).task.agentConversationId,undefined);
  const guest=(await getCaseTask(f.guest.context,{caseId:f.caseId,activityId:task.id})).task;assert.equal(guest.status,'in_progress');assert.equal(guest.agentConversationId,a.conversationId);
  await assert.rejects(runCapability(f.owner.context,'k5_conversations_get',{conversationId:a.conversationId}),{code:'NOT_FOUND'});
  await f.revoke();await assert.rejects(delegateTask(f.guest.context,{activityId:task.id},options),{code:'NOT_FOUND'});
});

test('case policy denies owner and participant agent work while human editing, fees and independent portal publication continue',async()=>{
  const f=await fixture(),task=await f.task();const page=(await createPage(f.owner.context,{caseId:f.caseId,title:'Petição',content:'Texto'})).page;
  assert.deepEqual(await getCasePolicy(f.guest.context,f.caseId),{enabled:true,canManage:false});
  await assert.rejects(setCasePolicy(f.guest.context,f.caseId,{enabled:false}),{code:'FORBIDDEN'});
  await setCasePolicy(f.owner.context,f.caseId,{enabled:false});
  for(const actor of [f.owner.context,f.guest.context]) {
    const context={...actor,invocation:'agent' as const};
    await assert.rejects(runCapability(context,'k5_case_tasks_list',{caseId:f.caseId}),{code:'FORBIDDEN'});
    await assert.rejects(runCapability(context,'k5_case_pages_get',{caseId:f.caseId,pageId:page.id}),{code:'FORBIDDEN'});
    await assert.rejects(delegateTask(actor,{activityId:task.id},{ready:async()=>true,start:async()=>{throw Error('Must not execute');}}),{code:'FORBIDDEN'});
  }
  assert.equal((await updateCaseTask(f.guest.context,update(task,{status:'completed'}))).task.status,'completed');
  assert.equal((await updatePage(f.guest.context,{caseId:f.caseId,pageId:page.id,version:1,title:'Petição revisada',content:'Texto humano'})).page.version,2);
  const client=await runCapability(f.owner.context,'k5_crm_create_client',{name:'Cliente privado'}) as {client:{id:string}};
  const fee=await createHonorario(f.owner.context,{clientId:client.client.id,caseId:f.caseId,title:'Honorário do caso',notes:'Notas particulares',installments:[{dueOn:'2026-10-09',amountCents:10000}],idempotencyKey:randomUUID()});
  const charge=await prepareCharge(f.owner.context,{installmentId:fee.installments[0].id,version:0,pixKey:'pagamento@case.test',idempotencyKey:randomUUID()});
  await publishPortalCharge(f.owner.context,{clientId:client.client.id,installmentId:fee.installments[0].id,version:charge.version});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM client_portal_charge WHERE installment_id=?').get(fee.installments[0].id))?.n,1);
  await setCasePolicy(f.owner.context,f.caseId,{enabled:true});
  assert.equal((await runCapability({...f.guest.context,invocation:'agent'},'k5_case_tasks_get',{caseId:f.caseId,activityId:task.id}) as {task:CaseTask}).task.status,'completed');
});

test('Honorários case projection uses home context, linked agreements and creator-only management without CRM or private pricing',async()=>{
  const f=await fixture();const c=await runCapability(f.guest.context,'k5_crm_create_client',{name:'Cliente da Bia'}) as {client:{id:string}};
  const fee=await createHonorario(f.guest.context,{clientId:c.client.id,caseId:f.caseId,title:'Honorário conjunto',notes:'Notas da Bia',installments:[{dueOn:'2026-10-09',amountCents:12500}],idempotencyKey:randomUUID()});
  await createHonorario(f.guest.context,{clientId:c.client.id,title:'Outro honorário',installments:[{dueOn:'2026-10-09',amountCents:99999}],idempotencyKey:randomUUID()});
  const owner=await caseHonorarios(f.owner.context,f.caseId),guest=await caseHonorarios(f.guest.context,f.caseId);
  assert.equal(owner.total,1);assert.equal(owner.summary.totalCents,12500);assert.equal(owner.installments[0].canManage,false);assert.equal(guest.installments[0].canManage,true);
  assert.equal(JSON.stringify(owner).includes('Cliente da Bia'),false);assert.equal('pricing' in owner.installments[0],false);
  await assert.rejects(receiveHonorario(f.owner.context,{installmentId:fee.installments[0].id,amountCents:12500,receivedOn:'2026-10-07',method:'pix',idempotencyKey:randomUUID()}),{code:'NOT_FOUND'});
  await assert.rejects(caseHonorarios(f.outsider.context,f.caseId),{code:'NOT_FOUND'});await f.revoke();
  assert.equal((await getHonorario(f.owner.context,{agreementId:fee.agreement.id})).agreement.canManage,false);
  await assert.rejects(caseHonorarios(f.guest.context,f.caseId),{code:'NOT_FOUND'});
});

test('activity uses visible page versions, current tasks and case audit without private case-linked tasks or restricted pages',async()=>{
  const f=await fixture();const publicPage=(await createPage(f.owner.context,{caseId:f.caseId,title:'Página conjunta',content:'Texto'})).page;
  await updatePage(f.guest.context,{caseId:f.caseId,pageId:publicPage.id,version:1,title:'Página revisada',content:'Revisão'});
  const folder=await runCapability(f.owner.context,'k5_vault_create_folder',{caseId:f.caseId,name:'Particular',visibility:'private'}) as {folder:{id:string}};
  await createPage(f.owner.context,{caseId:f.caseId,folderId:folder.folder.id,title:'Página particular',content:'Segredo'});
  await runCapability(f.owner.context,'k5_agenda_create_activity',{kind:'task',caseId:f.caseId,title:'Tarefa particular'});
  const task=await f.task();await updateCaseTask(f.guest.context,update(task,{status:'completed'}));
  const result=await caseActivity(f.guest.context,f.caseId),text=JSON.stringify(result);
  assert.match(text,/Página conjunta/);assert.match(text,/Página revisada/);assert.match(text,/versão 2/);assert.match(text,/Estado atual · Concluída/);
  assert.equal(text.includes('Página particular'),false);assert.equal(text.includes('Tarefa particular'),false);assert.equal(text.includes('messages'),false);
  assert.equal(result.activity.filter(item=>item.id.startsWith('task-current:')).length,1);
  await assert.rejects(caseActivity(f.outsider.context,f.caseId),{code:'NOT_FOUND'});
});

test('content admission rechecks Lume after admission and requester access after revocation, including human-origin provider work',async()=>{
  const f=await fixture();const page=(await createPage(f.owner.context,{caseId:f.caseId,title:'Texto',content:'Fonte'})).page;
  const policy=(await observePage(f.guest.id,page.id,f.caseId)).policy;
  const admission=contentAdmission(f.guest.context,{query:'Fonte'},[policy]);await admission.admit();
  await setCasePolicy(f.owner.context,f.caseId,{enabled:false});await assert.rejects(admission.admit(),{code:'FORBIDDEN'});
  await setCasePolicy(f.owner.context,f.caseId,{enabled:true});await admission.admit();
  const caseOnly=contentAdmission({...f.guest.context,invocation:'agent',allowedResearchCaseId:f.caseId},{query:'Pedido'},[personPolicy('','')]);await caseOnly.admit();
  await f.revoke();await assert.rejects(caseOnly.admit(),{code:'NOT_FOUND'});
});

test('reviewed agent task publication is exact, idempotent, source-bound and blocked after proposal or receipt by case policy',async t=>{
  const f=await fixture(),conversation=await createConversation(db,f.guest.context),generationId=randomUUID();
  const submissionId=await recordPersonRequest(f.guest.context,conversation.id,randomUUID(),'Criar tarefa de conferir os prazos',{version:2,label:'Caso',caseId:f.caseId,documentIds:[],researchReferenceIds:[]},[]);
  const agent={...f.guest.context,invocation:'agent' as const,conversationId:conversation.id,generationId,submissionId};
  const requests=await recordingWriter(t,f.owner.id,[{title:'Conferir prazos',content:'Revisar datas do caso.'}]);
  let approvalId='';
  await assert.rejects(runCapability(agent,'k5_case_tasks_create',{caseId:f.caseId,idempotencyKey:randomUUID(),assigneeId:f.owner.id}),error=>{
    approvalId=approvalIdFromMessage((error as Error).message)!;return Boolean(approvalId);
  });
  assert.equal(requests.length,1);const proposal=await getApprovalProposal(f.guest.context,approvalId);await approveProposal(f.guest.context,approvalId);
  await setCasePolicy(f.owner.context,f.caseId,{enabled:false});
  assert.equal((await decideAgentApproval(f.guest.context,approvalId,'confirm')).state,'failed');
  assert.equal((await listCaseTasks(f.owner.context,{caseId:f.caseId})).tasks.length,0);
  await setCasePolicy(f.owner.context,f.caseId,{enabled:true});
  const result=await decideAgentApproval(f.guest.context,approvalId,'confirm');assert.equal(result.state,'confirmed');
  const task=(await listCaseTasks(f.owner.context,{caseId:f.caseId})).tasks[0];assert.equal(task.title,'Conferir prazos');assert.equal(task.notes,'Revisar datas do caso.');
  assert.equal(JSON.parse(proposal.normalized_input).title,task.title);
  await decideAgentApproval(f.guest.context,approvalId,'confirm');assert.equal((await listCaseTasks(f.owner.context,{caseId:f.caseId})).tasks.length,1);
  await setCasePolicy(f.owner.context,f.caseId,{enabled:false});assert.equal((await decideAgentApproval(f.guest.context,approvalId,'confirm')).state,'failed');
});

test('task publications retain selected page permissions through reads, assignment and inbox revocation',async t=>{
  const f=await fixture();
  const folder=await runCapability(f.owner.context,'k5_vault_create_folder',{caseId:f.caseId,name:'Fonte restrita',visibility:'restricted',memberIds:[f.guest.id]}) as {folder:{id:string}};
  const page=(await createPage(f.owner.context,{caseId:f.caseId,folderId:folder.folder.id,title:'Fonte da tarefa',content:'Prazos restritos'})).page;
  const conversation=await createConversation(db,f.guest.context);
  const scope=await authorizeMessageScope(f.guest.context,{document:{kind:'case-page',id:page.id,caseId:f.caseId},documentIds:[],researchReferenceIds:[]});
  const submissionId=await recordPersonRequest(f.guest.context,conversation.id,randomUUID(),'Criar tarefa com base nesta página',scope,[]);
  const agent={...f.guest.context,invocation:'agent' as const,conversationId:conversation.id,generationId:randomUUID(),submissionId};
  await recordingWriter(t,f.owner.id,[{title:'Conferir prazo restrito',content:'Conferir o prazo da fonte.'}]);
  let approvalId='';
  await assert.rejects(runCapability(agent,'k5_case_tasks_create',{caseId:f.caseId,idempotencyKey:randomUUID(),assigneeId:f.guest.id}),error=>{
    approvalId=approvalIdFromMessage((error as Error).message)!;return Boolean(approvalId);
  });
  await approveProposal(f.guest.context,approvalId);await decideAgentApproval(f.guest.context,approvalId,'confirm');
  const task=(await listCaseTasks(f.owner.context,{caseId:f.caseId})).tasks[0];
  assert.equal((await getCaseTask(f.guest.context,{caseId:f.caseId,activityId:task.id})).task.title,task.title);
  await updateCaseTask(f.owner.context,update(task,{notes:'Conferir fonte'}));await drainProjection();
  assert.equal((await listNotifications(f.guest.context,{unreadOnly:false,limit:25},db)).notifications.length,1);
  const delegated=await delegateTask(f.guest.context,{activityId:task.id},{ready:async()=>true,start:async()=>{}});
  const stored=await db.prepare('SELECT messages FROM ai_conversation WHERE id=?').get<{messages:string}>(delegated.conversationId);
  const messages=JSON.parse(stored!.messages) as UIMessage[];
  assert.ok(messages[0].metadata && typeof messages[0].metadata === 'object' && 'submissionId' in messages[0].metadata);
  assert.equal((await chatPromptMessages(f.guest.context,delegated.conversationId,messages,false)).length,1);
  await runCapability(f.owner.context,'k5_vault_update_folder_access',{folderId:folder.folder.id,visibility:'private',memberIds:[]});
  assert.deepEqual(await chatPromptMessages(f.guest.context,delegated.conversationId,messages,false),[]);
  assert.deepEqual((await listCaseTasks(f.guest.context,{caseId:f.caseId})).tasks,[]);
  await assert.rejects(getCaseTask(f.guest.context,{caseId:f.caseId,activityId:task.id}),{code:'NOT_FOUND'});
  assert.deepEqual((await listNotifications(f.guest.context,{unreadOnly:false,limit:25},db)).notifications,[]);
  const current=(await getCaseTask(f.owner.context,{caseId:f.caseId,activityId:task.id})).task;
  await assert.rejects(updateCaseTask(f.owner.context,update(current,{assigneeId:f.guest.id})),{code:'NOT_FOUND'});
  assert.equal((await decideAgentApproval(f.guest.context,approvalId,'confirm')).state,'failed');
});

test('Lume policy resolves omitted case identities, filters broad discovery and rejects deferred retries while keeping human reads',async()=>{
  const f=await fixture(),documentId=randomUUID();
  await db.prepare(`INSERT INTO vault_document(id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,extracted_characters,created_by)
    VALUES(?,?,?,'case','Fonte bloqueável',?,'text/plain',12,?,'ready',12,?)`).run(documentId,f.owner.context.officeId,f.caseId,documentId+'.txt','a'.repeat(64),f.owner.id);
  await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)')
    .run(randomUUID(),documentId,f.owner.context.officeId,'página:1','Fonte confidencial do caso');
  await db.prepare('INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active) SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?').run(randomUUID(),documentId);
  await db.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(documentId);
  await addKnowledge(f.owner.context,'office',documentId,'always');
  assert.match(await knowledgePrompt(f.owner.context),/Fonte confidencial/);
  const policy=(await import('../src/lib/content-policy')).combinePolicy('','',[{...personPolicy('',''),guards:[{kind:'case',id:f.caseId}]}],'person');
  const runId=randomUUID();await db.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,status) VALUES(?,?,?,'draft',?,'failed')")
    .run(runId,f.owner.context.officeId,f.owner.id,JSON.stringify({caseId:f.caseId,documentIds:[documentId],contentPolicy:policy}));
  await setCasePolicy(f.owner.context,f.caseId,{enabled:false});
  for(const actor of [f.owner.context,f.guest.context]) {
    await assert.rejects(runCapability({...actor,invocation:'agent'},'k5_vault_get_document',{documentId}),{code:'FORBIDDEN'});
    const cases=await runCapability({...actor,invocation:'agent'},'k5_vault_list_cases',{}) as {cases:{id:string}[]};
    assert.equal(cases.cases.some(row=>row.id===f.caseId),false);
  }
  const docs=await runCapability({...f.owner.context,invocation:'agent'},'k5_vault_list_documents',{}) as {documents:{id:string}[]};
  assert.equal(docs.documents.some(row=>row.id===documentId),false);
  assert.equal((await listKnowledge(f.owner.context)).office.length,1);
  assert.equal((await knowledgePrompt(f.owner.context)).includes('Fonte confidencial'),false);
  assert.equal((await runCapability(f.owner.context,'k5_vault_get_document',{documentId}) as {document:{id:string}}).document.id,documentId);
  await assert.rejects(retryRun(f.owner.context,{runId}),{code:'FORBIDDEN'});
  assert.equal((await db.prepare('SELECT status FROM ai_run WHERE id=?').get(runId))?.status,'failed');
  await setCasePolicy(f.owner.context,f.caseId,{enabled:true});
  await retryRun(f.owner.context,{runId});assert.equal((await db.prepare('SELECT status FROM ai_run WHERE id=?').get(runId))?.status,'queued');
});
