import pg from '../../../apps/web/node_modules/pg/lib/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.loadEnvFile('.env.postgres.local');
const connectionString = process.env.PROCESSOR_DATABASE_URL;
if (!connectionString || !/planetscale|psdb\.cloud/i.test(new URL(connectionString).hostname) || new URL(connectionString).pathname !== '/postgres') throw new Error('Destino inesperado');
const dir = '../../output/jurisprudencia/tjpe/';
const run = JSON.parse(readFileSync(dir + 'active-run.json', 'utf8'));
const bytes = readFileSync(dir + 'catalog-official.json');
const catalog = JSON.parse(bytes);
const decisions = JSON.parse(readFileSync(dir + 'page-9098-0.json', 'utf8'));
if (!Array.isArray(catalog) || !catalog.length || catalog.some(t => !Number.isInteger(t.codigo) || typeof t.nome !== 'string') || new Set(catalog.map(t => t.codigo)).size !== catalog.length) throw new Error('Catálogo inválido');
if (!Array.isArray(decisions) || decisions.some(d => !d.chave || !d.npu)) throw new Error('Resposta inválida');
const catalogUrl = 'https://consultajurisprudencia.app.tjpe.jus.br/api/v1/assuntos';
const finishedAt = new Date().toISOString();
const c = new pg.Client({ connectionString });
await c.connect();
try {
  await c.query('BEGIN');
  await c.query('SET LOCAL search_path TO public');
  const lease = await c.query(`SELECT checkpoint FROM research_crawl_partition WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2 AND lease_until>now() FOR UPDATE`, [run.installationId, run.runId]);
  if (lease.rowCount !== 1) throw new Error('Lease perdido');
  const before = Number((await c.query('SELECT count(*) FROM research_crawl_topic WHERE installation_id=$1', [run.installationId])).rows[0].count);
  await c.query(`INSERT INTO research_crawl_topic(installation_id,topic_key,label,source_url,metadata)
    SELECT $1,'cnj:' || t.codigo,t.nome,$3,jsonb_build_object('officialCode',t.codigo,'portalIndex',t.id,'provenance','official_filter','hierarchyAvailable',false,'observedAt',$4::text)
    FROM jsonb_to_recordset($2::jsonb) AS t(id int,codigo int,nome text)
    ON CONFLICT(installation_id,topic_key) DO UPDATE SET label=excluded.label,source_url=excluded.source_url,metadata=excluded.metadata,last_seen_at=now()`, [run.installationId, JSON.stringify(catalog), catalogUrl, finishedAt]);
  await c.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,topic_key,query,checkpoint)
    SELECT installation_id,topic_key || ':all',topic_key,
      jsonb_build_object('endpoint','/api/v1/jurisprudencias','page',0,'size',20,'assuntoCNJ.in',metadata->>'officialCode','origem.in','ELETRONICO,FISICO','tipoSentenca.in','A,D','sort','dataJulgamento,desc'),
      '{"coverageComplete":false,"enumerationPending":true,"requiresDatePartitioning":true}'::jsonb
    FROM research_crawl_topic WHERE installation_id=$1 ON CONFLICT DO NOTHING`, [run.installationId]);
  await c.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,query,checkpoint)
    VALUES($1,'unclassified', '{"purpose":"queue_records_without_official_topic","enumerationFilterVerified":false}', '{"coverageComplete":false}') ON CONFLICT DO NOTHING`, [run.installationId]);
  const checkpoint = { ...lease.rows[0].checkpoint, lastRunId: run.runId, phase: 'catalog_discovered_publication_pending', catalogComplete: true, catalogScope: catalogUrl, catalogObservedAt: finishedAt, observedTopicCount: catalog.length, catalogHierarchyAvailable: false, coverageComplete: false, nextCatalogAction: 'Refresh the official API periodically; upsert codes and enqueue newly discovered topics.', nextDecisionPage: 1, nextDecisionIndex: 0, apiPage: 0, identityCandidate: 'chave', pending: ['Verify source permissions', 'Adapt existing publisher for TJPE and verify decision-key semantics', 'Publish staged first page through K5 and R2 before advancing', 'Verify date partitioning, truncation and stable tie-break ordering', 'Schedule historical/recent fairness and unclassified enumeration'] };
  const result = { runId: run.runId, finishedAt, status: 'partial', catalogEntries: catalog.length, topicsNew: catalog.length - before, catalogUrl, catalogSha256: createHash('sha256').update(bytes).digest('hex'), catalogBytes: bytes.length, partitionsInspected: ['cnj:9098:all'], decisionsNew: 0, decisionsUpdated: 0, decisionsRepeated: 0, documentsPending: decisions.length, documentsPendingScope: '20 source records staged locally; not yet imported into research_judgment', sourceFailures: [], diagnostics: ['Web tool timed out; official browser and direct API succeeded', 'API pagination starts at zero; UI pagination starts at one', 'chave is a native identity candidate; uniqueness semantics remain to be verified', 'No R2 upload or searchable publication attempted; source remains disabled'], candidates: decisions.map(({ chave, npu, origem, tipoSentenca, assuntoCNJ }) => ({ chave, npu, origem, tipoSentenca, assuntoCNJ })), checkpoint };
  await c.query(`UPDATE research_crawl_run SET finished_at=now(),status='partial',result=$2 WHERE id=$1 AND status='running'`, [run.runId, JSON.stringify(result)]);
  await c.query(`UPDATE research_crawl_partition SET checkpoint=$3,status='partial',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2`, [run.installationId, run.runId, JSON.stringify(checkpoint)]);
  await c.query('COMMIT');
  const verified = (await c.query(`SELECT (SELECT count(*)::int FROM research_crawl_topic WHERE installation_id=$1) topics,(SELECT count(*)::int FROM research_crawl_partition WHERE installation_id=$1) partitions,lease_owner,lease_until FROM research_crawl_partition WHERE installation_id=$1 AND partition_key='routine'`, [run.installationId])).rows[0];
  writeFileSync(dir + 'catalog-run-result.json', JSON.stringify({ ...result, verified }, null, 2));
  console.log(JSON.stringify({ runId: run.runId, topicsNew: result.topicsNew, verified }));
} catch (e) { await c.query('ROLLBACK'); throw e; }
finally { await c.end(); }
