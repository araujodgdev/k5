import pg from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
process.loadEnvFile('.env.postgres.local');
const client=new pg.Client({connectionString:process.env.PROCESSOR_DATABASE_URL});
await client.connect();
try {
 const results=[];const errors=[];
 for(const court of ['stf','stj','tst']) {
  const dir=resolve('../../output/jurisprudencia',court,'continuacao-02');
  const batch=JSON.parse(readFileSync(resolve(dir,'import-manifest.json'),'utf8'));
  const publication=JSON.parse(readFileSync(resolve(dir,'publication-result.json'),'utf8'));
  const rows=(await client.query('SELECT j.source_judgment_id,m.kind,m.status,v.sha256,v.storage_key FROM research_judgment j JOIN research_material m ON m.judgment_id=j.id LEFT JOIN research_material_version v ON v.id=m.current_version_id WHERE j.installation_id=$1 AND j.source_judgment_id=ANY($2::text[])',[publication.installationId,batch.records.map(r=>r.sourceJudgmentId)])).rows;
  for(const record of batch.records)for(const [field,kind]of [['ementa','ementa'],['fullText','full_text']])if(record[field]){
   const row=rows.find(r=>r.source_judgment_id===record.sourceJudgmentId&&r.kind===kind);
   const sha=createHash('sha256').update(record[field].trim()).digest('hex');
   if(row?.status!=='ready'||row.sha256!==sha||!row.storage_key)errors.push({court,id:record.sourceJudgmentId,kind});
  }
  const state=(await client.query('SELECT checkpoint,status,lease_owner FROM research_crawl_partition WHERE installation_id=$1 AND partition_key=$2',[publication.installationId,batch.partition.key])).rows[0];
  if(state?.checkpoint.publicationRunId!==publication.runId||state.lease_owner!==null)errors.push({court,state:'checkpoint_mismatch'});
  results.push({court,records:batch.records.length,fullTexts:batch.records.filter(r=>r.fullText).length,ementas:batch.records.filter(r=>r.ementa).length,verifiedR2Objects:publication.verifiedR2Objects,runId:publication.runId,checkpoint:state.checkpoint});
 }
 const totals=(await client.query("SELECT j.tribunal,count(DISTINCT j.id)::int AS judgments,count(*) FILTER(WHERE m.kind='ementa' AND m.status='ready')::int AS ementas,count(*) FILTER(WHERE m.kind='full_text' AND m.status='ready')::int AS full_text,count(*) FILTER(WHERE m.kind='full_text' AND m.status='pending')::int AS full_text_pending FROM research_judgment j JOIN research_material m ON m.judgment_id=j.id WHERE j.tribunal IN ('STF','STJ','TST') GROUP BY j.tribunal ORDER BY j.tribunal")).rows;
 const value={verifiedAt:new Date().toISOString(),results,totals,errors};
 writeFileSync('../../output/jurisprudencia/shared/verification-continuacao-02.json',JSON.stringify(value,null,2));
 console.log(JSON.stringify({totals,results:results.map(({checkpoint,...rest})=>rest),errors}));
 if(errors.length)process.exitCode=1;
} finally {await client.end();}
