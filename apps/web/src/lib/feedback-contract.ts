import { z } from 'zod';

export const ratingCriteria = [
  { key: 'clarity', label: 'Clareza', help: 'Organização e facilidade de leitura.' },
  { key: 'accuracy', label: 'Precisão', help: 'Fidelidade aos documentos de origem.' },
  { key: 'completeness', label: 'Completude', help: 'Cobertura dos riscos e das entregas pedidas.' },
  { key: 'usefulness', label: 'Utilidade', help: 'Quanto o trabalho ajuda na prática.' },
] as const;
export const preferenceLabels = { a: 'Resposta A', b: 'Resposta B', tie: 'Empate', neither: 'Nenhuma das duas', unsure: 'Não consigo decidir' } as const;
const score = z.number().int().min(1).max(5).nullable();
export const assessmentSchema = z.object({ clarity: score, accuracy: score, completeness: score, usefulness: score, comment: z.string().trim().max(2000) }).strict();
export const feedbackSchema = z.object({
  campaignId: z.string().min(1).max(120),
  preference: z.enum(['a', 'b', 'tie', 'neither', 'unsure']),
  a: assessmentSchema, b: assessmentSchema,
  comment: z.string().trim().max(3000),
  reviewedBoth: z.literal(true),
  trainingConsent: z.boolean().default(false),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type FeedbackSide = 'a' | 'b';
export type FeedbackResponse = {
  side: FeedbackSide;
  memo: string;
  sheets: { name: string; rows: string[][] }[];
  identity: null | { name: string; seconds: number; turns: number; inputTokens: number; outputTokens: number };
};
export type FeedbackView = {
  campaignId: string; title: string; instructions: string;
  responses: FeedbackResponse[];
  vote: null | { preference: FeedbackInput['preference']; a: Assessment; b: Assessment; comment: string; createdAt: string };
};
