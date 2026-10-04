import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

// Perfil → Seus dados: the export downloads a ZIP of the office, and deleting the account is
// scheduled with the password, shows its date and can be cancelled. Its own account, since it
// schedules a deletion.
test('seus dados: exportar o escritório e agendar e cancelar a exclusão', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Dados');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  await signInWithSession({ app, screen, browser }, api);
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/profile');
  await expect(screen.getByRole('heading', 'Exportar dados')).toBeVisible();
  await expect(screen.getByRole('link', 'Exportar dados')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  const exported = await api.request('/api/office/export');
  expect(exported.status).toBe(200);
  expect(exported.headers.get('content-type')).toBe('application/zip');
  const zip = new Uint8Array(await exported.arrayBuffer());
  expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  await screen.getByRole('button', 'Excluir conta').tap();
  await screen.getByRole('button', 'Agendar exclusão').tap();
  await expect(screen.getByText('Informe sua senha atual.')).toBeVisible();
  await screen.getByLabel('Senha atual').last().fill('senha-errada');
  await screen.getByRole('button', 'Agendar exclusão').tap();
  await expect(screen.getByText('Senha atual incorreta.')).toBeVisible();
  await screen.getByLabel('Senha atual').last().fill(account.password);
  await screen.getByRole('button', 'Agendar exclusão').tap();
  await expect(screen.getByText(/Exclusão agendada para/)).toBeVisible();
  expect(await sql(`SELECT r.status FROM office_deletion_request r JOIN office_member m ON m.office_id = r.office_id JOIN "user" u ON u.id = m.user_id WHERE u.email = $1`, [account.email]))
    .toEqual([{ status: 'scheduled' }]);

  await app.open('/app/profile');
  await expect(screen.getByText(/Exclusão agendada para/)).toBeVisible();
  await screen.getByRole('button', 'Cancelar exclusão').tap();
  await expect(screen.getByRole('button', 'Excluir conta')).toBeVisible();
  expect(await sql(`SELECT r.status FROM office_deletion_request r JOIN office_member m ON m.office_id = r.office_id JOIN "user" u ON u.id = m.user_id WHERE u.email = $1`, [account.email]))
    .toEqual([{ status: 'cancelled' }]);
});
