/**
 * Feature profile: edit the personal profile and photo on /app/profile, change password and
 * e-mail (then restore both), and see another Lume user's card while inviting them as associate.
 */
import { expect, openApp } from './session.mts';

const suffix = Date.now().toString(36);
const partner = { name: 'Bia Parceira', email: `bia-${suffix}@k5.test`, password: 'ParceiraK5!2026#segura', officeName: 'Parceira Advocacia' };
const app = await openApp('profile');
const { page, shot, sql, log, state } = app;
const original = state.account;
const newPassword = 'NovaSenhaK5!2026#segura';
const changedEmail = `vera-${suffix}@k5.test`;
try {
  // A second Lume account, created through the real sign-up and profile endpoints.
  const other = await page.context().browser()!.newContext({ baseURL: state.baseURL });
  const headers = { origin: state.baseURL };
  expect((await other.request.post('/api/auth/sign-up/email', { data: partner, headers })).ok()).toBe(true);
  expect((await other.request.patch('/api/profile', { headers, data: { name: partner.name, headline: 'Direito previdenciário', oab: 'MG 98.765', location: 'Belo Horizonte, MG', bio: 'Parcerias em ações previdenciárias.' } })).ok()).toBe(true);

  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { name: 'Perfil', level: 1 })).toBeAttached();
  await shot('perfil-inicial');
  await page.getByLabel('Nome', { exact: true }).fill('Vera Verificação');
  await page.getByLabel('Atuação', { exact: true }).fill('Advocacia trabalhista');
  await page.getByLabel('OAB', { exact: true }).fill('SP 123.456');
  await page.getByLabel('Cidade', { exact: true }).fill('São Paulo, SP');
  await page.getByLabel('Sobre', { exact: true }).fill(`Atuo em reclamatórias e busco parcerias no interior (${suffix}).`);
  await shot('perfil-preenchido');
  await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
  await expect(page.getByText('Perfil salvo.')).toBeVisible();
  const [row] = await sql<{ name: string; headline: string; oab: string }>(`SELECT u.name, p.headline, p.oab FROM "user" u JOIN user_profile p ON p.user_id=u.id WHERE u.email=$1`, [original.email]);
  expect(row).toEqual({ name: 'Vera Verificação', headline: 'Advocacia trabalhista', oab: 'SP 123.456' });
  log(`PASS perfil (/app/profile): dados salvos em user_profile e o nome em "user" (${row.name}).`);

  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 600, height: 400 });
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d97757'; context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#232323'; context.fillRect(200, 100, 200, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: 'Trocar foto', exact: true })).toBeVisible();
  const [photo] = await sql<{ avatar_type: string; bytes: number }>(`SELECT p.avatar_type, octet_length(p.avatar) AS bytes FROM user_profile p JOIN "user" u ON u.id=p.user_id WHERE u.email=$1`, [original.email]);
  expect(['image/webp', 'image/jpeg']).toContain(photo.avatar_type);
  await page.reload();
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Vera Verificação');
  const sidebarPhoto = page.getByRole('link', { name: /Vera Verificação/ }).locator('img');
  await expect(sidebarPhoto).toBeVisible();
  expect(await sidebarPhoto.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(256);
  await shot('perfil-com-foto');
  log(`PASS foto: recortada e reduzida no navegador (${photo.avatar_type}, ${photo.bytes} bytes, 256px), persiste e aparece no menu lateral.`);

  await page.getByLabel('Senha atual', { exact: true }).nth(1).fill(original.password);
  await page.getByLabel('Nova senha', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await expect(page.getByText('Senha alterada. As outras sessões foram encerradas.')).toBeVisible();
  log('PASS senha: alterada com a senha atual, com as outras sessões encerradas.');

  const emailForm = page.locator('form', { has: page.getByRole('heading', { name: 'E-mail' }) });
  await emailForm.getByLabel('Novo e-mail', { exact: true }).fill(changedEmail);
  await emailForm.getByLabel('Senha atual', { exact: true }).fill('senha-errada-123');
  await emailForm.getByRole('button', { name: 'Alterar e-mail', exact: true }).click();
  await expect(emailForm.getByText('Senha atual incorreta.')).toBeVisible();
  await emailForm.getByLabel('Novo e-mail', { exact: true }).fill(partner.email);
  await emailForm.getByLabel('Senha atual', { exact: true }).fill(newPassword);
  await emailForm.getByRole('button', { name: 'Alterar e-mail', exact: true }).click();
  await expect(emailForm.getByText('Este e-mail já está em uso por outra conta.')).toBeVisible();
  await emailForm.getByLabel('Novo e-mail', { exact: true }).fill(changedEmail);
  await emailForm.getByRole('button', { name: 'Alterar e-mail', exact: true }).click();
  await expect(emailForm.getByText(`Pronto. Agora você entra com vera-${suffix}@k5.test.`)).toBeVisible();
  await shot('acesso-alterado');
  expect((await sql(`SELECT 1 FROM "user" WHERE email=$1`, [changedEmail])).length).toBe(1);
  log('PASS e-mail: senha errada e endereço de outra conta são recusados; com a senha certa o e-mail muda.');

  // Restore the verification account for the next drivers and doctor.
  await emailForm.getByLabel('Novo e-mail', { exact: true }).fill(original.email);
  await emailForm.getByLabel('Senha atual', { exact: true }).fill(newPassword);
  await emailForm.getByRole('button', { name: 'Alterar e-mail', exact: true }).click();
  await expect(emailForm.getByText(`Pronto. Agora você entra com ${original.email}.`)).toBeVisible();
  await page.getByLabel('Senha atual', { exact: true }).nth(1).fill(newPassword);
  await page.getByLabel('Nova senha', { exact: true }).fill(original.password);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(original.password);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await expect(page.getByText(/Senha alterada/)).toBeVisible();
  log('PASS restauração: e-mail e senha da conta de verificação de volta aos originais.');

  await page.goto('/app/agenda?view=associates');
  await page.getByRole('button', { name: 'Convidar associado', exact: true }).click();
  await page.getByLabel('E-mail da pessoa', { exact: true }).fill(partner.email);
  await expect(page.getByText('já usa o Lume', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: `Ver perfil de ${partner.email}` }).hover();
  const card = page.locator('[data-slot=hover-card-content]');
  await expect(card.getByText('OAB MG 98.765 · Belo Horizonte, MG')).toBeVisible();
  await expect(card.getByText('Direito previdenciário')).toBeVisible();
  await shot('convite-card-hover');
  log('PASS convite (/app/agenda?view=associates): o e-mail digitado mostra nome e o card do perfil no hover.');
  await page.getByLabel('E-mail da pessoa', { exact: true }).fill(`ninguem-${suffix}@k5.test`);
  await expect(page.getByText('Ainda não tem conta no Lume.', { exact: false })).toBeVisible();
  log('PASS convite: e-mail sem conta diz que o convite gera um link.');
  await page.getByLabel('E-mail da pessoa', { exact: true }).fill(partner.email);
  await page.getByRole('button', { name: 'Criar convite', exact: true }).click();
  await expect(page.getByText('Convite disponível na conta da pessoa.', { exact: false })).toBeVisible();

  const incoming = await (await other.request.get('/api/collaboration')).json() as { incoming: { id: string }[] };
  expect((await other.request.post('/api/collaboration', { headers, data: { action: 'respond', id: incoming.incoming[0].id, accept: true } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: `Ver perfil de ${partner.email}` })).toBeVisible();
  await page.getByRole('button', { name: `Ver perfil de ${partner.email}` }).focus();
  await expect(card.getByText('Parcerias em ações previdenciárias.')).toBeVisible();
  await shot('associados-card-foco');
  log('PASS associados: a pessoa aceita aparece na lista e o card abre também pelo teclado (foco).');
  await other.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/profile');
  await expect(page.getByRole('button', { name: 'Salvar perfil', exact: true })).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot('perfil-mobile');
  await page.getByRole('button', { name: 'Mais', exact: false }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('link', { name: /Vera Verificação/ })).toHaveAttribute('aria-current', 'page');
  await shot('mais-mobile');
  await page.keyboard.press('Escape');
  await page.goto('/app/agenda?view=associates');
  await page.getByRole('button', { name: `Ver perfil de ${partner.email}` }).tap().catch(() => page.getByRole('button', { name: `Ver perfil de ${partner.email}` }).click());
  await expect(card.getByText('Direito previdenciário')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot('associados-mobile-toque');
  log('PASS mobile: perfil sem rolagem horizontal em 390px, Perfil no "Mais" e card abre com toque.');

  // The wrong-password attempt is meant to fail; the browser logs its 400 as a failed resource.
  const unexpected = app.errors.filter(error => !/\/app\/profile: Failed to load resource: .* 400/.test(error));
  expect(app.errors.length - unexpected.length).toBe(1);
  expect(unexpected).toEqual([]);
  log('PASS sem erros de página ou console além do 400 esperado da senha errada.');
} finally {
  // A failure between the credential changes must not lock the next drivers out of the account.
  const rescue = await page.context().browser()!.newContext({ baseURL: state.baseURL });
  for (const email of [original.email, changedEmail]) {
    const signIn = await rescue.request.post('/api/auth/sign-in/email', { headers: { origin: state.baseURL }, data: { email, password: newPassword } });
    if (!signIn.ok()) continue;
    if (email !== original.email) await rescue.request.post('/api/auth/change-email', { headers: { origin: state.baseURL }, data: { newEmail: original.email, currentPassword: newPassword } });
    await rescue.request.post('/api/auth/change-password', { headers: { origin: state.baseURL }, data: { currentPassword: newPassword, newPassword: original.password } });
    console.log('Conta de verificação restaurada depois de uma falha.');
  }
  await rescue.close();
  await app.close();
}
