import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentScope } from '@sentry/core';
import { diagnosticTags } from '../src/lib/observability/diagnostics';
import { captureOperationalError } from '../src/lib/observability/report';

test('operational errors retain allowlisted causes and correlation tags without provider content', t => {
  const sent: { error: unknown; hint: unknown }[] = [];
  t.mock.method(getCurrentScope(), 'captureException', (error: unknown, hint: unknown) => {
    sent.push({ error, hint }); return 'event-id';
  });
  const cause = Object.assign(new Error('password=secret; client document'), { code: '23505', detail: 'private row' });
  const error = new Error('provider response contains a secret', { cause });
  error.name = 'private-provider-secret';
  error.stack = 'private\n    at secret (https://private.invalid/credentials.js:1:1)';
  assert.equal(captureOperationalError(error, 'documents.container', { processor: 'documents' }), 'event-id');
  assert.deepEqual(sent[0].hint, { captureContext: { tags: { database_code: '23505', failure_kind: 'database', processor: 'documents', operation: 'documents.container' }, fingerprint: ['lume', 'documents.container', 'default'] } });
  assert.ok(sent[0].error instanceof Error);
  assert.doesNotMatch(sent[0].error.stack ?? '', /password|secret|private row/);
  assert.equal(sent[0].error.cause, undefined);
  assert.equal(sent[0].error.name, 'Error');
  assert.match(sent[0].error.stack ?? '', /captureOperationalError/);
});

test('diagnostics classify HTTP and network causes without arbitrary error properties', () => {
  assert.deepEqual(diagnosticTags({ status: 429, message: 'private' }), { http_status: '429', failure_kind: 'rate_limit' });
  assert.deepEqual(diagnosticTags({ statusCode: 401 }), { http_status: '401', failure_kind: 'credential' });
  assert.deepEqual(diagnosticTags(new Error('private', { cause: { code: 'ETIMEDOUT' } })), { network_code: 'ETIMEDOUT', failure_kind: 'timeout' });
  assert.deepEqual(diagnosticTags({ code: 'private-user-id', status: 900 }), {});
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.deepEqual(diagnosticTags(cycle), {});
});
