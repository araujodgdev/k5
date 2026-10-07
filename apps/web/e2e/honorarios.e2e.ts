import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { honorarioDetailDto, honorariosListDto } from '../src/lib/honorarios/contracts';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

// The ledger through the screen: every write here goes through the UI and is read back from the
// API. Roles, privacy across offices and concurrency are covered in tests/honorarios.test.ts.
test('honorários pela interface: parcelamento, baixas integral e parcial, correção, abas, cancelamento, erro e celular', { timeout: 360_000 }, async ({ app, screen, browser }) => {
  const account = uniqueAccount('Financeiro');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const list = async () => honorariosListDto.parse(await api.json('/api/honorarios/list', { json: {} }));
  const get = async (agreementId: string) => honorarioDetailDto.parse(await api.json('/api/honorarios/get', { json: { agreementId } }));
  const { client } = await api.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Cliente de validação', stage: 'active', idempotencyKey: randomUUID() } });
  const { case: caseRecord } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Caso de validação de honorários', idempotencyKey: randomUUID() } });
  // Client and case are searchable pickers: the trigger opens a list of buttons, one per option.
  const pick = async (field: string, option: string) => {
    await screen.getByRole('dialog').getByRole('button', field).tap();
    await screen.getByRole('button', option).tap();
    await expect(screen.getByRole('dialog').getByRole('button', field)).toHaveText(option);
  };
  const noOverflow = async (where: string) => expect(await browser.evaluate(overflowsHorizontally), where).toBe(false);
  await signInWithSession({ app, screen, browser }, api);

  await app.open('/app/honorarios');
  await expect(screen.getByRole('heading', 'Honorários')).toBeAttached();
  await expect(screen.getByText('Nenhuma parcela a receber para estes filtros.')).toBeVisible();
  expect((await list()).summary).toEqual({ totalCents: 0, receivedCents: 0, pendingCents: 0, overdueCents: 0 });

  // Three monthly installments from January 31st fall on each month's last day.
  await screen.getByRole('button', 'Novo honorário').focus();
  await browser.keyboard.press('Enter');
  const dialog = screen.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await pick('Cliente (obrigatório)', 'Cliente de validação');
  await pick('Caso (opcional)', 'Caso de validação de honorários');
  await screen.getByLabel('Descrição').fill('Acompanhamento processual');
  await screen.getByLabel('Valor total (R$)').fill('3.000,00');
  await screen.getByLabel('Número de parcelas').fill('3');
  await screen.getByLabel('Primeiro vencimento').fill('2026-01-31');
  await expect(screen.getByLabel('Parcela 2: vencimento')).toHaveValue('2026-02-28');
  await expect(screen.getByLabel('Parcela 3: vencimento')).toHaveValue('2026-03-31');
  await noOverflow('cadastro');
  await screen.getByRole('button', 'Cadastrar honorário').tap();
  await expect(dialog).toBeHidden();
  const listed = await list();
  expect(listed.total).toBe(3);
  const created = await get(listed.installments[0].agreementId);
  expect(created.agreement).toMatchObject({ totalCents: 300000, caseId: caseRecord.id });
  expect(created.installments.map(row => row.dueOn)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  const agreement = screen.getByRole('button', /^Abrir Acompanhamento processual,/);
  await expect(agreement.first()).toBeVisible();
  await agreement.first().tap();
  await screen.getByRole('button', 'Registrar recebimento da parcela 1').tap();
  await screen.getByLabel('Valor recebido (R$)').fill('1.000,00');
  await screen.getByRole('button', 'Salvar recebimento').tap();
  await expect(screen.getByRole('button', 'Registrar recebimento da parcela 1')).toHaveCount(0);
  await screen.getByRole('button', 'Registrar recebimento da parcela 2').tap();
  await screen.getByLabel('Valor recebido (R$)').fill('400,00');
  await screen.getByRole('button', 'Salvar recebimento').tap();
  const undoPartial = screen.getByRole('button', /Desfazer recebimento de R\$\s*400,00/);
  await expect(undoPartial).toBeVisible();
  expect((await get(created.agreement.id)).agreement).toMatchObject({ receivedCents: 140000, pendingCents: 160000 });
  await undoPartial.tap();
  await screen.getByLabel('Motivo da correção').fill('Baixa registrada por engano na validação.');
  await screen.getByRole('button', 'Desfazer registro').tap();
  await expect(screen.getByText(/Registro desfeito por/)).toBeVisible();
  await expect(undoPartial).toHaveCount(0);
  // A correction keeps the history: the receipt stays, paired with its reversal.
  const reversed = await get(created.agreement.id);
  expect(reversed.agreement).toMatchObject({ receivedCents: 100000, pendingCents: 200000 });
  expect(reversed.receipts.length).toBe(2);
  expect(reversed.receipts.filter(row => row.reversal).length).toBe(1);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog')).toBeHidden();

  // The situation is a filter menu; its chip names the current one.
  const situation = async (current: string, next: string) => {
    await screen.getByRole('button', `Situação: ${current}`).tap();
    await screen.getByRole('menuitemradio', next).tap();
  };
  await situation('A receber', 'Recebidas');
  await expect(agreement).toHaveCount(1);
  await situation('Recebidas', 'A receber');
  await expect(agreement).toHaveCount(2);

  const toCancel = honorarioDetailDto.parse(await api.json('/api/honorarios/create', {
    json: { clientId: client.id, title: 'Cadastro para cancelar', notes: '', installments: [{ amountCents: 9000, dueOn: '2026-01-01' }], idempotencyKey: randomUUID() },
  }));
  await browser.reload();
  await screen.getByRole('button', /^Abrir Cadastro para cancelar,/).tap();
  await screen.getByRole('button', 'Cancelar honorário').tap();
  await screen.getByLabel('Motivo do cancelamento').fill('Cadastro incorreto na verificação.');
  await screen.getByRole('button', 'Confirmar cancelamento').tap();
  await expect(screen.getByText('Honorário cancelado. O histórico permanece disponível.')).toBeVisible();
  expect((await get(toCancel.agreement.id)).agreement.status).toBe('cancelled');
  await browser.keyboard.press('Escape');
  await situation('A receber', 'Canceladas');
  await expect(screen.getByRole('button', /^Abrir Cadastro para cancelar,/)).toBeVisible();

  // Loading, then a failed query, then recovery.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await browser.route('**/api/honorarios/list', async route => {
    await held;
    await route.fulfill({ status: 503, json: { error: 'Falha de consulta simulada para validação.' } });
  });
  await browser.goto('/app/honorarios', { waitUntil: 'domcontentloaded' });
  // The route's loading screen and the list's own state can show the text at the same time.
  await expect(screen.getByRole('status', 'Carregando honorários').first()).toBeVisible();
  release();
  await expect(screen.getByRole('alert').filter({ hasText: 'Falha de consulta simulada' })).toBeVisible();
  await browser.unroute('**/api/honorarios/list');
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(agreement).toHaveCount(2);
  await noOverflow('lista desktop');

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/app/honorarios');
  await expect(agreement.first()).toBeVisible();
  await noOverflow('lista celular');
  await screen.getByRole('button', /^Mais opções/).tap();
  await expect(screen.getByRole('dialog', 'Mais opções').getByRole('link', 'Honorários')).toBeVisible();
  await browser.keyboard.press('Escape');
  const create = screen.getByRole('button', 'Novo honorário');
  await create.tap();
  await expect(screen.getByLabel('Descrição')).toBeVisible();
  await browser.keyboard.press('Escape');
  await expect(create).toBeFocused();
  await create.tap();
  await pick('Cliente (obrigatório)', 'Cliente de validação');
  await screen.getByLabel('Descrição').fill('Cadastro pelo celular');
  await screen.getByLabel('Valor total (R$)').fill('45,50');
  await screen.getByLabel('Número de parcelas').fill('2');
  await screen.getByLabel('Primeiro vencimento').fill('2026-01-31');
  await screen.getByRole('button', 'Cadastrar honorário').scrollIntoView();
  await noOverflow('cadastro celular');
  await screen.getByRole('button', 'Cadastrar honorário').tap();
  await expect(screen.getByRole('dialog')).toBeHidden();
  await screen.getByRole('button', /^Abrir Cadastro pelo celular,/).first().tap();
  await screen.getByRole('button', 'Cancelar honorário').tap();
  await screen.getByLabel('Motivo do cancelamento').fill('Conferência do formulário no celular.');
  await screen.getByRole('button', 'Confirmar cancelamento').tap();
  await expect(screen.getByText('Honorário cancelado. O histórico permanece disponível.')).toBeVisible();
});
