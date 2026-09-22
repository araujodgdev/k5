import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { localDate } from '../src/lib/calendar-days';

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('playwright-report/workspace-ui', { recursive: true });
try {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.PWA_TEST_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.PWA_TEST_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/app/**');
  await page.getByRole('button', { name: 'Mais', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Mais opções' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('combobox', { name: 'Tema' })).not.toBeFocused();
  await expect(sheet.getByRole('heading', { name: 'Mais opções' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('link', { name: 'Notificações' })).toBeFocused();
  await sheet.getByRole('combobox', { name: 'Tema' }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'playwright-report/workspace-ui/more-dark.png' });
  await sheet.getByRole('combobox', { name: 'Tema' }).selectOption('light');
  console.log('PASS: abrir Mais não coloca foco no seletor nativo de tema.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mais', exact: true })).toBeFocused();
  const conversation = { id: 'ui-scroll-fixture', title: 'Conversa de verificação', updatedAt: new Date().toISOString() };
  await page.route('**/api/conversations', route => route.fulfill({ json: { conversations: [conversation] } }));
  await page.route('**/api/conversations/ui-scroll-fixture', route => route.fulfill({ json: { conversation, messages: Array.from({ length: 30 }, (_, i) => ({ id: `fixture-${i}`, role: i % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `Mensagem ${i}. ` + 'Conteúdo da conversa para verificar rolagem e acesso ao campo de mensagem. '.repeat(8) }] })) } }));
  await page.goto('/app/agents');
  const input = page.getByRole('textbox', { name: /Pergunte ao/ });
  await expect(input).toBeVisible();
  const box = await input.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(844 - 64);
  const viewport = page.locator('[data-chat-viewport]');
  await viewport.evaluate(el => el.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Voltar ao mais recente' })).toBeVisible();
  const topBox = await input.boundingBox();
  expect(topBox!.y + topBox!.height).toBeLessThan(780);
  expect(topBox!.y).toBeGreaterThan(100);
  await input.fill('Rascunho preservado durante a rolagem');
  await page.screenshot({ path: 'playwright-report/workspace-ui/chat-mobile.png' });
  await page.getByRole('button', { name: 'Voltar ao mais recente' }).click();
  await expect(page.getByRole('button', { name: 'Voltar ao mais recente' })).not.toBeVisible();
  await expect(input).toHaveValue('Rascunho preservado durante a rolagem');
  await page.setViewportSize({ width: 390, height: 540 });
  expect((await input.boundingBox())!.y + (await input.boundingBox())!.height).toBeLessThan(476);
  await page.setViewportSize({ width: 1440, height: 900 });
  await viewport.evaluate(el => el.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Voltar ao mais recente' })).toBeVisible();
  expect((await input.boundingBox())!.y + (await input.boundingBox())!.height).toBeLessThan(900);
  await page.screenshot({ path: 'playwright-report/workspace-ui/chat-desktop.png' });
  console.log('PASS: compositor dentro da área visível com conversa longa no celular.');

  // Controlled UI fixtures only: never add or edit the local office's business data.
  const now = new Date(); const day = localDate(now); const year = now.getFullYear(); const month = now.getMonth();
  const client = { id: 'ui-client', name: 'Marina Albuquerque', stage: 'active', email: 'marina@example.test', phone: '(11) 99999-0000', notes: 'Cliente acompanhado pelo escritório.', caseIds: ['ui-case'], version: 1 };
  const task = { id: 'ui-task', title: 'Revisar contrato de prestação de serviços', kind: 'task', status: 'pending', dueOn: day, startsAt: null, endsAt: null, clientId: client.id, caseId: 'ui-case', assigneeId: null, notes: '', version: 1 };
  const meeting = { ...task, id: 'ui-meeting', title: 'Reunião com Marina', kind: 'meeting', dueOn: null, startsAt: new Date(year, month, 12, 23).toISOString(), endsAt: new Date(year, month, 14).toISOString() };
  let completed = false; let failMonth = false; let empty = false;
  await page.route('**/api/vault/cases', route => route.fulfill({ json: { cases: empty ? [] : [{ id: 'ui-case', name: 'Albuquerque · Contratos' }] } }));
  await page.route('**/api/agenda/members/list', route => route.fulfill({ json: { members: [] } }));
  await page.route('**/api/agenda/clients/list', route => route.fulfill({ json: { clients: empty ? [] : [client], total: empty ? 0 : 1 } }));
  await page.route('**/api/agenda/clients/get', route => route.fulfill({ json: { client } }));
  await page.route('**/api/agenda/proposals/list', route => route.fulfill({ json: { proposals: [] } }));
  await page.route('**/api/agenda/activities/update', async route => {
    const body = route.request().postDataJSON();
    expect(body.activityId).toBe(task.id); expect(body.status).toBe('completed'); expect(body.version).toBe(1);
    completed = true;
    await route.fulfill({ json: { activity: { ...task, status: 'completed', version: 2 } } });
  });
  await page.route('**/api/agenda/clients/update', async route => {
    const body = route.request().postDataJSON();
    expect(body.clientId).toBe(client.id); expect(body.version).toBe(client.version);
    Object.assign(client, { name: body.name, version: client.version + 1 });
    await route.fulfill({ json: { client } });
  });
  await page.route('**/api/agenda/activities/list', async route => {
    const body = route.request().postDataJSON();
    if (failMonth && body.limit === 100) return route.fulfill({ status: 503, json: { error: 'Falha temporária' } });
    let all = empty ? [] : [task, meeting];
    if (body.kind) all = all.filter(item => item.kind === body.kind && !(completed && item.id === task.id));
    if (body.query) all = all.filter(item => item.title.toLowerCase().includes(body.query.toLowerCase()));
    if (body.dueFrom && !String(body.dueFrom).startsWith(day.slice(0, 7))) all = [];
    // Force monthly pagination: the only meeting is on the second page.
    if (body.limit === 100 && !empty && !body.query && all.length) {
      return route.fulfill({ json: { activities: body.offset ? [meeting] : Array.from({ length: 100 }, (_, i) => ({ ...task, dueOn: localDate(new Date(year, month + 1, 0)), id: `monthly-${i}` })), total: 101 } });
    }
    await route.fulfill({ json: { activities: all, total: all.length } });
  });
  await page.goto('/app/command-center');
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Concluir ${task.title}` })).toBeVisible();
  await page.screenshot({ path: 'playwright-report/workspace-ui/home-desktop.png' });
  await page.getByRole('checkbox', { name: `Concluir ${task.title}` }).click();
  await expect(page.getByText('Tudo em dia. Nenhuma tarefa pendente até hoje.')).toBeVisible();
  await page.getByRole('link', { name: 'Nova atividade', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Título', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto('/app/agenda?view=calendar');
  const twelfth = page.locator(`[data-calendar-day="${localDate(new Date(year, month, 12))}"]`);
  await expect(twelfth).toHaveAttribute('aria-label', /1 atividade/);
  await expect(page.locator(`[data-calendar-day="${localDate(new Date(year, month, 13))}"]`)).toHaveAttribute('aria-label', /1 atividade/);
  await expect(page.locator(`[data-calendar-day="${localDate(new Date(year, month, 14))}"]`)).not.toHaveAttribute('aria-label', /atividade/);
  await twelfth.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator(`[data-calendar-day="${localDate(new Date(year, month, 13))}"]`)).toBeFocused();
  await page.screenshot({ path: 'playwright-report/workspace-ui/calendar-desktop.png' });
  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('[data-calendar-day][aria-label*="atividade"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(twelfth).toHaveAttribute('aria-label', /1 atividade/);
  await page.getByRole('textbox', { name: 'Buscar atividades' }).fill('Reunião');
  await expect(page.locator('[data-calendar-day][aria-label*="atividade"]')).toHaveCount(2);
  failMonth = true;
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByText('Não foi possível carregar os marcadores do mês.')).toBeVisible();
  failMonth = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(twelfth).toHaveAttribute('aria-label', /1 atividade/);
  await page.goto('/app/agenda?view=clients');
  await page.getByRole('link', { name: client.name, exact: true }).click();
  await page.waitForURL('**/app/agenda/clients/ui-client');
  await expect(page.getByRole('heading', { name: client.name, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar cliente' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Marina Albuquerque Silva');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Marina Albuquerque Silva', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Marina Albuquerque Silva', exact: true })).toBeVisible();
  await page.screenshot({ path: 'playwright-report/workspace-ui/client-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [['client', '/app/agenda/clients/ui-client'], ['calendar', '/app/agenda?view=calendar'], ['home', '/app/command-center']]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `playwright-report/workspace-ui/${name}-mobile.png`, fullPage: true });
  }
  await page.evaluate(() => localStorage.setItem('k5-theme', 'dark'));
  await page.setViewportSize({ width: 320, height: 740 });
  for (const [name, url] of [['client', '/app/agenda/clients/ui-client'], ['calendar', '/app/agenda?view=calendar'], ['home', '/app/command-center']]) {
    await page.goto(url);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `playwright-report/workspace-ui/${name}-dark-small.png`, fullPage: true });
  }
  empty = true;
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByText('Nenhuma reunião agendada.')).toBeVisible();
  await expect(page.getByText('Nenhum cliente ativo cadastrado.')).toBeVisible();
  await expect(page.getByText('Seus casos e documentos aparecerão aqui.')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: desktop/mobile, teclado, tema, rolagem, marcadores paginados, filtros, erros, estados vazios, ações do início e página de cliente.');
} finally {
  await browser.close();
}
