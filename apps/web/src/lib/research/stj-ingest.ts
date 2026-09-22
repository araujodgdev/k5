import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { ConnectorError, isRetryable, type InstallationRef } from '@/lib/judicial/contracts';
import { findInstallation } from '@/lib/judicial/repositories/installations';
import { liveTransport, type Transport } from '@/lib/judicial/connectors/transport';
import { upsertSourceJudgment, publishMaterialText } from './catalog';
import { ResearchError } from './contracts';
import { assertResearchLease, completeResearchJob, debitResearchRequest, deferResearchJob, enqueueResearchJob,
  failResearchJob, renewResearchLease, type ResearchJobRow } from './jobs';
import { stageResearchPdf } from './pdf';
import { canUseResearchSource } from './policy';
import { getResearchOriginal, putResearchOriginal } from './storage';
import { isStjRejection, normalizeStjFullTextMetadata, normalizeStjMirror, officialStjUrl, stjCkanResources,
  stjJsonFromResource, stjRows, stjTextEntriesFromZip, STJ_FULL_TEXT_DATASET, STJ_MAX_RESOURCE_BYTES,
  STJ_MIRROR_DATASET, type StjCkanResource, type StjRejection, type StjResourceKind } from './sources/stj';

type Resource = { id: string; installation_id: string; source_resource_id: string; source_url: string;
  resource_kind: StjResourceKind; dataset_slug: string; resource_name: string; source_data_date: string;
  source_updated_at: string | null; etag: string | null; content_sha256: string | null;
  original_storage_key: string | null;
  ingested_revision: string | null; checkpoint: string | null; status: string };
type Checkpoint = { jobId: string; revision: string; storageKey: string | null; sha256: string | null;
  rawSha256: string | null; originalStorageKey: string | null; finalUrl: string | null; nextIndex: number };
type StjRequest = { resourceId: string; revision: string; sourceUrl: string; sourceUpdatedAt: string | null;
  sourceJudgmentId?: string; force?: boolean };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const isKind = (kind: string): kind is StjResourceKind =>
  kind === 'mirror_json' || kind === 'mirror_zip' || kind === 'full_text_json' ||
  kind === 'full_text_zip' || kind === 'full_text_pdf';
const isDocument = (kind: StjResourceKind) => kind.startsWith('full_text');
const isAccord = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === 'ACORDAO';
const checkpoint = (value: string | null): Checkpoint | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Checkpoint;
    return typeof parsed.jobId === 'string' && typeof parsed.revision === 'string' &&
      Number.isSafeInteger(parsed.nextIndex) && parsed.nextIndex >= 0 ? parsed : null;
  } catch { return null; }
};
function stjInstallation(source: InstallationRef | null | undefined): InstallationRef {
  if (!source || source.kind !== 'ckan' || source.courtCode !== 'STJ' || source.authKind !== 'none')
    throw new ResearchError('unsupported', 'Instalação STJ CKAN não encontrada.');
  return source;
}
async function operator(actorEmail: string, officeId?: string): Promise<{ userId: string; officeId: string }> {
  const rows = await database.prepare(`SELECT u.id AS user_id,m.office_id FROM user u
    JOIN platform_admin p ON p.user_id=u.id JOIN office_member m ON m.user_id=u.id
    WHERE lower(u.email)=lower(?) AND m.role='administrator' ORDER BY m.office_id`)
    .all<{ user_id: string; office_id: string }>(actorEmail);
  const permitted = officeId ? rows.filter(row => row.office_id === officeId) : rows;
  if (permitted.length !== 1) throw new ResearchError('forbidden',
    permitted.length ? 'Indique um escritório administrado pelo operador.' : 'Operador não é administrador da plataforma e do escritório.');
  return { userId: permitted[0].user_id, officeId: permitted[0].office_id };
}
async function assertActor(officeId: string, userId: string): Promise<void> {
  const row = await database.prepare(`SELECT m.role FROM platform_admin p JOIN office_member m ON m.user_id=p.user_id
    WHERE p.user_id=? AND m.office_id=?`).get<{ role: string }>(userId, officeId);
  if (row?.role !== 'administrator') throw new ResearchError('forbidden', 'Operador perdeu a administração do escritório ou da plataforma.');
}
function permission(source: InstallationRef, kind: StjResourceKind, action: 'read' | 'store'): void {
  const required = action === 'read' ? (isDocument(kind) ? 'fetch_document' : 'search_source') :
    (isDocument(kind) ? 'store_document' : 'store_public');
  if (!canUseResearchSource(source, required)) throw new ResearchError('source_disabled',
    'Fonte STJ não está liberada para este tipo de recurso.');
}
function resourceRevision(value: StjCkanResource): string {
  return hash(JSON.stringify([value.id,value.url,value.kind,value.sourceUpdatedAt,value.etag,value.sourceDataDate]));
}

