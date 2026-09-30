import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  for (const prefix of ['', '/client']) {
    test(`password recovery returns to ${prefix || 'office'} sign-in at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      let delivered = false;
      await page.route('**/api/auth/request-password-reset', route => {
        const body = route.request().postDataJSON();
        expect(body.email).toBe('recover@example.test');
        expect(body.redirectTo).toBe(`${new URL(page.url()).origin}${prefix}/reset-password`);
        return route.fulfill(delivered ? { json: { status: true, message: 'Success' } } : { status: 503, json: { code: 'PASSWORD_RESET_UNAVAILABLE', message: 'Unavailable' } });
      });
      await page.goto(`${prefix}/sign-in`);
      await page.getByRole('link', { name: 'Esqueci minha senha', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/recover-password$`));
      await page.getByLabel('E-mail', { exact: true }).fill(' RECOVER@example.test ');
      await page.getByRole('button', { name: 'Solicitar recuperação' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'recuperação por e-mail está indisponível' })).toBeVisible();
      delivered = true;
      await page.getByRole('button', { name: 'Solicitar recuperação' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Se houver uma conta' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

      await page.goto(`${prefix}/reset-password?error=INVALID_TOKEN`);
      await expect(page.getByRole('heading', { name: 'Link indisponível' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Solicitar novo link' })).toHaveAttribute('href', `${prefix}/recover-password`);
      let submitted = false;
      await page.route('**/api/auth/reset-password', route => {
        submitted = true;
        expect(route.request().postDataJSON()).toEqual({ token: 'recovery-fixture', newPassword: 'Nova-senha-segura-2026!' });
        return route.fulfill({ json: { status: true } });
      });
      await page.goto(`${prefix}/reset-password?token=recovery-fixture`);
      await page.getByLabel('Nova senha', { exact: true }).fill('Nova-senha-segura-2026!');
      await page.getByLabel('Confirmar nova senha', { exact: true }).fill('Diferente-2026!');
      await page.getByRole('button', { name: 'Salvar nova senha' }).click();
      await expect(page.getByText('As senhas precisam ser iguais.', { exact: true })).toBeVisible();
      expect(submitted).toBe(false);
      await page.getByLabel('Confirmar nova senha', { exact: true }).fill('Nova-senha-segura-2026!');
      await page.getByRole('button', { name: 'Salvar nova senha' }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/sign-in$`));
      expect(submitted).toBe(true);
    });
  }
}
