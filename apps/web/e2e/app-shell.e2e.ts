import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

const mentionsOldBrand = () => document.documentElement.outerHTML.includes('Tises');

test('o shell autenticado mostra a marca Lume e a navegação principal no desktop e no celular', { session: 'admin' }, async ({ app, screen, browser }) => {
  await app.open('/app');
  // /app redirects to the command center; let it land before the next navigation.
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  await expect(screen.getByRole('link', 'Lume — início').first()).toBeVisible();
  for (const label of ['Lume', 'Cofre', 'Mensagens', 'Plano']) await expect(screen.getByRole('link', label).first()).toBeVisible();
  expect(await browser.evaluate(mentionsOldBrand)).toBe(false);

  await app.open('/app/agents');
  await expect(screen.getByRole('heading', { name: 'Lume', level: 1 })).toBeAttached();
  await app.open('/app/billing');
  await expect(screen.getByText('Plano Lume').first()).toBeVisible();
  expect(await browser.evaluate(mentionsOldBrand)).toBe(false);

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app');
  await expect(browser).toHaveURL(/\/app\/command-center$/);
  await expect(screen.getByRole('link', 'Lume — início').first()).toBeVisible();
  await expect(screen.getByRole('navigation', 'Navegação principal').getByRole('button', 'Mais')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
