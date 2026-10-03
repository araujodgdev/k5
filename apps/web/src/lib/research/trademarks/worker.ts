import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import { objectStorage, storageKey } from '@/lib/storage';
import { captureOperationalError } from '@/lib/observability/report';
import { trademarkSearchInput, storedTrademarkSearchInput, trademarkSummary, safeSourceUrl, wipoRecordUrl, TrademarkError } from './contracts';
import { imageMime } from './service';
import type { WipoBrowser } from './wipo';
import { CapabilityError } from '@/lib/capabilities/errors';

const taskBase = z.object({ id: z.string(), search_id: z.string(), lease_owner: z.string(), attempts: z.number() });
const taskSchema = z.discriminatedUnion('kind', [
  taskBase.extend({ kind: z.literal('page'), page_number: z.number().int().nonnegative() }),
  taskBase.extend({ kind: z.literal('detail'), result_id: z.string() }),
]);
type Task = z.infer<typeof taskSchema>;
const runSchema = z.object({
  id: z.string(), office_id: z.string(), user_id: z.string(), session_id: z.string().nullable(),
  input_json: z.preprocess(value => typeof value === 'string' ? JSON.parse(value) : value, storedTrademarkSearchInput.omit({ idempotencyKey: true })),
});
type Run = z.infer<typeof runSchema>;
type Stage = 'authorization' | 'browser' | 'upload' | 'search' | 'representations' | 'detail' | 'publish';
const errorNames = new Set(['Error', 'TimeoutError', 'ProtocolError', 'TargetCloseError', 'TypeError', 'ReferenceError', 'ZodError', 'CapabilityError', 'StorageError']);

async function authorized(run: Run) {
  return Boolean(await database.prepare(`SELECT 1 FROM office_member m WHERE m.office_id=? AND m.user_id=?
    AND (?::text IS NULL OR EXISTS
    (SELECT 1 FROM session s WHERE s.id=? AND s.userId=? AND s.expiresAt>CURRENT_TIMESTAMP))`)
    .get(run.office_id, run.user_id, run.session_id, run.session_id, run.user_id));
}

async function claim(searchId: string): Promise<Task | null> {
  return withTransaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('trademark-browser-slots'))").get();
    const exhausted = await tx.prepare(`UPDATE research_trademark_task SET state='failed',error='A execução não respondeu após três tentativas',lease_owner=NULL,lease_until=NULL
      WHERE search_id=? AND state='running' AND lease_until<CURRENT_TIMESTAMP AND attempts>=3 RETURNING kind,result_id`).all<{ kind: string; result_id: string | null }>(searchId);
    for (const task of exhausted) {
      if (task.kind === 'detail') await tx.prepare(`UPDATE research_trademark_result SET detail_state='failed',detail_error='A consulta de detalhes não respondeu. Tente novamente.' WHERE id=?`).run(task.result_id);
      else await tx.prepare(`UPDATE research_trademark_search SET state=CASE WHEN EXISTS(SELECT 1 FROM research_trademark_result WHERE search_id=?) THEN 'partial' ELSE 'failed' END,
        step='Consulta interrompida',error='A consulta não respondeu após três tentativas. Tente novamente.' WHERE id=? AND state<>'cancelled'`).run(searchId, searchId);
    }
    const slots = await tx.prepare(`SELECT count(*)::int AS count FROM research_trademark_task WHERE state='running' AND lease_until>CURRENT_TIMESTAMP`).get<{ count: number }>();
    if ((slots?.count ?? 0) >= 4) return null;
    const row = await tx.prepare(`UPDATE research_trademark_task SET state='running',attempts=attempts+1,lease_owner=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds'
      WHERE id=(SELECT t.id FROM research_trademark_task t JOIN research_trademark_search s ON s.id=t.search_id
        WHERE t.search_id=? AND s.state<>'cancelled' AND t.attempts<3 AND
        ((t.state='queued' AND t.run_after<=CURRENT_TIMESTAMP) OR (t.state='running' AND t.lease_until<CURRENT_TIMESTAMP))
        ORDER BY CASE t.kind WHEN 'page' THEN 0 ELSE 1 END,t.created_at,t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED) RETURNING *`)
      .get(randomUUID(), searchId);
    return row ? taskSchema.parse(row) : null;
  });
}

async function guard(task: Task, run: Run) {
  const live = await database.prepare(`SELECT 1 FROM research_trademark_task t JOIN research_trademark_search s ON s.id=t.search_id
    WHERE t.id=? AND t.state='running' AND t.lease_owner=? AND t.lease_until>CURRENT_TIMESTAMP AND s.state<>'cancelled'`)
    .get(task.id, task.lease_owner);
  if (!live || !await authorized(run)) throw new TrademarkError('forbidden', 'A pesquisa foi cancelada ou seu acesso foi encerrado.');
}

