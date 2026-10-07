import { z } from 'zod';
import type { Capability } from './contracts';
import * as messages from '@/lib/personal-chat/domain';
import { collaborationAction, collaborationOverviewDto } from '@/lib/collaboration/contracts';
import { notificationListQuery, notificationPreferenceInput, notificationCategories, notificationEventTypes } from '@/lib/notifications/contracts';

const id = z.string().min(1).max(128);
const approval = { approvalId: z.uuid().optional() };
const success = z.object({ success: z.boolean() });
const preferences = z.object({ timezone: z.string(), quietEnabled: z.boolean(), quietStart: z.string().nullable(), quietEnd: z.string().nullable(), pushEnabled: z.boolean(), categories: z.object({ agenda: z.boolean(), vault: z.boolean(), documents: z.boolean(), judicial: z.boolean(), system: z.boolean() }), authorizationGeneration: z.number() });

export const workspaceCapabilities = {
  k5_collaboration_get: { module: 'collaboration', effect: 'read',
    description: 'Consulta associados (outros advogados que trabalham com a pessoa), convites de associação recebidos/enviados e histórico. Com caseId consulta o responsável e os participantes daquele caso.',
    input: z.object({ caseId: id.optional() }), output: collaborationOverviewDto },
  k5_collaboration_change: { module: 'collaboration', effect: 'write',
    description: 'Convida um advogado como associado, aceita/recusa/cancela convite, remove associado (action associate) ou inclui/remove um associado como participante de um caso (action participant com add true/false; só o responsável pelo caso inclui). Exige confirmação humana e as mesmas permissões da interface.',
    input: z.object({ change: collaborationAction, ...approval }),
    output: z.object({ success: z.boolean(), invitationId: z.string().optional(), path: z.string().optional(), deliveredInApp: z.boolean().optional() }) },
  k5_messages_contacts: { module: 'messages', effect: 'read', description: 'Busca contatos entre associados e participantes dos casos para Mensagens.', input: messages.contactQuery, output: messages.contactPageDto },
  k5_messages_list: { untrustedResult: true, module: 'messages', effect: 'read', description: 'Lista conversas pessoais do módulo Mensagens. Inclui o destinatário e o canal, interno ou e-mail externo.', input: messages.pageQuery, output: messages.threadPageDto },
  k5_messages_read: { untrustedResult: true, module: 'messages', effect: 'read', description: 'Lê mensagens de uma conversa da própria pessoa, com paginação.', input: messages.messageQuery.extend({ threadId: id }), output: messages.messagePageDto },
  k5_messages_start: { module: 'messages', effect: 'write', description: 'Abre uma conversa pessoal com contato ou endereço de e-mail exato. Não envia mensagem. requestId deve ser UUID estável.', input: messages.startThreadInput, output: messages.startThreadOutput },
  k5_messages_send: { module: 'messages', effect: 'write', description: 'Envia texto a uma conversa pessoal. Para destinatário externo gera envio por e-mail. Exige confirmação do destinatário e texto no chat. clientMessageId deve ser UUID estável.', input: messages.sendMessageInput.extend({ threadId: id, ...approval }), output: messages.sendMessageOutput },
  k5_messages_mark_read: { module: 'messages', effect: 'write', description: 'Marca mensagens como lidas até a mensagem indicada.', input: messages.markReadInput.extend({ threadId: id }), output: messages.markReadOutput },
  k5_messages_document_options: { module: 'messages', effect: 'read', description: 'Lista documentos que a pessoa pode compartilhar por Mensagens.', input: messages.documentPickQuery, output: messages.documentPickPageDto },
  k5_messages_share: { module: 'messages', effect: 'write', description: 'Compartilha uma versão de um documento do Cofre na conversa. Para compartilhar um caso, inclua um associado como participante do caso (k5_collaboration_change). Exige confirmação humana.', input: z.object({ threadId: id, share: messages.createShareInput, ...approval }), output: messages.createShareOutput },
  k5_messages_revoke_share: { module: 'messages', effect: 'write', description: 'Revoga um compartilhamento de documento. Exige confirmação. Não apaga mensagens já enviadas.', input: z.object({ shareId: id, ...approval }), output: success },
  k5_notifications_list: { module: 'notifications', effect: 'read', description: 'Consulta notificações da própria pessoa neste escritório, com filtros e paginação.', input: notificationListQuery, output: z.object({ notifications: z.array(z.object({ id, eventType: z.enum(notificationEventTypes), category: z.enum(notificationCategories), title: z.string(), summary: z.string(), createdAt: z.string(), readAt: z.string().nullable(), href: z.string() })), nextCursor: z.string().nullable() }) },
  k5_notifications_read: { module: 'notifications', effect: 'write', description: 'Marca uma notificação como lida.', input: z.object({ notificationId: id }), output: success },
  k5_notifications_archive: { module: 'notifications', effect: 'write', description: 'Arquiva uma notificação da própria pessoa.', input: z.object({ notificationId: id }), output: success },
  k5_notifications_get_preferences: { module: 'notifications', effect: 'read', description: 'Consulta preferências de notificação da própria pessoa.', input: z.object({}), output: preferences },
  k5_notifications_update_preferences: { module: 'notifications', effect: 'write', description: 'Altera categorias, fuso, horário de silêncio e ativação de notificações da própria pessoa. O navegador ainda precisa autorizar push.', input: notificationPreferenceInput, output: preferences },
  k5_notifications_follow_case: { module: 'notifications', effect: 'write', description: 'Segue ou deixa de seguir notificações de um caso acessível.', input: z.object({ caseId: id, following: z.boolean() }), output: z.object({ following: z.boolean() }) },
} as const satisfies Record<string, Capability>;