/** Read-only CKAN package discovery; permission and budget are checked before network access. */
export async function discoverStjResources(input: { installationId: string; datasetSlug: string;
  actorEmail: string; officeId?: string; transport?: Transport }): Promise<StjCkanResource[]> {
  const source = stjInstallation(await findInstallation(input.installationId));
  if (input.datasetSlug !== STJ_MIRROR_DATASET && input.datasetSlug !== STJ_FULL_TEXT_DATASET)
    throw new ResearchError('invalid_input', 'Conjunto STJ não reconhecido.');
  const kind = input.datasetSlug === STJ_MIRROR_DATASET ? 'mirror_json' : 'full_text_json';
  permission(source, kind, 'read');
  const actor = await operator(input.actorEmail, input.officeId);
  await debitResearchRequest(source, actor.officeId);
  const endpoint = officialStjUrl(`https://dadosabertos.web.stj.jus.br/api/3/action/package_show?id=${encodeURIComponent(input.datasetSlug)}`);
  const response = await (input.transport ?? liveTransport).request(source, endpoint, { maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 });
  if ((input.transport ?? liveTransport).mode === 'live') officialStjUrl(response.url);
  let payload: unknown;
  try { payload = JSON.parse(response.body); }
  catch { throw new ConnectorError('schema_changed', 'Metadados CKAN STJ inválidos.'); }
  return stjCkanResources(payload, input.datasetSlug);
}

