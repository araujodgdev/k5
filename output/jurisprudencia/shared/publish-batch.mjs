import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const app = process.cwd();
process.loadEnvFile(resolve(app, '.env.postgres.local'));
const url = process.env.PROCESSOR_DATABASE_URL;
if (!url || !/planetscale|psdb\.cloud/i.test(new URL(url).hostname)) throw new Error('Destino PlanetScale não confirmado.');
process.env.DATABASE_URL = url;
process.env.CLOUDFLARE_ACCOUNT_ID = 'bf552f67bcf46921dbe4137ee0ff8980';
const root = resolve(app, '../..');
const court = process.argv[2]?.toLowerCase();
if (!['stf', 'stj', 'tst'].includes(court)) throw new Error('Tribunal inválido.');
const dir = resolve(root, 'output/jurisprudencia', court);
const batch = JSON.parse(await readFile(resolve(dir, 'import-manifest.json'), 'utf8'));
if (!batch.records?.length || batch.records.some(r => r.tribunal !== court.toUpperCase())) throw new Error('Lote inválido.');
const runId = randomUUID();
const startedAt = new Date().toISOString();
const moduleAt = name => import(pathToFileURL(resolve(app, 'src/lib', name)).href);
const { database } = await moduleAt('database.ts');
const { findInstallation, upsertInstallation } = await moduleAt('judicial/repositories/installations.ts');
const { upsertSourceJudgment, citationMetadata } = await moduleAt('research/catalog.ts');
const { resetObjectStorageForTests } = await moduleAt('storage/index.ts');
const { putResearchOriginal } = await moduleAt('research/storage.ts');
const hash = data => createHash('sha256').update(data).digest('hex');
const cache = new Map();
const transferDir = resolve(root, 'output/jurisprudencia/shared/transfers');
await mkdir(transferDir, { recursive: true });
const cli = resolve(app, 'node_modules/wrangler/bin/wrangler.js');
const keyPattern = /^research\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.(txt|json|html|pdf|zip)$/;
async function wrangler(args) {
  try { await exec(process.execPath, [cli, 'r2', 'object', ...args, '--remote'], { cwd: app, env: process.env, windowsHide: true, timeout: 90000 }); }
  catch { throw new Error('Falha na transferência R2 pelo Wrangler.'); }
}
// The existing injectable binding adapter points at real remote R2 operations here.
resetObjectStorageForTests(undefined, {
  async put(key, bytes) {
    if (!keyPattern.test(key) || !key.includes(hash(bytes))) throw new Error('Chave/hash R2 inválido.');
    if (cache.has(key)) return;
    const file = resolve(transferDir, key.split('/').at(-1));
    await writeFile(file, bytes);
    await wrangler(['put', `k5-vault-staging/${key}`, '--file', file]);
  },
  async get(key) {
    if (!keyPattern.test(key)) throw new Error('Chave R2 inválida.');
    let bytes = cache.get(key);
    if (!bytes) {
      const file = resolve(transferDir, `${key.split('/').at(-1)}.verified`);
      await wrangler(['get', `k5-vault-staging/${key}`, '--file', file]);
      bytes = await readFile(file);
      if (!key.includes(hash(bytes))) throw new Error('Hash remoto divergente.');
      cache.set(key, bytes);
    }
    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
  async delete() { throw new Error('Coleta não permite exclusão de arquivos.'); },
});

let source;
let leased = false;
const ids = [];
const originalKeys = [];
try {
  const sheet = JSON.parse(await readFile(resolve(app, `db/sources/${court === 'stj' ? 'stj-ckan' : court}-staging.json`), 'utf8'));
  if (court === 'stj') {
    source = await findInstallation('d8ec6c89-2057-4e4e-a004-d8c9a606e204');
    if (!source?.enabled) throw new Error('Instalação STJ indisponível.');
    await database.prepare(`UPDATE judicial_source_installation SET permission_documents='permitido', permission_evidence=?, documentation_reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(sheet.permissionEvidence, source.id);
    source = await findInstallation(source.id);
  } else {
    source = await upsertInstallation({ ...sheet, enabled: true, liveTransportEnabled: false });
  }
  const topics = batch.topics.map(t => ({ key: t.key, label: t.label, parent: t.parentKey ?? null, url: t.sourceUrl, metadata: t.metadata ?? {} }));
  await database.prepare(`INSERT INTO research_crawl_topic(installation_id,topic_key,label,parent_key,source_url,metadata)
    SELECT ?,key,label,parent,url,metadata FROM jsonb_to_recordset(?::jsonb) AS t(key text,label text,parent text,url text,metadata jsonb)
    ON CONFLICT(installation_id,topic_key) DO UPDATE SET label=excluded.label,parent_key=excluded.parent_key,
      source_url=excluded.source_url,metadata=excluded.metadata,last_seen_at=CURRENT_TIMESTAMP`).run(source.id, JSON.stringify(topics));
  const part = batch.partition;
  await database.prepare(`INSERT INTO research_crawl_partition(installation_id,partition_key,topic_key,query)
    VALUES(?,?,?,?::jsonb) ON CONFLICT DO NOTHING`).run(source.id, part.key, part.topicKey ?? null, JSON.stringify(part.query));
  const lease = await database.prepare(`UPDATE research_crawl_partition SET lease_owner=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '30 minutes',status='running'
    WHERE installation_id=? AND partition_key=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)`)
    .run(runId, source.id, part.key);
  if (lease.changes !== 1) throw new Error('Partição em uso.');
  leased = true;
  await database.prepare(`INSERT INTO research_crawl_run(id,installation_id,partition_key,started_at,status) VALUES(?,?,?,?,'running')`)
    .run(runId, source.id, part.key, startedAt);
  const manifestKey = await putResearchOriginal(Buffer.from(JSON.stringify(batch)), 'json');
  for (const record of batch.records) {
    const judgmentId = await upsertSourceJudgment(source, record, batch.collectedAt ?? startedAt);
    ids.push({ sourceJudgmentId: record.sourceJudgmentId, judgmentId });
    console.log(JSON.stringify({ court, persisted: record.sourceJudgmentId, judgmentId }));
  }
  for (const original of batch.originals ?? []) {
    const file = resolve(dir, original.path);
    if (!file.startsWith(dir + '/') && !file.startsWith(dir + '\\')) throw new Error('Original fora da pasta do tribunal.');
    const bytes = await readFile(file);
    const extension = original.extension ?? extname(file).slice(1);
    const key = await putResearchOriginal(bytes, extension);
    const record = batch.records.find(r => r.sourceJudgmentId === original.sourceJudgmentId);
    originalKeys.push({ sourceJudgmentId: original.sourceJudgmentId, key, sha256: hash(bytes), bytes: bytes.length });
    if (!record || original.kind === 'official_metadata') continue;
    const entry = ids.find(r => r.sourceJudgmentId === original.sourceJudgmentId);
    const material = await database.prepare(`SELECT m.id,j.metadata_revision FROM research_material m JOIN research_judgment j ON j.id=m.judgment_id WHERE j.id=? AND m.kind=?`)
      .get(entry.judgmentId, original.kind ?? 'full_text');
    const mime = { pdf: 'application/pdf', html: 'text/html', json: 'application/json', txt: 'text/plain', zip: 'application/zip' }[extension];
    await database.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,storage_key,parser_version,citation_metadata_json,metadata_revision,source_url,source_updated_at,collected_at,published_at)
      VALUES(?,?,?,?,?,?,'official-original-v1',?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(material_id,sha256,parser_version,metadata_revision) DO NOTHING`)
      .run(randomUUID(), material.id, hash(bytes), mime, bytes.length, key, JSON.stringify(citationMetadata(record)), material.metadata_revision,
        original.sourceUrl ?? record.sourceUrl, record.sourceUpdatedAt, batch.collectedAt ?? startedAt);
  }
  const relations = (batch.relations ?? []).map(r => ({ judgment_id: ids.find(i => i.sourceJudgmentId === r.sourceJudgmentId)?.judgmentId, topic_key: r.topicKey, provenance: r.provenance, url: r.sourceUrl }));
  if (relations.some(r => !r.judgment_id)) throw new Error('Relação temática sem julgado.');
  await database.prepare(`INSERT INTO research_crawl_judgment_topic(judgment_id,installation_id,topic_key,provenance,source_url)
    SELECT judgment_id,?,topic_key,provenance,url FROM jsonb_to_recordset(?::jsonb) AS t(judgment_id text,topic_key text,provenance text,url text)
    ON CONFLICT(judgment_id,installation_id,topic_key) DO UPDATE SET provenance=excluded.provenance,source_url=excluded.source_url`)
    .run(source.id, JSON.stringify(relations));
  const checkpoint = { ...part.checkpoint, status: 'partial', publicationConfirmed: true, remotePersistence: 'confirmed', publicationRunId: runId };
  const result = { runId, tribunal: court.toUpperCase(), installationId: source.id, records: ids, topics: topics.length, relations: relations.length, originals: originalKeys, verifiedR2Objects: cache.size, manifestKey, coverage: 'partial', checkpoint };
  await database.batch([
    database.prepare(`UPDATE research_crawl_partition SET checkpoint=?::jsonb,status='partial',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE installation_id=? AND partition_key=? AND lease_owner=?`)
      .bind(JSON.stringify(checkpoint), source.id, part.key, runId),
    database.prepare(`UPDATE research_crawl_run SET finished_at=CURRENT_TIMESTAMP,status='partial',evidence_storage_key=?,result=?::jsonb WHERE id=?`)
      .bind(manifestKey, JSON.stringify(result), runId),
  ]);
  await writeFile(resolve(dir, 'publication-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ court, runId, records: ids.length, topics: topics.length, verifiedR2Objects: cache.size, status: 'partial' }));
} catch (error) {
  if (source && leased) {
    await database.batch([
      database.prepare(`UPDATE research_crawl_partition SET status='blocked',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE installation_id=? AND partition_key=? AND lease_owner=?`).bind(source.id, batch.partition.key, runId),
      database.prepare(`UPDATE research_crawl_run SET finished_at=CURRENT_TIMESTAMP,status='failed',result=?::jsonb WHERE id=?`).bind(JSON.stringify({ persistedIds: ids, error: 'publication_failed' }), runId),
    ]);
  }
  console.error(error instanceof Error && !/postgres(?:ql)?:\/\//i.test(error.message) ? error.message : 'Falha na publicação.');
  process.exitCode = 1;
} finally {
  await database.close();
}
