import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const pointer=JSON.parse(readFileSync(join(tmpdir(),'lume-verify-current.json'),'utf8'));
const state=JSON.parse(readFileSync(join(pointer.runDir,'state.json'),'utf8'));
assert.equal(state.runId,'20261006T234247-d88728');assert.equal(state.port,62541);assert.equal(state.pgPort,62542);
process.loadEnvFile(join(pointer.runDir,'verify.env'));process.env.DATABASE_URL=state.databaseUrl;
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const serverOnly=require.resolve('server-only');require.cache[serverOnly]={id:serverOnly,filename:serverOnly,loaded:true,exports:{}} as NodeJS.Module;
const {database:db,authStore}=await import('../apps/web/src/lib/database');
const [email,caseId,judgmentId]=process.argv.slice(2);assert.match(email,/@k5\.test$/);
try {
  assert.ok(await db.prepare('SELECT 1 FROM vault_case c JOIN "user" u ON u.id=c.created_by WHERE c.id=? AND u.email=?').get(caseId,email));
  assert.ok(await db.prepare("SELECT 1 FROM research_judgment WHERE id=? AND metadata_hash='round3' AND title='Referência controlada'").get(judgmentId));
  const materialId=randomUUID(),versionId=randomUUID(),text='Inteiro teor sintético para prova de troca de material.';
  await db.prepare("INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'full_text','ready',?)").run(materialId,judgmentId,versionId);
  await db.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    VALUES(?,?,?,'text/plain',?,?,'v1',?,1,'2026-10-07','2026-10-07')`).run(versionId,materialId,createHash('sha256').update(text).digest('hex'),Buffer.byteLength(text),text,JSON.stringify({tribunal:'TJDFT',title:'Referência controlada'}));
  await db.prepare('INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,?)').run(randomUUID(),versionId,text,'inteiro:1');
  console.log(JSON.stringify({versionId}));
} finally {await(await authStore()).end();}
