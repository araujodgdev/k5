import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import {
  ConnectorError,
  type ConnectorOperation,
  type ConnectorResult,
  type InstallationRef,
  type NormalizedPublication,
} from '../contracts';
import { alertDedupeKey, payloadHash, publicationFingerprint } from '../normalization/fingerprint';
import { nowIso } from '../normalization/dates';

/**
 * Persistence of collected evidence. The whole point of this module is that one collection run
 * lands atomically: raw payloads, source records, publications and the outbox rows that announce
 * them all commit together, or none of them do.
 */

export type IngestOutcome = {
  snapshotIds: string[];
  inserted: number;
  /** Already present under the same fingerprint. A retry lands here, which is the intent. */
  duplicates: number;
  /** Republications and errata: new rows related to an earlier version, never overwrites. */
  revisions: number;
  alerts: number;
};

/** Keeps a snapshot inline while it is small, which is every DJEN page in practice. */
const INLINE_PAYLOAD_LIMIT = 512 * 1024;

export type IngestPublicationsInput = {
  officeId: string;
  installation: InstallationRef;
  linkId: string | null;
  jobId: string | null;
  result: ConnectorResult<NormalizedPublication>;
  /**
   * A backfill announces history, not news. Section 7 step 7: newly found old records must not
   * become a storm of "today's updates".
   */
  historical: boolean;
};

async function resolveLinkForPublication(
  officeId: string,
  installationId: string,
  cnjNumber: string | null,
  fallbackLinkId: string | null,
): Promise<string | null> {
  if (cnjNumber) {
    const row = await database.prepare(`
      SELECT id FROM judicial_case_link
      WHERE office_id = ? AND installation_id = ? AND cnj_number = ?
        AND status = 'active' AND confirmation = 'confirmed'
      ORDER BY created_at DESC LIMIT 1
    `).get(officeId, installationId, cnjNumber) as { id: string } | undefined;
    if (row) return row.id;
  }
  return fallbackLinkId;
}

