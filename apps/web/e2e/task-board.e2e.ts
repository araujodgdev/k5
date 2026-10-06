import { test } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { AgendaActivity } from '../src/lib/capabilities/agenda';
import { overflowsHorizontally } from './support/fixtures';

type Status = AgendaActivity['status'];

const seed = (count: number, statusOf: (index: number) => Status = () => 'pending'): AgendaActivity[] => Array.from({ length: count }, (_, index) => ({
  id: `board-${index}`, kind: 'task', title: `Revisar contrato ${index + 1}`, notes: 'Conferir documentos e preparar a revisão do contrato.', status: statusOf(index),
  dueOn: '2026-10-01', startsAt: null, endsAt: null, clientId: null, caseId: null, assigneeId: null, version: 1, createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z',
}));
const spread = (index: number): Status => (['pending', 'pending', 'pending', 'in_progress', 'completed', 'cancelled'] as const)[index];

async function mockAgenda(browser: Browser, tasks: AgendaActivity[]) {
  const control = {
    state: 'ready' as 'ready' | 'empty' | 'error', lists: 0, updates: [] as { activityId: string; status: Status; version: number }[],
    conflicts: [] as string[], gets: [] as string[], hold: null as Promise<void> | null,
  };
  await browser.route('**/api/vault/cases', route => route.fulfill({ json: { cases: [] } }));
  await browser.route('**/api/agenda/members/list', route => route.fulfill({ json: { members: [] } }));
  await browser.route('**/api/agenda/clients/list', route => route.fulfill({ json: { clients: [], total: 0 } }));
  await browser.route('**/api/agenda/proposals/list', route => route.fulfill({ json: { proposals: [] } }));
  await browser.route('**/api/agenda/activities/list', route => {
    control.lists++;
    if (control.state === 'error') return route.fulfill({ status: 503, json: { error: 'Falha de teste ao carregar tarefas.' } });
    const body = JSON.parse(route.request.postData ?? '{}') as { openOnly?: boolean; status?: string; offset?: number; limit: number };
    const filtered = control.state === 'empty' ? [] : tasks.filter(task => (!body.openOnly || ['pending', 'in_progress'].includes(task.status)) && (!body.status || body.status === task.status));
    return route.fulfill({ json: { activities: filtered.slice(body.offset ?? 0, (body.offset ?? 0) + body.limit), total: filtered.length } });
  });
  await browser.route('**/api/agenda/activities/get', route => {
    const body = JSON.parse(route.request.postData ?? '{}') as { activityId: string };
    control.gets.push(body.activityId);
    return route.fulfill({ json: { activity: tasks.find(task => task.id === body.activityId)! } });
  });
  await browser.route('**/api/agenda/activities/update', async route => {
    const body = JSON.parse(route.request.postData ?? '{}') as { activityId: string; status: Status; version: number };
    control.updates.push({ activityId: body.activityId, status: body.status, version: body.version });
    if (control.hold) await control.hold;
    const task = tasks.find(task => task.id === body.activityId)!;
    if (body.version !== task.version) {
      control.conflicts.push(task.id);
      return route.fulfill({ status: 409, json: { error: 'Este registro mudou. Atualize a página e tente novamente.', code: 'CONFLICT' } });
    }
    task.status = body.status; task.version++;
    return route.fulfill({ json: { activity: task } });
  });
  return control;
}

const centerOf = (label: string) => {
  const rect = document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect();
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
};
const columnPoint = (title: string) => {
  const column = document.querySelector(`section[aria-label="${title}"]`)!.getBoundingClientRect();
  const board = document.querySelector('[aria-label="Quadro de tarefas"]')!.getBoundingClientRect();
  return { x: Math.round((Math.max(column.left, board.left) + Math.min(column.right, board.right)) / 2), y: Math.round(Math.max(column.top, 0) + 70) };
};
const outsideBoard = () => {
  const board = document.querySelector('[aria-label="Quadro de tarefas"]')!.getBoundingClientRect();
  return { x: Math.round(board.x + board.width / 2), y: Math.round(board.y - 30) };
};
const ruled = (title: string) => getComputedStyle(document.querySelector(`section[aria-label="${title}"]`)!).boxShadow !== 'none';
const gripMetrics = (label: string) => {
  const grip = document.querySelector(`[aria-label="${label}"]`)!;
  const rect = grip.getBoundingClientRect();
  return { touchAction: getComputedStyle(grip).touchAction, width: Math.round(rect.width), height: Math.round(rect.height) };
};

