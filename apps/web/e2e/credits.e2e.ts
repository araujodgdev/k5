import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally, test } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

test('um escritório novo vê os créditos iniciais e o extrato no Plano, no desktop e no celular', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Créditos');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  // Only the listed packages can be bought; anything else is refused before reaching the payment provider.
  expect((await api.request('/api/billing/credits', { json: { credits: 123 } })).status).toBe(400);
  await signInWithSession({ app, screen, browser }, api);

  await app.open('/app/billing');
  const credits = screen.getByRole('region', 'Créditos');
  await expect(credits.getByText('850 créditos', { exact: true })).toBeVisible();
  await expect(credits.getByText('O plano inclui 850 créditos por mês', { exact: false })).toBeVisible();
  const statement = credits.getByRole('table', 'Últimas movimentações de créditos');
  await expect(statement.getByRole('cell', 'Créditos iniciais')).toBeVisible();
  await expect(statement.getByRole('cell', '+850')).toBeVisible();

  const [entry] = await sql<{ amount: string; balance: string }>(`SELECT e.amount::text AS amount, a.balance::text AS balance
    FROM credit_entry e JOIN credit_account a ON a.office_id = e.office_id JOIN office_member m ON m.office_id = e.office_id
    JOIN "user" u ON u.id = m.user_id WHERE lower(u.email) = lower($1) AND e.kind = 'initial'`, [account.email]);
  expect(entry).toEqual({ amount: '850000', balance: '850000' });

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/billing');
  await expect(screen.getByRole('region', 'Créditos').getByText('850 créditos', { exact: true })).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
