import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../src/lib/application/context';
import { trademarkSearchInput, TrademarkError } from '../src/lib/research/trademarks/contracts';
import { startTrademarkSearch, getTrademarkSearch, listTrademarkSearches, nextTrademarkPage, cancelTrademarkSearch,
  getTrademarkDetail, saveTrademarkUpload, readTrademarkUpload, readTrademarkImage } from '../src/lib/research/trademarks/service';
import { processTrademarkTask } from '../src/lib/research/trademarks/worker';
import type { WipoBrowser } from '../src/lib/research/trademarks/wipo';
import { sourcesFromTool } from '../src/lib/citations/sources';

async function actor(officeId: string = randomUUID()): Promise<WorkspaceContext> {
  const userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?) ON CONFLICT DO NOTHING').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.invalid`, 'Pessoa');
  await testDb.prepare("INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,'reviewer')").run(randomUUID(), officeId, userId);
  return { userId, officeId, role: 'reviewer' };
}
const query = (idempotencyKey = randomUUID()) => trademarkSearchInput.parse({ query: { kind: 'name', name: 'LUME' }, idempotencyKey });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZLsAAAAASUVORK5CYII=', 'base64');
const hit = { nativeId: 'BR500000905046595', name: 'LUME', owner: 'Titular', office: null, territory: 'Brazil', recordType: 'National Trademark Application', situation: 'Ended', niceClasses: [35], applicationNumber: '905046595', representation: `data:image/png;base64,${png.toString('base64')}` };
function browser(overrides: Partial<WipoBrowser> = {}): WipoBrowser {
  return {
    async search(request) { await request.guard(); return { results: [hit], total: 2, hasMore: true, sourceUrl: 'https://branddb.wipo.int/en/advancedsearch/results' }; },
    async detail(request) { await request.guard(); return { fields: [{ label: 'Official status', value: 'Rejected' }, { label: 'Serial number', value: '905046595' }], situation: 'Ended', office: 'INPI (Brazil)', originUrl: 'https://busca.inpi.gov.br/pePI/servlet/MarcasServletController?Action=detail&CodPedido=905046595' }; },
    async close() {}, ...overrides,
  };
}
const start = (context: WorkspaceContext, input = query()) => startTrademarkSearch(context, input, { wake: async () => true });
async function openSession(context: WorkspaceContext) {
  const sessionId = randomUUID();
  await testDb.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    .run(sessionId, context.userId, randomUUID());
  context.sessionId = sessionId;
}

test('nome/logotipo: Brasil e todos os status são padrão, filtros inválidos são recusados', () => {
  assert.equal(query().country, 'BR'); assert.equal(query().situation, 'all');
  assert.equal(trademarkSearchInput.parse({ query: { kind: 'logo', uploadId: randomUUID() } }).query.kind, 'logo');
  assert.equal(trademarkSearchInput.safeParse({ query: { kind: 'name', name: 'x' } }).success, false);
  assert.equal(trademarkSearchInput.safeParse({ ...query(), niceClass: 46 }).success, false);
  assert.equal(trademarkSearchInput.safeParse({ query: { kind: 'logo', uploadId: randomUUID(), strategy: 'shape' } }).success, false);
});

test('histórico, resultados e imagens ficam no autor e no escritório; repetição é idempotente', async () => {
  const owner = await actor(), colleague = await actor(owner.officeId), outsider = await actor();
  const input = query();
  const [a, b] = await Promise.all([start(owner, input), start(owner, input)]);
  assert.equal(a.search.id, b.search.id);
  await assert.rejects(start(owner, { ...input, country: 'US' }), { code: 'CONFLICT' });
  await processTrademarkTask(a.search.id, async () => browser());
  const { search } = await getTrademarkSearch(owner, { searchId: a.search.id });
  assert.equal(search.results.length, 1); assert.equal(search.state, 'completed'); assert.equal(search.totalReported, 2);
  assert.equal(search.results[0].source.url, `https://branddb.wipo.int/en/advancedsearch/brand/${hit.nativeId}`);
  assert.deepEqual((await readTrademarkImage(owner, search.results[0].id)).bytes, png);
  for (const other of [colleague, outsider]) {
    await assert.rejects(getTrademarkSearch(other, { searchId: search.id }), { code: 'NOT_FOUND' });
    await assert.rejects(getTrademarkDetail(other, { resultId: search.results[0].id }), { code: 'NOT_FOUND' });
    await assert.rejects(readTrademarkImage(other, search.results[0].id), { code: 'NOT_FOUND' });
    assert.deepEqual((await listTrademarkSearches(other)).searches, []);
  }
  assert.equal((await listTrademarkSearches(owner)).searches[0].resultCount, 1);
  assert.equal(sourcesFromTool('k5_research_get_trademark_search', { search })[0].url, search.results[0].source.url);
});

