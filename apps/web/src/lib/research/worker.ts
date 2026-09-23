import { captureOperationalError } from '@/lib/observability/report';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { ConnectorError, isRetryable } from '@/lib/judicial/contracts';
import { findInstallation } from '@/lib/judicial/repositories/installations';
import { liveTransport, type Transport } from '@/lib/judicial/connectors/transport';
import { upsertSourceJudgment, materialByJudgment, publishMaterialText } from './catalog';
import { ResearchError, type SearchFilters } from './contracts';
import { canUseResearchSource, supportsDirectResearchMaterial } from './policy';
import { RESEARCH_PAGE_SIZE } from './retrieval';
import { searchTjdft, fetchTjdftMaterial, getTjdftJudgment } from './sources/tjdft';
import { processNextStjResource } from './stj-ingest';
import { assertResearchLease, claimResearchJob, claimResearchMaterial, completeResearchJob, debitResearchRequest,
  deferResearchJob, enqueueResearchJob, failResearchJob, releaseResearchMaterial, renewResearchLease, type ResearchJobRow } from './jobs';

const processWorkerId = `research-${randomUUID()}`;

async function stillAuthorized(job: ResearchJobRow): Promise<boolean> {
  const member = await database.prepare(`SELECT role FROM office_member WHERE office_id=? AND user_id=?`)
    .get<{ role: string }>(job.office_id,job.user_id);
  return member?.role === 'administrator' || member?.role === 'lawyer';
}
function filterSourceRecord(record: { tribunal:string;decisionDate:string|null }, filters: SearchFilters): boolean {
  if (filters.court && filters.court !== record.tribunal) return false;
  if (filters.fromDate && (!record.decisionDate || record.decisionDate<filters.fromDate)) return false;
  if (filters.toDate && (!record.decisionDate || record.decisionDate>filters.toDate)) return false;
  return true;
}
function nextCursor(previous: string | null, sourceNext: string | null): string | null {
  if (!previous) return sourceNext ? Buffer.from(JSON.stringify({ local:null,source:Number(sourceNext) })).toString('base64url') : null;
  let value: { local?:string|null;source?:number|null };
  try { value=JSON.parse(Buffer.from(previous,'base64url').toString('utf8')); } catch { return null; }
  value.source=sourceNext===null ? null : Number(sourceNext);
  return value.local || value.source !== null ? Buffer.from(JSON.stringify(value)).toString('base64url') : null;
}

