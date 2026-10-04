import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import * as contract from './contracts';
import { asaasCredential } from './service';
import { AsaasProviderError, asaasRequest } from './provider';

/** Longer than a request to Asaas can take (15 s), so an expired lease means the attempt is over. */
const LEASE_SECONDS = 60;
const missing = () => new CapabilityError('NOT_FOUND', 'Parcela não encontrada.');
const conflict = (message: string) => new CapabilityError('CONFLICT', message);
const notConnected = () => conflict('Conecte a conta do Asaas em Integrações para emitir cobranças.');
const todayInSaoPaulo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const asaasReference = (paymentId: string) => `lume:${paymentId}`;

const paymentColumns = `p.id,p.state,p.provider_status AS "providerStatus",p.amount_cents::int AS "amountCents",p.due_on AS "dueOn",
  p.invoice_url AS "invoiceUrl",p.failure,p.environment,p.created_at AS "createdAt",
  (p.state='creating' AND (p.lease_until IS NULL OR p.lease_until<CURRENT_TIMESTAMP)) AS unconfirmed`;

type Installment = { clientId: string; clientName: string; clientEmail: string | null; title: string; number: number; installmentCount: number;
  dueOn: string; pendingCents: number; cancelled: boolean };

/** The installment's own agreement, owned by this person in the active office; optionally locked for a write. */
async function installment(tx: Pick<Transaction, 'prepare'>, context: WorkspaceContext, installmentId: string, lock = false): Promise<Installment> {
  const row = await tx.prepare(`SELECT a.client_id AS "clientId",c.name AS "clientName",c.email AS "clientEmail",a.title,i.number,
    (SELECT COUNT(*)::int FROM honorario_installment n WHERE n.office_id=i.office_id AND n.agreement_id=i.agreement_id) AS "installmentCount",
    i.due_on AS "dueOn",(a.cancelled_at IS NOT NULL) AS cancelled,
    (i.amount_cents-COALESCE((SELECT SUM(r.amount_cents) FROM honorario_receipt r WHERE r.office_id=i.office_id AND r.installment_id=i.id
      AND NOT EXISTS (SELECT 1 FROM honorario_receipt_reversal v WHERE v.office_id=r.office_id AND v.receipt_id=r.id)),0))::bigint AS "pendingCents"
    FROM honorario_installment i JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
    JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
    WHERE i.office_id=? AND i.id=? AND a.created_by=? ${lock ? 'FOR UPDATE OF a' : ''}`).get<Installment>(context.officeId, installmentId, context.userId);
  if (!row) throw missing();
  return { ...row, pendingCents: Number(row.pendingCents) };
}

async function authorize(context: WorkspaceContext, write: boolean) {
  if (context.caseScope) throw missing();
  return assertCapabilityAllowed(context, write ? 'k5_honorarios_charge_prepare' : 'k5_honorarios_charge_get');
}

async function view(context: WorkspaceContext, installmentId: string): Promise<contract.AsaasCharge> {
  return withTransaction(async tx => {
    await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run();
    const current = await installment(tx, context, installmentId);
    const connection = await tx.prepare('SELECT environment,wallet_id FROM asaas_connection WHERE office_id=?')
      .get<{ environment: contract.AsaasEnvironment; wallet_id: string }>(context.officeId);
    const customer = connection && await tx.prepare('SELECT 1 FROM asaas_customer WHERE office_id=? AND client_id=? AND wallet_id=?')
      .get(context.officeId, current.clientId, connection.wallet_id);
    const payments = await tx.prepare(`SELECT ${paymentColumns} FROM asaas_payment p WHERE p.office_id=? AND p.installment_id=?
      ORDER BY p.created_at DESC,p.id DESC LIMIT 20`).all(context.officeId, installmentId);
    const history = z.array(contract.asaasPaymentDto).parse(payments);
    const today = todayInSaoPaulo();
    return contract.asaasChargeDto.parse({
      installmentId, connection: connection ? { environment: connection.environment } : null, needsDocument: Boolean(connection && !customer),
      pendingCents: current.pendingCents, chargeable: !current.cancelled && current.pendingCents > 0,
      suggestedDueOn: current.dueOn < today ? today : current.dueOn, today,
      active: history.find(payment => payment.state === 'creating' || payment.state === 'open') ?? null, history,
    });
  });
}

export async function getAsaasCharge(context: WorkspaceContext, raw: unknown) {
  context = await authorize(context, false);
  return view(context, contract.asaasChargeGetInput.parse(raw).installmentId);
}

const customerList = z.object({ data: z.array(z.object({ id: z.string().min(1).max(100) })) });
const customerCreated = z.object({ id: z.string().min(1).max(100) });

