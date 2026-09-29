import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { AgendaActivity } from '../src/lib/capabilities/agenda';

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const directory = 'playwright-report/task-board';
await mkdir(directory, { recursive: true });
try {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.PWA_TEST_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.PWA_TEST_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/app/**');
  const tasks: AgendaActivity[] = Array.from({ length: 53 }, (_, index) => ({ id: `board-${index}`, kind: 'task', title: `Revisar contrato ${index + 1}`,
    notes: 'Conferir documentos e preparar a revisão do contrato.', status: index === 51 ? 'in_progress' : index === 52 ? 'completed' : 'pending',
    dueOn: '2026-10-01', startsAt: null, endsAt: null, clientId: null, caseId: null, assigneeId: null, version: 1, createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' }));
  let state: 'ready' | 'empty' | 'error' = 'ready';
  await page.route('**/api/vault/cases', route => route.fulfill({ json: { cases: [] } }));
  await page.route('**/api/agenda/members/list', route => route.fulfill({ json: { members: [] } }));
  await page.route('**/api/agenda/clients/list', route => route.fulfill({ json: { clients: [], total: 0 } }));
  await page.route('**/api/agenda/proposals/list', route => route.fulfill({ json: { proposals: [] } }));
  await page.route('**/api/agenda/activities/list', route => {
    if (state === 'error') return route.fulfill({ status: 503, json: { error: 'Falha de teste ao carregar tarefas.' } });
    const body = route.request().postDataJSON();
    const filtered = state === 'empty' ? [] : tasks.filter(task => (!body.openOnly || ['pending', 'in_progress'].includes(task.status)) && (!body.status || body.status === task.status));
    return route.fulfill({ json: { activities: filtered.slice(body.offset ?? 0, (body.offset ?? 0) + body.limit), total: filtered.length } });
  });
  await page.route('**/api/agenda/activities/update', route => {
    const body = route.request().postDataJSON();
    const task = tasks.find(task => task.id === body.activityId)!;
    expect(body.version).toBe(task.version);
    task.status = body.status; task.version++;
    return route.fulfill({ json: { activity: task } });
  });
  let delegated = '';
  await page.route('**/api/agenda/delegate', route => {
    delegated = route.request().postDataJSON().activityId;
    return route.fulfill({ json: { conversationId: 'board-session', url: '/app/agents?conversationId=board-session' } });
  });
  await page.goto('/app/agenda');
  await expect(page.getByText('Carregando…', { exact: true })).toBeHidden();
  const kanban = page.getByRole('button', { name: 'Kanban', exact: true });
  await kanban.focus(); await page.keyboard.press('Enter');
  const board = page.getByLabel('Quadro de tarefas', { exact: true });
  await expect(board.locator('article')).toHaveCount(53);
  await kanban.click(); await expect(board.locator('article')).toHaveCount(53);
  await expect(page.getByRole('region', { name: 'Em andamento', exact: true })).toContainText('Revisar contrato 52');
  await page.screenshot({ path: `${directory}/desktop.png` });
  const move = page.getByRole('combobox', { name: 'Mover Revisar contrato 1', exact: true });
  await move.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Em andamento', exact: true })).toContainText('Revisar contrato 1');
  await page.reload(); await expect(board.locator('article')).toHaveCount(53);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${directory}/mobile.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await board.getByRole('button', { name: 'Delegar ao Lume', exact: true }).first().click();
  await page.waitForURL('**/app/agents?conversationId=board-session');
  expect(delegated).toBe('board-1');
  state = 'empty'; await page.goto('/app/agenda?layout=kanban');
  await expect(board.getByText('Nenhuma tarefa.', { exact: true })).toHaveCount(4);
  await page.screenshot({ path: `${directory}/empty.png` });
  state = 'error'; await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Falha de teste' })).toContainText('Falha de teste');
  state = 'ready'; await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(53);
  expect(errors).toEqual([]);
  console.log('PASS: 53 tarefas, lista/kanban, teclado, movimentação, delegação, persistência na URL, desktop/mobile, vazio e recuperação de erro.');
} finally { await context.close(); await browser.close(); }
