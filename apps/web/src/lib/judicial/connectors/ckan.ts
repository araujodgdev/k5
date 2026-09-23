import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import {
  ConnectorError,
  emptyCoverage,
  type ConnectorCapabilities,
  type ConnectorOperation,
  type InstallationRef,
  type JudicialConnector,
  type NormalizedPrecedent,
  type PrecedentContentKind,
  type PrecedentFetch,
  type PrecedentLicense,
  type PrecedentResource,
} from '../contracts';
import { parseCnjNumber } from '../normalization/cnj';
import { nowIso, parseSourceDate } from '../normalization/dates';
import type { Transport } from './transport';

/**
 * CKAN open-data portals as a source of jurisprudence collections (B1 of
 * docs/Refinos-MVP/plano-jurisprudencia.md), starting with the STJ's dadosabertos portal.
 *
 * Two layers, deliberately apart:
 * - The CKAN envelope (`package_show`) is the standard, documented CKAN action API.
 * - The records inside each file follow the STJ espelho layout as known when this was written.
 *   That part has NOT been confronted with a real download: the parser version is pinned and the
 *   first real file goes through the A1 probe before anything is trusted.
 */

export const CKAN_PARSER_VERSION = 'ckan-stj-2026-09-a';

const PACKAGE_SHOW = 'api/3/action/package_show';
/** Collections are large; a month of espelhos is tens of megabytes. */
const RESOURCE_MAX_BYTES = 64 * 1024 * 1024;
const COURT = 'STJ';

type Json = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function pick(raw: Json, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value !== null) return value;
  }
  return null;
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** CKAN's "no license" placeholders are an absence of license, not a license. */
const UNSPECIFIED_LICENSE = new Set(['notspecified', 'other-closed', 'license not specified']);

function licenseOf(holder: Json, attribution: string | null): PrecedentLicense {
  // A missing id is not a statement of "no license"; only CKAN's explicit placeholders are.
  const id = text(holder.license_id)?.toLowerCase() ?? null;
  const title = text(holder.license_title);
  if (!title || (id && UNSPECIFIED_LICENSE.has(id)) || UNSPECIFIED_LICENSE.has(title.toLowerCase())) return null;
  return { title, url: text(holder.license_url), attribution };
}

/**
 * Pure. One `package_show` answer in, the dataset's resources out, each with the license read
 * from the resource itself or, failing that, from this same dataset. Never from another dataset,
 * never from the portal: one dataset declaring CC-BY says nothing about its neighbour.
 */
export function normalizePackage(payload: string): { datasetId: string; items: PrecedentResource[]; rejected: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch {
    throw new ConnectorError('schema_changed', 'A resposta do CKAN não é JSON válido.');
  }
  const envelope = parsed as { success?: unknown; result?: Json };
  if (envelope?.success !== true || !envelope.result || typeof envelope.result !== 'object') {
    throw new ConnectorError('schema_changed', 'A resposta do CKAN não trouxe um conjunto de dados.');
  }
  const dataset = envelope.result;
  const datasetId = text(dataset.id) ?? text(dataset.name);
  if (!datasetId || !Array.isArray(dataset.resources)) {
    throw new ConnectorError('schema_changed', 'O conjunto do CKAN não declara identificador ou recursos.');
  }

  const organization = dataset.organization && typeof dataset.organization === 'object' ? dataset.organization as Json : {};
  const attribution = text(organization.title) ?? text(dataset.author) ?? text(dataset.maintainer);
  const datasetLicense = licenseOf(dataset, attribution);

  const items: PrecedentResource[] = [];
  let rejected = 0;
  for (const entry of dataset.resources as unknown[]) {
    if (!entry || typeof entry !== 'object') { rejected += 1; continue; }
    const resource = entry as Json;
    const id = text(resource.id);
    const url = text(resource.url);
    if (!id || !url) { rejected += 1; continue; }
    const updated = text(resource.last_modified) ?? text(resource.metadata_modified);
    // A declared hash is the best signal; without one, the last change and the size stand in.
    const declaredChecksum = text(resource.hash) ?? `${updated ?? 'sem-data'}|${text(resource.size) ?? 'sem-tamanho'}`;
    items.push({
      sourceResourceId: id,
      datasetId,
      name: text(resource.name),
      url,
      format: text(resource.format),
      declaredChecksum,
      sourceUpdatedAt: updated,
      license: text(resource.license_title) ? licenseOf(resource, attribution) : datasetLicense,
    });
  }
  return { datasetId, items, rejected };
}

/**
 * STJ record keys, by alias. Provisional (see the header): confirm against a real file with the
 * A1 probe before trusting a single field.
 */
