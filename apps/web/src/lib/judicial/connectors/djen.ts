import {
  ConnectorError,
  emptyCoverage,
  type ConnectorCapabilities,
  type ConnectorOperation,
  type ConnectorResult,
  type InstallationRef,
  type JudicialConnector,
  type ListChangesRequest,
  type NormalizedPublication,
} from '../contracts';
import { parseSourceDate, nowIso, windowDays } from '../normalization/dates';
import { parseCnjNumber, stripCnjPunctuation } from '../normalization/cnj';
import type { Transport } from './transport';

/**
 * DJEN — the national electronic judicial gazette — as a source of *publications*.
 *
 * Scope, stated plainly because the plan insists on it: DJEN is not the docket and not the case
 * file. A publication collected here is evidence that something was published, never the full set
 * of movements, and never a substitute for an official intimation.
 *
 * The request and response shapes below are the documented ones this connector was written
 * against; they have not been confirmed against a production response (section 15 of the plan).
 * That is exactly why `parserVersion` is pinned and why every raw payload is persisted: when the
 * real contract turns out to differ, `normalize` is corrected and the stored snapshots are
 * re-read, instead of the courts being queried again.
 */

export const DJEN_PARSER_VERSION = 'djen-2026-09-a';

const COMMUNICATION_PATH = 'api/v1/comunicacao';
const MAX_PAGE_SIZE = 100;
/** The plan proposes starting from short windows and widening only after measuring cost. */
const MAX_WINDOW_DAYS = 31;
const DEFAULT_MAX_PAGES = 20;

type RawCommunication = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Reads the first key the source actually used, so a rename upstream is a miss, not a crash. */
function pick(raw: RawCommunication, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Gazette entries arrive as HTML often enough that storing the markup as the body would put
 * unsanitized third-party HTML in front of a reader. The tags are stripped here and the original
 * bytes stay in the snapshot.
 */
export function plainTextFromGazette(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A corrected entry is a new version related to the earlier one, so the kind has to be read
 * rather than assumed. When the source says nothing, `original` is the honest default.
 */
function revisionKind(raw: RawCommunication): NormalizedPublication['revisionKind'] {
  const declared = pick(raw, 'tipoComunicacao', 'tipo_comunicacao', 'situacao')?.toLowerCase() ?? '';
  if (declared.includes('errata') || declared.includes('retifica')) return 'errata';
  if (declared.includes('republica')) return 'republication';
  return 'original';
}

function toPublication(raw: RawCommunication): NormalizedPublication | null {
  const body = pick(raw, 'texto', 'textoComunicacao', 'texto_comunicacao', 'conteudo');
  if (!body) return null;

  const rawNumber = pick(raw, 'numeroProcesso', 'numero_processo', 'numeroprocessocommascara');
  // An unparseable number is dropped from the CNJ column rather than stored there: the column is
  // joined against, and a twenty-character string that fails its check digits is not an identity.
  const parsed = rawNumber ? parseCnjNumber(rawNumber) : null;

  const madeAvailable = parseSourceDate(pick(raw, 'dataDisponibilizacao', 'data_disponibilizacao', 'datadisponibilizacao'));
  const published = parseSourceDate(pick(raw, 'dataPublicacao', 'data_publicacao'));
  const updated = parseSourceDate(pick(raw, 'dataAtualizacao', 'data_atualizacao'));

  return {
    sourcePublicationId: pick(raw, 'id', 'numeroComunicacao', 'numero_comunicacao', 'hash'),
    cnjNumber: parsed?.ok ? parsed.normalized : null,
    edition: pick(raw, 'numeroEdicao', 'numero_edicao', 'edicao'),
    page: pick(raw, 'numeroPagina', 'pagina'),
    officialHash: pick(raw, 'hash', 'hashComunicacao'),
    body: plainTextFromGazette(body),
    madeAvailableOn: madeAvailable?.value ?? null,
    publishedOn: published?.value ?? null,
    sourceUpdatedAt: updated?.value ?? null,
    revisionKind: revisionKind(raw),
  };
}

type ParsedPage = { items: NormalizedPublication[]; rejected: number; totalReported: number | null };

/**
 * Pure. Same bytes in, same records out, no network. A payload whose top level no longer looks
 * like a list of communications raises `schema_changed` instead of publishing an empty page as
 * a successful "nothing new" (section 7 step 5).
 */
export function normalizeCommunications(payload: string): ParsedPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ConnectorError('schema_changed', 'A resposta do DJEN não é JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ConnectorError('schema_changed', 'A resposta do DJEN não tem o formato esperado.');
  }

  const envelope = parsed as Record<string, unknown>;
  const list = [envelope.items, envelope.content, envelope.comunicacoes, envelope.data]
    .find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(list)) {
    throw new ConnectorError('schema_changed', 'A resposta do DJEN não trouxe uma lista de comunicações.');
  }

  const items: NormalizedPublication[] = [];
  let rejected = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') { rejected += 1; continue; }
    const publication = toPublication(entry as RawCommunication);
    if (publication) items.push(publication); else rejected += 1;
  }

  const reported = envelope.count ?? envelope.total ?? envelope.totalElements;
  return {
    items,
    rejected,
    totalReported: typeof reported === 'number' && Number.isFinite(reported) ? reported : null,
  };
}

