import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { findVaultCase, findVaultDocument, findVaultFolder } from '@/lib/vault';
import { findCaseLink } from '@/lib/judicial/repositories/links';
import { ownedArtifact } from '@/lib/ai-store';
import { runCapability, toolSummary } from '@/lib/agent-tools';
import type { WorkspaceContext } from './context';
import { agentConfirmedCapabilities, approveProposal, getApprovalProposal, rejectProposal } from './approvals-service';
import { collaborationAction, collaborationOverviewDto } from '@/lib/collaboration/contracts';
import { collaborationOverview } from '@/lib/collaboration/service';
import { caseAccess } from '@/lib/collaboration/access';
import { createShareInput } from '@/lib/personal-chat/domain';
import { agentSettingsCapabilities } from '@/lib/capabilities/agent-settings';
import { getAgentSettings } from './agent-settings-service';
import { getThread } from '@/lib/personal-chat/service';
import type { ApprovalDecision } from '@/lib/chat-approval-state';

export type AgentApprovalState = 'pending' | 'confirmed' | 'cancelled' | 'failed';
export type AgentApprovalPart = { approvalId: string; capability: string; summary: string; state: AgentApprovalState; result?: string; href?: string };

type Confirmed = (typeof agentConfirmedCapabilities)[number];
const isConfirmed = (name: string): name is Confirmed => (agentConfirmedCapabilities as readonly string[]).includes(name);

