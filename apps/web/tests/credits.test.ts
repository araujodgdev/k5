import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { callUsage, creditCostBrl, formatCredits, millicreditsForUsd, usageCostUsd, type CreditSettings, type ModelPrice } from '../src/lib/billing/credit-pricing';
import { assertCredits, chargeOcrPage, creditBalance, creditOverview, grantCreditsByAdmin, InsufficientCreditsError, postCredits } from '../src/lib/billing/credits';
import { recordUsage } from '../src/lib/ai-runtime';
import { withTransaction } from '../src/lib/database';

const settings: CreditSettings = { creditPriceCents: 10, margin: 0.3, taxRate: 0.06, feeRate: 0.03, usdBrl: 5.5, planMonthlyCredits: 850, initialCredits: 850, ocrPageMillicredits: 100 };
const sol: ModelPrice = { inputUsdMtok: 2, cachedInputUsdMtok: 0.1, cacheWriteUsdMtok: 2.5, outputUsdMtok: 10, webSearchUsdCall: 0.01, longContextTokens: 272_000, longInputMultiplier: 2, longOutputMultiplier: 1.5 };
const luna = (officeId: string) => ({ provider: 'openai' as const, modelId: 'gpt-6-luna', apiKey: '', connectionId: `conn-${officeId}` });

async function office() {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Pessoa');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  return { officeId, userId };
}
async function admin() {
  const { userId } = await office();
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId);
  return userId;
}
/** Empties a balance with one entry, as if everything had been used. */
async function drain(officeId: string) {
  const balance = await creditBalance(officeId);
  await withTransaction(tx => postCredits(tx, { officeId, kind: 'usage', amount: -balance, reference: `drain:${randomUUID()}` }));
}

test('a credit sold at R$ 0,10 covers R$ 0,061 of cost after margin, taxes and fee', () => {
  assert.ok(Math.abs(creditCostBrl(settings) - 0.061) < 1e-9);
  // US$ 1 at R$ 5,50 is R$ 5,50, which is 90,16 credits at R$ 0,061: rounded up, never below cost.
  assert.equal(millicreditsForUsd(1, settings), 90_164);
  assert.equal(millicreditsForUsd(0, settings), 0);
  assert.equal(formatCredits(12_480), '12,4');
  assert.equal(formatCredits(-400), '-0,4');
});

test('cache reads, cache writes, long context and web searches are priced as the provider bills them', () => {
  // 10.000 input of which 7.000 read from cache and 1.000 written, 2.000 output.
  const usd = usageCostUsd(sol, [{ inputTokens: 10_000, cachedInputTokens: 7_000, cacheWriteTokens: 1_000, outputTokens: 2_000 }]);
  assert.ok(Math.abs(usd - (2_000 * 2 + 7_000 * 0.1 + 1_000 * 2.5 + 2_000 * 10) / 1e6) < 1e-12);
  // The long-context rate applies per call: two calls of 200 thousand stay standard, one of 400 thousand does not.
  const split = usageCostUsd(sol, [{ inputTokens: 200_000 }, { inputTokens: 200_000 }]);
  const long = usageCostUsd(sol, [{ inputTokens: 400_000, outputTokens: 1_000 }]);
  assert.ok(Math.abs(split - 0.8) < 1e-12);
  assert.ok(Math.abs(long - (400_000 * 2 * 2 + 1_000 * 10 * 1.5) / 1e6) < 1e-12);
  assert.ok(Math.abs(usageCostUsd(sol, [], 3) - 0.03) < 1e-12);
});

test('usage reported by Mastra and by the AI SDK reads the same', () => {
  assert.deepEqual(callUsage({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 60, cacheCreationInputTokens: 10, reasoningTokens: 5 }),
    { inputTokens: 100, outputTokens: 20, cachedInputTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5 });
  assert.deepEqual(callUsage({ inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 10 }, outputTokenDetails: { reasoningTokens: 5 } }),
    { inputTokens: 100, outputTokens: 20, cachedInputTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5 });
  assert.deepEqual(callUsage(undefined), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
});