export async function persistSnapshot(input: {
  officeId: string;
  installationId: string;
  jobId: string | null;
  operation: ConnectorOperation;
  contentType: string;
  body: string;
  parserVersion?: string;
  requestSummary?: Record<string, unknown>;
  visibility?: 'public' | 'restricted';
  usageConditions?: Record<string, unknown>;
  collectedAt?: string;
}): Promise<string> {
  const hash = payloadHash(input.body);
  const existing = await database.prepare(
    'SELECT id FROM judicial_snapshot WHERE office_id = ? AND installation_id = ? AND sha256 = ? LIMIT 1',
  ).get(input.officeId, input.installationId, hash) as { id: string } | undefined;
  if (existing) {
    if (input.jobId) {
      await database.prepare('UPDATE judicial_snapshot SET job_id = COALESCE(job_id, ?) WHERE id = ?')
        .run(input.jobId, existing.id);
    }
    return existing.id;
  }

  const oversized = Buffer.byteLength(input.body) > INLINE_PAYLOAD_LIMIT;
  if (oversized) {
    throw new ConnectorError('partial', 'Payload acima de 512 KiB recusado: armazenamento de objetos não disponível para snapshots.');
  }

  const id = randomUUID();
  await database.prepare(`
    INSERT INTO judicial_snapshot (
      id, office_id, installation_id, job_id, operation, request_summary,
      payload, storage_key, content_type, byte_size, sha256, parser_version,
      collected_at, visibility, usage_conditions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.officeId, input.installationId, input.jobId, input.operation,
    JSON.stringify(input.requestSummary ?? {}),
    input.body,
    null,
    input.contentType, Buffer.byteLength(input.body), hash,
    input.parserVersion ?? 'unknown', input.collectedAt ?? nowIso(),
    input.visibility ?? 'restricted',
    JSON.stringify(input.usageConditions ?? {}),
  );
  return id;
}

async function insertSnapshots(input: IngestPublicationsInput): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of input.result.rawPayloads) {
    const id = await persistSnapshot({
      officeId: input.officeId,
      installationId: input.installation.id,
      jobId: input.jobId,
      operation: input.result.source.operation,
      contentType: raw.contentType,
      body: raw.body,
      parserVersion: input.result.source.parserVersion,
      requestSummary: {
        windowFrom: input.result.coverage.windowFrom,
        windowTo: input.result.coverage.windowTo,
        pagesFetched: input.result.coverage.pagesFetched,
      },
      collectedAt: input.result.source.collectedAt,
      visibility: input.installation.authKind === 'none' ? 'public' : 'restricted',
      usageConditions: input.installation.permissions,
    });
    ids.push(id);
  }
  return ids;
}

async function upsertSourceRecord(input: IngestPublicationsInput, publication: NormalizedPublication, sourceId: string, linkId: string | null): Promise<string> {
  const id = randomUUID();
  await database.prepare(`
    INSERT INTO judicial_source_record (
      id, office_id, installation_id, link_id, source_record_id, record_kind,
      cnj_number, native_number, source_updated_at
    ) VALUES (?, ?, ?, ?, ?, 'publication', ?, NULL, ?)
    ON CONFLICT(office_id, installation_id, source_record_id) DO UPDATE SET
      last_seen_at = CURRENT_TIMESTAMP,
      link_id = COALESCE(judicial_source_record.link_id, excluded.link_id),
      source_updated_at = COALESCE(excluded.source_updated_at, judicial_source_record.source_updated_at)
  `).run(id, input.officeId, input.installation.id, linkId, sourceId, publication.cnjNumber, publication.sourceUpdatedAt);

  const row = await database.prepare(
    'SELECT id FROM judicial_source_record WHERE office_id = ? AND installation_id = ? AND source_record_id = ?',
  ).get(input.officeId, input.installation.id, sourceId) as { id: string };
  return row.id;
}

/**
 * Commits one collection run.
 *
 * There is no enclosing transaction, because the run reads between its writes — resolving a link,
 * looking up the entry a correction supersedes — and D1 has no interactive transaction to hold
 * across that. What replaces it is ordering plus idempotency:
 *
 * - Snapshots are written first, so a publication can never exist without the evidence it came
 *   from. A crash after them leaves snapshots with no publication, which is spare evidence, not a
 *   publication nobody can trace.
 * - Each publication is written before its alert, so an alert can never point at a row that was
 *   never written. A crash between them loses an inbox entry, not a record.
 * - Every write is idempotent — publications on their fingerprint, alerts on their dedupe key —
 *   so the next pass over the same window finishes what an interrupted one started. The refresh
 *   window deliberately overlaps for exactly this reason.
 */
export async function ingestPublications(input: IngestPublicationsInput): Promise<IngestOutcome> {
  const outcome: IngestOutcome = { snapshotIds: [], inserted: 0, duplicates: 0, revisions: 0, alerts: 0 };

  outcome.snapshotIds = await insertSnapshots(input);

  if (!outcome.snapshotIds.length && input.result.items.length) {
    throw new Error('Publicação sem snapshot de origem; a coleta não pode ser publicada.');
  }

  const followersByLink = new Map<string | null, { caseId: string | null; followers: { user_id: string }[] }>();
  for (const publication of input.result.items) {
    const snapshotId = (publication.rawPayloadIndex !== undefined && outcome.snapshotIds[publication.rawPayloadIndex])
      ? outcome.snapshotIds[publication.rawPayloadIndex]
      : (outcome.snapshotIds[0] ?? null);

    if (!snapshotId) {
      throw new Error('Publicação sem snapshot de origem; a coleta não pode ser publicada.');
    }

    const resolvedLinkId = await resolveLinkForPublication(input.officeId, input.installation.id, publication.cnjNumber, input.linkId);

    const fingerprint = publicationFingerprint(publication);
    const sourceId = publication.sourcePublicationId ?? fingerprint.value;
    const recordId = await upsertSourceRecord(input, publication, sourceId, resolvedLinkId);

    // The earlier version of a corrected entry, matched on the proceeding and the edition.
    const supersedes = publication.revisionKind === 'original' ? null : (await database.prepare(
      `SELECT id FROM judicial_publication
       WHERE office_id = ? AND installation_id = ? AND COALESCE(cnj_number,'') = ?
         AND COALESCE(edition,'') = ? AND revision_kind = 'original'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(input.officeId, input.installation.id, publication.cnjNumber ?? '', publication.edition ?? '') as { id: string } | undefined)?.id ?? null;

    const id = randomUUID();
    const alertId = randomUUID();
    const eventKind = publication.revisionKind !== 'original'
      ? 'correction'
      : input.historical ? 'historical_publication' : 'new_publication';
    let audience = followersByLink.get(resolvedLinkId);
    if (!audience) {
      const caseId = resolvedLinkId ? (await database.prepare(
        'SELECT case_id FROM judicial_case_link WHERE id=? AND office_id=?',
      ).get(resolvedLinkId, input.officeId) as { case_id: string } | undefined)?.case_id ?? null : null;
      const followers = caseId ? await database.prepare(`SELECT f.user_id FROM notification_follow f
        JOIN office_member m ON m.office_id=f.office_id AND m.user_id=f.user_id
        WHERE f.office_id=? AND f.case_id=? AND f.ended_at IS NULL`)
        .all<{ user_id: string }>(input.officeId, caseId) : [];
      audience = { caseId, followers };
      followersByLink.set(resolvedLinkId, audience);
    }
    const { caseId, followers } = audience;
    const summary = summarize(input.installation, publication);
    const fingerprintKey = alertDedupeKey(eventKind, 'publication', fingerprint.value);
    const results = await database.batch([database.prepare(`
      INSERT INTO judicial_publication (
        id, office_id, installation_id, record_id, link_id, snapshot_id, source_publication_id,
        cnj_number, edition, page, official_hash, body,
        made_available_on, published_on, source_updated_at,
        version, supersedes_id, revision_kind, fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(office_id, installation_id, fingerprint) DO NOTHING
    `).bind(
      id, input.officeId, input.installation.id, recordId, resolvedLinkId, snapshotId,
      publication.sourcePublicationId, publication.cnjNumber, publication.edition, publication.page,
      publication.officialHash, publication.body,
      publication.madeAvailableOn, publication.publishedOn, publication.sourceUpdatedAt,
      supersedes ? 2 : 1, supersedes, publication.revisionKind, fingerprint.value,
    ), database.prepare(`INSERT INTO judicial_alert(
      id,office_id,link_id,event_kind,subject_kind,subject_id,summary,dedupe_key
    ) SELECT ?,?,?,?,'publication',?,?,? WHERE EXISTS(
      SELECT 1 FROM judicial_publication WHERE id=? AND office_id=?
    ) ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
      alertId, input.officeId, resolvedLinkId, eventKind, id, summary, fingerprintKey, id, input.officeId,
    ), database.prepare(`INSERT INTO notification_event(
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
    ) SELECT ?,?,?,1,'judicial_alert',?,1,NULL,?,?,?,?,?,?,? WHERE json_array_length(?)>0
      AND EXISTS(SELECT 1 FROM judicial_alert WHERE id=? AND office_id=?)
      ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
      randomUUID(), input.officeId,
      publication.revisionKind === 'original' ? 'judicial.publication.new' : 'judicial.publication.corrected',
      alertId, JSON.stringify(followers.map((item) => item.user_id)), JSON.stringify({ caseId }),
      `notification:${fingerprintKey}`, input.historical ? 1 : 0, input.historical ? 0 : 1,
      nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      JSON.stringify(followers.map((item) => item.user_id)), alertId, input.officeId,
    )]);

    if (!results[0].changes) { outcome.duplicates += 1; continue; }
    outcome.inserted += 1;
    if (publication.revisionKind !== 'original') outcome.revisions += 1;
    if (results[1].changes) outcome.alerts += 1;
  }
  return outcome;
}

