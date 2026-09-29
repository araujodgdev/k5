import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresFixture } from './postgres-fixture';
import { claimMonitoringRun, finishMonitoringRun } from '../src/lib/observability/monitoring-run';

test('only one synthetic runner can write and an expired runner cannot release its replacement', async () => {
  const { db } = await postgresFixture();
  const now = Date.now();
  const claims = await Promise.all([claimMonitoringRun(db, 'journeys', now), claimMonitoringRun(db, 'journeys', now)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean);
  assert.ok(first);
  const replacement = await claimMonitoringRun(db, 'journeys', now + 8 * 60_000);
  assert.ok(replacement);
  assert.notEqual(first, replacement);
  assert.equal((await finishMonitoringRun(db, 'journeys', first, 'ok', {})).changes, 0);
  assert.equal((await finishMonitoringRun(db, 'journeys', replacement, 'ok', { stages: 10 })).changes, 1);
  const record = await db.prepare('SELECT status,lease_token,last_success_at,result_json FROM monitoring_run WHERE name=?').get('journeys');
  assert.equal(record?.status, 'ok');
  assert.equal(record?.lease_token, null);
  assert.ok(record?.last_success_at);
  assert.deepEqual(record?.result_json, { stages: 10 });
  const third = await claimMonitoringRun(db, 'journeys');
  assert.ok(third);
  await finishMonitoringRun(db, 'journeys', third, 'error', { stage: 'sign_in' });
  const failed = await db.prepare('SELECT status,last_success_at FROM monitoring_run WHERE name=?').get('journeys');
  assert.equal(failed?.status, 'error');
  assert.equal(failed?.last_success_at, record?.last_success_at);
});
