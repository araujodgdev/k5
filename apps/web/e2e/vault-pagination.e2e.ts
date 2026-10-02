import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { admin, ApiSession } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';

const documentsRoute = /\/api\/vault\/documents\?/;
const query = (url: string) => new URL(url).searchParams;

// Pagination is checked at the phone width, where the pager and overflow are tightest; the
// pickers at the desktop width, where every entry point (annexes, e-mail, Drive) is on screen.
test('arquivos antigos do Cofre são alcançáveis e falhas de paginação se recuperam em 390px', { session: 'admin' }, async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  let total = 201;
  let fail = true;
  const offsets: number[] = [];
  const deleted: string[] = [];
  await browser.route(documentsRoute, route => {
    const params = query(route.request.url);
    const offset = Number(params.get('offset'));
    offsets.push(offset);
    if (params.get('scope') !== 'library' || params.get('limit') !== '50') return route.fulfill({ status: 400, json: { error: `Consulta inesperada: ${params}` } });
    if (fail && offset === 50) return route.fulfill({ status: 503, headers: { 'content-type': 'text/html' }, body: '<h1>Service unavailable</h1>' });
    return route.fulfill({ json: { total, documents: Array.from({ length: Math.max(0, Math.min(50, total - offset)) }, (_, i) => ({
      id: `pagination-${offset + i}`, name: `Arquivo ${offset + i + 1}`, scope: 'library', caseId: null, caseName: null, folderId: null,
      mimeType: 'text/plain', byteSize: 1, status: 'ready', progress: 100, errorMessage: null, extractedCharacters: 1, sourceCount: 0, createdAt: '2026-01-01T00:00:00Z',
    })) } });
  });
  await browser.route('**/api/approvals', route => route.fulfill({ json: { proposal: { id: 'pagination-approval' } } }));
  await browser.route('**/api/approvals/pagination-approval', route => route.fulfill({ json: { success: true } }));
  await browser.route('**/api/vault/documents/pagination-200', route => {
    deleted.push(route.request.method);
    total--;
    return route.fulfill({ json: { success: true } });
  });
  await app.open('/app/vault/library');
  const pages = screen.getByRole('navigation', 'Páginas de arquivos');
  await expect(pages).toContainText('1–50 de 201 arquivos');
  await pages.getByRole('button', 'Próxima').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível carregar os arquivos.' })).toBeVisible();
  await expect(screen.getByRole('link', 'Baixar Arquivo 1')).toBeVisible();
  fail = false;
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(pages).toContainText('51–100 de 201 arquivos');
  for (const start of [101, 151, 201]) {
    await pages.getByRole('button', 'Próxima').tap();
    await expect(pages).toContainText(`${start}–${Math.min(start + 49, 201)} de 201 arquivos`);
  }
  await expect(screen.getByRole('link', 'Baixar Arquivo 201')).toBeVisible();
  await expect(pages.getByRole('button', 'Próxima')).toBeDisabled();
  await screen.getByRole('button', 'Excluir Arquivo 201').tap();
  await screen.getByRole('button', 'Excluir documento').tap();
  await expect(pages).toContainText('151–200 de 200 arquivos');
  await expect(screen.getByRole('link', 'Baixar Arquivo 200')).toBeVisible();
  expect(deleted).toEqual(['DELETE']);
  expect(offsets).toContain(200);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});

test('arquivos antigos continuam selecionáveis em anexos, e-mail e Drive em 1280px', { session: 'admin' }, async ({ app, screen, browser }) => {
  // The case page is server-rendered from the database, so the case is real; its documents are not.
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  let { cases } = await api.json<{ cases: { id: string }[] }>('/api/vault/cases');
  if (!cases.length) {
    await api.json('/api/vault/cases', { json: { name: 'Caso de paginação E2E' } });
    ({ cases } = await api.json<{ cases: { id: string }[] }>('/api/vault/cases'));
  }
  const caseId = cases[0].id;
  let failNextPage = false;
  await browser.route(documentsRoute, route => {
    const params = query(route.request.url);
    const offset = Number(params.get('offset'));
    if (params.get('limit') !== '50') return route.fulfill({ status: 400, json: { error: `Consulta inesperada: ${params}` } });
    if (failNextPage && offset === 50) return route.fulfill({ status: 503, headers: { 'content-type': 'text/html' }, body: 'Unavailable' });
    return route.fulfill({ json: { total: 201, documents: Array.from({ length: Math.min(50, 201 - offset) }, (_, i) => ({
      id: `option-${offset + i}`, name: `Anexo ${offset + i + 1}.pdf`, scope: params.get('caseId') ? 'case' : 'library',
      caseId: params.get('caseId'), caseName: null, folderId: null, mimeType: 'application/pdf',
      byteSize: offset + i === 200 ? 75 * 1024 * 1024 : 100,
      status: 'ready', progress: 100, errorMessage: null, extractedCharacters: 1, sourceCount: 0, createdAt: '2026-01-01T00:00:00Z',
    })) } });
  });
  let driveReads = 0;
  await browser.route('**/api/integrations/google/*', route => {
    const operation = new URL(route.request.url).pathname.split('/').at(-1);
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
    // Any other Google call would reach a real account; fail it visibly instead.
    return route.fulfill({ status: 500, json: { error: `Operação Google inesperada: ${operation}` } });
  });
  async function loadAll(select: string) {
    await expect(browser.locator(`${select} option`)).toHaveCount(202);
    await expect(screen.getByRole('button', 'Carregar mais arquivos')).toHaveCount(0);
    await browser.locator(select).selectOption({ value: 'option-200' });
    await expect(browser.locator(select)).toHaveValue('option-200');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  }

  await app.open(`/app/vault/cases/${caseId}?section=annexes`);
  await loadAll('#annex-scan');
  await browser.locator('#annex-petition').selectOption({ value: 'option-199' });
  await expect(screen.getByRole('button', 'Propor anexos')).toBeEnabled();

  await app.open('/app/email');
  await screen.getByRole('button', 'Escrever', { visible: true }).tap();
  await screen.getByRole('button', 'Anexar do Cofre').tap();
  failNextPage = true;
  await browser.locator('#mail-vault-case').selectOption({ value: caseId });
  await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível carregar os arquivos.' })).toBeVisible();
  await expect(browser.locator('#mail-vault-document option')).toHaveCount(51);
  failNextPage = false;
  await screen.getByRole('button', 'Tentar carregar arquivos novamente').tap();
  await expect(browser.locator('#mail-vault-document option')).toHaveCount(202);
  await browser.locator('#mail-vault-document').selectOption({ value: 'option-200' });
  await expect(screen.getByRole('button', 'Adicionar documento')).toBeEnabled();
  // Changing the destination clears old options immediately, even before its request resolves.
  await browser.locator('#mail-vault-case').selectOption({ value: '' });
  await expect(browser.locator('#mail-vault-document option')).toHaveCount(1);
  await expect(screen.getByRole('button', 'Adicionar documento')).toBeDisabled();

  await app.open('/app/vault/library');
  await screen.getByRole('button', 'Importar do Google Drive').tap();
  await screen.getByRole('button', /^PDF do Google/).tap();
  await loadAll('#drive-version');
  await expect(screen.getByRole('button', 'Enviar versão')).toBeEnabled();
  const pages = screen.getByRole('navigation', 'Páginas de arquivos');
  await pages.getByRole('button', 'Próxima').tap();
  await expect(pages).toContainText('51–100 de 201 arquivos');
  expect(driveReads).toBeLessThanOrEqual(2);
});
