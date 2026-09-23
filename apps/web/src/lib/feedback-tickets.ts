import 'server-only';
import { randomUUID } from 'node:crypto';
import { database as defaultDatabase, type Database } from './database';
import { objectStorage, storageKey } from './storage';
import { imageMatchesType } from './image-signature';
import { assertPlatformAdmin, PlatformRequestError } from './platform-core';
import {
  FEEDBACK_IMAGE_TYPES, MAX_FEEDBACK_IMAGE_BYTES, feedbackSubmission, ticketUpdate, ticketStatuses, ticketKinds, ticketModules, ticketPriorities,
  type AuthorTicket, type TicketKind, type TicketModule, type TicketPriority, type TicketStatus,
} from './feedback-tickets-contract';

export type FeedbackAuthor = { officeId: string; userId: string };
const DAILY_LIMIT = 20;

type TicketRow = {
  id: string; number: number; office_id: string; user_id: string | null; message: string; page_path: string; user_agent: string;
  attachment_key: string | null; attachment_type: string | null; attachment_size: number | null;
  status: TicketStatus; kind: TicketKind | null; module: TicketModule | null; severity: number | null; priority: TicketPriority;
  security_flag: boolean; personal_data_flag: boolean; needs_review: boolean;
  classification_status: string; classified_by: 'model' | 'admin' | null; classification_json: string | null;
  resolution_note: string; version: number; created_at: string; updated_at: string; resolved_at: string | null;
};

async function assertMember(db: Database, author: FeedbackAuthor) {
  const member = await db.prepare('SELECT role FROM office_member WHERE office_id = ? AND user_id = ?').get<{ role: string }>(author.officeId, author.userId);
  if (!member) throw new PlatformRequestError(403, 'Seu acesso ao escritório não está disponível.');
}

function eventStatement(db: Database, ticketId: string, actor: string | null, kind: string, details: object = {}) {
  return db.prepare('INSERT INTO feedback_ticket_event(id,ticket_id,actor_user_id,kind,details_json) VALUES(?,?,?,?,?)')
    .bind(randomUUID(), ticketId, actor, kind, JSON.stringify(details));
}

/** Any office member may report. The text is stored as written; triage runs later in the worker. */
export async function createTicket(author: FeedbackAuthor, raw: unknown, image: File | null, userAgent = '', db: Database = defaultDatabase) {
  await assertMember(db, author);
  const parsed = feedbackSubmission.safeParse(raw);
  if (!parsed.success) throw new PlatformRequestError(400, parsed.error.issues[0]?.message ?? 'Confira o texto do feedback.');
  const recent = await db.prepare("SELECT count(*) AS total FROM feedback_ticket WHERE user_id=? AND created_at > CURRENT_TIMESTAMP - interval '1 day'")
    .get<{ total: number }>(author.userId);
  if ((recent?.total ?? 0) >= DAILY_LIMIT) throw new PlatformRequestError(429, 'Você enviou muitos relatos hoje. Tente novamente amanhã.');
  const id = randomUUID();
  let attachment: { key: string; type: string; size: number } | null = null;
  if (image && image.size) {
    const type = image.type;
    if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(type)) throw new PlatformRequestError(400, 'Envie o print como PNG, JPEG ou WebP.');
    if (image.size > MAX_FEEDBACK_IMAGE_BYTES) throw new PlatformRequestError(400, 'O print deve ter até 5 MB.');
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length > MAX_FEEDBACK_IMAGE_BYTES || !imageMatchesType(bytes, type)) throw new PlatformRequestError(400, 'A imagem não corresponde ao formato informado.');
    const key = storageKey(author.officeId, id, type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp');
    await (await objectStorage()).put(key, bytes);
    attachment = { key, type, size: bytes.length };
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO feedback_ticket(id,office_id,user_id,message,page_path,user_agent,attachment_key,attachment_type,attachment_size)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(id, author.officeId, author.userId, parsed.data.message, parsed.data.pagePath,
        userAgent.slice(0, 400), attachment?.key ?? null, attachment?.type ?? null, attachment?.size ?? null),
      eventStatement(db, id, author.userId, 'created'),
    ]);
  } catch (error) {
    if (attachment) await (await objectStorage()).delete(attachment.key).catch(() => undefined);
    throw error;
  }
  const row = await db.prepare('SELECT number FROM feedback_ticket WHERE id=?').get<{ number: number }>(id);
  return { id, number: row!.number };
}

