import { expect, unique } from 'e2e';
import { admin } from '../support/accounts';
import { test } from '../support/fixtures';

test('o agente cria um caso no Cofre com dados do cliente e abre a página do caso', { session: 'admin', tags: ['agent'] }, async ({ app, agent, screen, browser, sql }) => {
  const stamp = Date.now().toString(36);
  const title = `Silva vs. Construtora ${stamp}`;
  await app.open('/app/vault');

  await agent.act('crie um caso chamado {title}, com a descrição {description} e o cliente {client} nos dados do cliente', {
    params: { title: unique(title), description: 'Ação de indenização por atraso na entrega do imóvel.', client: 'Maria Silva' },
  });
  await expect(screen.getByRole('link', title, { exact: false }).first()).toBeVisible();
  expect(await sql(
    `SELECT c.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM vault_case c WHERE c.name=$1 AND c.deleted_at IS NULL`, [title, admin.email])).toEqual([{ same_office: true }]);

  await agent.act('abra o caso {title}', { params: { title: unique(title) } });
  await expect(browser).toHaveURL(/\/app\/vault\/cases\//);
  await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await agent.assert('a página do caso mostra o título do caso e um lugar para enviar ou listar os arquivos dele');
});
