import { expect } from 'e2e';
import { admin } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

// Real path end to end: no mocks; the stored row proves the write landed in the signed-in office.
test('uma tarefa criada em Escritório é gravada no escritório, concluída e arquivada', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const title = `Protocolar recurso ${Date.now().toString(36)}`;
  await app.open('/app/agenda?view=tasks');
  await expect(screen.getByRole('heading', { name: 'Tarefas', level: 1 })).toBeAttached();
  // The list opens on the open tasks; the situation filter says so.
  await expect(screen.getByRole('button', 'Situação: Abertas')).toBeVisible();
  await expect(screen.getByRole('region', 'Tarefas')).toHaveAttribute('aria-busy', 'false');
  await app.screenshot('01-abertas-antes');

  await screen.getByRole('button', 'Nova tarefa').tap();
  const dialog = screen.getByRole('dialog', 'Nova tarefa');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título').fill(title);
  await expect(dialog.getByLabel('Tipo')).toHaveValue('task');
  await app.screenshot('02-nova-atividade');
  await dialog.getByRole('button', 'Salvar').tap();
  await expect(dialog).toHaveCount(0);
  await expect(screen.getByRole('link', title)).toBeVisible();
  await app.screenshot('03-tarefa-criada');

  const stored = await sql<{ status: string; kind: string; same_office: boolean }>(
    `SELECT a.status, a.kind, a.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM agenda_activity a WHERE a.title=$1`, [title, admin.email]);
  expect(stored).toEqual([{ status: 'pending', kind: 'task', same_office: true }]);

  await browser.reload();
  await expect(screen.getByRole('link', title)).toBeVisible();

  await screen.getByRole('checkbox', `Concluir ${title}`).tap();
  await expect(screen.getByRole('link', title)).toHaveCount(0);
  await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM agenda_activity WHERE title=$1', [title]))[0]?.status).toBe('completed');

  await screen.getByRole('button', 'Situação: Abertas').tap();
  await screen.getByRole('menuitemradio', 'Concluídas').tap();
  await expect(screen.getByRole('checkbox', `Reabrir ${title}`)).toBeChecked();
  await app.screenshot('04-arquivadas');

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/agenda?view=tasks');
  await expect(screen.getByRole('button', 'Nova tarefa')).toBeVisible();
  await expect(screen.getByRole('region', 'Tarefas')).toHaveAttribute('aria-busy', 'false');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('05-abertas-mobile');
});
