import './test-setup';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { setGoogleTransport } from '../src/lib/google/transport';
import { cancelEvent, createEvent, getEvent, listCalendars, listEvents, listShared, selectCalendars, shareEvent, updateEvent } from '../src/lib/google/calendar/service';
import { acceptCalendarNotification, syncCalendar } from '../src/lib/google/calendar/sync';
import type { GoogleJob } from '../src/lib/google/jobs';

afterEach(() => setGoogleTransport(undefined));
async function fixture() {
  const owner=await googleFixture({modules:['calendar'],grantedModules:['calendar']});
  const calendarId=randomUUID();
  await testDb.prepare(`INSERT INTO google_calendar(id,office_id,user_id,connection_id,google_calendar_id,summary,access_role,selected)
    VALUES(?,?,?,?,?,?,?,1)`).run(calendarId,owner.officeId,owner.userId,owner.connectionId,'primary','Pessoal','owner');
  return {...owner,calendarId};
}
async function event(owner:Awaited<ReturnType<typeof fixture>>,value:Partial<{googleId:string;title:string;etag:string;recurrence:string[];start:string;end:string}>={}) {
  const id=randomUUID();
  await testDb.prepare(`INSERT INTO personal_event(id,office_id,user_id,calendar_id,google_event_id,etag,status,summary,all_day,start_at,end_at,time_zone,recurrence)
    VALUES(?,?,?,?,?,?,'confirmed',?,0,?,?,?,?)`).run(id,owner.officeId,owner.userId,owner.calendarId,value.googleId??id,
      value.etag??'"1"',value.title??'Original',value.start??'2026-09-23T13:00:00Z',value.end??'2026-09-23T14:00:00Z',
      'America/Sao_Paulo',value.recurrence??[]);
  return id;
}
function remote(id:string,summary='Original',etag='"1"') {
  return {id,etag,status:'confirmed',summary,start:{dateTime:'2026-09-23T10:00:00-03:00',timeZone:'America/Sao_Paulo'},
    end:{dateTime:'2026-09-23T11:00:00-03:00',timeZone:'America/Sao_Paulo'},
    attendees:[{email:'guest@example.com',responseStatus:'accepted'}]};
}
test('private calendars and events cannot cross owner, even when the other owner is administrator',async()=>{
  const first=await fixture();
  const second=await googleFixture({officeId:first.officeId,role:'administrator',modules:['calendar'],grantedModules:['calendar']});
  const third=await googleFixture({modules:['calendar'],grantedModules:['calendar']});
  const id=await event(first);
  assert.equal((await listCalendars(second.context,{})).calendars.length,0);
  assert.equal((await listCalendars(third.context,{})).calendars.length,0);
  await assert.rejects(getEvent(second.context,{eventId:id}),{code:'NOT_FOUND'});
  await assert.rejects(getEvent(third.context,{eventId:id}),{code:'NOT_FOUND'});
  await assert.rejects(selectCalendars(second.context,{calendarIds:[first.calendarId]}),{code:'NOT_FOUND'});
});
test('shared event projects only owner reviewed fields and is visible to office',async()=>{
  const first=await fixture();
  const second=await googleFixture({officeId:first.officeId,role:'administrator',modules:['calendar'],grantedModules:['calendar']});
  const id=await event(first,{title:'Segredo pessoal'});
  const share=await shareEvent(first.context,{eventId:id,title:'Compromisso externo',notes:'Disponibilidade',location:'Centro'});
  assert.equal(share.share.title,'Compromisso externo');
  const others=await listShared(second.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20});
  assert.equal(others.events.length,1);
  assert.equal(others.events[0].notes,'Disponibilidade');
  assert.ok(!JSON.stringify(others).includes('Segredo pessoal'));
  const privateResult=await getEvent(second.context,{eventId:id}).catch(error=>error.code);
  assert.equal(privateResult,'NOT_FOUND');
});

