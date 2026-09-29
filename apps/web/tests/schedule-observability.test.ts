import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/node';
import { observeSchedule } from '../src/lib/observability/report';

test('cron transport receives start and matching success/failure check-ins with a missed-run schedule', async () => {
  const envelopes: unknown[] = [];
  const buffered: unknown[] = [];
  Sentry.init({ dsn: 'https://public@example.invalid/1', enabled: true, environment: 'test',
    defaultIntegrations: false, transport: () => ({
      send: async envelope => { buffered.push(envelope); return { statusCode: 200 }; },
      flush: async () => { envelopes.push(...buffered.splice(0)); return true; },
    }),
  });
  try {
    assert.equal(await observeSchedule('test-monitor', async () => {
      assert.match(JSON.stringify(envelopes), /"status":"in_progress"/);
      assert.doesNotMatch(JSON.stringify(envelopes), /"status":"ok"/);
      return 42;
    }), 42);
    await assert.rejects(observeSchedule('test-monitor', async () => { throw new Error('fixture failure'); }), /fixture failure/);
    await Sentry.flush(1000);
    const serialized = JSON.stringify(envelopes);
    assert.equal((serialized.match(/"status":"in_progress"/g) ?? []).length, 2);
    assert.equal((serialized.match(/"status":"ok"/g) ?? []).length, 1);
    assert.equal((serialized.match(/"status":"error"/g) ?? []).length, 1);
    assert.match(serialized, /"schedule":\{"type":"crontab","value":"\* \* \* \* \*"\}/);
    assert.match(serialized, /"checkin_margin":2/);
    assert.doesNotMatch(serialized, /fixture failure/);
  } finally { await Sentry.close(1000); }
});

test('a failed telemetry flush does not prevent scheduled work', async () => {
  Sentry.init({ dsn: 'https://public@example.invalid/1', enabled: true,
    defaultIntegrations: false, transport: () => ({
      send: async () => ({ statusCode: 200 }),
      flush: async () => { throw new Error('transport unavailable'); },
    }),
  });
  try {
    assert.equal(await observeSchedule('test-monitor', async () => 42), 42);
  } finally { await Sentry.close(1000).catch(() => false); }
});
