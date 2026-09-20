import 'server-only';
import { findInstallation } from '../repositories/installations';
import { confirmedCnjNumbers, findCaseLink } from '../repositories/links';
import {
  deferSubscription,
  listDueSubscriptions,
  setSubscriptionStatus,
  subscriptionStillAuthorized,
  type Subscription,
} from '../repositories/subscriptions';
import { overlappingWindow, nowIso } from '../normalization/dates';
import { ConnectorError } from '../contracts';
import { enqueueJob } from './queue';

/**
 * Turns due subscriptions into queued jobs. Section 7 step 2: the scheduler is the place that
 * knows about priority and budget, so the workers below it only ever see work that was already
 * judged worth doing.
 */

/** Deliberate re-read of the previous days, because sources publish late (section 7 step 6). */
const REFRESH_OVERLAP_DAYS = 2;
const BACKFILL_DEFAULT_DAYS = 30;

export type ScheduleOutcome = {
  considered: number;
  queued: number;
  skipped: Array<{ subscriptionId: string; reason: string }>;
};

/**
 * A subscription that queues a job every tick regardless of the last one still running would
 * multiply the source's load by the number of ticks. The idempotency key ties the job to the
 * subscription and the window, so a tick that arrives while the same window is pending is a no-op.
 */
function refreshKey(subscription: Subscription, windowFrom: string, windowTo: string): string {
  return `sub:${subscription.id}:${windowFrom}:${windowTo}`;
}

export function scheduleDueSubscriptions(now = Date.now(), limit = 20): ScheduleOutcome {
  const outcome: ScheduleOutcome = { considered: 0, queued: 0, skipped: [] };

  for (const subscription of listDueSubscriptions(now, limit)) {
    outcome.considered += 1;

    // Re-read the authorization before spending a request, not when the subscription was created.
    const authorized = subscriptionStillAuthorized(subscription);
    if (!authorized.ok) {
      // A link still awaiting review will probably be confirmed; the subscription waits for it.
      // A revoked membership or a deleted link will not resolve itself and needs a person.
      if (authorized.waiting) deferSubscription(subscription.id, subscription.intervalMinutes * 60_000, now);
      else setSubscriptionStatus(subscription.officeId, subscription.id, 'suspended', authorized.reason);
      outcome.skipped.push({ subscriptionId: subscription.id, reason: authorized.reason });
      continue;
    }

    const installation = findInstallation(subscription.installationId);
    if (!installation || !installation.enabled) {
      setSubscriptionStatus(subscription.officeId, subscription.id, 'suspended', 'A fonte foi desabilitada.');
      outcome.skipped.push({ subscriptionId: subscription.id, reason: 'installation_disabled' });
      continue;
    }

    if (subscription.targetKind === 'publications_by_case') {
      let numbers: string[] = [];
      if (subscription.linkId) {
        const link = findCaseLink(subscription.officeId, subscription.linkId);
        if (link && link.status === 'active' && link.confirmation === 'confirmed' && link.cnjNumber) {
          numbers = [link.cnjNumber];
        }
      } else {
        numbers = confirmedCnjNumbers(subscription.officeId, installation.id);
      }

      if (!numbers.length) {
        // Nothing confirmed to ask about. Backing off is correct; a broad sweep with no filter
        // would be discovery the office never authorized.
        deferSubscription(subscription.id, subscription.intervalMinutes * 60_000, now);
        outcome.skipped.push({ subscriptionId: subscription.id, reason: 'no_confirmed_links' });
        continue;
      }

      const window = overlappingWindow(subscription.watermark, nowIso(), REFRESH_OVERLAP_DAYS);
      const { created } = enqueueJob({
        officeId: subscription.officeId,
        installationId: installation.id,
        subscriptionId: subscription.id,
        linkId: subscription.linkId,
        kind: 'refresh',
        operation: 'listChanges',
        request: { cnjNumbers: numbers },
        windowFrom: window.from,
        windowTo: window.to,
        idempotencyKey: refreshKey(subscription, window.from, window.to),
      });

      // Move the next tick out whether or not a new job was created: an existing pending job for
      // this window is already the work this tick would have asked for.
      deferSubscription(subscription.id, subscription.intervalMinutes * 60_000, now);
      if (created) outcome.queued += 1;
      else outcome.skipped.push({ subscriptionId: subscription.id, reason: 'already_pending' });
      continue;
    }

    outcome.skipped.push({ subscriptionId: subscription.id, reason: 'target_kind_not_implemented' });
    deferSubscription(subscription.id, subscription.intervalMinutes * 60_000, now);
  }

  return outcome;
}

/**
 * Queues a historical sweep. Kept separate from the refresh queue (section 7) so a month of
 * backfill cannot delay today's publications, and so its findings are announced as history.
 */
export function scheduleBackfill(input: {
  officeId: string;
  installationId: string;
  linkId: string | null;
  from?: string;
  to?: string;
}): { jobId: string; created: boolean; windowFrom: string; windowTo: string } {
  const to = (input.to ?? nowIso()).slice(0, 10);
  const from = input.from
    ? input.from.slice(0, 10)
    : new Date(Date.parse(`${to}T00:00:00Z`) - BACKFILL_DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);

  let numbers: string[] = [];
  if (input.linkId) {
    const link = findCaseLink(input.officeId, input.linkId);
    if (link && link.status === 'active' && link.confirmation === 'confirmed' && link.cnjNumber) {
      numbers = [link.cnjNumber];
    }
  } else {
    numbers = confirmedCnjNumbers(input.officeId, input.installationId);
  }

  if (!numbers.length) {
    throw new ConnectorError(
      'human_action_required',
      input.linkId
        ? 'O processo vinculado ainda não está confirmado para consulta.'
        : 'Nenhum processo confirmado para consulta nesta fonte.',
    );
  }

  const { job, created } = enqueueJob({
    officeId: input.officeId,
    installationId: input.installationId,
    linkId: input.linkId,
    kind: 'backfill',
    operation: 'listChanges',
    request: { cnjNumbers: numbers },
    windowFrom: from,
    windowTo: to,
    idempotencyKey: `backfill:${input.officeId}:${input.installationId}:${input.linkId ?? 'all'}:${from}:${to}`,
  });

  return { jobId: job.id, created, windowFrom: from, windowTo: to };
}
