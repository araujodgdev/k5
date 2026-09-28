import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';

const directory = resolve('.data/whatsapp-admin-ui');
await mkdir(directory, { recursive: true });
await mkdir('playwright-report/whatsapp-admin', { recursive: true });
await writeFile(resolve(directory, 'index.html'), '<html lang="pt-BR" class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
await writeFile(resolve(directory, 'main.tsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformClientWhatsApp } from '../../src/components/platform-client-whatsapp';
import '../../src/app/globals.css';
createRoot(document.getElementById('root')).render(<main className="px-5 py-6 md:px-10 md:py-10"><h2 className="mb-8 text-3xl">Escritório de verificação</h2><PlatformClientWhatsApp officeId="ui-office" /></main>);`);
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
  optimizeDeps: { entries: ['.data/whatsapp-admin-ui/index.html'] },
  resolve: { alias: { '@': resolve('src') } }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('Servidor de verificação indisponível.');
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let enabled = false, paused = false, failed = false;
    await page.route('**/api/platform/offices/ui-office/whatsapp', async route => {
      if (failed) return route.fulfill({ status: 502, json: { error: 'Não foi possível consultar o WhatsApp. Tente atualizar o estado.' } });
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        expect(body.revision).toBe('a'.repeat(64));
        enabled = body.enabled;
        return route.fulfill({ json: { success: true } });
      }
      await route.fulfill({ json: { enabled, globalEnabled: !paused, revision: 'a'.repeat(64) } });
    });
    await page.goto(`http://127.0.0.1:${address.port}/.data/whatsapp-admin-ui/index.html`);
    await expect(page.getByText('Desativado para este escritório.', { exact: true })).toBeVisible();
    const activate = page.getByRole('button', { name: 'Ativar WhatsApp', exact: true });
    await activate.focus();
    await expect(activate).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Ativado para este escritório.', { exact: true })).toBeVisible();
    await page.screenshot({ path: `playwright-report/whatsapp-admin/enabled-${width}.png` });
    await page.getByRole('button', { name: 'Desativar WhatsApp', exact: true }).click();
    await expect(page.getByText('Desativado para este escritório.', { exact: true })).toBeVisible();
    paused = true;
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await expect(activate).toBeDisabled();
    await expect(page.getByText('O controle geral está pausado no Flagship.')).toBeVisible();
    failed = true;
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(activate).toHaveCount(0);
    await page.screenshot({ path: `playwright-report/whatsapp-admin/error-${width}.png` });
    failed = false; paused = false;
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await expect(activate).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(`PASS ${width}px: ativação, desativação, teclado, pausa global, erro e recuperação.`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
