import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

describe('abas e controles do Lume', { session: 'admin' }, () => {
  test('trocar abas preserva o chat e o rascunho, com controles na mesma linha', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1440, height: 900 });
    await app.open('/app/command-center');
    const input = screen.getByRole('textbox', 'Pergunte ao Lume');
    await input.fill('Rascunho que continua aberto entre as abas');
    await browser.evaluate(() => {
      document.querySelector('textarea[aria-label="Pergunte ao Lume"]')!.setAttribute('data-tab-proof', 'mounted');
      return null;
    });
    for (const name of ['Cofre', 'E-mails', 'Início']) {
      await screen.getByRole('button', 'Abrir módulos').tap();
      await screen.getByRole('navigation', 'Módulos').getByRole('button', name, { exact: true }).tap();
      await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', name, { exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
      await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    }
    const tabs = screen.getByRole('navigation', 'Abas do canvas');
    for (const name of ['E-mails', 'Cofre', 'Início']) {
      await tabs.getByRole('button', name, { exact: true }).tap();
      await expect(tabs.getByRole('button', name, { exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
      await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    }
    const ys = await browser.evaluate(() => Array.from(document.querySelectorAll('.lume-panel-header button')).map(button => button.getBoundingClientRect().y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    await expect(screen.getByRole('button', 'Personalizar Lume')).toHaveCount(0);
    await expect(screen.getByRole('button', 'Artefatos')).toHaveCount(0);
    await app.screenshot('abas-preservam-chat');
    await browser.setViewport({ width: 390, height: 844 });
    await screen.getByRole('navigation', 'Alternar conversa e canvas').getByRole('button', 'Canvas').tap();
    await tabs.getByRole('button', 'Cofre', { exact: true }).tap();
    await screen.getByRole('navigation', 'Alternar conversa e canvas').getByRole('button', 'Lume').tap();
    await expect(input).toHaveValue('Rascunho que continua aberto entre as abas');
    await expect(input).toHaveAttribute('data-tab-proof', 'mounted');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot('chat-mobile-preservado');
  });

  test('notificações e feedback são arredondados e centralizados no desktop e celular', async ({ app, screen, browser }) => {
    for (const width of [1440, 390]) {
      await browser.setViewport({ width, height: 900 });
      await app.open('/app/vault');
      await screen.getByRole('button', /^Notificações/).tap();
      const checkDialog = async () => {
        const dialog = screen.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const box = (await dialog.boundingBox())!;
        expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
        expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(2);
        const radius = await browser.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[role="dialog"]')!).borderRadius));
        expect(radius).toBeGreaterThanOrEqual(12);
      };
      await checkDialog();
      await browser.keyboard.press('Escape');
      await screen.getByRole('button', /^Conta de /).tap();
      await screen.getByRole('button', 'Enviar feedback').tap();
      await checkDialog();
      const feedbackRadii = await browser.evaluate(() => Array.from(document.querySelectorAll('.feedback-panel label:has(input[type="radio"]), .feedback-panel .border-line')).map(item => parseFloat(getComputedStyle(item).borderRadius)));
      expect(feedbackRadii.length).toBeGreaterThanOrEqual(5);
      expect(Math.min(...feedbackRadii)).toBeGreaterThanOrEqual(10);
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`feedback-centralizado-${width}`);
      await browser.keyboard.press('Escape');
      await screen.getByRole('button', /^Conta de /).tap();
      await screen.getByRole('button', 'Tutorial do Lume').tap();
      await checkDialog();
      await browser.keyboard.press('Escape');
      if (width < 768) await screen.getByRole('navigation', 'Alternar conversa e canvas').getByRole('button', 'Lume').tap();
      await screen.getByRole('button', 'Anexar arquivos').tap();
      await expect(screen.getByRole('button', 'Documento ou planilha')).toBeVisible();
      expect(await browser.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-slot="popover-content"]')!).borderRadius))).toBeGreaterThanOrEqual(10);
      await browser.keyboard.press('Escape');
    }
  });
});
