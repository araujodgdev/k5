import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

describe('folhas persistentes do canvas', { session: 'admin' }, () => {
  for (const width of [1440, 390]) {
    test(`cálculo e Agenda mantêm nós, formulário, scroll e chat em ${width}px`, { timeout: 240_000 }, async ({ app, browser, screen }) => {
      await browser.setViewport({ width, height: 900 });
      await app.open('/app/calc');
      await expect(screen.getByRole('heading', /^Cálculos/)).toBeVisible();
      await screen.getByRole('button', /^Tributário/).tap();
      await screen.getByLabel('Título do cálculo').fill('Cálculo que permanece montado');
      await screen.getByLabel('Principal (R$)').fill('1.234,56');
      if (width < 768) await screen.getByRole('button', 'Voltar ao Lume').tap();
      const chat = screen.getByRole('textbox', 'Pergunte ao Lume');
      await chat.fill('Rascunho que acompanha os módulos');
      if (width < 768) await screen.getByRole('button', 'Recolher o Lume').tap();
      const scroll = await browser.evaluate(() => {
        Reflect.set(window, 'canvasProofInput', document.querySelector('input[name="principal"]'));
        Reflect.set(window, 'canvasProofChat', document.querySelector('textarea[aria-label="Pergunte ao Lume"]'));
        const main = document.getElementById('main-content')!;
        main.scrollTop = 240;
        return main.scrollTop;
      });
      expect(scroll).toBeGreaterThan(0);
      let resume!: () => void;
      let requested!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      const started = new Promise<void>(resolve => { requested = resolve; });
      await browser.route('**/app/agenda*', async route => {
        if (!new URL(route.request.url).searchParams.has('__canvas')) return route.continue();
        requested();
        await held;
        return route.continue();
      });
      await screen.getByRole('button', width < 768 ? /^Mais opções(?:,|$)/ : 'Casos e módulos').tap();
      await screen.getByRole('navigation', 'Casos e módulos').getByRole('link', 'Tarefas', { exact: true }).tap();
      await started;
      await expect(screen.getByLabel('Principal (R$)')).toHaveValue('1.234,56');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofInput') === document.querySelector('input[name="principal"]'))).toBe(true);
      expect(await browser.evaluate(() => document.querySelector('[aria-label="Contexto da próxima mensagem"]')?.textContent ?? null)).toContain('Cálculos jurídicos');
      resume();
      await expect(screen.getByRole('heading', 'Tarefas', { exact: true })).toBeVisible();
      await browser.unroute('**/app/agenda*');
      await screen.getByRole('searchbox', 'Buscar tarefas').fill('Filtro que permanece');
      await browser.evaluate(() => { Reflect.set(window, 'canvasProofAgenda', document.querySelector('input[aria-label="Buscar tarefas"]')); return null; });
      await browser.evaluate(() => { history.back(); return null; });
      await expect(screen.getByLabel('Principal (R$)')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByLabel('Principal (R$)')).toHaveValue('1.234,56');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofInput') === document.querySelector('input[name="principal"]'))).toBe(true);
      expect(await browser.evaluate(() => document.getElementById('main-content')!.scrollTop)).toBe(scroll);
      await browser.evaluate(() => { history.forward(); return null; });
      await expect(screen.getByRole('searchbox', 'Buscar tarefas')).toBeVisible();
      await expect(screen.getByRole('searchbox', 'Buscar tarefas')).toHaveValue('Filtro que permanece');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofAgenda') === document.querySelector('input[aria-label="Buscar tarefas"]'))).toBe(true);
      await screen.getByRole('button', width < 768 ? /^Mais opções(?:,|$)/ : 'Casos e módulos').tap();
      await screen.getByRole('navigation', 'Casos e módulos').getByRole('link', 'Todos os casos', { exact: true }).tap();
      await expect(screen.getByRole('heading', 'Casos', { exact: true })).toBeVisible();
      await browser.evaluate(() => { history.back(); return null; });
      await expect(screen.getByRole('searchbox', 'Buscar tarefas')).toBeVisible();
      await expect(screen.getByRole('searchbox', 'Buscar tarefas')).toHaveValue('Filtro que permanece');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofAgenda') === document.querySelector('input[aria-label="Buscar tarefas"]'))).toBe(true);
      if (width < 768) {
        await screen.getByRole('button', 'Buscar', { exact: true }).tap();
        await screen.getByRole('group', 'Abas abertas').getByRole('option', 'Cálculos jurídicos', { exact: true }).tap();
      } else await screen.getByRole('navigation', 'Abas do canvas').getByRole('link', 'Cálculos jurídicos', { exact: true }).tap();
      await expect(screen.getByLabel('Título do cálculo')).toBeVisible();
      await expect(screen.getByLabel('Título do cálculo')).toHaveValue('Cálculo que permanece montado');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofInput') === document.querySelector('input[name="principal"]'))).toBe(true);
      if (width < 768) await screen.getByRole('button', 'Voltar ao Lume').tap();
      await expect(chat).toHaveValue('Rascunho que acompanha os módulos');
      expect(await browser.evaluate(() => Reflect.get(window, 'canvasProofChat') === document.querySelector('textarea[aria-label="Pergunte ao Lume"]'))).toBe(true);
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`canvas-preservado-${width}`);
    });
  }
});
