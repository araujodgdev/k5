import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tutorialSteps } from '../src/lib/onboarding';

const directory = '.data/tutorial/verification';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ storageState: '.data/tutorial/session.json', viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/app/command-center');
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('lume:tutorial:')) localStorage.removeItem(key); });
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Conheça o Lume' })).toBeVisible();
    await page.getByRole('button', { name: 'Começar tutorial' }).click();
    const steps = tutorialSteps({ whatsappEnabled: false, adsEnabled: false, platformAdmin: false });
    for (const [index, step] of steps.entries()) {
      const dialog = page.getByRole('dialog', { name: step.title });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(`http://localhost:3000${step.href}`, { timeout: 60_000 });
      const next = dialog.getByRole('button', { name: index === steps.length - 1 ? 'Concluir' : 'Próximo', exact: true });
      await expect(next).toBeEnabled();
      const box = await dialog.boundingBox();
      if (!box || box.x < 0 || box.y < 0 || box.x + box.width > (mobile ? 391 : 1441) || box.y + box.height > (mobile ? 845 : 901)) throw new Error(`Tutorial fora da tela: ${step.id}`);
      if (index === 1) {
        await page.screenshot({ path: `${directory}/${mobile ? 'mobile' : 'desktop'}.png` });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        if (mobile) await page.getByRole('button', { name: 'Mais', exact: true }).click();
        await page.getByRole('button', { name: 'Tutorial do Lume' }).filter({ visible: true }).click();
        await page.getByRole('button', { name: 'Continuar tutorial' }).click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await dialog.getByRole('button', { name: 'Voltar', exact: true }).click();
        await expect(page.getByRole('dialog', { name: steps[0].title })).toBeVisible();
        await page.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      await next.click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (process.argv.includes('--video')) {
      if (mobile) await page.getByRole('button', { name: 'Mais', exact: true }).click();
      await page.getByRole('button', { name: 'Tutorial do Lume' }).filter({ visible: true }).click();
      await page.getByRole('link', { name: 'Assistir ao vídeo', exact: true }).click();
      await expect(page).toHaveURL('http://localhost:3000/app/tutorial', { timeout: 60_000 });
      const player = page.getByLabel('Tutorial completo do Lume em português');
      await expect(player).toBeVisible();
      await expect.poll(() => player.evaluate(element => element instanceof HTMLVideoElement ? element.duration : 0), { timeout: 60_000 }).toBeGreaterThan(120);
      const duration = await player.evaluate(element => element instanceof HTMLVideoElement ? element.duration : 0);
      expect(duration).toBeLessThanOrEqual(300);
      await player.evaluate(async element => { if (element instanceof HTMLVideoElement) { element.muted = true; await element.play(); } });
      await expect.poll(() => player.evaluate(element => element instanceof HTMLVideoElement ? element.currentTime : 0)).toBeGreaterThan(0);
      await player.evaluate(element => { if (element instanceof HTMLVideoElement) element.pause(); });
      await page.screenshot({ path: `${directory}/video-${mobile ? 'mobile' : 'desktop'}.png` });
    }
    await context.close();
    console.log(`Tutorial ${mobile ? 'mobile' : 'desktop'}: conclusão, pausa, retomada, teclado e limites da tela verificados.`);
  }
} finally { await browser.close(); }
