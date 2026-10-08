import { expect } from 'e2e';
import { admin } from '../support/accounts';
import { test } from '../support/fixtures';

test('o usuário cria um caso no Cofre com dados do cliente e abre a página do caso', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const stamp = Date.now().toString(36);
  const title = `Silva vs. Construtora ${stamp}`;
  await app.open('/app/vault');

  await screen.getByRole('button', 'Novo caso').tap();
  const dialog = screen.getByRole('dialog', 'Novo caso');
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Descrição').fill('Ação de indenização por atraso na entrega do imóvel.');
  await dialog.getByRole('button', 'Dados do cliente (opcional)').tap();
  await dialog.getByLabel('Nome', { exact: true }).fill('Maria Silva');
  await dialog.getByRole('button', 'Criar caso').tap();
  await expect(screen.getByRole('link', title, { exact: false }).first()).toBeVisible();
  expect(await sql(
    `SELECT c.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM vault_case c WHERE c.name=$1 AND c.deleted_at IS NULL`, [title, admin.email])).toEqual([{ same_office: true }]);

  await screen.getByRole('link', title, { exact: false }).first().tap();
  await expect(browser).toHaveURL(/\/app\/vault\/cases\//);
  await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(screen.getByRole('button', 'Arquivos', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Mais ações do caso')).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible();
});
