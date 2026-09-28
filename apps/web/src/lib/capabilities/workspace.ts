import { z } from 'zod';
import type { Capability } from './contracts';
import * as messages from '@/lib/personal-chat/domain';
import { collaborationAction, collaborationOverviewDto } from '@/lib/collaboration/contracts';
import { notificationListQuery, notificationPreferenceInput, notificationCategories, notificationEventTypes } from '@/lib/notifications/contracts';

const readers = ['administrator', 'lawyer', 'reviewer'] as const;
const writers = ['administrator', 'lawyer'] as const;
const id = z.string().min(1).max(128);
const approval = { approvalId: z.uuid().optional() };
const success = z.object({ success: z.boolean() });
const preferences = z.object({ timezone: z.string(), quietEnabled: z.boolean(), quietStart: z.string().nullable(), quietEnd: z.string().nullable(), pushEnabled: z.boolean(), categories: z.object({ agenda: z.boolean(), vault: z.boolean(), documents: z.boolean(), judicial: z.boolean(), system: z.boolean() }), authorizationGeneration: z.number() });

export const workspaceCapabilities = {
  k5_collaboration_get: { module: 'collaboration', effect: 'read', roles: readers,
    description: 'Consulta equipe, associados, convites recebidos/enviados e histórico. Com caseId consulta participantes daquele caso e suas permissões.',
    input: z.object({ caseId: id.optional() }), output: collaborationOverviewDto },
  k5_collaboration_change: { module: 'collaboration', effect: 'write', roles: readers,
    description: 'Convida equipe/associado/participante, aceita/recusa/cancela convite, altera papel ou remove acesso. action member com role=null remove membro; participant com role=null revoga acesso; associate remove associado. Exige confirmação humana e as mesmas permissões da interface.',
    input: z.object({ change: collaborationAction, ...approval }),
    output: z.object({ success: z.boolean(), invitationId: z.string().optional(), path: z.string().optional(), deliveredInApp: z.boolean().optional(), caseId: z.string().nullable().optional() }) },
  k5_messages_contacts: { module: 'messages', effect: 'read', roles: readers, description: 'Busca contatos da equipe, associados e participantes para Mensagens.', input: messages.contactQuery, output: messages.contactPageDto },
  k5_messages_list: { module: 'messages', effect: 'read', roles: readers, description: 'Lista conversas pessoais do módulo Mensagens. Inclui o destinatário e o canal, interno ou e-mail externo.', input: messages.pageQuery, output: messages.threadPageDto },
  k5_messages_read: { module: 'messages', effect: 'read', roles: readers, description: 'Lê mensagens de uma conversa da própria pessoa, com paginação.', input: messages.messageQuery.extend({ threadId: id }), output: messages.messagePageDto },
  k5_messages_start: { module: 'messages', effect: 'write', roles: readers, description: 'Abre uma conversa pessoal com contato ou endereço de e-mail exato. Não envia mensagem. requestId deve ser UUID estável.', input: messages.startThreadInput, output: messages.startThreadOutput },
  k5_messages_send: { module: 'messages', effect: 'write', roles: readers, description: 'Envia texto a uma conversa pessoal. Para destinatário externo gera envio por e-mail. Exige confirmação do destinatário e texto no chat. clientMessageId deve ser UUID estável.', input: messages.sendMessageInput.extend({ threadId: id, ...approval }), output: messages.sendMessageOutput },
  k5_messages_mark_read: { module: 'messages', effect: 'write', roles: readers, description: 'Marca mensagens como lidas até a mensagem indicada.', input: messages.markReadInput.extend({ threadId: id }), output: messages.markReadOutput },
  k5_messages_document_options: { module: 'messages', effect: 'read', roles: writers, description: 'Lista documentos que a pessoa pode compartilhar por Mensagens.', input: messages.documentPickQuery, output: messages.documentPickPageDto },
  k5_messages_case_options: { module: 'messages', effect: 'read', roles: writers, description: 'Lista casos que a pessoa pode compartilhar por Mensagens e as permissões permitidas.', input: messages.casePickQuery, output: messages.casePickPageDto },
  k5_messages_share: { module: 'messages', effect: 'write', roles: writers, description: 'Compartilha uma versão do documento ou convida o destinatário para um caso. Exige confirmação humana e respeita as permissões existentes.', input: z.object({ threadId: id, share: messages.createShareInput, ...approval }), output: messages.createShareOutput },
  k5_messages_revoke_share: { module: 'messages', effect: 'write', roles: writers, description: 'Revoga um compartilhamento de documento. Exige confirmação. Não apaga mensagens já enviadas.', input: z.object({ shareId: id, ...approval }), output: success },
  k5_notifications_list: { module: 'notifications', effect: 'read', roles: readers, description: 'Consulta notificações da própria pessoa neste escritório, com filtros e paginação.', input: notificationListQuery, output: z.object({ notifications: z.array(z.object({ id, eventType: z.enum(notificationEventTypes), category: z.enum(notificationCategories), title: z.string(), summary: z.string(), createdAt: z.string(), readAt: z.string().nullable(), href: z.string() })), nextCursor: z.string().nullable() }) },
  k5_notifications_read: { module: 'notifications', effect: 'write', roles: readers, description: 'Marca uma notificação como lida.', input: z.object({ notificationId: id }), output: success },
  k5_notifications_archive: { module: 'notifications', effect: 'write', roles: readers, description: 'Arquiva uma notificação da própria pessoa.', input: z.object({ notificationId: id }), output: success },
  k5_notifications_get_preferences: { module: 'notifications', effect: 'read', roles: readers, description: 'Consulta preferências de notificação da própria pessoa.', input: z.object({}), output: preferences },
  k5_notifications_update_preferences: { module: 'notifications', effect: 'write', roles: readers, description: 'Altera categorias, fuso, horário de silêncio e ativação de notificações da própria pessoa. O navegador ainda precisa autorizar push.', input: notificationPreferenceInput, output: preferences },
  k5_notifications_follow_case: { module: 'notifications', effect: 'write', roles: readers, description: 'Segue ou deixa de seguir notificações de um caso acessível.', input: z.object({ caseId: id, following: z.boolean() }), output: z.object({ following: z.boolean() }) },
} as const satisfies Record<string, Capability>;
