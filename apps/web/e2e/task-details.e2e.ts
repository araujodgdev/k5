import { expect } from 'e2e';
import { admin } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

const inOffice = `office_id IN (SELECT m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($2))`;

test('cada tarefa do Kanban abre a própria página, que edita título e observações sem mudar a situação', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const suffix = Date.now().toString(36);
  const title = `Revisar minuta ${suffix}`;
  const notes = `Conferir a cláusula quarta ${suffix}\nEnviar a versão final ao cliente`;
  const board = screen.getByRole('region', 'Quadro de tarefas');
  const main = screen.getByRole('main');
  const task = (id: string) => sql<{ title: string; notes: string; status: string; kind: string; version: number; due: string }>(
    `SELECT title, notes, status, kind, version::int AS version, to_char(due_on::date, 'DD/MM/YYYY') AS due FROM agenda_activity WHERE id=$1 AND ${inOffice}`, [id, admin.email]);

  await app.open('/app/agenda?layout=kanban');
  await expect(board).toBeVisible();
  await screen.getByRole('button', 'Nova tarefa').tap();
  const creating = screen.getByRole('dialog', 'Nova tarefa');
  await creating.getByLabel('Título').fill(title);
  await creating.getByLabel('Observações').fill(notes);
  await creating.getByRole('button', 'Salvar').tap();
  await expect(creating).toHaveCount(0);
  const { id } = (await sql<{ id: string }>(`SELECT id FROM agenda_activity WHERE title=$1 AND ${inOffice}`, [title, admin.email]))[0]!;
  const created = (await task(id))[0]!;
  expect(created).toMatchObject({ title, notes, status: 'pending', kind: 'task' });

  const moved = await browser.evaluate(async (arg: { id: string; version: number }) => {
    const response = await fetch('/api/agenda/activities/update', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityId: arg.id, version: arg.version, status: 'in_progress', idempotencyKey: crypto.randomUUID() }) });
    return response.status;
  }, { id, version: created.version });
  expect(moved).toBe(201);

  await app.open('/app/agenda?layout=kanban');
  await expect(board).toBeVisible();
  await screen.getByRole('region', 'Em andamento').getByRole('link', title).tap();
  await expect(browser).toHaveURL(`/app/agenda/tasks/${id}?from=kanban`);
  const heading = (name: string) => main.getByRole('heading', { name, level: 1 });
  // The notes are the text under the page's "Observações" section heading.
  const notesText = () => browser.evaluate(() => {
    const heading = [...document.querySelectorAll('#main-content h2')].find(item => item.textContent === 'Observações')!;
    return (heading.parentElement!.nextElementSibling as HTMLElement).innerText;
  });
  await expect(heading(title)).toBeVisible();
  await expect(main.getByText('Em andamento', { exact: true })).toBeVisible();
  await expect(main.getByText(created.due, { exact: true })).toBeVisible();
  for (const empty of ['Sem responsável', 'Sem cliente', 'Sem caso']) await expect(main.getByText(empty)).toBeVisible();
  expect(await notesText()).toBe(notes);
  await expect(main.getByRole('link', 'Voltar ao quadro')).toHaveAttribute('href', '/app/agenda?view=tasks&layout=kanban');
  await expect(main.getByRole('combobox')).toHaveCount(0);
  await expect(main.getByRole('menu')).toHaveCount(0);
  await app.screenshot('01-pagina-da-tarefa');

  await browser.reload();
  await expect(heading(title)).toBeVisible();
  await expect(main.getByText('Em andamento', { exact: true })).toBeVisible();

  await main.getByRole('button', 'Editar tarefa').tap();
  const editing = screen.getByRole('dialog', 'Editar tarefa');
  await expect(editing.getByLabel('Título')).toHaveValue(title);
  await expect(editing.getByLabel('Observações')).toHaveValue(notes);
  await expect(editing.getByLabel('Situação')).toHaveCount(0);
  await expect(editing.getByLabel('Tipo')).toHaveCount(0);
  const editedTitle = `${title} ${'Documentacao'.repeat(8)}`;
  const editedNotes = `${notes}\nhttps://exemplo.test/${'a'.repeat(80)}`;
  await editing.getByLabel('Título').fill(editedTitle);
  await editing.getByLabel('Observações').fill(editedNotes);
  await app.screenshot('02-editar-tarefa');
  await editing.getByRole('button', 'Salvar').tap();
  await expect(editing).toHaveCount(0);
  await expect(heading(editedTitle)).toBeVisible();
  await expect(main.getByText('Tarefa atualizada.')).toBeVisible();
  await expect(main.getByText('Em andamento', { exact: true })).toBeVisible();
  expect(await notesText()).toBe(editedNotes);

  expect(await task(id)).toEqual([{ title: editedTitle, notes: editedNotes, status: 'in_progress', kind: 'task', version: created.version + 2, due: created.due }]);
  await browser.reload();
  await expect(heading(editedTitle)).toBeVisible();
  expect(await notesText()).toBe(editedNotes);

  await browser.setViewport({ width: 390, height: 844 });
  await app.open(`/app/agenda/tasks/${id}?from=kanban`);
  await expect(heading(editedTitle)).toBeVisible();
  expect((await heading(editedTitle).boundingBox())!.height).toBeGreaterThan(24);
  const action = main.getByRole('button', 'Editar tarefa');
  await expect(action).toBeVisible();
  const box = (await action.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('03-pagina-da-tarefa-celular');

  await main.getByRole('link', 'Voltar ao quadro').tap();
  await expect(browser).toHaveURL('/app/agenda?view=tasks&layout=kanban');
  await expect(board).toBeVisible();
});

