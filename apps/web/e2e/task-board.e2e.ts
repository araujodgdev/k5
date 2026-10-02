import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { AgendaActivity } from '../src/lib/capabilities/agenda';
import { overflowsHorizontally } from './support/fixtures';

test('o quadro de tarefas mostra 53 tarefas, move pelo teclado, delega ao Lume e se recupera de vazio e erro', { session: 'admin' }, async ({ app, screen, browser }) => {
  const tasks: AgendaActivity[] = Array.from({ length: 53 }, (_, index) => ({ id: `board-${index}`, kind: 'task', title: `Revisar contrato ${index + 1}`,
    notes: 'Conferir documentos e preparar a revisão do contrato.', status: index === 51 ? 'in_progress' : index === 52 ? 'completed' : 'pending',
    dueOn: '2026-10-01', startsAt: null, endsAt: null, clientId: null, caseId: null, assigneeId: null, version: 1, createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' }));
  let state: 'ready' | 'empty' | 'error' = 'ready';
  const staleUpdates: string[] = [];
  await browser.route('**/api/vault/cases', route => route.fulfill({ json: { cases: [] } }));
  await browser.route('**/api/agenda/members/list', route => route.fulfill({ json: { members: [] } }));
  await browser.route('**/api/agenda/clients/list', route => route.fulfill({ json: { clients: [], total: 0 } }));
  await browser.route('**/api/agenda/proposals/list', route => route.fulfill({ json: { proposals: [] } }));
  await browser.route('**/api/agenda/activities/list', route => {
    if (state === 'error') return route.fulfill({ status: 503, json: { error: 'Falha de teste ao carregar tarefas.' } });
    const body = JSON.parse(route.request.postData ?? '{}') as { openOnly?: boolean; status?: string; offset?: number; limit: number };
    const filtered = state === 'empty' ? [] : tasks.filter(task => (!body.openOnly || ['pending', 'in_progress'].includes(task.status)) && (!body.status || body.status === task.status));
    return route.fulfill({ json: { activities: filtered.slice(body.offset ?? 0, (body.offset ?? 0) + body.limit), total: filtered.length } });
  });
  await browser.route('**/api/agenda/activities/update', route => {
    const body = JSON.parse(route.request.postData ?? '{}') as { activityId: string; status: AgendaActivity['status']; version: number };
    const task = tasks.find(task => task.id === body.activityId)!;
    if (body.version !== task.version) staleUpdates.push(task.id);
    task.status = body.status; task.version++;
    return route.fulfill({ json: { activity: task } });
  });
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
  const move = screen.getByRole('combobox', 'Mover Revisar contrato 1');
  await move.focus();
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('Enter');
  await expect(inProgress).toContainText('Revisar contrato 1');
  expect(staleUpdates).toEqual([]);
  // The layout lives in the URL, so a reload keeps the board.
  await browser.reload();
  await expect(cards).toHaveCount(53);

  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByLabel('Quadro de tarefas').getByRole('button', 'Delegar ao Lume').first().tap();
  await browser.waitForURL(/\/app\/agents\?conversationId=board-session$/);
  expect(delegated).toEqual(['board-1']);

  state = 'empty';
  await app.open('/app/agenda?layout=kanban');
  await expect(screen.getByLabel('Quadro de tarefas').getByText('Nenhuma tarefa.')).toHaveCount(4);
  state = 'error';
  await screen.getByRole('button', 'Atualizar').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'Falha de teste' })).toBeVisible();
  state = 'ready';
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(cards).toHaveCount(53);
});
