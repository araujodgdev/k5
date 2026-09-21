import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database, type BoundStatement } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput as Input } from '@/lib/capabilities/contracts';
import { activityData, activityDto, crmClientDto, type CrmClient } from '@/lib/capabilities/agenda';
import { agendaEventStatement } from '@/lib/notifications/events';
import type { WorkspaceContext } from './context';

const clientColumns = 'id, name, email, phone, notes, stage, version, created_at AS createdAt, updated_at AS updatedAt';
const activityColumns = 'id, kind, title, notes, status, due_on AS dueOn, starts_at AS startsAt, ends_at AS endsAt, client_id AS clientId, case_id AS caseId, assignee_id AS assigneeId, version, created_at AS createdAt, updated_at AS updatedAt';
const missing = () => new CapabilityError('NOT_FOUND', 'Registro não encontrado neste escritório.');
const conflict = () => new CapabilityError('CONFLICT', 'Este registro mudou. Atualize a página e tente novamente.');
const mutationToken = (context: WorkspaceContext) => context.agendaConfirmation
  ? `${context.agendaConfirmation.proposalId}:${context.agendaConfirmation.hash}`
  : randomUUID();
const creationId = (context: WorkspaceContext, kind: string, key?: string) => key
  ? createHash('sha256').update(JSON.stringify([context.officeId, context.userId, kind, key])).digest('hex')
  : randomUUID();

async function validateReferences(context: WorkspaceContext, values: { clientId?: string | null; caseId?: string | null; assigneeId?: string | null }) {
  for (const [id, sql] of [
    [values.clientId, 'SELECT 1 FROM crm_client WHERE id=? AND office_id=?'],
    [values.caseId, 'SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL'],
    [values.assigneeId, 'SELECT 1 FROM office_member WHERE user_id=? AND office_id=?'],
  ] as const) {
    if (id && !await database.prepare(sql).get(id, context.officeId)) throw missing();
  }
}

async function clientFromRow(context: WorkspaceContext, row: Record<string, unknown>) {
  const cases = await database.prepare('SELECT case_id FROM crm_client_case WHERE office_id=? AND client_id=?').all<{ case_id: string }>(context.officeId, row.id);
  return crmClientDto.parse({ ...row, caseIds: cases.map(c => c.case_id) });
}

export async function getClient(context: WorkspaceContext, input: Input<'k5_crm_get_client'>) {
  const row = await database.prepare(`SELECT ${clientColumns} FROM crm_client WHERE office_id=? AND id=?`).get(context.officeId, input.clientId);
  if (!row) throw missing();
  return { client: await clientFromRow(context, row) };
}

export async function listClients(context: WorkspaceContext, input: Input<'k5_crm_list_clients'>) {
  const where = ['office_id=?'];
  const params: unknown[] = [context.officeId];
  if (input.query) { where.push('instr(lower(name), lower(?))>0'); params.push(input.query); }
  if (input.stage) { where.push('stage=?'); params.push(input.stage); }
  if (input.caseId) { where.push('id IN (SELECT client_id FROM crm_client_case WHERE office_id=? AND case_id=?)'); params.push(context.officeId, input.caseId); }
  const filter = where.join(' AND ');
  const rows = await database.prepare(`SELECT ${clientColumns} FROM crm_client WHERE ${filter} ORDER BY name, id LIMIT ? OFFSET ?`).all(...params, input.limit, input.offset);
  const count = await database.prepare(`SELECT count(*) AS total FROM crm_client WHERE ${filter}`).get<{ total: number }>(...params);
  return { clients: await Promise.all(rows.map(row => clientFromRow(context, row))), total: count!.total };
}

