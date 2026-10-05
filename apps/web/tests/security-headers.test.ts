import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SECURITY_HEADERS, withSecurityHeaders } from '../src/lib/security-headers';

test('security headers: a page cannot be framed by another site and keeps the rest of its response', async () => {
  const response = withSecurityHeaders(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers.get(name), value);
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'self'");
  assert.equal(response.headers.get('content-type'), 'text/html');
  assert.equal(await response.text(), '<html>');
});

test('security headers: a route keeps its own values and its sandbox policy', () => {
  const response = withSecurityHeaders(new Response(null, { headers: {
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox" } }));
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  // Two policies, both enforced: the route's sandbox and the framing rule.
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox, frame-ancestors 'self'");
});

test('security headers: static assets repeat every worker header, including Permissions-Policy', () => {
  const file = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const globalBlock = file.split('\n/sw.js\n')[0];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.ok(globalBlock.includes(`  ${name}: ${value}`), `${name} missing from public/_headers`);
  }
  assert.ok(globalBlock.includes("  Content-Security-Policy: frame-ancestors 'self'"));
});

test('security headers: immutable responses such as redirects are copied, not left bare', () => {
  const response = withSecurityHeaders(Response.redirect('https://lume.software/sign-in', 307));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://lume.software/sign-in');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
});
