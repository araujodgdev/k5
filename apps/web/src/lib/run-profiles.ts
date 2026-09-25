import type { AiProfile, ProfileVariant } from './ai-profiles';
import type { PinnedProfile } from './ai-profiles-core';
import type { RunRow } from './ai-store';

export type RunProfileKey = AiProfile | `${AiProfile}:${ProfileVariant}`;
/** The `ai_run.model_profiles` column: what each step of a run was queued with. */
export type RunProfiles = Partial<Record<RunProfileKey, PinnedProfile>>;

export const runProfileKey = (profile: AiProfile, variant?: ProfileVariant): RunProfileKey => variant ? `${profile}:${variant}` : profile;

/**
 * The pinned settings of one step. Runs queued before profiles existed carry only
 * `model_provider` and `model_id`; their main steps keep that model and the old default effort.
 * A variant is only ever read from the pin: a run queued without an escalation model never gets one.
 */
export function runProfile(run: Pick<RunRow, 'model_provider' | 'model_id' | 'model_profiles'>, profile: AiProfile, variant?: ProfileVariant): Partial<PinnedProfile> | undefined {
  let pinned: RunProfiles = {};
  try { pinned = run.model_profiles ? JSON.parse(run.model_profiles) as RunProfiles : {}; } catch { pinned = {}; }
  const found = pinned[runProfileKey(profile, variant)];
  if (found || variant) return found;
  return run.model_provider && run.model_id ? { provider: run.model_provider as PinnedProfile['provider'], modelId: run.model_id } : undefined;
}
