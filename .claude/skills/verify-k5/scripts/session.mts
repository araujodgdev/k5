/**
 * Browser session against the running verification instance. Signs in through the real
 * /sign-in form and records a Playwright trace, screenshots and page errors under
 * <evidenceDir>/<feature>/.
 *
 *   const app = await openApp('office-tasks', { mobile: false });
 *   await app.page.goto('/app/agenda');  ...  await app.shot('01-lista');
 *   await app.close();   // always, in finally: writes trace.zip and errors.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { currentState, WEB } from './k5-verify.mts';

const webRequire = createRequire(join(WEB, 'package.json'));
const playwright = webRequire('@playwright/test') as typeof import('@playwright/test');
export const { chromium } = playwright;
// `next dev` compiles each route and API on first use; a fresh instance needs more than the 5 s default.
export const expect = playwright.expect.configure({ timeout: 30_000 });
const { Client } = webRequire('pg') as typeof import('pg');

export async function openApp(feature: string, { mobile = false, signIn = true } = {}) {
  const state = currentState();
  if (state?.status !== 'ready') throw new Error('Nenhuma instância pronta. Rode k5-verify.mts up e doctor.');
  const dir = join(state.evidenceDir, feature);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: state.baseURL, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce',
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  // Hydration reports put the differing attribute in later lines; keep them whole, with the URL.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    errors.push(`console @ ${page.url()}: ${/hydrat/i.test(text) ? text.slice(0, 4000) : text.split('\n')[0].slice(0, 200)}`);
  });
  let step = 0;
  const shot = async (name: string) => {
    const path = join(dir, `${String(++step).padStart(2, '0')}-${name}.png`);
    // caret 'hide' (the default) writes caret-color into inputs; a shot taken before hydration
    // then surfaces as a React hydration mismatch that the app never had.
    await page.screenshot({ path, fullPage: true, caret: 'initial' });
    return path;
  };
  /** Read-only query against the instance database, for side-effect proof. */
  const sql = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) => {
    const client = new Client({ connectionString: state.databaseUrl });
    await client.connect();
    try { await client.query('BEGIN READ ONLY'); return (await client.query(query, params)).rows as T[]; }
    finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
  };
  const log = (line: string) => { console.log(line); checks.push(line); };
  const checks: string[] = [];
  if (signIn) {
    await page.goto('/sign-in');
    await page.getByLabel('E-mail', { exact: true }).fill(state.account.email);
    await page.getByLabel('Senha', { exact: true }).fill(state.account.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL('**/app/**');
  }
  const close = async () => {
    await context.tracing.stop({ path: join(dir, 'trace.zip') }).catch(() => {});
    writeFileSync(join(dir, 'errors.json'), JSON.stringify(errors, null, 2));
    writeFileSync(join(dir, 'checks.txt'), checks.join('\n') + '\n');
    await browser.close();
    console.log(`Evidências em ${dir}`);
  };
  return { page, context, state, dir, errors, shot, sql, log, close };
}
