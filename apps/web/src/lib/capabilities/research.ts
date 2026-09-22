import { z } from 'zod';

const identifier = z.string().min(1).max(128);
const readers = ['administrator', 'lawyer', 'reviewer'] as const;
const writers = ['administrator', 'lawyer'] as const;
const filters = z.object({
  court: z.string().trim().max(40).optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
}).default({});
const materialStatus = z.enum(['pending', 'fetching', 'processing', 'ready', 'unavailable', 'failed', 'restricted']);
const judgment = z.object({
  id: z.string(), installationId: z.string(), sourceJudgmentId: z.string(),
  tribunal: z.string(), courtUnit: z.string().nullable(), caseNumber: z.string().nullable(),
  title: z.string(), decisionDate: z.string().nullable(), sourceUrl: z.string().nullable(),
  sourceStatus: z.enum(['candidate', 'active', 'unavailable', 'restricted']),
  ementa: z.string().nullable(), ementaVersionId: z.string().nullable(),
  fullTextStatus: materialStatus, fullTextVersionId: z.string().nullable(),
});
const result = judgment.extend({ resultId: z.string(), position: z.number(), origin: z.enum(['local', 'source']) });
const progress = z.object({ ready: z.number(), pending: z.number(), unavailable: z.number(), failed: z.number(), cancelled: z.number() });
const page = z.object({
  id: z.string(), pageNumber: z.number(), status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']),
  results: z.array(result), nextCursor: z.string().nullable(), totalReported: z.number().nullable(),
  progress, sourceError: z.string().nullable(),
});
const historyItem = z.object({ id: z.string(), theme: z.string(), filters, status: z.string(), createdAt: z.string(), pageCount: z.number() });
const searchView = historyItem.extend({ includeSources: z.boolean(), pages: z.array(page) });
const detail = judgment.extend({
  className: z.string().nullable(), rapporteur: z.string().nullable(), metadataRevision: z.number(),
  sourceUpdatedAt: z.string().nullable(), collectedAt: z.string(),
  materials: z.array(z.object({
    id: z.string(), judgmentId: z.string(), kind: z.enum(['ementa', 'full_text']),
    status: materialStatus, currentVersionId: z.string().nullable(), unavailableReason: z.string().nullable(),
    version: z.object({
      id: z.string(), materialId: z.string(), sha256: z.string(), mimeType: z.string(),
      byteSize: z.number(), textContent: z.string().nullable(),
      originalAvailable: z.boolean(),
      parserVersion: z.string(), sourceUrl: z.string().nullable(), collectedAt: z.string(), publishedAt: z.string().nullable(),
    }).nullable(),
    chunks: z.array(z.object({ id: z.string(), materialVersionId: z.string(), ordinal: z.number(), textContent: z.string(), reference: z.string() })),
  })),
});
const idempotencyKey = z.string().trim().min(8).max(128).optional();

export const researchCapabilities = {
  k5_research_search_corpus: {
    module: 'research', effect: 'read', roles: readers,
    description: 'Pesquisa o acervo público de julgados admitidos usando um tema e filtros. Não inicia consulta externa.',
    input: z.object({ theme: z.string().trim().min(2).max(300), filters, cursor: z.string().max(200).optional() }),
    output: z.object({ results: z.array(judgment), nextCursor: z.string().nullable(), total: z.number() }),
    publish: ['agent', 'webmcp'],
  },
  k5_research_get_judgment: {
    module: 'research', effect: 'read', roles: readers,
    description: 'Lê um julgado público do acervo, seus materiais, versões e origem oficial. Material ausente fica indicado como ausente.',
    input: z.object({ judgmentId: identifier }), output: z.object({ judgment: detail }),
    publish: ['agent', 'webmcp'],
  },
  k5_research_list_history: {
    module: 'research', effect: 'read', roles: readers, publish: [],
    description: 'Lista as pesquisas feitas pela pessoa neste escritório.',
    input: z.object({}), output: z.object({ searches: z.array(historyItem) }),
  },
  k5_research_get_search: {
    module: 'research', effect: 'read', roles: readers, publish: [],
    description: 'Lê uma pesquisa e seu progresso sem consultar fontes externas.',
    input: z.object({ searchId: identifier }), output: z.object({ search: searchView }),
  },
  k5_research_start_search: {
    module: 'research', effect: 'write', roles: writers, publish: [],
    description: 'Inicia pesquisa por tema no acervo e, quando solicitado, nas fontes habilitadas.',
    input: z.object({ theme: z.string().trim().min(2).max(300), filters, includeSources: z.boolean().default(false), refreshSources: z.boolean().optional(), idempotencyKey }),
    output: z.object({ search: searchView }),
  },
  k5_research_request_page: {
    module: 'research', effect: 'write', roles: writers, publish: [],
    description: 'Solicita uma página adicional de uma pesquisa já criada.',
    input: z.object({ searchId: identifier, cursor: z.string().max(200).optional(), idempotencyKey }),
    output: z.object({ page }),
  },
  k5_research_request_material: {
    module: 'research', effect: 'write', roles: writers, publish: [],
    description: 'Solicita obtenção de material oficial de um julgado.',
    input: z.object({ judgmentId: identifier, kind: z.enum(['ementa', 'full_text']), searchId: identifier.optional(), idempotencyKey }),
    output: z.object({ jobId: z.string().nullable(), status: materialStatus }),
  },
  k5_research_cancel_downloads: {
    module: 'research', effect: 'write', roles: writers, publish: [],
    description: 'Para obtenções pendentes desta pesquisa sem eliminar material já coletado.',
    input: z.object({ searchId: identifier, idempotencyKey }), output: z.object({ cancelled: z.number() }),
  },
} as const;
