import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, admin, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';

type Document = { id: string; title: string; content: string; version: number };
type Fixture = { api: string; href: string; document: Document; read: () => Promise<Document>; client: ApiSession };
type Latency = { status: number | null; release: () => void; original: typeof fetch };
type LatencyWindow = Window & { editorLatency?: Latency };

async function delayResponse(browser: Browser, path: string, method: string, beforeRequest = false) {
  await browser.evaluate(({ path, method, beforeRequest }) => {
    const surface = window as LatencyWindow;
    const original = surface.editorLatency?.original ?? window.fetch.bind(window);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const latency = { status: null as number | null, release, original };
    surface.editorLatency = latency;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== path || (init?.method ?? 'GET') !== method) return original(input, init);
      if (beforeRequest) { latency.status = 0; await gate; }
      const response = await original(input, init);
      latency.status = response.status;
      if (!beforeRequest) await gate;
      return response;
    };
    return null;
  }, { path, method, beforeRequest });
}

const delayedStatus = (browser: Browser) => browser.evaluate(() => (window as LatencyWindow).editorLatency?.status ?? null);
const releaseResponse = (browser: Browser) => browser.evaluate(() => {
  const surface = window as LatencyWindow;
  surface.editorLatency?.release();
  if (surface.editorLatency) window.fetch = surface.editorLatency.original;
  return null;
});

async function createDocument(client: ApiSession, shared: boolean): Promise<Fixture> {
  let api: string;
  let href: string;
  let document: Document;
  if (shared) {
    const { case: record } = await client.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: `Reparo do editor ${Date.now()}` } });
    const result = await client.json<{ page: Document }>(`/api/cases/${record.id}/pages`, { json: { title: 'Página do reparo', content: 'Conteúdo da versão um.' } });
    document = result.page;
    api = `/api/cases/${record.id}/pages/${document.id}`;
    href = `/app/vault/cases/${record.id}/pages/${document.id}`;
  } else {
    const result = await client.json<{ artifact: Document }>('/api/artifacts', { json: { title: 'Documento do reparo', content: 'Conteúdo da versão um.' } });
    document = result.artifact;
    api = `/api/artifacts/${document.id}`;
    href = `/app/documents/${document.id}`;
  }
  const read = async () => {
    const result = await client.json<{ artifact?: Document; page?: Document }>(api);
    return (result.page ?? result.artifact)!;
  };
  await client.json(api, { method: 'PUT', json: { title: document.title, content: 'Conteúdo da versão dois.', version: document.version, snapshot: true } });
  return { client, api, href, document, read };
}

