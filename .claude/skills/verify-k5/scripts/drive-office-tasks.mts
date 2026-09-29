/**
 * Feature office-tasks: create a task from Escritório → Tarefas, confirm it persisted for the
 * signed-in office, complete it, and find it under Arquivadas. Desktop, then a mobile pass.
 */
import { expect, openApp } from './session.mts';

const title = `Protocolar recurso ${Date.now().toString(36)}`;
const app = await openApp('office-tasks');
const { page, shot, sql, log } = app;
try {
  await page.goto('/app/agenda?view=tasks');
  await expect(page.getByRole('heading', { name: 'Escritório', level: 1 })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Abertas' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Atividades' })).toHaveAttribute('aria-busy', 'false');
  await shot('abertas-antes');

  await page.getByRole('button', { name: 'Nova atividade', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova atividade' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título', { exact: true }).fill(title);
  await expect(dialog.getByLabel('Tipo', { exact: true })).toHaveValue('task');
  await shot('dialogo-preenchido');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole('button', { name: title, exact: true });
  await expect(row).toBeVisible();
  await shot('tarefa-criada');
  log('PASS criar: a tarefa aparece em Abertas depois de Salvar.');

  const [stored] = await sql<{ status: string; kind: string; office: string; version: string }>(
    `SELECT a.status, a.kind, o.name AS office, a.version FROM agenda_activity a JOIN office o ON o.id=a.office_id WHERE a.title=$1`, [title]);
  expect(stored).toMatchObject({ status: 'pending', kind: 'task', office: app.state.account.officeName });
  log(`PASS banco: agenda_activity pending/task no escritório "${stored.office}" (versão ${stored.version}).`);

  await page.reload();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  log('PASS persistência: a tarefa continua em Abertas após recarregar.');

  await page.getByRole('checkbox', { name: `Concluir ${title}` }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM agenda_activity WHERE title=$1', [title]))[0].status).toBe('completed');
  log('PASS concluir: a tarefa sai de Abertas e fica completed no banco.');

  await page.getByRole('button', { name: 'Arquivadas', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Reabrir ${title}` })).toBeChecked();
  await shot('arquivadas');
  log('PASS arquivadas: a tarefa concluída aparece com a opção Reabrir.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/agenda?view=tasks');
  await expect(page.getByRole('button', { name: 'Nova atividade', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot('abertas-mobile');
  log('PASS mobile: Tarefas sem rolagem horizontal em 390px.');

  expect(app.errors).toEqual([]);
  log('PASS sem erros de página ou console.');
} finally {
  await app.close();
}
