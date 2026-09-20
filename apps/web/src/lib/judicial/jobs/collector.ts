import 'server-only';
import { ConnectorError, permits, type ConnectorResult, type NormalizedPublication } from '../contracts';
import { connectorFor, currentTransport, hasConnectorFor, DJEN_PARSER_VERSION, type Transport } from '../connectors';
import { findInstallation } from '../repositories/installations';
import { ingestPublications, persistSnapshot, recordSyncFailureAlert } from '../repositories/evidence';
import { findSubscriptionById, recordSubscriptionSuccess, subscriptionStillAuthorized, setSubscriptionStatus } from '../repositories/subscriptions';
import { recordAudit } from '../repositories/audit';
import {
  checkpointJob,
  claimJob,
  completeJob,
  failJob,
  renewLease,
  reserveRequestBudget,
  type SyncJob,
} from './queue';

/**
 * Executes one claimed collection job. This is the only place where a connector result becomes
 * durable evidence, and it is deliberately small: fetch, persist the originals with the normalized
 * rows in one transaction, then move the checkpoint.
 */

export type CollectOutcome = {
  jobId: string;
  status: 'completed' | 'retrying' | 'failed' | 'quarantined' | 'skipped';
  inserted: number;
  duplicates: number;
  alerts: number;
  detail: string;
};

function asConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  // An unexpected exception is not a source problem; it is quarantined so the payload stays
  // available for diagnosis rather than being retried against the court.
  return new ConnectorError('schema_changed', error instanceof Error ? error.message : 'Falha inesperada na coleta.');
}

/**
 * Takes the next job and runs it. Returns undefined when the queue is empty, so the worker loop
 * can back off instead of spinning.
 */
export async function processNextJudicialJob(now = Date.now()): Promise<CollectOutcome | undefined> {
  const claimed = claimJob(now);
  if (!claimed) return undefined;
  const { job, leaseOwner } = claimed;

  try {
    return await runJob(job, leaseOwner, now);
  } catch (error) {
    const connectorError = asConnectorError(error);
    const installation = findInstallation(job.installationId);
    const rawPayloadsToPersist = connectorError.rawPayloads ?? (connectorError.rawPayload ? [connectorError.rawPayload] : []);
    const parserVersion = installation && hasConnectorFor(installation.kind)
      ? connectorFor(installation).parserVersion
      : DJEN_PARSER_VERSION;
    for (const raw of rawPayloadsToPersist) {
      try {
        persistSnapshot({
          officeId: job.officeId,
          installationId: job.installationId,
          jobId: job.id,
          operation: job.operation,
          contentType: raw.contentType,
          body: raw.body,
          parserVersion,
          requestSummary: {
            windowFrom: job.windowFrom,
            windowTo: job.windowTo,
          },
          visibility: installation?.authKind === 'none' ? 'public' : 'restricted',
          usageConditions: installation?.permissions,
        });
      } catch {
        // Keep moving so job fails/quarantines even if secondary snapshot write fails
      }
    }

    const { retrying, terminalStatus } = failJob(job.id, leaseOwner, {
      code: connectorError.code,
      message: connectorError.message,
      retryAfterSeconds: connectorError.retryAfterSeconds,
    }, now);

    // A gap only becomes visible if it is recorded. A silent failure looks exactly like a court
    // that published nothing.
    if (!retrying) recordSyncFailureAlert(job.officeId, job.linkId, job.id, `Coleta interrompida: ${connectorError.message}`);
    recordAudit({
      officeId: job.officeId,
      actor: 'worker',
      action: 'judicial.collect',
      subjectKind: 'job',
      subjectId: job.id,
      installationId: job.installationId,
      outcome: 'error',
    });

    return {
      jobId: job.id,
      status: retrying ? 'retrying' : terminalStatus === 'quarantined' ? 'quarantined' : 'failed',
      inserted: 0, duplicates: 0, alerts: 0,
      detail: `${connectorError.code}: ${connectorError.message}`,
    };
  }
}

