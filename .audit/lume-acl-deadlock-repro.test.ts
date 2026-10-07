import { testDb as db } from '../apps/web/tests/test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ensureOfficeForUser } from '../apps/web/src/lib/offices';
import { authStore } from '../apps/web/src/lib/database';
import { changeAccess } from '../apps/web/src/lib/collaboration/service';
import { createPage } from '../apps/web/src/lib/case-pages/service';

test('actual participant grant and page creation do not deadlock on office foreign keys', { timeout: 25_000 }, async () => {
  const ownerId = randomUUID(), guestId = randomUUID(), caseId = randomUUID();
  for (const userId of [ownerId, guestId]) await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@gate-repro.test`, 'Pessoa');
  const { officeId } = await ensureOfficeForUser(db, { id: ownerId, officeName: 'Repro de locks' });
  await ensureOfficeForUser(db, { id: guestId, officeName: 'Associado' });
  const context = { userId: ownerId, officeId };
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso de locks', ownerId);
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?)').run(officeId, guestId, ownerId);
  const pool = await authStore();
  const holder = await pool.connect();
  let grant: Promise<PromiseSettledResult<unknown>[]> | undefined;
  let page: Promise<PromiseSettledResult<unknown>[]> | undefined;
  const blocked = async (pattern: string) => {
    for (let observations = 0; observations < 200; observations++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const result = await holder.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1", [pattern]);
      if (result.rows[0].n > 0) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Production operation did not reach expected lock: ${pattern}`);
  };
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM office WHERE id=$1 FOR UPDATE', [officeId]);
    grant = Promise.allSettled([changeAccess(context, { action: 'participant', caseId, userId: guestId, add: true })]);
    await blocked('SELECT id FROM office WHERE%FOR UPDATE');
    page = Promise.allSettled([createPage(context, { caseId, title: 'Página concorrente', content: 'Texto' })]);
    await blocked('INSERT INTO case_page(%');
    await holder.query('COMMIT');
    const results = [...await grant, ...await page];
    const outcomes = results.map(result => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, code: result.reason?.code, message: result.reason?.message });
    console.log(JSON.stringify({ actualProductionOutcomes: outcomes }));
    assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled'], 'Participant management and content creation must not acquire office/gate locks in opposite order');
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await Promise.all([grant, page]);
  }
});
