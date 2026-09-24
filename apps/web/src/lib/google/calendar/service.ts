import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput as Input } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from '@/lib/application/context';
import { googleJson, googleRequest, requireConnection, type ConnectionRow } from '../connections';
import { checkpointOperation, markOperationEffect, runGoogleOperation, type Reconciler, type RunningOperation } from '../operations';
import { GoogleApiError } from '../transport';
import { enqueueGoogleJob } from '../jobs';
import type { GoogleAction } from '../policy';
import { assertWritable, calendarDto, eventBody, eventDto, eventPath, ownCalendar, ownEvent, privateHidden, saveRemoteEvent, validateEventTime, type CalendarRow, type EventRow, type GoogleEvent } from './model';

type Owner = Pick<WorkspaceContext, 'officeId' | 'userId'>;
async function memberRole(context:Owner) {
  const row=await database.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?')
    .get<{role:string}>(context.officeId,context.userId);
  if(!row)throw new CapabilityError('FORBIDDEN','Seu acesso a este escritório foi removido.');
  return row.role;
}
async function requireWriter(context:Owner) {
  if(!['administrator','lawyer'].includes(await memberRole(context)))
    throw new CapabilityError('FORBIDDEN','Seu papel permite apenas consultas.');
}
const readable = (value: string | number | boolean) => typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value);
const review = (entries: Array<[string,string | number | boolean | null | undefined]>) =>
  entries.filter(([,value])=>value!==undefined&&value!==null).map(([label,value])=>({label,value:readable(value!)}));