test('an office opens with the initial credits once', async () => {
  const { officeId } = await office();
  const [first, second] = await Promise.all([creditBalance(officeId), creditBalance(officeId)]);
  assert.equal(first, 500_000);
  assert.equal(second, 500_000);
  const entries = await testDb.prepare("SELECT count(*)::int AS n FROM credit_entry WHERE office_id=? AND kind='initial'").get<{ n: number }>(officeId);
  assert.equal(entries!.n, 1);
});

test('a completed call is charged with its usage record; a failed one is recorded but not charged', async () => {
  const { officeId, userId } = await office();
  const config = luna(officeId);
  await recordUsage(officeId, userId, config, 'summary.email_digest', 'completed', { inputTokens: 200_000, outputTokens: 200_000, cachedInputTokens: 100_000 });
  await recordUsage(officeId, userId, config, 'summary.email_digest', 'failed', { inputTokens: 200_000, outputTokens: 200_000 });
  const rows = await testDb.prepare(`SELECT id, status, credits::float8 AS credits, cost_usd::float8 AS "costUsd", cached_input_tokens::int AS cached
    FROM ai_usage WHERE office_id=? ORDER BY status`).all<{ id: string; status: string; credits: number | null; costUsd: number | null; cached: number }>(officeId);
  const completed = rows.find(row => row.status === 'completed')!;
  // 100 thousand fresh at 0,10 + 100 thousand cached at 0,01 + 200 thousand out at 0,50 = US$ 0,111.
  assert.ok(Math.abs(completed.costUsd! - 0.111) < 1e-9);
  assert.equal(completed.credits, millicreditsForUsd(0.111, settings));
  assert.equal(completed.cached, 100_000);
  assert.equal(rows.find(row => row.status === 'failed')!.credits, null);
  assert.equal(await creditBalance(officeId), 500_000 - completed.credits!);
  const entry = await testDb.prepare('SELECT amount::float8 AS amount FROM credit_entry WHERE reference=?').get<{ amount: number }>(`usage:${completed.id}`);
  assert.equal(entry!.amount, -completed.credits!);
});

test('a model without a price of its own is charged at the fallback rates', async () => {
  const { officeId, userId } = await office();
  await recordUsage(officeId, userId, { ...luna(officeId), modelId: 'unpriced-model' }, 'agent.chat', 'completed', { inputTokens: 200_000, outputTokens: 0 });
  const row = await testDb.prepare('SELECT cost_usd::float8 AS "costUsd" FROM ai_usage WHERE office_id=?').get<{ costUsd: number }>(officeId);
  assert.ok(Math.abs(row!.costUsd - 0.4) < 1e-9);
});

test('the AI is refused at zero credits and works again after a grant', async () => {
  const { officeId, userId } = await office();
  await assertCredits(officeId, userId);
  await drain(officeId);
  await assert.rejects(assertCredits(officeId, userId), (error: unknown) => error instanceof InsufficientCreditsError && error.status === 402);
  await withTransaction(tx => postCredits(tx, { officeId, kind: 'purchase', amount: 1_000, reference: `test:${randomUUID()}` }));
  await assertCredits(officeId, userId);
});

test('a call that costs more than what is left ends the balance below zero and blocks the next one', async () => {
  const { officeId, userId } = await office();
  await drain(officeId);
  await withTransaction(tx => postCredits(tx, { officeId, kind: 'purchase', amount: 10, reference: `test:${randomUUID()}` }));
  await assertCredits(officeId, userId);
  await recordUsage(officeId, userId, luna(officeId), 'agent.chat', 'completed', { inputTokens: 100_000, outputTokens: 10_000 });
  assert.ok(await creditBalance(officeId) < 0);
  await assert.rejects(assertCredits(officeId, userId), InsufficientCreditsError);
});

test('platform administrators are neither blocked nor charged, and their cost is still recorded', async () => {
  const { officeId } = await office();
  const adminId = await admin();
  await drain(officeId);
  await assertCredits(officeId, adminId);
  await recordUsage(officeId, adminId, luna(officeId), 'agent.chat', 'completed', { inputTokens: 200_000, outputTokens: 0 });
  const row = await testDb.prepare('SELECT credits::float8 AS credits, cost_usd::float8 AS "costUsd" FROM ai_usage WHERE office_id=?').get<{ credits: number; costUsd: number }>(officeId);
  assert.equal(row!.credits, 0);
  assert.ok(Math.abs(row!.costUsd - 0.02) < 1e-9);
  assert.equal(await creditBalance(officeId), 0);
  await chargeOcrPage({ officeId, userId: adminId }, randomUUID(), 'página:1');
  assert.equal(await creditBalance(officeId), 0);
});