/** Enqueues one resource obtained from package_show. Repeating an unchanged resource returns its prior job. */
export async function enqueueStjResource(input: { installationId: string; datasetSlug: string;
  resource: StjCkanResource; actorEmail: string; officeId?: string; force?: boolean }):
  Promise<{ resourceId: string; jobId: string; officeId: string }> {
  const source = stjInstallation(await findInstallation(input.installationId));
  const item = input.resource;
  if ((input.datasetSlug !== STJ_MIRROR_DATASET && input.datasetSlug !== STJ_FULL_TEXT_DATASET) ||
    !isKind(item.kind) || (input.datasetSlug === STJ_MIRROR_DATASET) !== !isDocument(item.kind) ||
    !/^[0-9a-f-]{36}$/i.test(item.id) || !/^\d{8}$/.test(item.sourceDataDate))
    throw new ResearchError('invalid_input', 'Recurso STJ não pertence ao conjunto informado.');
  permission(source, item.kind, 'read');
  const actor = await operator(input.actorEmail, input.officeId);
  const sourceUrl = officialStjUrl(item.url);
  const revision = resourceRevision(item);
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_source_resource
    (id,installation_id,source_resource_id,source_url,resource_kind,dataset_slug,resource_name,
      source_data_date,source_updated_at,etag,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,'candidate') ON CONFLICT(installation_id,source_resource_id) DO UPDATE SET
    source_url=excluded.source_url,resource_kind=excluded.resource_kind,dataset_slug=excluded.dataset_slug,
    resource_name=excluded.resource_name,source_data_date=excluded.source_data_date,
    source_updated_at=excluded.source_updated_at,etag=excluded.etag
    WHERE research_source_resource.status<>'running'`).run(id, source.id, item.id, sourceUrl,
      item.kind, input.datasetSlug, item.name, item.sourceDataDate, item.sourceUpdatedAt, item.etag);
  const resource = await database.prepare(`SELECT * FROM research_source_resource
    WHERE installation_id=? AND source_resource_id=?`).get<Resource>(source.id, item.id);
  if (!resource || resource.source_url !== sourceUrl || resource.resource_kind !== item.kind ||
    resource.dataset_slug !== input.datasetSlug || resource.source_updated_at !== item.sourceUpdatedAt ||
    resource.etag !== item.etag) throw new ResearchError('forbidden', 'Recurso STJ está em uso ou mudou durante o registro.');
  const idempotencyKey = `stj:${hash(`${source.id}:${resource.id}:${revision}:${input.force ? randomUUID() : ''}`)}`;
  const jobId = await enqueueResearchJob({ officeId: actor.officeId, userId: actor.userId, installationId: source.id,
    kind: 'stj_resource', request: { resourceId: resource.id, revision, sourceUrl,
      sourceUpdatedAt: item.sourceUpdatedAt, force: input.force === true } satisfies StjRequest, idempotencyKey });
  const job = await database.prepare('SELECT status FROM research_job WHERE id=?').get<{ status: string }>(jobId);
  if (job?.status === 'queued') await database.prepare("UPDATE research_source_resource SET status='queued',error_code=NULL WHERE id=? AND status<>'running'")
    .run(resource.id);
  return { resourceId: resource.id, jobId, officeId: actor.officeId };
}

/** Operator-reviewed relationship across two official document namespaces. */
export async function linkStjDocument(input: { installationId: string; mirrorId: string; documentId: string;
  evidenceUrl: string; evidenceNote: string; actorEmail: string; officeId?: string }): Promise<void> {
  const source = stjInstallation(await findInstallation(input.installationId));
  permission(source, 'full_text_json', 'store');
  const actor = await operator(input.actorEmail, input.officeId);
  if (!input.mirrorId.trim() || !/^\d{1,30}$/.test(input.documentId) || input.evidenceNote.trim().length < 10)
    throw new ResearchError('invalid_input', 'Identidades ou justificativa de vínculo STJ inválidas.');
  const evidenceUrl = officialStjUrl(input.evidenceUrl);
  const mirror = await database.prepare(`SELECT i.judgment_id,i.document_id,i.registration_number FROM research_stj_mirror_identity i
    JOIN research_judgment j ON j.id=i.judgment_id AND j.status='active'
    WHERE i.installation_id=? AND i.source_judgment_id=?`).get<{
      judgment_id: string; document_id: string | null; registration_number: string | null;
    }>(source.id, input.mirrorId.trim());
  const metadata = await database.prepare(`SELECT document_id,registration_number,document_type
    FROM research_stj_fulltext_identity WHERE installation_id=? AND document_id=?`).get<{
      document_id: string; registration_number: string | null; document_type: string;
    }>(source.id, input.documentId);
  if (!mirror || !metadata || !isAccord(metadata.document_type))
    throw new ResearchError('not_found', 'Espelho ou metadado de acórdão STJ não encontrado.');
  if ((mirror.document_id && mirror.document_id !== metadata.document_id) ||
    (mirror.registration_number && metadata.registration_number &&
      mirror.registration_number !== metadata.registration_number))
    throw new ResearchError('invalid_input', 'Identificadores oficiais do espelho e da íntegra divergem.');
  await database.prepare(`INSERT INTO research_stj_document_link
    (installation_id,judgment_id,document_id,evidence_url,evidence_note,actor_user_id)
    VALUES(?,?,?,?,?,?) ON CONFLICT(installation_id,document_id) DO NOTHING`)
    .run(source.id, mirror.judgment_id, input.documentId, evidenceUrl, input.evidenceNote.trim(), actor.userId);
  const linked = await database.prepare(`SELECT judgment_id FROM research_stj_document_link
    WHERE installation_id=? AND document_id=?`).get<{ judgment_id: string }>(source.id, input.documentId);
  if (linked?.judgment_id !== mirror.judgment_id)
    throw new ResearchError('invalid_input', 'Documento STJ já possui outro vínculo registrado.');
}

async function quarantine(job: ResearchJobRow, item: StjRejection): Promise<void> {
  await database.prepare(`INSERT OR IGNORE INTO research_quarantine
    (id,office_id,user_id,job_id,record_index,reason,payload_sha256,payload_json) VALUES(?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), job.office_id, job.user_id, job.id, item.index, item.reason, item.sha256, item.payloadJson);
}
async function quarantineId(job: ResearchJobRow, index: number, documentId: string, reason: string): Promise<void> {
  const payloadJson = JSON.stringify({ documentId });
  await quarantine(job, { index, reason, sha256: hash(payloadJson), payloadJson });
}
async function progress(resource: Resource, job: ResearchJobRow, workerId: string, state: Checkpoint): Promise<void> {
  await assertResearchLease(job, workerId);
  const result = await database.prepare(`UPDATE research_source_resource SET status='running',checkpoint=?
    WHERE id=? AND json_extract(checkpoint,'$.jobId')=?`).run(JSON.stringify(state), resource.id, job.id);
  if (result.changes !== 1) throw new ResearchError('forbidden', 'Checkpoint STJ assumido por outro job.');
}
async function completeResource(resource: Resource, job: ResearchJobRow, workerId: string,
  rawSha256: string, originalStorageKey: string | null): Promise<void> {
  await assertResearchLease(job, workerId);
  const result = await database.prepare(`UPDATE research_source_resource SET status='completed',checkpoint=NULL,
    error_code=NULL,content_sha256=?,ingested_revision=?,original_storage_key=?,
    last_ingested_at=CURRENT_TIMESTAMP
    WHERE id=? AND json_extract(checkpoint,'$.jobId')=?`).run(rawSha256,
      (JSON.parse(job.request_json) as StjRequest).revision, originalStorageKey, resource.id, job.id);
  if (result.changes !== 1) throw new ResearchError('forbidden', 'Recurso STJ assumido por outro job.');
  await completeResearchJob(job, workerId);
}
async function processRow(source: InstallationRef, resource: Resource, job: ResearchJobRow,
  row: unknown, index: number, url: string): Promise<void> {
  if (resource.resource_kind === 'mirror_json' || resource.resource_kind === 'mirror_zip') {
    const item = normalizeStjMirror(row, index);
    if (isStjRejection(item)) { await quarantine(job, item); return; }
    const prior = await database.prepare(`SELECT source_data_date,source_resource_id FROM research_stj_mirror_identity
      WHERE installation_id=? AND source_judgment_id=?`).get<{
        source_data_date: string; source_resource_id: string;
      }>(source.id, item.judgment.sourceJudgmentId);
    if (prior && (prior.source_data_date > resource.source_data_date ||
      (prior.source_data_date === resource.source_data_date && prior.source_resource_id !== resource.id))) return;
    const judgmentId = await upsertSourceJudgment(source, { ...item.judgment,
      sourceUpdatedAt: resource.source_updated_at, sourceUrl: item.judgment.sourceUrl ?? url });
    await database.prepare(`INSERT INTO research_stj_mirror_identity
      (installation_id,source_judgment_id,judgment_id,document_id,registration_number,source_resource_id,source_data_date)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(installation_id,source_judgment_id) DO UPDATE SET
      document_id=excluded.document_id,registration_number=excluded.registration_number,
      source_resource_id=excluded.source_resource_id,source_data_date=excluded.source_data_date`)
      .run(source.id, item.judgment.sourceJudgmentId, judgmentId, item.documentId,
        item.registrationNumber, resource.id, resource.source_data_date);
    return;
  }
  if (resource.resource_kind === 'full_text_json') {
    const item = normalizeStjFullTextMetadata(row, index);
    if (isStjRejection(item)) { await quarantine(job, item); return; }
    const prior = await database.prepare(`SELECT source_data_date,metadata_resource_id FROM research_stj_fulltext_identity
      WHERE installation_id=? AND document_id=?`).get<{
        source_data_date: string; metadata_resource_id: string;
      }>(source.id, item.documentId);
    if (prior && (prior.source_data_date > resource.source_data_date ||
      (prior.source_data_date === resource.source_data_date && prior.metadata_resource_id !== resource.id))) return;
    await database.prepare(`INSERT INTO research_stj_fulltext_identity
      (installation_id,document_id,registration_number,document_type,publication_date,metadata_resource_id,source_data_date)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(installation_id,document_id) DO UPDATE SET
      registration_number=excluded.registration_number,document_type=excluded.document_type,
      publication_date=excluded.publication_date,metadata_resource_id=excluded.metadata_resource_id,
      source_data_date=excluded.source_data_date`)
      .run(source.id, item.documentId, item.registrationNumber, item.documentType,
        item.publicationDate, resource.id, resource.source_data_date);
    return;
  }
  if (resource.resource_kind === 'full_text_zip') {
    const part = row as { documentId?: string; text?: string };
    if (!part.documentId || !part.text) { await quarantineId(job, index, part.documentId ?? '', 'invalid_zip_text'); return; }
    const target = await database.prepare(`SELECT l.judgment_id,l.last_published_data_date,
      m.document_type,m.source_data_date,m.registration_number,
      i.document_id AS mirror_document_id,i.registration_number AS mirror_registration
      FROM research_stj_fulltext_identity m
      LEFT JOIN research_stj_document_link l ON l.installation_id=m.installation_id AND l.document_id=m.document_id
      LEFT JOIN research_stj_mirror_identity i ON i.judgment_id=l.judgment_id AND i.installation_id=l.installation_id
      WHERE m.installation_id=? AND m.document_id=?`).get<{
        judgment_id: string | null; last_published_data_date: string | null;
        document_type: string; source_data_date: string; registration_number: string | null;
        mirror_document_id: string | null; mirror_registration: string | null;
      }>(source.id, part.documentId);
    if (!target || target.source_data_date !== resource.source_data_date) {
      await quarantineId(job, index, part.documentId, 'metadata_missing'); return;
    }
    if (!isAccord(target.document_type)) return;
    if (!target.judgment_id) { await quarantineId(job, index, part.documentId, 'link_missing'); return; }
    if ((target.mirror_document_id && target.mirror_document_id !== part.documentId) ||
      (target.mirror_registration && target.registration_number &&
        target.mirror_registration !== target.registration_number)) {
      await quarantineId(job, index, part.documentId, 'link_mismatch'); return;
    }
    if (target.last_published_data_date && target.last_published_data_date > resource.source_data_date) return;
    const versionId = await publishMaterialText(source, target.judgment_id, 'full_text', part.text,
      'text/plain', new Date().toISOString(), url);
    if (!versionId) { await quarantineId(job, index, part.documentId, 'invalid_full_text'); return; }
    await database.prepare(`UPDATE research_stj_document_link SET last_published_data_date=?
      WHERE installation_id=? AND document_id=? AND judgment_id=?`)
      .run(resource.source_data_date, source.id, part.documentId, target.judgment_id);
  }
}