async function saveRepresentation(run: Run, id: string, value: string | null) {
  if (!value) return { url: null, key: null, mime: null };
  if (!value.startsWith('data:')) {
    const url = safeSourceUrl(value);
    if (!url || !/(^|\.)wipo\.int$/.test(new URL(url).hostname)) return { url: null, key: null, mime: null };
    return { url, key: null, mime: null };
  }
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[1].length > 350_000) return { url: null, key: null, mime: null };
  const data = Buffer.from(match[1], 'base64');
  const mime = imageMime(data);
  const key = storageKey(run.office_id, id, mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp');
  await (await objectStorage()).put(key, data);
  return { url: `/api/research/trademarks/results/${id}/image`, key, mime };
}

async function page(task: Extract<Task, { kind: 'page' }>, run: Run, browser: WipoBrowser, signal: AbortSignal, stage: (value: Stage) => void) {
  await database.prepare(`UPDATE research_trademark_search SET state='running',step='Consultando a WIPO',error=NULL WHERE id=? AND state<>'cancelled'`).run(run.id);
  let logo: { bytes: Buffer; mimeType: string } | undefined;
  if (run.input_json.query.kind === 'logo') {
    stage('upload');
    const raw = await database.prepare('SELECT storage_key,mime_type FROM research_trademark_upload WHERE id=? AND office_id=? AND user_id=?')
      .get(run.input_json.query.uploadId, run.office_id, run.user_id);
    const upload = z.object({ storage_key: z.string(), mime_type: z.string() }).parse(raw);
    logo = { bytes: await (await objectStorage()).get(upload.storage_key), mimeType: upload.mime_type };
  }
  stage('search');
  const found = await browser.search({ input: trademarkSearchInput.parse(run.input_json), pageNumber: task.page_number, logo, guard: () => guard(task, run), signal,
    owner: { officeId: run.office_id, userId: run.user_id } });
  await guard(task, run);
  const stored: Array<{ id: string; nativeId: string; summary: z.infer<typeof trademarkSummary>; key: string | null; mime: string | null; version: string }> = [];
  const createdKeys: string[] = [];
  const seen = new Set<string>();
  try {
    stage('representations');
    for (const [index, hit] of found.results.entries()) {
      if (seen.has(hit.nativeId)) continue;
      seen.add(hit.nativeId);
      const existing = await database.prepare('SELECT id FROM research_trademark_result WHERE search_id=? AND native_id=?').get<{ id: string }>(run.id, hit.nativeId);
      if (existing) continue;
      const id = randomUUID();
      const logoResult = await saveRepresentation(run, id, hit.representation);
      if (logoResult.key) createdKeys.push(logoResult.key);
      const summary = trademarkSummary.parse({ ...hit, id, representationUrl: logoResult.url,
        source: { provider: 'wipo', url: wipoRecordUrl(hit.nativeId), originUrl: null, capturedAt: new Date().toISOString() }, detailState: 'pending' });
      stored.push({ id, nativeId: hit.nativeId, summary, key: logoResult.key, mime: logoResult.mime,
        version: createHash('sha256').update(JSON.stringify({ ...summary, position: task.page_number * 30 + index })).digest('hex') });
    }
    stage('publish');
    await withTransaction(async tx => {
      const lease = await tx.prepare(`SELECT 1 FROM research_trademark_task WHERE id=? AND state='running' AND lease_owner=? AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`)
        .get(task.id, task.lease_owner);
      if (!lease || !await authorized(run)) throw new TrademarkError('forbidden', 'A pesquisa foi interrompida.');
      for (const [index, item] of stored.entries()) {
        await tx.prepare(`INSERT INTO research_trademark_result(id,search_id,native_id,position,summary_json,version,logo_storage_key,logo_mime_type)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(search_id,native_id) DO NOTHING`)
          .run(item.id, run.id, item.nativeId, task.page_number * 30 + index, JSON.stringify(item.summary), item.version, item.key, item.mime);
      }
      await tx.prepare(`UPDATE research_trademark_search SET state='completed',step='Consulta concluída',pages_loaded=greatest(pages_loaded,?),
        total_reported=?,has_more=?,source_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state<>'cancelled'`)
        .run(task.page_number + 1, found.total, found.hasMore, found.sourceUrl, run.id);
      await tx.prepare(`UPDATE research_trademark_task SET state='completed',lease_owner=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease_owner=?`)
        .run(task.id, task.lease_owner);
    });
  } catch (error) {
    await Promise.allSettled(createdKeys.map(async key => (await objectStorage()).delete(key)));
    throw error;
  }
}

