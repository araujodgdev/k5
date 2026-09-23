import 'server-only';
import { captureOperationalError } from '@/lib/observability/report';
import {
  ConnectorError, isWorkerSafe, permits,
  type ConnectorResult, type InstallationRef, type JudicialConnector, type NormalizedPublication,
} from '../contracts';
import { connectorFor, currentTransport, hasConnectorFor, DJEN_PARSER_VERSION, type Transport } from '../connectors';
import { findInstallation } from '../repositories/installations';
import { ingestPublications, persistSnapshot, recordSyncFailureAlert } from '../repositories/evidence';
import { ingestCase } from '../repositories/cases';
import { findCaseLink } from '../repositories/links';
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
  const claimed = await claimJob(now);
  if (!claimed) return undefined;
  const { job, leaseOwner } = claimed;

  try {
    return await runJob(job, leaseOwner, now);
  } catch (error) {
    captureOperationalError(error, 'judicial.collect');
    const connectorError = asConnectorError(error);
    const { owned, retrying, terminalStatus } = await failJob(job.id, leaseOwner, {
      code: connectorError.code,
      message: connectorError.message,
      retryAfterSeconds: connectorError.retryAfterSeconds,
    }, now);

    if (!owned) {
      return {
        jobId: job.id,
        status: 'skipped',
        inserted: 0, duplicates: 0, alerts: 0,
        detail: 'A coleta perdeu a posse da tarefa; o novo worker continuará o processamento.',
      };
    }

    const installation = await findInstallation(job.installationId);
    const rawPayloadsToPersist = connectorError.rawPayloads ?? (connectorError.rawPayload ? [connectorError.rawPayload] : []);
    const parserVersion = installation && hasConnectorFor(installation.kind)
      ? connectorFor(installation).parserVersion
      : DJEN_PARSER_VERSION;
    for (const raw of rawPayloadsToPersist) {
      try {
        await persistSnapshot({
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

    // A gap only becomes visible if it is recorded. A silent failure looks exactly like a court
    // that published nothing.
    if (!retrying) await recordSyncFailureAlert(job.officeId, job.linkId, job.id, `Coleta interrompida: ${connectorError.message}`);
    await recordAudit({
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
  const retainLease = async () => {
    if (!await renewLease(job.id, leaseOwner, Date.now())) {
      throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
    }
  };

  const installation = await findInstallation(job.installationId);
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

  await retainLease();

  // The authorization is re-read here as well as in the scheduler: a job may sit in the queue
  // long enough for a membership or a link to be withdrawn after it was scheduled.
  if (job.subscriptionId) {
    const subscription = await findSubscriptionById(job.subscriptionId);
    if (!subscription || subscription.status !== 'active') {
      if (!await completeJob(job.id, leaseOwner)) {
        throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
      }
      return { jobId: job.id, status: 'skipped', inserted: 0, duplicates: 0, alerts: 0, detail: 'Assinatura inativa.' };
    }
    const authorized = await subscriptionStillAuthorized(subscription);
    if (!authorized.ok) {
      // Same distinction the scheduler makes: waiting on a confirmation is not a revocation.
      if (!authorized.waiting) await setSubscriptionStatus(subscription.officeId, subscription.id, 'suspended', authorized.reason);
      if (!await completeJob(job.id, leaseOwner)) {
        throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
      }
      return { jobId: job.id, status: 'skipped', inserted: 0, duplicates: 0, alerts: 0, detail: authorized.reason };
    }
  }

  // Section 8: only a neutral query runs unattended. An operation the connector does not declare,
  // or declares with a possible legal effect, is skipped before any request is spent.
  const declared = connectorFor(installation).describeCapabilities(installation).operations
    .find((entry) => entry.operation === job.operation);
  if (!declared?.supported || !isWorkerSafe(declared.effect)) {
    if (!await completeJob(job.id, leaseOwner)) {
      throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
    }
    await recordAudit({
      officeId: job.officeId, actor: 'worker', action: 'judicial.collect', subjectKind: 'job',
      subjectId: job.id, installationId: installation.id, outcome: 'denied',
    });
    return {
      jobId: job.id, status: 'skipped', inserted: 0, duplicates: 0, alerts: 0,
      detail: `Operação ${job.operation} não é uma consulta neutra suportada por esta fonte; não executada.`,
    };
  }

  let requestCount = 0;
  const baseTransport = currentTransport();
  const budgetedTransport: Transport = {
    mode: baseTransport.mode,
    async request(inst, path, init) {
      while (true) {
        await retainLease();
        const budget = await reserveRequestBudget(job.officeId, inst, Date.now());
        if (budget.allowed) break;
        if (requestCount > 0 && budget.reason === 'rate_limit') {
          await new Promise((resolve) => setTimeout(resolve, budget.retryAfterMs + 20));
          await retainLease();
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

  // The operation decides the path, never the kind of source: a second court with a different
  // contract reaches the same branch through its own connector.
  if (job.operation === 'lookupCase') return await runLookupCase(job, leaseOwner, installation, connector, retainLease);
  if (job.operation !== 'listChanges') {
    throw new ConnectorError('unsupported', `Operação ainda não implementada no coletor: ${job.operation}`);
  }
  if (!job.windowFrom || !job.windowTo) {
    throw new ConnectorError('unsupported', 'Coleta incremental exige uma janela.');
  }
  if (!connector.listChanges) throw new ConnectorError('unsupported', 'Este conector não oferece consulta incremental.');

  const cnjNumbers = Array.isArray(job.request.cnjNumbers)
    ? (job.request.cnjNumbers as unknown[]).filter((value): value is string => typeof value === 'string')
    : undefined;

  const result: ConnectorResult<NormalizedPublication> = await connector.listChanges(installation, {
    windowFrom: job.windowFrom,
    windowTo: job.windowTo,
    cursor: job.cursor,
    cnjNumbers,
    onRawPayload: async (raw) => {
      await retainLease();
      await persistSnapshot({
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

  await retainLease();

  // The originals and the normalized rows commit together; the checkpoint moves only afterwards.
  const outcome = await ingestPublications({
    officeId: job.officeId,
    installation,
    linkId: job.linkId,
    jobId: job.id,
    result,
    historical: job.kind === 'backfill',
  });

  await retainLease();
  if (!await checkpointJob(job.id, leaseOwner, {
    cursor: result.cursor,
    pagesFetched: result.coverage.pagesFetched,
    recordsAccepted: outcome.inserted,
    recordsRejected: result.coverage.rejected,
  })) {
    throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de salvar o progresso.');
  }

  // A truncated sweep is not finished. Leaving the job queued with its cursor is what makes the
  // next pass resume instead of restarting the window.
  if (result.cursor) {
    const failed = await failJob(job.id, leaseOwner, { code: 'partial', message: 'Varredura interrompida no limite de páginas; continua no próximo ciclo.' }, now);
    if (!failed.owned) {
      throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de reagendar a continuação.');
    }
    await recordAudit({
      officeId: job.officeId,
      actor: 'worker',
      action: 'judicial.collect',
      subjectKind: 'job',
      subjectId: job.id,
      installationId: installation.id,
      outcome: 'ok',
    });
    return {
      jobId: job.id, status: 'retrying',
      inserted: outcome.inserted, duplicates: outcome.duplicates, alerts: outcome.alerts,
      detail: 'Coleta parcial; a varredura continua a partir do cursor.',
    };
  }

  if (!await completeJob(job.id, leaseOwner)) {
    throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
  }
  if (job.subscriptionId) {
    // The watermark only advances on a complete, committed window.
    await recordSubscriptionSuccess(job.subscriptionId, job.windowTo, Date.now());
  }

  await recordAudit({
    officeId: job.officeId,
    actor: 'worker',
    action: 'judicial.collect',
    subjectKind: 'job',
    subjectId: job.id,
    installationId: installation.id,
    outcome: 'ok',
  });

  return {
    jobId: job.id,
    status: 'completed',
    inserted: outcome.inserted,
    duplicates: outcome.duplicates,
    alerts: outcome.alerts,
    detail: `${outcome.inserted} nova(s), ${outcome.duplicates} já conhecida(s), ${result.coverage.rejected} rejeitada(s).`,
  };
}

/**
 * One case lookup: header and movements of the linked proceeding. The identity comes from the
 * confirmed link, never from the job payload, so a queued job cannot be aimed at another number.
 */
async function runLookupCase(
  job: SyncJob,
  leaseOwner: string,
  installation: InstallationRef,
  connector: JudicialConnector,
  retainLease: () => Promise<void>,
): Promise<CollectOutcome> {
  if (!job.linkId) throw new ConnectorError('unsupported', 'Consulta de processo exige um vínculo.');
  const link = await findCaseLink(job.officeId, job.linkId);
  if (!link || link.status !== 'active' || link.confirmation !== 'confirmed') {
    throw new ConnectorError('human_action_required', 'O vínculo deste processo não está ativo e confirmado.');
  }
  if (!connector.lookupCase) throw new ConnectorError('unsupported', 'Este conector não consulta processos.');

  // ponytail: no credential yet. Nothing decrypts judicial_connection.secret_ref today, so a source
  // that requires one answers human_action_required here; wiring it is part of A6.
  const result = await connector.lookupCase(installation, {
    identity: { cnjNumber: link.cnjNumber, nativeNumber: link.nativeNumber, degree: link.degree },
  });

  await retainLease();
  const outcome = await ingestCase({ officeId: job.officeId, installation, linkId: link.id, jobId: job.id, result });

  await retainLease();
  if (!await checkpointJob(job.id, leaseOwner, {
    cursor: null,
    pagesFetched: result.coverage.pagesFetched,
    recordsAccepted: outcome.inserted,
    recordsRejected: result.coverage.rejected,
  }) || !await completeJob(job.id, leaseOwner)) {
    throw new ConnectorError('partial', 'A coleta perdeu a posse da tarefa antes de concluir.');
  }
  if (job.subscriptionId) await recordSubscriptionSuccess(job.subscriptionId, result.source.collectedAt.slice(0, 10), Date.now());

  await recordAudit({
    officeId: job.officeId, actor: 'worker', action: 'judicial.collect', subjectKind: 'job',
    subjectId: job.id, installationId: installation.id, outcome: 'ok',
  });

  return {
    jobId: job.id,
    status: 'completed',
    inserted: outcome.inserted,
    duplicates: outcome.duplicates,
    alerts: outcome.alerts,
    detail: outcome.baselines
      ? `${outcome.inserted} movimento(s) gravado(s) como linha de base, sem alertas.`
      : `${outcome.inserted} movimento(s) novo(s), ${outcome.duplicates} já conhecido(s), ${result.coverage.rejected} rejeitado(s).`,
  };
}
