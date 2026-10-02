import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

type Folder = { id: string; name: string; visibility: string };
const folderList = (api: ApiSession, caseId: string, parentId?: string) =>
  api.json<{ folders: Folder[] }>(`/api/vault/folders?caseId=${caseId}${parentId ? `&parentId=${parentId}` : ''}`);

for (const viewport of [{ name: 'desktop', width: 1280, height: 844 }, { name: 'celular', width: 390, height: 844 }]) {
  test(`associados e pastas: convite, colaboração e revogação no ${viewport.name}`, { timeout: 300_000 }, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: viewport.width, height: viewport.height });
    const owner = uniqueAccount('Dona'), guest = uniqueAccount('Parceira'), third = uniqueAccount('Terceira');
    const ownerApi = await new ApiSession(app.baseUrl!).signIn(owner);
    const guestApi = await new ApiSession(app.baseUrl!).signIn(guest);
    const thirdApi = await new ApiSession(app.baseUrl!).signIn(third);
    const { user: guestUser } = await guestApi.json<{ user: { id: string } }>('/api/auth/get-session');
    const { user: thirdUser } = await thirdApi.json<{ user: { id: string } }>('/api/auth/get-session');
    const { case: record } = await ownerApi.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Caso de colaboração' } });
    const casePath = `/app/vault/cases/${record.id}`;

    await signInWithSession({ app, screen, browser }, ownerApi);
    await app.open('/app/agenda?view=associates');
    await expect(screen.getByText('Nenhum associado ainda. Convide um advogado pelo e-mail.')).toBeVisible();
    await screen.getByRole('button', 'Convidar associado').tap();
    await screen.getByLabel('E-mail do advogado').fill(guest.email);
    await screen.getByRole('button', 'Criar convite').tap();
    await expect(screen.getByLabel('Link do convite')).toBeVisible();
    const invitationUrl = await screen.getByLabel('Link do convite').inputValue();
    await browser.keyboard.press('Tab');
    expect(await browser.evaluate(() => document.activeElement !== document.body)).toBe(true);
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

    const invitation = await ownerApi.json<{ id: string }>('/api/collaboration', { json: { action: 'invite', invitation: { email: third.email } } });
    await thirdApi.json('/api/collaboration', { json: { action: 'respond', id: invitation.id, accept: true } });
    await app.clearState();
    await signInWithSession({ app, screen, browser }, guestApi);
    await app.open('/app/agenda?view=invites');
    await screen.getByRole('button', 'Aceitar convite').tap();
    await expect(screen.getByRole('status').filter({ hasText: 'Convite aceito' })).toBeVisible();
    expect((await guestApi.request(`/api/vault/documents?caseId=${record.id}`)).status).toBe(404);
    await app.open('/app/agenda?view=associates');
    await expect(screen.getByText(owner.email)).toBeVisible();
    await expect(screen.getByLabel('Escritório ativo')).toHaveCount(0);

    await app.clearState();
    await signInWithSession({ app, screen, browser }, ownerApi);
    await app.open(casePath);
    await screen.getByRole('button', 'Participantes', { visible: true }).tap();
    await screen.getByLabel('Incluir associado').selectOption({ value: guestUser.id });
    await screen.getByRole('button', 'Incluir no caso').tap();
    await expect(screen.getByRole('status').filter({ hasText: 'Participante incluído' })).toBeVisible();
    await ownerApi.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: thirdUser.id, add: true } });
    expect((await guestApi.request('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: thirdUser.id, add: true } })).status).toBe(403);

    await app.clearState();
    await signInWithSession({ app, screen, browser }, guestApi);
    await app.open(casePath);
    await expect(screen.getByRole('button', 'Enviar arquivos', { visible: true })).toBeVisible();
    await browser.locator('input[type=file]').first().setInputFiles(['e2e/fixtures/colaboracao-validacao.txt']);
    await expect(screen.getByText('colaboracao-validacao.txt').first()).toBeVisible();
    await screen.getByRole('button', 'Nova pasta', { visible: true }).tap();
    await screen.getByLabel('Nome da pasta').fill('Reservada');
    await screen.getByLabel('Quem vê a pasta', { exact: true }).selectOption({ value: 'private' });
    await screen.getByRole('button', 'Criar pasta').tap();
    await expect(screen.getByRole('link', 'Reservada', { exact: false }).first()).toBeVisible();
    const privateFolder = (await folderList(guestApi, record.id)).folders.find(folder => folder.name === 'Reservada');
    expect(privateFolder).toBeDefined();
    if (!privateFolder) throw new Error('A pasta criada não apareceu para sua criadora.');
    await screen.getByRole('link', 'Reservada', { exact: false }).first().tap();
    await expect(screen.getByRole('navigation', 'Trilha').getByRole('link', 'Reservada', { exact: true })).toBeVisible();
    await browser.locator('input[type=file]').first().setInputFiles(['e2e/fixtures/colaboracao-privada.txt']);
    await expect(screen.getByText('colaboracao-privada.txt').first()).toBeVisible();
    const { documents } = await guestApi.json<{ documents: { id: string }[] }>(`/api/vault/documents?caseId=${record.id}&folderId=${privateFolder.id}`);
    expect(documents.length).toBe(1);
    expect((await guestApi.request(`/api/vault/documents/${documents[0].id}/download`)).status).toBe(200);
    expect((await ownerApi.request(`/api/vault/documents/${documents[0].id}/download`)).status).toBe(404);
    expect((await folderList(ownerApi, record.id)).folders.map(folder => folder.id)).not.toContain(privateFolder.id);
    expect((await folderList(thirdApi, record.id)).folders.map(folder => folder.id)).not.toContain(privateFolder.id);
    await guestApi.json('/api/vault/folders', { json: { caseId: record.id, parentId: privateFolder.id, name: 'Subpasta pública', visibility: 'public' } });
    expect((await ownerApi.request(`/api/vault/folders?caseId=${record.id}&parentId=${privateFolder.id}`)).status).toBe(404);

    await app.open(casePath);
    await screen.getByRole('button', 'Nova pasta', { visible: true }).tap();
    await screen.getByLabel('Nome da pasta').fill('Escolhidas');
    await screen.getByLabel('Quem vê a pasta', { exact: true }).selectOption({ value: 'restricted' });
    await screen.getByRole('checkbox', new RegExp(owner.name)).check();
    await screen.getByRole('button', 'Criar pasta').tap();
    await expect(screen.getByRole('link', 'Escolhidas', { exact: false }).first()).toBeVisible();
    const restricted = (await folderList(guestApi, record.id)).folders.find(folder => folder.name === 'Escolhidas');
    expect(restricted).toBeDefined();
    if (!restricted) throw new Error('A pasta restrita não apareceu.');
    expect((await folderList(ownerApi, record.id)).folders.map(folder => folder.id)).toContain(restricted.id);
    expect((await folderList(thirdApi, record.id)).folders.map(folder => folder.id)).not.toContain(restricted.id);
    expect((await ownerApi.request(`/api/vault/folders/${restricted.id}`, { method: 'PATCH', json: { visibility: 'public' } })).status).toBe(403);

    await screen.getByRole('button', 'Quem vê a pasta Reservada').tap();
    await expect(screen.getByRole('dialog')).toBeVisible();
    await browser.keyboard.press('Tab');
    expect(await browser.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await screen.getByLabel('Quem vê a pasta', { exact: true }).selectOption({ value: 'public' });
    await screen.getByRole('button', 'Salvar acesso').tap();
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    await expect(screen.getByText('Privada · 1 arquivo', { exact: true })).toHaveCount(0);
    await screen.getByRole('button', 'Quem vê a pasta Reservada').tap();
    await expect(screen.getByLabel('Quem vê a pasta', { exact: true })).toHaveValue('public');
    await browser.keyboard.press('Escape');
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    expect((await folderList(thirdApi, record.id)).folders.map(folder => folder.id)).toContain(privateFolder.id);
    expect((await ownerApi.request(`/api/vault/documents/${documents[0].id}/download`)).status).toBe(200);
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot(`colaboracao-${viewport.name}`);

    // Removing the association revokes participation both ways, with old files preserved.
    await ownerApi.json('/api/collaboration', { json: { action: 'associate', userId: guestUser.id } });
    expect((await guestApi.request(`/api/vault/documents/${documents[0].id}/download`)).status).toBe(404);
    expect((await guestApi.request(`/api/vault/documents?caseId=${record.id}`)).status).toBe(404);
    await app.open(invitationUrl);
    await expect(screen.getByText('Este convite já foi respondido, cancelado ou expirou.')).toBeVisible();
    expect((await guestApi.request('/api/collaboration', { json: { action: 'invite', invitation: { email: owner.email } }, origin: 'https://outra-origem.example' })).status).toBe(403);

    await browser.route('**/api/collaboration', route => route.fulfill({ status: 503, json: { error: 'Falha temporária de validação.' } }));
    await app.open('/app/agenda?view=invites');
    await expect(screen.getByRole('alert').filter({ hasText: 'Falha temporária' })).toBeVisible();
    await browser.unroute('**/api/collaboration');
    await screen.getByRole('button', 'Tentar novamente').tap();
    await expect(screen.getByText('Nenhum convite pendente para sua conta.')).toBeVisible();
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  });
}