const scopeLabel:Record<Scope,'Só esta ocorrência'|'Esta e as próximas'|'Série inteira'>={
  occurrence:'Só esta ocorrência',following:'Esta e as próximas',series:'Série inteira',
};
type Scope='occurrence'|'following'|'series';
function changesReview(changes:Input<'k5_calendar_update_event'>['changes']) {
  const labels:Record<keyof typeof changes,string>={title:'Título',description:'Descrição',location:'Local',allDay:'Dia inteiro',
    startsAt:'Início',endsAt:'Fim',startDate:'Dia inicial',endDate:'Dia final exclusivo',timeZone:'Fuso horário',
    recurrence:'Repetição',attendees:'Convidados'};
  return Object.entries(changes).map(([key,value])=>({label:labels[key as keyof typeof changes],
    value:Array.isArray(value) ? (value.map(item=>typeof item==='string'?item:`${item.email}${item.optional?' (opcional)':''}`).join(', ') || 'Nenhum')
      :value===null?'Remover':value===''?'Limpar':readable(value as string | number | boolean)}));
}
const recipients=(event:GoogleEvent)=>event.attendees?.map(a=>a.email.toLowerCase()).sort()??[];
const recipientReview=(event:GoogleEvent)=>recipients(event).join(', ')||'Nenhum convidado';
function assertRecipientsUnchanged(remote:GoogleEvent,reviewed:string[]) {
  if(JSON.stringify(recipients(remote))!==JSON.stringify(reviewed))
    throw new CapabilityError('CONFLICT','Os convidados mudaram no Google. Revise e confirme a ação novamente.');
}
const calendars = (owner: Owner) => database.prepare('SELECT * FROM google_calendar WHERE office_id=? AND user_id=? ORDER BY is_primary DESC,summary,id').all<CalendarRow>(owner.officeId, owner.userId);
const assertVersion = (row: EventRow, version: number) => { if (row.version !== version) throw new CapabilityError('CONFLICT', 'O evento mudou. Atualize e tente novamente.'); };
async function remoteEvent(connection: ConnectionRow, calendar: CalendarRow, id: string) {
  const remote = await googleJson<GoogleEvent>(connection, { service: 'calendar', path: eventPath(calendar, id) });
  if (privateHidden(calendar, { visibility: remote.visibility ?? 'default' }))
    throw new CapabilityError('FORBIDDEN', 'Este evento privado não está disponível para sua permissão no Google.');
  return remote;
}
async function liveEvent(connection: ConnectionRow, calendar: CalendarRow, row: EventRow) {
  try { return await remoteEvent(connection, calendar, row.google_event_id); }
  catch (error) {
    const state = error instanceof GoogleApiError && [404, 410].includes(error.status) ? 'remote_deleted'
      : error instanceof GoogleApiError && error.status === 403 ? 'permission_lost' : null;
    if (state) {
      await database.prepare('UPDATE personal_event SET sync_state=?,sync_error=?,version=version+1 WHERE id=? AND office_id=? AND user_id=?')
        .run(state, state === 'remote_deleted' ? 'Evento removido no Google.' : 'Permissão removida no Google.', row.id, row.office_id, row.user_id);
      throw new CapabilityError('CONFLICT', 'O Google removeu o evento ou sua permissão. Revise a pendência na Agenda.');
    }
    throw error;
  }
}
async function result(calendar: CalendarRow, remote: GoogleEvent) {
  if (privateHidden(calendar, { visibility: remote.visibility ?? 'default' }))
    throw new CapabilityError('FORBIDDEN', 'Este evento privado não está disponível para sua permissão no Google.');
  const row = await saveRemoteEvent(calendar, remote);
  if (!row) throw new CapabilityError('CONFLICT', 'Há uma alteração pendente neste evento.');
  return eventDto(row, calendar);
}
export async function listCalendars(context: WorkspaceContext, _input: Input<'k5_calendar_list_calendars'>) {
  void _input;
  await requireConnection(context, 'calendar');
  return { calendars: (await calendars(context)).map(calendarDto) };
}
export async function selectCalendars(context: WorkspaceContext, input: Input<'k5_calendar_select_calendars'>) {
  const connection = await requireConnection(context, 'calendar');
  const rows = (await calendars(context)).filter(c => c.connection_id === connection.id);
  if (input.calendarIds.some(id => !rows.some(c => c.id === id))) throw new CapabilityError('NOT_FOUND', 'Calendário não encontrado na sua conta.');
  await database.prepare(`UPDATE google_calendar SET selected=CASE WHEN id=ANY(?) THEN 1 ELSE 0 END,
    sync_state=CASE WHEN id=ANY(?) AND selected=0 THEN 'pending' ELSE sync_state END,updated_at=CURRENT_TIMESTAMP
    WHERE office_id=? AND user_id=? AND connection_id=?`).run(input.calendarIds, input.calendarIds, context.officeId, context.userId, connection.id);
  for (const id of input.calendarIds) await enqueueGoogleJob({ officeId: context.officeId, userId: context.userId, connectionId: connection.id,
    kind: 'calendar_sync', subjectId: id, dedupeKey: `calendar-sync:${id}` });
  return listCalendars(context, {});
}
export async function syncNow(context: WorkspaceContext, _input: Input<'k5_calendar_sync_now'>) {
  void _input;
  const connection = await requireConnection(context, 'calendar');
  await enqueueGoogleJob({ officeId: context.officeId, userId: context.userId, connectionId: connection.id, kind: 'calendar_list', dedupeKey: `calendar-list:${connection.id}` });
  const rows = (await calendars(context)).filter(c => c.selected && c.connection_id === connection.id);
  for (const row of rows) await enqueueGoogleJob({ officeId: context.officeId, userId: context.userId, connectionId: connection.id,
    kind: 'calendar_sync', subjectId: row.id, dedupeKey: `calendar-sync:${row.id}` });
  return { queued: rows.length + 1 };
}
export async function listEvents(context: WorkspaceContext, input: Input<'k5_calendar_list_events'>) {
  const connection = await requireConnection(context, 'calendar');
  if (Date.parse(input.to) <= Date.parse(input.from)) throw new CapabilityError('INVALID', 'Período inválido.');
  const selected = (await calendars(context)).filter(c => c.connection_id === connection.id && c.selected);
  const ids = input.calendarIds?.length ? input.calendarIds : selected.map(c => c.id);
  if (ids.some(id => !selected.some(c => c.id === id))) throw new CapabilityError('NOT_FOUND', 'Calendário não encontrado na sua conta.');
  if (!ids.length) return { events: [], truncated: false, untrustedContent: true as const };
  // The durable incremental mirror holds series and exceptions; expand instances for this visible window.
  for (const calendar of selected.filter(c => ids.includes(c.id))) {
    let pageToken: string | undefined;
    const seen=new Set<string>();
    do {
      const page = await googleJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(connection,
        { service: 'calendar', path: eventPath(calendar), query: { singleEvents: true, showDeleted: true,
          timeMin: input.from, timeMax: input.to, maxResults: 250, pageToken } });
      for (const remote of page.items ?? []) if (remote.id) {
        seen.add(remote.id);
        if (privateHidden(calendar, { visibility: remote.visibility ?? 'default' })) continue;
        if(remote.status==='cancelled'&&!remote.start){
          const existing=await database.prepare('SELECT id FROM personal_event WHERE calendar_id=? AND google_event_id=?')
            .get<{id:string}>(calendar.id,remote.id);
          if(existing){await database.prepare("UPDATE personal_event SET status='cancelled',sync_state='synced',version=version+1 WHERE id=? AND sync_state='synced' AND status<>'cancelled'")
            .run(existing.id);continue;}
          const at=remote.originalStartTime?.dateTime??remote.originalStartTime?.date;
          if(!at)continue;
          const allDay=Boolean(remote.originalStartTime?.date);
          remote.start=allDay?{date:at}:{dateTime:at};
          remote.end=allDay?{date:new Date(Date.parse(at+'T00:00:00Z')+86400_000).toISOString().slice(0,10)}
            :{dateTime:new Date(Date.parse(at)+60_000).toISOString()};
        }
        await saveRemoteEvent(calendar, remote);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    await database.prepare(`UPDATE personal_event SET sync_state='remote_deleted',sync_error='Evento ausente na agenda Google deste período.',version=version+1
      WHERE office_id=? AND user_id=? AND calendar_id=? AND sync_state='synced' AND status<>'cancelled'
      AND (recurring_event_id IS NOT NULL OR cardinality(recurrence)=0)
      AND ((start_at<? AND end_at>?) OR (start_date<?::date AND end_date>?::date))
      AND google_event_id<>ALL(?)`).run(context.officeId,context.userId,calendar.id,input.to,input.from,
        input.to.slice(0,10),input.from.slice(0,10),[...seen]);
  }
  const limit = input.limit ?? 200;
  const rows = await database.prepare(`SELECT e.*,s.id AS share_id FROM personal_event e JOIN google_calendar c ON c.id=e.calendar_id LEFT JOIN personal_event_share s
    ON s.event_id=e.id AND s.revoked_at IS NULL WHERE e.office_id=? AND e.user_id=? AND e.calendar_id=ANY(?)
    AND NOT (c.access_role='writerWithoutPrivateAccess' AND e.visibility IN ('private','confidential'))
    AND (e.status<>'cancelled' OR e.sync_state<>'synced')
    AND (e.recurring_event_id IS NOT NULL OR cardinality(e.recurrence)=0)
    AND ((e.start_at<? AND e.end_at>?) OR (e.start_date<?::date AND e.end_date>?::date))
    AND (?='' OR e.summary ILIKE ? OR e.description ILIKE ?)
    ORDER BY COALESCE(e.start_at,e.start_date::timestamptz),e.id LIMIT ?`)
    .all<EventRow & { share_id: string | null }>(context.officeId, context.userId, ids, input.to, input.from,
      input.to.slice(0,10), input.from.slice(0,10), input.query ?? '', `%${input.query ?? ''}%`, `%${input.query ?? ''}%`, limit + 1);
  const byId = new Map(selected.map(c => [c.id, c]));
  return { events: rows.slice(0,limit).map(row => eventDto(row, byId.get(row.calendar_id)!, row.share_id)), truncated: rows.length > limit, untrustedContent: true as const };
}
export async function getEvent(context: WorkspaceContext, input: Input<'k5_calendar_get_event'>) {
  const connection = await requireConnection(context, 'calendar');
  let row = await ownEvent(context, input.eventId, connection);
  const calendar = await ownCalendar(context, row.calendar_id, connection);
  if (privateHidden(calendar,row)) throw new CapabilityError('NOT_FOUND','Evento não encontrado.');
  if (input.occurrenceStart && row.original_start !== input.occurrenceStart)
    row = await resolveOccurrence(connection, calendar, row, input.occurrenceStart);
  if (privateHidden(calendar,row)) throw new CapabilityError('NOT_FOUND','Evento não encontrado.');
  const share = await database.prepare('SELECT id FROM personal_event_share WHERE event_id=? AND revoked_at IS NULL AND occurrence_start=?')
    .get<{ id: string }>(row.id, input.occurrenceStart ?? '');
  return { event: eventDto(row, calendar, share?.id ?? null), untrustedContent: true as const };
}
async function byMarker(operation: RunningOperation, calendar: CalendarRow) {
  const response = await googleJson<{ items?: GoogleEvent[] }>(operation.connection, { service: 'calendar', path: eventPath(calendar),
    query: { privateExtendedProperty: `k5Operation=${operation.reconcileKey}`, maxResults: 2 } });
  return response.items?.find(event => event.extendedProperties?.private?.k5Operation === operation.reconcileKey);
}
const createdId=(operation:RunningOperation)=>`k5${operation.id.replace(/-/g,'')}`;
async function createdEvent(operation:RunningOperation,calendar:CalendarRow) {
  try{
    const found=await remoteEvent(operation.connection,calendar,createdId(operation));
    return found.extendedProperties?.private?.k5Operation===operation.reconcileKey?found:undefined;
  }catch(error){if(error instanceof GoogleApiError&&error.status===404)return undefined;throw error;}
}
export async function createEvent(context: WorkspaceContext, input: Input<'k5_calendar_create_event'>) {
  const connection = await requireConnection(context, 'calendar');
  const calendar = await ownCalendar(context, input.calendarId, connection); assertWritable(calendar); validateEventTime(input);
  const outcome = await runGoogleOperation(context, { module: 'calendar', actions: ['calendar.create'], capabilityName: 'k5_calendar_create_event',
    input, targetResourceId: calendar.id, describe: `Criar ${input.title} em ${calendar.summary}`,
    bound:{review:review([['Calendário',calendar.summary],['Título',input.title],['Descrição',input.description||'Sem descrição'],
      ['Local',input.location||'Sem local'],['Dia inteiro',input.allDay??false],['Início',input.startsAt??input.startDate],
      ['Fim exclusivo',input.endsAt??input.endDate],['Fuso',input.timeZone],['Recorrência',input.recurrence?.join(', ')||'Nenhuma'],
      ['Convidados',input.attendees?.map(a=>`${a.email}${a.optional?' (opcional)':''}`).join(', ')||'Nenhum'],['Google Meet',input.addMeet??false]])},
    execute: async operation => {
      const body = eventBody({ ...input, description: input.description ?? '', location: input.location ?? '', allDay: input.allDay ?? false,
        startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, startDate: input.startDate ?? null, endDate: input.endDate ?? null,
        timeZone: input.timeZone ?? null, recurrence: input.recurrence ?? [], attendees: (input.attendees ?? []).map(a=>({email:a.email,optional:a.optional??false})) }, operation.reconcileKey);
      const remote = await googleJson<GoogleEvent>(operation.connection, { service: 'calendar', method: 'POST', path: eventPath(calendar),
        query: { sendUpdates: 'all', ...(input.addMeet ? { conferenceDataVersion: 1 } : {}) },
        json: { ...body, id: createdId(operation), ...(input.addMeet ? { conferenceData: { createRequest: { requestId: operation.reconcileKey, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}) } });
      return { externalRef: remote.id, result: await result(calendar, remote) };
    }, reconcile: async operation => {
      const found = await createdEvent(operation, calendar);
      return found ? { state: 'found', externalRef: found.id, result: await result(calendar, found) } : { state: 'unknown' };
    } });
  return { event: outcome.result, operation: outcome.operation };
}
function changedPatch(remote: GoogleEvent, changes: Input<'k5_calendar_update_event'>['changes']): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (changes.title !== undefined) patch.summary = changes.title;
  if (changes.description !== undefined) patch.description = changes.description;
  if (changes.location !== undefined) patch.location = changes.location;
  if (changes.recurrence !== undefined) patch.recurrence = changes.recurrence;
  if (changes.attendees !== undefined) {
    const previous = new Map((remote.attendees ?? []).map(a => [a.email.toLowerCase(), a]));
    patch.attendees = changes.attendees.map(a => ({ ...previous.get(a.email.toLowerCase()), email: a.email, optional: a.optional }));
  }
  if (['allDay','startsAt','endsAt','startDate','endDate','timeZone'].some(key => key in changes)) {
    const allDay = changes.allDay ?? Boolean(remote.start?.date);
    const time = { allDay, startsAt: allDay ? null : changes.startsAt ?? remote.start?.dateTime ?? null,
      endsAt: allDay ? null : changes.endsAt ?? remote.end?.dateTime ?? null,
      startDate: allDay ? changes.startDate ?? remote.start?.date ?? null : null,
      endDate: allDay ? changes.endDate ?? remote.end?.date ?? null : null,
      timeZone: changes.timeZone ?? remote.start?.timeZone ?? remote.end?.timeZone ?? null };
    validateEventTime(time);
    patch.start = allDay ? { date: time.startDate } : { dateTime: time.startsAt, timeZone: time.timeZone };
    patch.end = allDay ? { date: time.endDate } : { dateTime: time.endsAt, timeZone: time.timeZone };
  }
  return patch;
}
async function updateRemote(operation: RunningOperation, calendar: CalendarRow, row: EventRow, changes: Input<'k5_calendar_update_event'>['changes'],
  reviewedRecipients?:string[]) {
  for (let attempt=0; attempt<3; attempt++) {
    const remote = await liveEvent(operation.connection, calendar, row);
    if(reviewedRecipients)assertRecipientsUnchanged(remote,reviewedRecipients);
    const patch = changedPatch(remote, changes);
    if (!Object.keys(patch).length) return remote;
    try { return await googleJson<GoogleEvent>(operation.connection, { service: 'calendar', method: 'PATCH',
      path: eventPath(calendar,row.google_event_id), query: { sendUpdates: 'all' },
      headers: remote.etag ? { 'if-match': remote.etag } : {}, json: patch }); }
    catch (error) { if (!(error instanceof GoogleApiError) || error.status !== 412 || attempt===2) throw error; }
  }
  throw new CapabilityError('CONFLICT', 'O evento mudou durante a edição.');
}
async function target(context: WorkspaceContext, input: Input<'k5_calendar_update_event'> | Input<'k5_calendar_cancel_event'>, connection: ConnectionRow) {
  let row = await ownEvent(context, input.eventId, connection); assertVersion(row, input.version);
  const calendar = await ownCalendar(context,row.calendar_id,connection); assertWritable(calendar,row);
  if (input.scope === 'occurrence') {
    if (!input.occurrenceStart) throw new CapabilityError('INVALID','Informe a ocorrência da série.');
    if (row.original_start !== input.occurrenceStart) row=await resolveOccurrence(connection,calendar,row,input.occurrenceStart);
  } else if (input.scope === 'series' && row.recurring_event_id) {
    const parent=await database.prepare('SELECT * FROM personal_event WHERE calendar_id=? AND google_event_id=? AND office_id=? AND user_id=?')
      .get<EventRow>(calendar.id,row.recurring_event_id,context.officeId,context.userId);
    row=parent??(await saveRemoteEvent(calendar,await remoteEvent(connection,calendar,row.recurring_event_id)))!;
  }
  if (input.scope === 'following' && !input.occurrenceStart) throw new CapabilityError('INVALID','Informe a ocorrência a partir da qual a série muda.');
  assertWritable(calendar,row);
  if (['remote_deleted','permission_lost'].includes(row.sync_state)) throw new CapabilityError('CONFLICT','Há pendência neste evento.');
  return { row, calendar };
}
const original = (event:GoogleEvent) => event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? null;
const compareOriginal = (left:string,right:string) => left.length===10&&right.length===10
  ? left.localeCompare(right) : Date.parse(left)-Date.parse(right);
async function allInstances(connection:ConnectionRow,calendar:CalendarRow,seriesId:string,stopAt:string) {
  const found:GoogleEvent[]=[];
  let pageToken:string|undefined;
  do {
    const page=await googleJson<{items?:GoogleEvent[];nextPageToken?:string}>(connection,
      {service:'calendar',path:`${eventPath(calendar,seriesId)}/instances`,query:{maxResults:250,showDeleted:true,pageToken}});
    for(const instance of page.items??[]){
      found.push(instance);
      if(original(instance)&&compareOriginal(original(instance)!,stopAt)===0)return found;
    }
    pageToken=page.nextPageToken;
    if(found.length>10_000)throw new CapabilityError('INVALID','A série excede o limite de divisão segura.');
  }while(pageToken);
  throw new CapabilityError('NOT_FOUND','A ocorrência não existe mais no Google.');
}
async function futureExceptions(connection:ConnectionRow,calendar:CalendarRow,seriesId:string,at:string) {
  const found:GoogleEvent[]=[];let pageToken:string|undefined;
  do{
    const page=await googleJson<{items?:GoogleEvent[];nextPageToken?:string}>(connection,
      {service:'calendar',path:eventPath(calendar),query:{singleEvents:false,showDeleted:true,maxResults:250,pageToken}});
    for(const event of page.items??[])if(event.recurringEventId===seriesId&&original(event)&&compareOriginal(original(event)!,at)>=0)found.push(event);
    pageToken=page.nextPageToken;
  }while(pageToken);
  return found.sort((a,b)=>compareOriginal(original(a)!,original(b)!));
}
async function matchingInstance(connection:ConnectionRow,calendar:CalendarRow,seriesId:string,at:string) {
  const page=await googleJson<{items?:GoogleEvent[]}>(connection,
    {service:'calendar',path:`${eventPath(calendar,seriesId)}/instances`,query:{originalStart:at,showDeleted:true,maxResults:2}});
  return page.items?.find(event=>original(event)&&compareOriginal(original(event)!,at)===0);
}
async function resolveOccurrence(connection:ConnectionRow,calendar:CalendarRow,row:EventRow,at:string) {
  const remote=await matchingInstance(connection,calendar,row.recurring_event_id??row.google_event_id,at);
  if(!remote)throw new CapabilityError('NOT_FOUND','Ocorrência não encontrada no Google.');
  return (await saveRemoteEvent(calendar,remote)) ??
    (await database.prepare('SELECT * FROM personal_event WHERE calendar_id=? AND google_event_id=?')
      .get<EventRow>(calendar.id,remote.id))!;
}
function splitRules(recurrence:string[],start:string,previous:string,previousCount:number) {
  const until=previous.includes('T')?new Date(Date.parse(previous)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''):previous.replace(/-/g,'');
  const old:string[]=[],next:string[]=[];
  for(const rule of recurrence){
    if(rule.startsWith('RRULE:')){
      const parts=rule.slice(6).split(';').filter(p=>!p.startsWith('COUNT=')&&!p.startsWith('UNTIL='));
      const count=rule.match(/(?:^|;)COUNT=(\d+)/)?.[1];
      if(count){
        const total=Number(count);
        old.push(`RRULE:${parts.join(';')};COUNT=${previousCount}`);
        next.push(`RRULE:${parts.join(';')};COUNT=${total-previousCount}`);
      }else{
        old.push(`RRULE:${parts.join(';')};UNTIL=${until}`);
        next.push(rule);
      }
    }else{
      const date=rule.split(':')[1]?.slice(0,8)??'';
      const boundary=start.slice(0,10).replace(/-/g,'');
      (date<boundary?old:next).push(rule);
    }
  }
  return {old,next};
}
async function splitFollowing(operation:RunningOperation,calendar:CalendarRow,row:EventRow,at:string,
  changes:Input<'k5_calendar_update_event'>['changes']|null,reviewedAudience?:string) {
  const parentId=row.recurring_event_id??row.google_event_id;
  const parent=await remoteEvent(operation.connection,calendar,parentId);
  if(!parent.recurrence?.some(rule=>rule.startsWith('RRULE:')))throw new CapabilityError('INVALID','Este evento não é uma série recorrente.');
  const instances=await allInstances(operation.connection,calendar,parentId,at);
  const targetInstance=instances.at(-1)!;
  const exceptions=await futureExceptions(operation.connection,calendar,parentId,at);
  if(reviewedAudience&&JSON.stringify({parent:recipients(parent),exceptions:exceptions.map(e=>[original(e),recipients(e)])})!==reviewedAudience)
    throw new CapabilityError('CONFLICT','Os convidados ou exceções mudaram no Google. Revise e confirme a ação novamente.');
  if(exceptions.length&&changes&&['recurrence','startsAt','endsAt','startDate','endDate','timeZone','allDay']
      .some(key=>key in changes))throw new CapabilityError('INVALID',
        'Esta série tem exceções futuras. Altere horário, fuso ou repetição por ocorrência antes de dividir a série.');
  const prior=instances.filter(item=>original(item)&&compareOriginal(original(item)!,at)<0).length;
  if(!prior) {
    if(!changes){
      await googleRequest(operation.connection,{service:'calendar',method:'DELETE',path:eventPath(calendar,parentId),
        query:{sendUpdates:'all'},headers:parent.etag?{'if-match':parent.etag}:{}});
      return null;
    }
    const refreshed=await updateRemote(operation,calendar,{...row,google_event_id:parentId},changes,recipients(parent));
    return result(calendar,refreshed);
  }
  const rules=splitRules(parent.recurrence,at,original(instances.filter(item=>original(item)&&compareOriginal(original(item)!,at)<0).at(-1)!)!,prior);
  if(rules.next.some(rule=>/^RRULE:.*COUNT=0(?:;|$)/.test(rule)))throw new CapabilityError('INVALID','Não há próximas ocorrências para alterar.');
  await checkpointOperation(operation,{phase:'prepared',parentId,at,exceptions});
  await googleJson<GoogleEvent>(operation.connection,{service:'calendar',method:'PATCH',path:eventPath(calendar,parentId),
    query:{sendUpdates:'all'},headers:parent.etag?{'if-match':parent.etag}:{},json:{recurrence:rules.old}});
  await markOperationEffect(operation,{phase:'series_truncated',parentId,at,exceptions});
  if(!changes)return null;
  const body={...parent,id:undefined,etag:undefined,iCalUID:undefined,recurringEventId:undefined,originalStartTime:undefined,
    start:targetInstance.start,end:targetInstance.end,recurrence:rules.next,
    extendedProperties:{...parent.extendedProperties,private:{...parent.extendedProperties?.private,k5Operation:operation.reconcileKey}}};
  const next={...body,...changedPatch(body as unknown as GoogleEvent,changes)};
  const remote=await googleJson<GoogleEvent>(operation.connection,{service:'calendar',method:'POST',path:eventPath(calendar),
    query:{sendUpdates:'all',conferenceDataVersion:1},json:next});
  await markOperationEffect(operation,{phase:'successor_created',parentId,successorId:remote.id,at,exceptions});
  for(const exception of exceptions){
    const originalStart=original(exception)!;
    const successor=await matchingInstance(operation.connection,calendar,remote.id,originalStart);
    if(!successor)throw new CapabilityError('CONFLICT','A nova série não contém uma exceção; o resultado precisa ser verificado.');
    const patch:Record<string,unknown>={};
    for(const key of ['status','summary','description','location','start','end','attendees'] as const){
      if(exception[key]!==undefined)patch[key]=exception[key];
    }
    await googleJson(operation.connection,{service:'calendar',method:'PATCH',path:eventPath(calendar,successor.id),
      query:{sendUpdates:'all'},headers:successor.etag?{'if-match':successor.etag}:{},json:patch});
    await markOperationEffect(operation,{phase:'exception_copied',parentId,successorId:remote.id,at,exceptions,lastCopied:exception.id});
  }
  await markOperationEffect(operation,{phase:'complete',parentId,successorId:remote.id,at,exceptions});
  return result(calendar,remote);
}
export async function updateEvent(context: WorkspaceContext, input: Input<'k5_calendar_update_event'>) {
  const connection = await requireConnection(context,'calendar');
  const {row,calendar} = await target(context,input,connection);
  const remote=await liveEvent(connection,calendar,row);
  const reviewedRecipients=recipients(remote);
  const parent=input.scope==='following'&&row.recurring_event_id?await remoteEvent(connection,calendar,row.recurring_event_id):remote;
  const exceptions=input.scope==='following'?await futureExceptions(connection,calendar,parent.id,input.occurrenceStart!):[];
  const audience=JSON.stringify({parent:recipients(parent),exceptions:exceptions.map(e=>[original(e),recipients(e)])});
  const outcome = await runGoogleOperation(context,{module:'calendar',actions:['calendar.update'],capabilityName:'k5_calendar_update_event',
    input,targetResourceId:row.id,effectKey:`calendar:${calendar.id}:event:${row.recurring_event_id??row.google_event_id}`,
    bound:{etag:remote.etag,reviewedRecipients,audience,
      review:[...review([['Calendário',calendar.summary],['Evento',row.summary],['Escopo',scopeLabel[input.scope??'series']],
        ['Ocorrência',input.occurrenceStart],['Convidados atuais',recipientReview(parent)],
        ['Convidados em exceções futuras',exceptions.flatMap(e=>recipients(e)).join(', ')||'Nenhum'],
        ['Versão local',input.version],['Versão Google',remote.etag]]),...changesReview(input.changes)]},describe:`Alterar ${row.summary}`,
    execute:async operation=>{
      const saved=input.scope==='following'
        ? await splitFollowing(operation,calendar,row,input.occurrenceStart!,input.changes,audience)
        : await result(calendar,await updateRemote(operation,calendar,row,input.changes,reviewedRecipients));
      return {externalRef:row.google_event_id,result:saved};
    },
    reconcile:async operation=>input.scope==='following'?reconcileFollowing(operation,calendar,row):reconcileMutation(operation,calendar,row) });
  return {event:outcome.result,operation:outcome.operation};
}
export async function cancelEvent(context: WorkspaceContext,input:Input<'k5_calendar_cancel_event'>) {
  const connection=await requireConnection(context,'calendar');
  const {row,calendar}=await target(context,input,connection);
  const remoteSnapshot=await liveEvent(connection,calendar,row);
  const parent=input.scope==='following'&&row.recurring_event_id?await remoteEvent(connection,calendar,row.recurring_event_id):remoteSnapshot;
  const exceptions=input.scope==='following'?await futureExceptions(connection,calendar,parent.id,input.occurrenceStart!):[];
  const audience=JSON.stringify({parent:recipients(parent),exceptions:exceptions.map(e=>[original(e),recipients(e)])});
  const outcome=await runGoogleOperation(context,{module:'calendar',actions:['calendar.cancel'],capabilityName:'k5_calendar_cancel_event',
    input,targetResourceId:row.id,effectKey:`calendar:${calendar.id}:event:${row.recurring_event_id??row.google_event_id}`,
    bound:{etag:remoteSnapshot.etag,reviewedRecipients:recipients(remoteSnapshot),audience,
      review:review([['Calendário',calendar.summary],['Evento',row.summary],['Escopo',scopeLabel[input.scope??'series']],
        ['Ocorrência',input.occurrenceStart],['Convidados avisados',recipientReview(parent)],
        ['Convidados em exceções futuras',exceptions.flatMap(e=>recipients(e)).join(', ')||'Nenhum'],
        ['Versão local',input.version],['Versão Google',remoteSnapshot.etag]])},describe:`Cancelar ${row.summary}`,
    execute:async operation=>{
      if(input.scope==='following'){
        await splitFollowing(operation,calendar,row,input.occurrenceStart!,null,audience);
        return {externalRef:row.google_event_id,result:null};
      }
      const remote=await liveEvent(operation.connection,calendar,row);
      assertRecipientsUnchanged(remote,recipients(remoteSnapshot));
      await googleRequest(operation.connection,{service:'calendar',method:'DELETE',path:eventPath(calendar,row.google_event_id),
        query:{sendUpdates:'all'},headers:remote.etag?{'if-match':remote.etag}:{}});
      await database.prepare("UPDATE personal_event SET status='cancelled',sync_state='synced',version=version+1 WHERE id=?").run(row.id);
      return {externalRef:row.google_event_id,result:null};
    },reconcile:async operation=>input.scope==='following'?reconcileFollowing(operation,calendar,row):reconcileMutation(operation,calendar,row)});
  return {operation:outcome.operation};
}
async function reconcileFollowing(operation:RunningOperation,calendar:CalendarRow,row:EventRow) {
  try{
    if(operation.args.changes){
      const found=await byMarker(operation,calendar);
      if(!found)return {state:'unknown' as const};
      const exceptions=Array.isArray(operation.checkpoint?.exceptions)?operation.checkpoint.exceptions as GoogleEvent[]:[];
      for(const exception of exceptions){
        const successor=await matchingInstance(operation.connection,calendar,found.id,original(exception)!);
        if(!successor)return {state:'unknown' as const};
        for(const key of ['status','summary','description','location','start','end','attendees'] as const){
          if(exception[key]!==undefined&&JSON.stringify(exception[key])!==JSON.stringify(successor[key]))return {state:'unknown' as const};
        }
      }
      return {state:'found' as const,externalRef:found.id,result:await result(calendar,found)};
    }
    const parent=await remoteEvent(operation.connection,calendar,row.recurring_event_id??row.google_event_id);
    const at=String(operation.args.occurrenceStart??'');
    let instances:GoogleEvent[];
    try{instances=await allInstances(operation.connection,calendar,parent.id,at);}
    catch(error){
      if(error instanceof CapabilityError&&error.code==='NOT_FOUND')
        return {state:'found' as const,externalRef:parent.id,result:null};
      return {state:'unknown' as const};
    }
    return instances.some(instance=>original(instance)===at)?{state:'unknown' as const}
      :{state:'found' as const,externalRef:parent.id,result:null};
  }catch{return {state:'unknown' as const};}
}
export async function respondEvent(context:WorkspaceContext,input:Input<'k5_calendar_respond'>) {
  const connection=await requireConnection(context,'calendar');
  const row=await ownEvent(context,input.eventId,connection);
  const calendar=await ownCalendar(context,row.calendar_id,connection);assertWritable(calendar,row);
  const snapshot=await liveEvent(connection,calendar,row);
  const responseLabel={accepted:'Aceitar',declined:'Recusar',tentative:'Talvez'}[input.response];
  const outcome=await runGoogleOperation(context,{module:'calendar',actions:['calendar.respond'],capabilityName:'k5_calendar_respond',
    input,targetResourceId:row.id,effectKey:`calendar:${calendar.id}:event:${row.recurring_event_id??row.google_event_id}`,
    bound:{etag:snapshot.etag,reviewedRecipients:recipients(snapshot),
      review:review([['Calendário',calendar.summary],['Evento',row.summary],['Ocorrência',input.occurrenceStart],
        ['Organizador',snapshot.organizer?.email],['Convidados',recipientReview(snapshot)],['Resposta',responseLabel],['Versão Google',snapshot.etag]])},
    describe:`Responder convite de ${row.summary}`,
    execute:async operation=>{
      for(let attempt=0;attempt<3;attempt++){
        const remote=await liveEvent(operation.connection,calendar,row);
        assertRecipientsUnchanged(remote,recipients(snapshot));
        const attendees=remote.attendees??[];
        const me=attendees.find(a=>a.self||a.email.toLowerCase()===operation.connection.email.toLowerCase());
        if(!me)throw new CapabilityError('FORBIDDEN','Sua conta não consta entre os convidados.');
        try{
          const saved=await googleJson<GoogleEvent>(operation.connection,{service:'calendar',method:'PATCH',path:eventPath(calendar,row.google_event_id),
            headers:remote.etag?{'if-match':remote.etag}:{},query:{sendUpdates:'all'},
            json:{attendees:attendees.map(a=>a===me?{...a,responseStatus:input.response}:a)}});
          return {externalRef:saved.id,result:await result(calendar,saved)};
        }catch(error){if(!(error instanceof GoogleApiError)||error.status!==412||attempt===2)throw error;}
      }
      throw new CapabilityError('CONFLICT','O convite mudou.');
    },reconcile:async operation=>reconcileMutation(operation,calendar,row)});
  return {event:outcome.result,operation:outcome.operation};
}
async function reconcileMutation(operation:RunningOperation,calendar:CalendarRow,row:EventRow) {
  try{
    const remote=await remoteEvent(operation.connection,calendar,row.google_event_id);
    if(operation.args.response){
      const me=remote.attendees?.find(a=>a.self||a.email.toLowerCase()===operation.connection.email.toLowerCase());
      if(me?.responseStatus!==operation.args.response)return {state:'unknown' as const};
    }else if(operation.args.changes){
      const patch=changedPatch(remote,operation.args.changes as Input<'k5_calendar_update_event'>['changes']);
      if(!Object.entries(patch).every(([key,value])=>JSON.stringify((remote as unknown as Record<string,unknown>)[key])===JSON.stringify(value)))return {state:'unknown' as const};
    }else if(remote.status!=='cancelled')return {state:'unknown' as const};
    return {state:'found' as const,externalRef:remote.id,result:operation.args.changes||operation.args.response?await result(calendar,remote):null};
  }catch(error){
    return !operation.args.changes&&!operation.args.response&&error instanceof GoogleApiError&&error.status===404
      ? {state:'found' as const,externalRef:row.google_event_id,result:null}:{state:'unknown' as const};
  }
}
export async function discardPending(context:WorkspaceContext,input:Input<'k5_calendar_discard_pending'>) {
  await requireWriter(context);
  const connection=await requireConnection(context,'calendar');
  const row=await ownEvent(context,input.eventId,connection);
  if(row.sync_state!=='synced')await database.prepare("UPDATE personal_event SET pending_fields_json=NULL,sync_state='synced',sync_error=NULL,version=version+1 WHERE id=? AND office_id=? AND user_id=?")
    .run(row.id,context.officeId,context.userId);
  return {success:true};
}
type Share={id:string;owner_name:string;owner_user_id:string;title:string;notes:string;location:string;all_day:number;starts_at:string|null;ends_at:string|null;start_date:string|null;end_date:string|null;version:number};
const shareDto=(row:Share,context:Owner)=>({id:row.id,ownerName:row.owner_name,mine:row.owner_user_id===context.userId,title:row.title,notes:row.notes,
  location:row.location,allDay:Boolean(row.all_day),startsAt:row.starts_at,endsAt:row.ends_at,startDate:row.start_date,endDate:row.end_date,version:row.version});
export async function shareEvent(context:WorkspaceContext,input:Input<'k5_calendar_share_event'>) {
  await requireWriter(context);
  const connection=await requireConnection(context,'calendar');
  const event=await ownEvent(context,input.eventId,connection);
  const calendar=await ownCalendar(context,event.calendar_id,connection);
  if(privateHidden(calendar,event))throw new CapabilityError('NOT_FOUND','Evento não encontrado.');
  if(input.occurrenceStart&&input.occurrenceStart!==event.original_start)throw new CapabilityError('NOT_FOUND','Ocorrência não encontrada.');
  const row=await database.prepare(`INSERT INTO personal_event_share(id,office_id,owner_user_id,event_id,occurrence_start,title,notes,location,all_day,starts_at,ends_at,start_date,end_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,occurrence_start) WHERE revoked_at IS NULL DO UPDATE SET
    title=EXCLUDED.title,notes=EXCLUDED.notes,location=EXCLUDED.location,all_day=EXCLUDED.all_day,
    starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,
    version=personal_event_share.version+1,updated_at=CURRENT_TIMESTAMP
    RETURNING *, (SELECT name FROM "user" WHERE id=owner_user_id) AS owner_name`).get<Share>(randomUUID(),context.officeId,context.userId,event.id,
      input.occurrenceStart??'',input.title,input.notes,input.location,event.all_day,event.start_at,event.end_at,event.start_date,event.end_date);
  return {share:shareDto(row!,context)};
}
export async function unshareEvent(context:WorkspaceContext,input:Input<'k5_calendar_unshare_event'>) {
  await requireWriter(context);
  const changed=await database.prepare('UPDATE personal_event_share SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND owner_user_id=? AND revoked_at IS NULL')
    .run(input.shareId,context.officeId,context.userId);
  if(!changed.changes)throw new CapabilityError('NOT_FOUND','Compartilhamento não encontrado.');
  return {success:true};
}
export async function listShared(context:WorkspaceContext,input:Input<'k5_calendar_list_shared'>) {
  await memberRole(context);
  if(Date.parse(input.to)<=Date.parse(input.from))throw new CapabilityError('INVALID','Período inválido.');
  const rows=await database.prepare(`SELECT s.*,u.name AS owner_name FROM personal_event_share s JOIN "user" u ON u.id=s.owner_user_id
    JOIN personal_event e ON e.id=s.event_id AND e.office_id=s.office_id
    WHERE s.office_id=? AND s.revoked_at IS NULL AND e.status<>'cancelled' AND e.sync_state<>'remote_deleted'
    AND ((s.starts_at<? AND s.ends_at>?) OR (s.start_date<?::date AND s.end_date>?::date))
    ORDER BY COALESCE(s.starts_at,s.start_date::timestamptz),s.id LIMIT ?`)
    .all<Share>(context.officeId,input.to,input.from,input.to.slice(0,10),input.from.slice(0,10),input.limit??200);
  return {events:rows.map(row=>shareDto(row,context))};
}
async function reconcileSaved(operation:RunningOperation) {
  const owner={officeId:operation.connection.office_id,userId:operation.connection.user_id};
  const row=await ownEvent(owner,String(operation.args.eventId),operation.connection).catch(()=>null);
  if(!row)return {state:'unknown' as const};
  const calendar=await ownCalendar(owner,row.calendar_id,operation.connection);
  return operation.args.scope==='following'?reconcileFollowing(operation,calendar,row):reconcileMutation(operation,calendar,row);
}
export const calendarReconcilers:Partial<Record<GoogleAction,Reconciler>>={
  'calendar.create':async operation=>{
    const calendar=await ownCalendar({officeId:operation.connection.office_id,userId:operation.connection.user_id},String(operation.args.calendarId),operation.connection).catch(()=>null);
    if(!calendar)return {state:'unknown'};
    const found=await createdEvent(operation,calendar);
    return found?{state:'found',externalRef:found.id,result:await result(calendar,found)}:{state:'unknown'};
  },
  'calendar.update':reconcileSaved,'calendar.cancel':reconcileSaved,'calendar.respond':reconcileSaved,
};
