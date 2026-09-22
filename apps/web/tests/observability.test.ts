import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { ErrorEvent, TransactionEvent } from '@sentry/core';
import { serverOptions } from '../src/lib/observability/options';
import { beforeBreadcrumb, scrubEvent, telemetryUrl } from '../src/lib/observability/privacy';
import { sampleRate } from '../src/lib/observability/settings';
import { observeWorkerTask } from '../src/lib/observability/report';

test('observed worker preserves the task default argument before a SQLite claim', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const row = await observeWorkerTask('research.extract', async (workerId = 'expected-worker') =>
      db.prepare('SELECT ? AS owner').get(workerId));
    assert.equal(row?.owner, 'expected-worker');
  } finally { db.close(); }
});

test('telemetry is opt-in in development/test, enabled in staging, and can be disabled', () => {
  assert.equal(serverOptions('web', {}).enabled, false);
  assert.equal(serverOptions('web', { NODE_ENV: 'test' }).enabled, false);
  assert.equal(serverOptions('web', { SENTRY_ENVIRONMENT: 'staging' }).enabled, true);
  assert.equal(serverOptions('web', { SENTRY_ENVIRONMENT: 'staging', SENTRY_ENABLED: 'false' }).enabled, false);
  assert.equal(serverOptions('web', { SENTRY_ENABLED: 'true' }).enabled, true);
  assert.equal(serverOptions('web', { SENTRY_ENABLED: 'true', SENTRY_DSN: '' }).enabled, false);
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', '']) assert.equal(sampleRate(value), 0.1);
  assert.equal(sampleRate('0'), 0);
  assert.equal(sampleRate('1'), 1);
});

test('error events keep stack locations but discard request and office data', () => {
  const event: ErrorEvent = {
    type: undefined,
    user: { id: 'office-user', email: 'client@example.com', ip_address: '192.0.2.1' },
    extra: { prompt: 'private document', apiKey: 'secret' },
    request: { method: 'POST', url: 'https://user:password@lume.test/api/chat?token=secret#private',
      headers: { authorization: 'Bearer secret' }, data: 'private document', cookies: { session: 'secret' } },
    contexts: { office: { client: 'private' }, trace: { trace_id: 'trace', span_id: 'span', data: { prompt: 'private' } } },
    exception: { values: [{ type: 'Error', value: 'Failure', stacktrace: { frames: [{ filename: 'worker.ts', lineno: 21,
      vars: { document: 'private' }, pre_context: ['secret'], context_line: 'private', post_context: ['secret'] }] } }] },
  };
  const safe = scrubEvent(event);
  assert.deepEqual(safe.request, { method: 'POST', url: 'https://lume.test/api/chat' });
  assert.equal(safe.user, undefined);
  assert.equal(safe.sdk?.settings?.infer_ip, 'never');
  assert.equal(safe.extra, undefined);
  assert.equal(safe.contexts?.office, undefined);
  assert.equal(safe.contexts?.trace?.data, undefined);
  assert.deepEqual(safe.exception?.values?.[0].stacktrace?.frames?.[0], { filename: 'worker.ts', lineno: 21 });
});

test('breadcrumbs and traces discard console content, SQL literals and AI prompts', () => {
  assert.equal(beforeBreadcrumb({ category: 'console', message: 'private' }), null);
  assert.equal(beforeBreadcrumb({ category: 'ui.click', message: 'client@example.com' }), null);
  assert.equal(telemetryUrl('/app/documents/550e8400-e29b-41d4-a716-446655440000?text=private'), '/app/documents/[id]');
  const event: TransactionEvent = { type: 'transaction', transaction: 'GET /app/documents/550e8400-e29b-41d4-a716-446655440000?text=private', spans: [{
    trace_id: 'trace', span_id: 'span', start_timestamp: 1, timestamp: 2,
    op: 'db.query', description: "SELECT * FROM clients WHERE name='Private Name'",
    data: { 'db.query.text': 'private', 'gen_ai.prompt': 'private', 'http.request.body': 'private', 'gen_ai.usage.input_tokens': 15 },
  }] };
  const safe = scrubEvent(event);
  assert.equal(safe.transaction, 'GET /app/documents/[id]');
  assert.equal(safe.spans?.[0].description, 'db.query');
  assert.deepEqual(safe.spans?.[0].data, { 'gen_ai.usage.input_tokens': 15 });
});
