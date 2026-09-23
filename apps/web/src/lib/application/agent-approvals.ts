import 'server-only';
import type { UIMessage } from 'ai';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { findVaultCase, findVaultDocument, findVaultFolder } from '@/lib/vault';
import { findCaseLink } from '@/lib/judicial/repositories/links';
import { conversation, saveMessages } from '@/lib/ai-store';
import { runCapability, toolSummary } from '@/lib/agent-tools';
import type { WorkspaceContext } from './context';
import { agentConfirmedCapabilities, approveProposal, getApprovalProposal, rejectProposal } from './approvals-service';

export type AgentApprovalState = 'pending' | 'confirmed' | 'cancelled' | 'failed';
export type AgentApprovalPart = { approvalId: string; capability: string; summary: string; state: AgentApprovalState; result?: string; href?: string };

type Confirmed = (typeof agentConfirmedCapabilities)[number];
const isConfirmed = (name: string): name is Confirmed => (agentConfirmedCapabilities as readonly string[]).includes(name);

/** What the person is about to confirm, in their words: the name of the thing, not an id. */
export async function describeAgentApproval(context: WorkspaceContext, capability: string, input: Record<string, unknown>): Promise<string> {
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const quoted = (name: string | undefined | null) => name ? ` “${name}”` : '';
  switch (capability) {
    case 'k5_vault_delete_document': return `Excluir o documento${quoted((await findVaultDocument(context.officeId, text(input.documentId)))?.name)}`;
    case 'k5_vault_delete_case': {
      const name = (await findVaultCase(context.officeId, text(input.caseId)))?.name;
      return input.targetCaseId ? `Excluir o caso${quoted(name)} e mover os documentos para outro caso` : `Excluir o caso${quoted(name)} com os documentos e pastas`;
    }
    case 'k5_vault_delete_folder': return `Remover a pasta${quoted((await findVaultFolder(context.officeId, text(input.folderId)))?.name)} (o conteúdo sobe um nível)`;
    case 'k5_conversations_delete': {
      const row = await database.prepare('SELECT title FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
        .get(text(input.conversationId), context.officeId, context.userId) as { title: string } | undefined;
      return `Excluir a conversa${quoted(row?.title)}`;
    }
    case 'k5_artifacts_update': return `Salvar uma nova versão da minuta${quoted(text(input.title))}`;
    case 'k5_judicial_confirm_link':
    case 'k5_judicial_unlink_case':
    case 'k5_judicial_request_refresh': {
      const link = await findCaseLink(context.officeId, text(input.linkId));
      const process = link ? ` ${link.cnjNumber ?? link.nativeNumber ?? ''} (${link.courtName})`.replace(/\s+\(/, ' (') : '';
      if (capability === 'k5_judicial_unlink_case') return `Remover o vínculo do processo${process}`;
      if (capability === 'k5_judicial_request_refresh') return `Consultar o tribunal para atualizar o processo${process}`;
      return input.decision === 'rejected' ? `Rejeitar o vínculo do processo${process}` : `Confirmar o vínculo do processo${process} e autorizar consultas recorrentes`;
    }
    default: return 'Executar esta ação';
  }
}

/** Where the person can see the result of an agent action. Only ids from the result, never from the model's text. */
export function resourceHref(name: string, result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = result as Record<string, { id?: string; caseId?: string | null } | string | undefined>;
  const id = (key: string) => { const item = value[key]; return item && typeof item === 'object' && typeof item.id === 'string' ? item.id : undefined; };
  if (name.startsWith('k5_agenda_') && id('activity')) return `/app/agenda?activityId=${encodeURIComponent(id('activity')!)}`;
  if (name.startsWith('k5_crm_') && id('client')) return `/app/agenda/clients/${encodeURIComponent(id('client')!)}`;
  if (name.startsWith('k5_vault_') && id('case')) return `/app/vault/cases/${encodeURIComponent(id('case')!)}`;
  const document = value.document;
  if (name.startsWith('k5_vault_') && document && typeof document === 'object' && document.caseId) return `/app/vault/cases/${encodeURIComponent(document.caseId)}`;
  if (name.startsWith('k5_artifacts_') && id('artifact')) return `/app/documents/${encodeURIComponent(id('artifact')!)}`;
  return undefined;
}

/**
 * Pressing Confirmar in the chat approves the stored proposal and runs exactly the input it
 * recorded, through the same capability path the agent uses. The model is not asked to repeat
 * the call: a large input (a whole draft) would not survive being retyped.
 */
export async function decideAgentApproval(context: WorkspaceContext, approvalId: string, decision: 'confirm' | 'cancel', conversationId?: string) {
  const row = await getApprovalProposal(context, approvalId);
  if (!isConfirmed(row.capability_name)) throw new CapabilityError('FORBIDDEN', 'Esta confirmação não pode ser feita pelo chat.');
  let part: Pick<AgentApprovalPart, 'state' | 'result' | 'href'>;
  if (decision === 'cancel') {
    await rejectProposal(context, approvalId);
    part = { state: 'cancelled', result: 'Cancelado. Nada foi alterado.' };
  } else {
    await approveProposal(context, approvalId);
    const input = { ...(JSON.parse(row.normalized_input) as Record<string, unknown>), approvalId };
    try {
      const result = await runCapability({ ...context, invocation: 'agent' }, row.capability_name as CapabilityName, input);
      part = { state: 'confirmed', result: toolSummary(row.capability_name, result, false), href: resourceHref(row.capability_name, result) };
    } catch (error) {
      part = { state: 'failed', result: error instanceof CapabilityError ? error.message : 'Não foi possível concluir a ação.' };
    }
  }
  if (conversationId) await recordDecision(context, conversationId, approvalId, part);
  return part;
}

/** The decision is written into the stored message, so the button does not come back on reload. */
async function recordDecision(context: WorkspaceContext, conversationId: string, approvalId: string, update: Pick<AgentApprovalPart, 'state' | 'result' | 'href'>) {
  const owner = { officeId: context.officeId, userId: context.userId };
  const stored = await conversation(database, owner, conversationId);
  if (!stored) return; // the confirmed action may have been deleting this very conversation
  let changed = false;
  const messages: UIMessage[] = stored.messages.map(message => ({
    ...message,
    parts: message.parts.map(part => {
      if (part.type !== 'data-approval' || (part.data as AgentApprovalPart | undefined)?.approvalId !== approvalId) return part;
      changed = true;
      return { ...part, data: { ...(part.data as AgentApprovalPart), ...update } };
    }),
  }));
  if (changed) await saveMessages(database, owner, conversationId, messages);
}
