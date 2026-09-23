import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { ConnectorResult, InstallationRef, NormalizedCase, NormalizedMovement } from '../contracts';
import { alertDedupeKey, movementFingerprint } from '../normalization/fingerprint';
import { nowIso } from '../normalization/dates';
import { persistSnapshot } from './evidence';
import { currentVocabularyVersion } from '../normalization/vocabulary';

/**
 * Case data — header and movements — as durable evidence (A4 of
 * docs/Refinos-MVP/plano-conectores-tribunais.md).
 *
 * The first collection of a record is its baseline: a lifetime of movements seen at once is
 * history, not news, so it is written with zero alerts. From the second collection on, only what
 * appeared after the baseline becomes a `new_movement` alert.
 */

export type IngestCaseInput = {
  officeId: string;
  installation: InstallationRef;
  linkId: string | null;
  jobId: string | null;
  result: ConnectorResult<NormalizedCase>;
};

export type IngestCaseOutcome = {
  snapshotIds: string[];
  inserted: number;
  duplicates: number;
  alerts: number;
  /** Records whose movements were written as a baseline, without alerts. */
  baselines: number;
};

/**
 * Snapshots commit first, so a movement can never exist without the evidence it came from. Then
 * each record lands in one batch — the record row, its movements and their alerts — which is a
 * transaction in both backends: an interrupted run leaves either the whole record or nothing, so
 * the next pass sees no record and writes the baseline again instead of an avalanche of alerts.
 */
export async function ingestCase(input: IngestCaseInput): Promise<IngestCaseOutcome> {
  const outcome: IngestCaseOutcome = { snapshotIds: [], inserted: 0, duplicates: 0, alerts: 0, baselines: 0 };
  const { officeId, installation } = input;

  for (const raw of input.result.rawPayloads) {
    outcome.snapshotIds.push(await persistSnapshot({
      officeId,
      installationId: installation.id,
      jobId: input.jobId,
      operation: input.result.source.operation,
      contentType: raw.contentType,
      body: raw.body,
      parserVersion: input.result.source.parserVersion,
      collectedAt: input.result.source.collectedAt,
      visibility: installation.authKind === 'none' ? 'public' : 'restricted',
      usageConditions: installation.permissions,
    }));
  }
  const snapshotId = outcome.snapshotIds[0];
  if (input.result.items.length && !snapshotId) {
    throw new Error('Processo sem snapshot de origem; a coleta não pode ser publicada.');
  }

  const caseId = input.linkId ? (await database.prepare('SELECT case_id FROM judicial_case_link WHERE id = ? AND office_id = ?')
    .get<{ case_id: string }>(input.linkId, officeId))?.case_id ?? null : null;
  const followers = caseId ? (await database.prepare(`SELECT f.user_id FROM notification_follow f
    JOIN office_member m ON m.office_id = f.office_id AND m.user_id = f.user_id
    WHERE f.office_id = ? AND f.case_id = ? AND f.ended_at IS NULL`)
    .all<{ user_id: string }>(officeId, caseId)).map((row) => row.user_id) : [];

  for (const record of input.result.items) {
    const existing = await database.prepare(
      'SELECT id FROM judicial_source_record WHERE office_id = ? AND installation_id = ? AND source_record_id = ?',
    ).get<{ id: string }>(officeId, installation.id, record.sourceRecordId);
    const recordId = existing?.id ?? randomUUID();
    // The record and its baseline movements commit in the same batch, so an existing record means
    // its baseline landed. Counting movements instead would silence the first movement of a
    // proceeding that genuinely had none yet.
    const baseline = !existing;
    if (baseline) outcome.baselines += 1;

    const statements = [database.prepare(`
      INSERT INTO judicial_source_record (
        id, office_id, installation_id, link_id, source_record_id, record_kind, cnj_number, native_number, title, source_updated_at
      ) VALUES (?, ?, ?, ?, ?, 'case', ?, ?, ?, ?)
      ON CONFLICT(office_id, installation_id, source_record_id) DO UPDATE SET
        last_seen_at = CURRENT_TIMESTAMP,
        link_id = COALESCE(judicial_source_record.link_id, excluded.link_id),
        title = COALESCE(excluded.title, judicial_source_record.title),
        source_updated_at = COALESCE(excluded.source_updated_at, judicial_source_record.source_updated_at)
    `).bind(
      recordId, officeId, installation.id, input.linkId, record.sourceRecordId,
      record.identity.cnjNumber, record.identity.nativeNumber, record.title, record.sourceUpdatedAt,
    )];

    for (const movement of record.movements) {
      const movementId = randomUUID();
      const fingerprint = movementFingerprint(movement).value;
      statements.push(database.prepare(`
        INSERT INTO judicial_movement (
          id, office_id, record_id, snapshot_id, source_movement_id, source_code, source_text,
          tpu_code, tpu_source, event_at, event_precision, event_timezone, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(office_id, record_id, fingerprint) DO NOTHING
      `).bind(
        movementId, officeId, recordId, snapshotId, movement.sourceMovementId, movement.sourceCode, movement.sourceText,
        movement.tpuCode, movement.tpuSource, movement.eventAt, movement.eventPrecision, movement.eventTimezone, fingerprint,
      ));
      if (baseline) continue;

      const alertId = randomUUID();
      const dedupe = alertDedupeKey('new_movement', 'movement', `${recordId}:${fingerprint}`);
      // The alert exists only if this very row was inserted now: a replayed job finds the movement
      // already there, inserts nothing, and so announces nothing.
      statements.push(database.prepare(`
        INSERT INTO judicial_alert (id, office_id, link_id, event_kind, subject_kind, subject_id, summary, dedupe_key)
        SELECT ?, ?, ?, 'new_movement', 'movement', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM judicial_movement WHERE id = ? AND office_id = ?)
        ON CONFLICT(office_id, dedupe_key) DO NOTHING
      `).bind(alertId, officeId, input.linkId, movementId, summarize(installation, movement), dedupe, movementId, officeId));
      statements.push(database.prepare(`INSERT INTO notification_event(
        id, office_id, event_type, payload_version, source_kind, source_id, source_version, actor_user_id,
        intended_recipients_json, data_json, dedupe_key, historical, push_eligible, created_at, expires_at
      ) SELECT ?, ?, 'judicial.movement.new', 1, 'judicial_alert', ?, 1, NULL, ?, ?, ?, 0, 1, ?, ?
        WHERE json_array_length(?) > 0 AND EXISTS (SELECT 1 FROM judicial_alert WHERE id = ? AND office_id = ?)
        ON CONFLICT(office_id, dedupe_key) DO NOTHING`).bind(
        randomUUID(), officeId, alertId, JSON.stringify(followers), JSON.stringify({ caseId }), `notification:${dedupe}`,
        nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        JSON.stringify(followers), alertId, officeId,
      ));
    }

    const results = await database.batch(statements);
    const perMovement = baseline ? 1 : 3;
    record.movements.forEach((_, index) => {
      const base = 1 + index * perMovement;
      if (results[base].changes) outcome.inserted += 1; else outcome.duplicates += 1;
      if (!baseline && results[base + 1].changes) outcome.alerts += 1;
    });
  }

  return outcome;
}

