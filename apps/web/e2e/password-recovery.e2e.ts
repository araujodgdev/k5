import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

// Pairwise: each portal at one width covers both portals and both layouts in half the runs.
for (const { prefix, width } of [{ prefix: '', width: 1280 }, { prefix: '/client', width: 390 }]) {
  test(`recuperação de senha volta ao login ${prefix ? 'do cliente' : 'do escritório'} em ${width}px`, async ({ app, screen, browser }) => {
    await browser.setViewport({ width, height: 844 });
    let delivered = false;
    const requests: unknown[] = [];
    await browser.route('**/api/auth/request-password-reset', route => {
      requests.push(JSON.parse(route.request.postData ?? '{}'));
      return route.fulfill(delivered ? { json: { status: true, message: 'Success' } } : { status: 503, json: { code: 'PASSWORD_RESET_UNAVAILABLE', message: 'Unavailable' } });
    });
    await app.open(`${prefix}/sign-in`);
    await screen.getByRole('link', 'Esqueci minha senha').tap();
    await expect(browser).toHaveURL(new RegExp(`${prefix}/recover-password$`));
    await screen.getByLabel('E-mail').fill(' RECOVER@example.test ');
    await screen.getByRole('button', 'Solicitar recuperação').tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'recuperação por e-mail está indisponível' })).toBeVisible();
    delivered = true;
    await screen.getByRole('button', 'Solicitar recuperação').tap();
    await expect(screen.getByRole('status').filter({ hasText: 'Se houver uma conta' })).toBeVisible();
    // The address is normalized and the link returns to the portal the person started from.
    expect(requests).toEqual([0, 1].map(() => ({ email: 'recover@example.test', redirectTo: `${new URL(app.baseUrl!).origin}${prefix}/reset-password` })));
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

    await app.open(`${prefix}/reset-password?error=INVALID_TOKEN`);
    await expect(screen.getByRole('heading', 'Link indisponível')).toBeVisible();
    await expect(screen.getByRole('link', 'Solicitar novo link')).toHaveAttribute('href', `${prefix}/recover-password`);
    const submitted: unknown[] = [];
    await browser.route('**/api/auth/reset-password', route => {
      submitted.push(JSON.parse(route.request.postData ?? '{}'));
      return route.fulfill({ json: { status: true } });
    });
    await app.open(`${prefix}/reset-password?token=recovery-fixture`);
    await screen.getByLabel('Nova senha').fill('Nova-senha-segura-2026!');
    await screen.getByLabel('Confirmar nova senha').fill('Diferente-2026!');
    await screen.getByRole('button', 'Salvar nova senha').tap();
    await expect(screen.getByText('As senhas precisam ser iguais.')).toBeVisible();
    expect(submitted).toEqual([]);
    await screen.getByLabel('Confirmar nova senha').fill('Nova-senha-segura-2026!');
    await screen.getByRole('button', 'Salvar nova senha').tap();
    await expect(browser).toHaveURL(new RegExp(`${prefix}/sign-in$`));
    expect(submitted).toEqual([{ token: 'recovery-fixture', newPassword: 'Nova-senha-segura-2026!' }]);
  });
}