async function processSearchPage(job: ResearchJobRow, transport: Transport, workerId: string): Promise<void> {
  if (!job.search_id || !job.page_id) throw new ResearchError('invalid_input','Job sem página.');
  const search = await database.prepare(`SELECT theme,filters_json FROM research_search
    WHERE id=? AND office_id=? AND user_id=?`).get<{theme:string;filters_json:string}>(job.search_id,job.office_id,job.user_id);
  if (!search) throw new ResearchError('not_found','Pesquisa privada não encontrada.');
  const page = await database.prepare(`SELECT source_cursor,next_cursor FROM research_search_page WHERE id=? AND search_id=?`)
    .get<{source_cursor:string|null;next_cursor:string|null}>(job.page_id,job.search_id);
  if (!page || page.source_cursor===null) throw new ResearchError('not_found','Página não encontrada.');
  const source = await findInstallation(job.installation_id);
  if (!source || !canUseResearchSource(source,'search_source')) throw new ResearchError('source_disabled','Fonte não habilitada.');
  if (source.kind !== 'jurisprudence_api' || source.courtCode !== 'TJDFT') throw new ResearchError('unsupported','Busca temática indisponível nesta fonte.');
  await debitResearchRequest(source,job.office_id);
  const sourcePage = await searchTjdft(source,{theme:search.theme,pageNumber:Number(page.source_cursor),pageSize:RESEARCH_PAGE_SIZE},transport);
  await assertResearchLease(job,workerId);
  const currentSource = await findInstallation(source.id);
  if (!await stillAuthorized(job) || !currentSource || !canUseResearchSource(currentSource,'store_public')) {
    throw new ResearchError('forbidden','Autorização da pesquisa revogada durante a consulta.');
  }
  for (const rejection of sourcePage.rejections) {
    await database.prepare(`INSERT INTO research_quarantine
      (id,office_id,user_id,job_id,record_index,reason,payload_sha256,payload_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
      .run(randomUUID(),job.office_id,job.user_id,job.id,rejection.index,rejection.reason,rejection.sha256,rejection.payloadJson);
  }
  const filters = JSON.parse(search.filters_json) as SearchFilters;
  const ids: string[] = [];
  for (const record of sourcePage.records) {
    if (!await renewResearchLease(job,workerId) || !await stillAuthorized(job)) {
      throw new ResearchError('forbidden','Lease ou autorização da pesquisa revogada.');
    }
    // The whole returned page is indexed, even if a post-source filter excludes it from presentation.
    const id = await upsertSourceJudgment(source,record,sourcePage.collectedAt);
    if (filterSourceRecord(record,filters)) ids.push(id);
  }
  const existing = await database.prepare(`SELECT judgment_id,page_id,position FROM research_search_result WHERE search_id=?`)
    .all<{judgment_id:string;page_id:string;position:number}>(job.search_id);
  const seen = new Set(existing.map((row) => row.judgment_id));
  let position = existing.filter((row)=>row.page_id===job.page_id).length;
  for (const id of ids) {
    if (position>=RESEARCH_PAGE_SIZE) break;
    if (seen.has(id)) continue;
    const ementa = await materialByJudgment(id,'ementa');
    const added = await database.prepare(`INSERT INTO research_search_result
      (id,search_id,page_id,judgment_id,position,origin,version_seen_id) VALUES(?,?,?,?,?,'source',?) ON CONFLICT DO NOTHING`)
      .run(randomUUID(),job.search_id,job.page_id,id,position,ementa?.current_version_id ?? null);
    if (added.changes===1) {
      seen.add(id);
      position++;
    }
  }
  // A worker can die after committing a result but before enqueuing its material. Reconcile the
  // entire delivered page on every replay; the job key makes already queued interests idempotent.
  const pending=await database.prepare(`SELECT m.id AS material_id,j.installation_id
    FROM research_search_result r JOIN research_material m ON m.judgment_id=r.judgment_id AND m.kind='full_text'
    JOIN research_judgment j ON j.id=r.judgment_id
    WHERE r.page_id=? AND r.search_id=? AND m.status='pending' AND m.current_version_id IS NULL`)
    .all<{material_id:string;installation_id:string}>(job.page_id,job.search_id);
  for (const material of pending) {
    await assertResearchLease(job,workerId);
    if (!await stillAuthorized(job)) throw new ResearchError('forbidden','Solicitante perdeu acesso.');
    const currentSource=await findInstallation(material.installation_id);
    if (!currentSource || !supportsDirectResearchMaterial(currentSource) ||
      !canUseResearchSource(currentSource,'fetch_document')) continue;
    await enqueueResearchJob({officeId:job.office_id,userId:job.user_id,searchId:job.search_id,pageId:job.page_id,
      installationId:material.installation_id,materialId:material.material_id,kind:'fetch_material',
      idempotencyKey:`fetch:${material.material_id}:page:${job.page_id}`});
  }
  const derivedCursor=nextCursor(page.next_cursor,sourcePage.nextCursor);
  await assertResearchLease(job,workerId);
  await database.prepare(`UPDATE research_search_page SET status=?,total_reported=?,next_cursor=?,source_error=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(sourcePage.rejected ? 'partial':'completed',
      filters.fromDate || filters.toDate ? null : sourcePage.totalReported,derivedCursor,
      sourcePage.rejected ? 'source_records_quarantined':null,job.page_id);
}

async function processFetchMaterial(job: ResearchJobRow, transport: Transport, workerId: string): Promise<'done'|'deferred'> {
  if (!job.material_id) throw new ResearchError('invalid_input','Job sem material.');
  const material = await database.prepare(`SELECT m.id,m.kind,m.status,m.current_version_id,j.id AS judgment_id,
    j.source_judgment_id,j.installation_id FROM research_material m
    JOIN research_judgment j ON j.id=m.judgment_id WHERE m.id=?`)
    .get<{id:string;kind:string;status:string;current_version_id:string|null;judgment_id:string;
      source_judgment_id:string;installation_id:string}>(job.material_id);
  if (!material) throw new ResearchError('not_found','Material não encontrado.');
  if (material.current_version_id || material.status==='restricted') return 'done';
  const source=await findInstallation(material.installation_id);
  if (!source || !supportsDirectResearchMaterial(source) ||
    !canUseResearchSource(source,material.kind==='ementa'?'search_source':'fetch_document')) {
    throw new ResearchError('source_disabled','Fonte não permite obter este material.');
  }
  if (!await claimResearchMaterial(material.id,source.id,workerId)) {
    await deferResearchJob(job,workerId,'material_claimed',5_000);
    return 'deferred';
  }
  try {
    const latest=await materialByJudgment(material.judgment_id,material.kind as 'ementa'|'full_text');
    if (latest?.current_version_id) return 'done';
    if (source.kind !== 'jurisprudence_api' || source.courtCode !== 'TJDFT') throw new ResearchError('unsupported','Obtenção direta indisponível.');
    await debitResearchRequest(source,job.office_id);
    const result=material.kind==='ementa'
      ? await getTjdftJudgment(source,material.source_judgment_id,transport).then((judgment)=>({
          status: judgment?.ementa ? 'ready' as const : 'unavailable' as const,text:judgment?.ementa ?? null,
        }))
      : await fetchTjdftMaterial(source,material.source_judgment_id,transport);
    await assertResearchLease(job,workerId);
    const currentSource = await findInstallation(source.id);
    if (!await stillAuthorized(job) || !currentSource ||
      !canUseResearchSource(currentSource,material.kind==='ementa'?'store_public':'store_document')) {
      throw new ResearchError('forbidden','Autorização do material revogada durante a consulta.');
    }
    if (result.status==='ready' && result.text) {
      await publishMaterialText(source,material.judgment_id,material.kind as 'ementa'|'full_text',result.text,'text/plain');
    } else {
      await database.prepare(`UPDATE research_material SET status='unavailable',unavailable_reason='source_unavailable',
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_version_id IS NULL`).run(material.id);
    }
    return 'done';
  } finally {
    await releaseResearchMaterial(material.id,workerId);
  }
}

export async function processNextResearchExternalJob(options: { transport?:Transport; workerId?:string } = {}): Promise<{jobId:string;status:string}|null> {
  const workerId=options.workerId ?? processWorkerId;
  const job=await claimResearchJob(workerId,['search_page','fetch_material','stj_resource']);
  if (!job) return null;
  try {
    if (!await stillAuthorized(job)) throw new ResearchError('forbidden','Solicitante não tem mais permissão.');
    if (job.kind==='search_page') await processSearchPage(job,options.transport ?? liveTransport,workerId);
    else if (job.kind==='fetch_material') {
      const outcome=await processFetchMaterial(job,options.transport ?? liveTransport,workerId);
      if (outcome==='deferred') return {jobId:job.id,status:'deferred'};
    } else if (job.kind==='stj_resource') {
      await processNextStjResource(job,options.transport ?? liveTransport,workerId);
      const state=await database.prepare('SELECT status FROM research_job WHERE id=?').get<{status:string}>(job.id);
      return {jobId:job.id,status:state?.status ?? 'stale'};
    }
    await completeResearchJob(job,workerId);
    const state=await database.prepare('SELECT status FROM research_job WHERE id=?').get<{status:string}>(job.id);
    return {jobId:job.id,status:state?.status==='completed' ? 'completed' : 'stale'};
  } catch (error) {
    const current=await database.prepare('SELECT status,lease_owner,lease_until FROM research_job WHERE id=?')
      .get<{status:string;lease_owner:string|null;lease_until:number}>(job.id);
    if (!current || current.status!=='running' || current.lease_owner!==workerId || current.lease_until<=Date.now()) {
      return {jobId:job.id,status:'stale'};
    }
    if (error instanceof ResearchError && error.code==='budget_exceeded') {
      await deferResearchJob(job,workerId,'budget_exceeded',60_000);
      if (job.kind==='search_page' && job.page_id) await database.prepare(`UPDATE research_search_page
        SET status='queued',source_error='budget_exceeded',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(job.page_id);
      return {jobId:job.id,status:'deferred'};
    }
    captureOperationalError(error,'research.external');
    const code=error instanceof ConnectorError ? error.code : error instanceof ResearchError ? error.code : 'unexpected';
    const retryable=error instanceof ConnectorError ? isRetryable(error.code) : error instanceof ResearchError && error.code==='budget_exceeded';
    await failResearchJob(job,workerId,code,retryable,error instanceof ConnectorError ? (error.retryAfterSeconds ?? 0)*1000 : undefined);
    if (job.kind==='fetch_material' && job.material_id && (!retryable || job.attempts>=5)) {
      const other=await database.prepare(`SELECT 1 FROM research_job WHERE material_id=? AND id<>?
        AND status IN ('queued','running') LIMIT 1`).get(job.material_id,job.id);
      if (!other) await database.prepare(`UPDATE research_material SET status='failed',unavailable_reason=?,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_version_id IS NULL`).run(code,job.material_id);
    }
    if (job.kind==='search_page' && job.page_id) {
      await database.prepare(`UPDATE research_search_page SET status=?,source_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(retryable && job.attempts<5 ? 'queued' : 'partial',code,job.page_id);
    }
    return {jobId:job.id,status:retryable && job.attempts<5 ? 'queued' : 'failed'};
  }
}
