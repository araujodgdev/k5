'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { OfficeRole } from '@/lib/offices';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import { selectStyle } from '@/lib/agenda-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { googleCall, GoogleConnectionNotice, type GoogleStatus, useGoogleAction } from './client';

type Calendar = CapabilityOutput<'k5_calendar_list_calendars'>['calendars'][number];
type Event = CapabilityOutput<'k5_calendar_list_events'>['events'][number];
type Shared = CapabilityOutput<'k5_calendar_list_shared'>['events'][number];
type Scope = 'occurrence' | 'following' | 'series';
type Draft = {
  calendarId:string; title:string; description:string; location:string; allDay:boolean;
  startsAt:string; endsAt:string; startDate:string; endDate:string; timeZone:string;
  recurrence:string; attendees:string; addMeet:boolean; scope:Scope;
};
type Edit = { event: Event | null; draft: Draft };
const errorText=(error:unknown)=>error instanceof Error?error.message:'Não foi possível concluir a ação.';
const zoneNow=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Sao_Paulo';
const nextDay=(day:string)=>Temporal.PlainDate.from(day).add({days:1}).toString();
function localInput(instant:string|null,zone:string) {
  if(!instant)return '';
  try{return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({smallestUnit:'minute'});}
  catch{return '';}
}
function zoned(local:string,zone:string) {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(zone,{disambiguation:'reject'}).toString({timeZoneName:'never'});
}
function bounds(day:string,zone:string) {
  const from=Temporal.PlainDate.from(day).toZonedDateTime({timeZone:zone,plainTime:Temporal.PlainTime.from('00:00')});
  return {from:from.toString({timeZoneName:'never'}),to:from.add({days:1}).toString({timeZoneName:'never'})};
}
function blank(day:string,zone:string,calendarId:string):Draft {
  return {calendarId,title:'',description:'',location:'',allDay:false,startsAt:`${day}T09:00`,endsAt:`${day}T10:00`,
    startDate:day,endDate:nextDay(day),timeZone:zone,recurrence:'',attendees:'',addMeet:false,scope:'series'};
}
function fromEvent(event:Event):Draft {
  const zone=event.timeZone||zoneNow();
  return {calendarId:event.calendarId,title:event.title,description:event.description,location:event.location,allDay:event.allDay,
    startsAt:localInput(event.startsAt,zone),endsAt:localInput(event.endsAt,zone),
    startDate:event.startDate||'',endDate:event.endDate||'',timeZone:zone,recurrence:event.recurrence.join('\n'),
    attendees:event.attendees.filter(a=>!a.self&&!a.organizer).map(a=>a.email).join(', '),addMeet:false,
    scope:event.recurring&&event.occurrenceStart?'occurrence':'series'};
}
const parseLines=(value:string)=>value.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean);
const parseEmails=(value:string)=>value.split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean).map(email=>({email,optional:false}));
const detail=(event:Event)=>event.allDay
  ? `${event.startDate} até ${event.endDate} (fim exclusivo)`
  : `${new Date(event.startsAt!).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})} até ${new Date(event.endsAt!).toLocaleString('pt-BR',{timeStyle:'short'})}`;
const syncLabels:Record<Event['syncState'],string>={
  synced:'Sincronizado',pending_push:'Enviando ao Google',conflict:'Conflito para revisar',
  remote_deleted:'Removido no Google',permission_lost:'Permissão removida',failed:'Falha de sincronização',
};

