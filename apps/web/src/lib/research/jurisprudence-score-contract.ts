import { z } from 'zod';

/** Shared by the capability contract (browser-safe) and the server scoring in jurisprudence-score.ts. */
export const MAX_DECISIONS = 12;

export const foundDecision = z.object({
  title: z.string().trim().min(3).max(300).describe('Identificação do julgado, como aparece na página.'),
  court: z.string().trim().max(120).default('').describe('Sigla do tribunal.'),
  caseNumber: z.string().trim().max(80).nullable().default(null).describe('Número do processo, ou null.'),
  date: z.string().trim().max(40).nullable().default(null).describe('Data de julgamento ou publicação, ou null.'),
  url: z.url().max(1000).describe('O link exato da página devolvida pela busca.'),
  summary: z.string().trim().max(1200).default('').describe('Ementa ou trecho fiel da página, sem paráfrase.'),
});
export type FoundDecision = z.output<typeof foundDecision>;
export type FoundDecisionInput = z.input<typeof foundDecision>;

export const reliabilityLevels = ['alta', 'média', 'baixa', 'não avaliada'] as const;
export type Reliability = (typeof reliabilityLevels)[number];
export type ScoredDecision = FoundDecision & {
  /** Jev's fit to the case, 0 to 4; null when Jev did not evaluate. */
  score: number | null;
  /** Probability that the page is a court decision; null when Jev did not evaluate. */
  isDecision: number | null;
  linkFound: boolean;
  reliability: Reliability;
  reason: string;
};

