import { evaluateBooleanFlag } from '@/lib/flagship';
import { adsEnvironment } from './environment';

export const ADS_FLAG_KEY = 'chatgpt-ads';
export function isAdsEnabled(context: { officeId: string; userId: string }) {
  if (!context.officeId || !context.userId) return Promise.resolve(false);
  return evaluateBooleanFlag(ADS_FLAG_KEY, {
    targetingKey: `${context.officeId}:${context.userId}`,
    office_id: context.officeId, user_id: context.userId,
  }, adsEnvironment());
}