async function carry(browser: Browser, title: string, target: string | { x: number; y: number }) {
  const from = await browser.evaluate(centerOf, `Arrastar ${title}`);
  const to = typeof target === 'string' ? await browser.evaluate(columnPoint, target) : target;
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await browser.mouse.move(from.x + 12, from.y + 4);
  await browser.mouse.move(Math.round((from.x + to.x) / 2), Math.round((from.y + to.y) / 2));
  await browser.mouse.move(to.x, to.y);
}
async function drag(browser: Browser, title: string, target: string) {
  await carry(browser, title, target);
  await browser.mouse.up();
}

test('o quadro de tarefas mostra 53 tarefas, move pelo teclado, delega ao Lume e se recupera de vazio e erro', { session: 'admin' }, async ({ app, screen, browser }) => {
  const tasks = seed(53, index => index === 51 ? 'in_progress' : index === 52 ? 'completed' : 'pending');
  const board = await mockAgenda(browser, tasks);
  const delegated: string[] = [];
  await browser.route('**/api/agenda/delegate', route => {
    delegated.push((JSON.parse(route.request.postData ?? '{}') as { activityId: string }).activityId);
    return route.fulfill({ json: { conversationId: 'board-session', url: '/app/agents?conversationId=board-session' } });
  });

  await app.open('/app/agenda');
  await expect(screen.getByText('Carregando…')).toBeHidden();
  const kanban = screen.getByRole('button', 'Kanban');
  await kanban.focus();
  await browser.keyboard.press('Enter');
  const cards = screen.getByLabel('Quadro de tarefas').getByRole('article');
  await expect(cards).toHaveCount(53);
  await kanban.tap();
  await expect(cards).toHaveCount(53);
  const inProgress = screen.getByRole('region', 'Em andamento');
  await expect(inProgress).toContainText('Revisar contrato 52');
  await expect(screen.getByLabel('Quadro de tarefas').getByRole('combobox')).toHaveCount(0);
  await expect(screen.getByRole('link', 'Revisar contrato 1')).toHaveAttribute('href', '/app/agenda/tasks/board-0?from=kanban');

  const loaded = board.lists;
  const grip = screen.getByRole('button', 'Arrastar Revisar contrato 1');
  await grip.focus();
  await browser.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre A fazer.');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('Space');
  await expect(inProgress).toContainText('Revisar contrato 1');
  await expect(grip).toBeFocused();
  await expect.poll(() => board.updates).toEqual([{ activityId: 'board-0', status: 'in_progress', version: 1 }]);
  expect(board.conflicts).toEqual([]);
  expect(board.lists).toBe(loaded);
  // The layout lives in the URL, so a reload keeps the board.
  await browser.reload();
  await expect(cards).toHaveCount(53);
  await expect(inProgress).toContainText('Revisar contrato 1');

  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByLabel('Quadro de tarefas').getByRole('button', 'Delegar ao Lume').first().tap();
  await browser.waitForURL(/\/app\/agents\?conversationId=board-session$/, { timeout: 60_000 });
  expect(delegated).toEqual(['board-1']);

  board.state = 'empty';
  await app.open('/app/agenda?layout=kanban');
  await expect(screen.getByLabel('Quadro de tarefas').getByText('Nenhuma tarefa.')).toHaveCount(4);
  board.state = 'error';
  await screen.getByRole('button', 'Atualizar').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'Falha de teste' })).toBeVisible();
  board.state = 'ready';
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(cards).toHaveCount(53);
});

