import { spawn } from 'node:child_process';
import type { Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test, type Sql } from './support/fixtures';

const acceptance = '**/api/legal/acceptance';

async function dismissTour(screen: Screen) {
  const dismiss = screen.getByRole('button', 'Agora não');
  if (await dismiss.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) await dismiss.tap();
}

// Sign-up accepts only the terms, so a new account meets the AI notice on its first visit to the Lume.
async function openAiNotice({ app, screen, browser }: { app: App; screen: Screen; browser: Browser }) {
  const account = uniqueAccount('Aviso');
  const api = await new ApiSession(app.baseUrl!).signIn(account, { acceptLegal: false });
  await browser.setCookies(api.cookieList.map(cookie => ({ ...cookie, url: api.baseUrl, httpOnly: true })));
  await app.open('/app/agents');
  await dismissTour(screen);
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeVisible();
  return account;
}

const acceptedDocuments = async (sql: Sql, email: string) => (await sql<{ document: string }>(`SELECT a.document
  FROM legal_acceptance a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1 ORDER BY a.document`, [email])).map(row => row.document);

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

  await dismissTour(screen);
  await app.open('/app/agents');
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeVisible();
  await expect(screen.getByText(/sem anonimização/)).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Entendi').tap();
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeHidden();
  // Without an AI connection the chat may show its unavailable state; the page itself is what opens.
  await expect(screen.getByRole('complementary', 'Lume', { exact: true })).toBeVisible();
  await expect(screen.getByRole('textbox', 'Pergunte ao Lume')).toBeVisible();

  expect(await acceptedDocuments(sql, account.email)).toEqual(['ai_notice', 'terms']);
});

// An acceptance the platform holds without answering must end in an error the person can retry from.
test('aviso de IA: aceite sem resposta mostra o erro e deixa tentar de novo', async ({ app, screen, browser, sql }) => {
  const account = await openAiNotice({ app, screen, browser });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await browser.route(acceptance, async route => { await held; await route.abort().catch(() => undefined); });
  try {
    await screen.getByRole('button', 'Entendi').tap();
    await expect(screen.getByRole('button', 'Registrando…')).toBeDisabled();
    await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível registrar' })).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByRole('button', 'Entendi')).toBeEnabled();
  } finally {
    release();
  }
  await browser.unroute(acceptance);
  await screen.getByRole('button', 'Entendi').tap();
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeHidden();
  expect(await acceptedDocuments(sql, account.email)).toEqual(['ai_notice', 'terms']);
});

// The 503 seen in production on 06/10 passed on a second try; the notice retries once by itself.
test('aviso de IA: um 503 passageiro no aceite é repetido e o Lume abre', async ({ app, screen, browser, sql }) => {
  const account = await openAiNotice({ app, screen, browser });
  let attempts = 0;
  await browser.route(acceptance, async route => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Service Unavailable' });
    else await route.continue();
  });
  await screen.getByRole('button', 'Entendi').tap();
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeHidden();
  expect(attempts).toBe(2);
  expect(await acceptedDocuments(sql, account.email)).toEqual(['ai_notice', 'terms']);
});

// A 204 that records nothing leaves the notice in the refreshed page: the button waits for the
// refresh, then answers again instead of staying on "Registrando…".
test('aviso de IA: se o aviso continua depois do aceite, o botão volta a responder', async ({ app, screen, browser }) => {
  await openAiNotice({ app, screen, browser });
  let refreshStarted!: () => void;
  const refreshing = new Promise<void>(resolve => { refreshStarted = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await browser.route(acceptance, route => route.fulfill({ status: 204 }));
  await browser.route(/[?&]_rsc=/, async route => { refreshStarted(); await held; await route.continue(); });
  try {
    await screen.getByRole('button', 'Entendi').tap();
    await refreshing;
    await expect(screen.getByRole('button', 'Registrando…')).toBeDisabled();
  } finally {
    release();
  }
  await expect(screen.getByRole('button', 'Entendi')).toBeEnabled();
  await expect(screen.getByRole('heading', 'Antes de usar o Lume')).toBeVisible();
});