/** What the person is about to confirm, in their words: the name of the thing, not an id. */
export async function describeAgentApproval(context: WorkspaceContext, capability: string, input: Record<string, unknown>): Promise<string> {
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const quoted = (name: string | undefined | null) => name ? ` “${name}”` : '';
  switch (capability) {
    case 'k5_collaboration_change': {
      const change = collaborationAction.parse(input.change);
      if (change.action === 'invite') return `Convidar ${change.invitation.email} como associado`;
      const overview = collaborationOverviewDto.parse(await collaborationOverview(context, change.action === 'participant' ? change.caseId : undefined));
      if (change.action === 'respond' || change.action === 'cancel') {
        const invite = [...overview.incoming, ...overview.outgoing].find(item => item.id === change.id);
        if (!invite) throw new CapabilityError('NOT_FOUND', 'Convite indisponível.');
        return `${change.action === 'cancel' ? 'Cancelar' : change.accept ? 'Aceitar' : 'Recusar'} o convite de associação de ${invite.inviterName} para ${invite.email}`;
      }
      const user = [...overview.associates, ...overview.participants].find(item => item.id === change.userId);
      if (!user) throw new CapabilityError('NOT_FOUND', 'Pessoa indisponível neste contexto.');
      if (change.action === 'associate') return `Remover ${user.name} (${user.email}) dos associados, encerrando a participação nos casos em comum`;
      const caseName = quoted((await findVaultCase((await caseAccess(context.userId, change.caseId)).officeId, change.caseId, context.userId))?.name);
      return change.add ? `Incluir ${user.name} (${user.email}) como participante do caso${caseName}`
        : change.userId === context.userId ? `Sair do caso${caseName}` : `Remover ${user.name} (${user.email}) do caso${caseName}`;
    }
    case 'k5_messages_send':
    case 'k5_messages_share': {
      const row = await database.prepare('SELECT email,name FROM "user" WHERE id=?').get<{ email: string; name: string }>(context.userId);
      if (!row) return 'Conversa indisponível';
      const thread = await getThread({ ...row, userId: context.userId, sessionId: context.sessionId }, text(input.threadId));
      if (capability === 'k5_messages_send') {
        const body = input.body;
        return `Enviar mensagem para ${thread.peer.email}\n\n${body && typeof body === 'object' && 'text' in body ? text(body.text) : ''}`;
      }
      const share = createShareInput.parse(input.share);
      return `Compartilhar o documento${quoted((await findVaultDocument(context.officeId, share.documentId, context.userId))?.name)}, versão ${share.version}, com ${thread.peer.email}`;
    }
    case 'k5_messages_revoke_share': return `Revogar o compartilhamento ${text(input.shareId)}`;
    case 'k5_honorarios_reverse': {
      const receipt = await database.prepare(`SELECT a.title,c.name,r.amount_cents AS amount,i.number FROM honorario_receipt r
        JOIN honorario_installment i ON i.office_id=r.office_id AND i.id=r.installment_id
        JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
        JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
        WHERE r.id=? AND a.office_id=? AND a.created_by=?`).get<{ title: string; name: string; amount: number; number: number }>(text(input.receiptId), context.officeId, context.userId);
      if (!receipt) throw new CapabilityError('NOT_FOUND', 'Recebimento indisponível.');
      const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receipt.amount / 100);
      return `Estornar ${amount} da parcela ${receipt.number} de ${receipt.name}${quoted(receipt.title)}. Motivo: ${text(input.reason)}`;
    }
    case 'k5_honorarios_cancel': {
      const agreement = await database.prepare(`SELECT a.title,c.name FROM honorario_agreement a JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
        WHERE a.id=? AND a.office_id=? AND a.created_by=?`).get<{ title: string; name: string }>(text(input.agreementId), context.officeId, context.userId);
      if (!agreement) throw new CapabilityError('NOT_FOUND', 'Honorário indisponível.');
      return `Cancelar o honorário${quoted(agreement.title)} de ${agreement.name} e suas parcelas. Motivo: ${text(input.reason)}`;
    }
    case 'k5_agent_settings_change': {
      const { scope, change } = agentSettingsCapabilities.k5_agent_settings_change.input.parse(input);
      const target = scope === 'office' ? 'do escritório' : 'pessoal';
      const current = await getAgentSettings(context);
      switch (change.action) {
        case 'create_instruction': case 'update_instruction': return `${change.action === 'create_instruction' ? 'Criar' : 'Alterar'} regra ${target}${quoted(change.title)} (${change.enabled ? 'ativa' : 'inativa'}):\n${change.content}`;
        case 'delete_instruction': return `Excluir regra ${target}${quoted(current.instructions[scope].find(item => item.id === change.id)?.title)}`;
        case 'add_knowledge': return `Adicionar ao conhecimento ${target} o documento${quoted((await findVaultDocument(context.officeId, change.documentId, context.userId))?.name)} (${change.mode === 'always' ? 'usar sempre' : 'consultar na busca'}). ${change.note}`;
        case 'update_knowledge': return `Alterar conhecimento ${target}${quoted(current.knowledge[scope].find(item => item.id === change.id)?.name)} para ${change.mode === 'always' ? 'usar sempre' : 'consultar na busca'}. ${change.note}`;
        case 'remove_knowledge': return `Remover do conhecimento ${target} o documento${quoted(current.knowledge[scope].find(item => item.id === change.id)?.name)}`;
        case 'set_template': return change.documentId ? `Definir modelo Word ${target}${quoted((await findVaultDocument(context.officeId, change.documentId, context.userId))?.name)}` : `Remover modelo Word ${target}`;
      }
    }
    case 'k5_research_start_search': return `Pesquisar julgados sobre${quoted(text(input.theme))}${input.includeSources ? ', consultando também fontes externas habilitadas' : ' no acervo disponível'}`;
    case 'k5_research_request_page': return `Obter a próxima página da pesquisa ${text(input.searchId)}`;
    case 'k5_research_request_material': return `Obter ${input.kind === 'full_text' ? 'o inteiro teor' : 'a ementa'} do julgado ${text(input.judgmentId)}`;
    case 'k5_research_add_reference': return `Vincular o material ${text(input.materialVersionId)} ao caso${quoted((await findVaultCase(context.officeId, text(input.caseId), context.userId))?.name)}${input.bypassEvaluation ? ', dispensando a avaliação de pertinência' : ''}. ${text(input.notes)}`;
    case 'k5_research_update_reference': return `Alterar a referência ${text(input.referenceId)}${input.materialVersionId ? ` para a versão ${text(input.materialVersionId)}` : ''}${input.bypassEvaluation ? ', dispensando a avaliação de pertinência' : ''}. ${text(input.notes)}`;
    case 'k5_research_remove_reference': return `Remover a referência ${text(input.referenceId)} do caso, mantendo o julgado no acervo`;
    case 'k5_vault_delete_document': return `Excluir o documento${quoted((await findVaultDocument(context.officeId, text(input.documentId), context.userId))?.name)}`;
    case 'k5_vault_delete_case': {
      const name = (await findVaultCase(context.officeId, text(input.caseId), context.userId))?.name;
      return input.targetCaseId ? `Excluir o caso${quoted(name)} e mover os documentos para outro caso` : `Excluir o caso${quoted(name)} com os documentos e pastas`;
    }
    case 'k5_vault_delete_folder': return `Remover a pasta${quoted((await findVaultFolder(context.officeId, text(input.folderId), context.userId))?.name)} (o conteúdo sobe um nível)`;
    case 'k5_conversations_delete': {
      const row = await database.prepare('SELECT title FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
        .get(text(input.conversationId), context.officeId, context.userId) as { title: string } | undefined;
      return `Excluir a conversa${quoted(row?.title)}`;
    }
    case 'k5_artifacts_update': return `Salvar uma nova versão da minuta${quoted(text(input.title))}`;
    case 'k5_artifacts_edit': {
      const title = (await ownedArtifact(database, { officeId: context.officeId, userId: context.userId }, text(input.artifactId)))?.title;
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return `Alterar ${edits === 1 ? 'um trecho' : `${edits} trechos`} do documento${quoted(title)}`;
    }
    case 'k5_judicial_confirm_link':
    case 'k5_judicial_unlink_case':
    case 'k5_judicial_request_refresh': {
      const link = await findCaseLink(context.officeId, text(input.linkId));
      const process = link ? ` ${link.cnjNumber ?? link.nativeNumber ?? ''} (${link.courtName})`.replace(/\s+\(/, ' (') : '';
      if (capability === 'k5_judicial_unlink_case') return `Remover o vínculo do processo${process}`;
      if (capability === 'k5_judicial_request_refresh') return `Consultar o tribunal para atualizar o processo${process}`;
      return input.decision === 'rejected' ? `Rejeitar o vínculo do processo${process}` : `Confirmar o vínculo do processo${process} e autorizar consultas recorrentes`;
    }
    case 'k5_whatsapp_send': {
      const thread = await database.prepare('SELECT participant_id,participant_name FROM whatsapp_thread WHERE id=? AND office_id=?')
        .get<{ participant_id: string; participant_name: string }>(text(input.threadId), context.officeId);
      if (!thread) return 'Conversa WhatsApp indisponível';
      return `Enviar pelo WhatsApp para ${thread.participant_name || thread.participant_id} (${thread.participant_id})\n\n${text(input.text)}`;
    }
    case 'k5_gmail_send':
    case 'k5_gmail_save_draft': {
      const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      const recipients = [...list(input.to), ...list(input.cc), ...list(input.bcc)];
      const attachments = Array.isArray(input.attachments) ? input.attachments.length : 0;
      const verb = capability === 'k5_gmail_send' ? (input.draftId ? 'Enviar o rascunho' : 'Enviar o e-mail') : 'Salvar o rascunho';
      const to = recipients.length ? ` para ${recipients.slice(0, 5).join(', ')}${recipients.length > 5 ? ` e mais ${recipients.length - 5}` : ''}` : '';
      return `${verb}${quoted(text(input.subject))}${to}${attachments ? ` com ${attachments} anexo(s)` : ''}`;
    }
    case 'k5_calendar_create_event': return `Criar o evento${quoted(text(input.title))} na sua agenda Google`;
    case 'k5_calendar_update_event': return `Alterar o evento${quoted(text((input.changes as { title?: string } | undefined)?.title))} na sua agenda Google`;
    case 'k5_calendar_cancel_event': return 'Cancelar o evento na sua agenda Google';
    case 'k5_calendar_discard_pending': return `Descartar as alterações ainda não sincronizadas do evento ${text(input.eventId)}`;
    case 'k5_calendar_share_event': return `Compartilhar com o escritório o evento${quoted(text(input.title))}\nLocal: ${text(input.location)}\nNotas: ${text(input.notes)}`;
    case 'k5_calendar_unshare_event': return `Remover do escritório o evento compartilhado ${text(input.shareId)}`;
    case 'k5_gmail_delete_draft': return `Excluir o rascunho ${text(input.draftId)} do Gmail`;
    case 'k5_calendar_respond': return `Responder ao convite (${({ accepted: 'aceitar', declined: 'recusar', tentative: 'talvez' } as Record<string, string>)[text(input.response)] ?? text(input.response)})`;
    case 'k5_docs_edit': {
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return `Alterar ${edits === 1 ? 'um trecho' : `${edits} trechos`} do Google Docs`;
    }
    case 'k5_drive_rename_file': return `Renomear o arquivo do Drive para${quoted(text(input.name))}`;
    case 'k5_drive_upload_version': return 'Enviar um documento do Cofre como nova versão do arquivo no Drive';
    case 'k5_drive_share_file': return `Compartilhar o arquivo do Drive com ${text(input.email)} (${({ reader: 'leitor', commenter: 'comentarista', writer: 'editor' } as Record<string, string>)[text(input.role)] ?? text(input.role)})`;
    case 'k5_drive_revoke_permission': return 'Remover um acesso ao arquivo do Drive';
    default: return 'Executar esta ação';
  }
}

/** Where the person can see the result of an agent action. Only ids from the result, never from the model's text. */
export function resourceHref(name: string, result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  if (name.startsWith('k5_honorarios_')) return '/app/honorarios';
  if (name.startsWith('k5_messages_')) return '/app/messages';
  if (name.startsWith('k5_collaboration_')) return '/app/agenda?view=associates';
  const value = result as Record<string, { id?: string; caseId?: string | null } | string | undefined>;
  const id = (key: string) => { const item = value[key]; return item && typeof item === 'object' && typeof item.id === 'string' ? item.id : undefined; };
  if (name.startsWith('k5_agenda_') && id('activity')) return `/app/agenda?activityId=${encodeURIComponent(id('activity')!)}`;
  if (name.startsWith('k5_crm_') && id('client')) return `/app/agenda/clients/${encodeURIComponent(id('client')!)}`;
  if (name.startsWith('k5_vault_') && id('case')) return `/app/vault/cases/${encodeURIComponent(id('case')!)}`;
  const document = value.document;
  if (name.startsWith('k5_vault_') && document && typeof document === 'object' && document.caseId) return `/app/vault/cases/${encodeURIComponent(document.caseId)}`;
  if (name.startsWith('k5_artifacts_') && id('artifact')) return `/app/documents/${encodeURIComponent(id('artifact')!)}`;
  if ((name === 'k5_artifacts_export_pdf' || name === 'k5_artifacts_export_docx') && typeof value.downloadUrl === 'string') return value.downloadUrl;
  if (name === 'k5_vault_import_chat_attachment' && document && typeof document === 'object') return '/app/vault/library';
  if (name.startsWith('k5_calendar_') && id('event')) return `/app/agenda?view=calendar&personalEventId=${encodeURIComponent(id('event')!)}`;
  if (name.startsWith('k5_whatsapp_') && typeof value.threadId === 'string') return `/app/whatsapp?thread=${encodeURIComponent(value.threadId)}`;
  if (name.startsWith('k5_gmail_') && typeof value.threadId === 'string') return `/app/email?thread=${encodeURIComponent(value.threadId)}`;
  if (name.startsWith('k5_gmail_') && id('draft')) return `/app/email?draft=${encodeURIComponent(id('draft')!)}`;
  const imported = value.import;
  if ((name === 'k5_drive_import_file' || name === 'k5_gmail_import_attachment') && imported && typeof imported === 'object' && imported.caseId) return `/app/vault/cases/${encodeURIComponent(imported.caseId)}`;
  if (name === 'k5_drive_import_file' && imported && typeof imported === 'object' && 'scope' in imported && imported.scope === 'library') return '/app/vault/library';
  if (name.startsWith('k5_drive_') || name.startsWith('k5_docs_')) return '/app/vault/library?import=drive';
  return undefined;
}

/**
 * Pressing Confirmar in the chat approves the stored proposal and runs exactly the input it
 * recorded, through the same capability path the agent uses. The model is not asked to repeat
 * the call: a large input (a whole draft) would not survive being retyped.
 */
export async function decideAgentApproval(context: WorkspaceContext, approvalId: string, decision: 'confirm' | 'cancel') {
  const row = await getApprovalProposal(context, approvalId);
  if (!isConfirmed(row.capability_name)) throw new CapabilityError('FORBIDDEN', 'Esta confirmação não pode ser feita pelo chat.');
  let part: ApprovalDecision;
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
  await database.prepare('UPDATE capability_approval SET chat_result=? WHERE id=? AND office_id=? AND user_id=?')
    .run(JSON.stringify(part), approvalId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId);
  return part;
}
