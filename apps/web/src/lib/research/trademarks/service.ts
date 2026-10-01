import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { objectStorage, storageKey } from '@/lib/storage';
import { captureOperationalError } from '@/lib/observability/report';
import { trademarkCorpus, trademarkLogoAnalysis, trademarkDetail, trademarkSearchInput, storedTrademarkSearchInput, trademarkSearchView, trademarkSummary, trademarkUpload, type TrademarkSearchInput, type StoredTrademarkSearchInput, type TrademarkSearchView } from './contracts';
import { wakeTrademarkRun } from './environment';
import { runInpiSearchPage } from './inpi-search';

const storedJson = <T>(schema: z.ZodType<T>) => z.preprocess(value => typeof value === 'string' ? JSON.parse(value) : value, schema);
const searchRow = z.object({
  id: z.string(), input_json: storedJson(storedTrademarkSearchInput.omit({ idempotencyKey: true })), title: z.string(), state: trademarkSearchView.shape.state,
  step: z.string(), error: z.string().nullable(), created_at: z.union([z.string(), z.date()]),
  total_reported: z.number().nullable(), pages_loaded: z.number(), has_more: z.boolean(), source_url: z.string().nullable(),
  provider: z.enum(['inpi','wipo']), analysis_json: storedJson(trademarkLogoAnalysis.nullable()), corpus_json: storedJson(trademarkCorpus.nullable()),
});
const resultRow = z.object({
  id: z.string(), native_id: z.string(), summary_json: storedJson(trademarkSummary), fields_json: storedJson(trademarkDetail.shape.fields), version: z.string(),
  detail_state: trademarkSummary.shape.detailState, detail_error: z.string().nullable(), search_id: z.string(),
});
export const inputHash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const missing = () => new CapabilityError('NOT_FOUND', 'Pesquisa de marcas não encontrada.');

async function ownedSearch(context: WorkspaceContext, searchId: string) {
  await assertCapabilityAllowed(context, 'k5_research_get_trademark_search');
  const row = await database.prepare('SELECT * FROM research_trademark_search WHERE id=? AND office_id=? AND user_id=?')
    .get(searchId, context.officeId, context.userId);
  if (!row) throw missing();
  return searchRow.parse(row);
}

export async function getTrademarkSearch(context: WorkspaceContext, input: { searchId: string }): Promise<{ search: TrademarkSearchView }> {
  const row = await ownedSearch(context, input.searchId);
  const results = await database.prepare('SELECT * FROM research_trademark_result WHERE search_id=? ORDER BY position,id').all(row.id);
  return { search: trademarkSearchView.parse({
    id: row.id, input: row.input_json, title: row.title, state: row.state, step: row.step,
    error: row.error, createdAt: new Date(row.created_at).toISOString(),
    results: results.map(raw => {
      const result = resultRow.parse(raw);
      return { ...result.summary_json, id: result.id, detailState: result.detail_state };
    }),
    totalReported: row.total_reported, pagesLoaded: row.pages_loaded, hasMore: row.has_more, sourceUrl: row.source_url,
    analysis: row.analysis_json, corpus: row.corpus_json,
  }) };
}

export async function listTrademarkSearches(context: WorkspaceContext) {
  await assertCapabilityAllowed(context, 'k5_research_list_trademark_searches');
  const rows = await database.prepare(`SELECT s.*,(SELECT count(*)::int FROM research_trademark_result r WHERE r.search_id=s.id) AS result_count
    FROM research_trademark_search s WHERE office_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 100`)
    .all(context.officeId, context.userId);
  return { searches: rows.map(raw => {
    const row = searchRow.extend({ result_count: z.number() }).parse(raw);
    return { id: row.id, input: row.input_json,
      title: row.title, state: row.state, step: row.step, error: row.error, createdAt: new Date(row.created_at).toISOString(),
      totalReported: row.total_reported, pagesLoaded: row.pages_loaded, hasMore: row.has_more, sourceUrl: row.source_url, resultCount: row.result_count };
  }) };
}

