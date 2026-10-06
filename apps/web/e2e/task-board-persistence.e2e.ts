import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { admin } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

const centerOf = (label: string) => {
  const rect = document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect();
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
};
const columnPoint = (title: string) => {
  const column = document.querySelector(`section[aria-label="${title}"]`)!.getBoundingClientRect();
  const board = document.querySelector('[aria-label="Quadro de tarefas"]')!.getBoundingClientRect();
  return { x: Math.round((Math.max(column.left, board.left) + Math.min(column.right, board.right)) / 2), y: Math.round(Math.max(column.top, 0) + 70) };
};
const ruled = (title: string) => getComputedStyle(document.querySelector(`section[aria-label="${title}"]`)!).boxShadow !== 'none';

async function drag(browser: Browser, label: string, column: string) {
  const from = await browser.evaluate(centerOf, label);
  const to = await browser.evaluate(columnPoint, column);
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await browser.mouse.move(from.x + 12, from.y + 4);
  for (let step = 1; step <= 12; step++) {
    await browser.mouse.move(Math.round(from.x + (to.x - from.x) * step / 12), Math.round(from.y + (to.y - from.y) * step / 12));
  }
  await browser.mouse.up();
}

test('arrastar uma tarefa no quadro grava a coluna no escritório: mouse, teclado e celular', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const title = `Tarefa do quadro ${Date.now().toString(36)}`;
  const grip = screen.getByRole('button', `Arrastar ${title}`);
  const row = async () => sql<{ status: string; version: number; sameOffice: boolean }>(
    `SELECT a.status, a.version::int AS version, a.office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2)) AS "sameOffice"
       FROM agenda_activity a WHERE a.title=$1`, [title, admin.email]);
  const settled = (column: string) => expect(screen.getByRole('region', column).getByRole('article').filter({ hasText: title })).toHaveAttribute('aria-busy', 'false');
  const loaded = () => expect(screen.getByRole('region', 'Atividades')).toHaveAttribute('aria-busy', 'false');

  await app.open('/app/agenda?view=tasks&layout=kanban');
  await loaded();
  await screen.getByRole('button', 'Nova atividade').tap();
  const dialog = screen.getByRole('dialog', 'Nova atividade');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Data (opcional)').fill('2026-01-15');
  await dialog.getByRole('button', 'Salvar').tap();
  await expect(dialog).toHaveCount(0);
  await expect(screen.getByRole('region', 'A fazer')).toContainText(title);
  expect(await row()).toEqual([{ status: 'pending', version: 1, sameOffice: true }]);
  await app.screenshot('01-a-fazer');

  await grip.scrollIntoView();
  await drag(browser, `Arrastar ${title}`, 'Em andamento');
  await expect(screen.getByRole('region', 'Em andamento')).toContainText(title);
  await settled('Em andamento');
  await expect.poll(row).toEqual([{ status: 'in_progress', version: 2, sameOffice: true }]);
  await app.screenshot('02-em-andamento');

  await grip.scrollIntoView();
  await drag(browser, `Arrastar ${title}`, 'Concluídas');
  await expect(screen.getByRole('region', 'Concluídas')).toContainText(title);
  await settled('Concluídas');
  await expect.poll(row).toEqual([{ status: 'completed', version: 3, sameOffice: true }]);
  await app.screenshot('03-concluidas');

  await browser.reload();
  await loaded();
  await expect(screen.getByRole('region', 'Concluídas')).toContainText(title);
  expect(await row()).toEqual([{ status: 'completed', version: 3, sameOffice: true }]);

  await grip.focus();
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('ArrowLeft');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('ArrowLeft');
  await expect.poll(() => browser.evaluate(ruled, 'A fazer')).toBe(true);
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('region', 'A fazer')).toContainText(title);
  await expect(grip).toBeFocused();
  await settled('A fazer');
  await expect.poll(row).toEqual([{ status: 'pending', version: 4, sameOffice: true }]);
  await app.screenshot('04-de-volta-a-fazer');

  await browser.reload();
  await loaded();
  await expect(screen.getByRole('region', 'A fazer')).toContainText(title);

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/agenda?view=tasks&layout=kanban');
  await loaded();
  await expect(grip).toBeVisible();
  await grip.focus();
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('region', 'Em andamento')).toContainText(title);
  await expect(grip).toBeFocused();
  await settled('Em andamento');
  await expect.poll(row).toEqual([{ status: 'in_progress', version: 5, sameOffice: true }]);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('05-celular-em-andamento');

  await browser.reload();
  await loaded();
  await expect(screen.getByRole('region', 'Em andamento')).toContainText(title);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
