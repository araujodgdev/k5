import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { extractText } from 'unpdf';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { seedArtifact } from './support/seed';
import { signInWithSession } from './support/sign-in';

// Documents without a Word template use PDFcn on the server.
test('exportar PDF baixa o texto salvo, recusa versão antiga e sessão ausente, e mostra a falha de conversão', { tags: ['pdf'] }, async ({ app, screen, browser }) => {
  const account = uniqueAccount('Paulo');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const artifactId = await seedArtifact(account.email, 'Contrato de validação PDF', '# Contrato\n\nTexto inicial.');
  await signInWithSession({ app, screen, browser }, api);

  await app.open(`/app/documents/${artifactId}`);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await expect(editor).toBeVisible();
  await editor.fill('Texto de validação atualizado. Cliente José, R$ 1.250,00.');
  await screen.getByRole('button', 'Exportar documento').focus();
  await browser.keyboard.press('Enter');
  const { suggestedFilename } = await browser.waitForDownload(() => screen.getByRole('button', 'Exportar PDF').tap(), { timeout: 120_000 });
  expect(suggestedFilename).toMatch(/\.pdf$/);
  // The download's path is relative to the attempt's artifacts; export the saved text again over the API.
  const exported = await api.request(`/api/artifacts/${artifactId}/export?format=pdf`);
  expect(exported.status).toBe(200);
  expect((await extractText(new Uint8Array(await exported.arrayBuffer()), { mergePages: true })).text).toMatch(/Texto de validação atualizado/);
  await browser.keyboard.press('Escape');
  await expect(editor).toBeVisible();

  expect((await api.request(`/api/artifacts/${artifactId}/export?format=pdf&version=0`)).status).toBe(409);
  expect((await api.request(`/api/artifacts/${artifactId}/export?format=html`)).status).toBe(400);
  expect((await new ApiSession(app.baseUrl!).request(`/api/artifacts/${artifactId}/export?format=pdf`)).status).toBe(401);

  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByRole('button', 'Exportar documento').tap();
  await expect(screen.getByRole('button', 'Exportar DOCX')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await browser.keyboard.press('Escape');
  await browser.route(new RegExp(`/api/artifacts/${artifactId}/export\\?format=pdf`), route => route.fulfill({ status: 503, json: { error: 'A conversão está indisponível. Tente novamente.' } }));
  await screen.getByRole('button', 'Exportar documento').tap();
  await screen.getByRole('button', 'Exportar PDF').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'A conversão está indisponível' })).toBeVisible();
  await expect(editor).toBeVisible();
});
