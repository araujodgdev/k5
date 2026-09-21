import { randomUUID } from 'node:crypto';
import type { BoundStatement, Database } from '@/lib/database';
import type { NotificationEventDraft } from './contracts';

export function eventInsertStatement(db: Database, draft: NotificationEventDraft): BoundStatement {
  return db.prepare(`INSERT INTO notification_event (
    id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
    intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
  ) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
    draft.id, draft.officeId, draft.eventType, draft.sourceKind, draft.sourceId, draft.sourceVersion,
    draft.actorUserId, JSON.stringify([...new Set(draft.intendedRecipientIds)]), JSON.stringify(draft.data),
    draft.dedupeKey, draft.historical ? 1 : 0, draft.pushEligible === false ? 0 : 1,
    draft.createdAt, draft.expiresAt,
  );
}

export function agendaEventStatement(db: Database, input: {
  officeId: string;
  activityId: string;
  activityVersion: number;
  mutationToken: string;
  actorUserId: string;
  eventType: 'agenda.activity.assigned' | 'agenda.activity.changed';
  intendedRecipientIds: string[];
  data: Record<string, unknown>;
  createdAt: string;
}): BoundStatement {
  const recipients = [...new Set(input.intendedRecipientIds)].filter((id) => id !== input.actorUserId);
  return db.prepare(`INSERT INTO notification_event (
    id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
    intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
  ) SELECT ?,?,?,1,'activity',?,?,?,?,?,?,0,1,?,?
    WHERE json_array_length(?) > 0
      AND COALESCE((SELECT capture_enabled FROM notification_rollout WHERE office_id=?),1)=1
      AND EXISTS (
      SELECT 1 FROM agenda_activity
      WHERE id=? AND office_id=? AND mutation_token=? AND version=?
    ) ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
    randomUUID(), input.officeId, input.eventType, input.activityId, input.activityVersion,
    input.actorUserId, JSON.stringify(recipients), JSON.stringify(input.data),
    `agenda:${input.activityId}:v${input.activityVersion}:${input.eventType}`, input.createdAt,
    new Date(Date.parse(input.createdAt) + 24 * 60 * 60 * 1000).toISOString(), JSON.stringify(recipients),
    input.officeId, input.activityId, input.officeId, input.mutationToken, input.activityVersion,
  );
}
