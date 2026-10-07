import { test } from './support/fixtures';
import { expect } from 'e2e';
import { ApiSession, admin, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';
import { overflowsHorizontally } from './support/fixtures';

type Page = { id: string; caseId: string; title: string; content: string; version: number };
const pageApi = (page: Page) => `/api/cases/${page.caseId}/pages/${page.id}`;
const pageHref = (page: Page) => `/app/vault/cases/${page.caseId}/pages/${page.id}`;

test('páginas: criar no caso, editar, recarregar, restaurar e usar o canvas móvel', { session: 'admin' }, async ({ app, screen, browser, sql }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const { case: record } = await api.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Páginas do caso ${Date.now()}` } });
  await app.open(`/app/vault/cases/${record.id}`);
  await screen.getByRole('group', 'Seção do caso').getByRole('button', 'Páginas').tap();
  await expect(screen.getByText('Nenhuma página nesta pasta.', { exact: false })).toBeVisible();
  await screen.getByRole('button', 'Nova página').tap();
  await screen.getByLabel('Nome da página').fill('Plano de trabalho conjunto');
  await screen.getByRole('button', 'Criar página').tap();
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toBeVisible();
  await editor.fill('Texto salvo pelos controles reais da página.');
  await expect(screen.getByText('Salvo', { exact: true })).toBeVisible();
  const { pages } = await api.json<{ pages: Page[] }>(`/api/cases/${record.id}/pages`);
  expect(pages).toHaveLength(1);
  const page = pages[0];
  const read = () => api.json<{ page: Page }>(pageApi(page));
  await expect.poll(async () => (await read()).page.content).toContain('Texto salvo pelos controles reais');
  expect(await sql('SELECT title,content FROM case_page WHERE id=$1', [page.id])).toMatchObject([{ title: 'Plano de trabalho conjunto', content: (await read()).page.content }]);
  await app.open(pageHref(page));
  await expect(editor).toContainText('Texto salvo pelos controles reais');
  await editor.fill('Segunda edição compartilhada.');
  await expect.poll(async () => (await read()).page.content).toContain('Segunda edição');
  await screen.getByRole('button', 'Versões').tap();
  await screen.getByRole('button', 'Restaurar').first().tap();
  await expect(editor).toContainText('Texto salvo pelos controles reais');
  await expect.poll(async () => (await read()).page.content).toContain('Texto salvo pelos controles reais');
  await screen.getByRole('tab', 'Página', { exact: true }).tap();
  await expect(browser.locator('[aria-label="Pré-visualização das páginas"]')).toContainText('Texto salvo pelos controles reais');
  await expect(screen.getByRole('tab', 'Revisão', { exact: false })).toHaveCount(0);
  await screen.getByRole('tab', 'Editar').tap();
  await app.screenshot('pagina-compartilhada-desktop');
  await browser.setViewport({ width: 390, height: 844 });
  await app.open(pageHref(page));
  await expect(editor).toBeVisible();
  await screen.getByRole('button', 'Versões').tap();
  await expect(screen.getByRole('button', 'Restaurar').first()).toBeVisible();
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('button', 'Versões')).toBeFocused();
  await screen.getByRole('button', 'Voltar ao Lume').tap();
  await screen.getByRole('textbox', 'Pergunte ao Lume').fill('Pedido mantido no celular');
  await screen.getByRole('button', 'Recolher o Lume').tap();
  await expect(editor).toContainText('Texto salvo pelos controles reais');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('pagina-compartilhada-mobile');
});

test('publicação: revisar uma cópia exata, manter o original particular e colaborar com conflito e revogação', async ({ app, screen, browser }) => {
  const owner = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Proprietária páginas'));
  const guest = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Participante páginas'));
  const outsider = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Externa páginas'));
  const { user } = await guest.json<{ user: { id: string; email: string } }>('/api/auth/get-session');
  const invite = await owner.json<{ id: string }>('/api/collaboration', { json: { action: 'invite', invitation: { email: user.email } } });
  await guest.json('/api/collaboration', { json: { action: 'respond', id: invite.id, accept: true } });
  const { case: record } = await owner.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Caso compartilhado ${Date.now()}` } });
  await owner.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: user.id, add: true } });
  const { artifact } = await owner.json<{ artifact: { id: string } }>('/api/artifacts', { json: { title: 'Rascunho de publicação', content: 'Texto particular antes da revisão.' } });
  await signInWithSession({ app, screen, browser }, owner);
  await app.open(`/app/documents/${artifact.id}`);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await editor.fill('Texto exato revisado para os participantes.');
  await screen.getByRole('button', 'Publicar no caso').tap();
  await screen.getByLabel('Caso', { exact: true }).selectOption({ value: record.id });
  await screen.getByRole('button', 'Revisar publicação').tap();
  const dialog = screen.getByRole('dialog', 'Publicar no caso');
  await expect(dialog).toContainText('Texto exato revisado para os participantes.');
  await expect(dialog).toContainText(`Destino: ${record.name}`);
  await expect(dialog).toContainText('Participantes com acesso a esta pasta do caso.');
  await app.screenshot('publicacao-revisada');
  await screen.getByRole('button', 'Confirmar publicação').tap();
  await expect(browser).toHaveURL(new RegExp(`/app/vault/cases/${record.id}/pages/`), { timeout: 60_000 });
  const { pages } = await owner.json<{ pages: Page[] }>(`/api/cases/${record.id}/pages`);
  expect(pages).toHaveLength(1);
  const page = pages[0];
  expect((await guest.request(`/api/artifacts/${artifact.id}`)).status).toBe(404);
  expect((await owner.json<{ artifact: { content: string } }>(`/api/artifacts/${artifact.id}`)).artifact.content).toContain('Texto exato revisado');
  for (const path of [pageApi(page), `${pageApi(page)}/versions`, `${pageApi(page)}/export`, `/api/canvas/resource?href=${encodeURIComponent(pageHref(page))}`]) expect((await outsider.request(path)).status).toBe(404);
  const docx = await guest.request(`${pageApi(page)}/export?format=docx&version=1`);
  expect(docx.status).toBe(200);
  expect(docx.headers.get('content-type')).toContain('wordprocessingml');
  await signInWithSession({ app, screen, browser }, guest);
  await app.open(pageHref(page));
  await expect(editor).toContainText('Texto exato revisado');
  await owner.json(pageApi(page), { method: 'PUT', json: { title: page.title, content: 'Edição simultânea da proprietária.', version: 1 } });
  await editor.fill('Rascunho da participante que precisa sobreviver.');
  await expect(screen.getByText('Conflito de versão', { exact: true })).toBeVisible();
  await expect(editor).toContainText('Rascunho da participante que precisa sobreviver.');
  await app.screenshot('conflito-real-entre-participantes');
  await screen.getByRole('button', 'Manter a minha').tap();
  await expect.poll(async () => (await guest.json<{ page: Page }>(pageApi(page))).page.content).toContain('Rascunho da participante');
  await app.open(pageHref(page));
  await expect(editor).toContainText('Rascunho da participante');
  await owner.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: user.id, add: false } });
  for (const path of [pageApi(page), `${pageApi(page)}/versions`, `${pageApi(page)}/export`, `/api/canvas/resource?href=${encodeURIComponent(pageHref(page))}`]) expect((await guest.request(path)).status).toBe(404);
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('link', page.title, { exact: true }).tap();
  await expect(editor).toHaveCount(0);
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('link', page.title, { exact: true })).toHaveCount(0);
  await app.screenshot('pagina-revogada');
});

