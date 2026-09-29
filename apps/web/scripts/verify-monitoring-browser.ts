import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import puppeteer from '@cloudflare/puppeteer';
import { z } from 'zod';
import { runBrowserJourneys } from '../src/lib/observability/browser-journeys';

const secrets = z.object({ MONITOR_EMAIL: z.email(), MONITOR_PASSWORD: z.string(), MONITOR_OFFICE_ID: z.string() })
  .parse(JSON.parse(readFileSync('.data/monitoring/secrets.json', 'utf8')));
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const address = listener.address();
if (!address || typeof address === 'string') throw new Error('Porta de verificação indisponível.');
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const chrome = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${address.port}`] });
try {
  const endpoint = z.object({ webSocketDebuggerUrl: z.url() }).parse(await (await fetch(`http://127.0.0.1:${address.port}/json/version`)).json());
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint.webSocketDebuggerUrl });
  try {
    const { failureScreenshot, ...outcome } = await runBrowserJourneys(browser, {
      baseUrl: 'https://lume.software', email: secrets.MONITOR_EMAIL,
      password: secrets.MONITOR_PASSWORD, officeId: secrets.MONITOR_OFFICE_ID,
    });
    writeFileSync('.data/monitoring/browser-result.json', JSON.stringify(outcome, null, 2));
    if (failureScreenshot) writeFileSync('.data/monitoring/browser-failure.png', failureScreenshot);
    console.log(JSON.stringify(outcome, null, 2));
    if (outcome.status !== 'ok') process.exitCode = 1;
  } finally { await browser.disconnect(); }
} finally { await chrome.close(); }
