import { testDb as db } from '../apps/web/tests/test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from '../apps/web/tests/google-fixture';
import { authStore } from '../apps/web/src/lib/database';
import { createPage } from '../apps/web/src/lib/case-pages/service';

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
    console.log(JSON.stringify({ waited: sawWait, afterExpiry: result.status, code: result.status === 'rejected' ? result.reason?.code : null }));
    assert.equal(result.status, 'rejected', 'A transaction-start clock must not authorize a naturally expired session');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'UNAUTHENTICATED');
    assert.equal(await db.prepare('SELECT 1 FROM case_page WHERE case_id=?').get(caseId), undefined);
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await pending;
  }
});