test('arrastar com o mouse move a tarefa de coluna; fora do quadro, na mesma coluna e com Esc nada muda', { session: 'admin' }, async ({ app, screen, browser }) => {
  const board = await mockAgenda(browser, seed(6, spread));
  await app.open('/app/agenda?layout=kanban');
  const cards = screen.getByLabel('Quadro de tarefas').getByRole('article');
  await expect(cards).toHaveCount(6);
  const todo = screen.getByRole('region', 'A fazer');
  const inProgress = screen.getByRole('region', 'Em andamento');
  const loaded = board.lists;

  await carry(browser, 'Revisar contrato 1', await browser.evaluate(outsideBoard));
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(false);
  await browser.mouse.up();
  await expect(todo).toContainText('Revisar contrato 1');

  await carry(browser, 'Revisar contrato 1', 'A fazer');
  await expect.poll(() => browser.evaluate(ruled, 'A fazer')).toBe(false);
  await browser.mouse.up();
  await expect(todo).toContainText('Revisar contrato 1');

  await carry(browser, 'Revisar contrato 1', 'Concluídas');
  await expect.poll(() => browser.evaluate(ruled, 'Concluídas')).toBe(true);
  await browser.keyboard.press('Escape');
  await browser.mouse.up();
  await expect.poll(() => browser.evaluate(ruled, 'Concluídas')).toBe(false);
  await expect(todo).toContainText('Revisar contrato 1');
  expect(board.updates).toEqual([]);

  await drag(browser, 'Revisar contrato 1', 'Em andamento');
  await expect(inProgress).toContainText('Revisar contrato 1');
  await expect(todo).not.toContainText('Revisar contrato 1');
  await expect(cards).toHaveCount(6);
  await expect.poll(() => board.updates).toEqual([{ activityId: 'board-0', status: 'in_progress', version: 1 }]);
  expect(board.lists).toBe(loaded);
});

test('a tarefa troca de coluna antes da resposta e cada cartão salva sozinho', { session: 'admin' }, async ({ app, screen, browser }) => {
  const board = await mockAgenda(browser, seed(6, spread));
  let release!: () => void;
  board.hold = new Promise<void>(resolve => { release = resolve; });
  await app.open('/app/agenda?layout=kanban');
  await expect(screen.getByLabel('Quadro de tarefas').getByRole('article')).toHaveCount(6);
  const loaded = board.lists;

  await drag(browser, 'Revisar contrato 1', 'Em andamento');
  await expect(screen.getByRole('region', 'Em andamento')).toContainText('Revisar contrato 1');
  await expect(screen.getByRole('region', 'Em andamento').getByText('Salvando…')).toBeVisible();
  await expect(screen.getByRole('button', 'Arrastar Revisar contrato 1')).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => board.updates.length).toBe(1);

  await drag(browser, 'Revisar contrato 2', 'Concluídas');
  await expect(screen.getByRole('region', 'Concluídas')).toContainText('Revisar contrato 2');
  await expect.poll(() => board.updates.length).toBe(2);
  release();
  await expect(screen.getByText('Salvando…')).toHaveCount(0);
  expect(board.updates).toEqual([
    { activityId: 'board-0', status: 'in_progress', version: 1 },
    { activityId: 'board-1', status: 'completed', version: 1 },
  ]);
  expect(board.lists).toBe(loaded);
});

test('uma falha devolve só aquele cartão e a nova tentativa usa a versão atual', { session: 'admin' }, async ({ app, screen, browser }) => {
  const tasks = seed(6, spread);
  const board = await mockAgenda(browser, tasks);
  await app.open('/app/agenda?layout=kanban');
  const cards = screen.getByLabel('Quadro de tarefas').getByRole('article');
  await expect(cards).toHaveCount(6);
  const alert = screen.getByRole('alert').filter({ hasText: 'Não foi possível mover' });
  const grip = screen.getByRole('button', 'Arrastar Revisar contrato 1');
  tasks[0].version = 4;

  await grip.focus();
  await browser.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre A fazer.');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('Space');
  await expect(alert).toContainText('Não foi possível mover “Revisar contrato 1” para Em andamento. Este registro mudou.');
  await expect(screen.getByRole('region', 'A fazer')).toContainText('Revisar contrato 1');
  await expect(cards).toHaveCount(6);
  expect(board.conflicts).toEqual(['board-0']);
  await expect.poll(() => board.gets).toEqual(['board-0']);
  await expect(grip).not.toHaveAttribute('aria-disabled', 'true');
  await expect(grip).toBeFocused();

  await drag(browser, 'Revisar contrato 1', 'Em andamento');
  await expect(screen.getByRole('region', 'Em andamento')).toContainText('Revisar contrato 1');
  await expect(alert).toHaveCount(0);
  await expect.poll(() => board.updates.map(update => update.version)).toEqual([1, 4]);
  expect(board.conflicts).toEqual(['board-0']);
});

