import 'server-only';
import { z } from 'zod';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { capabilities, CapabilityName } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import * as collaboration from '@/lib/collaboration/service';
import * as messages from '@/lib/personal-chat/service';
import * as shares from '@/lib/personal-chat/shares';
import type { PersonContext } from '@/lib/personal-chat/auth';
import * as notifications from '@/lib/notifications/repository';
type CapabilityInput<N extends CapabilityName> = z.output<typeof capabilities[N]['input']>;

async function person(context: WorkspaceContext): Promise<PersonContext> {
  const row = await database.prepare('SELECT email,name FROM "user" WHERE id=?').get(context.userId);
  if (!row) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  return { ...z.object({ email: z.string(), name: z.string() }).parse(row), userId: context.userId, sessionId: context.sessionId };
}

export const collaborationGet = (context: WorkspaceContext, input: CapabilityInput<'k5_collaboration_get'>) => collaboration.collaborationOverview(context, input.caseId);
export async function collaborationChange(context: WorkspaceContext, { change }: CapabilityInput<'k5_collaboration_change'>) {
  if (change.action === 'invite') { const { id, ...result } = await collaboration.invite(context, change.invitation); return { success: true, invitationId: id, ...result }; }
  if (change.action === 'respond') return collaboration.respond(context, change.id, change.accept, change.token);
  return collaboration.changeAccess(context, change);
}
export const contacts = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_contacts'>) => messages.listContacts(await person(context), context.officeId, { ...input, query: input.query ?? '', limit: input.limit ?? 30 });
export const listMessages = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_list'>) => messages.listThreads(await person(context), { ...input, limit: input.limit ?? 30 });
export const readMessages = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_read'>) => messages.listMessages(await person(context), input.threadId, { ...input, limit: input.limit ?? 50 });
export const startMessageThread = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_start'>) => messages.startThread(await person(context), context.officeId, input);
export const sendMessage = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_send'>) => messages.sendMessage(await person(context), input.threadId, { clientMessageId: input.clientMessageId, body: input.body });
export const markMessagesRead = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_mark_read'>) => messages.markRead(await person(context), input.threadId, input.throughMessageId);
export const documentOptions = (context: WorkspaceContext, input: CapabilityInput<'k5_messages_document_options'>) => shares.listDocumentPicks(context, { ...input, query: input.query ?? '', limit: input.limit ?? 30 });
export const caseOptions = (context: WorkspaceContext, input: CapabilityInput<'k5_messages_case_options'>) => shares.listCasePicks(context, { ...input, query: input.query ?? '', limit: input.limit ?? 30 });
export const shareMessage = async (context: WorkspaceContext, input: CapabilityInput<'k5_messages_share'>) => shares.createShare(await person(context), context, input.threadId, input.share.kind === 'case' ? { ...input.share, canInvite: input.share.canInvite ?? false } : input.share);
export async function revokeMessageShare(context: WorkspaceContext, input: CapabilityInput<'k5_messages_revoke_share'>) { await shares.revokeDocumentShare(context, input.shareId); return { success: true }; }
export const listNotifications = (context: WorkspaceContext, input: CapabilityInput<'k5_notifications_list'>) => notifications.listNotifications(context, { ...input, unreadOnly: input.unreadOnly ?? false, limit: input.limit ?? 25 });
export const readNotification = async (context: WorkspaceContext, input: CapabilityInput<'k5_notifications_read'>) => ({ success: await notifications.markNotificationRead(context, input.notificationId) });
export const archiveNotification = async (context: WorkspaceContext, input: CapabilityInput<'k5_notifications_archive'>) => ({ success: await notifications.archiveNotification(context, input.notificationId) });
export const getPreferences = (context: WorkspaceContext) => notifications.getNotificationPreferences(context);
export const updatePreferences = (context: WorkspaceContext, input: CapabilityInput<'k5_notifications_update_preferences'>) => notifications.updateNotificationPreferences(context, input);
export const followCase = (context: WorkspaceContext, input: CapabilityInput<'k5_notifications_follow_case'>) => notifications.setCaseFollowState(context, input.caseId, input.following);
