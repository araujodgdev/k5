import { z } from 'zod';

const internalId = z.string().uuid();
const userId = z.string().min(1).max(255);
const instant = z.string().datetime({ offset: true });
const cursor = z.string().min(1).max(500);
const normalizedEmail = z.email().max(254).transform(value => value.trim().toLowerCase());

export const pageQuery = z.strictObject({
  cursor: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const contactDto = z.strictObject({
  userId,
  name: z.string().min(1).max(160),
  email: z.string().max(254),
  sources: z.array(z.enum(['associate', 'case_participant'])).min(1),
});
export const contactQuery = pageQuery.extend({ query: z.string().trim().max(160).default('') });
export const contactPageDto = z.strictObject({ contacts: z.array(contactDto), nextCursor: cursor.nullable() });

const documentShareBodyDto = z.strictObject({
  kind: z.literal('document_share'),
  shareId: internalId,
  name: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  version: z.number().int().positive(),
  contentUrl: z.string().min(1),
  canRevoke: z.boolean(),
  state: z.enum(['active', 'pending_claim', 'revoked', 'unavailable']),
});
const caseInvitationBodyDto = z.strictObject({
  kind: z.literal('case_invitation'),
  invitationId: internalId,
  caseName: z.string().min(1).max(500),
  state: z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']),
  actionPath: z.string().min(1).nullable(),
});
export const messageBodyDto = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().max(20_000) }),
  documentShareBodyDto,
  caseInvitationBodyDto,
]);

const outboundDeliveryDto = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('in_app'), state: z.enum(['sent', 'read']), readAt: instant.nullable() }),
  z.strictObject({
    kind: z.literal('email'),
    state: z.enum(['pending', 'accepted', 'retry', 'unknown', 'failed', 'cancelled']),
    errorLabel: z.string().nullable(),
  }),
]);
const messageBase = { id: internalId, body: messageBodyDto, createdAt: instant } as const;
export const messageDto = z.discriminatedUnion('direction', [
  z.strictObject({
    ...messageBase,
    direction: z.literal('incoming'),
    sender: z.strictObject({ userId, name: z.string().min(1).max(160) }),
  }),
  z.strictObject({ ...messageBase, direction: z.literal('outgoing'), delivery: outboundDeliveryDto }),
]);

const lastMessageDto = z.strictObject({ id: internalId, preview: z.string().max(240), createdAt: instant });
export const threadDto = z.discriminatedUnion('channel', [
  z.strictObject({
    id: internalId,
    channel: z.literal('in_app'),
    peer: z.strictObject({ kind: z.literal('user'), userId, name: z.string(), email: z.string() }),
    lastMessage: lastMessageDto.nullable(),
    unreadCount: z.number().int().nonnegative(),
    updatedAt: instant,
  }),
  z.strictObject({
    id: internalId,
    channel: z.literal('email_outbound'),
    peer: z.strictObject({ kind: z.literal('external_email'), email: z.string(), outboundOnly: z.literal(true) }),
    lastMessage: lastMessageDto.nullable(),
    unreadCount: z.literal(0),
    updatedAt: instant,
  }),
]);
export const threadPageDto = z.strictObject({ threads: z.array(threadDto), nextCursor: cursor.nullable() });
export const threadLookupOutput = z.strictObject({ thread: threadDto });

export const startThreadInput = z.strictObject({
  requestId: internalId,
  recipient: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('known_user'), userId }),
    z.strictObject({ kind: z.literal('exact_email'), email: normalizedEmail }),
  ]),
});
export const startThreadOutput = threadLookupOutput;

export const messageQuery = z.strictObject({
  before: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const messagePageDto = z.strictObject({
  thread: threadDto,
  messages: z.array(messageDto),
  olderCursor: cursor.nullable(),
});
export const sendMessageInput = z.strictObject({
  clientMessageId: internalId,
  body: z.strictObject({ kind: z.literal('text'), text: z.string().trim().min(1).max(20_000) }),
});
export const sendMessageOutput = z.strictObject({ thread: threadDto, message: messageDto });
export const markReadInput = z.strictObject({ throughMessageId: internalId });
export const markReadOutput = z.strictObject({ readAt: instant });

export const documentPickQuery = pageQuery.extend({
  query: z.string().trim().max(180).default(''),
  caseId: internalId.optional(),
});
export const documentPickDto = z.strictObject({
  id: internalId,
  name: z.string(),
  caseId: internalId.nullable(),
  caseName: z.string().nullable(),
  currentVersion: z.number().int().positive(),
});
export const documentPickPageDto = z.strictObject({ documents: z.array(documentPickDto), nextCursor: cursor.nullable() });

// A case is shared by including an associate as its participant, inside the case; Mensagens
// shares single document versions. Old case invitations stay readable in the conversation.
export const createShareInput = z.strictObject({
  kind: z.literal('document'), documentId: internalId, version: z.number().int().positive(),
  clientMessageId: internalId, idempotencyKey: internalId,
});
export const createShareOutput = z.strictObject({
  kind: z.literal('document'), message: messageDto,
  share: z.strictObject({ id: internalId, state: documentShareBodyDto.shape.state }),
});

export const claimAddressInput = z.strictObject({ token: z.string().min(32).max(512) });
export const claimAddressOutput = z.strictObject({
  verified: z.literal(true),
  email: z.string(),
  threadId: internalId,
  grantId: internalId.nullable(),
  path: z.string().min(1),
  document: z.strictObject({
    name: z.string(), mimeType: z.string(), version: z.number().int().positive(), contentUrl: z.string().min(1),
  }).nullable(),
});

export type Contact = z.infer<typeof contactDto>;
export type PersonalThread = z.infer<typeof threadDto>;
export type PersonalMessage = z.infer<typeof messageDto>;
export type MessageBody = z.infer<typeof messageBodyDto>;
export type StartThreadInput = z.infer<typeof startThreadInput>;
export type SendMessageInput = z.infer<typeof sendMessageInput>;
export type CreateShareInput = z.infer<typeof createShareInput>;
