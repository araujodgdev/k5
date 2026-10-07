import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, admin } from './support/accounts';
import type { CaseTask } from '../src/lib/case-tasks/contracts';
import { overflowsHorizontally } from './support/fixtures';

describe('abas e controles do Lume', { session: 'admin' }, () => {
  test('trocar abas preserva o chat e o rascunho, com controles na mesma linha', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1440, height: 900 });
    await app.open('/app/command-center');
    const input = screen.getByRole('textbox', 'Pergunte ao Lume');
    await input.fill('Rascunho que continua aberto entre as abas');
    await browser.evaluate(() => {
      document.querySelector('textarea[aria-label="Pergunte ao Lume"]')!.setAttribute('data-tab-proof', 'mounted');
      return null;
    });
    for (const name of ['Cofre', 'E-mails', 'Início']) {
      await screen.getByRole('button', 'Casos e módulos').tap();
      await screen.getByRole('navigation', 'Casos e módulos').getByRole('link', name === 'Cofre' ? 'Todos os casos' : name, { exact: true }).tap();
      await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('link', name, { exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
      await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    }
    const tabs = screen.getByRole('navigation', 'Abas do canvas');
    for (const name of ['E-mails', 'Cofre', 'Início']) {
      await tabs.getByRole('link', name, { exact: true }).tap();
      await expect(tabs.getByRole('link', name, { exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
      await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    }
    await screen.getByRole('button', 'Ampliar conversa').tap();
    await browser.keyboard.press('Control+k');
    await screen.getByRole('group', 'Abas abertas').getByRole('option', 'Início', { exact: true }).tap();
    await expect(screen.getByRole('button', 'Ampliar conversa')).toBeVisible();
    await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    const ys = await browser.evaluate(() => Array.from(document.querySelectorAll('.lume-panel-header button')).map(button => button.getBoundingClientRect().y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    await expect(screen.getByRole('button', 'Personalizar Lume')).toHaveCount(0);
    await expect(screen.getByRole('button', 'Artefatos')).toHaveCount(0);
    await app.screenshot('abas-preservam-chat');
    await browser.setViewport({ width: 390, height: 844 });

    await screen.getByRole('button', 'Buscar', { exact: true }).tap();
    await screen.getByRole('option', 'Cofre', { exact: true }).tap();
    await screen.getByRole('button', 'Voltar ao Lume').tap();
    await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
    await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot('chat-mobile-preservado');
  });

  test('notificações e feedback são arredondados e centralizados no desktop e celular', { timeout: 240_000 }, async ({ app, screen, browser }) => {
    await app.open('/app/vault');
    for (const width of [1440, 390]) {
      await browser.setViewport({ width, height: 900 });
      if (width < 768) await screen.getByRole('button', 'Mais opções').tap();
      await screen.getByRole('button', /^Notificações/).tap();
      const checkDialog = async () => {
        const dialog = screen.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const box = (await dialog.boundingBox())!;
        expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
        expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(2);
        const radius = await browser.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[role="dialog"]')!).borderRadius));
        expect(radius).toBeGreaterThanOrEqual(12);
      };
      await checkDialog();
      await browser.keyboard.press('Escape');
      if (width < 768) { await screen.getByRole('button', 'Mais opções').tap(); await screen.getByRole('button', 'Enviar feedback', { exact: true }).tap(); }
      else { await screen.getByRole('button', /^Conta de /).tap(); await screen.getByRole('menuitem', 'Enviar feedback').tap(); }
      await checkDialog();
      const feedbackRadii = await browser.evaluate(() => Array.from(document.querySelectorAll('.feedback-panel label:has(input[type="radio"]), .feedback-panel .border-line')).map(item => parseFloat(getComputedStyle(item).borderRadius)));
      expect(feedbackRadii.length).toBeGreaterThanOrEqual(5);
      expect(Math.min(...feedbackRadii)).toBeGreaterThanOrEqual(10);
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`feedback-centralizado-${width}`);
      await browser.keyboard.press('Escape');
      await screen.getByRole('button', width < 768 ? 'Mais opções' : 'Casos e módulos').tap();
      await screen.getByRole('button', 'Tutorial do Lume').tap();
      await checkDialog();
      await browser.keyboard.press('Escape');
      if (width < 768) await screen.getByRole('button', 'Voltar ao Lume').tap();
      await screen.getByRole('button', 'Anexar arquivos').tap();
      await expect(screen.getByRole('button', 'Documento ou planilha')).toBeVisible();
      expect(await browser.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-slot="popover-content"]')!).borderRadius))).toBeGreaterThanOrEqual(10);
      await browser.keyboard.press('Escape');
    }
  });
});


test('o cliente aberto dá nome à aba e ao contexto sem perder o rascunho', { session: 'admin', timeout: 180_000 }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const { client } = await api.json<{ client: { id: string; name: string } }>('/api/agenda/clients/create', { json: { name: 'Cliente do canvas ' + Date.now() } });
  await app.open('/app/agenda/clients/' + client.id);
  const tabs = screen.getByRole('navigation', 'Abas do canvas');
  await expect(screen.getByRole('heading', client.name, { exact: true })).toBeVisible();
  await expect(tabs.getByRole('link', client.name, { exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(screen.getByLabel('Contexto da próxima mensagem')).toContainText(client.name);
  const input = screen.getByRole('textbox', 'Pergunte ao Lume');
  await input.fill('Rascunho enquanto confiro o cliente');
  await screen.getByRole('button', 'Casos e módulos').tap();
  await screen.getByRole('navigation', 'Casos e módulos').getByRole('link', 'Todos os casos', { exact: true }).tap();
  await expect(browser).toHaveURL('/app/vault');
  await tabs.getByRole('link', client.name, { exact: true }).tap();
  await expect(browser).toHaveURL('/app/agenda/clients/' + client.id);
  await expect(screen.getByLabel('Contexto da próxima mensagem')).toContainText(client.name);
  await expect(input).toHaveValue('Rascunho enquanto confiro o cliente');
});

test('contrato frontend: a tarefa abre e retoma sua conversa específica sem recarregar o painel', { session: 'admin', tags: ['frontend-contract'], timeout: 180_000 }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const stamp = Date.now();
  const { case: record } = await api.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: 'Caso da tarefa ' + stamp } });
  const { task } = await api.json<{ task: CaseTask }>('/api/cases/' + record.id + '/tasks', { json: { title: 'Tarefa do contrato ' + stamp, idempotencyKey: crypto.randomUUID() } });
  const { conversation: other } = await api.json<{ conversation: { id: string; title: string } }>('/api/conversations', { json: { title: 'Conversa anterior ' + stamp } });
  const { conversation: target } = await api.json<{ conversation: { id: string; title: string } }>('/api/conversations', { json: { title: 'Conversa da tarefa ' + stamp } });
  const tasks = await api.json<{ tasks: CaseTask[]; members: Array<{ id: string; name: string }> }>('/api/cases/' + record.id + '/tasks');
  let delegated = false;
  await browser.route('**/api/cases/' + record.id + '/tasks', route => route.fulfill({ json: { ...tasks, tasks: tasks.tasks.map(item => ({ ...item, agentConversationId: delegated ? target.id : null })) } }));
  await browser.route('**/api/agenda/delegate', route => {
    expect(JSON.parse(route.request.postData ?? '{}')).toMatchObject({ activityId: task.id });
    delegated = true;
    return route.fulfill({ json: { conversationId: target.id, url: '/app/agents?conversationId=' + target.id + '&caseId=' + record.id } });
  });
  await app.open('/app/vault/cases/' + record.id + '?section=tasks&conversationId=' + other.id);
  await expect(screen.getByRole('textbox', 'Pergunte ao Lume')).toBeVisible();
  await browser.evaluate(() => { document.getElementById('lume-panel')!.setAttribute('data-shell-proof', 'mounted'); return null; });
  const item = screen.getByRole('article', task.title);
  await item.getByRole('button', 'Pedir ao Lume', { exact: true }).tap();
  const history = browser.locator('#agent-conversations');
  await screen.getByRole('button', 'Mostrar conversas').tap();
  await expect(history.getByRole('button', new RegExp('^' + target.title))).toHaveAttribute('aria-current', 'true');
  await history.getByRole('button', new RegExp('^' + other.title)).tap();
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('link', record.name, { exact: true }).tap();
  await screen.getByRole('button', 'Tarefas', { exact: true }).tap();
  await item.getByRole('link', 'Minha conversa').tap();
  await screen.getByRole('button', 'Mostrar conversas').tap();
  await expect(history.getByRole('button', new RegExp('^' + target.title))).toHaveAttribute('aria-current', 'true');
  await expect(browser.locator('#lume-panel')).toHaveAttribute('data-shell-proof', 'mounted');
});
