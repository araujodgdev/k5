import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { localDate } from '../src/lib/calendar-days';
import { activityDto, crmClientDto } from '../src/lib/capabilities/agenda';
import { overflowsHorizontally } from './support/fixtures';

// Controlled UI fixtures only: these tests never add or edit the office's business data.
describe('área de trabalho', { session: 'admin' }, () => {
  test('o menu Mais opções no celular prende o foco, alterna o tema e devolve o foco ao fechar', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/app/command-center');
    // On a phone the Lume comes first; the menu sits in the canvas's header.
    await screen.getByRole('button', 'Abrir o canvas do escritório').tap();
    const more = screen.getByRole('button', /^Mais opções/);
    await more.tap();
    const sheet = screen.getByRole('dialog', 'Mais opções');
    await expect(sheet).toBeVisible();
    // Focus lands on the first place, and Tab wraps around inside the sheet.
    const first = sheet.getByRole('link', 'Todos os casos');
    await expect(first).toBeFocused();
    await browser.keyboard.press('Shift+Tab');
    await expect(sheet.getByRole('button', 'Fechar')).toBeFocused();
    await browser.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await expect(sheet.getByRole('button', 'Tutorial do Lume')).toBeVisible();
    const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
    await sheet.getByRole('button', dark ? 'Usar tema claro' : 'Usar tema escuro').tap();
    await expect(browser).toHaveClass(browser.locator('html'), dark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
    await sheet.getByRole('button', dark ? 'Usar tema escuro' : 'Usar tema claro').tap();
    await expect(browser).toHaveClass(browser.locator('html'), dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
    await browser.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('o compositor do chat fica visível numa conversa longa e o rascunho sobrevive à rolagem', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    const conversation = { id: 'ui-scroll-fixture-1', title: 'Conversa de verificação', updatedAt: new Date().toISOString() };
    await browser.route(/\/api\/conversations\/ui-scroll-fixture-\d+$/, route => route.fulfill({ json: { conversation, messages: Array.from({ length: 30 }, (_, i) => ({
      id: `fixture-${i}`, role: i % 2 ? 'assistant' : 'user',
      parts: [{ type: 'text', text: `Mensagem ${i}. ` + 'Conteúdo da conversa para verificar rolagem e acesso ao campo de mensagem. '.repeat(8) }],
    })) } }));
    await browser.route(/\/api\/chat\/ui-scroll-fixture-\d+\/stream/, route => route.fulfill({ status: 204 }));
    // A link that names a conversation opens it in the Lume's panel, which a phone shows first.
    await app.open(`/app/command-center?conversationId=${conversation.id}`);
    const input = screen.getByRole('textbox', 'Peça algo ao Lume');
    const bottomOf = async () => { const box = (await input.boundingBox())!; return box.y + box.height; };
    const latest = screen.getByRole('button', 'Voltar ao mais recente');
    // The chat sticks to the bottom while late content renders, which can undo one scroll; scroll
    // up again, as a person would, until the jump-back button appears.
    const scrollToTop = () => expect.poll(async () => {
      await browser.evaluate(() => { document.querySelector('[data-chat-viewport]')!.scrollTo(0, 0); return null; });
      return latest.isVisible();
    }).toBe(true);
    await expect(screen.getByText('Mensagem 29.', { exact: false })).toBeVisible();
    // The panel fills the phone's screen: the composer stays whole on it, above or below the history.
    expect(await bottomOf()).toBeLessThanOrEqual(844);
    await scrollToTop();
    expect(await bottomOf()).toBeLessThanOrEqual(844);
    expect((await input.boundingBox())!.y).toBeGreaterThan(100);
    await input.fill('Rascunho preservado durante a rolagem');
    await latest.tap();
    await expect(latest).toBeHidden();
    await expect(input).toHaveValue('Rascunho preservado durante a rolagem');
    // A short viewport, as with the on-screen keyboard open.
    await browser.setViewport({ width: 390, height: 540 });
    await expect.poll(bottomOf).toBeLessThanOrEqual(540);
    await browser.setViewport({ width: 1440, height: 900 });
    await scrollToTop();
    expect(await bottomOf()).toBeLessThan(900);
  });

  test('Início, calendário e ficha do cliente com dados controlados, estados vazios e de erro', async ({ app, screen, browser }) => {
    const now = new Date(); const day = localDate(now); const year = now.getFullYear(); const month = now.getMonth();
    // Built through the app's own DTOs, so new fields get their defaults instead of breaking the page.
    const stamp = { version: 1, createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' };
    const client = crmClientDto.parse({ ...stamp, id: 'ui-client', name: 'Marina Albuquerque', stage: 'active', email: 'marina@example.test', phone: '(11) 99999-0000', notes: 'Cliente acompanhado pelo escritório.', caseIds: ['ui-case'] });
    const task = activityDto.parse({ ...stamp, id: 'ui-task', title: 'Revisar contrato de prestação de serviços', kind: 'task', dueOn: day, clientId: client.id, caseId: 'ui-case' });
    const meeting = activityDto.parse({ ...task, id: 'ui-meeting', title: 'Reunião com Marina', kind: 'meeting', dueOn: null, startsAt: new Date(year, month, 12, 23).toISOString(), endsAt: new Date(year, month, 14).toISOString() });
    let completed = false; let failMonth = false; let empty = false;
    const unexpected: string[] = [];
    await browser.route('**/api/vault/cases', route => route.fulfill({ json: { cases: empty ? [] : [{ id: 'ui-case', name: 'Albuquerque · Contratos' }] } }));
    await browser.route('**/api/agenda/members/list', route => route.fulfill({ json: { members: [] } }));
    await browser.route('**/api/agenda/clients/list', route => route.fulfill({ json: { clients: empty ? [] : [client], total: empty ? 0 : 1 } }));
    await browser.route('**/api/agenda/clients/get', route => route.fulfill({ json: { client } }));
    await browser.route('**/api/agenda/proposals/list', route => route.fulfill({ json: { proposals: [] } }));
    await browser.route(/\/api\/client-portal\/manage\?clientId=ui-client$/, route => route.fulfill({ json: { access: null, files: [], artifacts: [] } }));
    await browser.route('**/api/agenda/activities/update', route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { activityId: string; status: string; version: number };
      if (body.activityId !== task.id || body.status !== 'completed' || body.version !== 1) unexpected.push(JSON.stringify(body));
      completed = true;
      return route.fulfill({ json: { activity: { ...task, status: 'completed', version: 2 } } });
    });
    await browser.route('**/api/agenda/clients/update', route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { clientId: string; version: number; name: string };
      if (body.clientId !== client.id || body.version !== client.version) unexpected.push(JSON.stringify(body));
      Object.assign(client, { name: body.name, version: client.version + 1 });
      return route.fulfill({ json: { client } });
    });
    await browser.route('**/api/agenda/activities/list', route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { limit: number; offset?: number; kind?: string; query?: string; dueFrom?: string };
      if (failMonth && body.limit === 100) return route.fulfill({ status: 503, json: { error: 'Falha temporária' } });
      let all = empty ? [] : [task, meeting];
      if (body.kind) all = all.filter(item => item.kind === body.kind && !(completed && item.id === task.id));
      if (body.query) all = all.filter(item => item.title.toLowerCase().includes(body.query!.toLowerCase()));
      if (body.dueFrom && !String(body.dueFrom).startsWith(day.slice(0, 7))) all = [];
      // Force monthly pagination: the only meeting is on the second page.
      if (body.limit === 100 && !empty && !body.query && all.length) {
        return route.fulfill({ json: { activities: body.offset ? [meeting] : Array.from({ length: 100 }, (_, i) => ({ ...task, dueOn: localDate(new Date(year, month + 1, 0)), id: `monthly-${i}` })), total: 101 } });
      }
      return route.fulfill({ json: { activities: all, total: all.length } });
    });
    const calendarDay = (date: number) => browser.locator(`[data-calendar-day="${localDate(new Date(year, month, date))}"]`);
    const markedDays = browser.locator('[data-calendar-day][aria-label*="atividade"]');

    await app.open('/app/command-center');
    await expect(screen.getByRole('heading', { name: 'Hoje', level: 1 })).toBeVisible();
    await screen.getByRole('checkbox', `Concluir ${task.title}`).tap();
    // The task leaves the day; the mocked meeting stays.
    await expect(screen.getByText(`Tarefa concluída: ${task.title}`)).toBeAttached();
    await expect(screen.getByRole('checkbox', `Concluir ${task.title}`)).toHaveCount(0);
    expect(completed).toBe(true);
    // Início has no shortcut of its own for a new task; the address opens the form in Tarefas.
    await app.open('/app/agenda?view=tasks&action=new');
    await expect(screen.getByRole('dialog')).toBeVisible();
    await expect(screen.getByLabel('Título')).toBeVisible();
    await screen.getByRole('button', 'Cancelar').tap();

    // A meeting from the 12th at 23:00 to the 14th at midnight marks the 12th and 13th only.
    await app.open('/app/agenda?view=calendar');
    await expect(calendarDay(12)).toHaveAttribute('aria-label', /1 atividade/);
    await expect(calendarDay(13)).toHaveAttribute('aria-label', /1 atividade/);
    await expect(calendarDay(14)).not.toHaveAttribute('aria-label', /atividade/);
    await calendarDay(12).focus();
    await browser.keyboard.press('ArrowRight');
    await expect(calendarDay(13)).toBeFocused();
    await screen.getByRole('button', 'Próximo mês').tap();
    await expect(screen.getByRole('status')).toHaveCount(0);
    await expect(markedDays).toHaveCount(0);
    await screen.getByRole('button', 'Mês anterior').tap();
    await expect(calendarDay(12)).toHaveAttribute('aria-label', /1 atividade/);
    await screen.getByRole('searchbox', 'Buscar na agenda').fill('Reunião');
    await expect(markedDays).toHaveCount(2);
    failMonth = true;
    await browser.reload();
    await expect(screen.getByText('Não foi possível carregar os marcadores do mês.')).toBeVisible();
    failMonth = false;
    await screen.getByRole('button', 'Tentar novamente').tap();
    await expect(calendarDay(12)).toHaveAttribute('aria-label', /1 atividade/);

    await app.open('/app/agenda?view=clients');
    await screen.getByRole('link', client.name).tap();
    await browser.waitForURL(/\/app\/agenda\/clients\/ui-client$/);
    await expect(screen.getByRole('heading', client.name)).toBeVisible();
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    await screen.getByRole('button', 'Editar cliente').tap();
    await screen.getByLabel('Nome').fill('Marina Albuquerque Silva');
    await screen.getByRole('button', 'Salvar').tap();
    await expect(screen.getByRole('heading', 'Marina Albuquerque Silva')).toBeVisible();
    await browser.reload();
    await expect(screen.getByRole('heading', 'Marina Albuquerque Silva')).toBeVisible();
    expect(unexpected).toEqual([]);

    const pages = ['/app/agenda/clients/ui-client', '/app/agenda?view=calendar', '/app/command-center'];
    // On a phone Início opens on the Lume; a view's own address opens the canvas over it.
    const home = '/app/command-center';
    const openCanvas = () => screen.getByRole('button', 'Abrir o canvas do escritório').tap();
    await browser.setViewport({ width: 390, height: 844 });
    for (const path of pages) {
      await app.open(path);
      if (path === home) await openCanvas();
      await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(screen.getByRole('status')).toHaveCount(0);
      expect(await browser.evaluate(overflowsHorizontally), path).toBe(false);
    }
    await browser.evaluate(() => { localStorage.setItem('k5-theme', 'dark'); return null; });
    await browser.setViewport({ width: 320, height: 740 });
    for (const path of pages) {
      await app.open(path);
      await expect(browser).toHaveClass(browser.locator('html'), /dark/);
      await expect(screen.getByRole('status')).toHaveCount(0);
      expect(await browser.evaluate(overflowsHorizontally), path).toBe(false);
    }
    // An empty day: no tasks or meetings, no installments due and no publications.
    await browser.route('**/api/honorarios/list', route => route.fulfill({ json: { installments: [], total: 0, summary: { totalCents: 0, receivedCents: 0, pendingCents: 0, overdueCents: 0 }, today: day } }));
    await browser.route('**/api/judicial/alerts**', route => route.fulfill({ json: { alerts: [] } }));
    empty = true;
    await browser.reload();
    await openCanvas();
    await expect(screen.getByText('Nada para hoje.')).toBeVisible();
  });
});
