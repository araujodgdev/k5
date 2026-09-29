import { chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const baseURL = process.env.TUTORIAL_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('O colega fictício só pode ser criado localmente.');
const path = '.data/tutorial/colleague.json';
const schema = z.object({ name: z.string(), email: z.string().email(), officeName: z.string(), password: z.string() });
const peer = existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, 'utf8'))) : {
  name: 'Pedro Lima · Demo', email: 'demo.colega@lume.test', officeName: 'Colega demonstrativo', password: randomBytes(24).toString('base64url'),
};
writeFileSync(path, JSON.stringify(peer), { mode: 0o600 });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ storageState: '.data/tutorial/session.json' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/app/agenda?view=team`);
  await page.getByRole('button', { name: 'Convidar para equipe', exact: true }).waitFor();
  if (await page.getByText(peer.name, { exact: true }).count()) {
    console.log('O colega fictício já participa do escritório demo.');
  } else {
    const peerContext = await browser.newContext();
    const signup = await peerContext.request.post(`${baseURL}/api/auth/sign-up/email`, { data: peer, headers: { origin: baseURL } });
    if (!signup.ok() && signup.status() !== 422) throw new Error(`Não foi possível preparar o colega fictício: ${signup.status()}.`);
    if (!await page.getByText(peer.email, { exact: true }).count()) {
      await page.getByRole('button', { name: 'Convidar para equipe', exact: true }).click();
      await page.getByLabel('E-mail da pessoa').fill(peer.email);
      await page.getByRole('button', { name: 'Criar convite', exact: true }).click();
      await expect(page.getByLabel('Link do convite')).toBeVisible({ timeout: 60_000 });
    }
    const peerPage = await peerContext.newPage();
    await peerPage.goto(`${baseURL}/sign-in`);
    await peerPage.getByLabel('E-mail', { exact: true }).fill(peer.email);
    await peerPage.getByLabel('Senha', { exact: true }).fill(peer.password);
    await peerPage.getByRole('button', { name: 'Entrar', exact: true }).click();
    await peerPage.waitForURL('**/app/**', { timeout: 60_000 });
    await peerPage.getByRole('button', { name: 'Agora não', exact: true }).click();
    await peerPage.goto(`${baseURL}/app/agenda?view=invites`);
    await peerPage.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
    await expect(peerPage.getByText('Convite aceito.', { exact: true })).toBeVisible({ timeout: 60_000 });
    await peerContext.storageState({ path: '.data/tutorial/colleague-session.json' });
    console.log('Colega fictício criado e convite aceito pela interface.');
  }
} finally { await browser.close(); }
