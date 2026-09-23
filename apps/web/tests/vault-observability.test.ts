import './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentScope } from '@sentry/core';
import { vaultErrorResponse } from '../src/lib/vault-api';
import { VaultHttpError } from '../src/lib/vault';

test('vault failures reach Sentry without exposing private error messages; expected validation stays quiet', async t => {
  const captured: unknown[] = [];
  t.mock.method(getCurrentScope(), 'captureException', (error: unknown) => { captured.push(error); return 'test-event'; });
  const response = vaultErrorResponse(new Error('private document and credential'));
  assert.equal(response.status, 500);
  assert.equal(captured.length, 1);
  assert.match((captured[0] as Error).message, /vault.api.unhandled/);
  assert.doesNotMatch((captured[0] as Error).stack!, /private document|credential/);
  assert.doesNotMatch(await response.text(), /private document|credential/);
  assert.equal(vaultErrorResponse(new VaultHttpError(400, 'Arquivo inválido.')).status, 400);
  assert.equal(captured.length, 1);
  assert.equal(vaultErrorResponse(new VaultHttpError(503, 'Indisponível.')).status, 503);
  assert.equal(captured.length, 2);
});
