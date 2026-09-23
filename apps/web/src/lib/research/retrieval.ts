import 'server-only';
import { database } from '@/lib/database';
import { corpusQuerySchema, ResearchError, type CorpusPage, type JudgmentDetail, type JudgmentSummary,
  type ResearchMaterialVersion, type ResearchChunk, type ResearchMaterial, type SearchFilters } from './contracts';
import { supportsDirectResearchMaterial } from './policy';

const ADMITTED = `i.purpose='jurisprudence' AND i.auth_kind='none' AND i.enabled=1
  AND i.discovery_status<>'suspended' AND i.permission_query='permitido'
  AND i.permission_cache='permitido' AND i.permission_redistribution='permitido'`;
export const RESEARCH_PAGE_SIZE = 20;

type SummaryRow = {
  id: string; installation_id: string; source_judgment_id: string; tribunal: string; court_unit: string | null;
  case_number: string | null; title: string; decision_date: string | null; source_url: string | null;
  status: string; ementa: string | null; ementa_version_id: string | null;
  full_text_status: string | null; full_text_version_id: string | null; permission_documents: string;
  source_kind: string; source_court_code: string;
};
const SUMMARY_COLUMNS = `j.id,j.installation_id,j.source_judgment_id,j.tribunal,j.court_unit,j.case_number,j.title,
  j.decision_date,j.source_url,j.status,v.text_content AS ementa,v.id AS ementa_version_id,
  fm.status AS full_text_status,fm.current_version_id AS full_text_version_id,i.permission_documents,
  i.kind AS source_kind,i.court_code AS source_court_code`;
const SUMMARY_JOINS = `FROM research_judgment j
  JOIN judicial_source_installation i ON i.id=j.installation_id
  LEFT JOIN research_material em ON em.judgment_id=j.id AND em.kind='ementa' AND em.status='ready'
  LEFT JOIN research_material_version v ON v.id=em.current_version_id AND v.published_at IS NOT NULL
  LEFT JOIN research_material fm ON fm.judgment_id=j.id AND fm.kind='full_text'`;

export function toJudgmentSummary(row: SummaryRow, excerpt = true): JudgmentSummary {
  return {
    id: row.id, installationId: row.installation_id, sourceJudgmentId: row.source_judgment_id,
    tribunal: row.tribunal, courtUnit: row.court_unit, caseNumber: row.case_number, title: row.title,
    decisionDate: row.decision_date, sourceUrl: row.source_url,
    sourceStatus: row.status === 'restricted' ? 'restricted' : 'active',
    ementa: excerpt ? row.ementa?.slice(0, 700) ?? null : row.ementa,
    ementaVersionId: row.ementa_version_id,
    fullTextStatus: row.permission_documents !== 'permitido' ? 'restricted'
      : row.full_text_status === 'pending' && !row.full_text_version_id &&
          !supportsDirectResearchMaterial({kind:row.source_kind,courtCode:row.source_court_code}) ? 'unavailable'
      : (row.full_text_status ?? 'unavailable') as JudgmentSummary['fullTextStatus'],
    fullTextVersionId: row.permission_documents !== 'permitido' ? null : row.full_text_version_id,
  };
}

function ftsQuery(theme: string): string {
  const terms = theme.normalize('NFC').match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 20) ?? [];
  if (!terms.length) throw new ResearchError('invalid_input', 'Informe termos pesquisáveis.');
  return terms.map((term) => `'${term.replaceAll("'", "''")}'`).join(' | ');
}
function decodeOffset(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: number };
    if (Number.isSafeInteger(parsed.offset) && parsed.offset! >= 0 && parsed.offset! <= 100_000) return parsed.offset!;
  } catch { /* invalid cursor */ }
  throw new ResearchError('invalid_input', 'Cursor inválido.');
}

/** PostgreSQL's GIN index covers every current public material, without a recent-documents cap. */
export async function searchCorpus(input: { theme: string; filters?: SearchFilters; cursor?: string;
  excludeSearchId?: string; candidateLimit?: number }): Promise<CorpusPage> {
  const parsed = corpusQuerySchema.parse(input);
  const offset = decodeOffset(parsed.cursor);
  const limit = input.candidateLimit === 30 ? 30 : RESEARCH_PAGE_SIZE;
  const filters = parsed.filters;
  const conditions = [`j.status='active'`, ADMITTED];
  const params: unknown[] = [];
  if (filters.court) { conditions.push('j.tribunal=?'); params.push(filters.court); }
  if (filters.fromDate) { conditions.push('j.decision_date>=?'); params.push(filters.fromDate); }
  if (filters.toDate) { conditions.push('j.decision_date<=?'); params.push(filters.toDate); }
  if (input.excludeSearchId) { conditions.push('j.id NOT IN (SELECT judgment_id FROM research_search_result WHERE search_id=?)'); params.push(input.excludeSearchId); }
  const where = conditions.join(' AND ');
  const match = ftsQuery(parsed.theme);
  const matched = `SELECT research_fts.judgment_id,MAX(ts_rank_cd(research_fts.search_vector,q)) AS score
    FROM research_fts CROSS JOIN to_tsquery('portuguese', ?) q
    JOIN research_judgment j ON j.id=research_fts.judgment_id
    JOIN judicial_source_installation i ON i.id=j.installation_id
    JOIN research_material_version indexed_version ON indexed_version.id=research_fts.material_version_id
      AND indexed_version.published_at IS NOT NULL
    JOIN research_material indexed_material ON indexed_material.id=indexed_version.material_id
      AND indexed_material.current_version_id=indexed_version.id AND indexed_material.status='ready'
    WHERE research_fts.search_vector @@ q AND ${where}
      AND (indexed_material.kind='ementa' OR i.permission_documents='permitido')
    GROUP BY research_fts.judgment_id`;
  const rows = await database.prepare(`WITH matched AS (${matched})
    SELECT ${SUMMARY_COLUMNS} ${SUMMARY_JOINS} JOIN matched m ON m.judgment_id=j.id
    ORDER BY m.score DESC,j.decision_date DESC NULLS LAST,j.id ASC LIMIT ? OFFSET ?`)
    .all<SummaryRow>(match, ...params, limit + 1, offset);
  const totalRow = await database.prepare(`WITH matched AS (${matched}) SELECT COUNT(*) AS total FROM matched`)
    .get<{ total: number }>(match, ...params);
  const hasMore = rows.length > limit;
  return { results: rows.slice(0, limit).map((row) => toJudgmentSummary(row)),
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString('base64url') : null,
    total: totalRow?.total ?? 0 };
}

