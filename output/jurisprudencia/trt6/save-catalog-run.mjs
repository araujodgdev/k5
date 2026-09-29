import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/web/package.json'));
const { Client } = require('pg');
process.loadEnvFile('apps/web/.env.postgres.local');
const connectionString = process.env.PROCESSOR_DATABASE_URL;
if (!/planetscale|psdb\.cloud/i.test(new URL(connectionString).hostname)) throw new Error('PlanetScale required');
const dir = 'output/jurisprudencia/trt6';
const state = JSON.parse(readFileSync(`${dir}/active-run.json`));
const catalog = JSON.parse(readFileSync(`${dir}/catalog-official.json`));
const snapshot = readFileSync(`${dir}/topic-10294-page-1.txt`, 'utf8');
const topics = new Map();
for (const topic of catalog.topics) {
  const names = topics.get(topic.code) ?? [];
  if (!names.includes(topic.name)) names.push(topic.name);
  topics.set(topic.code, names);
}
const records = snapshot.split('- heading "Mostrar movimentos do processo ').slice(1).map(block => {
  const process = block.match(/^(.+?) - ([\d.-]+)"/);
  const sourceId = block.match(/\/jurisprudencia\/([a-f0-9]{32})/)?.[1];
  const doc = block.match(/- paragraph: "(.+?) - Data de assinatura: (\d{2})\/(\d{2})\/(\d{4})"/);
  if (!process || !sourceId || !doc) throw new Error('Invalid record');
  return { sourceId, processNumber: process[2], className: process[1], court:'TRT6',
    officialUrl: `${catalog.sourceUrl}${sourceId}`, documentType: doc[1], signedAt:`${doc[4]}-${doc[3]}-${doc[2]}`,
    judgingBody: block.match(/- paragraph: "Órgão julgador: (.+)"/)?.[1],
    rapporteur: block.match(/- paragraph: "Relator\(a\): (.+)"/)?.[1],
    subjects:[{code:'10294',provenance:'official_filter'}], rawMetadata:block,
    documentStatus:'pending', publicationStatus:'pending', observedAt:catalog.observedAt };
});
if(records.length!==14 || new Set(records.map(r=>r.sourceId)).size!==14) throw new Error('Record count mismatch');
const client = new Client({connectionString, connectionTimeoutMillis:15000});
await client.connect();
try {
  await client.query('BEGIN');
  const lease = await client.query(`SELECT checkpoint FROM public.research_crawl_partition WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2 AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`, [state.installationId,state.runId]);
  if(lease.rowCount!==1) throw new Error('Lease lost');
  const before = Number((await client.query('SELECT count(*) FROM public.research_crawl_topic WHERE installation_id=$1',[state.installationId])).rows[0].count);
  await client.query(`INSERT INTO public.research_crawl_topic(installation_id,topic_key,label,source_url,metadata)
    SELECT $1,t.code,t.label,$2,t.metadata FROM jsonb_to_recordset($3::jsonb) AS t(code text,label text,metadata jsonb)
    ON CONFLICT(installation_id,topic_key) DO UPDATE SET label=excluded.label,metadata=excluded.metadata,last_seen_at=CURRENT_TIMESTAMP`,
    [state.installationId,catalog.sourceUrl,JSON.stringify([...topics].map(([code,names])=>({code,label:names[0],metadata:{officialLabels:names,provenance:'official_filter',hierarchyStatus:'not_exposed',observedAt:catalog.observedAt}})))]);
  await client.query(`INSERT INTO public.research_crawl_partition(installation_id,partition_key,topic_key,query)
    SELECT installation_id,'topic:'||topic_key||':'||mode,topic_key,jsonb_build_object('subjectCode',topic_key,'mode',mode,'dateField','signature','datesNotYetEnumerated',true)
    FROM public.research_crawl_topic CROSS JOIN (VALUES ('historical'),('recent')) AS modes(mode) WHERE installation_id=$1 ON CONFLICT DO NOTHING`,[state.installationId]);
  await client.query(`INSERT INTO public.research_crawl_partition(installation_id,partition_key,query)
    VALUES($1,'unclassified', $2) ON CONFLICT DO NOTHING`,[state.installationId,JSON.stringify({mode:'unclassified',requiresIndexEnumeration:true,sourceUrl:catalog.sourceUrl})]);
  const nextAttemptAt=new Date(Date.now()+20*60*1000).toISOString();
  await client.query(`UPDATE public.research_crawl_partition SET status='partial', checkpoint=$2,updated_at=CURRENT_TIMESTAMP WHERE installation_id=$1 AND partition_key='topic:10294:historical'`,
    [state.installationId,JSON.stringify({page:1,pageSize:20,total:14,indexEnumerated:true,coverageComplete:false,records,pendingDocuments:14,attempts:[{sourceId:records[0].sourceId,kind:'download',outcome:'browser_download_event_timeout',timeoutMs:20000,at:new Date().toISOString()}],nextAttemptAt,nextAction:'retrieve originals, verify permissions and publish through existing Research functions'})]);
  const result={runId:state.runId,status:'partial',catalogOptions:catalog.topics.length,uniqueTopics:topics.size,newTopics:topics.size-before,partitionsVisited:['topic:10294:historical'],discoveredDocuments:14,newDecisions:0,updatedDecisions:0,repeatedDecisions:0,pendingDocuments:14,r2Uploads:0,failures:[{kind:'browser_download_event_timeout',sourceId:records[0].sourceId}],coverageComplete:false,limitations:['TRT6 publication adapter not implemented','Storage and redistribution permissions still unverified','Records staged in crawl checkpoint, not research_judgment'],finishedAt:new Date().toISOString()};
  const checkpoint={...lease.rows[0].checkpoint,catalogOffset:catalog.topics.length,catalogObservedCount:catalog.topics.length,catalogUniqueCount:topics.size,catalogComplete:true,catalogLastRefreshedAt:catalog.observedAt,coverageComplete:false,lastRunId:state.runId,nextAction:'ingest 14 pending documents for CNJ 10294; alternate recent and historical partitions'};
  await client.query(`UPDATE public.research_crawl_partition SET checkpoint=$3,status='partial',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2`,[state.installationId,state.runId,JSON.stringify(checkpoint)]);
  await client.query(`UPDATE public.research_crawl_run SET status='partial',finished_at=CURRENT_TIMESTAMP,result=$2 WHERE id=$1`,[state.runId,JSON.stringify(result)]);
  await client.query('COMMIT');
  const verification=(await client.query(`SELECT (SELECT count(*) FROM public.research_crawl_topic WHERE installation_id=$1) AS topics,lease_owner,lease_until FROM public.research_crawl_partition WHERE installation_id=$1 AND partition_key='routine'`,[state.installationId])).rows[0];
  writeFileSync(`${dir}/${state.runId}.json`,JSON.stringify({...result,verification},null,2));
  console.log(JSON.stringify({...result,verification}));
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