test('contrato frontend: página enviada fica congelada e resultado tardio não toma o outro editor', { session: 'admin', tags: ['frontend-contract'] }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: `Páginas tardias ${Date.now()}` } });
  const first = (await api.json<{ page: Page }>(`/api/cases/${record.id}/pages`, { json: { title: 'Página enviada', content: 'Primeira página' } })).page;
  const second = (await api.json<{ page: Page }>(`/api/cases/${record.id}/pages`, { json: { title: 'Outra página aberta', content: 'Segunda página' } })).page;
  const release = Promise.withResolvers<void>();
  const requests: Array<{ document: { kind: string; caseId: string; id: string }; canvasHref: string }> = [];
  await browser.route('**/api/chat', async route => {
    requests.push(JSON.parse(route.request.postData ?? '{}'));
    await release.promise;
    const chunks = [
      { type: 'start', messageId: 'page-late-answer' },
      { type: 'data-tool', id: 'page-write', data: { callId: 'page-write', name: 'k5_case_pages_update', state: 'completed', summary: 'Página atualizada', href: pageHref(first) } },
      { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Página atualizada.' }, { type: 'text-end', id: 'text' }, { type: 'finish' },
    ];
    return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await app.open(pageHref(first));
  await expect(screen.getByRole('textbox', 'Texto do documento')).toContainText('Primeira página');
  await screen.getByRole('textbox', 'Pergunte ao Lume').fill('Atualize esta página');
  await screen.getByRole('button', 'Enviar mensagem').tap();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ document: { kind: 'case-page', caseId: record.id, id: first.id }, canvasHref: pageHref(first) });
  try {
    await screen.getByRole('link', 'Voltar à conversa').tap();
    await screen.getByRole('link', new RegExp(second.title)).tap();
    await screen.getByRole('textbox', 'Texto do documento').fill('Edição humana na outra página');
    await api.json(pageApi(first), { method: 'PUT', json: { title: first.title, content: 'Resultado salvo antes da saída tardia', version: 1 } });
  } finally { release.resolve(); }
  await expect(screen.getByText('Página atualizada.', { exact: true })).toBeVisible();
  await expect(browser).toHaveURL(pageHref(second));
  await expect(screen.getByRole('textbox', 'Texto do documento')).toContainText('Edição humana na outra página');
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('link', first.title, { exact: true }).tap();
  await expect(screen.getByRole('textbox', 'Texto do documento')).toContainText('Resultado salvo antes da saída tardia');
  await app.screenshot('contrato-pagina-resultado-tardio');
});