export function CalendarPanel({role,day,initialEventId}:{role:OfficeRole;day:string;initialEventId?:string}) {
  const canWrite=role!=='reviewer';
  const {run,approvalDialog}=useGoogleAction();
  const [status,setStatus]=useState<GoogleStatus|null>(null);
  const [calendars,setCalendars]=useState<Calendar[]>([]);
  const [selection,setSelection]=useState<string[]>([]);
  const [events,setEvents]=useState<Event[]>([]);
  const [shared,setShared]=useState<Shared[]>([]);
  const [section,setSection]=useState<'mine'|'shared'>('mine');
  const [edit,setEdit]=useState<Edit|null>(null);
  const [sharing,setSharing]=useState<Event|null>(null);
  const [shareFields,setShareFields]=useState({title:'',notes:'',location:''});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0);
  const zone=zoneNow();
  const enabled=Boolean(status?.configured&&status.modules.some(m=>m.module==='calendar'&&m.rolledOut&&m.enabledByOffice&&m.granted));
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    let active=true;
    googleCall<GoogleStatus>('status').then(value=>{if(active)setStatus(value);})
      .catch(error=>{if(active)setFailure(errorText(error));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    googleCall<CapabilityOutput<'k5_calendar_list_calendars'>>('calendars').then(value=>{
      if(active){setCalendars(value.calendars);setSelection(value.calendars.filter(c=>c.selected).map(c=>c.id));}
    }).catch(error=>{if(active)setFailure(errorText(error));});
    return()=>{active=false;};
  },[enabled,revision]);
  useEffect(()=>{
    if(!day)return;
    let active=true;
    async function load(){
      setLoading(true);setFailure('');
      try{
        const window=bounds(day,zone);
        const [privateRows,sharedRows]=await Promise.all([
          enabled?googleCall<CapabilityOutput<'k5_calendar_list_events'>>('events',{...window,limit:500})
            :Promise.resolve({events:[] as Event[]}),
          googleCall<CapabilityOutput<'k5_calendar_list_shared'>>('shared-events',{...window,limit:500}),
        ]);
        if(active){setEvents(privateRows.events);setShared(sharedRows.events);}
      }catch(error){if(active)setFailure(errorText(error));}
      finally{if(active)setLoading(false);}
    }
    void load();
    return()=>{active=false;};
  },[enabled,day,zone,revision]);
  useEffect(()=>{
    if(!enabled||!initialEventId)return;
    let active=true;
    googleCall<CapabilityOutput<'k5_calendar_get_event'>>('event',{eventId:initialEventId})
      .then(value=>{if(active)setEdit({event:value.event,draft:fromEvent(value.event)});})
      .catch(error=>{if(active)setFailure(errorText(error));});
    return()=>{active=false;};
  },[enabled,initialEventId]);
  const perform=useCallback(async<T,>(operation:Parameters<typeof run>[0],input:Record<string,unknown>)=>{
    setBusy(true);setFailure('');setNotice('');
    try{
      const value=await run<T>(operation,input);
      refresh();
      return value;
    }catch(error){
      if(!(error instanceof Error&&'code' in error&&error.code==='CANCELLED'))setFailure(errorText(error));
      return null;
    }finally{setBusy(false);}
  },[run,refresh]);
  async function select() {
    setBusy(true);setFailure('');
    try{
      const value=await googleCall<CapabilityOutput<'k5_calendar_select_calendars'>>('calendars-select',{calendarIds:selection});
      setCalendars(value.calendars);setNotice('Calendários selecionados. A sincronização foi solicitada.');refresh();
    }catch(error){setFailure(errorText(error));}
    finally{setBusy(false);}
  }
  async function sync() {
    setBusy(true);setFailure('');
    try{await googleCall('calendar-sync');setNotice('Sincronização solicitada. Os eventos aparecerão após a atualização.');refresh();}
    catch(error){setFailure(errorText(error));}
    finally{setBusy(false);}
  }
  function startNew() {
    const first=calendars.find(c=>c.selected&&!c.readOnly);
    if(first)setEdit({event:null,draft:blank(day,zone,first.id)});
  }
  function changeDraft<K extends keyof Draft>(key:K,value:Draft[K]) {
    setEdit(current=>current?{...current,draft:{...current.draft,[key]:value}}:null);
  }
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!edit)return;
    if(!canWrite||edit.event?.readOnly){setFailure('Este evento permite somente leitura.');return;}
    const {draft}=edit;
    let startsAt:string|null=null,endsAt:string|null=null;
    try{
      if(!draft.allDay){startsAt=zoned(draft.startsAt,draft.timeZone);endsAt=zoned(draft.endsAt,draft.timeZone);}
    }catch{setFailure('Horário inexistente ou ambíguo neste fuso. Confira início e fim.');return;}
    const fields={title:draft.title,description:draft.description,location:draft.location,allDay:draft.allDay,
      startsAt,endsAt,startDate:draft.allDay?draft.startDate:null,endDate:draft.allDay?draft.endDate:null,
      timeZone:draft.timeZone,recurrence:parseLines(draft.recurrence),attendees:parseEmails(draft.attendees)};
    if(!edit.event){
      const saved=await perform<CapabilityOutput<'k5_calendar_create_event'>>('event-create',
        {...fields,calendarId:draft.calendarId,addMeet:draft.addMeet});
      if(saved){setEdit(null);setNotice(saved.operation.status==='succeeded'?'Evento criado no Google.':'O Lume está verificando o resultado no Google.');}
      return;
    }
    const original=edit.event;
    const changes:Record<string,unknown>={};
    for(const key of ['title','description','location','allDay','startsAt','endsAt','startDate','endDate','timeZone','recurrence','attendees'] as const){
      const before=key==='attendees'?original.attendees.filter(a=>!a.self&&!a.organizer).map(a=>({email:a.email,optional:a.optional}))
        :original[key];
      const sameInstant=(key==='startsAt'||key==='endsAt')&&typeof before==='string'&&typeof fields[key]==='string'
        &&Date.parse(before)===Date.parse(fields[key] as string);
      const sameZone=key==='timeZone'&&!original.timeZone&&fields.timeZone===zone;
      if(!sameInstant&&!sameZone&&JSON.stringify(fields[key])!==JSON.stringify(before))changes[key]=fields[key];
    }
    if(!Object.keys(changes).length){setEdit(null);return;}
    const saved=await perform<CapabilityOutput<'k5_calendar_update_event'>>('event-update',
      {eventId:original.id,version:original.version,scope:draft.scope,
        ...(draft.scope!=='series'?{occurrenceStart:original.occurrenceStart||original.startsAt||original.startDate}:{}),changes});
    if(saved){setEdit(null);setNotice(saved.operation.status==='succeeded'?'Evento atualizado no Google.':'O Lume está verificando o resultado no Google.');}
  }
  async function cancel() {
    if(!edit?.event)return;
    const {event,draft}=edit;
    const saved=await perform<CapabilityOutput<'k5_calendar_cancel_event'>>('event-cancel',
      {eventId:event.id,version:event.version,scope:draft.scope,
        ...(draft.scope!=='series'?{occurrenceStart:event.occurrenceStart||event.startsAt||event.startDate}: {})});
    if(saved){setEdit(null);setNotice(saved.operation.status==='succeeded'?'Evento cancelado no Google.':'O Lume está verificando o cancelamento no Google.');}
  }
  async function respond(event:Event,response:'accepted'|'declined'|'tentative') {
    const saved=await perform<CapabilityOutput<'k5_calendar_respond'>>('event-respond',
      {eventId:event.id,occurrenceStart:event.occurrenceStart??undefined,response});
    if(saved)setNotice(saved.operation.status==='succeeded'?'Resposta registrada no Google.':'O Lume está verificando a resposta no Google.');
  }
  function openShare(event:Event) {
    setSharing(event);setShareFields({title:event.title,notes:'',location:event.location});
  }
  async function saveShare(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!sharing)return;
    const saved=await perform<CapabilityOutput<'k5_calendar_share_event'>>('event-share',
      {eventId:sharing.id,occurrenceStart:sharing.occurrenceStart??undefined,...shareFields});
    if(saved){setSharing(null);setNotice('Cópia revisada visível ao escritório.');}
  }
  async function unshare(shareId:string) {
    const saved=await perform<CapabilityOutput<'k5_calendar_unshare_event'>>('event-unshare',{shareId});
    if(saved)setNotice('Compartilhamento removido.');
  }
  async function discard(event:Event) {
    const saved=await perform<CapabilityOutput<'k5_calendar_discard_pending'>>('event-discard',{eventId:event.id});
    if(saved)setNotice('Pendência local descartada. Atualize para buscar o estado do Google.');
  }
  if(!status&&loading)return <p role="status" className="py-10 text-sm text-muted-foreground">Carregando Agenda Google…</p>;
  if(!status)return <div className="py-8"><p role="alert" className="text-sm text-destructive">{failure||'Não foi possível carregar a Agenda Google.'}</p>
    <Button variant="outline" className="mt-3" onClick={()=>window.location.reload()}>Tentar novamente</Button></div>;
  return <div className="min-w-0 space-y-6 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Agendas pessoais" className="flex gap-5 border-b">
        {([['mine','Minha agenda'],['shared','Compartilhados com o escritório']] as const).map(([value,label])=>
          <button key={value} type="button" onClick={()=>setSection(value)} aria-current={section===value?'page':undefined}
            className={`min-h-11 border-b-2 px-1 text-sm focus-visible:ring-2 focus-visible:ring-ring ${section===value?'border-foreground font-medium':'border-transparent text-muted-foreground'}`}>{label}</button>)}
      </nav>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={refresh}>Atualizar</Button>
        {section==='mine'&&enabled&&<Button variant="outline" disabled={busy} onClick={()=>void sync()}>Sincronizar</Button>}
        {section==='mine'&&enabled&&canWrite&&calendars.some(c=>c.selected&&!c.readOnly)&&<Button disabled={busy} onClick={startNew}>Novo evento</Button>}</div>
    </div>
    {failure&&<p role="alert" className="text-sm text-destructive">{failure}</p>}
    {notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {section==='mine'&&enabled&&<section aria-label="Calendários Google" className="border-y py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Calendários</h3>
        <Button variant="ghost" disabled={busy} onClick={()=>void select()}>Salvar seleção</Button></div>
      {calendars.length===0?<p className="text-sm text-muted-foreground">Nenhum calendário carregado. Sincronize para buscar os calendários da sua conta.</p>
        :<div className="divide-y">{calendars.map(calendar=><label key={calendar.id} className="flex min-h-11 items-center gap-3 py-2 text-sm">
          <input type="checkbox" checked={selection.includes(calendar.id)} onChange={e=>setSelection(current=>e.target.checked?[...current,calendar.id]:current.filter(id=>id!==calendar.id))}
            className="size-5 accent-primary"/><span className="min-w-0 flex-1 truncate">{calendar.summary}</span>
          <span className="text-xs text-muted-foreground">{calendar.readOnly?'Somente leitura':calendar.syncState==='error'?'Erro de sincronização':calendar.selected?'Selecionado':'Não selecionado'}</span>
        </label>)}</div>}
    </section>}
    {section==='mine'&&!enabled?<GoogleConnectionNotice status={status} module="calendar"/>
      :loading?<p role="status" className="py-8 text-sm text-muted-foreground">Carregando eventos…</p>
      :section==='shared'
        ?shared.length===0?<p className="py-8 text-sm text-muted-foreground">Nenhum evento foi compartilhado com o escritório neste dia.</p>
          :<div className="divide-y border-y">{shared.map(item=><article key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-[13px] text-muted-foreground">{item.ownerName}{item.location?` · ${item.location}`:''}</p>
              {item.notes&&<p className="mt-2 whitespace-pre-wrap text-sm">{item.notes}</p>}</div>
            {item.mine&&canWrite&&<Button variant="ghost" disabled={busy} onClick={()=>void unshare(item.id)}>Remover compartilhamento</Button>}
          </article>)}</div>
        :events.length===0?<p className="py-8 text-sm text-muted-foreground">Nenhum evento pessoal para este dia.</p>
          :<div className="divide-y border-y">{events.map(event=><article key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0"><button type="button" onClick={()=>setEdit({event,draft:fromEvent(event)})}
              className="text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{event.title||'Sem título'}</button>
              <p className="mt-1 text-[13px] text-muted-foreground">{detail(event)} · {event.calendarName}</p>
              {event.location&&<p className="mt-1 text-[13px] text-muted-foreground">{event.location}</p>}
              {event.syncState!=='synced'&&<p className="mt-1 text-[13px] text-destructive">{syncLabels[event.syncState]}{event.syncError?` · ${event.syncError}`:''}</p>}
              {event.meetingUrl&&<a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] underline">Abrir reunião</a>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite&&event.selfResponse&&<select aria-label={`Responder a ${event.title}`} value={event.selfResponse}
                onChange={e=>void respond(event,e.target.value as 'accepted'|'declined'|'tentative')} disabled={busy} className={selectStyle}>
                <option value="needsAction">Responder</option><option value="accepted">Aceitar</option><option value="tentative">Talvez</option><option value="declined">Recusar</option>
              </select>}
              {canWrite&&<Button variant="ghost" disabled={busy} onClick={()=>openShare(event)}>{event.shareId?'Revisar cópia':'Compartilhar'}</Button>}
              {canWrite&&event.shareId&&<Button variant="ghost" disabled={busy} onClick={()=>void unshare(event.shareId!)}>Deixar de compartilhar</Button>}
              {canWrite&&['remote_deleted','permission_lost','conflict','failed'].includes(event.syncState)&&
                <Button variant="ghost" disabled={busy} onClick={()=>void discard(event)}>Descartar pendência</Button>}
            </div>
          </article>)}</div>}
    {edit&&<Dialog open onOpenChange={open=>{if(!open&&!busy)setEdit(null);}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{edit.event?'Evento pessoal':'Novo evento pessoal'}</DialogTitle>
        <DialogDescription>{edit.event?.readOnly?'Este calendário permite somente leitura.':'As alterações serão feitas na sua conta Google.'}</DialogDescription></DialogHeader>
      <form onSubmit={event=>void save(event)} className="grid gap-4">
        {!edit.event&&<label className="grid gap-1.5 text-sm"><span>Calendário</span><select value={edit.draft.calendarId} onChange={e=>changeDraft('calendarId',e.target.value)} className={selectStyle}>
          {calendars.filter(c=>c.selected&&!c.readOnly).map(c=><option key={c.id} value={c.id}>{c.summary}</option>)}</select></label>}
        <div className="grid gap-1.5"><Label htmlFor="google-event-title">Título</Label><Input id="google-event-title" required maxLength={500} value={edit.draft.title}
          onChange={e=>changeDraft('title',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        <div className="grid gap-1.5"><Label htmlFor="google-event-description">Descrição</Label><Textarea id="google-event-description" value={edit.draft.description}
          onChange={e=>changeDraft('description',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        <div className="grid gap-1.5"><Label htmlFor="google-event-location">Local</Label><Input id="google-event-location" value={edit.draft.location}
          onChange={e=>changeDraft('location',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={edit.draft.allDay}
          onChange={e=>changeDraft('allDay',e.target.checked)} disabled={Boolean(edit.event?.readOnly)}/>Dia inteiro</label>
        <div className="grid gap-3 sm:grid-cols-2">{edit.draft.allDay
          ?<><div className="grid gap-1.5"><Label htmlFor="google-start-date">Dia inicial</Label><Input id="google-start-date" type="date" required value={edit.draft.startDate}
            onChange={e=>changeDraft('startDate',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
            <div className="grid gap-1.5"><Label htmlFor="google-end-date">Dia final exclusivo</Label><Input id="google-end-date" type="date" required value={edit.draft.endDate}
              onChange={e=>changeDraft('endDate',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div></>
          :<><div className="grid gap-1.5"><Label htmlFor="google-start-time">Início</Label><Input id="google-start-time" type="datetime-local" required value={edit.draft.startsAt}
            onChange={e=>changeDraft('startsAt',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
            <div className="grid gap-1.5"><Label htmlFor="google-end-time">Fim</Label><Input id="google-end-time" type="datetime-local" required value={edit.draft.endsAt}
              onChange={e=>changeDraft('endsAt',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div></>}</div>
        <div className="grid gap-1.5"><Label htmlFor="google-time-zone">Fuso horário IANA</Label><Input id="google-time-zone" required value={edit.draft.timeZone}
          onChange={e=>changeDraft('timeZone',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        <div className="grid gap-1.5"><Label htmlFor="google-recurrence">Repetição (uma regra por linha)</Label><Textarea id="google-recurrence" placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO"
          value={edit.draft.recurrence} onChange={e=>changeDraft('recurrence',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        <div className="grid gap-1.5"><Label htmlFor="google-attendees">Convidados (e-mails separados por vírgula)</Label><Input id="google-attendees" value={edit.draft.attendees}
          onChange={e=>changeDraft('attendees',e.target.value)} readOnly={Boolean(edit.event?.readOnly)}/></div>
        {!edit.event&&<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={edit.draft.addMeet}
          onChange={e=>changeDraft('addMeet',e.target.checked)}/>Criar link do Google Meet</label>}
        {edit.event?.recurring&&<label className="grid gap-1.5 text-sm"><span>Aplicar a</span><select className={selectStyle} value={edit.draft.scope}
          onChange={e=>changeDraft('scope',e.target.value as Scope)} disabled={edit.event.readOnly}>
          <option value="occurrence">Só esta ocorrência</option><option value="following">Esta e as próximas</option><option value="series">Série inteira</option>
        </select></label>}
        {edit.event?.htmlLink&&<Link href={edit.event.htmlLink} target="_blank" rel="noopener noreferrer" className="text-sm underline">Abrir no Google Calendar</Link>}
        <DialogFooter><Button type="button" variant="outline" onClick={()=>setEdit(null)}>Fechar</Button>
          {edit.event&&canWrite&&!edit.event.readOnly&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>void cancel()}>Cancelar evento</Button>}
          {canWrite&&!edit.event?.readOnly&&<Button type="submit" disabled={busy}>{busy?'Salvando…':edit.event?'Salvar alterações':'Criar evento'}</Button>}
        </DialogFooter>
      </form>
    </DialogContent></Dialog>}
    {sharing&&<Dialog open onOpenChange={open=>{if(!open&&!busy)setSharing(null);}}><DialogContent>
      <DialogHeader><DialogTitle>Compartilhar com o escritório</DialogTitle><DialogDescription>Revise só o que os colegas poderão ver. O evento Google continua privado.</DialogDescription></DialogHeader>
      <form onSubmit={event=>void saveShare(event)} className="grid gap-4">
        <p className="text-sm text-muted-foreground">Horário visível ao escritório: {detail(sharing)}</p>
        <div className="grid gap-1.5"><Label htmlFor="shared-title">Título visível</Label><Input id="shared-title" required maxLength={180} value={shareFields.title}
          onChange={e=>setShareFields(current=>({...current,title:e.target.value}))}/></div>
        <div className="grid gap-1.5"><Label htmlFor="shared-notes">Observações visíveis</Label><Textarea id="shared-notes" value={shareFields.notes}
          onChange={e=>setShareFields(current=>({...current,notes:e.target.value}))}/></div>
        <div className="grid gap-1.5"><Label htmlFor="shared-location">Local visível</Label><Input id="shared-location" value={shareFields.location}
          onChange={e=>setShareFields(current=>({...current,location:e.target.value}))}/></div>
        <DialogFooter><Button type="button" variant="outline" onClick={()=>setSharing(null)}>Cancelar</Button>
          <Button type="submit" disabled={busy}>Compartilhar cópia</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>}
    {approvalDialog}
  </div>;
}
