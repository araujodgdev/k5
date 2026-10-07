import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from './google-fixture';
import { authStore } from '../src/lib/database';
import { createPage } from '../src/lib/case-pages/service';
import { createPrivateDocument } from '../src/lib/documents/service';

test('page creation rechecks actual session expiry after waiting for the ACL gate', { timeout: 15_000 }, async () => {
  const f = await googleFixture();
  const sessionId = randomUUID(), caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Caso', f.userId);
  await db.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,clock_timestamp()+INTERVAL '2 seconds',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(sessionId, f.userId, randomUUID());
  const holder = await (await authStore()).connect();
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('lume:content-acl:' || current_schema(),0))");
    pending = Promise.allSettled([createPage({ ...f.context, sessionId }, { caseId, title: 'Depois da expiração', content: 'Texto' })]);
    let sawWait = false;
    for (let observations = 0; observations < 250; observations++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const locks = await holder.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock_shared%'");
      sawWait ||= locks.rowCount! > 0;
      const expiry = await holder.query('SELECT "expiresAt"<clock_timestamp() AS expired FROM session WHERE id=$1', [sessionId]);
      if (sawWait && expiry.rows[0].expired) break;
      if (observations === 249) assert.fail('Expected an in-flight content transaction to wait past natural expiry');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    const [result] = await pending;

    assert.equal(result.status, 'rejected', 'A transaction-start clock must not authorize a naturally expired session');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'UNAUTHENTICATED');
    assert.equal(await db.prepare('SELECT 1 FROM case_page WHERE case_id=?').get(caseId), undefined);
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await pending;
  }
});

test('actual run output cannot commit when its session expires during a later row-lock wait', { timeout: 15_000 }, async () => {
  const f = await googleFixture();
  const sessionId = randomUUID(), runId = randomUUID(), lease = randomUUID();
  await db.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,clock_timestamp()+INTERVAL '2 seconds',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    .run(sessionId, f.userId, randomUUID());
  await db.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,status,lease_token,lease_until) VALUES(?,?,?,'draft','{}','running',?,EXTRACT(EPOCH FROM clock_timestamp())*1000+60000)")
    .run(runId, f.officeId, f.userId, lease);
  const holder = await (await authStore()).connect();
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM ai_run WHERE id=$1 FOR UPDATE', [runId]);
    pending = Promise.allSettled([createPrivateDocument({ ...f.context, sessionId }, { runId, runLease: lease, title: 'Resultado', content: 'Texto' })]);
    let sawWait = false;
    for (let observations = 0; observations < 250; observations++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const waiting = await holder.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM ai_run%FOR UPDATE%'");
      sawWait ||= waiting.rowCount! > 0;
      const expiry = await holder.query('SELECT "expiresAt"<clock_timestamp() AS expired FROM session WHERE id=$1', [sessionId]);
      if (sawWait && expiry.rows[0].expired) break;
      if (observations === 249) assert.fail('Expected the real run output writer to wait past natural expiry');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    const [result] = await pending;
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'UNAUTHENTICATED');
    assert.equal(await db.prepare('SELECT 1 FROM ai_artifact WHERE run_id=?').get(runId), undefined);
    assert.equal(await db.prepare('SELECT 1 FROM ai_artifact_version v JOIN ai_artifact a ON a.id=v.artifact_id WHERE a.run_id=?').get(runId), undefined);
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await pending;
  }
});
