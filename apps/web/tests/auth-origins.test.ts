import assert from 'node:assert/strict';
import test from 'node:test';
import { authOrigins } from '../src/lib/auth-origins';
import { isTrustedOrigin } from '../src/lib/trusted-origins';

test('public production trusts only the canonical HTTPS domain', () => {
  const { trustedOrigins } = authOrigins({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://lume.software/' });
  assert.deepEqual(trustedOrigins, ['https://lume.software']);
  assert.equal(isTrustedOrigin('https://lume.software', trustedOrigins), true);
  for (const origin of ['https://evil.test', 'https://lume.software.evil.test', 'http://lume.software', 'https://lume.software:8443', 'null'])
    assert.equal(isTrustedOrigin(origin, trustedOrigins), false);
});

test('production refuses missing origins, public HTTP, wildcard tunnels, and extra domains', () => {
  assert.throws(() => authOrigins({ NODE_ENV: 'production' }), /BETTER_AUTH_URL/);
  assert.throws(() => authOrigins({ K5_RUNTIME: 'cloudflare' }), /BETTER_AUTH_URL/);
  assert.throws(() => authOrigins({ NODE_ENV: 'production', BETTER_AUTH_URL: 'http://lume.software' }), /HTTPS/);
  for (const extra of ['https://*.trycloudflare.com', 'https://evil.test'])
    assert.throws(() => authOrigins({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://lume.software', BETTER_AUTH_TRUSTED_ORIGINS: extra }), /origens adicionais/);
  for (const url of ['https://user:password@lume.software', 'https://lume.software/app', 'https://lume.software?token=private', 'file:///tmp/app'])
    assert.throws(() => authOrigins({ BETTER_AUTH_URL: url }));
});

test('local builds and development tunnels remain usable', () => {
  assert.equal(authOrigins({ NODE_ENV: 'production', BETTER_AUTH_URL: 'http://localhost:3000' }).baseURL, 'http://localhost:3000');
  const { trustedOrigins } = authOrigins({ BETTER_AUTH_TRUSTED_ORIGINS: 'https://*.trycloudflare.com' });
  assert.equal(isTrustedOrigin('https://test.trycloudflare.com', trustedOrigins), true);
});
