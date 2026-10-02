import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

// Fresh accounts per run: this test changes e-mail and password, and a password change ends the
// account's other sessions, so it must never touch the shared admin session.
test('perfil, foto, credenciais e convite de associado com o card do perfil', async ({ app, screen, browser, sql }) => {
  const person = uniqueAccount('Vera');
  const partner = uniqueAccount('Bia');
  const personApi = await new ApiSession(app.baseUrl!).signIn(person);
  const partnerApi = await new ApiSession(app.baseUrl!).signIn(partner);
  await partnerApi.json('/api/profile', { method: 'PATCH', json: { name: 'Bia Parceira', headline: 'Direito previdenciário', oab: 'MG 98.765', location: 'Belo Horizonte, MG', bio: 'Parcerias em ações previdenciárias.' } });
  await signInWithSession({ app, screen, browser }, personApi);

  await app.open('/app/profile');
  await expect(screen.getByRole('heading', { name: 'Perfil', level: 1 })).toBeAttached();
  await screen.getByLabel('Nome').fill('Vera Verificação');
  await screen.getByLabel('Atuação').fill('Advocacia trabalhista');
  await screen.getByLabel('OAB').fill('SP 123.456');
  await screen.getByLabel('Cidade').fill('São Paulo, SP');
  await screen.getByLabel('Sobre').fill('Atuo em reclamatórias e busco parcerias no interior.');
  await screen.getByRole('button', 'Salvar perfil').tap();
  await expect(screen.getByText('Perfil salvo.')).toBeVisible();
  expect(await sql(`SELECT u.name, p.headline, p.oab FROM "user" u JOIN user_profile p ON p.user_id=u.id WHERE u.email=$1`, [person.email]))
    .toEqual([{ name: 'Vera Verificação', headline: 'Advocacia trabalhista', oab: 'SP 123.456' }]);

  // The browser crops and shrinks the photo before upload.
  await browser.locator('input[type=file]').setInputFiles(['e2e/fixtures/foto-perfil.png']);
  await expect(screen.getByRole('button', 'Trocar foto')).toBeVisible();
  const [photo] = await sql<{ avatar_type: string }>(`SELECT p.avatar_type FROM user_profile p JOIN "user" u ON u.id=p.user_id WHERE u.email=$1`, [person.email]);
  expect(['image/webp', 'image/jpeg']).toContain(photo.avatar_type);
  await browser.reload();
  await expect(screen.getByLabel('Nome')).toHaveValue('Vera Verificação');
  await expect.poll(() => browser.evaluate(() => [...document.querySelectorAll('a')]
    .find(link => link.textContent?.includes('Vera Verificação'))?.querySelector('img')?.naturalWidth ?? 0)).toBe(256);

  // Credential changes verify the current password (a deliberately slow hash); allow for a busy server.
  const hashed = { timeout: 30_000 };
  const newPassword = `${person.password}-nova`;
  await screen.getByLabel('Senha atual').nth(1).fill(person.password);
  await screen.getByLabel('Nova senha').fill(newPassword);
  await screen.getByLabel('Confirmar nova senha').fill(newPassword);
  await screen.getByRole('button', 'Alterar senha').tap();
  await expect(screen.getByText('Senha alterada. As outras sessões foram encerradas.')).toBeVisible(hashed);

  const emailForm = browser.locator('form').filter({ has: screen.getByRole('heading', 'E-mail') });
  const changedEmail = person.email.replace('@', '-novo@');
  await emailForm.getByLabel('Novo e-mail').fill(changedEmail);
  await emailForm.getByLabel('Senha atual').fill('senha-errada-123');
  await emailForm.getByRole('button', 'Alterar e-mail').tap();
  await expect(emailForm.getByText('Senha atual incorreta.')).toBeVisible(hashed);
  await emailForm.getByLabel('Novo e-mail').fill(partner.email);
  await emailForm.getByLabel('Senha atual').fill(newPassword);
  await emailForm.getByRole('button', 'Alterar e-mail').tap();
  await expect(emailForm.getByText('Este e-mail já está em uso por outra conta.')).toBeVisible(hashed);
  await emailForm.getByLabel('Novo e-mail').fill(changedEmail);
  await emailForm.getByRole('button', 'Alterar e-mail').tap();
  await expect(emailForm.getByText(`Pronto. Agora você entra com ${changedEmail}.`)).toBeVisible(hashed);
  expect(await sql(`SELECT 1 AS found FROM "user" WHERE email=$1`, [changedEmail])).toEqual([{ found: 1 }]);

  await app.open('/app/agenda?view=associates');
  await screen.getByRole('button', 'Convidar associado').tap();
  await screen.getByLabel('E-mail do advogado').fill(partner.email);
  await expect(screen.getByText('já usa o Lume', { exact: false })).toBeVisible();
  await screen.getByRole('button', `Ver perfil de ${partner.email}`).hover();
  const card = browser.locator('[data-slot=hover-card-content]');
  await expect(card.getByText('OAB MG 98.765 · Belo Horizonte, MG')).toBeVisible();
  await expect(card.getByText('Direito previdenciário')).toBeVisible();
  await screen.getByLabel('E-mail do advogado').fill(`ninguem-${Date.now().toString(36)}@k5.test`);
  await expect(screen.getByText('Ainda não tem conta no Lume.', { exact: false })).toBeVisible();
  await screen.getByLabel('E-mail do advogado').fill(partner.email);
  await screen.getByRole('button', 'Criar convite').tap();
  await expect(screen.getByText('Convite disponível na conta da pessoa.', { exact: false })).toBeVisible();

  const { incoming } = await partnerApi.json<{ incoming: { id: string }[] }>('/api/collaboration');
  await partnerApi.json('/api/collaboration', { json: { action: 'respond', id: incoming[0].id, accept: true } });
  await browser.reload();
  // The card opens from the keyboard too.
  await screen.getByRole('button', `Ver perfil de ${partner.email}`).focus();
  await expect(card.getByText('Parcerias em ações previdenciárias.')).toBeVisible();

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/profile');
  await expect(screen.getByRole('button', 'Salvar perfil')).toBeAttached();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Mais', { exact: false }).tap();
  await expect(screen.getByRole('dialog').getByRole('link', /Vera Verificação/)).toHaveAttribute('aria-current', 'page');
  await browser.keyboard.press('Escape');
  await app.open('/app/agenda?view=associates');
  await screen.getByRole('button', `Ver perfil de ${partner.email}`).tap();
  await expect(card.getByText('Direito previdenciário')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
