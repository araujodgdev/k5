import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
  await page.getByRole('button', { name: 'Agora não', exact: true }).click();
}

for (const width of [1280, 390]) {
  test(`older vault files are reachable and pagination failures recover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page);
    let total = 201;
    let fail = true;
    const offsets: number[] = [];
    await page.route('**/api/vault/documents?**', route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('scope')).toBe('library');
      expect(query.get('limit')).toBe('50');
      const offset = Number(query.get('offset'));
      offsets.push(offset);
      if (fail && offset === 50) return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Service unavailable</h1>' });
      return route.fulfill({ json: { total, documents: Array.from({ length: Math.max(0, Math.min(50, total - offset)) }, (_, i) => ({
        id: `pagination-${offset + i}`, name: `Arquivo ${offset + i + 1}`, scope: 'library', caseId: null, caseName: null, folderId: null,
        mimeType: 'text/plain', byteSize: 1, status: 'ready', progress: 100, errorMessage: null, extractedCharacters: 1, sourceCount: 0, createdAt: '2026-01-01T00:00:00Z',
      })) } });
    });
    await page.route('**/api/approvals', route => route.fulfill({ json: { proposal: { id: 'pagination-approval' } } }));
    await page.route('**/api/approvals/pagination-approval', route => route.fulfill({ json: { success: true } }));
    await page.route('**/api/vault/documents/pagination-200', route => {
      expect(route.request().method()).toBe('DELETE');
      total--;
      return route.fulfill({ json: { success: true } });
    });
    await page.goto('/app/vault/library');
    const pages = page.getByRole('navigation', { name: 'Páginas de arquivos' });
    await expect(pages).toContainText('1–50 de 201 arquivos');
    await pages.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os arquivos.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Baixar Arquivo 1', exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await expect(pages).toContainText('51–100 de 201 arquivos');
    for (const start of [101, 151, 201]) {
      await pages.getByRole('button', { name: 'Próxima' }).click();
      await expect(pages).toContainText(`${start}–${Math.min(start + 49, 201)} de 201 arquivos`);
    }
    await expect(page.getByRole('link', { name: 'Baixar Arquivo 201', exact: true })).toBeVisible();
    await expect(pages.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    await page.getByRole('button', { name: 'Excluir Arquivo 201', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir documento', exact: true }).click();
    await expect(pages).toContainText('151–200 de 200 arquivos');
    await expect(page.getByRole('link', { name: 'Baixar Arquivo 200', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(offsets).toContain(200);
  });
  test(`older files remain selectable for annexes, email and Drive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page);
    // Read an existing case; this workflow never writes business data or calls Google.
    const casesResponse = await page.request.get('/api/vault/cases');
    expect(casesResponse.ok()).toBe(true);
    const { cases } = await casesResponse.json() as { cases: Array<{ id: string; name: string }> };
    expect(cases.length, 'The browser fixture account needs an existing case.').toBeGreaterThan(0);
    const caseId = cases[0].id;
    let failNextPage = false;
    await page.route('**/api/vault/documents?**', route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('limit')).toBe('50');
      const offset = Number(query.get('offset'));
      if (failNextPage && offset === 50) return route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' });
      return route.fulfill({ json: { total: 201, documents: Array.from({ length: Math.min(50, 201 - offset) }, (_, i) => ({
        id: `option-${offset + i}`, name: `Anexo ${offset + i + 1}.pdf`, scope: query.get('caseId') ? 'case' : 'library',
        caseId: query.get('caseId'), caseName: null, folderId: null, mimeType: 'application/pdf', byteSize: 100,
        status: 'ready', progress: 100, errorMessage: null, extractedCharacters: 1, sourceCount: 0, createdAt: '2026-01-01T00:00:00Z',
      })) } });
    });
    let driveReads = 0;
    await page.route('**/api/integrations/google/*', route => {
      const operation = new URL(route.request().url()).pathname.split('/').at(-1);
      if (operation === 'status') return route.fulfill({ json: {
        configured: true, connection: { email: 'fixture@example.test', displayName: null, status: 'active', grantedModules: ['gmail', 'drive'], connectedAt: '2026-01-01T00:00:00Z' },
        modules: ['gmail', 'drive'].map(module => ({ module, label: module, rolledOut: true, enabledByOffice: true, granted: true })),
        pickerAvailable: false, pushAvailable: false,
      } });
      if (operation === 'threads') return route.fulfill({ json: { threads: [], nextPageToken: null } });
      if (operation === 'picker') return route.fulfill({ status: 503, json: { error: 'O seletor está desativado nesta verificação.' } });
      if (operation === 'drive-imports') return route.fulfill({ json: { imports: [] } });
      if (operation === 'drive-files') {
        driveReads++;
        return route.fulfill({ json: { total: 1, files: [{ id: 'fixture-drive', name: 'PDF do Google', mimeType: 'application/pdf', kind: 'pdf',
          sizeBytes: 100, modifiedTime: null, version: '1', sharedDrive: false, state: 'available', webViewLink: null, importFormat: 'application/pdf',
          capabilities: { canRename: false, canShare: false, canEdit: false, canModifyContent: true, canDownload: true },
        }] } });
      }
      throw new Error(`Unexpected Google operation: ${operation}`);
    });
    async function loadAll(select: string) {
      await expect(page.locator(`${select} option`)).toHaveCount(202);
      await expect(page.getByRole('button', { name: 'Carregar mais arquivos', exact: true })).toHaveCount(0);
      await page.locator(select).selectOption('option-200');
      await expect(page.locator(select)).toHaveValue('option-200');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }

    await page.goto(`/app/vault/cases/${caseId}?section=annexes`);
    await loadAll('#annex-scan');
    await page.locator('#annex-petition').selectOption('option-199');
    await expect(page.getByRole('button', { name: 'Propor anexos', exact: true })).toBeEnabled();

    await page.goto('/app/email');
    await page.getByRole('button', { name: 'Escrever', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Anexar do Cofre', exact: true }).click();
    failNextPage = true;
    await page.locator('#mail-vault-case').selectOption(caseId);
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os arquivos.' })).toBeVisible();
    await expect(page.locator('#mail-vault-document option')).toHaveCount(51);
    failNextPage = false;
    await page.getByRole('button', { name: 'Tentar carregar arquivos novamente', exact: true }).click();
    await expect(page.locator('#mail-vault-document option')).toHaveCount(202);
    await page.locator('#mail-vault-document').selectOption('option-200');
    await expect(page.getByRole('button', { name: 'Adicionar documento', exact: true })).toBeEnabled();
    // Changing the destination clears old options immediately, even before its request resolves.
    await page.locator('#mail-vault-case').selectOption('');
    await expect(page.locator('#mail-vault-document option')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Adicionar documento', exact: true })).toBeDisabled();

    await page.goto('/app/vault/library');
    await page.getByRole('button', { name: 'Importar do Google Drive', exact: true }).click();
    await page.getByRole('button', { name: /^PDF do Google/ }).click();
    await loadAll('#drive-version');
    await expect(page.getByRole('button', { name: 'Enviar versão', exact: true })).toBeEnabled();
    const pages = page.getByRole('navigation', { name: 'Páginas de arquivos' });
    await pages.getByRole('button', { name: 'Próxima' }).click();
    await expect(pages).toContainText('51–100 de 201 arquivos');
    expect(driveReads).toBeLessThanOrEqual(2);
  });
}
