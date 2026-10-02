import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

const caseIds = () => fetch('/api/vault/cases').then(response => response.json()).then((body: { cases: { id: string }[] }) => body.cases.map(item => item.id));

// Office isolation across real accounts. The owner invites through the case page once, then acts
// over the API; the browser follows the guest, on a phone, through every grant and revocation.
test('colaboração entre escritórios: convite no caso, permissões, revogação, associados, equipe e troca de escritório', async ({ app, screen, browser }) => {
  const owner = uniqueAccount('Dona');
  const guest = uniqueAccount('Parceira');
  const ownerApi = await new ApiSession(app.baseUrl!).signIn(owner);
  const guestApi = await new ApiSession(app.baseUrl!).signIn(guest);
  const { user: guestUser } = await guestApi.json<{ user: { id: string } }>('/api/auth/get-session');
  const caseName = 'Validação de colaboração entre escritórios';
  const { case: record } = await ownerApi.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: caseName } });
  const casePath = `/app/vault/cases/${record.id}`;
  const invite = (invitation: Record<string, unknown>) => ownerApi.json('/api/collaboration', { json: { action: 'invite', invitation: { email: guest.email, ...invitation } } });

  await signInWithSession({ app, screen, browser }, ownerApi);
  await app.open(casePath);
  await screen.getByRole('button', 'Participantes').tap();
  await screen.getByRole('button', 'Convidar participante').tap();
  await screen.getByLabel('E-mail da pessoa').fill(guest.email);
  await screen.getByLabel('Permissão').selectOption({ value: 'viewer' });
  await screen.getByRole('button', 'Criar convite').tap();
  await expect(screen.getByLabel('Link do convite')).toBeVisible();
  const invitationUrl = await screen.getByLabel('Link do convite').inputValue();
  await browser.keyboard.press('Tab');
  expect(await browser.evaluate(() => document.activeElement !== document.body)).toBe(true);

  await app.clearState();
  await browser.setViewport({ width: 390, height: 844 });
  await signInWithSession({ app, screen, browser }, guestApi);
  await app.open('/app/agenda?view=invites');
  await expect(screen.getByRole('button', 'Aceitar convite')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Aceitar convite').tap();
  await browser.waitForURL(new RegExp(`${casePath}$`));
  // A viewer neither uploads nor creates folders.
  await expect(screen.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(screen.getByRole('button', 'Enviar arquivos')).toHaveCount(0);
  expect((await guestApi.request('/api/vault/folders', { json: { caseId: record.id, name: 'Proibida' } })).status).toBe(403);

  await ownerApi.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: guestUser.id, role: 'editor', canInvite: false } });
  await browser.reload();
  await expect(screen.getByRole('button', 'Enviar arquivos')).toBeVisible();
  await browser.locator('input[type=file]').first().setInputFiles(['e2e/fixtures/colaboracao-validacao.txt']);
  await expect(screen.getByText('colaboracao-validacao.txt').first()).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  const { documents } = await guestApi.json<{ documents: { id: string; name: string }[] }>(`/api/vault/documents?caseId=${record.id}`);
  const uploaded = documents.find(item => item.name === 'colaboracao-validacao.txt')!;
  expect(uploaded).toBeDefined();
  const download = await guestApi.request(`/api/vault/documents/${uploaded.id}/download`);
  expect(download.status).toBe(200);
  expect(await download.text()).toMatch(/Recife/);

  await screen.getByRole('button', 'Ações').tap();
  await screen.getByRole('menuitem', 'Conversar sobre o caso').tap();
  await screen.getByRole('button', 'Fontes').tap();
  await expect(screen.getByRole('heading', 'Fontes desta conversa').last()).toBeVisible();
  await expect(screen.getByText('colaboracao-validacao.txt').first()).toBeVisible();
  await expect(browser.locator('#sources-case')).toContainText('Validação de colaboração');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  // An editor cannot move the file out of the case, and a foreign origin is refused.
  expect((await guestApi.request(`/api/vault/documents/${uploaded.id}`, { method: 'PATCH', json: { caseId: null } })).status).toBe(403);
  expect((await guestApi.request('/api/collaboration', { json: { action: 'invite', invitation: { kind: 'team', email: owner.email, role: 'lawyer' } }, origin: 'https://outra-origem.example' })).status).toBe(403);
  await ownerApi.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: guestUser.id, role: null } });
  expect((await guestApi.request(`/api/vault/documents/${uploaded.id}/download`)).status).toBe(404);
  expect((await guestApi.request(`/api/vault/documents?caseId=${record.id}`)).status).toBe(404);
  await app.open(invitationUrl);
  await expect(screen.getByText('Este convite já foi respondido, cancelado ou expirou.')).toBeVisible();

  // An associate sees the owner's profile, not the case.
  await invite({ kind: 'associate' });
  await app.open('/app/agenda?view=invites');
  await screen.getByRole('button', 'Aceitar convite').tap();
  await expect(screen.getByRole('status').filter({ hasText: 'Convite aceito' })).toBeVisible();
  expect((await guestApi.request(`/api/vault/documents?caseId=${record.id}`)).status).toBe(404);
  await ownerApi.json('/api/collaboration', { json: { action: 'associate', userId: guestUser.id } });

  // A team member switches into the owner's office and sees its cases, until removed.
  await invite({ kind: 'team', role: 'lawyer' });
  await app.open('/app/agenda?view=invites');
  await screen.getByRole('button', 'Aceitar convite').tap();
  await expect(screen.getByRole('status').filter({ hasText: 'Convite aceito' })).toBeVisible();
  const officeSelect = screen.getByLabel('Escritório ativo');
  await expect(officeSelect).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  const originalOfficeId = await officeSelect.inputValue();
  const choices = await browser.evaluate(() => {
    const select = [...document.querySelectorAll('select')].find(element => element.getAttribute('aria-label') === 'Escritório ativo'
      || [...(element.labels ?? [])].some(label => label.textContent?.trim() === 'Escritório ativo'));
    return [...(select?.options ?? [])].map(option => option.value);
  });
  await officeSelect.selectOption({ value: choices.find(id => id && id !== originalOfficeId)! });
  await browser.waitForURL(/\/app\/agenda\?view=team$/);
  await expect(screen.getByText(owner.email)).toBeVisible();
  expect(await browser.evaluate(caseIds)).toContain(record.id);
  expect((await guestApi.request('/api/offices/active', { json: { officeId: 'not-a-membership' } })).status).toBe(403);
  await ownerApi.json('/api/collaboration', { json: { action: 'member', userId: guestUser.id, role: null } });
  expect(await browser.evaluate(caseIds)).not.toContain(record.id);

  await browser.route('**/api/collaboration', route => route.fulfill({ status: 503, json: { error: 'Falha temporária de validação.' } }));
  await app.open('/app/agenda?view=invites');
  await expect(screen.getByRole('alert').filter({ hasText: 'Falha temporária' })).toBeVisible();
  await browser.unroute('**/api/collaboration');
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(screen.getByText('Nenhum convite pendente para sua conta.')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
