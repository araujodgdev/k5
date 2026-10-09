import 'server-only';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../api-error';
import { database, withTransaction, type Transaction } from '../database';
import { assertPlatformAdmin, isPlatformAdmin } from '../platform-core';
import { AI_TASK_DEFINITIONS, type AiTaskKey } from '../ai-tasks';
import { persistedBillingOrigin, billingOwner, type BillingOwner, type BillingOrigin } from './origin';
import { MILLI, millicreditsForUsd, usageCostUsd, type CallUsage, type CreditSettings, type ModelPrice } from './credit-pricing';

/*
 * The office's credits. Every AI call and every page read by OCR is charged here, in the same
 * transaction that records it, so a balance is always the sum of its entries. Platform
 * administrators are never charged; what they use is still recorded with its cost.
 */

export type CreditKind = 'initial' | 'plan' | 'purchase' | 'admin_grant' | 'usage' | 'ocr' | 'refund';

export class InsufficientCreditsError extends ApiError {
  constructor() { super(402, 'Seus créditos acabaram. Compre mais em Plano para continuar usando a IA do Lume.'); this.name = 'InsufficientCreditsError'; }
}

export async function creditSettings(db: Transaction = database): Promise<CreditSettings> {
  const row = await db.prepare(`SELECT credit_price_cents AS "creditPriceCents", margin::float8 AS margin, tax_rate::float8 AS "taxRate",
    fee_rate::float8 AS "feeRate", usd_brl::float8 AS "usdBrl", plan_monthly_credits AS "planMonthlyCredits",
    initial_credits AS "initialCredits", ocr_page_millicredits AS "ocrPageMillicredits" FROM credit_settings`).get<CreditSettings>();
  if (!row) throw new Error('credit_settings is missing');
  return row;
}

/** The model's own price, or the `*` row for a model nobody priced. */
export async function modelPrice(modelId: string, db: Transaction = database): Promise<ModelPrice> {
  const row = await db.prepare(`SELECT input_usd_mtok::float8 AS "inputUsdMtok", cached_input_usd_mtok::float8 AS "cachedInputUsdMtok",
    cache_write_usd_mtok::float8 AS "cacheWriteUsdMtok", output_usd_mtok::float8 AS "outputUsdMtok", web_search_usd_call::float8 AS "webSearchUsdCall",
    long_context_tokens AS "longContextTokens", long_input_multiplier::float8 AS "longInputMultiplier", long_output_multiplier::float8 AS "longOutputMultiplier"
    FROM ai_model_price WHERE model_id IN (?, '*') ORDER BY (model_id = '*') LIMIT 1`).get<ModelPrice>(modelId);
  if (!row) throw new Error('ai_model_price has no fallback row');
  return row;
}

/** A user who is not charged: platform administrators use the AI freely. */
export async function isCreditExempt(userId: string | null, db: Transaction = database) {
  return Boolean(userId) && isPlatformAdmin(db, userId!);
}

/**
 * The office's account, opened on first use with the one-time initial credits. Locked when `lock`
 * is set, so a charge and a grant on the same office are applied one after the other.
 */
async function account(tx: Transaction, officeId: string, lock = false) {
  const opened = await tx.prepare(`INSERT INTO credit_account (office_id, balance) VALUES (?, 0) ON CONFLICT (office_id) DO NOTHING`).run(officeId);
  const row = await tx.prepare(`SELECT balance::float8 AS balance FROM credit_account WHERE office_id = ?${lock ? ' FOR UPDATE' : ''}`).get<{ balance: number }>(officeId);
  if (!opened.changes) return row!.balance;
  const { initialCredits } = await creditSettings(tx);
  if (!initialCredits) return row!.balance;
  return (await applyEntry(tx, { officeId, kind: 'initial', amount: initialCredits * MILLI, reference: `initial:${officeId}`, description: 'Créditos iniciais' })) ?? row!.balance;
}

type Entry = { officeId: string; kind: CreditKind; amount: number; reference: string; userId?: string | null; actorUserId?: string | null; description?: string; billingOrigin?: BillingOrigin | null };