for (const shared of [false, true]) {
  test(`restauração pendente ${shared ? 'compartilhada' : 'particular'} preserva título e texto posteriores`, { session: 'admin' }, async ({ app, screen, browser, sql }) => {
    const client = await new ApiSession(app.baseUrl!).signIn(admin);
    const fixture = await createDocument(client, shared);
    await app.open(fixture.href);
    const editor = screen.getByRole('textbox', 'Texto do documento');
    await expect(editor).toContainText('Conteúdo da versão dois.');
    await delayResponse(browser, `${fixture.api}/restore`, 'POST');
    await screen.getByRole('button', 'Versões').tap();
    await screen.getByRole('button', 'Restaurar').first().tap();
    await expect.poll(() => delayedStatus(browser), { timeout: 60_000 }).toBe(shared ? 201 : 200);
    expect((await fixture.read()).content).toBe('Conteúdo da versão um.');
    await browser.keyboard.press('Escape');
    await screen.getByRole('textbox', 'Título do documento').fill('Título digitado durante a restauração');
    await editor.fill('Texto digitado durante a restauração.');
    await expect(screen.getByRole('button', 'Ver versão salva')).toBeVisible();
    await app.screenshot(`restauracao-${shared ? 'compartilhada' : 'particular'}-antes-da-resposta`);
    await releaseResponse(browser);
    await expect(editor).toContainText('Texto digitado durante a restauração.');
    await expect(screen.getByRole('textbox', 'Título do documento')).toHaveValue('Título digitado durante a restauração');
    await screen.getByRole('button', 'Manter a minha').tap();
    await expect.poll(async () => (await fixture.read()).content).toContain('Texto digitado durante a restauração.');
    const stored = await fixture.read();
    expect(await sql(`SELECT title,content FROM ${shared ? 'case_page' : 'ai_artifact'} WHERE id=$1`, [fixture.document.id])).toEqual([{ title: 'Título digitado durante a restauração', content: stored.content }]);
    await app.open(fixture.href);
    await expect(editor).toContainText('Texto digitado durante a restauração.');
    await app.screenshot(`restauracao-${shared ? 'compartilhada' : 'particular'}-preservada`);
  });

  test(`recarga explícita ${shared ? 'compartilhada' : 'particular'} preserva digitação durante a leitura`, { session: 'admin' }, async ({ app, screen, browser }) => {
    const client = await new ApiSession(app.baseUrl!).signIn(admin);
    const fixture = await createDocument(client, shared);
    await app.open(fixture.href);
    const editor = screen.getByRole('textbox', 'Texto do documento');
    await expect(editor).toContainText('Conteúdo da versão dois.');
    const stored = await fixture.read();
    await client.json(fixture.api, { method: 'PUT', json: { ...stored, content: 'Mudança concorrente real.', snapshot: true } });
    await editor.fill('Rascunho antes da recarga.');
    await expect(screen.getByRole('button', 'Ver versão salva')).toBeVisible();
    await delayResponse(browser, fixture.api, 'GET');
    await screen.getByRole('button', 'Ver versão salva').tap();
    await expect.poll(() => delayedStatus(browser)).toBe(200);
    await editor.fill('Digitação durante Ver versão salva.');
    await screen.getByRole('textbox', 'Título do documento').fill('Título durante a leitura');
    await releaseResponse(browser);
    await expect(editor).toContainText('Digitação durante Ver versão salva.');
    await expect(screen.getByRole('textbox', 'Título do documento')).toHaveValue('Título durante a leitura');
    await screen.getByRole('button', 'Ver versão salva').tap();
    await expect(editor).toContainText('Mudança concorrente real.');
    await expect(screen.getByRole('button', 'Ver versão salva')).toHaveCount(0);
  });
}

for (const shared of [false, true]) {
  test(`restauração ${shared ? 'compartilhada' : 'particular'} preserva uma edição já autosalva depois do clique`, { session: 'admin' }, async ({ app, screen, browser }) => {
    const client = await new ApiSession(app.baseUrl!).signIn(admin);
    const fixture = await createDocument(client, shared);
    await app.open(fixture.href);
    const editor = screen.getByRole('textbox', 'Texto do documento');
    await expect(editor).toContainText('Conteúdo da versão dois.');
    await delayResponse(browser, `${fixture.api}/restore`, 'POST', true);
    await screen.getByRole('button', 'Versões').tap();
    await screen.getByRole('button', 'Restaurar').first().tap();
    await expect.poll(() => delayedStatus(browser)).toBe(0);
    await browser.keyboard.press('Escape');
    await screen.getByRole('textbox', 'Título do documento').fill('Título já autosalvo');
    await editor.fill('Edição já autosalva durante a restauração.');
    await expect.poll(async () => (await fixture.read()).content).toContain('Edição já autosalva durante a restauração.');
    await expect(screen.getByText('Salvo', { exact: true })).toBeVisible();
    await releaseResponse(browser);
    await expect(screen.getByRole('button', 'Ver versão salva')).toBeVisible();
    await expect(editor).toContainText('Edição já autosalva durante a restauração.');
    await expect(screen.getByRole('textbox', 'Título do documento')).toHaveValue('Título já autosalvo');
    await screen.getByRole('button', 'Manter a minha').tap();
    await expect.poll(async () => (await fixture.read()).content).toContain('Edição já autosalva durante a restauração.');
  });
}

async function sharedParticipant(baseUrl: string) {
  const owner = await new ApiSession(baseUrl).signIn(uniqueAccount('Dona reparo'));
  const participant = await new ApiSession(baseUrl).signIn(uniqueAccount('Participante reparo'));
  const { user } = await participant.json<{ user: { id: string; email: string } }>('/api/auth/get-session');
  const invite = await owner.json<{ id: string }>('/api/collaboration', { json: { action: 'invite', invitation: { email: user.email } } });
  await participant.json('/api/collaboration', { json: { action: 'respond', id: invite.id, accept: true } });
  const fixture = await createDocument(owner, true);
  const caseId = fixture.api.split('/')[3];
  await owner.json('/api/collaboration', { json: { action: 'participant', caseId, userId: user.id, add: true } });
  const revoke = () => owner.json('/api/collaboration', { json: { action: 'participant', caseId, userId: user.id, add: false } });
  return { ...fixture, owner, participant, revoke };
}

