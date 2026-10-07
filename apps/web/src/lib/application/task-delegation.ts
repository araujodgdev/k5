import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/database';
import { assertCapabilityAllowed, assertLumeAdmission, type WorkspaceContext } from './context';
import { getActivity } from './agenda-service';
import { getCaseTask, taskAccess, taskRow, taskPolicy } from '@/lib/case-tasks/service';
import { combinePolicy } from '@/lib/content-policy';
import { documentTransaction } from '@/lib/documents/service';
import { CapabilityError } from '@/lib/capabilities/errors';
import { scopeCapability } from '@/lib/collaboration/capability-access';
import { planTaskModel } from '@/lib/ai-connections';
import { startChatRun } from '@/lib/chat-run';
import { admitTurn, releaseTurn, TurnRefused, type TurnLease } from '@/lib/chat-lease';
import { agendaEventStatement } from '@/lib/notifications/events';

export const taskDelegationInput = z.object({ activityId: z.string().min(1).max(64), timeZone: z.string().max(80).optional() }).strict();

export async function delegateTask(context: WorkspaceContext, raw: unknown, options: {
  ready?: () => Promise<boolean>; start?: typeof startChatRun;
} = {}) {
  const input = taskDelegationInput.parse(raw);
  const identity = await database.prepare('SELECT visibility,case_id,office_id FROM agenda_activity WHERE id=?')
    .get<{ visibility: string; case_id: string | null; office_id: string }>(input.activityId);
  const shared = identity?.visibility === 'case';
  const authorized = { ...context, officeId: context.caseScope?.homeOfficeId ?? context.officeId, caseScope: undefined };
  if (shared) await taskAccess(authorized, identity.case_id!);
  else await assertCapabilityAllowed(authorized, 'k5_agenda_update_activity');
  const activity = shared ? { ...(await getCaseTask(authorized,{caseId:identity.case_id!,activityId:input.activityId})).task, kind:'task', clientId:null }
    : (await getActivity(authorized,input)).activity;
  if (activity.kind !== 'task') throw new CapabilityError('INVALID', 'Somente tarefas podem ser delegadas ao Lume.');
  const taskOfficeId = shared ? identity!.office_id : authorized.officeId;
  await scopeCapability({ ...authorized, invocation:'agent' }, 'k5_knowledge_search', { caseId: activity.caseId ?? undefined, documentIds: [] });
  const ready = options.ready ?? (async () => (await planTaskModel('agent.chat')).status === 'ready');
  const available = await ready();
  const requireReady = () => { if (!available) throw new CapabilityError('NOT_READY', 'O Lume está indisponível. Confira a configuração de IA com o administrador.'); };
  const result = await documentTransaction(authorized, async (tx): Promise<{ id: string; lease: TurnLease | null }> => {
    const sharedRow = shared ? await taskRow(authorized,activity.caseId!,activity.id,tx) : undefined;
    if (activity.caseId) {
      await assertLumeAdmission(activity.caseId,tx);
    }
    const current = await tx.prepare('SELECT status,version,created_by FROM agenda_activity WHERE id=? AND office_id=? FOR UPDATE')
      .get<{ status: string; version: number; created_by: string }>(activity.id, taskOfficeId);
    if (!current) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
    const existing = await tx.prepare(`SELECT c.id,c.messages FROM agenda_delegation d JOIN ai_conversation c ON c.id=d.conversation_id
      WHERE d.activity_id=? AND d.office_id=? AND d.user_id=? AND c.office_id=? AND c.user_id=?`)
      .get<{ id: string; messages: string }>(activity.id, authorized.officeId, authorized.userId, authorized.officeId, authorized.userId);
    if (existing) {
      const messages = z.array(z.object({ role: z.string() })).parse(JSON.parse(existing.messages));
      if (current.status === 'completed' || current.status === 'cancelled' || messages.some(message => message.role === 'assistant')) return { id: existing.id, lease: null };
      requireReady();
      try { return { id: existing.id, lease: await admitTurn(tx, authorized, existing.id) }; } catch (error) {
        if (error instanceof TurnRefused && error.reason === 'busy') return { id: existing.id, lease: null };
        throw error;
      }
    }
    if (current.status === 'completed' || current.status === 'cancelled') throw new CapabilityError('INVALID', 'Reabra a tarefa antes de delegá-la.');
    if (current.version !== activity.version) throw new CapabilityError('CONFLICT', 'A tarefa mudou. Atualize a página e tente novamente.');
    requireReady();
    const id = randomUUID();
    const text = `Execute esta tarefa${shared ? ' compartilhada do caso' : ' do escritório'}: ${activity.title}\n\nConsulte ${shared ? 'a tarefa compartilhada com k5_case_tasks_get' : 'a atividade'} ${activity.id} para conferir os dados atuais e use o caso e o cliente vinculados quando necessário. Mantenha a tarefa em andamento enquanto houver trabalho pendente. Conclua somente após entregar o resultado solicitado. Se faltar informação, pergunte nesta conversa.\n\nDados da tarefa:\n${JSON.stringify({ title: activity.title, notes: activity.notes, dueOn: activity.dueOn, caseId: activity.caseId, clientId: activity.clientId })}`;
    const messageId=randomUUID(),submissionId=randomUUID();
    const scope={version:2,label:'Caso compartilhado',caseId:activity.caseId!,documentIds:[],researchReferenceIds:[]};
    const policy=sharedRow ? combinePolicy('',text,[taskPolicy(sharedRow)],'person',submissionId) : undefined;
    const messages = [{ id: messageId, role: 'user', parts: [{ type: 'text', text }],
      ...(policy ? {metadata:{contentPolicy:policy,submissionId,generationId:randomUUID(),lumeScope:scope}} : {}) }];
    await tx.prepare('INSERT INTO ai_conversation(id,office_id,user_id,title,messages) VALUES(?,?,?,?,?)')
      .run(id, authorized.officeId, authorized.userId, activity.title.slice(0, 80), JSON.stringify(messages));
    if(policy && sharedRow) {
      await tx.prepare(`INSERT INTO content_submission(id,office_id,user_id,conversation_id,message_id,request_text,scope,inputs,content_policy,input_format)
        VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,2)`).run(submissionId,authorized.officeId,authorized.userId,id,messageId,text,
          JSON.stringify(scope),JSON.stringify([{title:sharedRow.title,content:sharedRow.notes,policy:taskPolicy(sharedRow)}]),JSON.stringify(policy));
      await tx.prepare(`INSERT INTO ai_source_provenance(office_id,user_id,resource_kind,resource_id,complete,dependencies)
        VALUES(?,?,'conversation',?,?,?::jsonb)`).run(authorized.officeId,authorized.userId,id,policy.eligible,JSON.stringify(policy.guards));
    }
    await tx.prepare('INSERT INTO agenda_delegation(activity_id,office_id,user_id,conversation_id) VALUES(?,?,?,?)')
      .run(activity.id, authorized.officeId, authorized.userId, id);
    if (current.status === 'pending') {
      const token = randomUUID();
      await tx.prepare("UPDATE agenda_activity SET status='in_progress',version=version+1,updated_at=CURRENT_TIMESTAMP,mutation_token=? WHERE id=? AND office_id=?")
        .run(token, activity.id, taskOfficeId);
      const event = agendaEventStatement(database, { officeId: taskOfficeId, activityId: activity.id, activityVersion: current.version + 1,
        mutationToken: token, actorUserId: authorized.userId, eventType: 'agenda.activity.changed',
        intendedRecipientIds: [current.created_by, ...(activity.assigneeId ? [activity.assigneeId] : [])],
        data: { activityTitle: activity.title, status: 'in_progress' }, createdAt: new Date().toISOString() });
      await tx.prepare(event.sql).run(...event.params);
    }
    return { id, lease: await admitTurn(tx, authorized, id) };
  });
  if (result.lease) {
    try {
      await (options.start ?? startChatRun)({ workspace: authorized, conversationId: result.id, lease: result.lease,
        request: { caseId: activity.caseId ?? undefined, documentIds: [], researchReferenceIds: [], attachments: [], timeZone: input.timeZone } });
    } catch (error) {
      await releaseTurn(authorized, result.id, result.lease);
      throw error;
    }
  }
  return { conversationId: result.id, url: `/app/agents?conversationId=${encodeURIComponent(result.id)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}` };
}
