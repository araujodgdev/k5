import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { ConnectorError } from '@/lib/judicial/contracts';
import type { SourceJudgment } from './tjdft';

export const STJ_PARSER_VERSION = 'stj-ckan-v2';
export const STJ_MAX_RESOURCE_BYTES = 50 * 1024 * 1024;
export const STJ_MIRROR_DATASET = 'espelhos-de-acordaos-segunda-turma';
export const STJ_FULL_TEXT_DATASET = 'integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica';
export type StjResourceKind = 'mirror_json' | 'mirror_zip' | 'full_text_json' | 'full_text_zip' | 'full_text_pdf';
export type StjRejection = { index: number; reason: string; sha256: string; payloadJson: string };
export type StjMirror = { judgment: SourceJudgment; documentId: string | null; registrationNumber: string | null };
export type StjFullTextMetadata = {
  documentId: string; registrationNumber: string | null; documentType: string; publicationDate: string | null;
};
export type StjZipText = { documentId: string; text: string };
export type StjCkanResource = {
  id: string; name: string; url: string; kind: StjResourceKind; sourceUpdatedAt: string | null;
  sourceDataDate: string; etag: string | null; declaredSize: number | null;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const field = (row: Record<string, unknown>, ...names: string[]): string | null => {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};
const cleanText = (value: string | null): string | null => value?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ').trim() || null;
const dateOnly = (value: string | null): string | null => {
  if (!value) return null;
  if (/^\d{13}$/.test(value)) {
    const date = new Date(Number(value));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const candidate = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : iso?.[1] ??
    (br ? `${br[3]}-${br[2]}-${br[1]}` : null);
  if (!candidate) return null;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate ? null : candidate;
};
export function officialStjUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorError('forbidden', 'Endereço STJ inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(url.hostname === 'stj.jus.br' || url.hostname.endsWith('.stj.jus.br')))
    throw new ConnectorError('forbidden', 'Recurso fora dos endereços oficiais do STJ.');
  return url.toString();
}
function optionalStjUrl(value: string | null): string | null {
  if (!value) return null;
  try { return officialStjUrl(value); } catch { return null; }
}
export function stjRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const envelope = object(payload);
  for (const key of ['registros', 'records', 'data', 'items', 'acordaos', 'documentos']) {
    if (Array.isArray(envelope?.[key])) return envelope[key] as unknown[];
  }
  throw new ConnectorError('schema_changed', 'O recurso STJ não contém uma lista de registros reconhecida.');
}
function reject(index: number, value: unknown, reason: string): StjRejection {
  const raw = JSON.stringify(value) ?? 'null';
  return { index, reason, sha256: createHash('sha256').update(raw).digest('hex'), payloadJson: raw.slice(0, 20_000) };
}
export function normalizeStjMirror(value: unknown, index: number): StjMirror | StjRejection {
  const row = object(value);
  if (!row) return reject(index, value, 'not_object');
  // The espelho's own ID is the judgment identity. Neither numeroProcesso nor numeroRegistro is unique.
  const id = field(row, 'id', 'ID');
  if (!id || id.length > 200) return reject(index, value, 'missing_native_id');
  const ementa = cleanText(field(row, 'ementa', 'EMENTA'));
  if (!ementa) return reject(index, value, 'missing_ementa');
  const caseNumber = field(row, 'numeroProcesso', 'processo', 'numero_processo', 'PROCESSO');
  const className = field(row, 'descricaoClasse', 'classeProcessual', 'classe', 'CLASSE');
  const classAbbreviation = field(row, 'siglaClasse');
  const title = [classAbbreviation, caseNumber].filter(Boolean).join(' ') || className || `Acórdão STJ ${id}`;
  return {
    documentId: field(row, 'numeroDocumento'),
    registrationNumber: field(row, 'numeroRegistro'),
    judgment: {
      sourceJudgmentId: id, tribunal: 'STJ',
      courtUnit: field(row, 'nomeOrgaoJulgador', 'orgaoJulgador', 'orgao_julgador', 'ORGAO_JULGADOR'),
      caseNumber, className: className ?? classAbbreviation,
      rapporteur: field(row, 'ministroRelator', 'relator', 'RELATOR'), title: title.slice(0, 500),
      decisionDate: dateOnly(field(row, 'dataDecisao', 'dataJulgamento', 'data_julgamento', 'DATA_JULGAMENTO')),
      sourceUpdatedAt: null,
      sourceUrl: optionalStjUrl(field(row, 'url', 'link', 'urlJurisprudencia')),
      ementa, fullText: null, fullTextStatus: 'pending',
    },
  };
}
export function normalizeStjFullTextMetadata(value: unknown, index: number): StjFullTextMetadata | StjRejection {
  const row = object(value);
  if (!row) return reject(index, value, 'not_object');
  // The DJE metadata's SeqDocumento is the ZIP member stem. It is not an espelho ID.
  const documentId = field(row, 'SeqDocumento');
  if (!documentId || !/^\d{1,30}$/.test(documentId)) return reject(index, value, 'missing_document_id');
  const documentType = field(row, 'tipoDocumento');
  if (!documentType) return reject(index, value, 'missing_document_type');
  return { documentId, registrationNumber: field(row, 'numeroRegistro'), documentType,
    publicationDate: dateOnly(field(row, 'dataPublicacao')) };
}
export function isStjRejection(value: StjMirror | StjFullTextMetadata | StjRejection): value is StjRejection {
  return 'reason' in value;
}

/** CKAN metadata is discovery only. It does not itself grant permission to ingest. */
export function stjCkanResources(payload: unknown, datasetSlug: string): StjCkanResource[] {
  if (datasetSlug !== STJ_MIRROR_DATASET && datasetSlug !== STJ_FULL_TEXT_DATASET)
    throw new ConnectorError('forbidden', 'Conjunto STJ não reconhecido.');
  const response = object(payload);
  const result = object(response?.result);
  if (response?.success !== true || !result || result.name !== datasetSlug || result.license_id !== 'cc-by' ||
    !Array.isArray(result.resources)) throw new ConnectorError('schema_changed', 'Metadados CKAN ou licença STJ inesperados.');
  const output: StjCkanResource[] = [];
  for (const value of result.resources) {
    const item = object(value);
    if (!item || item.state !== 'active') continue;
    const id = field(item, 'id');
    const name = field(item, 'name');
    const url = field(item, 'url');
    const format = field(item, 'format')?.toUpperCase();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !name || !url) continue;
    let kind: StjResourceKind | null = null;
    let date: string | null = null;
    if (datasetSlug === STJ_MIRROR_DATASET) {
      const match = name.match(/^(\d{8})\.(json|zip)$/i);
      if (match && format === match[2].toUpperCase()) {
        date = match[1]; kind = format === 'JSON' ? 'mirror_json' : 'mirror_zip';
      }
    } else {
      const metadata = name.match(/^metadados(\d{6}|\d{8})(?:\.json)?$/i);
      const texts = name.match(/^(\d{6}|\d{8})\.zip$/i);
      if (metadata && format === 'JSON') { date = metadata[1]; kind = 'full_text_json'; }
      if (texts && format === 'ZIP') { date = texts[1]; kind = 'full_text_zip'; }
    }
    if (!kind || !date) continue;
    const declaredSize = typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : null;
    if (declaredSize !== null && (declaredSize < 0 || declaredSize > STJ_MAX_RESOURCE_BYTES)) continue;
    output.push({ id, name, url: officialStjUrl(url), kind, sourceDataDate: date.padEnd(8, '0'),
      sourceUpdatedAt: field(item, 'last_modified', 'metadata_modified', 'created'),
      etag: field(item, 'hash')?.slice(0, 200) ?? null, declaredSize });
  }
  return output.sort((a, b) => a.sourceDataDate.localeCompare(b.sourceDataDate) || a.id.localeCompare(b.id));
}

