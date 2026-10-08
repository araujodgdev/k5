import { expect } from 'e2e';
import { admin } from '../support/accounts';
import { overflowsHorizontally, test } from '../support/fixtures';

// Exercise the real forms and persistence without a model service in the CI path.
test('o usuário cadastra um cliente, abre a ficha e corrige o nome', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const stamp = Date.now().toString(36);
  const name = `Construtora Horizonte ${stamp}`;
  const renamed = `Construtora Horizonte Ltda ${stamp}`;
  await app.open('/app/agenda?view=clients');

  await screen.getByRole('button', 'Novo cliente').tap();
  await screen.getByRole('dialog', 'Novo cliente').getByLabel('Nome').fill(name);
  await screen.getByRole('dialog', 'Novo cliente').getByLabel('E-mail').fill(`contato-${stamp}@horizonte.test`);
  await screen.getByRole('dialog', 'Novo cliente').getByLabel('Relacionamento').selectOption({ value: 'active' });
  await screen.getByRole('dialog', 'Novo cliente').getByRole('button', 'Salvar').tap();
  await expect(screen.getByRole('link', name)).toBeVisible();
  expect(await sql(
    `SELECT c.stage, c.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM crm_client c WHERE c.name=$1`, [name, admin.email])).toEqual([{ stage: 'active', same_office: true }]);

  await screen.getByRole('link', name, { exact: true }).tap();
  await expect(browser).toHaveURL(/\/app\/agenda\/clients\//);
  await expect(screen.getByRole('heading', { name, level: 1 })).toBeVisible();

  await screen.getByRole('button', 'Editar cliente').tap();
  await screen.getByRole('dialog', 'Editar cliente').getByLabel('Nome').fill(renamed);
  await screen.getByRole('dialog', 'Editar cliente').getByRole('button', 'Salvar').tap();
  await expect(screen.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();
  await expect(screen.getByRole('link', `contato-${stamp}@horizonte.test`)).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