export function createDjenConnector(transport: Transport): JudicialConnector {
  return {
    kind: 'djen',
    parserVersion: DJEN_PARSER_VERSION,

    describeCapabilities(installation: InstallationRef): ConnectorCapabilities {
      return {
        installationId: installation.id,
        parserVersion: DJEN_PARSER_VERSION,
        operations: [
          {
            operation: 'describeCapabilities',
            supported: true,
            effect: 'neutral_query',
            filters: [],
            maxPageSize: null,
          },
          {
            operation: 'listChanges',
            supported: true,
            // Reading a gazette that is already public does not perfect service of process; the
            // communication content inside Domicílio does, which is why that stays out of F1.
            effect: 'neutral_query',
            filters: ['windowFrom', 'windowTo', 'cnjNumbers'],
            maxPageSize: MAX_PAGE_SIZE,
          },
          {
            operation: 'fetchPublication',
            supported: true,
            effect: 'neutral_query',
            filters: ['sourcePublicationId'],
            maxPageSize: null,
          },
          {
            operation: 'health',
            supported: true,
            effect: 'neutral_query',
            filters: [],
            maxPageSize: null,
            notes: 'Janela mínima de consulta pública; nunca um documento de cliente.',
          },
          {
            operation: 'lookupCase',
            supported: false,
            effect: 'unknown',
            filters: [],
            maxPageSize: null,
            notes: 'DJEN publica comunicações, não os autos. Use um conector processual do tribunal.',
          },
          {
            operation: 'fetchDocument',
            supported: false,
            effect: 'unknown',
            filters: [],
            maxPageSize: null,
            notes: 'Certidões e anexos dependem de condição de uso ainda não esclarecida.',
          },
        ],
        maxWindowDays: MAX_WINDOW_DAYS,
        requiresConnection: installation.authKind !== 'none',
      } satisfies ConnectorCapabilities;
    },

    async health(installation) {
      try {
        const today = nowIso().slice(0, 10);
        await transport.request(installation, COMMUNICATION_PATH, {
          query: { dataDisponibilizacaoInicio: today, dataDisponibilizacaoFim: today, itensPorPagina: 1, pagina: 1 },
          timeoutMs: 8_000,
        });
        return { ok: true, detail: 'Consulta mínima respondida.' };
      } catch (error) {
        return { ok: false, detail: error instanceof ConnectorError ? `${error.code}: ${error.message}` : 'Falha desconhecida.' };
      }
    },

    async listChanges(installation, request: ListChangesRequest): Promise<ConnectorResult<NormalizedPublication>> {
      const span = windowDays(request.windowFrom, request.windowTo);
      if (Number.isNaN(span) || span <= 0) {
        throw new ConnectorError('unsupported', 'Janela de consulta inválida.');
      }
      if (span > MAX_WINDOW_DAYS) {
        throw new ConnectorError('unsupported', `Janela acima do limite de ${MAX_WINDOW_DAYS} dias para esta fonte.`);
      }

      const collectedAt = nowIso();
      const maxPages = Math.max(1, Math.min(request.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
      // A cursor from a previous call resumes the sweep; there is no page 0.
      const startPage = request.cursor ? Number(request.cursor) : 1;
      if (!Number.isInteger(startPage) || startPage < 1) {
        throw new ConnectorError('unsupported', 'Cursor inválido.');
      }

      // One request per linked proceeding when the office gave a list, one broad sweep otherwise.
      const numbers = request.cnjNumbers?.length
        ? request.cnjNumbers.map((value) => stripCnjPunctuation(value)).filter((value) => value.length === 20)
        : [undefined];
      if (request.cnjNumbers?.length && !numbers.filter(Boolean).length) {
        throw new ConnectorError('unsupported', 'Nenhum número CNJ válido na solicitação.');
      }

      const items: NormalizedPublication[] = [];
      const rawPayloads: ConnectorResult<NormalizedPublication>['rawPayloads'] = [];
      const coverage = { ...emptyCoverage(), windowFrom: request.windowFrom, windowTo: request.windowTo };
      let nextCursor: string | null = null;

      for (const numeroProcesso of numbers) {
        let page = startPage;
        for (let walked = 0; walked < maxPages; walked += 1) {
          const response = await transport.request(installation, COMMUNICATION_PATH, {
            query: {
              dataDisponibilizacaoInicio: request.windowFrom,
              dataDisponibilizacaoFim: request.windowTo,
              numeroProcesso,
              itensPorPagina: MAX_PAGE_SIZE,
              pagina: page,
            },
          });

          rawPayloads.push({ contentType: response.contentType, body: response.body });
          const parsed = normalizeCommunications(response.body);
          items.push(...parsed.items);
          coverage.rejected += parsed.rejected;
          coverage.pagesFetched += 1;
          if (parsed.totalReported !== null) {
            coverage.totalReported = (coverage.totalReported ?? 0) + parsed.totalReported;
          }

          // A short page is the end of the list; a full page means there may be more.
          if (parsed.items.length + parsed.rejected < MAX_PAGE_SIZE) break;
          page += 1;
          if (walked === maxPages - 1) {
            // Stopping at the page ceiling is reported, never presented as a complete sweep.
            coverage.truncated = true;
            nextCursor = String(page);
          }
        }
      }

      return {
        items,
        cursor: nextCursor,
        coverage,
        source: {
          installationId: installation.id,
          operation: 'listChanges',
          parserVersion: DJEN_PARSER_VERSION,
          collectedAt,
        },
        rawPayloads,
      };
    },

    async fetchPublication(installation, sourcePublicationId): Promise<ConnectorResult<NormalizedPublication>> {
      const collectedAt = nowIso();
      const response = await transport.request(installation, `${COMMUNICATION_PATH}/${encodeURIComponent(sourcePublicationId)}`);
      const parsed = normalizeCommunications(response.body);
      if (!parsed.items.length) throw new ConnectorError('not_found_in_source', 'Comunicação não encontrada nesta fonte.');
      return {
        items: parsed.items.slice(0, 1),
        cursor: null,
        coverage: { ...emptyCoverage(), pagesFetched: 1, rejected: parsed.rejected, totalReported: 1 },
        source: { installationId: installation.id, operation: 'fetchPublication', parserVersion: DJEN_PARSER_VERSION, collectedAt },
        rawPayloads: [{ contentType: response.contentType, body: response.body }],
      };
    },

    normalize(operation: ConnectorOperation, payload: string) {
      if (operation === 'listChanges' || operation === 'fetchPublication') return normalizeCommunications(payload);
      throw new ConnectorError('unsupported', `Operação sem parser no conector DJEN: ${operation}`);
    },
  };
}