test('upload privado valida bytes e a busca envia apenas a imagem do autor', async () => {
  const owner = await actor(), colleague = await actor(owner.officeId);
  const { upload } = await saveTrademarkUpload(owner, new File([png], 'marca.png', { type: 'image/png' }));
  await assert.rejects(saveTrademarkUpload(owner, new File(['texto'], 'falso.png', { type: 'image/png' })), { code: 'INVALID' });
  await assert.rejects(readTrademarkUpload(colleague, upload.id), { code: 'NOT_FOUND' });
  const input = trademarkSearchInput.parse({ query: { kind: 'logo', uploadId: upload.id } });
  await assert.rejects(start(colleague, input), { code: 'NOT_FOUND' });
  const { search } = await start(owner, input);
  let inspected = false;
  await processTrademarkTask(search.id, async () => browser({ async search(request) {
    inspected = true; assert.equal(request.input.query.kind, 'logo'); assert.deepEqual(Buffer.from(request.logo!.bytes), png);
    await request.guard(); return { results: [], total: 0, hasMore: false, sourceUrl: 'https://branddb.wipo.int/en/advancedsearch/results' };
  } }));
  assert.equal(inspected, true); assert.equal((await getTrademarkSearch(owner, { searchId: search.id })).search.state, 'completed');
});

test('página repetida não duplica marcas; detalhes preservam status oficial e fonte do INPI', async () => {
  const owner = await actor(), { search } = await start(owner);
  await processTrademarkTask(search.id, async () => browser());
  await nextTrademarkPage(owner, { searchId: search.id });
  await processTrademarkTask(search.id, async () => browser());
  const current = (await getTrademarkSearch(owner, { searchId: search.id })).search;
  assert.equal(current.pagesLoaded, 2); assert.equal(current.results.length, 1);
  const resultId = current.results[0].id;
  await getTrademarkDetail(owner, { resultId });
  await processTrademarkTask(search.id, async () => browser());
  const { trademark } = await getTrademarkDetail(owner, { resultId });
  assert.equal(trademark.detailState, 'ready'); assert.equal(trademark.situation, 'Ended');
  assert.equal(trademark.office, 'INPI (Brazil)'); assert.equal(trademark.territory, 'Brazil'); assert.equal(trademark.recordType, 'National Trademark Application');
  assert.ok(trademark.fields.some(field => field.value === 'Rejected')); assert.match(trademark.source.originUrl!, /CodPedido=905046595/);
  assert.match(sourcesFromTool('k5_research_get_trademark', { trademark })[0].text, /Official status: Rejected/);
});

test('erro de outra página mantém resultados parciais e fecha o navegador', async () => {
  const owner = await actor(), { search } = await start(owner);
  await processTrademarkTask(search.id, async () => browser()); await nextTrademarkPage(owner, { searchId: search.id });
  let closed = false;
  await processTrademarkTask(search.id, async () => browser({ async search() { throw new Error('upstream timeout'); }, async close() { closed = true; } }));
  const current = (await getTrademarkSearch(owner, { searchId: search.id })).search;
  assert.equal(closed, true); assert.equal(current.state, 'partial'); assert.equal(current.results.length, 1); assert.ok(current.error);
});