const RECORD_KEYS = {
  id: ['id', 'seqDocumento', 'numeroDocumento'],
  organ: ['nomeOrgaoJulgador', 'orgaoJulgador'],
  rapporteur: ['ministroRelator', 'relator', 'ministro'],
  judgedOn: ['dataDecisao', 'dataJulgamento'],
  publishedOn: ['dataPublicacao'],
  headnote: ['ementa'],
  fullText: ['inteiroTeor', 'teor'],
  process: ['numeroProcesso', 'processo'],
  classAcronym: ['siglaClasse'],
  decisionKind: ['tipoDeDecisao', 'tipoDocumento'],
  updated: ['dataAtualizacao'],
  /** Hypothesis until a real file shows how the STJ relates espelho and íntegra. */
  related: ['documentoRelacionado'],
} as const;

/** "DJE        DATA:21/06/2022" and friends: the date inside, or nothing. */
function publicationDate(raw: string | null): string | null {
  if (!raw) return null;
  const direct = parseSourceDate(raw);
  if (direct) return direct.value;
  const embedded = /(\d{2}\/\d{2}\/\d{4})/.exec(raw);
  return embedded ? parseSourceDate(embedded[1])?.value ?? null : null;
}

const brDate = (iso: string | null) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : null;

export type ResourceContext = {
  contentKind: PrecedentContentKind;
  license: PrecedentLicense;
  /** Reference to the stored original, used as `fullTextRef` when the record carries the text. */
  resourceRef: string;
};

function toPrecedent(raw: Json, context: ResourceContext): NormalizedPrecedent | null {
  const id = pick(raw, ...RECORD_KEYS.id);
  const headnote = pick(raw, ...RECORD_KEYS.headnote);
  const fullText = pick(raw, ...RECORD_KEYS.fullText);
  // A record with neither an identity nor any text is not a document the office could cite.
  if (!id || (!headnote && !fullText)) return null;

  const process = pick(raw, ...RECORD_KEYS.process);
  const parsed = process ? parseCnjNumber(process) : null;
  const acronym = pick(raw, ...RECORD_KEYS.classAcronym);
  const rapporteur = pick(raw, ...RECORD_KEYS.rapporteur);
  const organ = pick(raw, ...RECORD_KEYS.organ);
  const judgedOn = parseSourceDate(pick(raw, ...RECORD_KEYS.judgedOn))?.value ?? null;
  const publishedOn = publicationDate(pick(raw, ...RECORD_KEYS.publishedOn));
  const decision = (pick(raw, ...RECORD_KEYS.decisionKind) ?? '').toLowerCase();
  const contentKind: PrecedentContentKind = context.contentKind === 'inteiro_teor' && decision.includes('monocr')
    ? 'decisao_monocratica'
    : context.contentKind;

  const title = [acronym, process].filter(Boolean).join(' ') || null;
  const citationLabel = [
    COURT,
    title,
    rapporteur ? `Rel. ${rapporteur}` : null,
    organ,
    judgedOn ? `julgado em ${brDate(judgedOn)}` : null,
    publishedOn ? `publicado em ${brDate(publishedOn)}` : null,
  ].filter(Boolean).join(', ');

  return {
    sourceDocumentId: id,
    court: COURT,
    organ,
    contentKind,
    caseIdentity: process ? { cnjNumber: parsed?.ok ? parsed.normalized : null, nativeNumber: process } : null,
    title,
    rapporteur,
    judgedOn,
    publishedOn,
    headnote,
    fullTextRef: fullText ? `${context.resourceRef}#${id}` : null,
    citationLabel,
    license: context.license,
    sourceUpdatedAt: parseSourceDate(pick(raw, ...RECORD_KEYS.updated))?.value ?? null,
    checksum: sha256(JSON.stringify(raw)),
    relatedSourceDocumentId: pick(raw, ...RECORD_KEYS.related),
  };
}

function recordsOf(json: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch {
    throw new ConnectorError('schema_changed', 'Arquivo do acervo não é JSON válido.');
  }
  if (Array.isArray(parsed)) return parsed;
  const list = parsed && typeof parsed === 'object'
    ? ['documentos', 'registros', 'items', 'data'].map((key) => (parsed as Json)[key]).find(Array.isArray)
    : undefined;
  if (!Array.isArray(list)) throw new ConnectorError('schema_changed', 'Arquivo do acervo não traz uma lista de documentos.');
  return list;
}

/**
 * Pure. A resource's bytes in — one JSON file, or a ZIP of them — every document out. A ZIP of N
 * decisions is N documents from one resource; the two numbers are never confused.
 */
