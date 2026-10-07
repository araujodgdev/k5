import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

const status = (path: string) => fetch(path, { method: path.endsWith('/list') ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: path.endsWith('/list') ? '{}' : undefined }).then(response => response.status);

test('o portal do cliente: convite, conta sem escritório, PDF e cobrança publicados, comprovante e revogação', { tags: ['pdf'] }, async ({ app, screen, browser, sql }) => {
  const office = uniqueAccount('Ana');
  const officeApi = await new ApiSession(app.baseUrl!).signIn(office);
  const clientEmail = `maria-${randomUUID().slice(0, 8)}@client.test`;
  const clientPassword = `Cliente!${randomUUID()}`;
  const { client } = await officeApi.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Maria Portal', email: clientEmail, stage: 'active' } });
  const { artifact } = await officeApi.json<{ artifact: { id: string } }>('/api/artifacts', { json: { title: 'Contrato Portal', content: '# Contrato\n\nVersão humana publicada para o cliente.' } });
  const artifactId = artifact.id;
  const clientPage = `/app/agenda/clients/${client.id}`;

  await signInWithSession({ app, screen, browser }, officeApi);
  await app.open(clientPage);
  await screen.getByRole('button', 'Convidar cliente').tap();
  await expect(screen.getByLabel('Link do convite')).toBeVisible();
  const invitation = await screen.getByLabel('Link do convite').inputValue();
  expect(invitation).toMatch(/\/client\/invite\//);
  await screen.getByLabel('Publicar documento do Lume em PDF').selectOption({ value: artifactId });
  await screen.getByRole('button', 'Publicar versão em PDF').tap();
  await expect(screen.getByText('A versão selecionada foi publicada em PDF para este cliente.')).toBeVisible({ timeout: 90_000 });
  const { installments } = await officeApi.json<{ installments: { id: string }[] }>('/api/honorarios/create', {
    json: { clientId: client.id, title: 'Honorários Portal', notes: 'Nota privada', installments: [{ amountCents: 50000, dueOn: '2035-01-10' }], idempotencyKey: randomUUID() },
  });
  await officeApi.json('/api/honorarios/charge-prepare', { json: { installmentId: installments[0].id, version: 0, pixKey: 'pix@office.test', idempotencyKey: randomUUID() } });
  await officeApi.json('/api/client-portal/manage', { json: { operation: 'publish-charge', data: { clientId: client.id, installmentId: installments[0].id, version: 1 } } });

  await app.clearState();
  await app.open(invitation);
  await screen.getByLabel('Nova senha').fill(clientPassword);
  await screen.getByLabel('Confirmar nova senha').fill(clientPassword);
  await screen.getByRole('checkbox', /Li e aceito os Termos de uso/).check();
  await screen.getByRole('button', 'Criar acesso ao portal').tap();
  await expect(screen.getByRole('heading', 'Portal do cliente')).toBeVisible();
  const clientCookies = await browser.cookies();
  expect(clientCookies.some(cookie => cookie.name.includes('session_token'))).toBe(true);
  await expect(screen.getByRole('link', 'Contrato Portal.pdf')).toBeVisible();
  await expect(screen.getByRole('link', 'Baixar cobrança em PDF')).toBeVisible();
  expect(await browser.evaluate(status, '/api/honorarios/list')).toBe(403);
  expect(await sql(`SELECT u."accountKind" AS kind, (SELECT count(*)::int FROM office_member m WHERE m.user_id=u.id) AS memberships FROM "user" u WHERE u.email=$1`, [clientEmail]))
    .toEqual([{ kind: 'client', memberships: 0 }]);
  const fileUrl = (await screen.getByRole('link', 'Contrato Portal.pdf').getAttribute('href'))!;
  expect(await browser.evaluate(status, fileUrl)).toBe(200);
  await screen.getByRole('button', 'Enviar comprovante desta parcela').tap();
  await screen.getByLabel('Arquivo para enviar').setInputFiles(['e2e/fixtures/comprovante.pdf']);
  await screen.getByRole('button', 'Enviar arquivo ao escritório').tap();
  await expect(screen.getByText('Comprovante enviado. O escritório fará a conferência do pagamento.')).toBeVisible();
  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  await app.clearState();
  await browser.setViewport({ width: 1280, height: 844 });
  await signInWithSession({ app, screen, browser }, officeApi);
  await app.open(clientPage);
  await screen.getByRole('button', 'Atualizar portal').tap();
  await expect(screen.getByRole('link', 'comprovante.pdf')).toBeVisible();
  const managed = await officeApi.json<{ access: { id: string } | null }>(`/api/client-portal/manage?clientId=${client.id}`);
  expect(managed.access).not.toBeNull();
  await screen.getByRole('button', 'Revogar acesso ao portal').tap();
  await expect(screen.getByText('Acesso e convite revogados.')).toBeVisible();
  const cookie = clientCookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  for (const path of [fileUrl, `/api/client-portal/${managed.access!.id}`]) {
    expect((await fetch(new URL(path, app.baseUrl), { headers: { cookie } })).status, path).toBe(404);
  }
  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByRole('heading', 'Portal do cliente').scrollIntoView();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
