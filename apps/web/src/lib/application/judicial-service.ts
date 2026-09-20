import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { ConnectorError, permits, type Degree, type InstallationRef } from '@/lib/judicial/contracts';
import { hasConnectorFor } from '@/lib/judicial/connectors';
import { findInstallation, listInstallations } from '@/lib/judicial/repositories/installations';
import {
  confirmCaseLink, createCaseLink, findCaseLink, listCaseLinks, unlinkCase, type CaseLink,
} from '@/lib/judicial/repositories/links';
import {
  findPublication, listAlerts, listPublications, markAlertRead, type PublicationSummary,
} from '@/lib/judicial/repositories/evidence';
import { enqueueJob, findJob, type SyncJob } from '@/lib/judicial/jobs/queue';
import { recordAudit } from '@/lib/judicial/repositories/audit';
import { parseCnjNumber } from '@/lib/judicial/normalization/cnj';
import { nowIso, overlappingWindow } from '@/lib/judicial/normalization/dates';

/**
 * Business operations over judicial data. Everything here derives the office and the role from
 * the trusted context; nothing accepts an office id, a host, a URL or a credential from a caller.
 *
 * The UI, the HTTP routes and the agent tools all land on these functions, so an isolation rule
 * cannot hold on one path and be missing on another.
 */

function requireLink(context: WorkspaceContext, linkId: string): CaseLink {
  const link = findCaseLink(context.officeId, linkId);
  if (!link) throw new CapabilityError('NOT_FOUND', 'Vínculo não encontrado neste escritório.');
  return link;
}

function requireInstallation(installationId: string): InstallationRef {
  const installation = findInstallation(installationId);
  if (!installation) throw new CapabilityError('NOT_FOUND', 'Fonte judicial não encontrada.');
  return installation;
}

function toSourceDto(installation: InstallationRef) {
  return {
    id: installation.id,
    courtCode: installation.courtCode,
    courtName: installation.courtName,
    kind: installation.kind,
    degree: installation.degree,
    system: installation.system,
    purpose: installation.purpose,
    discoveryStatus: installation.discoveryStatus,
    enabled: installation.enabled,
    liveTransportEnabled: installation.liveTransportEnabled,
    permissions: installation.permissions,
    coverage: installation.coverage,
    hasConnector: hasConnectorFor(installation.kind),
  };
}

function toLinkDto(link: CaseLink) {
  return {
    id: link.id,
    caseId: link.caseId,
    caseName: link.caseName,
    installationId: link.installationId,
    courtCode: link.courtCode,
    courtName: link.courtName,
    cnjNumber: link.cnjNumber,
    nativeNumber: link.nativeNumber,
    degree: link.degree,
    confirmation: link.confirmation,
    status: link.status,
    createdAt: link.createdAt,
  };
}

function toPublicationDto(publication: PublicationSummary) {
  return {
    id: publication.id,
    installationId: publication.installationId,
    courtCode: publication.courtCode,
    courtName: publication.courtName,
    linkId: publication.linkId,
    caseId: publication.caseId,
    caseName: publication.caseName,
    cnjNumber: publication.cnjNumber,
    edition: publication.edition,
    page: publication.page,
    madeAvailableOn: publication.madeAvailableOn,
    publishedOn: publication.publishedOn,
    revisionKind: publication.revisionKind,
    supersedesId: publication.supersedesId,
    collectedAt: publication.collectedAt,
    excerpt: publication.excerpt,
  };
}

