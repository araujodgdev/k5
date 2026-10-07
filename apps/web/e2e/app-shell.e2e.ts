import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

const mentionsOldBrand = () => document.documentElement.outerHTML.includes('Tises');

test('o shell autenticado mostra a marca Lume e a navegação principal no desktop e no celular', { session: 'admin' }, async ({ app, screen, browser }) => {
  await app.open('/app');
  // /app redirects to the command center; let it land before the next navigation.
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  // The Lume is the panel beside the canvas; the canvas opens cases and modules from its launcher.
  await expect(screen.getByRole('complementary', 'Lume')).toBeVisible();
  await screen.getByRole('button', 'Casos e módulos').tap();
  const launcher = screen.getByRole('navigation', 'Casos e módulos');
  for (const label of ['Todos os casos', 'Mensagens', 'Plano']) await expect(launcher.getByRole('link', label)).toBeVisible();
  // Neither is a module: the Lume is the panel, and the Cofre opens as "Todos os casos".
  for (const label of ['Lume', 'Cofre']) await expect(launcher.getByRole('link', label)).toHaveCount(0);
  expect(await browser.evaluate(mentionsOldBrand)).toBe(false);

  // The Lume's old page now opens Início, with the panel beside it.
  await app.open('/app/agents');
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  await expect(screen.getByRole('complementary', 'Lume')).toBeVisible();
  await app.open('/app/billing');
  await expect(screen.getByText('Plano Lume', { exact: false }).first()).toBeVisible();
  expect(await browser.evaluate(mentionsOldBrand)).toBe(false);

  // On a phone the Lume comes first; its header opens the canvas, whose menu holds everything else.
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app');
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  await expect(screen.getByRole('complementary', 'Lume')).toBeVisible();
  await screen.getByRole('button', 'Abrir o canvas do escritório').tap();
  await expect(screen.getByRole('button', /^Mais opções/)).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