test('movimentos seguidos usam a versão devolvida e o teclado anda coluna a coluna', { session: 'admin' }, async ({ app, screen, browser }) => {
  const board = await mockAgenda(browser, seed(6, spread));
  await app.open('/app/agenda?layout=kanban');
  await expect(screen.getByLabel('Quadro de tarefas').getByRole('article')).toHaveCount(6);
  const settled = (column: string) => expect(screen.getByRole('region', column).getByRole('article').filter({ hasText: 'Revisar contrato 1' })).toHaveAttribute('aria-busy', 'false');

  await drag(browser, 'Revisar contrato 1', 'Em andamento');
  await settled('Em andamento');
  await drag(browser, 'Revisar contrato 1', 'Concluídas');
  await settled('Concluídas');

  const grip = screen.getByRole('button', 'Arrastar Revisar contrato 1');
  await grip.focus();
  await browser.keyboard.press('Enter');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre Concluídas.');
  await browser.keyboard.press('ArrowLeft');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('ArrowLeft');
  await expect.poll(() => browser.evaluate(ruled, 'A fazer')).toBe(true);
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('region', 'A fazer')).toContainText('Revisar contrato 1');
  await expect(grip).toBeFocused();
  await expect.poll(() => board.updates).toEqual([
    { activityId: 'board-0', status: 'in_progress', version: 1 },
    { activityId: 'board-0', status: 'completed', version: 2 },
    { activityId: 'board-0', status: 'pending', version: 3 },
  ]);
  expect(board.conflicts).toEqual([]);

  await grip.focus();
  await browser.keyboard.press('Enter');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre A fazer.');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('Escape');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(false);
  await expect(screen.getByRole('region', 'A fazer')).toContainText('Revisar contrato 1');
  await expect(grip).toBeFocused();
  expect(board.updates).toHaveLength(3);
});

test('no celular o arrasto fica no quadro e o teclado leva a tarefa de coluna em coluna', { session: 'admin' }, async ({ app, screen, browser }) => {
  const board = await mockAgenda(browser, seed(6, spread));
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/agenda?layout=kanban');
  await expect(screen.getByLabel('Quadro de tarefas').getByRole('article')).toHaveCount(6);
  expect(await browser.evaluate(gripMetrics, 'Arrastar Revisar contrato 1')).toEqual({ touchAction: 'none', width: 44, height: 44 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  const grip = screen.getByRole('button', 'Arrastar Revisar contrato 1');
  await grip.focus();
  await browser.keyboard.press('Enter');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre A fazer.');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Em andamento')).toBe(true);
  await browser.keyboard.press('Enter');
  const moved = screen.getByRole('region', 'Em andamento').getByRole('article').filter({ hasText: 'Revisar contrato 1' });
  await expect(moved).toHaveAttribute('aria-busy', 'false');
  await expect(grip).toBeFocused();

  await browser.keyboard.press('Enter');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('status')).toContainText('“Revisar contrato 1” está sobre Em andamento.');
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Concluídas')).toBe(true);
  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => browser.evaluate(ruled, 'Canceladas')).toBe(true);
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('region', 'Canceladas')).toContainText('Revisar contrato 1');
  await expect(grip).toBeFocused();
  expect(board.updates.map(update => `${update.status}@${update.version}`)).toEqual(['in_progress@1', 'cancelled@2']);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
