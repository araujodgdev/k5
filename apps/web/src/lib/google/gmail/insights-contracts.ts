import { z } from 'zod';

export const digestPeriods = ['day', 'week', 'month'] as const;
export type DigestPeriod = (typeof digestPeriods)[number];

export const replyIntents = ['confirm', 'answer', 'request_info', 'schedule', 'decline', 'acknowledge', 'follow_up'] as const;
export type ReplyIntent = (typeof replyIntents)[number];

export const emailInsightInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('digest'), period: z.enum(digestPeriods) }).strict(),
  z.object({ kind: z.literal('thread'), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
]);

export type DigestThread = { threadId: string; subject: string; from: string; date: string; unread: boolean };

/** An overview of the person's inbox over a period. Every thread it names came from their Gmail. */
export type EmailDigest = {
  period: DigestPeriod;
  generatedAt: string;
  /** Conversations read; `truncated` when the period held more than the limit. */
  count: number;
  truncated: boolean;
  /** Whether Jev judged priority and pending replies; the overview still works without it. */
  judged: boolean;
  headline: string;
  attention: (DigestThread & { reason: string; needsReply: boolean | null })[];
  themes: { title: string; summary: string; threads: DigestThread[] }[];
};

/** An overview of one conversation and, for those who may write, replies to start from. */
export type ThreadInsight = {
  threadId: string;
  generatedAt: string;
  overview: string;
  points: string[];
  needsReply: boolean | null;
  judged: boolean;
  replies: { intent: ReplyIntent; label: string; body: string }[];
};

export type EmailInsightResult =
  | { status: 'ready'; digest: EmailDigest }
  | { status: 'ready'; insight: ThreadInsight };
