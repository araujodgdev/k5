import { z } from 'zod';

export const notificationCategories = ['agenda', 'vault', 'documents', 'judicial', 'system'] as const;
export type NotificationCategory = typeof notificationCategories[number];

export const notificationEventTypes = [
  'agenda.activity.assigned',
  'agenda.activity.changed',
  'agenda.task.due',
  'agenda.meeting.soon',
  'vault.processing.completed',
  'vault.processing.failed',
  'vault.index.ready',
  'vault.index.failed',
  'documents.run.completed',
  'documents.run.failed',
  'documents.verification.available',
  'judicial.publication.new',
  'judicial.publication.corrected',
  'judicial.collection.failed',
  'system.push.test',
] as const;

export type NotificationEventType = typeof notificationEventTypes[number];

export const notificationSourceKinds = [
  'activity', 'case', 'document', 'run', 'artifact', 'judicial_alert', 'system',
] as const;
export type NotificationSourceKind = typeof notificationSourceKinds[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const categories = z.object({
  agenda: z.boolean(), vault: z.boolean(), documents: z.boolean(), judicial: z.boolean(), system: z.boolean(),
});

export const notificationPreferenceInput = z.strictObject({
  timezone: z.string().min(1).max(100).optional(),
  quietEnabled: z.boolean().optional(),
  quietStart: time.nullable().optional(),
  quietEnd: time.nullable().optional(),
  pushEnabled: z.boolean().optional(),
  categories: categories.partial().optional(),
});

export const pushSubscriptionInput = z.strictObject({
  deviceId: z.string().min(8).max(128),
  deviceLabel: z.string().trim().max(120).nullable().optional(),
  endpoint: z.string().min(1).max(2048),
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
  vapidKeyId: z.string().min(1).max(100),
  authorizationGeneration: z.number().int().positive(),
});

export const notificationListQuery = z.object({
  unreadOnly: z.boolean().default(false),
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(50).default(25),
});

export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInput>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

export type NotificationEventDraft = {
  id: string;
  officeId: string;
  eventType: NotificationEventType;
  sourceKind: NotificationSourceKind;
  sourceId: string | null;
  sourceVersion: number | null;
  actorUserId: string | null;
  intendedRecipientIds: string[];
  data: Record<string, unknown>;
  dedupeKey: string;
  createdAt: string;
  expiresAt: string | null;
  historical?: boolean;
  pushEligible?: boolean;
};

export type NotificationView = {
  id: string;
  eventType: NotificationEventType;
  category: NotificationCategory;
  title: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
  href: string;
};
