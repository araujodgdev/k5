import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

// Without an Asaas account the suite proves the screens and the refusals that never reach Asaas;
// connection, charges and the webhook run against a simulated Asaas in tests/asaas.test.ts.
test('o Asaas aparece em Integrações, recusa uma chave inválida e orienta a cobrança da parcela', async ({ app, screen, browser }) => {
  const account = uniqueAccount('Asaas');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const { client } = await api.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Maria Cliente', stage: 'active' } });
  const detail = await api.json<{ agreement: { id: string } }>('/api/honorarios/create', {
    json: { clientId: client.id, title: 'Contrato Asaas', installments: [{ amountCents: 50000, dueOn: '2035-01-10' }], idempotencyKey: randomUUID() },
  });
  await signInWithSession({ app, screen, browser }, api);

  await app.open('/app/integrations');
  await expect(screen.getByRole('heading', 'Asaas')).toBeVisible();
  await expect(screen.getByText('Nenhuma conta do Asaas conectada.')).toBeVisible();
  await screen.getByLabel('Chave de API do Asaas').fill('chave-sem-prefixo');
  await screen.getByRole('button', 'Verificar e conectar').tap();
  await expect(screen.getByRole('alert')).toContainText('$aact_');
  expect((await api.request('/api/asaas/connection')).status).toBe(200);
  expect((await new ApiSession(app.baseUrl!).request('/api/asaas/connection')).status).toBe(401);

  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByLabel('Chave de API do Asaas').focus();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  await browser.setViewport({ width: 1280, height: 844 });
  await app.open(`/app/honorarios?agreementId=${detail.agreement.id}`);
  await screen.getByRole('button', 'Preparar cobrança da parcela 1', { exact: false }).focus();
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('heading', 'Cobrança pelo Asaas')).toBeVisible();
  await expect(screen.getByRole('link', 'conecte a conta do Asaas em Integrações')).toHaveAttribute('href', '/app/integrations');
  await expect(screen.getByLabel('Chave PIX')).toBeVisible();
});