/** The client's customer in the connected account: reused, found by its reference, or created with the CPF or CNPJ. */
async function ensureCustomer(context: WorkspaceContext, credential: NonNullable<Awaited<ReturnType<typeof asaasCredential>>>,
  client: Pick<Installment, 'clientId' | 'clientName' | 'clientEmail'>, document: string | null) {
  const known = await database.prepare('SELECT customer_id FROM asaas_customer WHERE office_id=? AND client_id=? AND wallet_id=?')
    .get<{ customer_id: string }>(context.officeId, client.clientId, credential.walletId);
  if (known) return known.customer_id;
  if (!document) throw new CapabilityError('INVALID', 'Informe o CPF ou CNPJ do cliente para cadastrá-lo no Asaas.');
  const reference = `lume-cliente:${client.clientId}`;
  const found = await asaasRequest(credential.environment, credential.apiKey, 'GET', `/customers?externalReference=${encodeURIComponent(reference)}&limit=1`, customerList);
  const email = client.clientEmail && z.email().safeParse(client.clientEmail).success ? client.clientEmail : undefined;
  const customerId = found.data[0]?.id ?? (await asaasRequest(credential.environment, credential.apiKey, 'POST', '/customers', customerCreated, {
    name: client.clientName, cpfCnpj: document, externalReference: reference, ...(email ? { email } : {}),
  })).id;
  await database.prepare('INSERT INTO asaas_customer(office_id,client_id,wallet_id,customer_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
    .run(context.officeId, client.clientId, credential.walletId, customerId);
  return customerId;
}

const remotePayment = z.object({ id: z.string().min(1).max(100), status: z.string().max(60), invoiceUrl: z.string().url().startsWith('https://').max(500) });
const paymentList = z.object({ data: z.array(remotePayment) });

/** Takes the attempt of a `creating` row whose previous lease ended; null when another request holds it. */
async function lease(paymentId: string, officeId: string) {
  return database.prepare(`UPDATE asaas_payment SET lease_until=CURRENT_TIMESTAMP+(? * INTERVAL '1 second'),updated_at=CURRENT_TIMESTAMP
    WHERE office_id=? AND id=? AND state='creating' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)
    RETURNING id,environment,wallet_id AS "walletId",customer_id AS "customerId",amount_cents::int AS "amountCents",due_on AS "dueOn"`)
    .get<{ id: string; environment: contract.AsaasEnvironment; walletId: string; customerId: string; amountCents: number; dueOn: string }>(LEASE_SECONDS, officeId, paymentId);
}

async function settle(officeId: string, paymentId: string, remote: z.infer<typeof remotePayment>) {
  await database.prepare(`UPDATE asaas_payment SET state='open',provider_payment_id=?,provider_status=?,invoice_url=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE office_id=? AND id=? AND state='creating'`).run(remote.id, remote.status, remote.invoiceUrl, officeId, paymentId);
}
async function fail(officeId: string, paymentId: string, message: string) {
  await database.prepare(`UPDATE asaas_payment SET state='failed',failure=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE office_id=? AND id=? AND state='creating'`).run(message.slice(0, 500), officeId, paymentId);
}

/** Looks the attempt up in Asaas before (re)sending it, so a lost answer never becomes a second charge. */
async function attempt(context: WorkspaceContext, claimed: NonNullable<Awaited<ReturnType<typeof lease>>>, details: Installment, lookFirst: boolean) {
  const credential = await asaasCredential(context.officeId);
  if (!credential || credential.walletId !== claimed.walletId) {
    await fail(context.officeId, claimed.id, 'A conta do Asaas foi desconectada antes da criação da cobrança.');
    throw notConnected();
  }
  try {
    const reference = asaasReference(claimed.id);
    const existing = lookFirst ? (await asaasRequest(credential.environment, credential.apiKey, 'GET', `/payments?externalReference=${encodeURIComponent(reference)}&limit=1`, paymentList)).data[0] : undefined;
    const remote = existing ?? await asaasRequest(credential.environment, credential.apiKey, 'POST', '/payments', remotePayment, {
      customer: claimed.customerId, billingType: 'UNDEFINED', value: Number((claimed.amountCents / 100).toFixed(2)), dueDate: claimed.dueOn,
      description: `${details.title} — parcela ${details.number} de ${details.installmentCount}`.slice(0, 500), externalReference: reference,
    });
    await settle(context.officeId, claimed.id, remote);
  } catch (error) {
    if (!(error instanceof AsaasProviderError) || error.kind === 'unavailable') {
      // The request may still land in Asaas: keep the lease running, so the lookup happens only after it ends.
      throw new AsaasProviderError(502, 'O Asaas não confirmou a cobrança. Em um minuto, use "Conferir no Asaas"; o Lume confere antes de emitir outra.', 'unavailable');
    }
    await fail(context.officeId, claimed.id, error.message);
    throw error;
  }
}

export async function createAsaasCharge(context: WorkspaceContext, raw: unknown) {
  context = await authorize(context, true);
  const input = contract.asaasChargeCreateInput.parse(raw);
  // The CPF or CNPJ only travels to Asaas; it is not part of the stored fingerprint.
  const hash = createHash('sha256').update(JSON.stringify([input.installmentId, input.dueOn])).digest('hex');
  const previous = await database.prepare('SELECT id,input_hash FROM asaas_payment WHERE office_id=? AND created_by=? AND idempotency_key=?')
    .get<{ id: string; input_hash: string }>(context.officeId, context.userId, input.idempotencyKey);
  if (previous) {
    if (previous.input_hash !== hash) throw conflict('Esta chave já foi usada com outros dados.');
    return confirmAsaasCharge(context, { installmentId: input.installmentId, paymentId: previous.id });
  }
  if (input.dueOn < todayInSaoPaulo()) throw new CapabilityError('INVALID', 'Escolha um vencimento a partir de hoje.');
  const credential = await asaasCredential(context.officeId);
  if (!credential) throw notConnected();
  const details = await installment(database, context, input.installmentId);
  if (details.cancelled || details.pendingCents <= 0) throw conflict('Esta parcela foi quitada ou cancelada.');
  const customerId = await ensureCustomer(context, credential, details, input.document);
  await authorize(context, true);
  const paymentId = randomUUID();
  const locked = await withTransaction(async tx => {
    const current = await installment(tx, context, input.installmentId, true);
    if (current.cancelled || current.pendingCents <= 0) throw conflict('Esta parcela foi quitada ou cancelada.');
    if (await tx.prepare(`SELECT 1 FROM asaas_payment WHERE office_id=? AND installment_id=? AND state IN ('creating','open')`).get(context.officeId, input.installmentId))
      throw conflict('Esta parcela já tem uma cobrança ativa no Asaas. Cancele-a antes de emitir outra.');
    const connection = await tx.prepare('SELECT 1 FROM asaas_connection WHERE office_id=? AND wallet_id=? FOR SHARE').get(context.officeId, credential.walletId);
    if (!connection) throw notConnected();
    await tx.prepare(`INSERT INTO asaas_payment(id,office_id,installment_id,environment,wallet_id,state,customer_id,amount_cents,due_on,created_by,idempotency_key,input_hash)
      VALUES(?,?,?,?,?,'creating',?,?,?,?,?,?)`).run(paymentId, context.officeId, input.installmentId, credential.environment, credential.walletId, customerId,
      current.pendingCents, input.dueOn, context.userId, input.idempotencyKey, hash);
    return current;
  });
  const claimed = await lease(paymentId, context.officeId);
  if (claimed) await attempt(context, claimed, locked, false);
  return view(context, input.installmentId);
}

/** Resolves a `creating` charge whose answer was lost: adopts it when Asaas has it, otherwise sends it again. */
export async function confirmAsaasCharge(context: WorkspaceContext, raw: unknown) {
  context = await authorize(context, true);
  const input = contract.asaasChargePaymentInput.parse(raw);
  const details = await installment(database, context, input.installmentId);
  const row = await database.prepare('SELECT state FROM asaas_payment WHERE office_id=? AND id=? AND installment_id=? AND created_by=?')
    .get<{ state: string }>(context.officeId, input.paymentId, input.installmentId, context.userId);
  if (!row) throw missing();
  if (row.state === 'creating') {
    const claimed = await lease(input.paymentId, context.officeId);
    if (!claimed) throw conflict('A cobrança ainda está sendo criada. Aguarde alguns segundos e atualize.');
    await attempt(context, claimed, details, true);
  }
  return view(context, input.installmentId);
}

const deleted = z.object({ deleted: z.boolean().optional(), id: z.string().optional() });

export async function cancelAsaasCharge(context: WorkspaceContext, raw: unknown) {
  context = await authorize(context, true);
  const input = contract.asaasChargePaymentInput.parse(raw);
  await installment(database, context, input.installmentId);
  const row = await database.prepare(`SELECT provider_payment_id AS "providerPaymentId",wallet_id AS "walletId",state FROM asaas_payment
    WHERE office_id=? AND id=? AND installment_id=? AND created_by=?`).get<{ providerPaymentId: string | null; walletId: string; state: string }>(context.officeId, input.paymentId, input.installmentId, context.userId);
  if (!row) throw missing();
  if (row.state !== 'open' || !row.providerPaymentId) throw conflict('Somente uma cobrança aguardando pagamento pode ser cancelada.');
  const credential = await asaasCredential(context.officeId);
  if (!credential || credential.walletId !== row.walletId) throw notConnected();
  try {
    await asaasRequest(credential.environment, credential.apiKey, 'DELETE', `/payments/${encodeURIComponent(row.providerPaymentId)}`, deleted);
  } catch (error) {
    // Already removed in Asaas: the local record only catches up.
    if (!(error instanceof AsaasProviderError && error.kind === 'rejected' && /não encontrad|not found/i.test(error.message))) throw error;
  }
  await database.prepare(`UPDATE asaas_payment SET state='cancelled',provider_status='DELETED',updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=? AND state='open'`)
    .run(context.officeId, input.paymentId);
  return view(context, input.installmentId);
}

/** The open charge's link, for the message the office sends to the client. */
export async function openAsaasInvoiceUrl(tx: Pick<Transaction, 'prepare'>, officeId: string, installmentId: string) {
  const row = await tx.prepare(`SELECT invoice_url FROM asaas_payment WHERE office_id=? AND installment_id=? AND state='open'`).get<{ invoice_url: string | null }>(officeId, installmentId);
  return row?.invoice_url ?? null;
}