/** One pt-BR line for the internal inbox. Never a claim that this replaces an official intimation. */
function summarize(installation: InstallationRef, publication: NormalizedPublication): string {
  const when = publication.madeAvailableOn ?? publication.publishedOn ?? 'data não informada';
  const label = publication.revisionKind === 'errata' ? 'Errata' : publication.revisionKind === 'republication' ? 'Republicação' : 'Publicação';
  return `${label} em ${installation.courtName}, disponibilizada em ${when}.`;
}

export type PublicationSummary = {
  id: string;
  installationId: string;
  courtCode: string;
  courtName: string;
  linkId: string | null;
  caseId: string | null;
  caseName: string | null;
  cnjNumber: string | null;
  edition: string | null;
  page: string | null;
  madeAvailableOn: string | null;
  publishedOn: string | null;
  revisionKind: 'original' | 'republication' | 'errata';
  supersedesId: string | null;
  snapshotId: string;
  collectedAt: string;
  excerpt: string;
};

const SELECT_PUBLICATION = `
  SELECT p.id, p.installation_id, i.court_code, i.court_name, p.link_id, l.case_id, c.name AS case_name,
         p.cnj_number, p.edition, p.page, p.made_available_on, p.published_on, p.revision_kind,
         p.supersedes_id, p.snapshot_id, s.collected_at, p.body
  FROM judicial_publication p
  JOIN judicial_source_installation i ON i.id = p.installation_id
  JOIN judicial_snapshot s ON s.id = p.snapshot_id
  LEFT JOIN judicial_case_link l ON l.id = p.link_id
  LEFT JOIN vault_case c ON c.id = l.case_id
`;