test('concurrent charges are applied one after the other and add up to the balance', async () => {
  const { officeId, userId } = await office();
  await Promise.all(Array.from({ length: 12 }, () =>
    recordUsage(officeId, userId, luna(officeId), 'agent.chat', 'completed', { inputTokens: 100_000, outputTokens: 10_000 })));
  const charged = await testDb.prepare(`SELECT COALESCE(sum(credits),0)::float8 AS total FROM ai_usage WHERE office_id=?`).get<{ total: number }>(officeId);
  const ledger = await testDb.prepare(`SELECT COALESCE(sum(amount),0)::float8 AS total FROM credit_entry WHERE office_id=?`).get<{ total: number }>(officeId);
  assert.equal(await creditBalance(officeId), 500_000 - charged!.total);
  assert.equal(ledger!.total, 500_000 - charged!.total);
  const last = await testDb.prepare(`SELECT balance_after::float8 AS "balanceAfter" FROM credit_entry WHERE office_id=? ORDER BY balance_after LIMIT 1`).get<{ balanceAfter: number }>(officeId);
  assert.equal(last!.balanceAfter, 500_000 - charged!.total);
});

test('each OCR page is charged once, and a scanned page is refused without credits', async () => {
  const { officeId, userId } = await office();
  const documentId = randomUUID();
  await chargeOcrPage({ officeId, userId }, documentId, 'página:1');
  await chargeOcrPage({ officeId, userId }, documentId, 'página:1');
  await chargeOcrPage({ officeId, userId }, documentId, 'página:2');
  assert.equal(await creditBalance(officeId), 500_000 - 200);
  await drain(officeId);
  // A page already paid for is read again for free; a new one is refused.
  await chargeOcrPage({ officeId, userId }, documentId, 'página:2');
  await assert.rejects(chargeOcrPage({ officeId, userId }, documentId, 'página:3'), InsufficientCreditsError);
});

test('an administrator grants credits once per request, with a reason and an audit record', async () => {
  const { officeId, userId } = await office();
  const adminId = await admin();
  const requestId = randomUUID();
  await assert.rejects(grantCreditsByAdmin(userId, officeId, { credits: 100, reason: 'Cortesia', requestId }), /Acesso restrito/);
  await assert.rejects(grantCreditsByAdmin(adminId, officeId, { credits: 0, reason: 'Cortesia', requestId }), /de 1 a 100.000/);
  await assert.rejects(grantCreditsByAdmin(adminId, officeId, { credits: 100, reason: '  ', requestId }), /motivo/);
  await assert.rejects(grantCreditsByAdmin(adminId, randomUUID(), { credits: 100, reason: 'Cortesia', requestId }), /não encontrado/);
  assert.deepEqual(await grantCreditsByAdmin(adminId, officeId, { credits: 100, reason: 'Cortesia', requestId }), { applied: true });
  assert.deepEqual(await grantCreditsByAdmin(adminId, officeId, { credits: 100, reason: 'Cortesia', requestId }), { applied: false });
  assert.equal(await creditBalance(officeId), 600_000);
  const audit = await testDb.prepare(`SELECT count(*)::int AS n FROM platform_audit_log WHERE office_id=? AND action='credits.granted' AND actor_user_id=?`).get<{ n: number }>(officeId, adminId);
  assert.equal(audit!.n, 1);
  const overview = await creditOverview(officeId);
  const grant = overview.entries.find(entry => entry.kind === 'admin_grant')!;
  assert.equal(grant.description, 'Cortesia');
  assert.equal(grant.amount, 100_000);
});

test('the statement names the task behind each charge and sums this month\'s use', async () => {
  const { officeId, userId } = await office();
  await recordUsage(officeId, userId, luna(officeId), 'summary.email_digest', 'completed', { inputTokens: 200_000, outputTokens: 0 });
  const overview = await creditOverview(officeId);
  assert.equal(overview.entries[0].description, 'Panorama de e-mails');
  assert.equal(overview.usedThisMonth, millicreditsForUsd(0.02, settings));
  assert.equal(overview.planMonthlyCredits, 850);
});
