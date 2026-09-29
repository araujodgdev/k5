import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const baseURL = process.env.TUTORIAL_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('Use um ambiente local para a conta demonstrativa.');
const directory = resolve('.data/tutorial');
mkdirSync(directory, { recursive: true });
const credentialsFile = resolve(directory, 'credentials.json');
const existingAccount = existsSync(credentialsFile);
const schema = z.object({ email: z.string().email(), password: z.string(), name: z.string(), officeName: z.string() });
const credentials = existsSync(credentialsFile) ? schema.parse(JSON.parse(readFileSync(credentialsFile, 'utf8'))) : {
  email: 'demo.tutorial@lume.test', password: randomBytes(24).toString('base64url'), name: 'Marina Oliveira', officeName: 'Oliveira Advocacia · Demonstração',
};
writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseURL}/sign-in`);
  await page.getByLabel('E-mail', { exact: true }).fill(credentials.email);
  await page.getByLabel('Senha', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const login = await Promise.race([
    page.waitForURL('**/app/**', { timeout: 60_000, waitUntil: 'domcontentloaded' }).then(() => true),
    page.locator('form').getByRole('alert').waitFor({ timeout: 60_000 }).then(() => false),
  ]);
  if (!login) {
    if (existingAccount) throw new Error(`Não foi possível entrar na conta demo existente: ${await page.locator('form').getByRole('alert').innerText()}`);
    await page.goto(`${baseURL}/sign-up`);
    await page.getByLabel('Nome completo', { exact: true }).fill(credentials.name);
    await page.getByLabel('Nome do escritório', { exact: true }).fill(credentials.officeName);
    await page.getByLabel('E-mail', { exact: true }).fill(credentials.email);
    await page.getByLabel('Senha', { exact: true }).fill(credentials.password);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.waitForURL('**/app/**', { timeout: 60_000 });
  }
  await page.getByRole('button', { name: 'Agora não', exact: true }).click({ timeout: 15_000 });
  await page.context().storageState({ path: resolve(directory, 'session.json') });
  console.log(`Conta demo pronta. Credenciais privadas em ${credentialsFile}`);
} finally { await browser.close(); }

await import('./tutorial-colleague');