/** Applies one entry under the account's lock. Returns the new balance, or null when the reference was already applied. */
async function applyEntry(tx: Transaction, entry: Entry): Promise<number | null> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount === 0) return null;
  const origin = await persistedBillingOrigin(tx, { officeId: entry.officeId, userId: entry.userId ?? null }, entry.billingOrigin?.id);
  const inserted = await tx.prepare(`INSERT INTO credit_entry (id, office_id, user_id, actor_user_id, kind, amount, balance_after, reference, description, conversation_id, billing_origin_id)
    SELECT ?, ?, ?, ?, ?, ?::bigint, balance + ?::bigint, ?, ?, ?, ? FROM credit_account WHERE office_id = ?
    ON CONFLICT (reference) DO NOTHING RETURNING balance_after::float8 AS "balanceAfter"`)
    .get<{ balanceAfter: number }>(randomUUID(), entry.officeId, entry.userId ?? null, entry.actorUserId ?? null, entry.kind,
      entry.amount, entry.amount, entry.reference, entry.description ?? null, origin?.conversationId ?? null, origin?.id ?? null, entry.officeId);
  if (!inserted) return null;
  await tx.prepare('UPDATE credit_account SET balance = ?::bigint, updated_at = CURRENT_TIMESTAMP WHERE office_id = ?').run(inserted.balanceAfter, entry.officeId);
  return inserted.balanceAfter;
}

/** Adds (or, when negative, removes) credits once per reference. Used by payments, refunds and the admin. */
export async function postCredits(tx: Transaction, entry: Entry) {
  await account(tx, entry.officeId, true);
  return applyEntry(tx, entry);
}

/** The balance in millicredits, opening the account when needed. */
export async function creditBalance(officeId: string) {
  return withTransaction(tx => account(tx, officeId));
}

export async function conversationCredits(owner: { officeId: string; userId: string }, conversationId: string) {
  return withTransaction(async tx => {
    if (!await tx.prepare('SELECT id FROM ai_conversation WHERE id=? AND office_id=? AND user_id=? FOR SHARE').get(conversationId, owner.officeId, owner.userId)) throw new ApiError(404, 'Conversa não encontrada.');
    const balance = await account(tx, owner.officeId, true);
    const row = await tx.prepare(`SELECT COALESCE(-sum(amount),0)::text AS used FROM credit_entry WHERE office_id=? AND user_id=? AND conversation_id=? AND kind IN ('usage','ocr')`)
      .get<{ used: string }>(owner.officeId, owner.userId, conversationId);
    const tracking = await tx.prepare('SELECT started_at AS "startedAt" FROM conversation_credit_tracking WHERE singleton=true').get<{ startedAt: string }>();
    const used = Number(row!.used);
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(used)) throw new ApiError(503, 'O saldo está indisponível no momento.');
    return { used, balance, trackingStartedAt: tracking!.startedAt };
  });
}

/**
 * Refuses an AI call or an OCR page when the office has nothing left. A call may still take the
 * balance a little below zero: it is charged what it really cost once it ends. `pending` is what the
 * caller already used and will only charge at the end, such as the pages a chat attachment has read.
 */
export async function assertCredits(officeId: string, userId: string | null, pending = 0) {
  if (await isCreditExempt(userId)) return;
  if (await creditBalance(officeId) - pending <= 0) throw new InsufficientCreditsError();
}

export type UsageCharge = { modelId: string; calls: CallUsage[]; webSearchCalls?: number };

/** Prices a model's usage and charges it to the office, inside the caller's transaction. */
export async function chargeUsage(tx: Transaction, owner: BillingOwner, usageId: string, charge: UsageCharge) {
  owner = await billingOwner(tx, owner);
  const [price, settings] = await Promise.all([modelPrice(charge.modelId, tx), creditSettings(tx)]);
  const costUsd = usageCostUsd(price, charge.calls, charge.webSearchCalls);
  const millicredits = millicreditsForUsd(costUsd, settings);
  if (!millicredits || await isCreditExempt(owner.userId, tx)) return { costUsd, millicredits: 0 };
  await postCredits(tx, { officeId: owner.officeId, userId: owner.userId, billingOrigin: owner.billingOrigin, kind: 'usage', amount: -millicredits, reference: `usage:${usageId}` });
  return { costUsd, millicredits };
}

/**
 * Charges one page about to be read by OCR, refusing it when the office has no credits. The
 * reference is the document and the page, so a retried extraction never pays for a page twice.
 */