type PublicationRow = {
  id: string; installation_id: string; court_code: string; court_name: string;
  link_id: string | null; case_id: string | null; case_name: string | null;
  cnj_number: string | null; edition: string | null; page: string | null;
  made_available_on: string | null; published_on: string | null; revision_kind: string;
  supersedes_id: string | null; snapshot_id: string; collected_at: string; body: string;
};

function toSummary(row: PublicationRow, excerptLength: number): PublicationSummary {
  return {
    id: row.id,
    installationId: row.installation_id,
    courtCode: row.court_code,
    courtName: row.court_name,
    linkId: row.link_id,
    caseId: row.case_id,
    caseName: row.case_name,
    cnjNumber: row.cnj_number,
    edition: row.edition,
    page: row.page,
    madeAvailableOn: row.made_available_on,
    publishedOn: row.published_on,
    revisionKind: row.revision_kind as PublicationSummary['revisionKind'],
    supersedesId: row.supersedes_id,
    snapshotId: row.snapshot_id,
    collectedAt: row.collected_at,
    excerpt: row.body.length > excerptLength ? `${row.body.slice(0, excerptLength).trimEnd()}…` : row.body,
  };
}

export async function listPublications(
  officeId: string,
  filter: { caseId?: string; linkId?: string; installationId?: string; limit?: number } = {},
): Promise<PublicationSummary[]> {
  const clauses = ['p.office_id = ?'];
  const params: (string | number | null)[] = [officeId];
  if (filter.caseId) { clauses.push('l.case_id = ?'); params.push(filter.caseId); }
  if (filter.linkId) { clauses.push('p.link_id = ?'); params.push(filter.linkId); }
  if (filter.installationId) { clauses.push('p.installation_id = ?'); params.push(filter.installationId); }
  const limit = Math.max(1, Math.min(filter.limit ?? 25, 100));
  const rows = await database.prepare(
    `${SELECT_PUBLICATION} WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(p.made_available_on, p.published_on) DESC, p.created_at DESC LIMIT ?`,
  ).all(...params, limit) as PublicationRow[];
  return rows.map((row) => toSummary(row, 400));
}

export async function findPublication(officeId: string, publicationId: string): Promise<(PublicationSummary & { body: string }) | undefined> {
  const row = await database.prepare(`${SELECT_PUBLICATION} WHERE p.id = ? AND p.office_id = ?`)
    .get(publicationId, officeId) as PublicationRow | undefined;
  if (!row) return undefined;
  return { ...toSummary(row, 400), body: row.body };
}

