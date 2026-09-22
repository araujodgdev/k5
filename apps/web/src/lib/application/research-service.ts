import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { WorkspaceContext } from './context';
import { findInstallation, listInstallations } from '@/lib/judicial/repositories/installations';
import { searchInputSchema, ResearchError, type CorpusPage, type CorpusQuery, type JudgmentDetail,
  type ResearchMaterialKind, type ResearchMaterialStatus, type ResearchSearchView, type SearchHistoryItem,
  type SearchInput, type SearchPage, type SearchProgress, type ResearchResult } from '@/lib/research/contracts';
import { canUseResearchSource, supportsDirectResearchMaterial } from '@/lib/research/policy';
import { findResearchJudgment, findResearchMaterialVersion, RESEARCH_PAGE_SIZE, searchCorpus,
  toJudgmentSummary } from '@/lib/research/retrieval';
import { cancelPendingResearchDownloads, enqueueResearchJob } from '@/lib/research/jobs';
import { assertResearchStorageRuntime, assertResearchWritableRuntime } from '@/lib/research/runtime';
import { rerankResearchResults } from '@/lib/typesafe/research-rerank';
import type { DecisionTransport } from '@/lib/typesafe/client';

async function authorize(context: WorkspaceContext, write = false): Promise<void> {
  if (context.sessionId) {
    const session = await database.prepare('SELECT "userId" AS user_id,"expiresAt" AS expires_at FROM session WHERE id=?')
      .get<{ user_id: string; expires_at: string }>(context.sessionId);
    if (!session || session.user_id !== context.userId || new Date(session.expires_at).getTime() <= Date.now()) {
      throw new ResearchError('forbidden', 'Sessão encerrada.');
    }
  }
  const membership = await database.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?')
    .get<{ role: string }>(context.officeId,context.userId);
  if (!membership) throw new ResearchError('forbidden', 'Acesso ao escritório removido.');
  if (write && !['administrator','lawyer'].includes(membership.role)) {
    throw new ResearchError('forbidden', 'Seu papel permite apenas consultar o acervo.');
  }
  if (write && context.invocation) throw new ResearchError('forbidden', 'Esta ação exige a interface humana.');
}

type SearchRow = { id: string; office_id: string; user_id: string; theme: string; filters_json: string;
  include_sources: number; status: string; created_at: string };
type PageRow = { id: string; page_number: number; source_cursor: string | null; next_cursor: string | null;
  status: SearchPage['status']; total_reported: number | null; source_error: string | null };
type ResultRow = {
  id: string; position: number; origin: 'local' | 'source'; id_judgment: string;
  installation_id: string; source_judgment_id: string; tribunal: string; court_unit: string | null;
  case_number: string | null; title: string; decision_date: string | null; source_url: string | null;
  status: string; ementa: string | null; ementa_version_id: string | null;
  full_text_status: string | null; full_text_version_id: string | null; permission_documents: string;
  source_kind: string; source_court_code: string;
};

async function findSearch(context: WorkspaceContext, searchId: string): Promise<SearchRow> {
  const search = await database.prepare(`SELECT * FROM research_search WHERE id=? AND office_id=? AND user_id=?`)
    .get<SearchRow>(searchId,context.officeId,context.userId);
  if (!search) throw new ResearchError('not_found', 'Pesquisa não encontrada.');
  return search;
}