/**
 * One pt-BR line for the inbox. It deliberately carries no movement text: that text is written by
 * a third party and reaches people and agents only through a path that marks it untrusted.
 */
function summarize(installation: InstallationRef, movement: NormalizedMovement): string {
  return `Novo movimento em ${installation.courtName}, registrado em ${movement.eventAt.slice(0, 10)}.`;
}

export type MovementSummary = {
  id: string;
  recordId: string;
  linkId: string | null;
  caseId: string | null;
  installationId: string;
  courtName: string;
  cnjNumber: string | null;
  sourceCode: string | null;
  sourceText: string;
  tpuCode: string | null;
  /** Resolved when read, by exact code; the stored movement is never rewritten with it. */
  tpuLabel: string | null;
  eventAt: string;
  eventPrecision: 'date' | 'minute' | 'second';
  snapshotId: string;
  collectedAt: string;
};

export async function listMovements(
  officeId: string,
  filter: { caseId?: string; linkId?: string; limit?: number } = {},
): Promise<MovementSummary[]> {
  const clauses = ['m.office_id = ?'];
  const params: (string | number)[] = [officeId];
  if (filter.caseId) { clauses.push('l.case_id = ?'); params.push(filter.caseId); }
  if (filter.linkId) { clauses.push('r.link_id = ?'); params.push(filter.linkId); }
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
  // Same rule as resolveTpu: exact code, current version first, then the latest version that had
  // it, so a term the catalog dropped still names the events that used it.
  const version = await currentVocabularyVersion();
  const rows = await database.prepare(`
    SELECT m.id, m.record_id, r.link_id, l.case_id, r.installation_id, i.court_name, r.cnj_number,
           m.source_code, m.source_text, m.tpu_code, m.event_at, m.event_precision, m.snapshot_id, s.collected_at,
           (SELECT v.label FROM judicial_vocabulary_term v WHERE v.kind = 'movement' AND v.code = m.tpu_code
            ORDER BY (v.version = ?) DESC, v.rowid DESC LIMIT 1) AS tpu_label
    FROM judicial_movement m
    JOIN judicial_source_record r ON r.id = m.record_id AND r.office_id = m.office_id
    JOIN judicial_source_installation i ON i.id = r.installation_id
    JOIN judicial_snapshot s ON s.id = m.snapshot_id
    LEFT JOIN judicial_case_link l ON l.id = r.link_id AND l.office_id = m.office_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY m.event_at DESC, m.created_at DESC LIMIT ?
  `).all<{
    tpu_label: string | null;
    id: string; record_id: string; link_id: string | null; case_id: string | null; installation_id: string;
    court_name: string; cnj_number: string | null; source_code: string | null; source_text: string;
    tpu_code: string | null; event_at: string; event_precision: string; snapshot_id: string; collected_at: string;
  }>(version, ...params, limit);
  return rows.map((row) => ({
    id: row.id, recordId: row.record_id, linkId: row.link_id, caseId: row.case_id,
    installationId: row.installation_id, courtName: row.court_name, cnjNumber: row.cnj_number,
    sourceCode: row.source_code, sourceText: row.source_text, tpuCode: row.tpu_code, tpuLabel: row.tpu_label,
    eventAt: row.event_at, eventPrecision: row.event_precision as MovementSummary['eventPrecision'],
    snapshotId: row.snapshot_id, collectedAt: row.collected_at,
  }));
}
