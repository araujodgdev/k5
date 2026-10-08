import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';

test('APIs privadas recusam acesso anônimo e não permitem cache compartilhado', async ({ app }) => {
  const anonymous = new ApiSession(app.baseUrl!);
  for (const path of ['/api/profile', '/api/home', '/api/platform/offices', '/api/vault/cases']) {
    const response = await anonymous.request(path);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('access-control-allow-origin')).toBe(null);
  }
});

test('uma sessão válida não permite alterar o perfil a partir de outro domínio', async ({ app }) => {
  const account = uniqueAccount('Segurança');
  const session = await new ApiSession(app.baseUrl!).signIn(account);
  const before = await session.json<{ profile: { name: string } }>('/api/profile');
  const response = await session.request('/api/profile', { method: 'PATCH', origin: 'https://evil.test',
    json: { name: 'Alterado pelo invasor', headline: '', oab: '', location: '', bio: '' } });
  expect(response.status).toBe(403);
  expect(response.headers.get('access-control-allow-origin')).toBe(null);
  const after = await session.json<{ profile: { name: string } }>('/api/profile');
  expect(after.profile.name).toBe(before.profile.name);
});

test('o adaptador de capabilities preserva o limite de corpo e recusa formatos inválidos', async ({ app }) => {
  const session = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Validação'));
  const oversized = await session.request('/api/vault/cases', { json: { name: 'x'.repeat(300_000) } });
  expect(oversized.status).toBe(413);
  const invalid = await session.request('/api/vault/cases', { json: ['nome indevido'] });
  expect(invalid.status).toBe(400);
  const result = await session.json<{ cases: unknown[] }>('/api/vault/cases');
  expect(result.cases.length).toBe(0);
});