async function pageView(context: WorkspaceContext, page: PageRow): Promise<SearchPage> {
  const rows = await database.prepare(`SELECT r.id,r.position,r.origin,j.id AS id_judgment,j.installation_id,
    j.source_judgment_id,j.tribunal,j.court_unit,j.case_number,j.title,j.decision_date,j.source_url,j.status,
    ev.text_content AS ementa,ev.id AS ementa_version_id,fm.status AS full_text_status,
    fm.current_version_id AS full_text_version_id,i.permission_documents,
    i.kind AS source_kind,i.court_code AS source_court_code
    FROM research_search_result r JOIN research_judgment j ON j.id=r.judgment_id
    JOIN judicial_source_installation i ON i.id=j.installation_id
    LEFT JOIN research_material em ON em.judgment_id=j.id AND em.kind='ementa' AND em.status='ready'
    LEFT JOIN research_material_version ev ON ev.id=em.current_version_id AND ev.published_at IS NOT NULL
    LEFT JOIN research_material fm ON fm.judgment_id=j.id AND fm.kind='full_text'
    WHERE r.page_id=? AND r.search_id IN (SELECT id FROM research_search WHERE office_id=? AND user_id=?)
      AND j.status='active' AND i.enabled=1 AND i.auth_kind='none' AND i.permission_query='permitido'
      AND i.permission_cache='permitido' AND i.permission_redistribution='permitido'
    ORDER BY r.position LIMIT ?`).all<ResultRow>(page.id,context.officeId,context.userId,RESEARCH_PAGE_SIZE);
  const results: ResearchResult[] = rows.map((row) => ({ ...toJudgmentSummary({ ...row, id: row.id_judgment }),
    resultId: row.id, position: row.position, origin: row.origin }));
  const progress: SearchProgress = { ready: 0, pending: 0, unavailable: 0, failed: 0, cancelled: 0 };
  const materialJobs = await database.prepare(`SELECT m.judgment_id,j.status FROM research_job j
    JOIN research_material m ON m.id=j.material_id WHERE j.page_id=? AND j.kind='fetch_material'
      AND j.office_id=? AND j.user_id=?`).all<{judgment_id:string;status:string}>(page.id,context.officeId,context.userId);
  for (const result of results) {
    if (result.fullTextStatus === 'ready') progress.ready++;
    else if (result.fullTextStatus === 'unavailable' || result.fullTextStatus === 'restricted') progress.unavailable++;
    else if (result.fullTextStatus === 'failed') progress.failed++;
    else {
      const interests=materialJobs.filter((job)=>job.judgment_id===result.id);
      if (interests.some((job)=>job.status==='queued'||job.status==='running')) progress.pending++;
      else if (interests.some((job)=>job.status==='failed')) progress.failed++;
      else if (interests.some((job)=>job.status==='cancelled')) progress.cancelled++;
      else progress.unavailable++;
    }
  }
  const active = await database.prepare(`SELECT COUNT(*) AS count FROM research_job
    WHERE page_id=? AND office_id=? AND user_id=? AND status IN ('queued','running')`)
    .get<{ count: number }>(page.id,context.officeId,context.userId);
  const terminalFailed = await database.prepare(`SELECT 1 FROM research_job WHERE page_id=? AND kind='search_page'
    AND status='failed' LIMIT 1`).get(page.id);
  const status = active?.count ? (page.status === 'queued' ? 'queued' : 'running')
    : page.status === 'queued' || page.status === 'running' ? terminalFailed ? 'partial' : 'completed' : page.status;
  return { id: page.id, pageNumber: page.page_number, status, results, nextCursor: page.next_cursor,
    totalReported: page.total_reported, sourceError: page.source_error, progress };
}

async function loadSearch(context: WorkspaceContext, search: SearchRow): Promise<ResearchSearchView> {
  const pageRows = await database.prepare(`SELECT * FROM research_search_page WHERE search_id=? ORDER BY page_number`)
    .all<PageRow>(search.id);
  const pages = await Promise.all(pageRows.map((page) => pageView(context,page)));
  const jobs = await database.prepare(`SELECT status,kind FROM research_job WHERE search_id=? AND office_id=? AND user_id=?`)
    .all<{ status: string; kind: string }>(search.id,context.officeId,context.userId);
  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  const failed = jobs.some((job) => job.status === 'failed');
  const status = active ? 'running' : failed || pages.some((page) => page.status === 'partial' || page.status === 'failed') ? 'partial' : 'completed';
  return { id: search.id, theme: search.theme, filters: JSON.parse(search.filters_json), status,
    createdAt: search.created_at, pageCount: pages.length, pages, includeSources: search.include_sources === 1 };
}