async function runJob(job: SyncJob, leaseOwner: string, now: number): Promise<CollectOutcome> {
  const installation = findInstallation(job.installationId);
  if (!installation) throw new ConnectorError('unsupported', 'A instalação desta coleta não existe mais.');
  if (!installation.enabled) throw new ConnectorError('human_action_required', 'A fonte foi desabilitada.');

  // Section 4.3: consulting the source is its own permission. A source whose terms were never
  // clarified is not collected from, however technically reachable it is.
  if (!permits(installation.permissions, 'query')) {
    throw new ConnectorError('human_action_required', 'A condição de uso desta fonte para consulta não está esclarecida.');
  }
  // Storing what comes back is a second permission, and without it there is nothing to collect.
  if (!permits(installation.permissions, 'cache')) {
    throw new ConnectorError('human_action_required', 'Esta fonte não autoriza armazenar as respostas coletadas.');
  }

  // The authorization is re-read here as well as in the scheduler: a job may sit in the queue
  // long enough for a membership or a link to be withdrawn after it was scheduled.
  if (job.subscriptionId) {
    const subscription = findSubscriptionById(job.subscriptionId);
    if (!subscription || subscription.status !== 'active') {
      completeJob(job.id, leaseOwner);
      return { jobId: job.id, status: 'skipped', inserted: 0, duplicates: 0, alerts: 0, detail: 'Assinatura inativa.' };
    }
    const authorized = subscriptionStillAuthorized(subscription);
    if (!authorized.ok) {
      // Same distinction the scheduler makes: waiting on a confirmation is not a revocation.
      if (!authorized.waiting) setSubscriptionStatus(subscription.officeId, subscription.id, 'suspended', authorized.reason);
      completeJob(job.id, leaseOwner);
      return { jobId: job.id, status: 'skipped', inserted: 0, duplicates: 0, alerts: 0, detail: authorized.reason };
    }
  }

  if (job.operation !== 'listChanges') {
    throw new ConnectorError('unsupported', `Operação ainda não implementada no coletor: ${job.operation}`);
  }
  if (!job.windowFrom || !job.windowTo) {
    throw new ConnectorError('unsupported', 'Coleta incremental exige uma janela.');
  }

  let requestCount = 0;
  const baseTransport = currentTransport();
  const budgetedTransport: Transport = {
    mode: baseTransport.mode,
    async request(inst, path, init) {
      while (true) {
        const budget = reserveRequestBudget(job.officeId, inst, Date.now());
        if (budget.allowed) break;
        if (requestCount > 0 && budget.reason === 'rate_limit' && budget.retryAfterMs <= 10_000) {
          await new Promise((resolve) => setTimeout(resolve, budget.retryAfterMs + 20));
          continue;
        }
        throw new ConnectorError(
          'rate_limited',
          budget.reason === 'daily_budget' ? 'Orçamento diário desta fonte esgotado.' : 'Intervalo mínimo entre requisições não respeitado.',
          Math.ceil(budget.retryAfterMs / 1000),
        );
      }
      requestCount += 1;
      return baseTransport.request(inst, path, init);
    },
  };

  const connector = connectorFor(installation, budgetedTransport);
  if (!connector.listChanges) throw new ConnectorError('unsupported', 'Este conector não oferece consulta incremental.');

  const cnjNumbers = Array.isArray(job.request.cnjNumbers)
    ? (job.request.cnjNumbers as unknown[]).filter((value): value is string => typeof value === 'string')
    : undefined;

  const result: ConnectorResult<NormalizedPublication> = await connector.listChanges(installation, {
    windowFrom: job.windowFrom,
    windowTo: job.windowTo,
    cursor: job.cursor,
    cnjNumbers,
    onRawPayload: (raw) => {
      persistSnapshot({
        officeId: job.officeId,
        installationId: installation.id,
        jobId: job.id,
        operation: job.operation,
        contentType: raw.contentType,
        body: raw.body,
        parserVersion: connector.parserVersion,
        requestSummary: {
          windowFrom: job.windowFrom,
          windowTo: job.windowTo,
        },
        visibility: installation.authKind === 'none' ? 'public' : 'restricted',
        usageConditions: installation.permissions,
      });
    },
  });

  renewLease(job.id, leaseOwner, Date.now());

  // The originals and the normalized rows commit together; the checkpoint moves only afterwards.
  const outcome = ingestPublications({
    officeId: job.officeId,
    installation,
    linkId: job.linkId,
    jobId: job.id,
    result,
    historical: job.kind === 'backfill',
  });

  checkpointJob(job.id, leaseOwner, {
    cursor: result.cursor,
    pagesFetched: result.coverage.pagesFetched,
    recordsAccepted: outcome.inserted,
    recordsRejected: result.coverage.rejected,
  });

  recordAudit({
    officeId: job.officeId,
    actor: 'worker',
    action: 'judicial.collect',
    subjectKind: 'job',
    subjectId: job.id,
    installationId: installation.id,
    outcome: 'ok',
  });

  // A truncated sweep is not finished. Leaving the job queued with its cursor is what makes the
  // next pass resume instead of restarting the window.
  if (result.cursor) {
    failJob(job.id, leaseOwner, { code: 'partial', message: 'Varredura interrompida no limite de páginas; continua no próximo ciclo.' }, now);
    return {
      jobId: job.id, status: 'retrying',
      inserted: outcome.inserted, duplicates: outcome.duplicates, alerts: outcome.alerts,
      detail: 'Coleta parcial; a varredura continua a partir do cursor.',
    };
  }

  completeJob(job.id, leaseOwner);
  if (job.subscriptionId) {
    // The watermark only advances on a complete, committed window.
    recordSubscriptionSuccess(job.subscriptionId, job.windowTo, Date.now());
  }

  return {
    jobId: job.id,
    status: 'completed',
    inserted: outcome.inserted,
    duplicates: outcome.duplicates,
    alerts: outcome.alerts,
    detail: `${outcome.inserted} nova(s), ${outcome.duplicates} já conhecida(s), ${result.coverage.rejected} rejeitada(s).`,
  };
}
