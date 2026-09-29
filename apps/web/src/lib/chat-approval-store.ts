import type { UIMessage } from 'ai';
import type { Database } from './database';
import type { Owner } from './ai-store';
import { applyApprovalDecisions, approvalDecision, type ApprovalDecision } from './chat-approval-state';

export async function restoreApprovalDecisions(db: Database, owner: Owner, messages: UIMessage[]) {
  const pending = new Set(messages.flatMap(message => message.parts.flatMap(part =>
    part.type === 'data-approval' && part.data && typeof part.data === 'object' && 'state' in part.data && part.data.state === 'pending' && 'approvalId' in part.data ? [part.data.approvalId] : [])));
  const ids = messages.flatMap(message => message.parts.flatMap(part =>
    part.type === 'data-approval' && part.data && typeof part.data === 'object' && 'approvalId' in part.data && typeof part.data.approvalId === 'string' ? [part.data.approvalId] : []));
  if (!ids.length) return messages;
  const rows = await db.prepare(`SELECT id,status,expires_at,chat_result FROM capability_approval
    WHERE office_id=? AND user_id=? AND id=ANY(?::text[])`).all<{
      id: string; status: string; expires_at: number; chat_result: string | null;
    }>(owner.officeId, owner.userId, ids);
  const decisions = new Map<string, ApprovalDecision>();
  for (const row of rows) {
    if (row.chat_result) decisions.set(row.id, approvalDecision.parse(JSON.parse(row.chat_result)));
    else if (!pending.has(row.id)) continue;
    else if (row.status === 'rejected') decisions.set(row.id, { state: 'cancelled', result: 'Cancelado. Nada foi alterado.' });
    else if (row.status !== 'pending') decisions.set(row.id, { state: 'failed', result: 'Esta autorização já foi utilizada. Confira o resultado da ação antes de solicitar outra.' });
    else if (row.expires_at < Date.now()) decisions.set(row.id, { state: 'failed', result: 'Esta autorização expirou. Solicite uma nova ao Lume.' });
  }
  return applyApprovalDecisions(messages, decisions);
}
