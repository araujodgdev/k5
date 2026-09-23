import 'server-only';
import { database } from '@/lib/database';
import { createConversation, conversation } from '@/lib/ai-store';
import { requireAgentApproval } from './approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

export async function listConversations(context: WorkspaceContext, input: CapabilityInput<'k5_conversations_list'>): Promise<CapabilityOutput<'k5_conversations_list'>> {
  const limit = input.limit ?? 50;
  const rows = await database.prepare(
    'SELECT id, title, updated_at AS updatedAt FROM ai_conversation WHERE office_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?'
  ).all(context.officeId, context.userId, limit) as Array<{ id: string; title: string; updatedAt: string }>;
  return { conversations: rows };
}

export async function getConversation(context: WorkspaceContext, input: CapabilityInput<'k5_conversations_get'>): Promise<CapabilityOutput<'k5_conversations_get'>> {
  const stored = await conversation(database, { officeId: context.officeId, userId: context.userId }, input.conversationId);
  if (!stored) throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
  return {
    conversation: stored.conversation,
    messageCount: stored.messages.length,
  };
}

export async function createNewConversation(context: WorkspaceContext, input: CapabilityInput<'k5_conversations_create'>): Promise<CapabilityOutput<'k5_conversations_create'>> {
  const created = await createConversation(database, { officeId: context.officeId, userId: context.userId });
  if (input.title?.trim()) {
    await database.prepare('UPDATE ai_conversation SET title=? WHERE id=? AND office_id=? AND user_id=?')
      .run(input.title.trim(), created.id, context.officeId, context.userId);
    created.title = input.title.trim();
  }
  return { conversation: created };
}

export async function deleteConversation(context: WorkspaceContext, input: CapabilityInput<'k5_conversations_delete'>): Promise<CapabilityOutput<'k5_conversations_delete'>> {
  const row = await database.prepare('SELECT id, busy_until FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
    .get(input.conversationId, context.officeId, context.userId) as { id: string; busy_until: number } | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
  if (row.busy_until > Date.now()) throw new CapabilityError('CONFLICT', 'Não é possível excluir uma conversa com resposta em processamento.');
  await requireAgentApproval(context, 'k5_conversations_delete', input.approvalId, { conversationId: input.conversationId }, input.conversationId, 'Excluir uma conversa pede confirmação.');

  await database.prepare('DELETE FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').run(input.conversationId, context.officeId, context.userId);
  return { success: true };
}
