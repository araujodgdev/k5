import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database, type Transaction } from '@/lib/database';
import { documentTransaction } from '@/lib/documents/service';
import { assertCapabilityAllowed, assertLumeAdmission, assertSourcesAdmitted, type WorkspaceContext } from '@/lib/application/context';
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';
import { agendaEventStatement } from '@/lib/notifications/events';
import { canonicalInput, createApprovalProposal, type ApprovalRow } from '@/lib/application/approvals-service';
import { exposeContent, personPolicy, parsePolicy, combinePolicy, assertPolicyAccess, type ContentPolicy } from '@/lib/content-policy';
import { prepareSharedWriting } from '@/lib/documents/shared-writing';
import { caseTaskCreate, caseTaskDto, caseTaskUpdate, type CaseTask } from './contracts';
import { z } from 'zod';

const missing = () => new CapabilityError('NOT_FOUND', 'Tarefa não encontrada ou acesso removido.');
const conflict = () => new CapabilityError('CONFLICT', 'Esta tarefa mudou. Seu rascunho foi preservado. Leia a versão atual antes de salvar.');
type TaskRow = { id: string; office_id: string; case_id: string; title: string; notes: string; status: string;
  due_on: string | null; assignee_id: string | null; version: number; created_by: string; created_at: string; updated_at: string; creation_input_hash: string; content_policy: unknown };

export async function taskAccess(context: WorkspaceContext, caseId: string, tx: Transaction = database) {
  if (context.caseScope && context.caseScope.caseId !== caseId) throw missing();
  const access = await caseAccess(context.userId, caseId, tx);
  await assertCapabilityAllowed(context, 'k5_case_tasks_get', tx);
  if (context.invocation) await assertLumeAdmission(caseId, tx);
  return access;
}

export async function taskRow(context: WorkspaceContext, caseId: string, activityId: string, tx: Transaction, lock = false) {
  const access = await taskAccess(context, caseId, tx);
  const row = await tx.prepare(`SELECT * FROM agenda_activity WHERE id=? AND case_id=? AND office_id=? AND visibility='case' AND lume_activity_visible(id,?)${lock ? ' FOR UPDATE' : ''}`)
    .get<TaskRow>(activityId, caseId, access.officeId, context.userId);
  if (!row) throw missing();
  if (context.invocation) await assertSourcesAdmitted(taskPolicy(row),tx);
  return row;
}

async function view(context: WorkspaceContext, row: TaskRow, tx: Transaction): Promise<CaseTask> {
  const receipt = await tx.prepare('SELECT conversation_id FROM agenda_delegation WHERE activity_id=? AND user_id=? AND office_id=?')
    .get<{ conversation_id: string }>(row.id, context.userId, context.caseScope?.homeOfficeId ?? context.officeId);
  return caseTaskDto.parse({ id: row.id, caseId: row.case_id, visibility: 'case', title: row.title, notes: row.notes,
    status: row.status, dueOn: row.due_on, assigneeId: row.assignee_id, version: row.version,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), agentConversationId: receipt?.conversation_id });
}
export function taskPolicy(row: TaskRow): ContentPolicy {
  return combinePolicy(row.title,row.notes,[row.content_policy ? parsePolicy(row.content_policy) : personPolicy(row.title,row.notes),
    {...personPolicy('',''),guards:[{kind:'case',id:row.case_id}]}],'person');
}
const expose = <T extends object>(result: T, rows: TaskRow[]) => exposeContent(result,rows.map(taskPolicy));

export async function getCaseTask(context: WorkspaceContext, input: { caseId: string; activityId: string }) {
  return documentTransaction(context, async tx => {
    const row=await taskRow(context,input.caseId,input.activityId,tx);
    return expose({task:await view(context,row,tx)},[row]);
  });
}