export function normalizeResource(bytes: Buffer, context: ResourceContext): { items: NormalizedPrecedent[]; rejected: number; files: number } {
  const isZip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  let files: string[];
  if (isZip) {
    let zip: PizZip;
    try { zip = new PizZip(bytes); } catch {
      throw new ConnectorError('schema_changed', 'O arquivo compactado do acervo está corrompido.');
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.json'));
    if (!entries.length) throw new ConnectorError('schema_changed', 'O arquivo compactado não contém JSON.');
    files = entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => entry.asText());
  } else {
    files = [bytes.toString('utf8')];
  }

  const items: NormalizedPrecedent[] = [];
  let rejected = 0;
  for (const file of files) {
    for (const entry of recordsOf(file)) {
      const precedent = entry && typeof entry === 'object' ? toPrecedent(entry as Json, context) : null;
      if (precedent) items.push(precedent); else rejected += 1;
    }
  }
  return { items, rejected, files: files.length };
}

export function createCkanConnector(transport: Transport): JudicialConnector {
  return {
    kind: 'ckan',
    parserVersion: CKAN_PARSER_VERSION,

    describeCapabilities(installation: InstallationRef): ConnectorCapabilities {
      const unsupported = (operation: ConnectorOperation, notes: string) => ({
        operation, supported: false, effect: 'unknown' as const, filters: [], maxPageSize: null, notes,
      });
      return {
        installationId: installation.id,
        parserVersion: CKAN_PARSER_VERSION,
        operations: [
          { operation: 'describeCapabilities', supported: true, effect: 'neutral_query', filters: [], maxPageSize: null },
          { operation: 'listPrecedents', supported: true, effect: 'neutral_query', filters: ['datasetId'], maxPageSize: null, notes: 'package_show de um conjunto público.' },
          { operation: 'fetchPrecedent', supported: true, effect: 'neutral_query', filters: [], maxPageSize: null, notes: 'Baixa um recurso público do conjunto.' },
          unsupported('lookupCase', 'Acervo de jurisprudência não consulta processo em andamento.'),
          unsupported('listChanges', 'Use listPrecedents.'),
          unsupported('fetchPublication', 'Acervo de jurisprudência não publica comunicações.'),
          unsupported('fetchDocument', 'Use fetchPrecedent.'),
        ],
        maxWindowDays: null,
        requiresConnection: false,
      };
    },

    async listPrecedents(installation, request) {
      const collectedAt = nowIso();
      const response = await transport.request(installation, PACKAGE_SHOW, { query: { id: request.datasetId } });
      const parsed = normalizePackage(response.body);
      return {
        items: parsed.items,
        cursor: null,
        coverage: { ...emptyCoverage(), pagesFetched: 1, totalReported: parsed.items.length, rejected: parsed.rejected },
        source: { installationId: installation.id, operation: 'listPrecedents', parserVersion: CKAN_PARSER_VERSION, collectedAt },
        rawPayloads: [{ contentType: response.contentType, body: response.body }],
      };
    },

    async fetchPrecedent(installation, request): Promise<PrecedentFetch> {
      const collectedAt = nowIso();
      // The resource URL comes from the source; the transport re-checks it against this
      // installation's allowlist like any other hop, so a link to another host is refused.
      const response = await transport.request(installation, request.resource.url, { maxBytes: RESOURCE_MAX_BYTES });
      const digest = sha256(response.bytes);
      const parsed = normalizeResource(response.bytes, {
        contentKind: request.contentKind,
        license: request.resource.license,
        resourceRef: `${request.resource.sourceResourceId}@${digest}`,
      });
      return {
        items: parsed.items,
        cursor: null,
        coverage: { ...emptyCoverage(), pagesFetched: 1, totalReported: null, rejected: parsed.rejected },
        source: { installationId: installation.id, operation: 'fetchPrecedent', parserVersion: CKAN_PARSER_VERSION, collectedAt },
        rawPayloads: [],
        original: { contentType: response.contentType, bytes: response.bytes, sha256: digest },
      };
    },

    normalize(operation: ConnectorOperation, payload: string) {
      if (operation === 'listPrecedents') return normalizePackage(payload);
      if (operation === 'fetchPrecedent') {
        // Re-reading a stored original without its dataset context: no license is assumed.
        return normalizeResource(Buffer.from(payload, 'utf8'), { contentKind: 'espelho', license: null, resourceRef: 'snapshot' });
      }
      throw new ConnectorError('unsupported', `Operação sem parser no conector CKAN: ${operation}`);
    },
  };
}