async function saveClient(context: WorkspaceContext, value: Omit<CrmClient, 'createdAt' | 'updatedAt'>, creating: boolean) {
  const caseIds = [...new Set(value.caseIds)];
  for (const caseId of caseIds) await validateReferences(context, { caseId });
  const token = randomUUID();
  const now = new Date().toISOString();
  const write = creating
    ? database.prepare('INSERT INTO crm_client(id,office_id,name,email,phone,notes,stage,version,created_at,updated_at,mutation_token) VALUES(?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(value.id, context.officeId, value.name, value.email || null, value.phone || null, value.notes, value.stage, now, now, token)
    : database.prepare('UPDATE crm_client SET name=?,email=?,phone=?,notes=?,stage=?,version=version+1,updated_at=?,mutation_token=? WHERE id=? AND office_id=? AND version=?')
      .bind(value.name, value.email || null, value.phone || null, value.notes, value.stage, now, token, value.id, context.officeId, value.version);
  // Every association write is gated by the successful compare-and-swap in the same batch.
  const guard = 'EXISTS(SELECT 1 FROM crm_client WHERE id=? AND office_id=? AND mutation_token=?)';
  const results = await database.batch([
    write,
    database.prepare(`DELETE FROM crm_client_case WHERE client_id=? AND office_id=? AND ${guard}`).bind(value.id, context.officeId, value.id, context.officeId, token),
    ...caseIds.map(caseId => database.prepare(`INSERT INTO crm_client_case(office_id,client_id,case_id) SELECT ?,?,? WHERE ${guard}`).bind(context.officeId, value.id, caseId, value.id, context.officeId, token)),
  ]);
  const result = await getClient(context, { clientId: value.id });
  if (!results[0].changes) {
    if (!creating) throw conflict();
    const existing = result.client;
    if (existing.name !== value.name || existing.email !== (value.email || null) || existing.phone !== (value.phone || null) || existing.notes !== value.notes || existing.stage !== value.stage || JSON.stringify([...existing.caseIds].sort()) !== JSON.stringify([...caseIds].sort())) throw conflict();
  }
  return result;
}

export function createClient(context: WorkspaceContext, input: Input<'k5_crm_create_client'>) {
  return saveClient(context, crmClientDto.parse({ ...input, id: creationId(context, 'client', input.idempotencyKey), version: 1, createdAt: '', updatedAt: '' }), true);
}
export async function updateClient(context: WorkspaceContext, input: Input<'k5_crm_update_client'>) {
  const { client } = await getClient(context, input);
  const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return saveClient(context, crmClientDto.parse({ ...client, ...changes }), false);
}

export async function listMembers(context: WorkspaceContext) {
  return { members: await database.prepare('SELECT u.id,u.name FROM user u JOIN office_member m ON m.user_id=u.id WHERE m.office_id=? ORDER BY u.name,u.id').all(context.officeId) };
}

export async function getActivity(context: WorkspaceContext, input: Input<'k5_agenda_get_activity'>) {
  const row = await database.prepare(`SELECT ${activityColumns} FROM agenda_activity WHERE office_id=? AND id=?`).get(context.officeId, input.activityId);
  if (!row) throw missing();
  return { activity: activityDto.parse(row) };
}

export async function listActivities(context: WorkspaceContext, input: Input<'k5_agenda_list_activities'>) {
  input = { ...input, from: input.from ? new Date(input.from).toISOString() : undefined, to: input.to ? new Date(input.to).toISOString() : undefined };
  if ((input.from && input.to && input.from >= input.to) || (input.dueFrom && input.dueTo && input.dueFrom > input.dueTo)) throw new CapabilityError('INVALID', 'O fim do período deve ser posterior ao início.');
  const where = ['office_id=?'];
  const params: unknown[] = [context.officeId];
  for (const [field, value] of [['kind', input.kind], ['status', input.status], ['client_id', input.clientId], ['case_id', input.caseId], ['assignee_id', input.assigneeId]] as const) {
    if (value) { where.push(`${field}=?`); params.push(value); }
  }
  if (input.query) { where.push('instr(lower(title),lower(?))>0'); params.push(input.query); }
  const task: string[] = []; const meeting: string[] = []; const dates: unknown[] = [];
  if (input.dueFrom) { task.push('due_on>=?'); dates.push(input.dueFrom); }
  if (input.dueTo) { task.push('due_on<=?'); dates.push(input.dueTo); }
  if (input.from) { meeting.push('ends_at>?'); dates.push(input.from); }
  if (input.to) { meeting.push('starts_at<?'); dates.push(input.to); }
  if (task.length || meeting.length) {
    where.push(`((kind='task' AND ${task.length ? task.join(' AND ') : '0'}) OR (kind='meeting' AND ${meeting.length ? meeting.join(' AND ') : '0'}))`);
    params.push(...dates);
  }
  const filter = where.join(' AND ');
  const rows = await database.prepare(`SELECT ${activityColumns} FROM agenda_activity WHERE ${filter} ORDER BY coalesce(due_on,starts_at,'9999'),id LIMIT ? OFFSET ?`).all(...params, input.limit, input.offset);
  const count = await database.prepare(`SELECT count(*) AS total FROM agenda_activity WHERE ${filter}`).get<{ total: number }>(...params);
  return { activities: rows.map(row => activityDto.parse(row)), total: count!.total };
}

export async function createActivity(context: WorkspaceContext, input: Input<'k5_agenda_create_activity'>) {
  const value = activityData.parse(input);
  value.startsAt = value.startsAt ? new Date(value.startsAt).toISOString() : null;
  value.endsAt = value.endsAt ? new Date(value.endsAt).toISOString() : null;
  await validateReferences(context, value);
  const id = creationId(context, 'activity', input.idempotencyKey); const now = new Date().toISOString();
  const token = mutationToken(context);
  const event = agendaEventStatement(database, {
    officeId: context.officeId, activityId: id, activityVersion: 1, mutationToken: token,
    actorUserId: context.userId, eventType: 'agenda.activity.assigned',
    intendedRecipientIds: value.assigneeId ? [value.assigneeId] : [],
    data: { activityTitle: value.title, assigneeId: value.assigneeId, previousAssigneeId: null }, createdAt: now,
  });
  const inserted = await commitActivity(context, id, token, database.prepare('INSERT INTO agenda_activity(id,office_id,kind,title,notes,status,due_on,starts_at,ends_at,client_id,case_id,assignee_id,created_by,created_at,updated_at,mutation_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, context.officeId, value.kind, value.title, value.notes, value.status, value.dueOn, value.startsAt, value.endsAt, value.clientId, value.caseId, value.assigneeId, context.userId, now, now, token), [event]);
  const result = await getActivity(context, { activityId: id });
  if (!inserted.changes && JSON.stringify(activityData.parse(result.activity)) !== JSON.stringify(value)) throw conflict();
  return result;
}

export async function updateActivity(context: WorkspaceContext, input: Input<'k5_agenda_update_activity'>) {
  const { activity } = await getActivity(context, input);
  const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const value = activityData.parse({ ...activity, ...changes });
  value.startsAt = value.startsAt ? new Date(value.startsAt).toISOString() : null;
  value.endsAt = value.endsAt ? new Date(value.endsAt).toISOString() : null;
  // Only revalidate references being assigned; old records remain editable after a member leaves.
  await validateReferences(context, input);
  const creator = await database.prepare('SELECT created_by FROM agenda_activity WHERE id=? AND office_id=?')
    .get<{ created_by: string }>(input.activityId, context.officeId);
  const token = mutationToken(context);
  const now = new Date().toISOString();
  const assignmentChanged = activity.assigneeId !== value.assigneeId;
  const relevantChanged = assignmentChanged || activity.status !== value.status || activity.dueOn !== value.dueOn
    || activity.startsAt !== value.startsAt || activity.endsAt !== value.endsAt;
  const recipients = assignmentChanged
    ? [activity.assigneeId, value.assigneeId, creator?.created_by]
    : [creator?.created_by, value.assigneeId];
  const events = relevantChanged ? [agendaEventStatement(database, {
    officeId: context.officeId, activityId: input.activityId, activityVersion: input.version + 1,
    mutationToken: token, actorUserId: context.userId,
    eventType: assignmentChanged ? 'agenda.activity.assigned' : 'agenda.activity.changed',
    intendedRecipientIds: recipients.filter((id): id is string => Boolean(id)),
    data: {
      activityTitle: value.title, assigneeId: value.assigneeId,
      previousAssigneeId: activity.assigneeId, status: value.status,
    },
    createdAt: now,
  })] : [];
  const result = await commitActivity(context, input.activityId, token, database.prepare('UPDATE agenda_activity SET kind=?,title=?,notes=?,status=?,due_on=?,starts_at=?,ends_at=?,client_id=?,case_id=?,assignee_id=?,version=version+1,updated_at=?,mutation_token=? WHERE id=? AND office_id=? AND version=?')
    .bind(value.kind, value.title, value.notes, value.status, value.dueOn, value.startsAt, value.endsAt, value.clientId, value.caseId, value.assigneeId, now, token, input.activityId, context.officeId, input.version), events);
  if (!result.changes) throw conflict();
  return getActivity(context, input);
}

/** Activity and the exact confirmation receipt commit atomically, including crash/retry recovery. */
async function commitActivity(context: WorkspaceContext, activityId: string, token: string, mutation: BoundStatement, extra: BoundStatement[] = []) {
  const confirmation = context.agendaConfirmation;
  const writes = [mutation, ...extra];
  if (confirmation) writes.push(database.prepare(`UPDATE agenda_proposal SET status='applied',result=(
    SELECT json_object('activity',json_object('id',id,'kind',kind,'title',title,'notes',notes,'status',status,
    'dueOn',due_on,'startsAt',starts_at,'endsAt',ends_at,'clientId',client_id,'caseId',case_id,'assigneeId',assignee_id,
    'version',version,'createdAt',created_at,'updatedAt',updated_at)) FROM agenda_activity WHERE id=? AND office_id=? AND mutation_token=?)
    WHERE id=? AND office_id=? AND user_id=? AND confirmation_hash=? AND EXISTS(SELECT 1 FROM agenda_activity WHERE id=? AND office_id=? AND mutation_token=?)`)
    .bind(activityId, context.officeId, token, confirmation.proposalId, context.officeId, context.userId, confirmation.hash, activityId, context.officeId, token));
  return (await database.batch(writes))[0];
}