function zipFiles(bytes: Buffer, extension: 'json' | 'txt'): Array<{ name: string; bytes: Buffer }> {
  if (bytes.length > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'Recurso STJ acima de 50 MB.');
  let zip: PizZip;
  try { zip = new PizZip(bytes); } catch { throw new ConnectorError('schema_changed', 'ZIP STJ inválido.'); }
  const files = Object.values(zip.files).filter(file => !file.dir && file.name.toLowerCase().endsWith(`.${extension}`));
  if (!files.length || files.length > 10_000) throw new ConnectorError('schema_changed', 'ZIP STJ sem arquivos válidos.');
  let declared = 0;
  const output: Array<{ name: string; bytes: Buffer }> = [];
  for (const file of files) {
    const size = (file as typeof file & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || !size || size < 0) throw new ConnectorError('schema_changed', 'ZIP STJ sem tamanho verificável.');
    declared += size;
    if (declared > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'ZIP STJ expandido acima de 50 MB.');
    let part: Buffer;
    try { part = file.asNodeBuffer(); } catch { throw new ConnectorError('schema_changed', 'Arquivo comprimido do STJ inválido.'); }
    if (part.length !== size) throw new ConnectorError('schema_changed', 'Tamanho comprimido do STJ inconsistente.');
    output.push({ name: file.name, bytes: part });
  }
  return output;
}
export function stjJsonFromResource(bytes: Buffer, kind: StjResourceKind): Buffer {
  if (bytes.length > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'Recurso STJ acima de 50 MB.');
  if (kind !== 'mirror_zip') return bytes;
  const rows: unknown[] = [];
  for (const part of zipFiles(bytes, 'json')) {
    try { rows.push(...stjRows(JSON.parse(part.bytes.toString('utf8')))); }
    catch { throw new ConnectorError('schema_changed', 'JSON comprimido do STJ inválido.'); }
  }
  const result = Buffer.from(JSON.stringify(rows));
  if (result.length > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'ZIP STJ expandido acima de 50 MB.');
  return result;
}
export function stjTextEntriesFromZip(bytes: Buffer): StjZipText[] {
  const output: StjZipText[] = [];
  const seen = new Set<string>();
  for (const part of zipFiles(bytes, 'txt')) {
    const name = part.name.replaceAll('\\', '/');
    const match = name.match(/^(?:[^/.][^/]*\/)*(\d{1,30})\.txt$/i);
    if (!match || seen.has(match[1])) throw new ConnectorError('schema_changed', 'Identidade ambígua no ZIP de íntegras STJ.');
    seen.add(match[1]);
    const content = part.bytes.toString('utf8').replace(/\u0000/g, '').trim();
    if (!content) continue;
    output.push({ documentId: match[1], text: content });
  }
  return output;
}