/** Called with an already claimed job. It finalizes, defers or fails its own lease. */
export async function processNextStjResource(job: ResearchJobRow, transport: Transport = liveTransport,
  workerId: string): Promise<void> {
  let resource: Resource | null = null;
  try {
    if (job.kind !== 'stj_resource') throw new ResearchError('invalid_input', 'Job não é de recurso STJ.');
    let request: StjRequest;
    try { request = JSON.parse(job.request_json) as StjRequest; }
    catch { throw new ResearchError('invalid_input', 'Solicitação STJ inválida.'); }
    if (!request.resourceId || !request.sourceUrl || !request.revision)
      throw new ResearchError('invalid_input', 'Job STJ sem recurso ou revisão.');
    resource = await database.prepare('SELECT * FROM research_source_resource WHERE id=? AND installation_id=?')
      .get<Resource>(request.resourceId, job.installation_id) ?? null;
    if (!resource || !isKind(resource.resource_kind) || resource.source_url !== request.sourceUrl ||
      resource.source_updated_at !== request.sourceUpdatedAt) throw new ResearchError('invalid_input', 'Recurso STJ mudou após o agendamento.');
    if (resourceRevision({ id: resource.source_resource_id, url: resource.source_url, kind: resource.resource_kind,
      name: resource.resource_name, sourceUpdatedAt: resource.source_updated_at,
      sourceDataDate: resource.source_data_date, etag: resource.etag, declaredSize: null }) !== request.revision)
      throw new ResearchError('invalid_input', 'Revisão CKAN STJ mudou após o agendamento.');
    const source = stjInstallation(await findInstallation(job.installation_id));
    permission(source, resource.resource_kind, 'read');
    await assertActor(job.office_id, job.user_id);
    await assertResearchLease(job, workerId);
    const prior = checkpoint(resource.checkpoint);
    if (prior?.jobId !== job.id && prior) {
      const other = await database.prepare('SELECT status,lease_until FROM research_job WHERE id=?')
        .get<{ status: string; lease_until: number }>(prior.jobId);
      if (other?.status === 'queued' || (other?.status === 'running' && other.lease_until > Date.now())) {
        await deferResearchJob(job, workerId, 'resource_busy', 5_000); return;
      }
    }
    const state: Checkpoint = prior?.jobId === job.id && prior.revision === request.revision ? prior :
      { jobId: job.id, revision: request.revision, storageKey: null, sha256: null, rawSha256: null,
        originalStorageKey: null, finalUrl: null, nextIndex: 0 };
    const reserved = await database.prepare(`UPDATE research_source_resource SET status='running',checkpoint=?
      WHERE id=? AND checkpoint IS ?`).run(JSON.stringify(state), resource.id, resource.checkpoint);
    if (reserved.changes !== 1) { await deferResearchJob(job, workerId, 'resource_busy', 5_000); return; }
    let bytes: Buffer;
    let finalUrl = state.finalUrl ?? resource.source_url;
    if (state.storageKey) {
      bytes = await getResearchOriginal(state.storageKey);
      if (state.sha256 !== hash(bytes)) throw new ResearchError('invalid_input', 'Checkpoint STJ corrompido.');
    } else {
      await debitResearchRequest(source, job.office_id);
      if (!transport.requestBinary) throw new ResearchError('unsupported', 'Transporte binário STJ indisponível.');
      const result = await transport.requestBinary(source, resource.source_url,
        { maxBytes: STJ_MAX_RESOURCE_BYTES, timeoutMs: 30_000 });
      const raw = result.bytes;
      if (raw.length > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'Recurso STJ acima de 50 MB.');
      if (transport.mode === 'live') finalUrl = officialStjUrl(result.url);
      await assertResearchLease(job, workerId);
      await assertActor(job.office_id, job.user_id);
      permission(stjInstallation(await findInstallation(source.id)), resource.resource_kind, 'store');
      state.rawSha256 = hash(raw);
      const rawExtension = resource.resource_kind === 'mirror_zip' || resource.resource_kind === 'full_text_zip'
        ? 'zip' : resource.resource_kind === 'full_text_pdf' ? 'pdf' : 'json';
      state.originalStorageKey = await putResearchOriginal(raw, rawExtension);
      state.finalUrl = finalUrl;
      if (!request.force && resource.content_sha256 === state.rawSha256) {
        await completeResource(resource, job, workerId, state.rawSha256, state.originalStorageKey); return;
      }
      if (resource.resource_kind === 'full_text_pdf') {
        if (!request.sourceJudgmentId) throw new ResearchError('invalid_input', 'PDF sem identidade do julgado.');
        const judgment = await database.prepare(`SELECT id FROM research_judgment
          WHERE installation_id=? AND source_judgment_id=? AND status='active'`)
          .get<{ id: string }>(source.id, request.sourceJudgmentId);
        if (!judgment) throw new ResearchError('not_found', 'Espelho do julgado STJ ainda não foi importado.');
        const versionId = await stageResearchPdf(source, judgment.id, raw, finalUrl);
        const material = await database.prepare('SELECT material_id FROM research_material_version WHERE id=?')
          .get<{ material_id: string }>(versionId);
        if (!material) throw new ResearchError('not_found', 'PDF preparado sem material.');
        await enqueueResearchJob({ officeId: job.office_id, userId: job.user_id, installationId: source.id,
          materialId: material.material_id, kind: 'extract_material', request: { versionId },
          idempotencyKey: `stj-extract:${versionId}` });
        await completeResource(resource, job, workerId, state.rawSha256, state.originalStorageKey); return;
      }
      bytes = resource.resource_kind === 'full_text_zip' ?
        Buffer.from(JSON.stringify(stjTextEntriesFromZip(raw))) : stjJsonFromResource(raw, resource.resource_kind);
      if (bytes.length > STJ_MAX_RESOURCE_BYTES) throw new ConnectorError('partial', 'Recurso STJ expandido acima de 50 MB.');
      state.storageKey = await putResearchOriginal(bytes, 'json');
      state.sha256 = hash(bytes);
      await progress(resource, job, workerId, state);
    }
    let rows: unknown[];
    try { rows = stjRows(JSON.parse(bytes.toString('utf8'))); }
    catch { throw new ConnectorError('schema_changed', 'JSON do recurso STJ inválido.'); }
    if (state.nextIndex > rows.length) throw new ResearchError('invalid_input', 'Checkpoint do STJ fora do recurso.');
    const end = Math.min(rows.length, state.nextIndex + 250);
    for (let index = state.nextIndex; index < end; index++) {
      if (index % 25 === 0) {
        if (!await renewResearchLease(job, workerId)) throw new ResearchError('forbidden', 'Lease de ingestão STJ expirado.');
        await assertActor(job.office_id, job.user_id);
        permission(stjInstallation(await findInstallation(source.id)), resource.resource_kind, 'store');
      }
      await processRow(source, resource, job, rows[index], index, finalUrl);
    }
    state.nextIndex = end;
    await progress(resource, job, workerId, state);
    if (end < rows.length) { await deferResearchJob(job, workerId, 'checkpoint', 1_000); return; }
    if (!state.rawSha256 || !state.originalStorageKey)
      throw new ResearchError('invalid_input', 'Checkpoint STJ sem origem preservada.');
    await completeResource(resource, job, workerId, state.rawSha256, state.originalStorageKey);
  } catch (error) {
    const current = await database.prepare('SELECT status,lease_owner FROM research_job WHERE id=?')
      .get<{ status: string; lease_owner: string | null }>(job.id);
    if (current?.status !== 'running' || current.lease_owner !== workerId) return;
    if (error instanceof ResearchError && error.code === 'budget_exceeded') {
      await deferResearchJob(job, workerId, 'budget_exceeded', 60_000); return;
    }
    const code = error instanceof ConnectorError || error instanceof ResearchError ? error.code : 'ingestion_failed';
    const retryable = error instanceof ConnectorError && isRetryable(error.code);
    await failResearchJob(job, workerId, code, retryable,
      error instanceof ConnectorError ? (error.retryAfterSeconds ?? 0) * 1000 : undefined);
    if (resource) await database.prepare(`UPDATE research_source_resource SET status=?,error_code=? WHERE id=?`)
      .run(code === 'source_disabled' || code === 'forbidden' ? 'restricted' : retryable && job.attempts < 5 ? 'queued' : 'failed',
        code, resource.id);
  }
}
