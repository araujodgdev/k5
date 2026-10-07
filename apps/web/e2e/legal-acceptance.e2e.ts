import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

// An account created without the sign-up form's checkbox: the app asks for the terms first, and
// the Lume explains once what reaches the AI providers before the chat opens.
test('termos e aviso de IA: aceite antes do escritório e ciência antes da primeira conversa', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Aceite');
  const api = await new ApiSession(app.baseUrl!).signIn(account, { acceptLegal: false });
  await browser.setCookies(api.cookieList.map(cookie => ({ ...cookie, url: api.baseUrl, httpOnly: true })));
  await browser.setViewport({ width: 390, height: 844 });

  await app.open('/app/command-center');
  await expect(screen.getByRole('heading', 'Antes de continuar')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Aceitar e continuar').tap();
  await expect(screen.getByText('Marque a opção para continuar.')).toBeVisible();
  await screen.getByRole('checkbox', /Li e aceito os Termos de uso/).check();
  await screen.getByRole('button', 'Aceitar e continuar').tap();
  await expect(screen.getByRole('heading', 'Antes de continuar')).toBeHidden();

  const dismiss = screen.getByRole('button', 'Agora não');
  if (await dismiss.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) await dismiss.tap();
  await app.open('/app/agents');
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeVisible();
  await expect(screen.getByText(/sem anonimização/)).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Entendi').tap();
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeHidden();
  // Without an AI connection the chat may show its unavailable state; the page itself is what opens.
  await expect(screen.getByRole('complementary', 'Lume', { exact: true })).toBeVisible();
  await expect(screen.getByRole('textbox', 'Pergunte ao Lume')).toBeVisible();

  const rows = await sql<{ document: string }>(`SELECT a.document FROM legal_acceptance a JOIN "user" u ON u.id = a.user_id
    WHERE u.email = $1 ORDER BY a.document`, [account.email]);
  expect(rows.map(row => row.document)).toEqual(['ai_notice', 'terms']);
});
