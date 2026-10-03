/**
 * The arithmetic of credits, with no I/O: what a model call cost in dollars, and how many
 * millicredits that is once margin, taxes, the payment fee and the dollar are applied.
 */

export const MILLI = 1000;

export type CreditSettings = {
  creditPriceCents: number; margin: number; taxRate: number; feeRate: number; usdBrl: number;
  planMonthlyCredits: number; initialCredits: number; ocrPageMillicredits: number;
};

export type ModelPrice = {
  inputUsdMtok: number; cachedInputUsdMtok: number; cacheWriteUsdMtok: number; outputUsdMtok: number;
  webSearchUsdCall: number; longContextTokens: number | null; longInputMultiplier: number; longOutputMultiplier: number;
};

/** One model call. `inputTokens` counts every input token, cached and written ones included. */
export type CallUsage = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number };

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Reads the usage a provider reported, in either shape the SDKs hand back: Mastra's flat fields or
 * the AI SDK's token details. Reasoning is already inside the output tokens; it is kept apart only
 * to be recorded.
 */
export function callUsage(usage: unknown): CallUsage {
  const u = (usage ?? {}) as Record<string, unknown> & {
    inputTokenDetails?: { cacheReadTokens?: unknown; cacheWriteTokens?: unknown };
    outputTokenDetails?: { reasoningTokens?: unknown };
  };
  return {
    inputTokens: count(u.inputTokens),
    outputTokens: count(u.outputTokens),
    cachedInputTokens: count(u.cachedInputTokens ?? u.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: count(u.cacheCreationInputTokens ?? u.inputTokenDetails?.cacheWriteTokens),
    reasoningTokens: count(u.reasoningTokens ?? u.outputTokenDetails?.reasoningTokens),
  };
}

/** Adds calls together, for what is recorded about a turn of several steps. */
export function totalUsage(calls: CallUsage[]): CallUsage {
  const sum = (key: keyof CallUsage) => calls.reduce((total, call) => total + count(call[key]), 0);
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cachedInputTokens: sum('cachedInputTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'), reasoningTokens: sum('reasoningTokens') };
}

/**
 * What the provider charges for these calls. The long-context rate applies per call, as providers
 * bill it, so a long agent turn is priced step by step rather than by its sum.
 */
export function usageCostUsd(price: ModelPrice, calls: CallUsage[], webSearchCalls = 0): number {
  let usd = count(webSearchCalls) * price.webSearchUsdCall;
  for (const call of calls) {
    const input = count(call.inputTokens), cached = count(call.cachedInputTokens), written = count(call.cacheWriteTokens);
    const long = price.longContextTokens !== null && input > price.longContextTokens;
    const inputRate = long ? price.longInputMultiplier : 1, outputRate = long ? price.longOutputMultiplier : 1;
    const fresh = Math.max(0, input - cached - written);
    usd += (fresh * price.inputUsdMtok + cached * price.cachedInputUsdMtok + written * price.cacheWriteUsdMtok) * inputRate / 1e6;
    usd += count(call.outputTokens) * price.outputUsdMtok * outputRate / 1e6;
  }
  return usd;
}

/** The reais a credit may cost the platform: its price less margin, taxes and the payment fee. */
export function creditCostBrl(settings: CreditSettings): number {
  return settings.creditPriceCents / 100 * (1 - settings.margin - settings.taxRate - settings.feeRate);
}

/** Millicredits for a dollar cost, rounded up so a call is never sold below cost. */
export function millicreditsForUsd(usd: number, settings: CreditSettings): number {
  if (!(usd > 0)) return 0;
  return Math.ceil(usd * settings.usdBrl / creditCostBrl(settings) * MILLI);
}

/** Credits for people, to one decimal and never more than there is: 12.480 millicredits read 12,4. */
export function formatCredits(millicredits: number): string {
  return (Math.floor(millicredits / 100) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** Packages sold on the Plano page; each costs its credits at the credit price. */
export const CREDIT_PACKAGES = [500, 1000, 2500] as const;
export type CreditPackage = (typeof CREDIT_PACKAGES)[number];
export const isCreditPackage = (value: unknown): value is CreditPackage => CREDIT_PACKAGES.includes(value as CreditPackage);
