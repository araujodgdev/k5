import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { postgresFixture } from './postgres-fixture';
import { createPostgresPool, postgresSql } from '../src/lib/db/postgres';
import { closePoolWithResponse } from '../src/lib/db/request';
import { database,withPostgres } from '../src/lib/database';
import { claimRun } from '../src/lib/ai-store';

test('SQL binding preserves literals, quoted names, comments and dollar-quoted bodies', () => {
  const sql=`SELECT ? AS officeId, '? user officeId', "officeId", $$? user officeId$$, $fn$? user$fn$ FROM user -- ? officeId\nWHERE id=?`;
  assert.equal(postgresSql(sql),`SELECT $1 AS "officeId", '? user officeId', "officeId", $$? user officeId$$, $fn$? user$fn$ FROM "user" -- ? officeId\nWHERE id=$2`);
});

test('live idle connection failures are reported, while closed request sockets stay quiet', async t => {
  const reported = t.mock.method(console, 'error', () => {});
  const pool = createPostgresPool('postgresql://localhost/unused');
  pool.emit('error', new Error('connection lost'));
  assert.equal(reported.mock.callCount(), 1);
  await pool.end();
  pool.emit('error', new Error('Network connection lost.'));
  assert.equal(reported.mock.callCount(), 1);
});

test('PostgreSQL decodes DTO values and rolls the entire batch back on constraint failure', async () => {
  const {db}=await postgresFixture();
  await db.exec('CREATE TABLE adapter_probe(id TEXT PRIMARY KEY,created_at TIMESTAMPTZ,bytes BYTEA)');
  const at='2026-09-22T23:00:00.000Z', bytes=Buffer.from([0,128,255]);
  await db.prepare('INSERT INTO adapter_probe VALUES(?,?,?)').run('one',at,bytes);
  assert.deepEqual(await db.prepare('SELECT id AS recordId,created_at AS createdAt,bytes FROM adapter_probe').get(),{recordId:'one',createdAt:at,bytes});
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO adapter_probe(id) VALUES(?)').bind('two'),
    db.prepare('INSERT INTO adapter_probe(id) VALUES(?)').bind('one'),
  ]),{code:'23505'});
  assert.equal((await db.prepare('SELECT count(*) AS total FROM adapter_probe').get())!.total,1);
});

test('concurrent request contexts and worker claims stay isolated', async () => {
  const a=await postgresFixture(),b=await postgresFixture();
  for(const [fixture,name]of [[a,'Alfa'],[b,'Beta']] as const) {
    await fixture.db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run('office',name);
  }
  const names=await Promise.all([a,b].map(fixture=>withPostgres(fixture.pool,async()=>{
    await Promise.resolve();
    return (await database.prepare('SELECT name FROM office WHERE id=?').get('office'))!.name;
  })));
  assert.deepEqual(names,['Alfa','Beta']);
  await a.db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run('person','test@example.test','Pessoa');
  for(const id of ['run-a','run-b']) await a.db.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,lease_token) VALUES(?,'office','person','draft','{}',?)").run(id,id);
  const claims=await Promise.all([claimRun(a.db),claimRun(a.db)]);
  assert.deepEqual(claims.map(row=>row?.id).sort(),['run-a','run-b']);
  assert.equal(await claimRun(a.db),undefined);
});

test('request pool remains open through streaming and closes on completion or cancellation', async () => {
  for(const cancel of [false,true]) {
    let closed=0;
    const pending:Promise<unknown>[]=[];
    const pool={end:async()=>{closed++;}} as unknown as Pool;
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const body=new ReadableStream<Uint8Array>({start(value){controller=value;}});
    const response=closePoolWithResponse(new Response(body),pool,promise=>{pending.push(promise);});
    controller.enqueue(new TextEncoder().encode('primeiro'));
    const reader=response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'primeiro');
    assert.equal(closed,0);
    if(cancel) await reader.cancel();
    else {controller.close();assert.equal((await reader.read()).done,true);}
    await Promise.all(pending);
    assert.equal(closed,1);
  }
});