function toJobDto(job: SyncJob) {
  return {
    id: job.id,
    installationId: job.installationId,
    kind: job.kind,
    operation: job.operation,
    status: job.status,
    windowFrom: job.windowFrom,
    windowTo: job.windowTo,
    attempts: job.attempts,
    pagesFetched: job.pagesFetched,
    recordsAccepted: job.recordsAccepted,
    recordsRejected: job.recordsRejected,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export function listJudicialSources(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_list_sources'>,
): CapabilityOutput<'k5_judicial_list_sources'> {
  void context;
  const sources = listInstallations({ purpose: input.purpose, enabledOnly: input.enabledOnly ?? false });
  return { sources: sources.map(toSourceDto) };
}

export function listJudicialLinks(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_list_links'>,
): CapabilityOutput<'k5_judicial_list_links'> {
  const links = listCaseLinks(context.officeId, {
    caseId: input.caseId,
    activeOnly: input.activeOnly ?? true,
    limit: input.limit ?? 20,
    cursor: input.cursor,
  });
  return { links: links.map(toLinkDto) };
}

/**
 * Proposes a link. It is deliberately not possible to create a confirmed link here: confirmation
 * is what authorizes recurring queries against a court, and the plan keeps that with a person.
 */
export function linkJudicialCase(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_link_case'>,
): CapabilityOutput<'k5_judicial_link_case'> {
  const vaultCase = database.prepare('SELECT id FROM vault_case WHERE id = ? AND office_id = ? AND deleted_at IS NULL')
    .get(input.caseId, context.officeId);
  if (!vaultCase) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado no Cofre deste escritório.');

  const installation = requireInstallation(input.installationId);
  if (installation.purpose === 'vocabulary') {
    throw new CapabilityError('INVALID', 'Esta fonte é um vocabulário e não acompanha processos.');
  }

  const parsed = parseCnjNumber(input.number);
  const cnjNumber = parsed.ok ? parsed.normalized : null;
  // A number that fails its check digits is still a real proceeding somewhere; it is kept as the
  // source's own identity instead of being rejected or promoted onto the CNJ index.
  const nativeNumber = parsed.ok ? null : input.number.trim();

  const { link, created } = createCaseLink({
    officeId: context.officeId,
    userId: context.userId,
    caseId: input.caseId,
    installationId: installation.id,
    cnjNumber,
    nativeNumber,
    degree: (input.degree ?? 'first') as Degree,
    confirmed: false,
  });

  recordAudit({
    officeId: context.officeId, userId: context.userId, actor: 'user',
    action: 'judicial.link_case', subjectKind: 'link', subjectId: link.id, installationId: installation.id,
  });

  return { link: toLinkDto(link), created, numberKind: parsed.ok ? 'cnj' : 'native' };
}

export function confirmJudicialLink(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_confirm_link'>,
): CapabilityOutput<'k5_judicial_confirm_link'> {
  requireLink(context, input.linkId);
  const link = confirmCaseLink(context.officeId, input.linkId, context.userId, input.decision);
  if (!link) throw new CapabilityError('NOT_FOUND', 'Vínculo não encontrado neste escritório.');

  recordAudit({
    officeId: context.officeId, userId: context.userId, actor: 'user',
    action: `judicial.link_${input.decision}`, subjectKind: 'link', subjectId: link.id,
    installationId: link.installationId,
  });

  return { link: toLinkDto(link) };
}

export function unlinkJudicialCase(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_unlink_case'>,
): CapabilityOutput<'k5_judicial_unlink_case'> {
  const link = requireLink(context, input.linkId);
  const success = unlinkCase(context.officeId, input.linkId);
  recordAudit({
    officeId: context.officeId, userId: context.userId, actor: 'user',
    action: 'judicial.unlink_case', subjectKind: 'link', subjectId: link.id, installationId: link.installationId,
  });
  return { success };
}

export function listJudicialPublications(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_list_publications'>,
): CapabilityOutput<'k5_judicial_list_publications'> {
  // Filtering by a link from another office must return nothing, not that office's publications.
  if (input.linkId) requireLink(context, input.linkId);
  const publications = listPublications(context.officeId, {
    caseId: input.caseId, linkId: input.linkId, limit: input.limit ?? 20,
  });
  return { publications: publications.map(toPublicationDto), untrustedContent: true };
}

/**
 * Opens one publication. `untrustedContent` travels with the body on purpose: the text is a
 * third-party document, and a gazette entry that contains something shaped like an instruction is
 * still just text that was published.
 */
export function getJudicialPublication(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_get_publication'>,
): CapabilityOutput<'k5_judicial_get_publication'> {
  const publication = findPublication(context.officeId, input.publicationId);
  if (!publication) throw new CapabilityError('NOT_FOUND', 'Publicação não encontrada neste escritório.');

  recordAudit({
    officeId: context.officeId, userId: context.userId, actor: 'user',
    action: 'judicial.open_publication', subjectKind: 'publication', subjectId: publication.id,
    installationId: publication.installationId,
  });

  return {
    publication: toPublicationDto(publication),
    body: publication.body,
    snapshotId: publication.snapshotId,
    untrustedContent: true,
  };
}

/**
 * Queues a manual refresh. The window, the filters and the installation are all derived from the
 * confirmed link, so a caller cannot widen the sweep or aim it at a different court.
 */
export function requestJudicialRefresh(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_request_refresh'>,
): CapabilityOutput<'k5_judicial_request_refresh'> {
  const link = requireLink(context, input.linkId);
  if (link.status !== 'active') throw new CapabilityError('CONFLICT', 'Este vínculo não está ativo.');
  if (link.confirmation !== 'confirmed') {
    throw new CapabilityError('APPROVAL_REQUIRED', 'Confirme o vínculo antes de solicitar atualização desta fonte.');
  }
  if (!link.cnjNumber) {
    throw new CapabilityError('SCOPE_REQUIRED', 'Esta fonte consulta por número CNJ; o vínculo tem apenas identidade nativa.');
  }

  const installation = requireInstallation(link.installationId);
  if (!installation.enabled) throw new CapabilityError('NOT_READY', 'Esta fonte está desabilitada.');
  if (!hasConnectorFor(installation.kind)) {
    throw new CapabilityError('NOT_READY', 'Ainda não há conector implementado para este tipo de fonte.');
  }
  if (!permits(installation.permissions, 'query') || !permits(installation.permissions, 'cache')) {
    throw new CapabilityError('NOT_READY', 'A condição de uso desta fonte ainda não autoriza consulta e armazenamento.');
  }

  const window = overlappingWindow(null, nowIso(), 2);
  const { job, created } = enqueueJob({
    officeId: context.officeId,
    installationId: installation.id,
    linkId: link.id,
    kind: 'manual',
    operation: 'listChanges',
    request: { cnjNumbers: [link.cnjNumber] },
    windowFrom: window.from,
    windowTo: window.to,
    // A second "Atualizar" while the first is still pending reuses it instead of spending another
    // request against the source's budget.
    idempotencyKey: `manual:${link.id}:${window.from}:${window.to}`,
  });

  recordAudit({
    officeId: context.officeId, userId: context.userId, actor: 'user',
    action: 'judicial.request_refresh', subjectKind: 'job', subjectId: job.id, installationId: installation.id,
  });

  return { job: toJobDto(job), created };
}

export function getJudicialJob(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_get_job'>,
): CapabilityOutput<'k5_judicial_get_job'> {
  const job = findJob(context.officeId, input.jobId);
  if (!job) throw new CapabilityError('NOT_FOUND', 'Coleta não encontrada neste escritório.');
  return { job: toJobDto(job) };
}

export function listJudicialAlerts(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_list_alerts'>,
): CapabilityOutput<'k5_judicial_list_alerts'> {
  const rows = listAlerts(context.officeId, { unreadOnly: input.unreadOnly ?? false, limit: input.limit ?? 20 });
  return {
    alerts: rows.map((row) => ({
      id: row.id,
      eventKind: row.event_kind as CapabilityOutput<'k5_judicial_list_alerts'>['alerts'][number]['eventKind'],
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      summary: row.summary,
      caseId: row.case_id,
      caseName: row.case_name,
      read: row.read_at !== null,
      createdAt: row.created_at,
    })),
  };
}

export function markJudicialAlertRead(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_judicial_mark_alert_read'>,
): CapabilityOutput<'k5_judicial_mark_alert_read'> {
  return { success: markAlertRead(context.officeId, input.alertId) };
}

/** Connector failures reach the product as stable domain codes, never as a provider message. */
export function asCapabilityErrorFromConnector(error: unknown): unknown {
  if (!(error instanceof ConnectorError)) return error;
  switch (error.code) {
    case 'unauthorized':
    case 'forbidden':
      return new CapabilityError('FORBIDDEN', 'A fonte recusou o acesso. Verifique a credencial ou a habilitação.');
    case 'rate_limited':
      return new CapabilityError('RATE_LIMITED', 'Limite de consultas desta fonte atingido. Tente mais tarde.');
    case 'not_found_in_source':
      return new CapabilityError('NOT_FOUND', 'Não encontrado nesta fonte. Isso não conclui que o processo não existe.');
    case 'human_action_required':
      return new CapabilityError('APPROVAL_REQUIRED', error.message);
    case 'unsupported':
      return new CapabilityError('INVALID', error.message);
    default:
      return new CapabilityError('NOT_READY', 'A fonte está indisponível ou respondeu de forma inesperada.');
  }
}
