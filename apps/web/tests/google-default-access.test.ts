import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { googleFixture } from './google-fixture';
import { getStatus } from '../src/lib/application/google-service';
import { requireConnection, startGoogleConnect } from '../src/lib/google/connections';
import { acceptCalendarNotification, scheduleCalendarWork } from '../src/lib/google/calendar/sync';

test('Google is available without rollout rows; explicit office blocks still apply', async () => {
  const owner = await googleFixture({ modules: [], connect: false });
  const status = await getStatus(owner.context);
  assert.ok(status.configured);
  assert.ok(status.modules.every(module => module.rolledOut && module.enabledByOffice));
  const sessionId = randomUUID();
  await testDb.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt)
    VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(sessionId, owner.userId, randomUUID());
  const context = { ...owner.context, sessionId };
  assert.ok((await startGoogleConnect(context, ['gmail'])).url);
  await testDb.prepare('INSERT INTO google_rollout(office_id,module,enabled) VALUES(?,?,0)').run(owner.officeId, 'gmail');
  await assert.rejects(startGoogleConnect(context, ['gmail']), { code: 'FORBIDDEN' });
  const blocked = await getStatus(owner.context);
  assert.equal(blocked.modules.find(module => module.module === 'gmail')?.rolledOut, false);
  assert.equal(blocked.modules.find(module => module.module === 'drive')?.rolledOut, true);
});

test('Calendar schedules and accepts push without rollout rows, but honors explicit blocks', async () => {
  const owner = await googleFixture({ modules: [], grantedModules: ['calendar'] });
  const calendarId = randomUUID(), channelId = randomUUID(), token = randomUUID();
  await testDb.prepare(`INSERT INTO google_calendar(id,office_id,user_id,connection_id,google_calendar_id,summary,access_role,selected,channel_id,channel_resource_id,channel_token_hash)
    VALUES(?,?,?,?,?,'Pessoal','owner',1,?,'resource',?)`)
    .run(calendarId, owner.officeId, owner.userId, owner.connectionId, 'primary', channelId, createHash('sha256').update(token).digest('hex'));
  await requireConnection(owner.context, 'calendar');
  await scheduleCalendarWork(testDb);
  const jobs = await testDb.prepare('SELECT kind FROM google_job WHERE connection_id=?').all<{kind: string}>(owner.connectionId);
  assert.ok(jobs.some(job => job.kind === 'calendar_sync'));
  assert.ok(jobs.some(job => job.kind === 'calendar_list'));
  const headers = new Headers({ 'x-goog-channel-id': channelId, 'x-goog-resource-id': 'resource',
    'x-goog-channel-token': token, 'x-goog-resource-state': 'exists', 'x-goog-message-number': '1' });
  assert.equal(await acceptCalendarNotification(headers, testDb), 'queued');
  await testDb.prepare('INSERT INTO google_rollout(office_id,module,enabled) VALUES(?,?,0)').run(owner.officeId, 'calendar');
  await testDb.prepare('DELETE FROM google_job WHERE connection_id=?').run(owner.connectionId);
  await assert.rejects(requireConnection(owner.context, 'calendar'), { code: 'FORBIDDEN' });
  await scheduleCalendarWork(testDb);
  assert.deepEqual(await testDb.prepare('SELECT id FROM google_job WHERE connection_id=?').all(owner.connectionId), []);
  assert.equal(await acceptCalendarNotification(headers, testDb), 'ignored');
});
