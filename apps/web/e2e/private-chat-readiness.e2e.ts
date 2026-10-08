import { showLume } from './support/shell';
import { expect } from 'e2e';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';

test('arquivo com falha não impede conversa particular: compositor chega à configuração do provedor', async ({ app, screen, browser, sql }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Conversa com arquivo pendente'));
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Conversa independente da extração' } });
  const cookie = api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; ');
  const response = await fetch(new URL('/api/vault/documents', app.baseUrl!), { method: 'POST', body: new File(['invalid synthetic PDF'], 'arquivo-com-falha.pdf', { type: 'application/pdf' }), headers: {
    origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': 'arquivo-com-falha.pdf', 'x-k5-upload-scope': 'case', 'x-k5-upload-caseid': record.id,
  } });
  expect(response.status).toBe(201); const { document } = await response.json();
  await expect.poll(async () => (await sql('SELECT status FROM vault_document WHERE id=$1', [document.id]))[0]?.status).toBe('failed');
  await signInWithSession({ app, screen, browser }, api);
  await browser.setViewport({ width: 390, height: 844 });
  await app.open(`/app/vault/cases/${record.id}`);
  await expect(screen.getByRole('heading', 'Conversa independente da extração', { exact: true })).toBeVisible();
  await showLume({ screen, browser });
  const input = screen.getByRole('textbox', 'Pergunte ao Lume');
  await expect(input).toBeVisible(); await input.fill('Olá, quero conversar sem selecionar arquivos.');
  await screen.getByRole('button', 'Enviar mensagem').focus(); await browser.keyboard.press('Enter');
  await expect(screen.getByRole('alert').filter({ hasText: 'Peça ao administrador para conferir a configuração de IA.' })).toBeVisible();
  await expect(screen.getByText(/ainda está sendo processado|extração.*versão/i)).toHaveCount(0);
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('conversa-arquivo-falhou-sem-provedor');
});
