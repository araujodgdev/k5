import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { requireConnection, googleJson } from '../connections';
import { calendarWebhookUrl } from '../config';
import { enqueueGoogleJob, checkpointGoogleJob, type GoogleJob } from '../jobs';
import { GoogleApiError } from '../transport';
import { eventPath, saveRemoteEvent, type CalendarRow, type GoogleEvent } from './model';

type CalendarListPage = { items?: Array<{ id: string; summary?: string; timeZone?: string; accessRole?: string; primary?: boolean; deleted?: boolean }>; nextPageToken?: string };
type EventPage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
type Checkpoint = { baseToken: string | null; pageToken: string | null; seenIds: string[]; full: boolean };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validLease = async (job: GoogleJob, db: Database) => Boolean(await db.prepare(
  "SELECT 1 FROM google_job WHERE id=? AND lease_token=? AND status='running' AND lease_until>CURRENT_TIMESTAMP")
  .get(job.id, job.lease_token));
async function authority(job: GoogleJob, db: Database) {
  if (!await validLease(job, db)) return null;
  return requireConnection({ officeId: job.office_id, userId: job.user_id }, 'calendar', db).catch(() => null);
}
export async function refreshCalendarList(job: GoogleJob, db: Database = database): Promise<void> {
  const connection = await authority(job, db);
  if (!connection) return;
  let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await googleJson<CalendarListPage>(connection, { service: 'calendar', path: '/users/me/calendarList',
      query: { maxResults: 250, pageToken } }, db);
    if (!await authority(job, db)) return;
    for (const entry of page.items ?? []) {
      if (!entry.id) continue;
      seen.add(entry.id);
      if (entry.deleted) {
        await db.prepare("UPDATE google_calendar SET sync_state='removed',selected=0,updated_at=CURRENT_TIMESTAMP WHERE connection_id=? AND google_calendar_id=?")
          .run(connection.id,entry.id);
        continue;
      }
      await db.prepare(`INSERT INTO google_calendar(id,office_id,user_id,connection_id,google_calendar_id,summary,time_zone,access_role,is_primary)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,google_calendar_id) DO UPDATE SET
        summary=EXCLUDED.summary,time_zone=EXCLUDED.time_zone,access_role=EXCLUDED.access_role,is_primary=EXCLUDED.is_primary,
        sync_state=CASE WHEN google_calendar.sync_state='removed' THEN 'pending' ELSE google_calendar.sync_state END,updated_at=CURRENT_TIMESTAMP`)
        .run(randomUUID(),job.office_id,job.user_id,connection.id,entry.id,entry.summary??'',entry.timeZone??null,
          ['owner','writer','writerWithoutPrivateAccess','reader','freeBusyReader'].includes(entry.accessRole??'')?entry.accessRole:'reader',entry.primary?1:0);
    }
    pageToken=page.nextPageToken;
    await checkpointGoogleJob(job,{pageToken,seenIds:[...seen]},db);
  }while(pageToken);
  // Deletion from the list is not the same as an event deletion: keep the private mirror for review.
  const rows=await db.prepare('SELECT * FROM google_calendar WHERE connection_id=?').all<CalendarRow>(connection.id);
  for(const row of rows)if(!seen.has(row.google_calendar_id))
    await db.prepare("UPDATE google_calendar SET sync_state='removed',selected=0 WHERE id=? AND connection_id=?").run(row.id,connection.id);
}
export async function syncCalendar(job: GoogleJob, db: Database = database): Promise<void> {
  const connection = await authority(job, db);
  if (!connection || !job.subject_id) return;
  const calendar = await db.prepare('SELECT * FROM google_calendar WHERE id=? AND office_id=? AND user_id=? AND connection_id=? AND selected=1')
    .get<CalendarRow>(job.subject_id,job.office_id,job.user_id,connection.id);
  if (!calendar) return;
  let checkpoint: Checkpoint | null = null;
  try { checkpoint = job.checkpoint_json ? JSON.parse(job.checkpoint_json) as Checkpoint : null; } catch { /* restart from durable token */ }
  let baseToken=checkpoint?.baseToken??calendar.sync_token;
  let full=checkpoint?.full??!baseToken;
  let pageToken=checkpoint?.pageToken??null;
  const seen=new Set(checkpoint?.seenIds??[]);
  let reset=false;
  for (;;) {
    let page: EventPage;
    try {
      page=await googleJson<EventPage>(connection,{service:'calendar',path:eventPath(calendar),
        query:{maxResults:250,showDeleted:true,singleEvents:false,...(baseToken?{syncToken:baseToken}:{}),...(pageToken?{pageToken}:{})}},db);
    }catch(error){
      if(error instanceof GoogleApiError&&error.status===410&&!reset){
        reset=true;baseToken=null;pageToken=null;full=true;seen.clear();
        await db.prepare("UPDATE google_calendar SET sync_token=NULL,sync_state='full_required' WHERE id=? AND connection_id=?").run(calendar.id,connection.id);
        await checkpointGoogleJob(job,{baseToken:null,pageToken:null,seenIds:[],full:true},db);
        continue;
      }
      await db.prepare("UPDATE google_calendar SET sync_state='error',last_error_code=? WHERE id=? AND connection_id=?")
        .run(error instanceof GoogleApiError?error.reason:'sync_failed',calendar.id,connection.id);
      throw error;
    }
    if (!await authority(job,db) || !await db.prepare('SELECT 1 FROM google_calendar WHERE id=? AND connection_id=? AND selected=1')
      .get(calendar.id,connection.id)) return;
    for(const event of page.items??[]){
      if(!event.id)continue;
      seen.add(event.id);
      if(event.status==='cancelled'){
        const existing=await db.prepare('SELECT id FROM personal_event WHERE calendar_id=? AND google_event_id=?').get<{id:string}>(calendar.id,event.id);
        if(existing) await db.prepare("UPDATE personal_event SET status='cancelled',sync_state='synced',version=version+1 WHERE id=? AND sync_state='synced' AND status<>'cancelled'").run(existing.id);
        else if(event.originalStartTime?.date||event.originalStartTime?.dateTime){
          const start=event.originalStartTime.date??event.originalStartTime.dateTime!;
          const allDay=Boolean(event.originalStartTime.date);
          const synthetic:GoogleEvent={...event,start:allDay?{date:start}:{dateTime:start},
            end:allDay?{date:new Date(Date.parse(start+'T00:00:00Z')+86400_000).toISOString().slice(0,10)}
              :{dateTime:new Date(Date.parse(start)+60_000).toISOString()}};
          await saveRemoteEvent(calendar,synthetic,db);
        }
      }else await saveRemoteEvent(calendar,event,db);
    }
    pageToken=page.nextPageToken??null;
    await checkpointGoogleJob(job,{baseToken,pageToken,seenIds:[...seen],full},db);
    if(!pageToken){
      if(!page.nextSyncToken)throw new Error('Google não devolveu cursor da Agenda.');
      // Full rebuild identifies resources absent from the snapshot without destroying reviewed shares.
      if(full)await db.prepare(`UPDATE personal_event SET sync_state='remote_deleted',sync_error='O evento não está mais no Google.',version=version+1
        WHERE calendar_id=? AND recurring_event_id IS NULL AND google_event_id<>ALL(?) AND sync_state='synced' AND status<>'cancelled'`).run(calendar.id,[...seen]);
      await db.prepare(`UPDATE google_calendar SET sync_token=?,sync_state='idle',last_synced_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND connection_id=?`).run(page.nextSyncToken,calendar.id,connection.id);
      break;
    }
  }
}
/** A job is durable before watch, and its token hash is persisted before the HTTP call. */
export async function renewCalendarChannel(job: GoogleJob, db: Database = database): Promise<void> {
  const url=calendarWebhookUrl();
  if(!url||!job.subject_id)return;
  const connection=await authority(job,db);
  if(!connection)return;
  const calendar=await db.prepare('SELECT * FROM google_calendar WHERE id=? AND office_id=? AND user_id=? AND connection_id=? AND selected=1')
    .get<CalendarRow>(job.subject_id,job.office_id,job.user_id,connection.id);
  if(!calendar)return;
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  const previous={id:calendar.channel_id,resourceId:calendar.channel_resource_id};
  const watch=await googleJson<{id:string;resourceId:string;expiration?:string}>(connection,{service:'calendar',method:'POST',
    path:`${eventPath(calendar)}/watch`,json:{id,type:'web_hook',address:url,token}},db);
  if(!await authority(job,db))return;
  const swapped=await db.prepare(`UPDATE google_calendar SET channel_id=?,channel_token_hash=?,channel_resource_id=?,channel_expires_at=?
    WHERE id=? AND connection_id=? AND channel_id IS NOT DISTINCT FROM ?`)
    .run(id,hash(token),watch.resourceId,
      watch.expiration?new Date(Number(watch.expiration)).toISOString():new Date(Date.now()+6*24*3600_000).toISOString(),
      calendar.id,connection.id,previous.id);
  if(!swapped.changes)return;
  if(previous.id&&previous.resourceId){
    // Stopping an old channel is best effort. Its token no longer authorizes push on this endpoint.
    await googleJson(connection,{service:'calendar',method:'POST',path:'/channels/stop',
      json:{id:previous.id,resourceId:previous.resourceId}},db).catch(()=>undefined);
  }
}
export async function scheduleCalendarWork(db: Database = database): Promise<number> {
  const rows=await db.prepare(`SELECT c.* FROM google_calendar c JOIN google_connection g ON g.id=c.connection_id AND g.status='active'
    JOIN office_member m ON m.office_id=c.office_id AND m.user_id=c.user_id
    LEFT JOIN google_rollout r ON r.office_id=c.office_id AND r.module='calendar'
    WHERE c.selected=1 AND COALESCE(r.enabled,1)=1`).all<CalendarRow>();
  let queued=0;
  for(const row of rows){
    if(!row.last_synced_at||Date.parse(row.last_synced_at)<Date.now()-15*60_000||row.sync_state!=='idle'){
      await enqueueGoogleJob({officeId:row.office_id,userId:row.user_id,connectionId:row.connection_id,
        kind:'calendar_sync',subjectId:row.id,dedupeKey:`calendar-sync:${row.id}`},db);queued++;
    }
    if(calendarWebhookUrl()&&(!row.channel_expires_at||Date.parse(row.channel_expires_at)<Date.now()+24*3600_000)){
      await enqueueGoogleJob({officeId:row.office_id,userId:row.user_id,connectionId:row.connection_id,
        kind:'calendar_watch',subjectId:row.id,dedupeKey:`calendar-watch:${row.id}`},db);queued++;
    }
  }
  const connections=await db.prepare(`SELECT g.id,g.office_id,g.user_id FROM google_connection g JOIN office_member m ON m.office_id=g.office_id AND m.user_id=g.user_id
    LEFT JOIN google_rollout r ON r.office_id=g.office_id AND r.module='calendar'
    WHERE g.status='active' AND COALESCE(r.enabled,1)=1`)
    .all<{id:string;office_id:string;user_id:string}>();
  for(const c of connections){await enqueueGoogleJob({officeId:c.office_id,userId:c.user_id,connectionId:c.id,
    kind:'calendar_list',dedupeKey:`calendar-list:${c.id}`},db);queued++;}
  return queued;
}
export async function acceptCalendarNotification(headers:Headers,db:Database=database):Promise<'queued'|'ignored'> {
  const id=headers.get('x-goog-channel-id'),token=headers.get('x-goog-channel-token'),resource=headers.get('x-goog-resource-id');
  const state=headers.get('x-goog-resource-state'),number=headers.get('x-goog-message-number');
  if(!id||!token||!resource||!number||!/^\d+$/.test(number)||!['sync','exists','not_exists'].includes(state??''))return 'ignored';
  const row=await db.prepare(`SELECT c.* FROM google_calendar c JOIN google_connection g ON g.id=c.connection_id AND g.status='active'
    JOIN office_member m ON m.office_id=c.office_id AND m.user_id=c.user_id
    LEFT JOIN google_rollout r ON r.office_id=c.office_id AND r.module='calendar'
    WHERE c.channel_id=? AND c.selected=1 AND COALESCE(r.enabled,1)=1`).get<CalendarRow>(id);
  if(!row?.channel_token_hash||!row.channel_resource_id||row.channel_resource_id!==resource)return 'ignored';
  const candidate=Buffer.from(hash(token),'hex'),stored=Buffer.from(row.channel_token_hash,'hex');
  if(candidate.length!==stored.length||!timingSafeEqual(candidate,stored))return 'ignored';
  await enqueueGoogleJob({officeId:row.office_id,userId:row.user_id,connectionId:row.connection_id,
    kind:'calendar_push',subjectId:row.id,dedupeKey:`calendar-sync:${row.id}`},db);
  return 'queued';
}
