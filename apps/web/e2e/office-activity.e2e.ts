import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

for (const viewport of [{ name: 'desktop', width: 1280, height: 844 }, { name: 'celular', width: 390, height: 844 }]) {
  test(`a atividade do escritório mostra quem fez o quê, com filtros, no ${viewport.name}`, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: viewport.width, height: viewport.height });
    const owner = uniqueAccount('Dona'), guest = uniqueAccount('Parceira'), stranger = uniqueAccount('Estranha');
    const ownerApi = await new ApiSession(app.baseUrl!).signIn(owner);
    await new ApiSession(app.baseUrl!).signIn(guest);
    const strangerApi = await new ApiSession(app.baseUrl!).signIn(stranger);
    await ownerApi.json('/api/collaboration', { json: { action: 'invite', invitation: { email: guest.email } } });
    // Another office's invitation must not show up in this office's activity.
    await strangerApi.json('/api/collaboration', { json: { action: 'invite', invitation: { email: guest.email } } });

    await signInWithSession({ app, screen, browser }, ownerApi);
    await app.open('/app/agenda');
    await screen.getByRole('navigation', 'Visões do escritório').getByRole('link', 'Atividade').tap();
    const list = screen.getByRole('list', 'Atividade do escritório');
    await expect(list.getByText(`${owner.name} criou um convite para ${guest.name}`)).toBeVisible();
    await expect(list.getByText('Acessos · Concluído')).toBeVisible();
    await expect(screen.getByText(stranger.name, { exact: false })).toHaveCount(0);

    await screen.getByRole('navigation', 'Filtrar atividade').getByRole('link', 'Google').tap();
    await expect(screen.getByText('Nada registrado com este filtro ainda.')).toBeVisible();
    await screen.getByRole('navigation', 'Filtrar atividade').getByRole('link', 'Acessos').tap();
    await expect(screen.getByRole('list', 'Atividade do escritório').getByText(`${owner.name} criou um convite para ${guest.name}`)).toBeVisible();

    await screen.getByRole('navigation', 'Filtrar atividade').getByRole('link', 'Tudo').focus();
    await browser.keyboard.press('Enter');
    await expect(screen.getByRole('navigation', 'Filtrar atividade').getByRole('link', 'Tudo')).toHaveAttribute('aria-current', 'page');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot(`atividade-escritorio-${viewport.name}`);
  });
}
