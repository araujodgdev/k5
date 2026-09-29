import pg from '../../../apps/web/node_modules/pg/lib/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
process.loadEnvFile('.env.postgres.local');
const connectionString=process.env.PROCESSOR_DATABASE_URL;
if(!connectionString || !/planetscale|psdb\.cloud/i.test(new URL(connectionString).hostname) || new URL(connectionString).pathname!=='/postgres')throw new Error('Destino inesperado');
const c=new pg.Client({connectionString});
const dir='../../output/jurisprudencia/tjpe/';
const run=JSON.parse(readFileSync(dir+'active-run.json','utf8'));
const topics=JSON.parse(readFileSync(dir+'topics-observed.json','utf8'));
const sourceUrl='https://consultajurisprudencia.app.tjpe.jus.br/';
const query={page:1,size:20,sort:'dataJulgamento,desc','filter[assuntoCNJ.in]':'9098','filter[origem.in]':'ELETRONICO,FISICO','filter[tipoSentenca.in]':'A,D'};
const checkpoint={phase:'preparation',catalogComplete:false,observedTopicCount:topics.length,nextCatalogAction:'Continue official dropdown enumeration after code 14106; re-read overlap and deduplicate by CNJ code.',nextDecisionPage:1,nextDecisionIndex:0,reportedTotal:1480,coverageComplete:false,sortTieBreakVerified:false,resultLimitVerified:false,pending:['Verify source permissions','Adapt existing publisher for TJPE','Resolve native decision identity and preserve official HTML','Enumerate remaining catalog and hierarchy','Partition by date and schedule recent revisits'],lastRunId:run.runId};
const result={...run,finishedAt:new Date().toISOString(),status:'partial',topicsDiscovered:topics.length,partitionsInspected:['cnj:9098:all'],decisionsNew:0,decisionsUpdated:0,decisionsRepeated:0,documentsPending:0,documentsPendingCountKnown:false,resultsObserved:20,reportedTotal:1480,sourceFailures:[],diagnostics:['web fetch returned 502; browser succeeded','native decision URL locator unresolved'],checkpoint};
await c.connect();
try{
 await c.query('BEGIN');
 const lease=await c.query(`SELECT 1 FROM research_crawl_partition WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2 AND lease_until>now() FOR UPDATE`,[run.installationId,run.runId]);
 if(lease.rowCount!==1)throw new Error('Lease perdido');
 for(const [code,label] of topics)await c.query(`INSERT INTO research_crawl_topic(installation_id,topic_key,label,source_url,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(installation_id,topic_key) DO UPDATE SET label=excluded.label,last_seen_at=now(),metadata=excluded.metadata`,[run.installationId,'cnj:'+code,label,sourceUrl,JSON.stringify({officialCode:code,provenance:'official_filter',hierarchyAvailable:false,observedAt:result.finishedAt})]);
 await c.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,topic_key,query,checkpoint,status) VALUES($1,'cnj:9098:all','cnj:9098',$2,$3,'partial') ON CONFLICT DO NOTHING`,[run.installationId,JSON.stringify(query),JSON.stringify({page:1,nextIndex:0,reportedTotal:1480,coverageComplete:false,enumerationPending:true})]);
 await c.query(`UPDATE research_crawl_run SET finished_at=now(),status='partial',result=$2 WHERE id=$1`,[run.runId,JSON.stringify(result)]);
 await c.query(`UPDATE research_crawl_partition SET checkpoint=$3,status='partial',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE installation_id=$1 AND partition_key='routine' AND lease_owner=$2`,[run.installationId,run.runId,JSON.stringify(checkpoint)]);
 await c.query('COMMIT');
 const verified=(await c.query(`SELECT p.partition_key,p.status,p.lease_owner,(SELECT count(*)::int FROM research_crawl_topic WHERE installation_id=$1) AS topics FROM research_crawl_partition p WHERE p.installation_id=$1`,[run.installationId])).rows;
 writeFileSync(dir+'preparation-result.json',JSON.stringify({...result,verified},null,2));
 console.log(JSON.stringify({runId:run.runId,verified}));
}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
