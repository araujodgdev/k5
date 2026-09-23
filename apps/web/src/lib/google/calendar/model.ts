import { randomUUID } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import type { ConnectionRow } from '../connections';

export type CalendarRow = {
  id: string; office_id: string; user_id: string; connection_id: string; google_calendar_id: string;
  summary: string; time_zone: string | null; access_role: string; is_primary: number; selected: number;
  sync_token: string | null; sync_state: string; last_synced_at: string | null; last_error_code: string | null;
  channel_id: string | null; channel_resource_id: string | null; channel_token_hash: string | null; channel_expires_at: string | null;
};
export type EventRow = {
  id: string; office_id: string; user_id: string; calendar_id: string; google_event_id: string;
  ical_uid: string | null; recurring_event_id: string | null; original_start: string | null; etag: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled'; summary: string; description: string; location: string;
  visibility: 'default' | 'public' | 'private' | 'confidential';
  all_day: number; start_at: string | null; end_at: string | null; start_date: string | null; end_date: string | null;
  time_zone: string | null; recurrence: string[]; attendees_json: string; organizer_email: string | null;
  self_response: string | null; meeting_url: string | null; html_link: string | null; remote_updated_at: string | null;
  version: number; pending_fields_json: string | null; sync_state: 'synced' | 'pending_push' | 'conflict' | 'remote_deleted' | 'permission_lost' | 'failed'; sync_error: string | null;
};
export type GoogleEvent = {
  id: string; etag?: string; iCalUID?: string; recurringEventId?: string; originalStartTime?: { date?: string; dateTime?: string };
  status?: 'confirmed' | 'tentative' | 'cancelled'; summary?: string; description?: string; location?: string;
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[]; attendees?: Array<{ email: string; displayName?: string; responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted'; optional?: boolean; organizer?: boolean; self?: boolean }>;
  organizer?: { email?: string }; hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
  htmlLink?: string; updated?: string; extendedProperties?: { private?: Record<string, string> };
};

export const eventPath = (calendar: CalendarRow, eventId?: string) => `/calendars/${encodeURIComponent(calendar.google_calendar_id)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
export const writable = (calendar: CalendarRow) =>
  calendar.access_role === 'owner' || calendar.access_role === 'writer' || calendar.access_role === 'writerWithoutPrivateAccess';
export const privateHidden = (calendar:CalendarRow,event:Pick<EventRow,'visibility'>) =>
  calendar.access_role === 'writerWithoutPrivateAccess' && ['private','confidential'].includes(event.visibility);
export function assertWritable(calendar: CalendarRow,event?:Pick<EventRow,'visibility'>) {
  if (!writable(calendar) || (event&&privateHidden(calendar,event)))
    throw new CapabilityError('FORBIDDEN', 'Você não tem permissão para alterar este evento no Google.');
}
export async function ownCalendar(context: Pick<WorkspaceContext, 'officeId' | 'userId'>, id: string, connection: ConnectionRow, db: Database = database) {
  const row = await db.prepare('SELECT * FROM google_calendar WHERE id=? AND office_id=? AND user_id=? AND connection_id=?')
    .get<CalendarRow>(id, context.officeId, context.userId, connection.id);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Calendário não encontrado.');
  return row;
}
export async function ownEvent(context: Pick<WorkspaceContext, 'officeId' | 'userId'>, id: string, connection: ConnectionRow, db: Database = database) {
  const row = await db.prepare(`SELECT e.* FROM personal_event e JOIN google_calendar c ON c.id=e.calendar_id
    WHERE e.id=? AND e.office_id=? AND e.user_id=? AND c.connection_id=?`).get<EventRow>(id, context.officeId, context.userId, connection.id);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Evento não encontrado.');
  return row;
}
export function validateEventTime(value: { allDay?: boolean; startsAt?: string | null; endsAt?: string | null; startDate?: string | null; endDate?: string | null; timeZone?: string | null }) {
  if (value.timeZone) {
    try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); }
    catch { throw new CapabilityError('INVALID', 'Informe um fuso IANA válido.'); }
  }
  if (value.allDay) {
    if (!value.startDate || !value.endDate || value.endDate <= value.startDate || value.startsAt || value.endsAt) {
      throw new CapabilityError('INVALID', 'Evento de dia inteiro exige datas válidas, com fim exclusivo, sem horário.');
    }
  } else if (!value.startsAt || !value.endsAt || Date.parse(value.endsAt) <= Date.parse(value.startsAt) || !value.timeZone || value.startDate || value.endDate) {
    throw new CapabilityError('INVALID', 'Informe início, fim e fuso IANA; o fim deve ser posterior ao início.');
  }
}
export function eventBody(value: { title: string; description: string; location: string; allDay: boolean; startsAt: string | null; endsAt: string | null; startDate: string | null; endDate: string | null; timeZone: string | null; recurrence: string[]; attendees: Array<{ email: string; optional: boolean }>; addMeet?: boolean }, marker?: string): GoogleEvent {
  validateEventTime(value);
  return {
    id: '', summary: value.title, description: value.description, location: value.location,
    start: value.allDay ? { date: value.startDate! } : { dateTime: value.startsAt!, timeZone: value.timeZone! },
    end: value.allDay ? { date: value.endDate! } : { dateTime: value.endsAt!, timeZone: value.timeZone! },
    recurrence: value.recurrence, attendees: value.attendees.map(a => ({ email: a.email, optional: a.optional })),
    ...(marker ? { extendedProperties: { private: { k5Operation: marker } } } : {}),
  };
}
export function rowFromGoogle(event: GoogleEvent) {
  const allDay = Boolean(event.start?.date);
  const attendees = (event.attendees ?? []).map(a => ({ email: a.email, name: a.displayName ?? null, responseStatus: a.responseStatus ?? 'needsAction', optional: Boolean(a.optional), organizer: Boolean(a.organizer), self: Boolean(a.self) }));
  const meet = event.hangoutLink ?? event.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri ?? null;
  return {
    ical_uid: event.iCalUID ?? null, recurring_event_id: event.recurringEventId ?? null,
    original_start: event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? null,
    etag: event.etag ?? null, status: event.status ?? 'confirmed', summary: event.summary ?? '',
    description: event.description ?? '', location: event.location ?? '', visibility:event.visibility??'default', all_day: allDay ? 1 : 0,
    start_at: allDay ? null : event.start?.dateTime ?? null, end_at: allDay ? null : event.end?.dateTime ?? null,
    start_date: allDay ? event.start?.date ?? null : null, end_date: allDay ? event.end?.date ?? null : null,
    time_zone: event.start?.timeZone ?? event.end?.timeZone ?? null, recurrence: event.recurrence ?? [],
    attendees_json: JSON.stringify(attendees), organizer_email: event.organizer?.email ?? null,
    self_response: attendees.find(a => a.self)?.responseStatus ?? null, meeting_url: meet, html_link: event.htmlLink ?? null,
    remote_updated_at: event.updated ?? null,
  };
}
export async function saveRemoteEvent(calendar: CalendarRow, event: GoogleEvent, db: Database = database) {
  if (!event.id) return;
  const v = rowFromGoogle(event);
  const row = await db.prepare(`INSERT INTO personal_event(id,office_id,user_id,calendar_id,google_event_id,ical_uid,recurring_event_id,original_start,etag,status,summary,description,location,visibility,all_day,start_at,end_at,start_date,end_date,time_zone,recurrence,attendees_json,organizer_email,self_response,meeting_url,html_link,remote_updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(calendar_id,google_event_id) DO UPDATE SET
    ical_uid=EXCLUDED.ical_uid,recurring_event_id=EXCLUDED.recurring_event_id,original_start=EXCLUDED.original_start,etag=EXCLUDED.etag,
    status=EXCLUDED.status,summary=EXCLUDED.summary,description=EXCLUDED.description,location=EXCLUDED.location,visibility=EXCLUDED.visibility,all_day=EXCLUDED.all_day,
    start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,time_zone=EXCLUDED.time_zone,
    recurrence=EXCLUDED.recurrence,attendees_json=EXCLUDED.attendees_json,organizer_email=EXCLUDED.organizer_email,self_response=EXCLUDED.self_response,
    meeting_url=EXCLUDED.meeting_url,html_link=EXCLUDED.html_link,remote_updated_at=EXCLUDED.remote_updated_at,version=personal_event.version+1,
    sync_state='synced',sync_error=NULL,pending_fields_json=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE personal_event.sync_state NOT IN ('pending_push','conflict')
      AND (personal_event.etag IS DISTINCT FROM EXCLUDED.etag OR personal_event.status IS DISTINCT FROM EXCLUDED.status
        OR personal_event.visibility IS DISTINCT FROM EXCLUDED.visibility
        OR personal_event.sync_state IS DISTINCT FROM 'synced')
    RETURNING *`).get<EventRow>(randomUUID(), calendar.office_id, calendar.user_id, calendar.id,
      event.id,v.ical_uid,v.recurring_event_id,v.original_start,v.etag,v.status,v.summary,v.description,v.location,v.visibility,v.all_day,v.start_at,v.end_at,
      v.start_date,v.end_date,v.time_zone,v.recurrence,v.attendees_json,v.organizer_email,v.self_response,v.meeting_url,v.html_link,v.remote_updated_at);
  if(row)return row;
  const existing=await db.prepare('SELECT * FROM personal_event WHERE calendar_id=? AND google_event_id=?')
    .get<EventRow>(calendar.id,event.id);
  return existing?.sync_state==='pending_push'||existing?.sync_state==='conflict'?undefined:existing;
}
export function eventDto(row: EventRow, calendar: CalendarRow, shareId: string | null = null) {
  return {
    id: row.id, occurrenceStart: row.original_start, calendarId: calendar.id, calendarName: calendar.summary,
    readOnly: !writable(calendar)||privateHidden(calendar,row),
    title: row.summary, description: row.description, location: row.location, allDay: Boolean(row.all_day),
    startsAt: row.start_at, endsAt: row.end_at, startDate: row.start_date, endDate: row.end_date, timeZone: row.time_zone,
    recurring: Boolean(row.recurring_event_id || row.recurrence.length), recurrence: row.recurrence,
    attendees: JSON.parse(row.attendees_json) as Array<{ email: string; name: string | null; responseStatus: string; optional: boolean; organizer: boolean; self: boolean }>,
    organizerEmail: row.organizer_email, selfResponse: row.self_response, meetingUrl: row.meeting_url, htmlLink: row.html_link,
    status: row.status, syncState: row.sync_state, syncError: row.sync_error, shareId, version: row.version,
  };
}
export function calendarDto(row: CalendarRow) {
  return { id: row.id, summary: row.summary, timeZone: row.time_zone, accessRole: row.access_role,
    readOnly: !writable(row), primary: Boolean(row.is_primary), selected: Boolean(row.selected), syncState: row.sync_state,
    lastSyncedAt: row.last_synced_at, lastError: row.last_error_code };
}
