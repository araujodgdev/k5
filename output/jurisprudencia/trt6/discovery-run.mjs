import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/web/package.json'));
const { Client } = require('pg');
process.loadEnvFile('apps/web/.env.postgres.local');
const connectionString = process.env.PROCESSOR_DATABASE_URL;
if (!/planetscale|psdb\.cloud/i.test(new URL(connectionString).hostname)) throw new Error('PlanetScale required');
const client = new Client({connectionString, connectionTimeoutMillis:15000});
const base = 'https://pje.trt6.jus.br/jurisprudencia/';
const dir = 'output/jurisprudencia/trt6';
await client.connect();
try {
 if (process.argv[2] === 'start') {
  await client.query('BEGIN');
  const source = (await client.query(`INSERT INTO judicial_source_installation
   (id,kind,court_code,court_name,degree,system,purpose,base_url,discovery_status,permission_query,permission_evidence,allowed_hosts,notes)
   VALUES($1,'court_portal','TRT6','Tribunal Regional do Trabalho da 6ª Região','not_applicable','pje','jurisprudence',$2,'documented','permitido',$3,$4,$5)
   ON CONFLICT(kind,court_code,degree,system,purpose) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING id`,
   [randomUUID(),base,'Consulta pública sem autenticação verificada nesta execução. Cache, documentos, redistribuição e IA ainda sem verificação independente.',JSON.stringify(['pje.trt6.jus.br']),'Descoberta assistida; não habilitar transporte antes de validar permissões e conector.'])).rows[0];
  await client.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,query) VALUES($1,'routine', $2) ON CONFLICT DO NOTHING`,[source.id,JSON.stringify({kind:'discovery',sourceUrl:base})]);
  const runId=randomUUID();
  const lease=await client.query(`UPDATE research_crawl_partition SET lease_owner=$2,lease_until=CURRENT_TIMESTAMP+INTERVAL '10 minutes',status='running' WHERE installation_id=$1 AND partition_key='routine' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) RETURNING checkpoint`,[source.id,runId]);
  if(lease.rowCount!==1) throw new Error('Rotina já em execução');
  await client.query(`INSERT INTO research_crawl_run(id,installation_id,partition_key,started_at,status) VALUES($1,$2,'routine',CURRENT_TIMESTAMP,'running')`,[runId,source.id]);
  await client.query('COMMIT');
  const state={runId,installationId:source.id,previous:lease.rows[0].checkpoint};
  writeFileSync(`${dir}/active-run.json`,JSON.stringify(state,null,2));
  console.log(JSON.stringify(state));
 } else if(process.argv[2]==='finish') {
  const state=JSON.parse(readFileSync(`${dir}/active-run.json`));
  const evidence=JSON.parse(readFileSync(`${dir}/discovery.json`));
  await client.query('BEGIN');
  const lease=await client.query(`SELECT lease_owner FROM research_crawl_partition WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2 AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`,[state.installationId,state.runId]);
  if(lease.rowCount!==1) throw new Error('Lease perdido');
  for(const topic of evidence.topics) {
   await client.query(`INSERT INTO research_crawl_topic(installation_id,topic_key,label,source_url,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(installation_id,topic_key) DO UPDATE SET label=excluded.label,last_seen_at=CURRENT_TIMESTAMP`,[state.installationId,topic.code,topic.name,base,JSON.stringify({hierarchyStatus:'not_exposed',provenance:'official_filter'})]);
   await client.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,topic_key,query) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[state.installationId,`topic:${topic.code}:historical`,topic.code,JSON.stringify({subjectCode:topic.code,sourceUrl:base,datesNotYetEnumerated:true})]);
  }
  const checkpoint={catalogOffset:evidence.topics.length,catalogObservedCount:1095,catalogComplete:false,coverageComplete:false,searchPage:1,nextAction:'verify permissions, finish official catalog and partition by signature date',lastRunId:state.runId};
  const result={...evidence,topics:evidence.topics.length,newDecisions:0,updatedDecisions:0,repeatedDecisions:0,pendingDocuments:0,failures:[],coverage:'incomplete',limitations:['Only discovery performed; decision ingestion not started','Storage and redistribution permissions not independently verified','Catalog hierarchy not exposed in selector'],checkpoint};
  await client.query(`UPDATE research_crawl_partition SET checkpoint=$3,status='partial',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2`,[state.installationId,state.runId,JSON.stringify(checkpoint)]);
  await client.query(`UPDATE research_crawl_run SET finished_at=CURRENT_TIMESTAMP,status='partial',result=$2 WHERE id=$1`,[state.runId,JSON.stringify(result)]);
  await client.query('COMMIT');
  writeFileSync(`${dir}/discovery-result.json`,JSON.stringify({...state,...result,finishedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({runId:state.runId,topics:evidence.topics.length,status:'partial',leaseReleased:true}));
 }
} catch(e) {await client.query('ROLLBACK');throw e;} finally {await client.end();}