/** Unread items for the internal inbox, newest first. Delivery outside Lume is a separate step. */
export async function listAlerts(
  officeId: string,
  options: { caseId?: string; installationId?: string; unreadOnly?: boolean; limit?: number } = {},
) {
  const clauses = ['a.office_id = ?'];
  const params: (string | number | null)[] = [officeId];
  if (options.caseId) { clauses.push('l.case_id = ?'); params.push(options.caseId); }
  if (options.installationId) {
    clauses.push('COALESCE(p.installation_id, j.installation_id, l.installation_id) = ?');
    params.push(options.installationId);
  }
  if (options.unreadOnly) clauses.push('a.read_at IS NULL');
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  return await database.prepare(`
    SELECT a.id, a.event_kind, a.subject_kind, a.subject_id, a.summary, a.read_at, a.created_at,
           a.link_id, l.case_id, c.name AS case_name,
           COALESCE(p.installation_id, j.installation_id, l.installation_id) AS installation_id
    FROM judicial_alert a
    LEFT JOIN judicial_case_link l ON l.id = a.link_id
    LEFT JOIN vault_case c ON c.id = l.case_id
    LEFT JOIN judicial_publication p ON a.subject_kind = 'publication' AND p.id = a.subject_id
    LEFT JOIN judicial_sync_job j ON a.subject_kind = 'job' AND j.id = a.subject_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY a.created_at DESC LIMIT ?
  `).all(...params, limit) as Array<{
    id: string; event_kind: string; subject_kind: string; subject_id: string; summary: string;
    read_at: string | null; created_at: string; link_id: string | null; installation_id: string | null;
    case_id: string | null; case_name: string | null;
  }>;
}

export async function markAlertRead(officeId: string, alertId: string): Promise<boolean> {
  return (await database.prepare('UPDATE judicial_alert SET read_at = ? WHERE id = ? AND office_id = ? AND read_at IS NULL')
    .run(nowIso(), alertId, officeId)).changes > 0;
}

/** Records a failed run so the gap stays visible instead of looking like a quiet day. */
export async function recordSyncFailureAlert(officeId: string, linkId: string | null, jobId: string, detail: string): Promise<void> {
  const alertId = randomUUID();
  const caseId = linkId ? (await database.prepare('SELECT case_id FROM judicial_case_link WHERE id=? AND office_id=?')
    .get<{ case_id: string }>(linkId, officeId))?.case_id ?? null : null;
  const recipients = await database.prepare(`SELECT DISTINCT user_id FROM (
      SELECT authorized_by AS user_id FROM judicial_subscription s JOIN judicial_sync_job j ON j.subscription_id=s.id WHERE j.id=? AND j.office_id=?
      UNION SELECT user_id FROM office_member WHERE office_id=? AND role='administrator'
    )`).all<{ user_id: string }>(jobId, officeId, officeId);
  const dedupe = alertDedupeKey('sync_failed', 'job', jobId);
  const now = nowIso();
  await database.batch([database.prepare(`
    INSERT INTO judicial_alert (id, office_id, link_id, event_kind, subject_kind, subject_id, summary, dedupe_key)
    VALUES (?, ?, ?, 'sync_failed', 'job', ?, ?, ?)
    ON CONFLICT(office_id, dedupe_key) DO NOTHING
  `).bind(alertId, officeId, linkId, jobId, detail, dedupe), database.prepare(`INSERT INTO notification_event(
    id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
    intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
  ) SELECT ?,?,'judicial.collection.failed',1,'judicial_alert',?,1,NULL,?,?,?,0,1,?,?
    WHERE json_array_length(?)>0 AND EXISTS(SELECT 1 FROM judicial_alert WHERE id=? AND office_id=?)
    ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
      randomUUID(), officeId, alertId, JSON.stringify(recipients.map((item) => item.user_id)), JSON.stringify({ caseId }),
      `notification:${dedupe}`, now, new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
      JSON.stringify(recipients.map((item) => item.user_id)), alertId, officeId,
    )]);
}
