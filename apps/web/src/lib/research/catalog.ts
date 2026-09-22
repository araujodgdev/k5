import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { InstallationRef } from '@/lib/judicial/contracts';
import { ResearchError, type ResearchMaterialKind } from './contracts';
import { canUseResearchSource } from './policy';
import { findInstallation } from '@/lib/judicial/repositories/installations';
import type { SourceJudgment } from './sources/tjdft';

type JudgmentRow = { id: string; metadata_revision: number; status: string };
type MaterialRow = { id: string; current_version_id: string | null; status: string };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const clean = (value: string | null | undefined) => value?.trim() || null;

export function citationMetadata(record: SourceJudgment) {
  return { tribunal: record.tribunal, courtUnit: record.courtUnit, caseNumber: record.caseNumber, title: record.title,
    decisionDate: record.decisionDate, sourceUrl: record.sourceUrl };
}

/** No query, user, office, case or free-form source payload is written to these shared tables. */
export async function upsertSourceJudgment(installation: InstallationRef, record: SourceJudgment, collectedAt = new Date().toISOString()): Promise<string> {
  const currentSource = await findInstallation(installation.id);
  if (!currentSource || !canUseResearchSource(currentSource, 'store_public'))
    throw new ResearchError('source_disabled', 'A fonte não está admitida no acervo compartilhado.');
  if (!record.sourceJudgmentId.trim() || record.tribunal !== currentSource.courtCode) throw new ResearchError('invalid_input', 'Identidade judicial inválida.');
  const metadata = {
    tribunal: record.tribunal, courtUnit: clean(record.courtUnit), caseNumber: clean(record.caseNumber),
    className: clean(record.className), rapporteur: clean(record.rapporteur), title: record.title.trim(),
    decisionDate: clean(record.decisionDate), sourceUrl: clean(record.sourceUrl), sourceUpdatedAt: clean(record.sourceUpdatedAt),
  };
  const metadataHash = hash(JSON.stringify(metadata));
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_judgment
    (id,installation_id,source_judgment_id,tribunal,court_unit,case_number,class_name,rapporteur,title,decision_date,source_url,source_updated_at,metadata_hash,status,collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)
    ON CONFLICT(installation_id,source_judgment_id) DO UPDATE SET
      tribunal=excluded.tribunal,court_unit=excluded.court_unit,case_number=excluded.case_number,
      class_name=excluded.class_name,rapporteur=excluded.rapporteur,title=excluded.title,
      decision_date=excluded.decision_date,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
      metadata_revision=research_judgment.metadata_revision + CASE WHEN research_judgment.metadata_hash <> excluded.metadata_hash THEN 1 ELSE 0 END,
      metadata_hash=excluded.metadata_hash,collected_at=excluded.collected_at,updated_at=CURRENT_TIMESTAMP`
  ).run(id, installation.id, record.sourceJudgmentId, metadata.tribunal, metadata.courtUnit, metadata.caseNumber,
    metadata.className, metadata.rapporteur, metadata.title, metadata.decisionDate, metadata.sourceUrl,
    metadata.sourceUpdatedAt, metadataHash, collectedAt);
  const judgment = await database.prepare('SELECT id,metadata_revision,status FROM research_judgment WHERE installation_id=? AND source_judgment_id=?')
    .get<JudgmentRow>(installation.id, record.sourceJudgmentId);
  if (!judgment) throw new Error('Falha ao persistir julgado.');

  await ensureMaterial(judgment.id, 'ementa', record.ementa ? 'pending' : 'unavailable', null);
  await ensureMaterial(judgment.id, 'full_text', canUseResearchSource(currentSource, 'store_document') ? record.fullTextStatus : 'restricted', record.sourceJudgmentId);
  if (record.ementa) await publishMaterialText(currentSource, judgment.id, 'ementa', record.ementa, 'text/plain', collectedAt, record.sourceUrl);
  if (record.fullText && canUseResearchSource(currentSource, 'store_document')) {
    await publishMaterialText(currentSource, judgment.id, 'full_text', record.fullText, 'text/plain', collectedAt, record.sourceUrl);
  }
  return judgment.id;
}

export async function ensureMaterial(judgmentId: string, kind: ResearchMaterialKind, availability: 'pending' | 'ready' | 'unavailable' | 'restricted', locator: string | null): Promise<string> {
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_material(id,judgment_id,kind,status,source_locator)
    VALUES(?,?,?,?,?) ON CONFLICT(judgment_id,kind) DO UPDATE SET
      status=CASE WHEN research_material.current_version_id IS NOT NULL THEN research_material.status
                  WHEN research_material.status IN ('fetching','processing') THEN research_material.status
                  ELSE excluded.status END,
      source_locator=COALESCE(excluded.source_locator,research_material.source_locator),updated_at=CURRENT_TIMESTAMP`
  ).run(id, judgmentId, kind, availability === 'ready' ? 'pending' : availability, locator);
  const row = await database.prepare('SELECT id FROM research_material WHERE judgment_id=? AND kind=?').get<{ id: string }>(judgmentId, kind);
  if (!row) throw new Error('Falha ao persistir material.');
  return row.id;
}

function chunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += 1800) output.push(paragraph.slice(offset, offset + 1800));
  }
  return output.length ? output : [text.slice(0, 1800)];
}

export async function publishMaterialText(
  installation: InstallationRef, judgmentId: string, kind: ResearchMaterialKind, text: string,
  mimeType: string, collectedAt = new Date().toISOString(), sourceUrl: string | null = null,
): Promise<string | null> {
  if (!canUseResearchSource(installation, kind === 'full_text' ? 'store_document' : 'store_public')) {
    throw new ResearchError('source_disabled', 'A fonte não permite publicar este material.');
  }
  const content = text.trim();
  if (!content || /^inteiro\s+teor\s+indispon[ií]vel\.?$/i.test(content) || /^(faça login|acesso restrito|autentique-se)/i.test(content)) return null;
  const materialId = await ensureMaterial(judgmentId, kind, 'pending', null);
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > 50 * 1024 * 1024) throw new ResearchError('invalid_input', 'Material acima de 50 MB.');
  const { putResearchOriginal } = await import('./storage');
  const storageKey = await putResearchOriginal(bytes, 'txt');
  const currentSource = await findInstallation(installation.id);
  if (!currentSource || !canUseResearchSource(currentSource, kind === 'full_text' ? 'store_document' : 'store_public')) {
    throw new ResearchError('source_disabled', 'A fonte deixou de permitir este material.');
  }
  const judgment = await database.prepare(`SELECT tribunal,court_unit,case_number,title,decision_date,source_url,source_updated_at,metadata_revision
    FROM research_judgment WHERE id=? AND installation_id=? AND status='active'`).get<{
      tribunal: string; court_unit: string | null; case_number: string | null; title: string; decision_date: string | null;
      source_url: string | null; source_updated_at: string | null; metadata_revision: number;
    }>(judgmentId, installation.id);
  if (!judgment) throw new ResearchError('not_found', 'Julgado não encontrado.');
  const citation = { tribunal: judgment.tribunal, courtUnit: judgment.court_unit, caseNumber: judgment.case_number,
    title: judgment.title, decisionDate: judgment.decision_date, sourceUrl: judgment.source_url };
  const versionId = randomUUID();
  await database.prepare(`INSERT INTO research_material_version
    (id,material_id,sha256,mime_type,byte_size,storage_key,text_content,parser_version,citation_metadata_json,metadata_revision,source_url,source_updated_at,collected_at,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(material_id,sha256,parser_version,metadata_revision) DO NOTHING`
  ).run(versionId, materialId, hash(bytes), mimeType, bytes.length, storageKey, content, 'research-text-v1',
    JSON.stringify(citation), judgment.metadata_revision, sourceUrl, judgment.source_updated_at, collectedAt);
  const version = await database.prepare(`SELECT id FROM research_material_version
    WHERE material_id=? AND sha256=? AND parser_version='research-text-v1' AND metadata_revision=?`
  ).get<{ id: string }>(materialId, hash(bytes), judgment.metadata_revision);
  if (!version) throw new Error('Falha ao persistir versão do material.');
  const statements = [
    database.prepare(`UPDATE research_material SET current_version_id=?,status='ready',unavailable_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(version.id, materialId),
    database.prepare(`DELETE FROM research_fts WHERE material_version_id IN
      (SELECT id FROM research_material_version WHERE material_id=? AND id<>?)`).bind(materialId, version.id),
  ];
  const segments = chunks(content);
  for (let ordinal = 0; ordinal < segments.length; ordinal++) {
    const reference = `${kind}:${ordinal + 1}`;
    const deterministic = hash(`${version.id}:${ordinal}`);
    const chunkId = `${deterministic.slice(0, 8)}-${deterministic.slice(8, 12)}-${deterministic.slice(12, 16)}-${deterministic.slice(16, 20)}-${deterministic.slice(20, 32)}`;
    statements.push(database.prepare(`INSERT OR IGNORE INTO research_chunk(id,material_version_id,ordinal,text_content,reference)
      VALUES(?,?,?,?,?)`).bind(chunkId, version.id, ordinal, segments[ordinal], reference));
    statements.push(database.prepare(`INSERT INTO research_fts(judgment_id,material_version_id,text_content)
      SELECT ?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM research_fts WHERE material_version_id=? AND text_content=?)`)
      .bind(judgmentId, version.id, segments[ordinal], version.id, segments[ordinal]));
  }
  await database.batch(statements);
  return version.id;
}

export async function materialByJudgment(judgmentId: string, kind: ResearchMaterialKind): Promise<MaterialRow | undefined> {
  return database.prepare('SELECT id,current_version_id,status FROM research_material WHERE judgment_id=? AND kind=?')
    .get<MaterialRow>(judgmentId, kind);
}
