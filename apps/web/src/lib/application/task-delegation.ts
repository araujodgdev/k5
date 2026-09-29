import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from './context';
import { getActivity } from './agenda-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import { scopeCapability } from '@/lib/collaboration/capability-access';
import { planTaskModel } from '@/lib/ai-connections';
import { startChatRun } from '@/lib/chat-run';
import { agendaEventStatement } from '@/lib/notifications/events';

export const taskDelegationInput = z.object({ activityId: z.string().min(1).max(64), timeZone: z.string().max(80).optional() }).strict();

export async function delegateTask(context: WorkspaceContext, raw: unknown, options: {
  ready?: () => Promise<boolean>; start?: typeof startChatRun;
} = {}) {
  const input = taskDelegationInput.parse(raw);
  const authorized = await assertCapabilityAllowed(context, 'k5_agenda_update_activity');
  const { activity } = await getActivity(authorized, input);
  if (activity.kind !== 'task') throw new CapabilityError('INVALID', 'Somente tarefas podem ser delegadas ao Lume.');
  await scopeCapability(authorized, 'k5_knowledge_search', { caseId: activity.caseId ?? undefined, documentIds: [] });
  const ready = options.ready ?? (async () => (await planTaskModel('agent.chat')).status === 'ready');
  const available = await ready();
  const requireReady = () => { if (!available) throw new CapabilityError('NOT_READY', 'O Lume está indisponível. Confira a configuração de IA com o administrador.'); };
  const result = await withTransaction(async tx => {
    // Lock the task to serialize first delegation and its retries, without holding a model call open.
    const current = await tx.prepare('SELECT status,version,created_by FROM agenda_activity WHERE id=? AND office_id=? FOR UPDATE')
      .get<{ status: string; version: number; created_by: string }>(activity.id, authorized.officeId);
    if (!current) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
    const existing = await tx.prepare(`SELECT c.id,c.messages,c.busy_until FROM agenda_delegation d JOIN ai_conversation c ON c.id=d.conversation_id
      WHERE d.activity_id=? AND d.office_id=? AND d.user_id=? AND c.office_id=? AND c.user_id=?`)
      .get<{ id: string; messages: string; busy_until: number }>(activity.id, authorized.officeId, authorized.userId, authorized.officeId, authorized.userId);
    if (existing) {
      const messages = z.array(z.object({ role: z.string() })).parse(JSON.parse(existing.messages));
      if (current.status === 'completed' || current.status === 'cancelled' || existing.busy_until > Date.now() || messages.some(message => message.role === 'assistant')) return { id: existing.id, start: false };
      requireReady();
      const claimed = await tx.prepare('UPDATE ai_conversation SET busy_until=? WHERE id=? AND office_id=? AND user_id=? AND busy_until<?')
        .run(Date.now() + 300_000, existing.id, authorized.officeId, authorized.userId, Date.now());
      return { id: existing.id, start: claimed.changes === 1 };
    }
    if (current.status === 'completed' || current.status === 'cancelled') throw new CapabilityError('INVALID', 'Reabra a tarefa antes de delegá-la.');
    if (current.version !== activity.version) throw new CapabilityError('CONFLICT', 'A tarefa mudou. Atualize a página e tente novamente.');
    requireReady();
    const id = randomUUID();
    const text = `Execute esta tarefa do escritório: ${activity.title}\n\nConsulte a atividade ${activity.id} para conferir os dados atuais e use o caso e o cliente vinculados quando necessário. Mantenha a tarefa em andamento enquanto houver trabalho pendente. Conclua somente após entregar o resultado solicitado. Se faltar informação, pergunte nesta conversa.\n\nDados da tarefa:\n${JSON.stringify({ title: activity.title, notes: activity.notes, dueOn: activity.dueOn, caseId: activity.caseId, clientId: activity.clientId })}`;
    const messages = [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }];
    await tx.prepare('INSERT INTO ai_conversation(id,office_id,user_id,title,messages,busy_until) VALUES(?,?,?,?,?,?)')
      .run(id, authorized.officeId, authorized.userId, activity.title.slice(0, 80), JSON.stringify(messages), Date.now() + 300_000);
    await tx.prepare('INSERT INTO agenda_delegation(activity_id,office_id,user_id,conversation_id) VALUES(?,?,?,?)')
      .run(activity.id, authorized.officeId, authorized.userId, id);
    if (current.status === 'pending') {
      const token = randomUUID();
      await tx.prepare("UPDATE agenda_activity SET status='in_progress',version=version+1,updated_at=CURRENT_TIMESTAMP,mutation_token=? WHERE id=? AND office_id=?")
        .run(token, activity.id, authorized.officeId);
      const event = agendaEventStatement(database, { officeId: authorized.officeId, activityId: activity.id, activityVersion: current.version + 1,
        mutationToken: token, actorUserId: authorized.userId, eventType: 'agenda.activity.changed',
        intendedRecipientIds: [current.created_by, ...(activity.assigneeId ? [activity.assigneeId] : [])],
        data: { activityTitle: activity.title, status: 'in_progress' }, createdAt: new Date().toISOString() });
      await tx.prepare(event.sql).run(...event.params);
    }
    return { id, start: true };
  });
  if (result.start) {
    try {
      await (options.start ?? startChatRun)({ workspace: authorized, conversationId: result.id,
        request: { caseId: activity.caseId ?? undefined, documentIds: [], researchReferenceIds: [], attachments: [], timeZone: input.timeZone } });
    } catch (error) {
      await database.prepare('UPDATE ai_conversation SET busy_until=0 WHERE id=? AND office_id=? AND user_id=?')
        .run(result.id, authorized.officeId, authorized.userId);
      throw error;
    }
  }
  return { conversationId: result.id, url: `/app/agents?conversationId=${encodeURIComponent(result.id)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}` };
}
