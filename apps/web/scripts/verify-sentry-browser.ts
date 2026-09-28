import { chromium, expect } from '@playwright/test';
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
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(page.locator('meta[name="sentry-trace"]')).toHaveAttribute('content', /^[a-f0-9]{32}-[a-f0-9]{16}(?:-[01])?$/);
    const serverTrace = (await page.locator('meta[name="sentry-trace"]').getAttribute('content'))!.split('-')[0];
    await page.locator('input[type="email"]').fill('private-form-sentry-test@example.com');
    await page.locator('input[type="password"]').fill('private-password-sentry-test');
    await page.getByRole('button', { name: 'Entrar', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeFocused();
    const response = page.waitForResponse(response => response.url().includes('ingest.us.sentry.io') &&
      (response.request().postData() || '').includes(check), { timeout: 30_000 });
    // A page script throws normally, so this exercises the SDK's global error handler.
    await page.addScriptTag({ content: `setTimeout(() => { throw new Error(${JSON.stringify(check)}); }, 0);` });
    expect((await response).ok()).toBe(true);
    const sent = envelopes.find(envelope => envelope.includes(check));
    expect(sent).toBeTruthy();
    expect(sent).toContain('"infer_ip":"never"');
    expect(sent).toContain('"service":"browser"');
    const event = sent!.split('\n').map(line => JSON.parse(line)).find(item => item.exception);
    expect(event.contexts.trace.trace_id).toBe(serverTrace);
    for (const secret of ['private-query-sentry-test', 'private-form-sentry-test', 'private-password-sentry-test']) {
      expect(sent).not.toContain(secret);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `playwright-report/sentry/sign-in-${viewport.width}.png` });
    console.log(JSON.stringify({ viewport: viewport.width, delivered: true, privacy: 'passed', traceLinked: true, eventId: event.event_id, error: check }));
    await context.close();
  }
} finally {
  await browser.close();
}
