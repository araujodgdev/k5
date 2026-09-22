import { ConnectorError, type InstallationRef } from '@/lib/judicial/contracts';
import { createHash } from 'node:crypto';
import { liveTransport, type Transport } from '@/lib/judicial/connectors/transport';

export const TJDFT_PARSER_VERSION = 'tjdft-api-v1.1';
const ENDPOINT = '/api/v1/pesquisa';

export type SourceJudgment = {
  sourceJudgmentId: string;
  tribunal: string;
  courtUnit: string | null;
  caseNumber: string | null;
  className: string | null;
  rapporteur: string | null;
  title: string;
  decisionDate: string | null;
  sourceUpdatedAt: string | null;
  sourceUrl: string | null;
  ementa: string | null;
  fullText: string | null;
  fullTextStatus: 'ready' | 'pending' | 'unavailable';
};

export type SourcePage = { records: SourceJudgment[]; totalReported: number | null; nextCursor: string | null;
  rejected: number; rejections: Array<{index:number;reason:string;sha256:string;payloadJson:string}>; collectedAt: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function field(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}
function plainText(value: string | null): string | null {
  if (!value) return null;
  const clean = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
  if (!clean || /^inteiro\s+teor\s+indispon[ií]vel\.?$/i.test(clean)) return null;
  if (/^(acesso restrito|faça login|autentique-se)/i.test(clean)) return null;
  return clean;
}
function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}
function officialUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'tjdft.jus.br' || url.hostname.endsWith('.tjdft.jus.br')) ? url.toString() : null;
  } catch { return null; }
}

export function normalizeTjdftResponse(payload: unknown, pageNumber: number, pageSize = 20): SourcePage {
  const envelope = asRecord(payload);
  if (!envelope || !Array.isArray(envelope.registros)) throw new ConnectorError('schema_changed', 'A resposta do TJDFT não contém registros.');
  const hits = asRecord(envelope.hits);
  const count = typeof envelope.hits === 'number' ? envelope.hits : typeof hits?.value === 'number' ? hits.value : null;
  const records: SourceJudgment[] = [];
  let rejected = 0;
  const rejections: SourcePage['rejections'] = [];
  for (const [index,value] of envelope.registros.entries()) {
    const row = asRecord(value);
    if (!row) {
      rejected++;
      const payloadJson=JSON.stringify(value).slice(0,20_000);
      rejections.push({index,reason:'not_object',sha256:createHash('sha256').update(JSON.stringify(value)).digest('hex'),payloadJson});
      continue;
    }
    const identifier = field(row, 'identificador', 'uuid');
    if (!identifier) {
      rejected++;
      const payloadJson=JSON.stringify(value).slice(0,20_000);
      rejections.push({index,reason:'missing_identifier',sha256:createHash('sha256').update(JSON.stringify(value)).digest('hex'),payloadJson});
      continue;
    }
    const ementa = plainText(field(row, 'ementa'));
    const fullText = plainText(field(row, 'inteiroTeorHtml', 'inteiroTeor'));
    const promised = row.possuiInteiroTeor === true;
    const explicitPlaceholder = /inteiro\s+teor\s+indispon[ií]vel/i.test(field(row, 'inteiroTeorHtml', 'inteiroTeor') ?? '');
    records.push({
      sourceJudgmentId: identifier,
      tribunal: 'TJDFT',
      courtUnit: field(row, 'descricaoOrgaoJulgador', 'descricaoOrgao'),
      caseNumber: field(row, 'processo'),
      className: field(row, 'descricaoClasseCnj', 'classe'),
      rapporteur: field(row, 'nomeRelator'),
      title: field(row, 'titulo', 'descricaoClasseCnj') ?? `Julgado ${identifier}`,
      decisionDate: dateOnly(field(row, 'dataJulgamento')),
      sourceUpdatedAt: field(row, 'dataAtualizacao', 'versao'),
      sourceUrl: officialUrl(field(row, 'url', 'urlInteiroTeor', 'link')),
      ementa,
      fullText,
      fullTextStatus: fullText ? 'ready' : explicitPlaceholder || !promised ? 'unavailable' : 'pending',
    });
  }
  const nextCursor = count !== null ? (pageNumber + 1) * pageSize < count ? String(pageNumber + 1) : null
    : records.length === pageSize ? String(pageNumber + 1) : null;
  return { records, totalReported: count, nextCursor, rejected, rejections, collectedAt: new Date().toISOString() };
}

export async function searchTjdft(
  installation: InstallationRef,
  input: { theme: string; pageNumber: number; pageSize?: number; identifier?: string },
  transport: Transport = liveTransport,
): Promise<SourcePage> {
  if (installation.kind !== 'jurisprudence_api' || installation.courtCode !== 'TJDFT' || installation.authKind !== 'none') {
    throw new ConnectorError('unsupported', 'Esta instalação não é a API pública de jurisprudência do TJDFT.');
  }
  const pageSize = Math.min(20, Math.max(1, input.pageSize ?? 20));
  const body: Record<string, unknown> = { query: input.theme, pagina: input.pageNumber, tamanho: pageSize };
  if (input.identifier) body.termosAcessorios = [{ campo: 'identificador', valor: input.identifier }];
  const result = await transport.request(installation, ENDPOINT, { method: 'POST', body });
  if (!result.contentType.toLowerCase().includes('json')) throw new ConnectorError('schema_changed', 'A API TJDFT não retornou JSON.');
  let payload: unknown;
  try { payload = JSON.parse(result.body); } catch { throw new ConnectorError('schema_changed', 'JSON inválido da API TJDFT.'); }
  return normalizeTjdftResponse(payload, input.pageNumber, pageSize);
}

export async function getTjdftJudgment(installation: InstallationRef, identifier: string, transport: Transport = liveTransport): Promise<SourceJudgment | null> {
  // A narrow public canary confirmed that the documented identifier filter accepts query=''.
  // This lookup carries no office's original thematic query to the source or the shared corpus.
  const page = await searchTjdft(installation, { theme: '', pageNumber: 0, pageSize: 1, identifier }, transport);
  return page.records.find((record) => record.sourceJudgmentId === identifier) ?? null;
}

export async function fetchTjdftMaterial(installation: InstallationRef, identifier: string, transport: Transport = liveTransport): Promise<{ status: 'ready' | 'unavailable'; text: string | null }> {
  const record = await getTjdftJudgment(installation, identifier, transport);
  if (!record) throw new ConnectorError('not_found_in_source', 'Julgado não encontrado na fonte.');
  return { status: record.fullText ? 'ready' : 'unavailable', text: record.fullText };
}