export async function listCaseTasks(context: WorkspaceContext, input: { caseId: string }) {
  return documentTransaction(context, async tx => {
    const access = await taskAccess(context, input.caseId, tx);
    const rows = await tx.prepare("SELECT * FROM agenda_activity WHERE office_id=? AND case_id=? AND visibility='case' AND lume_activity_visible(id,?) ORDER BY updated_at DESC,id")
      .all<TaskRow>(access.officeId, input.caseId,context.userId);
    if(context.invocation) for(const row of rows) await assertSourcesAdmitted(taskPolicy(row),tx);
    const members = await tx.prepare(`SELECT u.id,u.name FROM "user" u WHERE EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=? AND m.user_id=u.id)
      OR EXISTS(SELECT 1 FROM case_participant p WHERE p.office_id=? AND p.case_id=? AND p.user_id=u.id AND p.revoked_at IS NULL) ORDER BY u.name,u.id`)
      .all<{ id: string; name: string }>(access.officeId, access.officeId, input.caseId);
    return expose({ tasks: await Promise.all(rows.map(row => view(context, row, tx))), members }, rows);
  });
}

async function assignee(context: WorkspaceContext, caseId: string, userId: string | null, tx: Transaction) {
  if (userId) await caseAccess(userId, caseId, tx);
  await taskAccess(context, caseId, tx);
}

type WriteName = 'k5_case_tasks_create' | 'k5_case_tasks_update';
async function prepare(context: WorkspaceContext,name:WriteName,raw:unknown) {
  let values=z.record(z.string(),z.unknown()).parse(raw);
  if(!context.invocation || values.approvalId) return values;
  const caseId=z.string().parse(values.caseId);
  await taskAccess(context,caseId);
  const old=name==='k5_case_tasks_update' ? await documentTransaction(context,tx=>taskRow(context,caseId,z.string().parse(values.activityId),tx)) : undefined;
  if(old && old.version!==values.version) throw conflict();
  const generated=name==='k5_case_tasks_create' || values.editText ? await prepareSharedWriting(context,name,values) : undefined;
  const changes={...values};delete changes.editText;
  values={...(old ? {title:old.title,notes:old.notes,status:old.status,dueOn:old.due_on,assigneeId:old.assignee_id} : {}),...changes,
    ...(generated ? {title:generated.title,notes:generated.content} : {})};
  const input=name==='k5_case_tasks_create' ? caseTaskCreate.parse(values) : caseTaskUpdate.parse(values);
  const policy=combinePolicy(input.title,input.notes,[...(old ? [taskPolicy(old)] : []),...(generated ? [generated.policy] : [personPolicy(input.title,input.notes)])],'generated',generated?.attemptId);
  const id=await documentTransaction(context,async tx=>{
    await taskAccess(context,caseId,tx);await assertPolicyAccess(context.userId,policy,tx);await assertSourcesAdmitted(policy,tx);
    if(generated) {
      const attempt=await tx.prepare('SELECT approval_id FROM content_generation_attempt WHERE id=? FOR UPDATE').get<{approval_id:string|null}>(generated.attemptId);
      if(attempt?.approval_id)return attempt.approval_id;
    }
    const approval=await createApprovalProposal(context,name,input,old?.id ?? caseId,old?.version,600_000,tx);
    await tx.prepare('UPDATE capability_approval SET content_policy=?::jsonb WHERE id=?').run(JSON.stringify(policy),approval.id);
    if(generated)await tx.prepare('UPDATE content_generation_attempt SET approval_id=? WHERE id=?').run(approval.id,generated.attemptId);
    return approval.id;
  });
  throw new CapabilityError('APPROVAL_REQUIRED',`Revise a tarefa e confirme sua publicação. Proposta registrada [id: ${id}].`);
}
async function approval(context:WorkspaceContext,name:WriteName,id:string|undefined,input:Record<string,unknown>,tx:Transaction) {
  if(!context.invocation)return;
  const row=await tx.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
    .get<ApprovalRow>(id,context.caseScope?.homeOfficeId ?? context.officeId,context.userId);
  if(!row || row.capability_name!==name || row.normalized_input!==canonicalInput(input) || !row.content_policy)
    throw new CapabilityError('FORBIDDEN','Esta confirmação não corresponde à tarefa.');
  if(row.expires_at<Date.now() || !['approved','consumed'].includes(row.status))throw conflict();
  const policy=parsePolicy(row.content_policy);
  await assertPolicyAccess(context.userId,policy,tx);await assertSourcesAdmitted(policy,tx);
  return {id:row.id,policy,result:row.content_result as {activityId:string}|null};
}
async function receipt(tx:Transaction,id:string|undefined,activityId:string) {
  if(id)await tx.prepare("UPDATE capability_approval SET status='consumed',consumed_at=CURRENT_TIMESTAMP,content_result=?::jsonb WHERE id=?")
    .run(JSON.stringify({activityId}),id);
}
export async function createCaseTask(context: WorkspaceContext, raw: unknown) {
  const { approvalId, ...input } = caseTaskCreate.parse(await prepare(context,'k5_case_tasks_create',raw));
  return documentTransaction(context, async tx => {
    const access = await taskAccess(context, input.caseId, tx);
    const reviewed=await approval(context,'k5_case_tasks_create',approvalId,input,tx);
    const policy=reviewed?.policy ?? personPolicy(input.title,input.notes);
    await assignee(context, input.caseId, input.assigneeId, tx);
    if(input.assigneeId)await assertPolicyAccess(input.assigneeId,policy,tx);
    const id = createHash('sha256').update(JSON.stringify([context.userId, input.caseId, input.idempotencyKey])).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const token = randomUUID(), now = new Date().toISOString();
    const inserted = await tx.prepare(`INSERT INTO agenda_activity(id,office_id,case_id,kind,visibility,title,notes,status,due_on,assignee_id,created_by,created_at,updated_at,mutation_token,creation_input_hash,content_policy)
      VALUES(?,?,?,'task','case',?,?,?,?,?,?,?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING`)
      .run(id, access.officeId, input.caseId, input.title, input.notes, input.status, input.dueOn, input.assigneeId, context.userId, now, now, token, hash,JSON.stringify(policy));
    const row = await taskRow(context, input.caseId, id, tx);
    if (row.creation_input_hash !== hash) throw conflict();
    if (inserted.changes) {
      const event = agendaEventStatement(database, { officeId: access.officeId, activityId: id, activityVersion: 1, mutationToken: token,
        actorUserId: context.userId, eventType: 'agenda.activity.assigned', intendedRecipientIds: input.assigneeId ? [input.assigneeId] : [],
        data: { activityTitle: input.title, assigneeId: input.assigneeId, previousAssigneeId: null }, createdAt: now });
      await tx.prepare(event.sql).run(...event.params);
    }
    await receipt(tx,reviewed?.id,id);
    return expose({ task: await view(context, row, tx) }, [row]);
  });
}

