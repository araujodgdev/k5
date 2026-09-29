import { z } from 'zod';

const review = z.object({ status: z.string().max(100), reason: z.string().max(2_000).nullish() });
export const adsAccount = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(500),
  currency_code: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1).max(100),
  status: z.string().max(100).nullish(), review: review.nullish(),
  account_integrity_review: z.object({ review: review.nullish() }).nullish(),
});
export type AdsAccount = z.infer<typeof adsAccount>;
export const adsConnection = z.object({ account: adsAccount, version: z.string().uuid(), verifiedAt: z.string() });
export const adsStatus = z.object({ canManage: z.boolean(), connection: adsConnection.nullable() });
export type AdsStatus = z.infer<typeof adsStatus>;
export const adsConnectInput = z.object({
  apiKey: z.string().trim().min(1).max(2_000).regex(/^[\x21-\x7e]+$/),
  expectedVersion: z.string().uuid().nullable(),
}).strict();
export const adsVersionInput = z.object({ expectedVersion: z.string().uuid() }).strict();

export function adsStatusLabel(value: string | null | undefined): string {
  switch (value) {
    case 'active': return 'Ativa';
    case 'paused': return 'Pausada';
    case 'approved': return 'Aprovada';
    case 'pending': case 'in_review': case 'pending_review': return 'Em análise';
    case 'rejected': return 'Reprovada';
    default: return 'Não confirmada';
  }
}
