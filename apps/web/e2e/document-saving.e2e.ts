import { describe, test, type Browser } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

// Real editor; controlled persistence failures make data-loss races repeatable.
async function documentFixture(browser: Browser, content = 'Texto original') {
  const artifact = { id: 'saving-regression', title: 'Documento de teste', content, version: 2,
    status: 'draft', references: [], validationIssues: [], conversationId: null as string | null };
  const writes: { version: number; content: string; snapshot: boolean }[] = [];
  let failSave = false;
  let restores = 0;
  await browser.route('**/api/artifacts/saving-regression**', route => {
    const { method, url, postData } = route.request;
    const path = new URL(url).pathname;
    if (path.endsWith('/format')) return route.fulfill({ json: { typography: null, templateName: null } });
    if (path.endsWith('/citations')) return route.fulfill({ json: { review: null } });
    if (path.endsWith('/versions')) return route.fulfill({ json: { versions: [{ version: 1, title: artifact.title, createdAt: new Date().toISOString() }] } });
    if (path.endsWith('/restore')) { restores++; return route.fulfill({ json: { artifact } }); }
    if (method === 'PUT') {
      const input = JSON.parse(postData ?? '{}') as { title: string; content: string; version: number; snapshot: boolean };
      writes.push(input);
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Falha de salvamento simulada.' } });
      if (input.version !== artifact.version) return route.fulfill({ status: 409, json: { error: 'Conflito' } });
      Object.assign(artifact, { title: input.title, content: input.content, version: artifact.version + 1 });
    }
    return route.fulfill({ json: { artifact } });
  });
  return { artifact, writes, fail: () => { failSave = true; }, recover: () => { failSave = false; }, restores: () => restores };
}

const editor = (screen: Screen) => screen.getByRole('textbox', 'Texto do documento');
const hideTab = (browser: Browser) => browser.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  return null;
});
const focusInsidePanel = () => !!document.activeElement?.closest('#document-panel');

