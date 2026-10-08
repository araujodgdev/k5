import { spawn } from 'node:child_process';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';

// An account whose acceptance of the terms is no longer current (sign-up requires it, so the
// fixture removes it as a version bump would stale it): the app asks for the terms first, and the
// Lume explains once what reaches the AI providers before the chat opens.
test('termos e aviso de IA: aceite antes do escritório e ciência antes da primeira conversa', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Aceite');
  const api = await new ApiSession(app.baseUrl!).signIn(account, { acceptLegal: false });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'e2e/support/legal-acceptance-fixture.mts', account.email], { windowsHide: true, env: process.env });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
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