export async function findResearchJudgment(judgmentId: string): Promise<JudgmentDetail | null> {
  const row = await database.prepare(`SELECT ${SUMMARY_COLUMNS},j.class_name,j.rapporteur,j.metadata_revision,j.source_updated_at,j.collected_at
    ${SUMMARY_JOINS} WHERE j.id=? AND j.status='active' AND ${ADMITTED}`)
    .get<SummaryRow & { class_name: string | null; rapporteur: string | null; metadata_revision: number;
      source_updated_at: string | null; collected_at: string }>(judgmentId);
  if (!row) return null;
  const materials = await database.prepare(`SELECT m.id,m.judgment_id,m.kind,m.status,m.current_version_id,m.unavailable_reason,
    v.id AS version_id,v.material_id,v.sha256,v.mime_type,v.byte_size,v.storage_key,v.text_content,
    v.parser_version,v.citation_metadata_json,v.metadata_revision AS version_metadata_revision,v.source_url,
    v.collected_at,v.published_at
    FROM research_material m LEFT JOIN research_material_version v ON v.id=m.current_version_id
    WHERE m.judgment_id=? ORDER BY m.kind`).all<Record<string, unknown>>(judgmentId);
  const detailMaterials: JudgmentDetail['materials'] = [];
  for (const raw of materials) {
    const id = String(raw.id);
    const versionId = raw.version_id ? String(raw.version_id) : null;
    const version: ResearchMaterialVersion | null = versionId ? {
      id: versionId, materialId: String(raw.material_id), sha256: String(raw.sha256), mimeType: String(raw.mime_type),
      byteSize: Number(raw.byte_size), storageKey: raw.storage_key as string | null,
      textContent: raw.text_content as string | null, parserVersion: String(raw.parser_version),
      citationMetadata: JSON.parse(String(raw.citation_metadata_json)), metadataRevision: Number(raw.version_metadata_revision),
      sourceUrl: raw.source_url as string | null, collectedAt: String(raw.collected_at), publishedAt: raw.published_at as string | null,
    } : null;
    const chunks = versionId ? await database.prepare(`SELECT id,material_version_id,ordinal,text_content,reference
      FROM research_chunk WHERE material_version_id=? ORDER BY ordinal`).all<{
      id: string; material_version_id: string; ordinal: number; text_content: string; reference: string;
    }>(versionId) : [];
    const permissionRestricted = raw.status === 'restricted' || (raw.kind === 'full_text' && row.permission_documents !== 'permitido');
    const importRequired = raw.kind === 'full_text' && raw.status === 'pending' && !versionId &&
      !supportsDirectResearchMaterial({kind:row.source_kind,courtCode:row.source_court_code});
    detailMaterials.push({ id, judgmentId, kind: raw.kind as ResearchMaterial['kind'],
      status: permissionRestricted ? 'restricted' : importRequired ? 'unavailable' : raw.status as ResearchMaterial['status'],
      currentVersionId: permissionRestricted ? null : versionId,
      unavailableReason: importRequired ? 'source_import_required' : raw.unavailable_reason as string | null,
      version: permissionRestricted ? null : version,
      chunks: permissionRestricted ? [] : chunks.map((chunk): ResearchChunk => ({ id: chunk.id, materialVersionId: chunk.material_version_id,
        ordinal: chunk.ordinal, textContent: chunk.text_content, reference: chunk.reference })) });
  }
  return { ...toJudgmentSummary(row, false), className: row.class_name, rapporteur: row.rapporteur,
    metadataRevision: row.metadata_revision, sourceUpdatedAt: row.source_updated_at,
    collectedAt: row.collected_at, materials: detailMaterials };
}

export async function findResearchMaterialVersion(versionId: string): Promise<ResearchMaterialVersion | null> {
  const row = await database.prepare(`SELECT v.* FROM research_material_version v
    JOIN research_material m ON m.id=v.material_id JOIN research_judgment j ON j.id=m.judgment_id
    JOIN judicial_source_installation i ON i.id=j.installation_id
    WHERE v.id=? AND v.published_at IS NOT NULL AND m.status='ready' AND j.status='active' AND ${ADMITTED}
      AND (m.kind='ementa' OR i.permission_documents='permitido')`).get<Record<string, unknown>>(versionId);
  if (!row) return null;
  return { id: String(row.id), materialId: String(row.material_id), sha256: String(row.sha256),
    mimeType: String(row.mime_type), byteSize: Number(row.byte_size), storageKey: row.storage_key as string | null,
    textContent: row.text_content as string | null, parserVersion: String(row.parser_version),
    citationMetadata: JSON.parse(String(row.citation_metadata_json)), metadataRevision: Number(row.metadata_revision),
    sourceUrl: row.source_url as string | null, collectedAt: String(row.collected_at), publishedAt: row.published_at as string | null };
}
