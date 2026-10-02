import { expect, unique } from 'e2e';
import { admin } from '../support/accounts';
import { overflowsHorizontally, test } from '../support/fixtures';

// The agent drives the CRM like a person would; each goal is pinned on screen and in the database.
test('o agente cadastra um cliente, abre a ficha e corrige o nome', { session: 'admin', tags: ['agent'] }, async ({ app, agent, screen, browser, sql }) => {
  const stamp = Date.now().toString(36);
  const name = `Construtora Horizonte ${stamp}`;
  const renamed = `Construtora Horizonte Ltda ${stamp}`;
  await app.open('/app/agenda?view=clients');

  await agent.act('cadastre um novo cliente chamado {name}, com o e-mail {email} e relacionamento ativo', {
    params: { name: unique(name), email: unique(`contato-${stamp}@horizonte.test`) },
  });
  await expect(screen.getByRole('link', name)).toBeVisible();
  expect(await sql(
    `SELECT c.stage, c.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM crm_client c WHERE c.name=$1`, [name, admin.email])).toEqual([{ stage: 'active', same_office: true }]);

  await agent.act('abra a ficha do cliente {name}', { params: { name: unique(name) } });
  await expect(browser).toHaveURL(/\/app\/agenda\/clients\//);
  await expect(screen.getByRole('heading', { name, level: 1 })).toBeVisible();

  await agent.act('edite o cliente e troque o nome para {renamed}', { params: { renamed: unique(renamed) } });
  await expect(screen.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

  await browser.setViewport({ width: 390, height: 844 });
  await agent.assert('a ficha do cliente mostra o nome e o e-mail do cliente, sem conteúdo cortado na largura do celular', { vision: true });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