test('uma reunião e um id inexistente mostram a tarefa indisponível sem revelar o título', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const title = `Reunião de alinhamento ${Date.now().toString(36)}`;
  const main = screen.getByRole('main');
  await app.open('/app/agenda?view=tasks');
  await expect(screen.getByRole('region', 'Tarefas')).toHaveAttribute('aria-busy', 'false');
  await screen.getByRole('button', 'Nova tarefa').tap();
  // The dialog's title follows the kind chosen in it.
  const dialog = screen.getByRole('dialog', /^Nova (tarefa|reunião)$/);
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Tipo').selectOption('Reunião');
  await dialog.getByRole('button', 'Salvar').tap();
  await expect(dialog).toHaveCount(0);
  const { id } = (await sql<{ id: string }>(`SELECT id FROM agenda_activity WHERE title=$1 AND kind='meeting' AND ${inOffice}`, [title, admin.email]))[0]!;

  for (const path of [`/app/agenda/tasks/${id}`, `/app/agenda/tasks/${crypto.randomUUID()}`]) {
    await app.open(path);
    await expect(main.getByRole('heading', { name: 'Tarefa indisponível', level: 1 })).toBeVisible();
    await expect(main.getByRole('alert')).toContainText('Registro não encontrado');
    await expect(main.getByRole('button', 'Tentar novamente')).toBeVisible();
    await expect(main.getByRole('link', 'Tarefas')).toBeVisible();
    await expect(main.getByRole('button', 'Editar tarefa')).toHaveCount(0);
    await expect(main).not.toContainText(title);
  }
  await app.screenshot('01-tarefa-indisponivel');

  await browser.setViewport({ width: 390, height: 844 });
  // The Lume stays open after the resize, and on a phone it covers the canvas.
  await screen.getByRole('button', 'Abrir o canvas do escritório').tap();
  await expect(main.getByRole('heading', { name: 'Tarefa indisponível', level: 1 })).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});

test('a página da tarefa mostra a falha de carregamento e tenta de novo', { session: 'admin' }, async ({ app, screen, browser }) => {
  let failing = true;
  await browser.route('**/api/agenda/activities/get', route => failing
    ? route.fulfill({ status: 503, json: { error: 'Falha de teste ao carregar a tarefa.' } })
    : route.continue());
  const main = screen.getByRole('main');
  await app.open(`/app/agenda/tasks/${crypto.randomUUID()}`);
  await expect(main.getByRole('alert')).toContainText('Falha de teste ao carregar a tarefa.');
  failing = false;
  await main.getByRole('button', 'Tentar novamente').tap();
  await expect(main.getByRole('alert')).toContainText('Registro não encontrado');
});