export async function chargeOcrPage(owner: BillingOwner, documentId: string, page: string) {
  if (await isCreditExempt(owner.userId)) return;
  await withTransaction(async tx => {
    owner = await billingOwner(tx, owner);
    const balance = await account(tx, owner.officeId, true);
    const reference = `ocr:${documentId}:${page}`;
    if (await tx.prepare('SELECT 1 FROM credit_entry WHERE reference = ?').get(reference)) return;
    if (balance <= 0) throw new InsufficientCreditsError();
    const { ocrPageMillicredits } = await creditSettings(tx);
    await applyEntry(tx, { officeId: owner.officeId, userId: owner.userId, billingOrigin: owner.billingOrigin, kind: 'ocr', amount: -ocrPageMillicredits, reference, description: 'OCR de uma página' });
  });
}

/**
 * Charges the pages a chat attachment was read by, in the transaction that records it. The chat
 * keeps no checkpoint of a page it paid for, so like usage it is charged after the work, once.
 */
export async function chargeOcrPages(tx: Transaction, owner: BillingOwner, attachmentId: string, pages: number) {
  if (!pages || await isCreditExempt(owner.userId, tx)) return;
  owner = await billingOwner(tx, owner);
  const { ocrPageMillicredits } = await creditSettings(tx);
  await postCredits(tx, { officeId: owner.officeId, userId: owner.userId, billingOrigin: owner.billingOrigin, kind: 'ocr', amount: -ocrPageMillicredits * pages,
    reference: `ocr:${attachmentId}`, description: `OCR de ${pages} página${pages === 1 ? '' : 's'}` });
}

export type CreditEntryRow = { id: string; kind: CreditKind; amount: number; balanceAfter: number; description: string | null; createdAt: string; actorName: string | null };

/** The balance and the latest entries, for the Plano page and the admin. Usage is summed per day and task. */
export async function creditOverview(officeId: string, limit = 20) {
  const balance = await creditBalance(officeId);
  const settings = await creditSettings();
  const entries = await database.prepare(`SELECT e.id, e.kind, e.amount::float8 AS amount, e.balance_after::float8 AS "balanceAfter",
      COALESCE(e.description, u.task) AS description, e.created_at AS "createdAt", a.name AS "actorName"
    FROM credit_entry e
    LEFT JOIN ai_usage u ON e.kind = 'usage' AND u.id = substring(e.reference FROM 7)
    LEFT JOIN "user" a ON a.id = e.actor_user_id
    WHERE e.office_id = ? ORDER BY e.created_at DESC, e.id LIMIT ?`).all<CreditEntryRow>(officeId, limit);
  const month = await database.prepare(`SELECT COALESCE(-sum(amount), 0)::float8 AS used FROM credit_entry
    WHERE office_id = ? AND kind IN ('usage','ocr') AND created_at >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`)
    .get<{ used: number }>(officeId);
  // Usage entries carry the task key; people read the task's name.
  for (const entry of entries) if (entry.kind === 'usage') entry.description = AI_TASK_DEFINITIONS[entry.description as AiTaskKey]?.label ?? 'Uso de IA';
  return { balance, usedThisMonth: month!.used, planMonthlyCredits: settings.planMonthlyCredits, creditPriceCents: settings.creditPriceCents, entries };
}
export type CreditOverview = Awaited<ReturnType<typeof creditOverview>>;

/** Credits a platform administrator adds by hand, with a reason, once per request id. */
export async function grantCreditsByAdmin(actorId: string, officeId: string, input: { credits: number; reason: string; requestId: string }) {
  await assertPlatformAdmin(database, actorId);
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 100_000) throw new ApiError(400, 'Informe de 1 a 100.000 créditos.');
  const reason = input.reason.trim();
  if (!reason) throw new ApiError(400, 'Informe o motivo.');
  return withTransaction(async tx => {
    if (!await tx.prepare('SELECT 1 FROM office WHERE id = ?').get(officeId)) throw new ApiError(404, 'Cliente não encontrado.');
    const balance = await postCredits(tx, { officeId, actorUserId: actorId, kind: 'admin_grant', amount: input.credits * MILLI,
      reference: `admin:${input.requestId}`, description: reason.slice(0, 200) });
    if (balance !== null) await tx.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)')
      .run(randomUUID(), actorId, officeId, 'credits.granted', JSON.stringify({ credits: input.credits, requestId: input.requestId }));
    return { applied: balance !== null };
  });
}