test('re-sharing refreshes the reviewed time and hides cancelled or remotely deleted events',async()=>{
  const owner=await fixture();
  const colleague=await googleFixture({officeId:owner.officeId,role:'administrator',modules:['calendar'],grantedModules:['calendar']});
  const id=await event(owner);
  const first=await shareEvent(owner.context,{eventId:id,title:'Disponível',notes:'',location:''});
  await testDb.prepare('UPDATE personal_event SET all_day=1,start_at=NULL,end_at=NULL,start_date=?,end_date=? WHERE id=?')
    .run('2026-09-25','2026-09-26',id);
  const second=await shareEvent(owner.context,{eventId:id,title:'Fora do escritório',notes:'Dia inteiro',location:'Fórum'});
  assert.equal(second.share.id,first.share.id);
  assert.equal(second.share.version,first.share.version+1);
  assert.deepEqual({allDay:second.share.allDay,startsAt:second.share.startsAt,endsAt:second.share.endsAt,
    startDate:second.share.startDate,endDate:second.share.endDate},
    {allDay:true,startsAt:null,endsAt:null,startDate:'2026-09-25',endDate:'2026-09-26'});
  const range={from:'2026-09-25T00:00:00Z',to:'2026-09-26T00:00:00Z',limit:20};
  assert.equal((await listShared(colleague.context,range)).events[0].title,'Fora do escritório');
  assert.equal((await listShared(colleague.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20})).events.length,0);
  await testDb.prepare("UPDATE personal_event SET status='cancelled' WHERE id=?").run(id);
  assert.equal((await listShared(colleague.context,range)).events.length,0);
  await testDb.prepare("UPDATE personal_event SET status='confirmed',sync_state='remote_deleted' WHERE id=?").run(id);
  assert.equal((await listShared(colleague.context,range)).events.length,0);
});
test('all-day recurrence expands for the requested window and reader calendars refuse writes',async()=>{
  const owner=await fixture();
  await testDb.prepare("UPDATE google_calendar SET access_role='reader' WHERE id=?").run(owner.calendarId);
  const fake=installFakeGoogle();
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events$/,request=>{
    assert.equal(request.query.get('singleEvents'),'true');
    return respond(200,{items:[{id:'instance-all-day',recurringEventId:'series-all-day',
      originalStartTime:{date:'2026-09-24'},status:'confirmed',summary:'Feriado',
      start:{date:'2026-09-24'},end:{date:'2026-09-25'},recurrence:[]}]});
  });
  const listed=await listEvents(owner.context,{from:'2026-09-24T00:00:00Z',to:'2026-09-26T00:00:00Z',limit:20});
  assert.equal(listed.events.length,1);
  assert.equal(listed.events[0].allDay,true);
  assert.equal(listed.events[0].endDate,'2026-09-25');
  assert.equal(listed.events[0].readOnly,true);
  await assert.rejects(updateEvent(owner.context,{eventId:listed.events[0].id,version:listed.events[0].version,
    scope:'occurrence',occurrenceStart:'2026-09-24',changes:{title:'Alterado'}}),{code:'FORBIDDEN'});
  assert.equal(fake.calls.filter(call=>call.method==='PATCH').length,0);
});
test('writer without private access can edit public events but cannot read or mutate private ones',async()=>{
  const owner=await fixture();
  await testDb.prepare("UPDATE google_calendar SET access_role='writerWithoutPrivateAccess' WHERE id=?").run(owner.calendarId);
  await setRule(owner.officeId,'calendar.update',{mode:'automatic'});
  const publicId=await event(owner,{googleId:'public-event'});
  const privateId=await event(owner,{googleId:'private-event'});
  await testDb.prepare("UPDATE personal_event SET visibility='private' WHERE id=?").run(privateId);
  const fake=installFakeGoogle();
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events$/,()=>respond(200,{items:[
    {...remote('public-event'),visibility:'public'},
    {...remote('private-event','Segredo'),visibility:'private'},
  ]}));
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/public-event$/,()=>respond(200,{...remote('public-event'),visibility:'public'}));
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/private-event$/,()=>respond(200,{...remote('private-event'),visibility:'private'}));
  fake.on('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/public-event$/,()=>respond(200,{...remote('public-event'),visibility:'public',location:'Sala 2',etag:'"2"'}));
  assert.equal((await listCalendars(owner.context,{})).calendars[0].readOnly,false);
  const listed=await listEvents(owner.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20});
  assert.equal(listed.events.length,1);
  assert.equal(listed.events[0].id,publicId);
  assert.equal(listed.events[0].readOnly,false);
  assert.ok(!JSON.stringify(listed).includes('Segredo'));
  assert.deepEqual(await testDb.prepare('SELECT sync_state FROM personal_event WHERE id=?').get<{sync_state:string}>(privateId),{sync_state:'synced'});
  const listedAgain=await listEvents(owner.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20});
  assert.deepEqual(listedAgain.events.map(item=>item.id),[publicId]);
  assert.deepEqual(await testDb.prepare('SELECT sync_state FROM personal_event WHERE id=?').get<{sync_state:string}>(privateId),{sync_state:'synced'});
  await assert.rejects(getEvent(owner.context,{eventId:privateId}),{code:'NOT_FOUND'});
  const hiddenRow=await testDb.prepare('SELECT version FROM personal_event WHERE id=?').get<{version:number}>(privateId);
  await assert.rejects(updateEvent(owner.context,{eventId:privateId,version:hiddenRow!.version,scope:'series',changes:{title:'Novo'},idempotencyKey:'private-denied'}),{code:'FORBIDDEN'});
  const publicRow=await testDb.prepare('SELECT version FROM personal_event WHERE id=?').get<{version:number}>(publicId);
  const changed=await updateEvent(owner.context,{eventId:publicId,version:publicRow!.version,scope:'series',changes:{location:'Sala 2'},idempotencyKey:'public-write'});
  assert.equal(changed.event?.location,'Sala 2');
  assert.equal(fake.count('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/public-event$/),1);
  await testDb.prepare("UPDATE personal_event SET visibility='default' WHERE id=?").run(privateId);
  await assert.rejects(updateEvent(owner.context,{eventId:privateId,version:hiddenRow!.version,scope:'series',changes:{title:'Novo'},idempotencyKey:'remote-private-denied'}),{code:'FORBIDDEN'});
  assert.equal(fake.count('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/private-event$/),0);
});
test('412 refetch reapplies only edited field and preserves remote attendee RSVP',async()=>{
  const owner=await fixture();
  await setRule(owner.officeId,'calendar.update',{mode:'automatic'});
  const id=await event(owner,{googleId:'event-a'});
  const fake=installFakeGoogle();
  let reads=0;
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/event-a$/,()=>{
    reads++;return respond(200,remote('event-a',reads===1?'Original':'Mudou remotamente',reads===1?'"1"':'"2"'));
  });
  let patches=0;
  fake.on('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/event-a$/,request=>{
    patches++;
    const body=request.json() as Record<string,unknown>;
    assert.deepEqual(Object.keys(body),['location']);
    if(patches===1)return respond(412,{error:{errors:[{reason:'conditionNotMet'}]}});
    assert.equal(request.headers['if-match'],'"2"');
    return respond(200,{...remote('event-a','Mudou remotamente','"3"'),location:'Sala 2'});
  });
  const changed=await updateEvent(owner.context,{eventId:id,version:1,scope:'series',changes:{location:'Sala 2'},idempotencyKey:'etag-reapply-a'});
  assert.equal(changed.event?.title,'Mudou remotamente');
  assert.equal(changed.event?.attendees[0].responseStatus,'accepted');
  assert.equal(patches,2);
});
test('remote deletion creates a visible pending state and never recreates the event',async()=>{
  const owner=await fixture();
  await setRule(owner.officeId,'calendar.update',{mode:'automatic'});
  const id=await event(owner,{googleId:'removed-event'});
  const fake=installFakeGoogle();
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/removed-event$/,()=>respond(404,{error:{errors:[{reason:'notFound'}]}}));
  await assert.rejects(updateEvent(owner.context,{eventId:id,version:1,scope:'series',changes:{title:'Novo'},
    idempotencyKey:'deleted-event-a'}),{code:'CONFLICT'});
  assert.equal(fake.calls.filter(call=>call.method==='POST').length,0);
  const state=await testDb.prepare('SELECT sync_state FROM personal_event WHERE id=?').get<{sync_state:string}>(id);
  assert.equal(state?.sync_state,'remote_deleted');
});
test('cancelled synced event disappears from agenda while a conflict remains visible',async()=>{
  const owner=await fixture();
  await setRule(owner.officeId,'calendar.cancel',{mode:'automatic'});
  const cancelledId=await event(owner,{googleId:'cancelled-a'});
  const conflictId=await event(owner,{googleId:'conflict-a',title:'Revisar conflito'});
  await testDb.prepare("UPDATE personal_event SET sync_state='conflict',sync_error='Revisão necessária' WHERE id=?").run(conflictId);
  const fake=installFakeGoogle();
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/cancelled-a$/,()=>respond(200,{...remote('cancelled-a'),attendees:[]}));
  fake.on('DELETE',/\/calendar\/v3\/calendars\/primary\/events\/cancelled-a$/,()=>respond(204));
  let windowReads=0;
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events$/,()=>respond(200,{items:++windowReads===1?[{id:'cancelled-a',status:'cancelled'}]:[]}));
  const cancelled=await cancelEvent(owner.context,{eventId:cancelledId,version:1,scope:'series',idempotencyKey:'cancelled-a'});
  assert.equal(cancelled.operation.status,'succeeded');
  const listed=await listEvents(owner.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20});
  assert.deepEqual(listed.events.map(item=>item.id),[conflictId]);
  assert.equal(listed.events[0].syncState,'conflict');
  const stored=await testDb.prepare('SELECT status,sync_state FROM personal_event WHERE id=?').get<{status:string;sync_state:string}>(cancelledId);
  assert.deepEqual(stored,{status:'cancelled',sync_state:'synced'});
  const withoutTombstone=await listEvents(owner.context,{from:'2026-09-23T00:00:00Z',to:'2026-09-24T00:00:00Z',limit:20});
  assert.deepEqual(withoutTombstone.events.map(item=>item.id),[conflictId]);
  assert.deepEqual(await testDb.prepare('SELECT status,sync_state FROM personal_event WHERE id=?')
    .get<{status:string;sync_state:string}>(cancelledId),{status:'cancelled',sync_state:'synced'});
});
test('lost create response reconciles by stable event id without a second insert',async()=>{
  const owner=await fixture();
  await setRule(owner.officeId,'calendar.create',{mode:'automatic'});
  const fake=installFakeGoogle();
  let inserted:Record<string,unknown>|null=null;
  fake.failNetwork('POST',/\/calendar\/v3\/calendars\/primary\/events$/,request=>{
    inserted=request.json() as Record<string,unknown>;
    return respond(200,{});
  });
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/k5[0-9a-f]{32}$/,request=>{
    assert.equal(request.path.split('/').at(-1),inserted?.id);
    return respond(200,{...inserted,etag:'"1"',status:'confirmed'});
  });
  const saved=await createEvent(owner.context,{calendarId:owner.calendarId,title:'Audiência',description:'',location:'',
    allDay:false,startsAt:'2026-09-23T10:00:00-03:00',endsAt:'2026-09-23T11:00:00-03:00',
    startDate:null,endDate:null,timeZone:'America/Sao_Paulo',recurrence:[],attendees:[],addMeet:false,
    idempotencyKey:'create-lost-response-a'});
  assert.equal(saved.operation.status,'succeeded');
  assert.equal(saved.event?.title,'Audiência');
  assert.equal(fake.count('POST',/\/calendar\/v3\/calendars\/primary\/events$/),1);
});
test('approval reviews show complete creation details and readable update changes',async()=>{
  const owner=await fixture();
  const fake=installFakeGoogle();
  await assert.rejects(createEvent(owner.context,{calendarId:owner.calendarId,title:'Audiência',description:'Pauta confidencial',
    location:'Fórum central',allDay:false,startsAt:'2026-09-23T10:00:00-03:00',endsAt:'2026-09-23T11:00:00-03:00',
    startDate:null,endDate:null,timeZone:'America/Sao_Paulo',recurrence:[],attendees:[{email:'cliente@example.com',optional:true}],
    addMeet:false,idempotencyKey:'calendar-create-review'}),{code:'APPROVAL_REQUIRED'});
  const creation=await testDb.prepare(`SELECT normalized_input FROM capability_approval WHERE office_id=? AND user_id=?
    AND capability_name='k5_calendar_create_event' ORDER BY created_at DESC LIMIT 1`).get<{normalized_input:string}>(owner.officeId,owner.userId);
  const creationReview=(JSON.parse(creation!.normalized_input) as {__bound:{review:Array<{label:string;value:string}>}}).__bound.review;
  assert.equal(Object.fromEntries(creationReview.map(item=>[item.label,item.value]))['Descrição'],'Pauta confidencial');
  assert.equal(Object.fromEntries(creationReview.map(item=>[item.label,item.value]))['Local'],'Fórum central');
  assert.equal(Object.fromEntries(creationReview.map(item=>[item.label,item.value]))['Dia inteiro'],'Não');
  assert.equal(Object.fromEntries(creationReview.map(item=>[item.label,item.value]))['Google Meet'],'Não');
  assert.equal(fake.count('POST',/\/calendar\/v3\/calendars\/primary\/events$/),0);
  const id=await event(owner,{googleId:'review-event'});
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/review-event$/,()=>respond(200,remote('review-event')));
  await assert.rejects(updateEvent(owner.context,{eventId:id,version:1,scope:'series',
    changes:{description:'Nova pauta',location:'Sala 2',allDay:false,attendees:[]},idempotencyKey:'calendar-update-review'}),
    {code:'APPROVAL_REQUIRED'});
  const update=await testDb.prepare(`SELECT normalized_input FROM capability_approval WHERE office_id=? AND user_id=?
    AND capability_name='k5_calendar_update_event' ORDER BY created_at DESC LIMIT 1`).get<{normalized_input:string}>(owner.officeId,owner.userId);
  const updateReview=(JSON.parse(update!.normalized_input) as {__bound:{review:Array<{label:string;value:string}>}}).__bound.review;
  const fields=Object.fromEntries(updateReview.map(item=>[item.label,item.value]));
  assert.equal(fields['Descrição'],'Nova pauta');
  assert.equal(fields['Local'],'Sala 2');
  assert.equal(fields['Dia inteiro'],'Não');
  assert.equal(fields['Convidados'],'Nenhum');
  assert.equal(fake.count('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/review-event$/),0);
});
test('following split preserves COUNT and a future exception with a durable checkpoint',async()=>{
  const owner=await fixture();
  await setRule(owner.officeId,'calendar.update',{mode:'automatic'});
  const id=await event(owner,{googleId:'series-a',recurrence:['RRULE:FREQ=WEEKLY;COUNT=4']});
  const fake=installFakeGoogle();
  const first={...remote('instance-1'),recurringEventId:'series-a',originalStartTime:{dateTime:'2026-09-23T10:00:00-03:00'}};
  const target={...remote('instance-2'),recurringEventId:'series-a',originalStartTime:{dateTime:'2026-09-30T09:00:00-04:00'},
    start:{dateTime:'2026-09-30T10:00:00-03:00',timeZone:'America/Sao_Paulo'},end:{dateTime:'2026-09-30T11:00:00-03:00',timeZone:'America/Sao_Paulo'}};
  const exception={...remote('old-exception','Exceção'),recurringEventId:'series-a',
    originalStartTime:{dateTime:'2026-10-07T10:00:00-03:00'},start:{dateTime:'2026-10-07T12:00:00-03:00',timeZone:'America/Sao_Paulo'}};
  const earlier={...remote('earlier-exception'),recurringEventId:'series-a',originalStartTime:{dateTime:'2026-09-30T11:00:00+00:00'}};
  const later={...remote('later-exception','Exceção após corte'),recurringEventId:'series-a',
    originalStartTime:{dateTime:'2026-09-30T09:30:00-04:00'}};
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/series-a$/,()=>respond(200,{...remote('series-a'),recurrence:['RRULE:FREQ=WEEKLY;COUNT=4']}));
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/series-a\/instances$/,()=>respond(200,{items:[first,target]}));
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events$/,()=>respond(200,{items:[earlier,exception,later]}));
  fake.on('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/series-a$/,request=>{
    assert.deepEqual((request.json() as {recurrence:string[]}).recurrence,['RRULE:FREQ=WEEKLY;COUNT=1']);
    return respond(200,{...remote('series-a'),recurrence:['RRULE:FREQ=WEEKLY;COUNT=1']});
  });
  fake.on('POST',/\/calendar\/v3\/calendars\/primary\/events$/,request=>{
    const body=request.json() as {recurrence:string[];summary:string};
    assert.deepEqual(body.recurrence,['RRULE:FREQ=WEEKLY;COUNT=3']);
    assert.equal(body.summary,'Novo título');
    return respond(200,{...remote('new-series','Novo título'),recurrence:body.recurrence});
  });
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events\/new-series\/instances$/,request=>{
    const at=request.query.get('originalStart');
    assert.ok(at===later.originalStartTime.dateTime||at===exception.originalStartTime.dateTime);
    return respond(200,{items:[{...target,id:at===later.originalStartTime.dateTime?'later-instance':'new-instance',
      originalStartTime:{dateTime:at==='2026-09-30T09:30:00-04:00'?'2026-09-30T10:30:00-03:00':at!}}]});
  });
  fake.on('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/(?:new-instance|later-instance)$/,request=>{
    const at=request.path.split('/').at(-1);
    assert.equal((request.json() as {summary:string}).summary,at==='later-instance'?'Exceção após corte':'Exceção');
    return respond(200,{...(at==='later-instance'?later:exception),id:at});
  });
  const changed=await updateEvent(owner.context,{eventId:id,version:1,scope:'following',
    occurrenceStart:'2026-09-30T10:00:00-03:00',changes:{title:'Novo título'},idempotencyKey:'following-count-a'});
  assert.equal(changed.operation.status,'succeeded');
  assert.equal(changed.event?.title,'Novo título');
  const operation=await testDb.prepare("SELECT has_effect,checkpoint_json FROM google_operation WHERE id=?").get<{has_effect:number;checkpoint_json:string}>(changed.operation.id);
  assert.equal(operation?.has_effect,1);
  assert.ok(operation?.checkpoint_json);
  assert.equal(fake.count('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/later-instance$/),1);
  assert.equal(fake.count('PATCH',/\/calendar\/v3\/calendars\/primary\/events\/new-instance$/),1);
});
test('incremental sync keeps page cursor until last page and handles 410 with full rebuild',async()=>{
  const owner=await fixture();
  const fake=installFakeGoogle();
  const cancelledId=await event(owner,{googleId:'old-cancelled'});
  await testDb.prepare("UPDATE personal_event SET status='cancelled' WHERE id=?").run(cancelledId);
  await testDb.prepare("UPDATE google_calendar SET sync_token='old' WHERE id=?").run(owner.calendarId);
  const lease=randomUUID(),jobId=randomUUID();
  await testDb.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,subject_id,status,lease_token,lease_until)
    VALUES(?,?,?,?,? ,?,'running',?,?)`).run(jobId,owner.officeId,owner.userId,owner.connectionId,'calendar_sync',owner.calendarId,lease,new Date(Date.now()+120000).toISOString());
  let fullCalls=0;
  fake.on('GET',/\/calendar\/v3\/calendars\/primary\/events$/,request=>{
    if(request.query.get('syncToken')==='old')return respond(410,{error:{errors:[{reason:'fullSyncRequired'}]}});
    fullCalls++;
    if(!request.query.has('pageToken'))return respond(200,{items:[remote('one')],nextPageToken:'page-2'});
    assert.equal(request.query.get('pageToken'),'page-2');
    return respond(200,{items:[{id:'all-day',summary:'Dia inteiro',status:'confirmed',start:{date:'2026-09-24'},end:{date:'2026-09-25'}}],nextSyncToken:'fresh'});
  });
  const job:GoogleJob={id:jobId,office_id:owner.officeId,user_id:owner.userId,connection_id:owner.connectionId,kind:'calendar_sync',
    runtime:'edge',subject_id:owner.calendarId,dedupe_key:null,status:'running',attempts:1,lease_token:lease,checkpoint_json:null,run_after:new Date().toISOString()};
  await syncCalendar(job,testDb);
  const calendar=await testDb.prepare('SELECT sync_token,sync_state FROM google_calendar WHERE id=?').get<{sync_token:string;sync_state:string}>(owner.calendarId);
  assert.equal(calendar?.sync_token,'fresh');
  assert.equal(fullCalls,2);
  const rows=await testDb.prepare('SELECT google_event_id,start_date,end_date,status,sync_state FROM personal_event WHERE calendar_id=? ORDER BY google_event_id')
    .all<{google_event_id:string;start_date:string|null;end_date:string|null;status:string;sync_state:string}>(owner.calendarId);
  assert.equal(rows.length,3);
  assert.equal(rows[0].start_date,'2026-09-24');
  assert.equal(rows[0].end_date,'2026-09-25');
  assert.equal(rows.find(row=>row.google_event_id==='old-cancelled')?.sync_state,'synced');
  assert.equal(rows.find(row=>row.google_event_id==='old-cancelled')?.status,'cancelled');
});
test('push requires matching channel, resource and secret; duplicate notifications dedupe jobs',async()=>{
  const owner=await fixture();
  const token='secret-value';
  const hash=(await import('node:crypto')).createHash('sha256').update(token).digest('hex');
  await testDb.prepare('UPDATE google_calendar SET channel_id=?,channel_resource_id=?,channel_token_hash=? WHERE id=?')
    .run('channel-one','resource-one',hash,owner.calendarId);
  const headers=new Headers({'x-goog-channel-id':'channel-one','x-goog-resource-id':'resource-one',
    'x-goog-channel-token':token,'x-goog-resource-state':'exists','x-goog-message-number':'2'});
  assert.equal(await acceptCalendarNotification(new Headers({...Object.fromEntries(headers),'x-goog-channel-token':'wrong'}),testDb),'ignored');
  assert.equal(await acceptCalendarNotification(headers,testDb),'queued');
  assert.equal(await acceptCalendarNotification(headers,testDb),'queued');
  const jobs=await testDb.prepare("SELECT id FROM google_job WHERE subject_id=? AND kind='calendar_push'").all(owner.calendarId);
  assert.equal(jobs.length,1);
});
