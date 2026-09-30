import { database as defaultDatabase, type Database } from '@/lib/database';

/** One atomic insert rechecks balances and membership; event identity deduplicates concurrent passes. */
export async function emitChargeReminders(db: Database = defaultDatabase, now = new Date().toISOString(), limit = 100) {
  const result = await db.prepare(`WITH clock AS (
    SELECT ?::timestamptz AS instant,(?::timestamptz AT TIME ZONE 'America/Sao_Paulo') AS local
  ), eligible AS (
    SELECT i.id,i.office_id,i.due_on,a.created_by,a.title,(clock.local::date-i.due_on) AS days,
      'honorario:'||i.id||':'||clock.local::date::text AS dedupe_key,clock.instant
    FROM honorario_charge ch JOIN honorario_installment i ON i.office_id=ch.office_id AND i.id=ch.installment_id
    JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
    JOIN office_member m ON m.office_id=a.office_id AND m.user_id=a.created_by AND m.role IN ('administrator','lawyer')
    JOIN notification_rollout ro ON ro.office_id=a.office_id AND ro.reminders_enabled=1 AND ro.capture_enabled=1
    LEFT JOIN notification_preference p ON p.office_id=a.office_id AND p.user_id=a.created_by CROSS JOIN clock
    WHERE ch.reminders_enabled AND a.cancelled_at IS NULL AND clock.local::time >= TIME '09:00'
      AND COALESCE((p.categories_json::jsonb->>'honorarios')::boolean,true)
      AND (clock.local::date-i.due_on IN (-3,0) OR (clock.local::date-i.due_on>=7 AND (clock.local::date-i.due_on)%7=0))
      AND i.amount_cents>COALESCE((SELECT SUM(r.amount_cents) FROM honorario_receipt r
        WHERE r.office_id=i.office_id AND r.installment_id=i.id AND NOT EXISTS(SELECT 1 FROM honorario_receipt_reversal v WHERE v.office_id=r.office_id AND v.receipt_id=r.id)),0)
  ) INSERT INTO notification_event(id,office_id,event_type,payload_version,source_kind,source_id,intended_recipients_json,
    data_json,dedupe_key,created_at,expires_at)
    SELECT gen_random_uuid()::text,e.office_id,CASE WHEN days<0 THEN 'honorarios.charge.soon' WHEN days=0 THEN 'honorarios.charge.due' ELSE 'honorarios.charge.overdue' END,
      1,'honorario',e.id,json_build_array(e.created_by)::text,json_build_object('title',e.title)::text,e.dedupe_key,e.instant,
      ((e.instant AT TIME ZONE 'America/Sao_Paulo')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
    FROM eligible e WHERE NOT EXISTS(SELECT 1 FROM notification_event n WHERE n.office_id=e.office_id AND n.dedupe_key=e.dedupe_key)
    ORDER BY e.due_on,e.id LIMIT ? ON CONFLICT(office_id,dedupe_key) DO NOTHING`).run(now, now, limit);
  return result.changes;
}
