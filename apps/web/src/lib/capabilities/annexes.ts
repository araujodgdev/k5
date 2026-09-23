import { z } from 'zod';
import type { Capability } from './contracts';
import { MAX_ANNEX_ITEMS } from '@/lib/annexes-contract';

const writers = ['administrator', 'lawyer'] as const;
const id = z.string().min(1).max(64);
const page = z.number().int().min(1).max(10_000);
const item = z.object({
  label: z.string(), startPage: z.number(), endPage: z.number(), include: z.boolean(), cited: z.boolean(),
  mention: z.string().nullable(), fileName: z.string(),
});

export const annexCapabilities = {
  k5_vault_plan_annexes: { module: 'vault', effect: 'write', roles: writers,
    description: 'Lê um PDF digitalizado do caso (vários documentos em sequência) e a petição, e propõe como separar os anexos: rótulo, páginas e ordem de citação na petição. Não cria arquivos. Informe a petição por documento do caso, minuta (artifactId) ou texto. Mostre a proposta para a pessoa revisar antes de gerar.',
    input: z.object({ caseId: id, scanDocumentId: id, petitionDocumentId: id.optional(), petitionArtifactId: id.optional(), petitionText: z.string().max(60_000).optional() }),
    output: z.object({ pageCount: z.number(), items: z.array(item), uncoveredPages: z.array(z.number()) }) },
  k5_vault_generate_annexes: { module: 'vault', effect: 'write', roles: writers,
    description: 'Recorta o PDF digitalizado nos intervalos revisados, na ordem dada, e salva cada anexo em uma nova pasta do caso com nome no padrão do PJe (sem acentos, numerado). Use somente depois que a pessoa confirmar a lista.',
    input: z.object({ caseId: id, scanDocumentId: id, folderName: z.string().trim().max(120).default(''),
      items: z.array(z.object({ label: z.string().trim().min(2).max(80), startPage: page, endPage: page })).min(1).max(MAX_ANNEX_ITEMS), idempotencyKey: z.string().min(8).max(128).optional() }),
    output: z.object({ folderId: z.string(), documents: z.array(z.object({ id: z.string(), name: z.string() })) }) },
} as const satisfies Record<string, Capability>;
