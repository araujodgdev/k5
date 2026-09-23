import { z } from 'zod';

export const decisionMode = z.enum(['off', 'shadow', 'enabled']);
export type DecisionMode = z.infer<typeof decisionMode>;
export type DecisionPurpose = 'rag' | 'documents' | 'agenda' | 'research' | 'feedback';
export const connectionSettings = z.object({
  apiKey: z.string().trim().min(12).max(4000).optional(),
  model: z.string().regex(/^jev-\d+\.\d+\.\d+$/).default('jev-1.13.0'),
  enabled: z.boolean().default(false),
  rag: decisionMode.default('off'), documents: decisionMode.default('off'), agenda: decisionMode.default('off'), research: decisionMode.default('off'),
  feedback: decisionMode.default('enabled'),
  dailyTokens: z.number().int().min(1000).max(50_000_000).default(2_000_000),
  concurrency: z.number().int().min(1).max(8).default(4),
  version: z.number().int().nonnegative(),
});
export type ConnectionSettings = z.infer<typeof connectionSettings>;
export type ConnectionView = Omit<ConnectionSettings, 'apiKey'> & { keyHint: string; hasKey: boolean };
const probability = z.number().min(0).max(1);
export const decisionAnswer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), choice: z.string(), confidence: probability, probabilities: z.record(z.string(), probability) }),
  z.object({ type: z.literal('score'), score: z.number(), confidence: probability, probabilities: z.record(z.string(), probability), legend: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('noul'), noul: probability }),
]);
export const decisionResponse = z.object({
  model: z.string(), answers: z.record(z.string(), decisionAnswer),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export type DecisionResponse = z.infer<typeof decisionResponse>;
export type Evaluation = {
  status: 'evaluated' | 'disabled' | 'unavailable' | 'budget_exceeded';
  mode: DecisionMode; reason?: string; evaluationId?: string;
  response?: DecisionResponse;
};
