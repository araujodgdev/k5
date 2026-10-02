import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { tutorialSteps } from '../src/lib/onboarding';

// The tour as a first visit sees it: every step on its page and inside the screen, a pause with
// Escape that survives a reload, resuming from the menu, keyboard focus and going back.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const mobile = viewport.width < 768;
  test(`o tutorial percorre todas as etapas, pausa e retoma em ${viewport.width}px`, { session: 'admin' }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewport);
    await app.open('/app/command-center');
    await browser.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('lume:tutorial:')) localStorage.removeItem(key); return null; });
    await browser.reload();
    await expect(screen.getByRole('dialog', 'Conheça o Lume')).toBeVisible();
    await screen.getByRole('button', 'Começar tutorial').tap();
    const steps = tutorialSteps({ whatsappEnabled: false, adsEnabled: false, platformAdmin: false });
    for (const [index, step] of steps.entries()) {
      const dialog = screen.getByRole('dialog', step.title);
      await expect(dialog).toBeVisible();
      await expect(browser).toHaveURL(step.href, { timeout: 60_000 });
      const next = dialog.getByRole('button', index === steps.length - 1 ? 'Concluir' : 'Próximo');
      await expect(next).toBeEnabled();
      const box = (await dialog.boundingBox())!;
      expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `etapa ${step.id} dentro da tela`).toBe(true);
      if (index === 1) {
        await browser.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await browser.reload();
        await expect(screen.getByRole('dialog')).toHaveCount(0);
        if (mobile) await screen.getByRole('button', 'Mais').tap();
        await screen.getByRole('button', 'Tutorial do Lume', { visible: true }).tap();
        await screen.getByRole('button', 'Continuar tutorial').tap();
        await expect(dialog).toBeVisible();
        await browser.keyboard.press('Tab');
        expect(await browser.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
        await dialog.getByRole('button', 'Voltar').tap();
        await expect(screen.getByRole('dialog', steps[0].title)).toBeVisible();
        await screen.getByRole('button', 'Próximo').tap();
      }
      await next.tap();
    }
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    await browser.reload();
    await expect(screen.getByRole('dialog')).toHaveCount(0);
  });
}

// Playwright's Chromium has no H.264 decoder, so playback and length are not checked here (range
// requests are in tests/tutorial-video.test.ts); this proves the path to the video and its files.
test('o tutorial leva ao vídeo, com legenda e capa publicadas', { session: 'admin' }, async ({ app, screen, browser }) => {
  await app.open('/app/command-center');
  await screen.getByRole('button', 'Tutorial do Lume', { visible: true }).tap();
  await screen.getByRole('link', 'Assistir ao vídeo').tap();
  await expect(browser).toHaveURL(/\/app\/tutorial$/);
  await expect(screen.getByLabel('Tutorial completo do Lume em português')).toBeVisible();
  for (const [path, type] of [['/tutorial/tutorial-lume.mp4', 'video/mp4'], ['/tutorial/tutorial-lume.pt-BR.vtt', 'text/vtt'], ['/tutorial/capa.jpg', 'image/jpeg']]) {
    const response = await fetch(new URL(path, app.baseUrl), { method: 'HEAD' });
    expect({ path, status: response.status, type: response.headers.get('content-type')?.split(';')[0] }).toEqual({ path, status: 200, type });
  }
});