test('bloqueio da fonte não é interpretado como nenhum resultado', async () => {
  const owner = await actor(), { search } = await start(owner);
  await processTrademarkTask(search.id, async () => browser({ async search() { throw new TrademarkError('blocked', 'Desafio na fonte'); } }));
  const current = (await getTrademarkSearch(owner, { searchId: search.id })).search;
  assert.equal(current.state, 'blocked'); assert.equal(current.totalReported, null); assert.equal(current.pagesLoaded, 0);
});

for (const condition of ['cancelled', 'membership', 'session', 'lease'] as const) test(`interrupção durante a consulta impede publicação: ${condition}`, async () => {
  const owner = await actor();
  if (condition === 'session') await openSession(owner);
  const { search } = await start(owner);
  let resume!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let closed = false;
  const processing = processTrademarkTask(search.id, async () => browser({ async search() {
    entered(); await paused; return { results: [hit], total: 1, hasMore: false, sourceUrl: 'https://branddb.wipo.int/en/advancedsearch/results' };
  }, async close() { closed = true; } }));
  await Promise.race([started, processing.then(() => { throw new Error('worker did not enter the browser'); })]);
  if (condition === 'cancelled') await cancelTrademarkSearch(owner, { searchId: search.id });
  else if (condition === 'membership') await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(owner.officeId, owner.userId);
  else if (condition === 'session') await testDb.prepare('DELETE FROM session WHERE id=?').run(owner.sessionId!);
  else await testDb.prepare("UPDATE research_trademark_task SET lease_owner=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds' WHERE search_id=?").run(randomUUID(), search.id);
  resume(); await processing;
  const row = await testDb.prepare('SELECT count(*)::int AS count FROM research_trademark_result WHERE search_id=?').get<{ count: number }>(search.id);
  assert.equal(row?.count, 0); assert.equal(closed, true);
});

test('nova sessão pode retomar o detalhe interrompido pela revogação da sessão anterior', async () => {
  const owner = await actor(); await openSession(owner);
  const { search } = await start(owner);
  await processTrademarkTask(search.id, async () => browser());
  const resultId = (await getTrademarkSearch(owner, { searchId: search.id })).search.results[0].id;
  await getTrademarkDetail(owner, { resultId });
  let resume!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const processing = processTrademarkTask(search.id, async () => browser({ async detail(request) {
    entered(); await paused; return browser().detail(request);
  } }));
  await Promise.race([started, processing.then(() => { throw new Error('worker did not enter the browser'); })]);
  await testDb.prepare('DELETE FROM session WHERE id=?').run(owner.sessionId!);
  resume(); await processing;
  await openSession(owner);
  await getTrademarkDetail(owner, { resultId, retry: true });
  await processTrademarkTask(search.id, async () => browser());
  assert.equal((await getTrademarkDetail(owner, { resultId })).trademark.detailState, 'ready');
});

test('três leases expiradas encerram a espera com erro recuperável', async () => {
  const owner = await actor(), { search } = await start(owner);
  await testDb.prepare("UPDATE research_trademark_task SET state='running',attempts=3,lease_owner=?,lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE search_id=?").run(randomUUID(), search.id);
  assert.equal(await processTrademarkTask(search.id, async () => browser()), false);
  assert.equal((await getTrademarkSearch(owner, { searchId: search.id })).search.state, 'failed');
});

test('duas solicitações concorrentes criam uma única próxima página', async () => {
  const owner = await actor(), { search } = await start(owner);
  await processTrademarkTask(search.id, async () => browser());
  await Promise.all([nextTrademarkPage(owner, { searchId: search.id }), nextTrademarkPage(owner, { searchId: search.id })]);
  const tasks = await testDb.prepare("SELECT count(*)::int AS count FROM research_trademark_task WHERE search_id=? AND kind='page' AND page_number=1").get<{ count: number }>(search.id);
  assert.equal(tasks?.count, 1);
  await processTrademarkTask(search.id, async () => browser());
  assert.equal((await getTrademarkSearch(owner, { searchId: search.id })).search.state, 'completed');
});
