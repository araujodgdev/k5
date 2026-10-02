import { expect } from 'e2e';
import { admin } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

// Real path end to end: no mocks; the stored row proves the write landed in the signed-in office.
test('uma tarefa criada em Escritório é gravada no escritório, concluída e arquivada', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const title = `Protocolar recurso ${Date.now().toString(36)}`;
  await app.open('/app/agenda?view=tasks');
  await expect(screen.getByRole('heading', { name: 'Escritório', level: 1 })).toBeAttached();
  await expect(screen.getByRole('button', 'Abertas')).toHaveAttribute('aria-current', 'page');
  await expect(screen.getByRole('region', 'Atividades')).toHaveAttribute('aria-busy', 'false');

  await screen.getByRole('button', 'Nova atividade').tap();
  const dialog = screen.getByRole('dialog', 'Nova atividade');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título').fill(title);
  await expect(dialog.getByLabel('Tipo')).toHaveValue('task');
  await dialog.getByRole('button', 'Salvar').tap();
  await expect(dialog).toHaveCount(0);
  await expect(screen.getByRole('button', title)).toBeVisible();

  const stored = await sql<{ status: string; kind: string; same_office: boolean }>(
    `SELECT a.status, a.kind, a.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS same_office
       FROM agenda_activity a WHERE a.title=$1`, [title, admin.email]);
  expect(stored).toEqual([{ status: 'pending', kind: 'task', same_office: true }]);

  await browser.reload();
  await expect(screen.getByRole('button', title)).toBeVisible();

  await screen.getByRole('checkbox', `Concluir ${title}`).tap();
  await expect(screen.getByRole('button', title)).toHaveCount(0);
  await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM agenda_activity WHERE title=$1', [title]))[0]?.status).toBe('completed');

  await screen.getByRole('button', 'Arquivadas').tap();
  await expect(screen.getByRole('checkbox', `Reabrir ${title}`)).toBeChecked();

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/agenda?view=tasks');
  await expect(screen.getByRole('button', 'Nova atividade')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
