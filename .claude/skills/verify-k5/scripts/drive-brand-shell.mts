/**
 * Feature brand-shell: the Lume identity in the signed-in shell, desktop then mobile.
 */
import { expect, openApp } from './session.mts';

const app = await openApp('brand-shell');
const { page, shot, log } = app;
try {
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Lume — início' }).first()).toBeVisible();
  const nav = page.getByRole('navigation').first();
  for (const label of ['Lume', 'Cofre', 'Mensagens', 'Plano']) await expect(page.getByRole('link', { name: label, exact: true }).first()).toBeVisible();
  expect(await page.content()).not.toContain('Tises');
  await shot('shell-desktop');
  log('PASS shell: tile "Lume — início" e as entradas Lume, Cofre, Mensagens e Plano (WhatsApp fica atrás do flag de rollout); nenhum "Tises" na página.');

  await page.goto('/app/agents');
  await expect(page.getByRole('heading', { name: 'Lume', level: 1 })).toBeAttached();
  await page.waitForTimeout(1500);
  expect(await page.content()).not.toContain('Tises');
  await shot('agents');
  log('PASS chat: página com título "Lume".');

  await page.goto('/app/billing');
  await expect(page.getByText('Plano Lume').first()).toBeVisible();
  expect(await page.content()).not.toContain('Tises');
  await shot('billing');
  log('PASS plano: rótulo "Plano Lume".');

  for (const path of ['/app/messages', '/app/whatsapp']) {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(3000);
    expect(await page.content()).not.toContain('Tises');
    await shot(path.split('/').pop()!);
  }
  log('PASS Mensagens e WhatsApp abrem sem "Tises".');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Lume — início' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot('shell-mobile');
  log('PASS mobile: tile do Lume no cabeçalho, sem rolagem horizontal em 390px.');

  expect(app.errors).toEqual([]);
  log('PASS sem erros de página ou console.');
} finally {
  await app.close();
}
