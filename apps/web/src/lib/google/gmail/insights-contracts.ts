import { z } from 'zod';

export const digestPeriods = ['day', 'week', 'month'] as const;
export type DigestPeriod = (typeof digestPeriods)[number];

export const replyIntents = ['confirm', 'answer', 'request_info', 'schedule', 'decline', 'acknowledge', 'follow_up'] as const;
export type ReplyIntent = (typeof replyIntents)[number];

export const emailInsightInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('digest'), period: z.enum(digestPeriods) }).strict(),
  z.object({ kind: z.literal('thread'), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
]);

export const digestThreadSchema = z.object({ threadId: z.string(), subject: z.string(), from: z.string(), date: z.string(), unread: z.boolean() });
export type DigestThread = z.infer<typeof digestThreadSchema>;
export const emailDigestSchema = z.object({
  period: z.enum(digestPeriods), generatedAt: z.string(), count: z.number(), truncated: z.boolean(), judged: z.boolean(), headline: z.string(),
  attention: z.array(digestThreadSchema.extend({ reason: z.string(), needsReply: z.boolean().nullable() })),
  themes: z.array(z.object({ title: z.string(), summary: z.string(), threads: z.array(digestThreadSchema) })),
});
export type EmailDigest = z.infer<typeof emailDigestSchema>;
export const threadInsightSchema = z.object({
  threadId: z.string(), generatedAt: z.string(), overview: z.string(), points: z.array(z.string()),
  needsReply: z.boolean().nullable(), judged: z.boolean(),
  replies: z.array(z.object({ intent: z.enum(replyIntents), label: z.string(), body: z.string(), seedId: z.string().optional() })),
});
export type ThreadInsight = z.infer<typeof threadInsightSchema>;

export type EmailInsightResult =
  | { status: 'ready'; digest: EmailDigest }
  | { status: 'ready'; insight: ThreadInsight };
