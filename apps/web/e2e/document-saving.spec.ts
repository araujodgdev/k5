import { test, expect, type Page } from '@playwright/test';

// Real login and real editor; controlled persistence failures make data-loss races repeatable.
test.beforeEach(async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
  await page.getByRole('button', { name: 'Agora não', exact: true }).click();
});

async function documentFixture(page: Page, content = 'Texto original') {
  const artifact = { id: 'saving-regression', title: 'Documento de teste', content, version: 2,
    status: 'draft', references: [], validationIssues: [], conversationId: null };
  const writes: { version: number; content: string; snapshot: boolean }[] = [];
  let failSave = false;
  let restores = 0;
  await page.route('**/api/artifacts/saving-regression**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/format')) return route.fulfill({ json: { typography: null, templateName: null } });
    if (path.endsWith('/citations')) return route.fulfill({ json: { review: null } });
    if (path.endsWith('/versions')) return route.fulfill({ json: { versions: [{ version: 1, title: artifact.title, createdAt: new Date().toISOString() }] } });
    if (path.endsWith('/restore')) { restores++; return route.fulfill({ json: { artifact } }); }
    if (request.method() === 'PUT') {
      const input = request.postDataJSON();
      writes.push(input);
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Falha de salvamento simulada.' } });
      if (input.version !== artifact.version) return route.fulfill({ status: 409, json: { error: 'Conflito' } });
      Object.assign(artifact, { title: input.title, content: input.content, version: artifact.version + 1 });
    }
    return route.fulfill({ json: { artifact } });
  });
  return { artifact, writes, fail: () => { failSave = true; }, recover: () => { failSave = false; }, restores: () => restores };
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Texto do documento' });
async function hidden(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('hiding the tab saves once and leaves subsequent edits saveable', async ({ page }) => {
  const data = await documentFixture(page);
  await page.goto('/app/documents/saving-regression');
  await editor(page).fill('Texto antes de alternar a aba');
  await hidden(page);
  await expect.poll(() => data.artifact.content).toContain('Texto antes de alternar');
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await editor(page).fill('Texto depois de voltar');
  await expect.poll(() => data.artifact.content).toContain('Texto depois de voltar');
  await expect(page.getByText('Conflito de versão', { exact: true })).toHaveCount(0);
});

test('explicit save records a snapshot even after autosave', async ({ page }) => {
  const data = await documentFixture(page);
  await page.goto('/app/documents/saving-regression');
  await editor(page).fill('Texto salvo automaticamente');
  await expect.poll(() => data.writes.length).toBe(1);
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await editor(page).press('ControlOrMeta+s');
  await expect.poll(() => data.writes.some(write => write.snapshot)).toBe(true);
});

test('restore stops if saving the current text fails', async ({ page }) => {
  const data = await documentFixture(page);
  await page.goto('/app/documents/saving-regression');
  data.fail();
  await editor(page).fill('Texto humano ainda não salvo');
  await page.getByRole('button', { name: 'Versões', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Salve as alterações' })).toBeVisible();
  expect(data.restores()).toBe(0);
  await expect(editor(page)).toContainText('Texto humano ainda não salvo');
});

test('large documents finish saving before the panel closes', async ({ page }) => {
  const data = await documentFixture(page, 'a'.repeat(70_000));
  await page.goto('/app/agents?doc=saving-regression');
  await editor(page).fill('a'.repeat(70_000) + ' último trecho');
  await hidden(page);
  await expect.poll(() => data.artifact.content.trimEnd().endsWith('último trecho')).toBe(true);
  await page.getByRole('button', { name: 'Fechar documento', exact: true }).click();
  await expect(page.locator('#document-panel')).toHaveCount(0);
  await expect.poll(() => data.artifact.content.trimEnd().endsWith('último trecho')).toBe(true);
});

for (const failure of ['error', 'conflict'] as const) {
  test(`a Lume revision preserves local text after a save ${failure}`, async ({ page }) => {
    const data = await documentFixture(page);
    await page.goto('/app/agents?doc=saving-regression');
    await expect(editor(page)).toBeVisible();
    if (failure === 'error') data.fail();
    else data.artifact.version++;
    await editor(page).fill('Rascunho humano que não pode desaparecer');
    await expect(page.getByText(failure === 'error' ? 'Não salvo' : 'Conflito de versão', { exact: true })).toBeVisible();
    await page.route('**/api/chat', route => {
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
      return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
        body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
    });
    await page.getByRole('textbox', { name: 'Pergunte ao Lume' }).fill('Atualize o documento');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.getByText('O Lume alterou este documento enquanto você editava.')).toBeVisible();
    await expect(editor(page)).toContainText('Rascunho humano que não pode desaparecer');
  });
}

test('mobile panel traps keyboard focus, including its version menu, and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await documentFixture(page);
  await page.goto('/app/agents?doc=saving-regression');
  await expect(editor(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#document-panel'))).toBe(true);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#document-panel'))).toBe(true);
  }
  await page.getByRole('button', { name: 'Versões', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restaurar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Restaurar' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Versões', exact: true })).toBeFocused();
  await expect(page.locator('#document-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#document-panel')).toHaveCount(0);
});

test('returning to the conversation stops when the full-page document cannot save', async ({ page }) => {
  const data = await documentFixture(page);
  await page.goto('/app/documents/saving-regression');
  data.fail();
  await editor(page).fill('Rascunho pendente na página inteira');
  await page.getByRole('link', { name: 'Voltar à conversa' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Falha de salvamento simulada.' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/documents\/saving-regression/);
  await expect(editor(page)).toContainText('Rascunho pendente na página inteira');
});

test('sidebar navigation waits for saving and a visible retry recovers a failed save', async ({ page }) => {
  const data = await documentFixture(page);
  await page.goto('/app/documents/saving-regression');
  data.fail();
  await editor(page).fill('Edição preservada ao usar o menu');
  await page.getByRole('link', { name: 'Cofre', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Tentar salvar novamente' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/documents\/saving-regression/);
  data.recover();
  await page.getByRole('button', { name: 'Tentar salvar novamente' }).click();
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Cofre', exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/vault$/);
  expect(data.artifact.content).toContain('Edição preservada');
});

for (const width of [1280, 390]) {
test(`a failed save never traps global logout and discarding requires an explicit choice at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const data = await documentFixture(page);
  let logoutAttempts = 0;
  await page.route('**/api/auth/sign-out', route => {
    logoutAttempts++;
    return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Simulated logout failure' } });
  });
  await page.goto('/app/documents/saving-regression');
  data.fail();
  await editor(page).fill('Rascunho antes de sair');
  if (width < 768) await page.getByRole('button', { name: 'Mais', exact: true }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Sair sem salvar?' });
  await expect(dialog).toBeVisible();
  expect(logoutAttempts).toBe(0);
  await dialog.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(editor(page)).toContainText('Rascunho antes de sair');
  expect(logoutAttempts).toBe(0);
  if (width < 768) await page.getByRole('button', { name: 'Mais', exact: true }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sair sem salvar', exact: true }).click();
  await expect.poll(() => logoutAttempts).toBe(1);
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível sair.' })).toBeVisible();
});
}

for (const width of [1280, 390]) {
  test(`history navigation retains failed document edits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const data = await documentFixture(page);
    await page.goto('/app/agents?doc=saving-regression');
    await expect(editor(page)).toBeVisible();
    await page.evaluate(() => history.replaceState(null, '', '/app/agents'));
    await expect(page.locator('#document-panel')).toHaveCount(0);
    await page.evaluate(() => history.pushState(null, '', '/app/agents?doc=saving-regression'));
    data.fail();
    await editor(page).fill('Rascunho preservado no histórico');
    await expect(page.getByRole('button', { name: 'Tentar salvar novamente' })).toBeVisible();
    await page.goBack();
    await expect(page.locator('#document-panel')).toHaveCount(0);
    await page.goForward();
    await expect(editor(page)).toContainText('Rascunho preservado no histórico');
    data.recover();
    await page.getByRole('button', { name: 'Tentar salvar novamente' }).click();
    await expect.poll(() => data.artifact.content).toContain('Rascunho preservado no histórico');
  });
}
