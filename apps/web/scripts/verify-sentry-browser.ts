import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { until, visible } from './browser-wait';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.BASE_URL || 'http://localhost:3105';
const browser = await chromium.launch({ headless: true });
const check = `Lume browser Sentry verification ${Date.now()}`;
await mkdir('playwright-report/sentry', { recursive: true });

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    const envelopes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('ingest.us.sentry.io')) envelopes.push(request.postData() || '');
    });
    await page.goto(`${baseURL}/sign-in?private=private-query-sentry-test`);
    await visible(page.getByRole('button', { name: 'Entrar', exact: true }));
    await until(() => page.locator('meta[name="sentry-trace"]').getAttribute('content'), value => /^[a-f0-9]{32}-[a-f0-9]{16}(?:-[01])?$/.test(value ?? ''), 'atributo ' + 'content');
    const serverTrace = (await page.locator('meta[name="sentry-trace"]').getAttribute('content'))!.split('-')[0];
    await page.locator('input[type="email"]').fill('private-form-sentry-test@example.com');
    await page.locator('input[type="password"]').fill('private-password-sentry-test');
    await page.getByRole('button', { name: 'Entrar', exact: true }).focus();
    await until(() => page.getByRole('button', { name: 'Entrar', exact: true }).evaluate(element => element === document.activeElement), Boolean, 'foco no botão Entrar');
    const response = page.waitForResponse(response => response.url().includes('ingest.us.sentry.io') &&
      (response.request().postData() || '').includes(check), { timeout: 30_000 });
    // A page script throws normally, so this exercises the SDK's global error handler.
    await page.addScriptTag({ content: `setTimeout(() => { throw new Error(${JSON.stringify(check)}); }, 0);` });
    assert.equal((await response).ok(), true);
    const sent = envelopes.find(envelope => envelope.includes(check));
    assert.ok(sent);
    assert.ok(sent?.includes('"infer_ip":"never"'), '"infer_ip":"never"');
    assert.ok(sent?.includes('"service":"browser"'), '"service":"browser"');
    const event = sent!.split('\n').map(line => JSON.parse(line)).find(item => item.exception);
    assert.equal(event.contexts.trace.trace_id, serverTrace);
    for (const secret of ['private-query-sentry-test', 'private-form-sentry-test', 'private-password-sentry-test']) {
      assert.ok(!sent?.includes(secret), secret);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `playwright-report/sentry/sign-in-${viewport.width}.png` });
    console.log(JSON.stringify({ viewport: viewport.width, delivered: true, privacy: 'passed', traceLinked: true, eventId: event.event_id, error: check }));
    await context.close();
  }
} finally {
  await browser.close();
}
