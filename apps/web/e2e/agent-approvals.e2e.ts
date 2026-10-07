import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { honorarioDetailDto } from '../src/lib/honorarios/contracts';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { setConversationMessages } from './support/seed';
import { signInWithSession } from './support/sign-in';

// Agent capabilities that move money wait for a person: the card in the chat is the only way
// through, from the keyboard on desktop and by touch on a phone.
test('ações financeiras do agente esperam confirmação no chat, e o agente consulta a ajuda sem acessar Integrações', async ({ app, screen, browser }) => {
  const account = uniqueAccount('Agente');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const detail = async (path: string, json: unknown) => honorarioDetailDto.parse(await api.json(path, { json }));
  async function propose(capability: string, input: Record<string, unknown>) {
    const response = await api.request(`/api/capabilities/${capability}`, { json: { ...input, idempotencyKey: randomUUID() } });
    const body = await response.json() as { code: string; error: string };
    expect({ status: response.status, code: body.code }).toMatchObject({ code: 'APPROVAL_REQUIRED' });
    return body.error.match(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/)![0];
  }
  const { client } = await api.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Simons de teste', stage: 'active' } });
  const created = await detail('/api/capabilities/k5_honorarios_create', {
    clientId: client.id, title: 'Contrato sintético', installments: [{ amountCents: 5000, dueOn: '2024-01-10' }, { amountCents: 5000, dueOn: '2024-02-10' }], idempotencyKey: randomUUID(),
  });
  const paid = await detail('/api/capabilities/k5_honorarios_receive', {
    installmentId: created.installments[1].id, amountCents: 5000, receivedOn: '2024-03-01', method: 'pix', idempotencyKey: randomUUID(),
  });
  expect(paid.installments.map(installment => installment.status)).toEqual(['pending', 'received']);
  const { conversation } = await api.json<{ conversation: { id: string } }>('/api/conversations', { json: { title: 'Confirmações de validação' } });
  // The approval card, as the agent's reply leaves it in the conversation.
  const showProposal = async (approvalId: string, capability: string, summary: string) => {
    await setConversationMessages(account.email, conversation.id, [{ id: randomUUID(), role: 'assistant', parts: [
      { type: 'text', text: 'Confira a ação solicitada.' },
      { type: 'data-approval', id: approvalId, data: { approvalId, capability, summary, state: 'pending' } },
    ] }]);
    // The Lume's link names the conversation; it opens in the panel beside Início.
    await app.open(`/app/agents?conversationId=${conversation.id}`);
    await expect(screen.getByRole('group', 'Confirmação')).toBeVisible();
  };
  await signInWithSession({ app, screen, browser }, api);

  const reversal = await propose('k5_honorarios_reverse', { receiptId: paid.receipts[0].id, reason: 'Lançamento de teste duplicado' });
  await showProposal(reversal, 'k5_honorarios_reverse', 'Estornar R$ 50,00 da parcela 2 de Simons de teste “Contrato sintético”. Motivo: Lançamento de teste duplicado');
  const confirm = screen.getByRole('button', 'Confirmar');
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('group', 'Confirmação')).toContainText('Confirmado');
  expect((await detail('/api/honorarios/get', { agreementId: created.agreement.id })).agreement.receivedCents).toBe(0);
  await browser.reload();
  await expect(screen.getByRole('button', 'Confirmar')).toHaveCount(0);

  const cancellation = await propose('k5_honorarios_cancel', { agreementId: created.agreement.id, reason: 'Teste de cancelamento' });
  await browser.setViewport({ width: 390, height: 844 });
  await showProposal(cancellation, 'k5_honorarios_cancel', 'Cancelar o honorário “Contrato sintético” de Simons de teste e suas parcelas.\nMotivo: Teste de cancelamento');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Cancelar').tap();
  await expect(screen.getByRole('group', 'Confirmação')).toContainText('Cancelado');
  expect((await detail('/api/honorarios/get', { agreementId: created.agreement.id })).agreement.status).toBe('active');

  const help = await api.json<{ sources: { title: string }[] }>('/api/capabilities/k5_help_search', { json: { query: 'registrar recebimento honorários' } });
  expect(help.sources.some(source => /recebimento/.test(source.title))).toBe(true);
  expect((await api.request('/api/capabilities/k5_google_save_policy', { json: {} })).status).toBe(403);
});
