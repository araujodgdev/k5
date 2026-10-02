import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { extractText } from 'unpdf';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

const pdfText = async (response: Response) => {
  expect(response.status).toBe(200);
  return (await extractText(new Uint8Array(await response.arrayBuffer()), { mergePages: true })).text;
};

test('a cobrança de uma parcela com PIX e boleto gera o PDF, registra o envio e trava depois da quitação', { tags: ['pdf'] }, async ({ app, screen, browser }) => {
  const account = uniqueAccount('Ana');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const { client } = await api.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Maria Cliente', stage: 'active' } });
  const detail = await api.json<{ agreement: { id: string }; installments: { id: string }[] }>('/api/honorarios/create', {
    json: { clientId: client.id, title: 'Contrato de teste', installments: [{ amountCents: 125000, dueOn: '2035-01-10' }], idempotencyKey: randomUUID() },
  });
  const installmentId = detail.installments[0].id;
  await signInWithSession({ app, screen, browser }, api);

  await app.open(`/app/honorarios?agreementId=${detail.agreement.id}`);
  await screen.getByRole('button', 'Preparar cobrança da parcela 1', { exact: false }).focus();
  await browser.keyboard.press('Enter');
  await screen.getByLabel('Chave PIX').fill('financeiro@example.test');
  await screen.getByLabel('Instruções de pagamento').fill('Titular Ana. Confira os dados antes de pagar.');
  await screen.getByLabel('Boleto em PDF (até 10 MB)').setInputFiles(['e2e/fixtures/boleto-teste.pdf']);
  await expect(screen.getByText('Boleto anexado ao Cofre.', { exact: false })).toBeVisible();
  await screen.getByRole('button', 'Salvar cobrança').tap();
  const download = screen.getByRole('button', 'Baixar PDF');
  await expect(download).toBeEnabled();
  const { suggestedFilename } = await browser.waitForDownload(() => download.tap(), { timeout: 120_000 });
  expect(suggestedFilename).toBe('cobranca.pdf');
  // The download's path is relative to the attempt's artifacts; read the same PDF the button fetched.
  const text = await pdfText(await api.request(`/api/honorarios/charges/${installmentId}/pdf?version=1`));
  expect(text).toMatch(/Maria Cliente/);
  expect(text).toMatch(/1\.250,00/);
  expect(text).toMatch(/financeiro@example\.test/);
  await screen.getByRole('button', 'Registrar envio realizado').tap();
  await expect(screen.getByText('Envio registrado no histórico.')).toBeVisible();

  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByLabel('Chave PIX').focus();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);

  // An outdated version, an anonymous request and a settled installment never get the PDF.
  expect((await api.request(`/api/honorarios/charges/${installmentId}/pdf?version=0`)).status).toBe(409);
  expect((await new ApiSession(app.baseUrl!).request(`/api/honorarios/charges/${installmentId}/pdf?version=1`)).status).toBe(401);
  await api.json('/api/honorarios/receive', { json: { installmentId, amountCents: 125000, receivedOn: '2026-01-01', method: 'pix', idempotencyKey: randomUUID() } });
  expect((await api.request(`/api/honorarios/charges/${installmentId}/pdf?version=1`)).status).toBe(409);
});
