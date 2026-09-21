import 'server-only';
import { createHash } from 'node:crypto';
import pilot from '@/data/feedback-pilot.json';
import history from '@/data/feedback-history.json';

export type FeedbackCampaign = typeof pilot;
export const activeCampaign = pilot;
export const feedbackCampaigns: FeedbackCampaign[] = [...history, pilot];

// Preserve the original two-model assignment; extend to balanced pair sampling.
export function feedbackPair<T>(results: T[], seed: string): T[] {
  if (results.length < 2) throw new Error('A comparison requires two completed runs');
  const digest = createHash('sha256').update(seed).digest();
  const pairs: T[][] = [];
  for (let a = 0; a < results.length; a++) for (let b = a + 1; b < results.length; b++) pairs.push([results[a], results[b]]);
  const pair = pairs[digest.readUInt32BE(1) % pairs.length];
  return digest[0] % 2 ? [...pair].reverse() : pair;
}