async function detail(task: Extract<Task, { kind: 'detail' }>, run: Run, browser: WipoBrowser, signal: AbortSignal, stage: (value: Stage) => void) {
  stage('detail');
  const raw = await database.prepare('SELECT native_id,summary_json FROM research_trademark_result WHERE id=? AND search_id=?').get(task.result_id, run.id);
  const row = z.object({ native_id: z.string(), summary_json: z.preprocess(value => typeof value === 'string' ? JSON.parse(value) : value, trademarkSummary) }).parse(raw);
  const found = await browser.detail({ nativeId: row.native_id, guard: () => guard(task, run), signal,
    owner: { officeId: run.office_id, userId: run.user_id } });
  await guard(task, run);
  const summary = { ...row.summary_json, situation: found.situation ?? row.summary_json.situation, office: found.office ?? row.summary_json.office,
    source: { ...row.summary_json.source, originUrl: safeSourceUrl(found.originUrl), capturedAt: new Date().toISOString() }, detailState: 'ready' };
  stage('publish');
  await withTransaction(async tx => {
    const live = await tx.prepare(`SELECT 1 FROM research_trademark_task WHERE id=? AND state='running' AND lease_owner=? AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`)
      .get(task.id, task.lease_owner);
    if (!live || !await authorized(run)) throw new TrademarkError('forbidden', 'A pesquisa foi interrompida.');
    await tx.prepare(`UPDATE research_trademark_result SET summary_json=?,fields_json=?,version=?,detail_state='ready',detail_error=NULL,captured_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(JSON.stringify(summary), JSON.stringify(found.fields), createHash('sha256').update(JSON.stringify(found)).digest('hex'), task.result_id);
    await tx.prepare(`UPDATE research_trademark_task SET state='completed',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?`).run(task.id, task.lease_owner);
  });
}

export async function processTrademarkTask(searchId: string, createBrowser: () => Promise<WipoBrowser>): Promise<boolean> {
  const task = await claim(searchId);
  if (!task) return false;
  const run = runSchema.parse(await database.prepare('SELECT * FROM research_trademark_search WHERE id=?').get(searchId));
  let browser: WipoBrowser | undefined;
  let stage: Stage = 'authorization';
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]);
  const renewal = setInterval(() => {
    void database.prepare(`UPDATE research_trademark_task SET lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds'
      WHERE id=? AND state='running' AND lease_owner=? AND lease_until>CURRENT_TIMESTAMP`).run(task.id, task.lease_owner)
      .then(result => { if (!result.changes) controller.abort(); }).catch(() => controller.abort());
  }, 25_000);
  try {
    await guard(task, run);
    stage = 'browser'; browser = await createBrowser();
    if (task.kind === 'page') await page(task, run, browser, signal, value => { stage = value; });
    else await detail(task, run, browser, signal, value => { stage = value; });
  } catch (error) {
    const blocked = error instanceof TrademarkError && error.code === 'blocked';
    const revoked = error instanceof TrademarkError && error.code === 'forbidden';
    const message = error instanceof TrademarkError || error instanceof CapabilityError ? error.message : signal.aborted
      ? 'A consulta demorou mais que o previsto. Os resultados já encontrados foram preservados.'
      : 'A WIPO não respondeu à consulta. Tente novamente mais tarde.';
    if (!revoked) captureOperationalError(error, 'research.trademarks.execute', { searchId, kind: task.kind, stage,
      error_type: error instanceof Error && errorNames.has(error.name) ? error.name : 'unknown' });
    await withTransaction(async tx => {
      const changed = await tx.prepare(`UPDATE research_trademark_task SET state=?,error=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND state='running' AND lease_owner=?`)
        .run(revoked ? 'cancelled' : 'failed', message, task.id, task.lease_owner);
      if (!changed.changes) return;
      if (task.kind === 'detail') {
        await tx.prepare(`UPDATE research_trademark_result SET detail_state=?,detail_error=? WHERE id=?`).run(blocked ? 'blocked' : 'failed', message, task.result_id);
      } else {
        const count = await tx.prepare('SELECT count(*)::int AS count FROM research_trademark_result WHERE search_id=?').get<{ count: number }>(searchId);
        await tx.prepare(`UPDATE research_trademark_search SET state=?,step=?,error=? WHERE id=? AND state<>'cancelled'`)
          .run(revoked ? 'cancelled' : blocked ? 'blocked' : (count?.count ?? 0) ? 'partial' : 'failed', revoked ? 'Pesquisa interrompida' : 'Consulta interrompida', message, searchId);
      }
    });
  } finally {
    clearInterval(renewal);
    await browser?.close().catch(error => captureOperationalError(error, 'research.trademarks.close'));
  }
  return true;
}

export async function pendingTrademarkTasks(searchId?: string): Promise<string[]> {
  const rows = await database.prepare(`SELECT DISTINCT t.search_id FROM research_trademark_task t JOIN research_trademark_search s ON s.id=t.search_id
    WHERE s.state<>'cancelled' AND (t.state='queued' OR (t.state='running' AND t.lease_until<CURRENT_TIMESTAMP))
    ${searchId ? 'AND t.search_id=?' : ''} LIMIT 10`).all<{ search_id: string }>(...(searchId ? [searchId] : []));
  return rows.map(row => row.search_id);
}