/** The author sees only their own reports in the current office, never the triage fields. */
export async function listAuthorTickets(author: FeedbackAuthor, db: Database = defaultDatabase): Promise<AuthorTicket[]> {
  await assertMember(db, author);
  const rows = await db.prepare(`SELECT id,number,message,status,resolution_note,created_at,resolved_at FROM feedback_ticket
    WHERE office_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50`).all<TicketRow>(author.officeId, author.userId);
  return rows.map(row => ({ id: row.id, number: row.number, message: row.message, status: row.status,
    resolutionNote: row.status === 'resolved' ? row.resolution_note : '', createdAt: row.created_at, resolvedAt: row.resolved_at }));
}

export type TicketFilters = { status?: string; kind?: string; module?: string; priority?: string; officeId?: string; review?: string; page?: number };

function pick<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find(item => item === value);
}

export async function platformTickets(actor: string, filters: TicketFilters, db: Database = defaultDatabase) {
  await assertPlatformAdmin(db, actor);
  const where: string[] = []; const params: unknown[] = [];
  const status = filters.status === 'all' ? undefined : pick(ticketStatuses, filters.status);
  if (status) { where.push('t.status=?'); params.push(status); }
  else if (filters.status !== 'all') where.push("t.status IN ('new','in_progress')");
  for (const [column, value] of [['kind', pick(ticketKinds, filters.kind)], ['module', pick(ticketModules, filters.module)], ['priority', pick(ticketPriorities, filters.priority)]] as const) {
    if (value) { where.push(`t.${column}=?`); params.push(value); }
  }
  if (filters.officeId) { where.push('t.office_id=?'); params.push(filters.officeId); }
  if (filters.review === '1') where.push('t.needs_review');
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(0, Math.min(1000, filters.page ?? 0));
  const [rows, total, counts, offices] = await Promise.all([
    db.prepare(`SELECT t.id,t.number,t.message,t.status,t.kind,t.module,t.priority,t.security_flag,t.personal_data_flag,t.needs_review,
        t.classification_status,t.created_at,o.name AS office_name,u.name AS user_name
      FROM feedback_ticket t JOIN office o ON o.id=t.office_id LEFT JOIN "user" u ON u.id=t.user_id
      ${filter} ORDER BY t.priority, t.created_at DESC LIMIT 50 OFFSET ?`).all<TicketRow & { office_name: string; user_name: string | null }>(...params, page * 50),
    db.prepare(`SELECT count(*) AS total FROM feedback_ticket t ${filter}`).get<{ total: number }>(...params),
    db.prepare('SELECT status,count(*) AS total FROM feedback_ticket GROUP BY status').all<{ status: TicketStatus; total: number }>(),
    db.prepare('SELECT DISTINCT o.id,o.name FROM feedback_ticket t JOIN office o ON o.id=t.office_id ORDER BY o.name').all<{ id: string; name: string }>(),
  ]);
  return {
    tickets: rows.map(row => ({ id: row.id, number: row.number, excerpt: row.message.slice(0, 180), status: row.status, kind: row.kind, module: row.module,
      priority: row.priority, securityFlag: row.security_flag, personalDataFlag: row.personal_data_flag, needsReview: row.needs_review,
      classificationStatus: row.classification_status, createdAt: row.created_at, officeName: row.office_name, userName: row.user_name })),
    total: total?.total ?? 0, page,
    counts: Object.fromEntries(ticketStatuses.map(key => [key, counts.find(item => item.status === key)?.total ?? 0])) as Record<TicketStatus, number>,
    offices,
  };
}

export async function platformTicket(actor: string, id: string, db: Database = defaultDatabase) {
  await assertPlatformAdmin(db, actor);
  const row = await db.prepare(`SELECT t.*,o.name AS office_name,u.name AS user_name,u.email AS user_email
    FROM feedback_ticket t JOIN office o ON o.id=t.office_id LEFT JOIN "user" u ON u.id=t.user_id WHERE t.id=?`)
    .get<TicketRow & { office_name: string; user_name: string | null; user_email: string | null }>(id);
  if (!row) return null;
  const events = await db.prepare(`SELECT e.kind,e.details_json,e.created_at,u.name AS actor_name FROM feedback_ticket_event e
    LEFT JOIN "user" u ON u.id=e.actor_user_id WHERE e.ticket_id=? ORDER BY e.seq`).all<{ kind: string; details_json: string; created_at: string; actor_name: string | null }>(id);
  return {
    id: row.id, number: row.number, message: row.message, pagePath: row.page_path, userAgent: row.user_agent,
    hasAttachment: Boolean(row.attachment_key), status: row.status, kind: row.kind, module: row.module, severity: row.severity, priority: row.priority,
    securityFlag: row.security_flag, personalDataFlag: row.personal_data_flag, needsReview: row.needs_review,
    classificationStatus: row.classification_status, classifiedBy: row.classified_by,
    classification: row.classification_json ? JSON.parse(row.classification_json) as TriageRecord : null,
    resolutionNote: row.resolution_note, version: row.version, createdAt: row.created_at, resolvedAt: row.resolved_at,
    officeId: row.office_id, officeName: row.office_name, userName: row.user_name, userEmail: row.user_email,
    events: events.map(event => ({ kind: event.kind, details: JSON.parse(event.details_json) as Record<string, unknown>, createdAt: event.created_at, actorName: event.actor_name })),
  };
}
export type PlatformTicket = NonNullable<Awaited<ReturnType<typeof platformTicket>>>;
export type TriageRecord = {
  questionVersion: string; evaluationId: string | null; status: string;
  answers: Record<string, { type: string; choice?: string; score?: number; noul?: number; confidence?: number }>;
};

