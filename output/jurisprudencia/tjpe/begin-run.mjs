import pg from '../../../apps/web/node_modules/pg/lib/index.js';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
process.loadEnvFile('.env.postgres.local');
const url=process.env.PROCESSOR_DATABASE_URL;
if(!url || !/planetscale|psdb\.cloud/i.test(new URL(url).hostname) || new URL(url).pathname!=='/postgres') throw new Error('Destino inesperado');
const c=new pg.Client({connectionString:url});
const runId=randomUUID();
const sourceUrl='https://consultajurisprudencia.app.tjpe.jus.br/';
await c.connect();
try {
 await c.query('BEGIN');
 await c.query("SELECT pg_advisory_xact_lock(hashtext('research-crawl:TJPE'))");
 await c.query(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,base_url,auth_kind,discovery_status,permission_evidence,allowed_hosts,rate_limit_per_minute,daily_request_budget,notes,documentation_url)
 VALUES($1,'court_portal','TJPE','Tribunal de Justiça de Pernambuco','second','proprietary','jurisprudence',$2,'none','candidate',$3,$4,3,100,$5,$2) ON CONFLICT(kind,court_code,degree,system,purpose) DO NOTHING`,[randomUUID(),sourceUrl,'Acesso público ao formulário e ao filtro Assunto CNJ verificado no navegador. Condições de cache, documentos, redistribuição e IA ainda não verificadas.',JSON.stringify(['consultajurisprudencia.app.tjpe.jus.br']),'Preparação da coleta. Nenhum documento admitido ainda.']);
 const source=(await c.query("SELECT id FROM judicial_source_installation WHERE court_code='TJPE' AND kind='court_portal' AND degree='second' AND purpose='jurisprudence'")).rows[0];
 await c.query(`INSERT INTO research_crawl_partition(installation_id,partition_key,query) VALUES($1,'routine', $2) ON CONFLICT DO NOTHING`,[source.id,JSON.stringify({purpose:'source_lease_and_catalog_discovery',sourceUrl})]);
 const lease=await c.query(`UPDATE research_crawl_partition SET lease_owner=$2,lease_until=now()+interval '10 minutes',status='running' WHERE installation_id=$1 AND partition_key='routine' AND (lease_until IS NULL OR lease_until<now()) RETURNING checkpoint`,[source.id,runId]);
 if(lease.rowCount!==1)throw new Error('Rotina em execução');
 await c.query(`INSERT INTO research_crawl_run(id,installation_id,partition_key,started_at,status) VALUES($1,$2,'routine',now(),'running')`,[runId,source.id]);
 await c.query('COMMIT');
 const result={runId,installationId:source.id,previousCheckpoint:lease.rows[0].checkpoint,startedAt:new Date().toISOString()};
 writeFileSync('../../output/jurisprudencia/tjpe/active-run.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
} catch(e) {await c.query('ROLLBACK');throw e;} finally {await c.end();}