describe('salvamento de documentos', { session: 'admin' }, () => {
  test('esconder a aba salva uma vez e deixa as edições seguintes salváveis', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser);
    await app.open('/app/documents/saving-regression');
    await editor(screen).fill('Texto antes de alternar a aba');
    await hideTab(browser);
    await expect.poll(() => data.artifact.content).toContain('Texto antes de alternar');
    await expect(screen.getByText('Salvo')).toBeVisible();
    await editor(screen).fill('Texto depois de voltar');
    await expect.poll(() => data.artifact.content).toContain('Texto depois de voltar');
    await expect(screen.getByText('Conflito de versão')).toHaveCount(0);
  });

  test('salvar explicitamente grava uma versão mesmo depois do salvamento automático', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser);
    await app.open('/app/documents/saving-regression');
    await editor(screen).fill('Texto salvo automaticamente');
    await expect.poll(() => data.writes.length).toBe(1);
    await expect(screen.getByText('Salvo')).toBeVisible();
    await editor(screen).press('ControlOrMeta+s');
    await expect.poll(() => data.writes.some(write => write.snapshot)).toBe(true);
  });

  test('restaurar para quando salvar o texto atual falha', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser);
    await app.open('/app/documents/saving-regression');
    data.fail();
    await editor(screen).fill('Texto humano ainda não salvo');
    await screen.getByRole('button', 'Versões').tap();
    await screen.getByRole('button', 'Restaurar').tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Salve as alterações' })).toBeVisible();
    expect(data.restores()).toBe(0);
    await expect(editor(screen)).toContainText('Texto humano ainda não salvo');
  });

  test('documentos grandes terminam de salvar antes de o painel fechar', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser, 'a'.repeat(70_000));
    await app.open('/app/agents?doc=saving-regression');
    await editor(screen).fill('a'.repeat(70_000) + ' último trecho');
    await hideTab(browser);
    await expect.poll(() => data.artifact.content.trimEnd().endsWith('último trecho')).toBe(true);
    await screen.getByRole('button', 'Fechar documento').tap();
    await expect(browser.locator('#document-panel')).toHaveCount(0);
    await expect.poll(() => data.artifact.content.trimEnd().endsWith('último trecho')).toBe(true);
  });

  for (const failure of ['error', 'conflict'] as const) {
    test(`uma revisão do Lume preserva o texto local depois de ${failure === 'error' ? 'uma falha' : 'um conflito'} ao salvar`, async ({ app, screen, browser }) => {
      const data = await documentFixture(browser);
      await app.open('/app/agents?doc=saving-regression');
      await expect(editor(screen)).toBeVisible();
      if (failure === 'error') data.fail();
      else data.artifact.version++;
      await editor(screen).fill('Rascunho humano que não pode desaparecer');
      await expect(screen.getByText(failure === 'error' ? 'Não salvo' : 'Conflito de versão')).toBeVisible();
      await browser.route('**/api/chat', route => {
        data.artifact.content = 'Versão recebida do Lume';
        data.artifact.version++;
        const chunks = [
          { type: 'start', messageId: `qa-${failure}` },
          { type: 'data-tool', id: `qa-tool-${failure}`, data: { callId: `qa-call-${failure}`, name: 'k5_artifacts_edit', state: 'completed', summary: 'Documento alterado', href: '/app/documents/saving-regression' } },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'Documento atualizado.' },
          { type: 'text-end', id: 'text' },
          { type: 'finish' },
        ];
        return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
      });
      await screen.getByRole('textbox', 'Pergunte ao Lume').fill('Atualize o documento');
      await screen.getByRole('button', 'Enviar mensagem').tap();
      await expect(screen.getByText('O Lume alterou este documento enquanto você editava.', { exact: false })).toBeVisible();
      await expect(editor(screen)).toContainText('Rascunho humano que não pode desaparecer');
    });
  }

  test('o painel no celular prende o foco do teclado, inclusive no menu de versões, e Escape o fecha', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await documentFixture(browser);
    await app.open('/app/agents?doc=saving-regression');
    await expect(editor(screen)).toBeVisible();
    await expect.poll(() => browser.evaluate(focusInsidePanel)).toBe(true);
    for (let i = 0; i < 25; i++) {
      await browser.keyboard.press('Tab');
      expect(await browser.evaluate(focusInsidePanel)).toBe(true);
    }
    await screen.getByRole('button', 'Versões').tap();
    await expect(screen.getByRole('button', 'Restaurar')).toBeVisible();
    await browser.keyboard.press('Escape');
    await expect(screen.getByRole('button', 'Restaurar')).toBeHidden();
    await expect(screen.getByRole('button', 'Versões')).toBeFocused();
    await expect(browser.locator('#document-panel')).toBeVisible();
    await browser.keyboard.press('Escape');
    await expect(browser.locator('#document-panel')).toHaveCount(0);
  });

  test('voltar à conversa para quando o documento em página inteira não salva', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser);
    await app.open('/app/documents/saving-regression');
    data.fail();
    await editor(screen).fill('Rascunho pendente na página inteira');
    await screen.getByRole('link', 'Voltar à conversa').tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Falha de salvamento simulada.' })).toBeVisible();
    await expect(browser).toHaveURL(/\/app\/documents\/saving-regression/);
    await expect(editor(screen)).toContainText('Rascunho pendente na página inteira');
  });

  test('a navegação lateral espera o salvamento e tentar de novo recupera uma falha', async ({ app, screen, browser }) => {
    const data = await documentFixture(browser);
    await app.open('/app/documents/saving-regression');
    data.fail();
    await editor(screen).fill('Edição preservada ao usar o menu');
    await screen.getByRole('link', 'Cofre').first().tap();
    await expect(screen.getByRole('button', 'Tentar salvar novamente')).toBeVisible();
    await expect(browser).toHaveURL(/\/app\/documents\/saving-regression/);
    data.recover();
    await screen.getByRole('button', 'Tentar salvar novamente').tap();
    await expect(screen.getByText('Salvo')).toBeVisible();
    await screen.getByRole('link', 'Cofre').first().tap();
    await expect(browser).toHaveURL(/\/app\/vault$/);
    expect(data.artifact.content).toContain('Edição preservada');
  });

  // On a phone "Sair" sits behind "Mais", a separate path from the desktop sidebar.
  for (const width of [1280, 390]) {
    test(`uma falha ao salvar nunca prende o logout global e descartar exige escolha explícita em ${width}px`, async ({ app, screen, browser }) => {
      await browser.setViewport({ width, height: 844 });
      const data = await documentFixture(browser);
      let logoutAttempts = 0;
      await browser.route('**/api/auth/sign-out', route => {
        logoutAttempts++;
        return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Simulated logout failure' } });
      });
      await app.open('/app/documents/saving-regression');
      data.fail();
      await editor(screen).fill('Rascunho antes de sair');
      if (width < 768) await screen.getByRole('button', 'Mais').tap();
      await screen.getByRole('button', 'Sair').tap();
      const dialog = screen.getByRole('alertdialog', 'Sair sem salvar?');
      await expect(dialog).toBeVisible();
      expect(logoutAttempts).toBe(0);
      await dialog.getByRole('button', 'Continuar editando').tap();
      await expect(editor(screen)).toContainText('Rascunho antes de sair');
      expect(logoutAttempts).toBe(0);
      if (width < 768) await screen.getByRole('button', 'Mais').tap();
      await screen.getByRole('button', 'Sair').tap();
      await dialog.getByRole('button', 'Sair sem salvar').tap();
      await expect.poll(() => logoutAttempts).toBe(1);
      await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível sair.' })).toBeVisible();
    });
  }

  // Same history handling at every width; the phone layout is the stricter of the two.
  test('voltar e avançar no histórico mantém edições que falharam em 390px', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    const data = await documentFixture(browser);
    await app.open('/app/agents?doc=saving-regression');
    await expect(editor(screen)).toBeVisible();
    await browser.evaluate(() => { history.replaceState(null, '', '/app/agents'); return null; });
    await expect(browser.locator('#document-panel')).toHaveCount(0);
    await browser.evaluate(() => { history.pushState(null, '', '/app/agents?doc=saving-regression'); return null; });
    data.fail();
    await editor(screen).fill('Rascunho preservado no histórico');
    await expect(screen.getByRole('button', 'Tentar salvar novamente')).toBeVisible();
    await browser.back();
    await expect(browser.locator('#document-panel')).toHaveCount(0);
    await browser.forward();
    await expect(editor(screen)).toContainText('Rascunho preservado no histórico');
    data.recover();
    await screen.getByRole('button', 'Tentar salvar novamente').tap();
    await expect.poll(() => data.artifact.content).toContain('Rascunho preservado no histórico');
  });
});
