import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const pointer=JSON.parse(readFileSync(join(tmpdir(),'lume-verify-current.json'),'utf8'));
const state=JSON.parse(readFileSync(join(pointer.runDir,'state.json'),'utf8'));
assert.equal(state.runId,'20261006T234247-d88728');assert.equal(state.port,62541);assert.equal(state.pgPort,62542);
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {Pool}=require('pg');const pool=new Pool({connectionString:state.databaseUrl,max:1});
try {
 const result=await pool.query("SELECT name,checksum FROM postgres_migration WHERE name>='0075' ORDER BY name");
 const migrations=result.rows.map((row:{name:string;checksum:string})=>{
  const sql=readFileSync(new URL('../apps/web/db/postgres/'+row.name,import.meta.url),'utf8');
  const checksum=createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(row.checksum,checksum,'Applied migration changed: '+row.name);
  return {...row,verified:true};
 });
 const output={runId:state.runId,port:state.port,pgPort:state.pgPort,migrations};
 writeFileSync(new URL('./lume-provenance-round3-migration-checks.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({runId:state.runId,migrationsVerified:migrations.length}));
}finally{await pool.end();}