for (const operation of ['save', 'versions', 'restore', 'export', 'read'] as const) {
  test(`acesso removido descoberto por ${operation} limpa editor e contexto e libera navegação`, async ({ app, screen, browser, sql }) => {
    const fixture = await sharedParticipant(app.baseUrl!);
    await signInWithSession({ app, screen, browser }, fixture.participant);
    if (operation === 'save') await browser.setViewport({ width: 390, height: 844 });
    await app.open(fixture.href);
    const editor = screen.getByRole('textbox', 'Texto do documento');
    await expect(editor).toContainText('Conteúdo da versão dois.');
    const tabs = screen.getByRole('navigation', 'Abas do canvas');
    await expect(tabs.getByRole('button', fixture.document.title, { exact: true })).toBeVisible();
    if (operation === 'restore') {
      await screen.getByRole('button', 'Versões').tap();
      await expect(screen.getByRole('button', 'Restaurar').first()).toBeVisible();
    }
    if (operation === 'read') {
      const stored = await fixture.read();
      await fixture.owner.json(fixture.api, { method: 'PUT', json: { ...stored, content: 'Edição concorrente da proprietária.', snapshot: true } });
      await editor.fill('Rascunho da participante antes da perda de acesso.');
      await expect(screen.getByRole('button', 'Manter a minha')).toBeVisible();
    }
    await fixture.revoke();
    if (operation === 'save') await editor.fill('Edição após remoção da participante.');
    if (operation === 'versions') await screen.getByRole('button', 'Versões').tap();
    if (operation === 'restore') await screen.getByRole('button', 'Restaurar').first().tap();
    if (operation === 'export') await screen.getByRole('tab', 'Página', { exact: true }).tap();
    if (operation === 'read') await screen.getByRole('button', 'Manter a minha').tap();
    await expect(screen.getByText('Este recurso não está mais disponível. Abra outro destino no canvas.')).toBeVisible({ timeout: operation === 'export' ? 60_000 : 10_000 });
    await expect(editor).toHaveCount(0);
    await expect(tabs.getByRole('button', fixture.document.title, { exact: true })).toHaveCount(0);
    await expect(screen.getByLabel('Contexto da próxima mensagem')).toHaveText('Carregando contexto do canvas…');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot(`acesso-removido-${operation}`);
    await tabs.getByRole('button', 'Início', { exact: true }).tap();
    await expect(browser).toHaveURL('/app/command-center');
    await expect(screen.getByRole('heading', 'Hoje', { level: 2, exact: true })).toBeVisible();
    await expect(screen.getByText('Não foi possível salvar o documento. Suas alterações continuam no editor.')).toHaveCount(0);
    expect((await fixture.participant.request(fixture.api)).status).toBe(404);
    const stored = await fixture.read();
    expect(await sql('SELECT content FROM case_page WHERE id=$1', [fixture.document.id])).toEqual([{ content: stored.content }]);
    expect(stored.content).toBe(operation === 'read' ? 'Edição concorrente da proprietária.' : 'Conteúdo da versão dois.');
  });
}

test('uma resposta de save real pendente não ressuscita a página invalidada pelo histórico', async ({ app, screen, browser }) => {
  const fixture = await sharedParticipant(app.baseUrl!);
  await signInWithSession({ app, screen, browser }, fixture.participant);
  await app.open(fixture.href);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toContainText('Conteúdo da versão dois.');
  await delayResponse(browser, fixture.api, 'PUT');
  await editor.fill('Salvamento real antes da remoção.');
  await expect.poll(() => delayedStatus(browser)).toBe(200);
  expect((await fixture.read()).content).toContain('Salvamento real antes da remoção.');
  await fixture.revoke();
  await screen.getByRole('button', 'Versões').tap();
  await expect(editor).toHaveCount(0);
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('button', 'Início', { exact: true }).tap();
  await expect(browser).toHaveURL('/app/command-center');
  await releaseResponse(browser);
  await expect(screen.getByRole('heading', 'Hoje', { level: 2, exact: true })).toBeVisible();
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', fixture.document.title, { exact: true })).toHaveCount(0);
});

