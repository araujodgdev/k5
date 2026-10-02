import type { Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import type { Account, ApiSession } from './accounts';

type Fixtures = { app: App; screen: Screen; browser: Browser };

/** The onboarding tour opens once per browser; close it so it does not cover the page. */
async function dismissTour({ screen }: Fixtures) {
  const dismiss = screen.getByRole('button', 'Agora não');
  if (await dismiss.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await dismiss.tap();
    await expect(dismiss).toBeHidden();
  }
}

/**
 * Signs in through the real /sign-in form. Plain strings, not `Secret`s: a secret fill would
 * withhold screenshots from the rest of the attempt, and these are disposable test accounts.
 */
export async function signInThroughForm(fixtures: Fixtures, account: Account) {
  const { app, screen, browser } = fixtures;
  await app.open('/sign-in');
  await screen.getByLabel('E-mail').fill(account.email);
  await screen.getByLabel('Senha').fill(account.password);
  await screen.getByRole('button', 'Entrar').tap();
  // A first sign-in lands on /app, which then redirects to the command center.
  await browser.waitForURL(/\/app(\/|$)/);
  await dismissTour(fixtures);
}

/**
 * Hands an API session to the browser. Tests whose subject is not the sign-in form use this, so
 * the run stays inside the auth rate limits; the form itself is covered by auth.setup.e2e.ts.
 */
export async function signInWithSession(fixtures: Fixtures, api: ApiSession) {
  const { app, browser } = fixtures;
  await browser.setCookies(api.cookieList.map(cookie => ({ ...cookie, url: api.baseUrl, httpOnly: true })));
  await app.open('/app/command-center');
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  await dismissTour(fixtures);
}