export async function ticketAttachment(actor: string, id: string, db: Database = defaultDatabase) {
  await assertPlatformAdmin(db, actor);
  const row = await db.prepare('SELECT attachment_key,attachment_type FROM feedback_ticket WHERE id=?').get<{ attachment_key: string | null; attachment_type: string | null }>(id);
  if (!row?.attachment_key || !row.attachment_type) return null;
  return { bytes: await (await objectStorage()).get(row.attachment_key), type: row.attachment_type };
}

/**
 * Admin changes are compare-and-swap on the ticket version. Classification fields changed here are
 * marked as an admin correction; the model's raw answers stay in classification_json.
 */
export async function updateTicket(actor: string, id: string, raw: unknown, db: Database = defaultDatabase) {
  await assertPlatformAdmin(db, actor);
  const parsed = ticketUpdate.safeParse(raw);
  if (!parsed.success) throw new PlatformRequestError(400, 'Confira os campos do ticket.');
  const input = parsed.data;
  const current = await db.prepare('SELECT * FROM feedback_ticket WHERE id=?').get<TicketRow>(id);
  if (!current) throw new PlatformRequestError(404, 'Ticket não encontrado.');
  if (current.version !== input.version) throw new PlatformRequestError(409, 'O ticket mudou. Recarregue a página.');
  const next = {
    status: input.status ?? current.status, kind: input.kind ?? current.kind, module: input.module ?? current.module,
    priority: input.priority ?? current.priority, resolutionNote: input.resolutionNote ?? current.resolution_note,
  };
  const reclassified = (['kind', 'module', 'priority'] as const).filter(field => input[field] !== undefined && input[field] !== current[field]);
  const statusChanged = next.status !== current.status;
  const statements = [
    db.prepare(`UPDATE feedback_ticket SET status=?,kind=?,module=?,priority=?,resolution_note=?,
      classified_by=CASE WHEN ? THEN 'admin' ELSE classified_by END, needs_review=CASE WHEN ? THEN false ELSE needs_review END,
      resolved_at=CASE WHEN ?='resolved' THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE NULL END,
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?`).bind(
      next.status, next.kind, next.module, next.priority, next.resolutionNote, reclassified.length > 0, reclassified.length > 0,
      next.status, id, input.version),
  ];
  // Events are gated on the swap having happened: the version it produced must exist.
  const guarded = (kind: string, details: object) => db.prepare(`INSERT INTO feedback_ticket_event(id,ticket_id,actor_user_id,kind,details_json)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM feedback_ticket WHERE id=? AND version=?)`).bind(randomUUID(), id, actor, kind, JSON.stringify(details), id, input.version + 1);
  if (reclassified.length) statements.push(guarded('reclassified', Object.fromEntries(reclassified.map(field => [field, { from: current[field], to: next[field] }]))));
  if (statusChanged) statements.push(guarded('status_changed', { from: current.status, to: next.status }));
  if (input.note) statements.push(guarded('note', { text: input.note }));
  if (statusChanged && next.status === 'resolved' && current.user_id) {
    // Same guard as the ticket events: no notification unless this update won the swap.
    statements.push(db.prepare(`INSERT INTO notification_event (
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
    ) SELECT ?,?,'system.feedback.resolved',1,'system',?,?,?,?,?,?,0,1,?,NULL
      WHERE EXISTS(SELECT 1 FROM feedback_ticket WHERE id=? AND version=?)
      ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
      randomUUID(), current.office_id, id, input.version + 1, actor, JSON.stringify([current.user_id]), JSON.stringify({ ticketNumber: current.number }),
      `feedback:${id}:resolved:v${input.version + 1}`, new Date().toISOString(), id, input.version + 1));
  }
  const [result] = await db.batch(statements);
  if (!result.changes) throw new PlatformRequestError(409, 'O ticket mudou. Recarregue a página.');
  return platformTicket(actor, id, db);
}