test('navegação que aguarda save negado segue após a invalidação', async ({ app, screen, browser }) => {
  const fixture = await sharedParticipant(app.baseUrl!);
  await signInWithSession({ app, screen, browser }, fixture.participant);
  await app.open(fixture.href);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toContainText('Conteúdo da versão dois.');
  await delayResponse(browser, fixture.api, 'PUT');
  await fixture.revoke();
  await editor.fill('Texto local cuja gravação será negada.');
  await expect.poll(() => delayedStatus(browser)).toBe(404);
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('button', 'Início', { exact: true }).tap();
  await releaseResponse(browser);
  await expect(browser).toHaveURL('/app/command-center');
  await expect(screen.getByRole('heading', 'Hoje', { level: 2, exact: true })).toBeVisible();
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', fixture.document.title, { exact: true })).toHaveCount(0);
  await expect(screen.getByText('Não foi possível salvar o documento. Suas alterações continuam no editor.')).toHaveCount(0);
});

test('revogação libera uma saída já aguardando save sem esperar a resposta anterior', async ({ app, screen, browser, sql }) => {
  const fixture = await sharedParticipant(app.baseUrl!);
  await signInWithSession({ app, screen, browser }, fixture.participant);
  await app.open(fixture.href);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toContainText('Conteúdo da versão dois.');
  await delayResponse(browser, fixture.api, 'PUT');
  await editor.fill('Gravação real antes da revogação.');
  await expect.poll(() => delayedStatus(browser)).toBe(200);
  await screen.getByRole('button', 'Abrir módulos').tap();
  await screen.getByRole('navigation', 'Módulos').getByRole('button', 'Início', { exact: true }).tap();
  await expect(browser).toHaveURL(fixture.href);
  await fixture.revoke();
  await screen.getByRole('button', 'Versões').tap();
  await expect(browser).toHaveURL('/app/command-center');
  await expect(screen.getByRole('heading', 'Hoje', { level: 2, exact: true })).toBeVisible();
  expect(await delayedStatus(browser)).toBe(200);
  await releaseResponse(browser);
  await expect(editor).toHaveCount(0);
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', fixture.document.title, { exact: true })).toHaveCount(0);
  expect(await sql('SELECT content FROM case_page WHERE id=$1', [fixture.document.id])).toEqual([{ content: 'Gravação real antes da revogação.' }]);
});

test('falha transitória compartilhada preserva rascunho e permite retry real', { session: 'admin' }, async ({ app, screen, browser }) => {
  const client = await new ApiSession(app.baseUrl!).signIn(admin);
  const fixture = await createDocument(client, true);
  await app.open(fixture.href);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toContainText('Conteúdo da versão dois.');
  for (const failure of ['network', '503']) {
    await browser.route(`**${fixture.api}`, route => route.request.method !== 'PUT' ? route.continue() : failure === 'network' ? route.abort() : route.fulfill({ status: 503, json: { error: 'Falha transitória de teste.' } }));
    await editor.fill(`Rascunho durante indisponibilidade temporária ${failure}.`);
    await expect(screen.getByRole('button', 'Tentar salvar novamente')).toBeVisible();
    await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', fixture.document.title, { exact: true })).toBeVisible();
    await expect(editor).toContainText(`Rascunho durante indisponibilidade temporária ${failure}.`);
    await browser.unroute(`**${fixture.api}`);
    await screen.getByRole('button', 'Tentar salvar novamente').tap();
    await expect.poll(async () => (await fixture.read()).content).toContain(`Rascunho durante indisponibilidade temporária ${failure}.`);
    await expect(screen.getByText('Salvo', { exact: true })).toBeVisible();
  }
  await app.open(fixture.href);
  await expect(editor).toContainText('Rascunho durante indisponibilidade temporária 503.');
});

test('um save com sessão encerrada retorna ao acesso em vez de invalidar como revogação do caso', async ({ app, screen, browser }) => {
  const client = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Sessão reparo'));
  const fixture = await createDocument(client, true);
  await signInWithSession({ app, screen, browser }, client);
  await app.open(fixture.href);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toContainText('Conteúdo da versão dois.');
  await client.json('/api/auth/sign-out', { json: {} });
  await editor.fill('Texto após encerramento da sessão.');
  await expect(browser).toHaveURL('/sign-in');
  await expect(screen.getByRole('heading', 'Entre no Lume')).toBeVisible();
});
