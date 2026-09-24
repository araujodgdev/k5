import { z } from 'zod';

export const researchMaterialKinds = ['ementa', 'full_text'] as const;
export type ResearchMaterialKind = (typeof researchMaterialKinds)[number];
export const researchMaterialStatuses = ['pending', 'fetching', 'processing', 'ready', 'unavailable', 'failed', 'restricted'] as const;
export type ResearchMaterialStatus = (typeof researchMaterialStatuses)[number];
export const researchSourceStatuses = ['candidate', 'active', 'unavailable', 'restricted'] as const;
export type ResearchSourceStatus = (typeof researchSourceStatuses)[number];
export const researchJobStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type ResearchJobStatus = (typeof researchJobStatuses)[number];

export const searchFiltersSchema = z.object({
  court: z.string().trim().max(40).optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
}).refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, 'Período inválido.').default({});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export const searchInputSchema = z.object({
  theme: z.string().trim().min(2).max(300),
  filters: searchFiltersSchema,
  includeSources: z.boolean().default(false),
  refreshSources: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});
export type SearchInput = z.input<typeof searchInputSchema>;
export const corpusQuerySchema = z.object({
  theme: z.string().trim().min(2).max(300),
  filters: searchFiltersSchema,
  cursor: z.string().max(200).optional(),
});
export type CorpusQuery = z.input<typeof corpusQuerySchema>;

export type JudgmentSummary = {
  id: string;
  installationId: string;
  sourceJudgmentId: string;
  tribunal: string;
  courtUnit: string | null;
  caseNumber: string | null;
  title: string;
  decisionDate: string | null;
  sourceUrl: string | null;
  sourceStatus: ResearchSourceStatus;
  ementa: string | null;
  ementaVersionId: string | null;
  fullTextStatus: ResearchMaterialStatus;
  fullTextVersionId: string | null;
};
export type ResearchJudgment = JudgmentSummary & {
  className: string | null;
  rapporteur: string | null;
  metadataRevision: number;
  sourceUpdatedAt: string | null;
  collectedAt: string;
};
export type ResearchMaterial = {
  id: string;
  judgmentId: string;
  kind: ResearchMaterialKind;
  status: ResearchMaterialStatus;
  currentVersionId: string | null;
  unavailableReason: string | null;
};
export type ResearchMaterialVersion = {
  id: string;
  materialId: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  storageKey: string | null;
  textContent: string | null;
  parserVersion: string;
  citationMetadata: { tribunal: string; courtUnit: string | null; caseNumber: string | null; title: string; decisionDate: string | null; sourceUrl: string | null };
  metadataRevision: number;
  sourceUrl: string | null;
  collectedAt: string;
  publishedAt: string | null;
};
export type ResearchChunk = {
  id: string;
  materialVersionId: string;
  ordinal: number;
  textContent: string;
  reference: string;
};
export type JudgmentDetail = ResearchJudgment & { materials: Array<ResearchMaterial & { version: ResearchMaterialVersion | null; chunks: ResearchChunk[] }> };
export type ResearchResult = JudgmentSummary & { resultId: string; position: number; origin: 'local' | 'source' };
export type SearchProgress = { ready: number; pending: number; unavailable: number; failed: number; cancelled: number };
export type SearchPage = {
  id: string;
  pageNumber: number;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  results: ResearchResult[];
  nextCursor: string | null;
  totalReported: number | null;
  progress: SearchProgress;
  sourceError: string | null;
};
export type SearchHistoryItem = { id: string; theme: string; filters: SearchFilters; status: string; createdAt: string; pageCount: number };
export type ResearchSearchView = SearchHistoryItem & { includeSources: boolean; pages: SearchPage[] };
export type CorpusPage = { results: JudgmentSummary[]; nextCursor: string | null; total: number };

export type WebSearchMode = 'instant' | 'fast' | 'auto' | 'deep';
export type WebSearchResult = { title: string; url: string; host: string; publishedDate: string | null; excerpt: string };
export type WebSearchHistoryItem = { id: string; query: string; mode: WebSearchMode; createdAt: string; resultCount: number };
export type WebSearchView = WebSearchHistoryItem & { results: WebSearchResult[] };

export class ResearchError extends Error {
  constructor(public readonly code: 'forbidden' | 'not_found' | 'invalid_input' | 'source_disabled' | 'budget_exceeded' | 'unsupported', message: string) {
    super(message);
    this.name = 'ResearchError';
  }
}
