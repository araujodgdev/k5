import './test-setup';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

let apiError: typeof import('../src/lib/workspace-api').apiError;
let vaultErrorResponse: typeof import('../src/lib/vault-api').vaultErrorResponse;
let VaultHttpError: typeof import('../src/lib/vault').VaultHttpError;
let ApiError: typeof import('../src/lib/workspace-api').ApiError;
let NotificationRequestError: typeof import('../src/lib/notifications/contracts').NotificationRequestError;
let PlatformRequestError: typeof import('../src/lib/platform-core').PlatformRequestError;
let platformErrorResponse: typeof import('../src/lib/platform-core').platformErrorResponse;
before(async () => {
  process.env.BETTER_AUTH_SECRET ??= 'error-response-test-secret-at-least-32-characters';
  ({ apiError, ApiError } = await import('../src/lib/workspace-api'));
  ({ vaultErrorResponse } = await import('../src/lib/vault-api'));
  ({ VaultHttpError } = await import('../src/lib/vault'));
  ({ NotificationRequestError } = await import('../src/lib/notifications/contracts'));
  ({ PlatformRequestError, platformErrorResponse } = await import('../src/lib/platform-core'));
});

test('typed server errors preserve status while hiding private messages and stack traces', async () => {
  const privateMessage = 'private-user-data database-url provider-token SELECT password';
  const responses = [
    apiError(new ApiError(503, privateMessage)),
    apiError(new VaultHttpError(500, privateMessage)),
    apiError(new NotificationRequestError(503, privateMessage)),
    vaultErrorResponse(new VaultHttpError(500, privateMessage)),
    vaultErrorResponse(new ApiError(503, privateMessage)),
    platformErrorResponse(new PlatformRequestError(503, privateMessage)),
    apiError(new Error(privateMessage)),
  ];
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, [503, 500, 503, 500, 503, 503, 500][index]);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(String(body.error).includes(privateMessage), false);
  }
  const validation = apiError(new ApiError(400, 'Confira o arquivo enviado.'));
  assert.equal(validation.status, 400);
  assert.deepEqual(await validation.json(), { error: 'Confira o arquivo enviado.' });
});