export async function updateCaseTask(context: WorkspaceContext, raw: unknown) {
  const { approvalId, ...input } = caseTaskUpdate.parse(await prepare(context,'k5_case_tasks_update',raw));
  return documentTransaction(context, async tx => {
    const row = await taskRow(context, input.caseId, input.activityId, tx, true);
    const reviewed=await approval(context,'k5_case_tasks_update',approvalId,input,tx);
    if(reviewed?.result)return expose({task:await view(context,row,tx)},[row]);
    if (row.version !== input.version) throw conflict();
    const policy=combinePolicy(input.title,input.notes,[taskPolicy(row),reviewed?.policy ?? personPolicy(input.title,input.notes)],'person');
    await assignee(context, input.caseId, input.assigneeId, tx);
    if(input.assigneeId)await assertPolicyAccess(input.assigneeId,policy,tx);
    const token = randomUUID(), now = new Date().toISOString();
    await tx.prepare('UPDATE agenda_activity SET title=?,notes=?,status=?,due_on=?,assignee_id=?,version=version+1,updated_at=?,mutation_token=?,content_policy=?::jsonb WHERE id=? AND version=?')
      .run(input.title, input.notes, input.status, input.dueOn, input.assigneeId, now, token,JSON.stringify(policy), row.id, input.version);
    const assignment = input.assigneeId !== row.assignee_id;
    const event = agendaEventStatement(database, { officeId: row.office_id, activityId: row.id, activityVersion: row.version + 1, mutationToken: token,
      actorUserId: context.userId, eventType: assignment ? 'agenda.activity.assigned' : 'agenda.activity.changed',
      intendedRecipientIds: [...new Set([row.created_by, row.assignee_id, input.assigneeId].filter((id): id is string => Boolean(id)))],
      data: { activityTitle: input.title, status: input.status, assigneeId: input.assigneeId, previousAssigneeId: row.assignee_id }, createdAt: now });
    await tx.prepare(event.sql).run(...event.params);
    await receipt(tx,reviewed?.id,row.id);
    const updated=await taskRow(context,input.caseId,row.id,tx);
    return expose({ task: await view(context, updated, tx) }, [updated]);
  });
}