async function addLocalPage(context: WorkspaceContext, search: SearchRow, pageNumber: number,
  externalPage: number | null, requestCursor: string | null = null,
  options: {rerankSend?:DecisionTransport} = {}): Promise<PageRow> {
  const existingPage=await database.prepare(`SELECT * FROM research_search_page WHERE search_id=? AND page_number=?`)
    .get<PageRow>(search.id,pageNumber);
  if (existingPage) return existingPage;
  const local = await searchCorpus({ theme: search.theme, filters: JSON.parse(search.filters_json),
    excludeSearchId: search.id,candidateLimit:30 });
  let selected=local.results;
  const sourceRefs=await Promise.all([...new Set(local.results.map((item)=>item.installationId))].map(findInstallation));
  if (selected.length && sourceRefs.every((item)=>item && canUseResearchSource(item,'send_to_ai'))) {
    try {
      const candidates=selected.map((item)=>({id:item.id,text:item.ementa ?? item.title,
        versionFingerprint:item.ementaVersionId ?? item.fullTextVersionId ?? item.sourceJudgmentId,item}));
      const ranked=await rerankResearchResults({officeId:context.officeId,userId:context.userId},search.theme,candidates,
        {signal:AbortSignal.timeout(6_000),send:options.rerankSend});
      selected=ranked.candidates.map((candidate)=>candidate.item);
    } catch { /* A research page remains usable in lexical order when optional AI fails. */ }
  }
  selected=selected.slice(0,RESEARCH_PAGE_SIZE);
  const digest = createHash('sha256').update(`${search.id}:${pageNumber}`).digest('hex');
  const pageId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
  const requestedSourcePage = search.include_sources && externalPage !== null ? String(externalPage) : null;
  const sources = requestedSourcePage !== null ? (await listInstallations({ purpose: 'jurisprudence', enabledOnly: true }))
    .filter((source) => canUseResearchSource(source,'search_source') && (!JSON.parse(search.filters_json).court || JSON.parse(search.filters_json).court===source.courtCode)) : [];
  const external = sources.filter((source) => source.kind==='jurisprudence_api' && source.courtCode==='TJDFT');
  const sourceUnavailable = requestedSourcePage !== null && external.length===0;
  const sourcePage = external.length ? requestedSourcePage : null;
  const hasLocalMore=local.total>selected.length;
  const nextCursor = hasLocalMore || sourcePage !== null
    ? Buffer.from(JSON.stringify({ searchId:search.id,afterPage:pageNumber,local: hasLocalMore ? 'more' : null,
      source: sourcePage !== null ? externalPage! + 1 : null })).toString('base64url')
    : null;
  const statements = [database.prepare(`INSERT OR IGNORE INTO research_search_page
    (id,search_id,page_number,source_cursor,request_cursor,next_cursor,status,source_error) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(pageId,search.id,pageNumber,sourcePage,requestCursor,nextCursor,
      external.length?'queued':sourceUnavailable?'partial':'completed',sourceUnavailable?'no_source_enabled':null)];
  for (let position=0; position<selected.length; position++) {
    const result = selected[position];
    statements.push(database.prepare(`INSERT OR IGNORE INTO research_search_result
      (id,search_id,page_id,judgment_id,position,origin,version_seen_id) VALUES(?,?,?,?,?,'local',?)`)
      .bind(randomUUID(),search.id,pageId,result.id,position,result.ementaVersionId));
    if (result.fullTextStatus === 'pending') {
      const material = await database.prepare(`SELECT m.id,m.status,j.installation_id FROM research_material m
        JOIN research_judgment j ON j.id=m.judgment_id WHERE m.judgment_id=? AND m.kind='full_text'`)
        .get<{id:string;status:string;installation_id:string}>(result.id);
      const installation = material ? await findInstallation(material.installation_id) : null;
      if (material && installation && supportsDirectResearchMaterial(installation) &&
        canUseResearchSource(installation,'fetch_document')) {
        statements.push(database.prepare(`INSERT OR IGNORE INTO research_job
          (id,office_id,user_id,search_id,page_id,installation_id,material_id,kind,request_json,idempotency_key)
          VALUES(?,?,?,?,?,?,?,'fetch_material','{}',?)`)
          .bind(randomUUID(),context.officeId,context.userId,search.id,pageId,installation.id,material.id,
            `fetch:${material.id}:page:${pageId}`));
      }
    }
  }
  for (const source of external) {
    statements.push(database.prepare(`INSERT OR IGNORE INTO research_job
      (id,office_id,user_id,search_id,page_id,installation_id,material_id,kind,request_json,idempotency_key)
      VALUES(?,?,?,?,?,?,NULL,'search_page',?,?)`)
      .bind(randomUUID(),context.officeId,context.userId,search.id,pageId,source.id,
        JSON.stringify({pageNumber:externalPage}),`search:${pageId}:${source.id}`));
  }
  await database.batch(statements);
  const page=await database.prepare(`SELECT * FROM research_search_page WHERE search_id=? AND page_number=?`)
    .get<PageRow>(search.id,pageNumber);
  if (!page) throw new Error('Falha ao criar página.');
  return page;
}

async function queueMaterial(context: WorkspaceContext, searchId: string | null, pageId: string | null,
  judgmentId: string, kind: ResearchMaterialKind, keySuffix: string): Promise<string | null> {
  const row = await database.prepare(`SELECT m.id,m.status,j.installation_id FROM research_material m
    JOIN research_judgment j ON j.id=m.judgment_id WHERE m.judgment_id=? AND m.kind=? AND j.status='active'`)
    .get<{ id: string; status: string; installation_id: string }>(judgmentId,kind);
  if (!row || row.status === 'ready' || row.status === 'restricted') return null;
  const source = await findInstallation(row.installation_id);
  if (!source || !supportsDirectResearchMaterial(source) ||
    !canUseResearchSource(source,kind==='ementa'?'search_source':'fetch_document')) return null;
  return enqueueResearchJob({ officeId:context.officeId,userId:context.userId,searchId,pageId,
    installationId:source.id,materialId:row.id,kind:'fetch_material',idempotencyKey:`fetch:${row.id}:${keySuffix}` });
}

export async function startResearchSearch(context: WorkspaceContext, input: SearchInput,
  options: {rerankSend?:DecisionTransport} = {}): Promise<ResearchSearchView> {
  await assertResearchWritableRuntime();
  await authorize(context,true);
  const parsed = searchInputSchema.parse(input);
  if (parsed.refreshSources && !parsed.includeSources) throw new ResearchError('invalid_input','Atualizar fontes exige consulta externa.');
  const filters = JSON.stringify(parsed.filters);
  if (parsed.idempotencyKey) {
    const existing = await database.prepare(`SELECT * FROM research_search WHERE office_id=? AND user_id=? AND idempotency_key=?`)
      .get<SearchRow>(context.officeId,context.userId,parsed.idempotencyKey);
    if (existing) {
      if (existing.theme !== parsed.theme || existing.filters_json !== filters || existing.include_sources !== (parsed.includeSources?1:0)) {
        throw new ResearchError('invalid_input','Chave de repetição usada com outra pesquisa.');
      }
      const first=await database.prepare('SELECT 1 FROM research_search_page WHERE search_id=? LIMIT 1').get(existing.id);
      if (!first) await addLocalPage(context,existing,0,existing.include_sources?0:null,null,options);
      return loadSearch(context,existing);
    }
  }
  if (!parsed.refreshSources) {
    const recent = await database.prepare(`SELECT * FROM research_search WHERE office_id=? AND user_id=? AND theme=?
      AND filters_json=? AND include_sources=? AND created_at>=datetime('now','-15 minutes') ORDER BY created_at DESC LIMIT 1`)
      .get<SearchRow>(context.officeId,context.userId,parsed.theme,filters,parsed.includeSources?1:0);
    if (recent) {
      const first=await database.prepare('SELECT 1 FROM research_search_page WHERE search_id=? LIMIT 1').get(recent.id);
      if (!first) await addLocalPage(context,recent,0,recent.include_sources?0:null,null,options);
      return loadSearch(context,recent);
    }
  }
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_search
    (id,office_id,user_id,theme,filters_json,include_sources,idempotency_key) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT DO NOTHING`)
    .run(id,context.officeId,context.userId,parsed.theme,filters,parsed.includeSources?1:0,parsed.idempotencyKey ?? null);
  const actual = parsed.idempotencyKey ? await database.prepare(`SELECT id FROM research_search
    WHERE office_id=? AND user_id=? AND idempotency_key=?`).get<{id:string}>(context.officeId,context.userId,parsed.idempotencyKey) : null;
  const search = await findSearch(context,actual?.id ?? id);
  if (search.id !== id) {
    if (search.theme !== parsed.theme || search.filters_json !== filters || search.include_sources !== (parsed.includeSources?1:0)) {
      throw new ResearchError('invalid_input','Chave de repetição usada com outra pesquisa.');
    }
    const first=await database.prepare('SELECT 1 FROM research_search_page WHERE search_id=? LIMIT 1').get(search.id);
    if (!first) await addLocalPage(context,search,0,search.include_sources?0:null,null,options);
    return loadSearch(context,search);
  }
  await addLocalPage(context,search,0,parsed.includeSources ? 0 : null,null,options);
  return loadSearch(context,search);
}

export async function requestResearchPage(context: WorkspaceContext, searchId: string, cursor?: string,
  options: {rerankSend?:DecisionTransport} = {}): Promise<SearchPage> {
  await assertResearchWritableRuntime();
  await authorize(context,true);
  const search = await findSearch(context,searchId);
  if (cursor) {
    const replay=await database.prepare(`SELECT * FROM research_search_page WHERE search_id=? AND request_cursor=?`)
      .get<PageRow>(searchId,cursor);
    if (replay) return pageView(context,replay);
  }
  const pages = await database.prepare(`SELECT * FROM research_search_page WHERE search_id=? ORDER BY page_number DESC LIMIT 1`)
    .get<PageRow>(searchId);
  if (!pages) throw new ResearchError('not_found','Página não encontrada.');
  const token = cursor;
  if (!token) return pageView(context,pages);
  if (cursor !== pages.next_cursor) throw new ResearchError('invalid_input','Cursor fora de sequência.');
  let decoded: { searchId?:string;afterPage?:number;local?: string | null; source?: number | null };
  try { decoded = JSON.parse(Buffer.from(token,'base64url').toString('utf8')); }
  catch { throw new ResearchError('invalid_input','Cursor inválido.'); }
  if (decoded.searchId!==search.id || decoded.afterPage!==pages.page_number ||
      (decoded.source !== null && decoded.source !== undefined && decoded.source !== pages.page_number+1)) {
    throw new ResearchError('invalid_input','Cursor inválido.');
  }
  const next = await addLocalPage(context,search,pages.page_number+1,decoded.source ?? null,cursor,options);
  return pageView(context,next);
}

export async function getResearchSearch(context: WorkspaceContext, searchId: string): Promise<ResearchSearchView> {
  await authorize(context);
  return loadSearch(context,await findSearch(context,searchId));
}
export async function listResearchHistory(context: WorkspaceContext): Promise<SearchHistoryItem[]> {
  await authorize(context);
  const rows = await database.prepare(`SELECT s.id,s.theme,s.filters_json,s.status,s.created_at,COUNT(p.id) AS pages
    FROM research_search s LEFT JOIN research_search_page p ON p.search_id=s.id
    WHERE s.office_id=? AND s.user_id=? GROUP BY s.id ORDER BY s.created_at DESC,s.id DESC LIMIT 100`)
    .all<{ id:string;theme:string;filters_json:string;status:string;created_at:string;pages:number }>(context.officeId,context.userId);
  return rows.map((row) => ({ id:row.id,theme:row.theme,filters:JSON.parse(row.filters_json),status:row.status,
    createdAt:row.created_at,pageCount:row.pages }));
}
export async function searchResearchCorpus(context: WorkspaceContext, input: CorpusQuery): Promise<CorpusPage> {
  await authorize(context);
  return searchCorpus(input);
}
export async function getResearchJudgment(context: WorkspaceContext, judgmentId: string): Promise<JudgmentDetail> {
  await authorize(context);
  const judgment = await findResearchJudgment(judgmentId);
  if (!judgment) throw new ResearchError('not_found','Julgado não encontrado no acervo.');
  return judgment;
}
export async function getResearchMaterialVersion(context: WorkspaceContext, versionId: string) {
  await authorize(context);
  const version = await findResearchMaterialVersion(versionId);
  if (!version) throw new ResearchError('not_found','Versão não encontrada no acervo.');
  return version;
}
export async function getResearchOriginal(context: WorkspaceContext, versionId: string): Promise<{
  bytes: Uint8Array; mimeType: string; sha256: string;
}> {
  const version = await getResearchMaterialVersion(context,versionId);
  if (!version.storageKey) throw new ResearchError('not_found','Original não disponível.');
  await assertResearchStorageRuntime();
  const { getResearchOriginal: readOriginal } = await import('@/lib/research/storage');
  return { bytes: await readOriginal(version.storageKey), mimeType: version.mimeType, sha256: version.sha256 };
}
export async function requestResearchMaterial(context: WorkspaceContext,
  input: { judgmentId: string; kind: ResearchMaterialKind; searchId?: string }): Promise<{ jobId: string | null; status: ResearchMaterialStatus }> {
  await assertResearchWritableRuntime();
  await authorize(context,true);
  if (input.searchId) await findSearch(context,input.searchId);
  const judgment = await findResearchJudgment(input.judgmentId);
  if (!judgment) throw new ResearchError('not_found','Julgado não encontrado.');
  const material = judgment.materials.find((item) => item.kind===input.kind);
  if (!material) throw new ResearchError('not_found','Material não encontrado.');
  if (material.status==='ready' || material.status==='restricted' || material.unavailableReason==='source_import_required')
    return { jobId:null,status:material.status };
  const jobId = await queueMaterial(context,input.searchId ?? null,null,input.judgmentId,input.kind,
    `explicit:${Math.floor(Date.now()/(15*60_000))}`);
  return { jobId,status:material.status };
}
export async function cancelResearchDownloads(context: WorkspaceContext, searchId: string): Promise<{ cancelled: number }> {
  await assertResearchWritableRuntime();
  await authorize(context,true);
  await findSearch(context,searchId);
  return { cancelled:await cancelPendingResearchDownloads(context.officeId,context.userId,searchId) };
}