async function wake(searchId: string, trigger = wakeTrademarkRun) {
  try {
    if (await trigger(searchId)) return true;
    await database.prepare(`UPDATE research_trademark_search SET state='blocked',step='Consulta indisponível',error=? WHERE id=? AND state='queued'`)
      .run('O navegador da pesquisa está indisponível neste ambiente. Tente novamente mais tarde.', searchId);
    return false;
  } catch (error) { captureOperationalError(error, 'research.trademarks.dispatch', { searchId }); return true; }
}

export async function startTrademarkSearch(context: WorkspaceContext, raw: TrademarkSearchInput, options: { wake?: typeof wakeTrademarkRun } = {}) {
  await assertCapabilityAllowed(context, 'k5_research_start_trademark_search');
  const { idempotencyKey = randomUUID(), ...input } = trademarkSearchInput.parse(raw);
  let title = input.query.kind === 'name' ? input.query.name : 'Pesquisa por logotipo';
  if (input.query.kind === 'logo') {
    const upload = await database.prepare('SELECT name FROM research_trademark_upload WHERE id=? AND office_id=? AND user_id=?')
      .get<{ name: string }>(input.query.uploadId, context.officeId, context.userId);
    if (!upload) throw new CapabilityError('NOT_FOUND', 'Logotipo não encontrado. Envie a imagem novamente.');
    title = `Logotipo: ${upload.name}`;
  }
  const searchId = await withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`trademark-start:${context.userId}`);
    const existing = await tx.prepare('SELECT id,input_json FROM research_trademark_search WHERE office_id=? AND user_id=? AND idempotency_key=?')
      .get<{ id: string; input_json: unknown }>(context.officeId, context.userId, idempotencyKey);
    if (existing) {
      if (inputHash(storedJson(storedTrademarkSearchInput.omit({ idempotencyKey: true })).parse(existing.input_json)) !== inputHash(input)) throw new CapabilityError('CONFLICT', 'Esta chave já foi usada para outra pesquisa.');
      return existing.id;
    }
    const count = await tx.prepare(`SELECT count(*)::int AS count FROM research_trademark_search WHERE user_id=? AND created_at>CURRENT_TIMESTAMP-INTERVAL '1 day'`)
      .get<{ count: number }>(context.userId);
    if ((count?.count ?? 0) >= 30) throw new CapabilityError('RATE_LIMITED', 'O limite de 30 pesquisas de marcas por dia foi atingido.');
    const id = randomUUID();
    await tx.prepare(`INSERT INTO research_trademark_search(id,office_id,user_id,session_id,input_json,title,idempotency_key,provider) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, context.officeId, context.userId, context.sessionId ?? null, JSON.stringify(input), title, idempotencyKey, 'wipo');
    await tx.prepare(`INSERT INTO research_trademark_task(id,search_id,kind,page_number) VALUES(?,?,'page',0)`).run(randomUUID(), id);
    return id;
  });
  const current = await ownedSearch(context,searchId);
  if (!current.pages_loaded && current.provider==='inpi' && input.query.kind!=='logo') await localPage(searchId,input,0);
  else if (!current.pages_loaded) await wake(searchId, options.wake);
  return getTrademarkSearch(context, { searchId });
}

async function localPage(id: string,input: StoredTrademarkSearchInput,page: number) {
  try { await runInpiSearchPage(id,input,page); }
  catch (error) {
    const message=error instanceof CapabilityError ? error.message : 'Não foi possível consultar a base do INPI. Tente novamente.';
    if (!(error instanceof CapabilityError)) captureOperationalError(error,'research.inpi.search',{searchId:id});
    await database.prepare(`UPDATE research_trademark_search SET state=CASE WHEN pages_loaded>0 THEN 'partial' ELSE 'failed' END,step='Consulta interrompida',error=? WHERE id=? AND state<>'cancelled'`).run(message,id);
  }
}

export async function nextTrademarkPage(context: WorkspaceContext, input: { searchId: string }) {
  const row = await ownedSearch(context, input.searchId);
  if (row.state === 'cancelled') throw new CapabilityError('CONFLICT', 'Esta pesquisa foi cancelada. Inicie outra consulta.');
  if (row.state === 'queued' || row.state === 'running') return getTrademarkSearch(context, input);
  if (!row.has_more && row.pages_loaded && row.state === 'completed') return getTrademarkSearch(context, input);
  if (row.pages_loaded >= 10) throw new CapabilityError('RATE_LIMITED', 'Esta consulta chegou ao limite de 300 resultados. Refine os critérios.');
  const requested = await withTransaction(async tx => {
    const live = searchRow.parse(await tx.prepare('SELECT * FROM research_trademark_search WHERE id=? FOR UPDATE').get(row.id));
    if (live.state === 'cancelled') throw new CapabilityError('CONFLICT', 'Esta pesquisa foi cancelada.');
    if (live.state === 'queued' || live.state === 'running' || live.state === 'completed' && !live.has_more && live.pages_loaded) return false;
    if (live.pages_loaded >= 10) throw new CapabilityError('RATE_LIMITED', 'Esta consulta chegou ao limite de 300 resultados. Refine os critérios.');
    if (live.provider!=='inpi' || live.input_json.query.kind==='logo') await tx.prepare(`INSERT INTO research_trademark_task(id,search_id,kind,page_number) VALUES(?,?,'page',?)
      ON CONFLICT(search_id,page_number) WHERE kind='page' DO UPDATE SET state=CASE WHEN research_trademark_task.state='failed' THEN 'queued' ELSE research_trademark_task.state END,
      attempts=CASE WHEN research_trademark_task.state='failed' THEN 0 ELSE research_trademark_task.attempts END,run_after=CURRENT_TIMESTAMP`)
      .run(randomUUID(), row.id, live.pages_loaded);
    await tx.prepare(`UPDATE research_trademark_search SET state='queued',step='Aguardando consulta',error=NULL,session_id=? WHERE id=?`).run(context.sessionId ?? null, row.id);
    return true;
  });
  if (requested && row.provider==='inpi' && row.input_json.query.kind!=='logo') await localPage(row.id,row.input_json,row.pages_loaded);
  else if (requested) await wake(row.id);
  return getTrademarkSearch(context, input);
}

export async function getTrademarkDetail(context: WorkspaceContext, input: { resultId: string; retry?: boolean }) {
  await assertCapabilityAllowed(context, 'k5_research_get_trademark');
  const raw = await database.prepare(`SELECT r.* FROM research_trademark_result r JOIN research_trademark_search s ON s.id=r.search_id
    WHERE r.id=? AND s.office_id=? AND s.user_id=?`).get(input.resultId, context.officeId, context.userId);
  if (!raw) throw new CapabilityError('NOT_FOUND', 'Marca não encontrada nesta pesquisa.');
  const row = resultRow.parse(raw);
  if (row.detail_state === 'pending' || input.retry && ['failed', 'blocked'].includes(row.detail_state)) {
    const search = await ownedSearch(context, row.search_id);
    if (search.state !== 'cancelled') {
      await database.prepare('UPDATE research_trademark_search SET session_id=? WHERE id=?').run(context.sessionId ?? null, row.search_id);
      await database.prepare(`INSERT INTO research_trademark_task(id,search_id,kind,result_id) VALUES(?,?,'detail',?) ON CONFLICT(result_id) WHERE kind='detail'
        DO UPDATE SET state=CASE WHEN research_trademark_task.state IN ('failed','cancelled') THEN 'queued' ELSE research_trademark_task.state END,
        attempts=CASE WHEN research_trademark_task.state IN ('failed','cancelled') THEN 0 ELSE research_trademark_task.attempts END`)
        .run(randomUUID(), row.search_id, row.id);
      row.detail_state = 'pending'; row.detail_error = null;
      await database.prepare(`UPDATE research_trademark_result SET detail_state='pending',detail_error=NULL WHERE id=? AND detail_state<>'ready'`).run(row.id);
      if (!await wake(row.search_id)) {
        row.detail_state = 'failed'; row.detail_error = 'O navegador da pesquisa está indisponível neste ambiente.';
        await database.prepare(`UPDATE research_trademark_result SET detail_state='failed',detail_error=? WHERE id=? AND detail_state='pending'`).run(row.detail_error, row.id);
      }
    } else {
      row.detail_state = 'failed'; row.detail_error = 'Esta pesquisa foi cancelada. Inicie outra consulta para obter os detalhes.';
    }
    if (search.state === 'cancelled') await database.prepare(`UPDATE research_trademark_result SET detail_state='failed',detail_error=? WHERE id=? AND detail_state='pending'`).run(row.detail_error, row.id);
  }
  return { trademark: trademarkDetail.parse({ ...row.summary_json, id: row.id, searchId: row.search_id,
    fields: row.fields_json, version: row.version, detailState: row.detail_state, detailError: row.detail_error }) };
}

export async function cancelTrademarkSearch(context: WorkspaceContext, input: { searchId: string }) {
  const row = await ownedSearch(context, input.searchId);
  await database.batch([
    database.prepare(`UPDATE research_trademark_search SET state='cancelled',step='Pesquisa cancelada',error=NULL WHERE id=?`).bind(row.id),
    database.prepare(`UPDATE research_trademark_task SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE search_id=? AND state IN ('queued','running')`).bind(row.id),
  ]);
  return getTrademarkSearch(context, input);
}

export function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new CapabilityError('INVALID', 'Envie um logotipo em PNG, JPG ou WebP.');
}

export async function saveTrademarkUpload(context: WorkspaceContext, file: File) {
  await assertCapabilityAllowed(context, 'k5_research_start_trademark_search');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new CapabilityError('INVALID', 'O logotipo deve ter até 5 MB.');
  const dailyUploads = await database.prepare(`SELECT count(*)::int AS count FROM research_trademark_upload WHERE user_id=? AND created_at>CURRENT_TIMESTAMP-INTERVAL '1 day'`).get<{ count: number }>(context.userId);
  if ((dailyUploads?.count ?? 0) >= 60) throw new CapabilityError('RATE_LIMITED', 'O limite diário de envio de logotipos foi atingido.');
  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = imageMime(data);
  const id = randomUUID();
  const key = storageKey(context.officeId, id, mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp');
  const storage = await objectStorage();
  await storage.put(key, data);
  try {
    await database.prepare(`INSERT INTO research_trademark_upload(id,office_id,user_id,name,mime_type,storage_key,byte_size) VALUES(?,?,?,?,?,?,?)`)
      .run(id, context.officeId, context.userId, file.name.slice(0, 200), mimeType, key, data.byteLength);
  } catch (error) { await storage.delete(key); throw error; }
  return { upload: trademarkUpload.parse({ id, name: file.name.slice(0, 200), mimeType }) };
}

export async function readTrademarkUpload(context: WorkspaceContext, id: string) {
  await assertCapabilityAllowed(context, 'k5_research_get_trademark_search');
  const raw = await database.prepare('SELECT storage_key,mime_type FROM research_trademark_upload WHERE id=? AND office_id=? AND user_id=?')
    .get(id, context.officeId, context.userId);
  if (!raw) throw new CapabilityError('NOT_FOUND', 'Logotipo não encontrado.');
  const row = z.object({ storage_key: z.string(), mime_type: trademarkUpload.shape.mimeType }).parse(raw);
  return { bytes: await (await objectStorage()).get(row.storage_key), mimeType: row.mime_type };
}

export async function readTrademarkImage(context: WorkspaceContext, id: string) {
  await assertCapabilityAllowed(context, 'k5_research_get_trademark');
  const raw = await database.prepare(`SELECT r.logo_storage_key,r.logo_mime_type FROM research_trademark_result r JOIN research_trademark_search s ON s.id=r.search_id
    WHERE r.id=? AND s.office_id=? AND s.user_id=? AND r.logo_storage_key IS NOT NULL`).get(id, context.officeId, context.userId);
  if (!raw) throw new CapabilityError('NOT_FOUND', 'Imagem da marca não encontrada.');
  const row = z.object({ logo_storage_key: z.string(), logo_mime_type: trademarkUpload.shape.mimeType }).parse(raw);
  return { bytes: await (await objectStorage()).get(row.logo_storage_key), mimeType: row.logo_mime_type };
}
