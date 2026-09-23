'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calendarDays } from '@/lib/calendar-days';
import { useCallback, useEffect, useState } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { agendaCall, selectStyle, type Choice } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import dynamic from 'next/dynamic';
import type { OfficeRole } from '@/lib/offices';
import { legalAreaLabels, legalAreas, type AgendaActivity, type CrmClient } from '@/lib/capabilities/agenda';
type LegalArea = (typeof legalAreas)[number];
import { AgendaSuggestions } from './agenda-suggestions';
import { ClientPicker } from './client-picker';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));

type View = 'tasks' | 'calendar' | 'clients';
type Editor = { mode: 'activity'; activity?: AgendaActivity } | { mode: 'client'; client?: CrmClient };
const statusLabels = { pending: 'Pendente', completed: 'Concluída', cancelled: 'Cancelada' };
const stageLabels = { prospect: 'Potencial cliente', active: 'Cliente ativo', archived: 'Arquivado' };
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');

function Calendar({ day, markers, onChange }: { day: string; markers: Record<string, number>; onChange: (value: string) => void }) {
  const date = new Date(`${day}T12:00:00`);
  const year = date.getFullYear(); const month = date.getMonth();
  const start = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const today = localDate(new Date());
  return <section aria-label="Calendário mensal" className="w-full md:w-72 md:shrink-0">
    <div className="mb-4 flex items-center justify-between"><Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => onChange(localDate(new Date(year, month - 1, 1)))}><ChevronLeft /></Button><h2 className="text-sm font-medium capitalize" aria-live="polite">{date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2><Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => onChange(localDate(new Date(year, month + 1, 1)))}><ChevronRight /></Button></div>
    <div className="grid grid-cols-7 text-center text-xs text-muted-foreground" aria-hidden="true">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, i) => <span key={i} className="py-2">{label}</span>)}</div>
    <div className="grid grid-cols-7">{Array.from({ length: start }, (_, i) => <span key={`empty-${i}`} />)}{Array.from({ length: count }, (_, i) => {
      const value = localDate(new Date(year, month, i + 1));
      return <button key={value} type="button" data-calendar-day={value} aria-label={`${dateLabel(value)}${markers[value] ? `, ${markers[value]} atividade${markers[value] === 1 ? '' : 's'}` : ''}`} aria-pressed={value === day} aria-current={value === today ? 'date' : undefined} onClick={() => onChange(value)} onKeyDown={event => {
        const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (shift !== undefined) { event.preventDefault(); const next = new Date(year, month, i + 1 + shift); onChange(localDate(next)); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`button[data-calendar-day="${localDate(next)}"]`)?.focus()); }
      }} className={`relative min-h-11 rounded-md pb-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === day ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'} ${value === today ? 'font-semibold underline underline-offset-4' : ''}`}>{i + 1}{!!markers[value] && <span aria-hidden="true" className={`absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full ${value === day ? 'bg-primary-foreground' : 'bg-schedule'}`} />}</button>;
    })}</div>
    <Button variant="outline" className="mt-4 w-full" onClick={() => onChange(today)}>Hoje</Button>
    <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-schedule" aria-hidden="true" />Dias com atividades</p>
  </section>;
}

export function AgendaWorkspace({ role, initialCaseId, initialClientId, initialActivityId, initialProposalId = '', initialView = 'tasks', initialAction = '' }: {
  role: OfficeRole; initialCaseId: string; initialClientId: string; initialActivityId: string; initialProposalId?: string; initialView?: View; initialAction?: string;
}) {
  const router = useRouter();
  const canWrite = role !== 'reviewer';
  const [view, setView] = useState<View>(initialView);
  const [markers, setMarkers] = useState<Record<string, number>>({});
  const [markerFailure, setMarkerFailure] = useState('');
  const [markersLoading, setMarkersLoading] = useState(false);
  const [day, setDay] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [caseId, setCaseId] = useState(initialCaseId);
  const [clientId, setClientId] = useState(initialClientId);
  const [status, setStatus] = useState('');
  const [legalArea, setLegalArea] = useState('');
  const [query, setQuery] = useState('');
  const searchQuery = useDebouncedValue(query);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [cases, setCases] = useState<Choice[]>([]);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [members, setMembers] = useState<Choice[]>([]);
  const [activities, setActivities] = useState<AgendaActivity[]>([]);
  const [clientRows, setClientRows] = useState<CrmClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [optionsReady, setOptionsReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [optionsFailure, setOptionsFailure] = useState('');
  const [detailFailure, setDetailFailure] = useState('');
  const [editor, setEditor] = useState<Editor | null>(canWrite && initialAction === 'new' ? { mode: initialView === 'clients' ? 'client' : 'activity' } : null);
  const [detail, setDetail] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);

  useEffect(() => {
    // Resolve the user's civil date after hydration, rather than using the server's timezone.
    const frame = requestAnimationFrame(() => { setDay(localDate(new Date())); setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [vault, team, initialClients] = await Promise.all([
          agendaCall('k5_vault_list_cases', {}),
          agendaCall('k5_agenda_list_members', {}),
          agendaCall('k5_crm_list_clients', { limit: 100, offset: 0 }),
        ]);
        if (!cancelled) { setCases(vault.cases); setMembers(team.members); setClients(initialClients.clients); setOptionsReady(true); setOptionsFailure(''); }
      } catch (error) { if (!cancelled) { setOptionsFailure(error instanceof Error ? error.message : 'Não foi possível carregar os vínculos.'); setOptionsReady(false); } }
    }
    void load(); return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    if (!initialActivityId) return;
    const result = agendaCall('k5_agenda_get_activity', { activityId: initialActivityId }).then(({ activity }) => ({ mode: 'activity', activity }) as Editor);
    result.then(value => { if (!cancelled) { setDetail(value); setDetailFailure(''); } })
      .catch(error => { if (!cancelled) setDetailFailure(error.message); });
    return () => { cancelled = true; };
  }, [initialActivityId, initialClientId, revision]);

  const month = day.slice(0, 7);
  useEffect(() => {
    if (view !== 'calendar' || !month) return;
    let cancelled = false;
    async function load() {
      setMarkers({}); setMarkerFailure(''); setMarkersLoading(true);
      try {
        const [year, index] = month.split('-').map(Number);
        const from = new Date(year, index - 1, 1); const to = new Date(year, index, 1);
        const all: AgendaActivity[] = [];
        for (let offset = 0; ; offset += 100) {
          const result = await agendaCall('k5_agenda_list_activities', { query: searchQuery, dueFrom: localDate(from), dueTo: localDate(new Date(year, index, 0)), from: from.toISOString(), to: to.toISOString(), ...(caseId ? { caseId } : {}), ...(clientId ? { clientId } : {}), ...(status ? { status } : {}), limit: 100, offset });
          if (cancelled) return;
          all.push(...result.activities);
          if (all.length >= result.total || !result.activities.length) break;
        }
        if (!cancelled) setMarkers(calendarDays(month, all));
      } catch { if (!cancelled) setMarkerFailure('Não foi possível carregar os marcadores do mês.'); }
      finally { if (!cancelled) setMarkersLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [view, month, caseId, clientId, status, searchQuery, revision]);

  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setFailure('');
      try {
        if (view === 'clients') {
          const result = await agendaCall('k5_crm_list_clients', { query: searchQuery, ...(caseId ? { caseId } : {}), ...(status ? { stage: status } : {}), ...(legalArea ? { legalArea: legalArea as LegalArea } : {}), limit: 50, offset });
          if (!cancelled) { setClientRows(result.clients); setTotal(result.total); }
        } else {
          const from = new Date(`${day}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + 1);
          const result = await agendaCall('k5_agenda_list_activities', {
            query: searchQuery, ...(view === 'tasks' ? { kind: 'task' } : { dueFrom: day, dueTo: day, from: from.toISOString(), to: to.toISOString() }),
            ...(caseId ? { caseId } : {}), ...(clientId ? { clientId } : {}), ...(status ? { status } : {}), limit: 50, offset,
          });
          if (!cancelled) { setActivities(result.activities); setTotal(result.total); }
        }
      } catch (error) { if (!cancelled) setFailure(error instanceof Error ? error.message : 'Não foi possível carregar.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [view, day, caseId, clientId, searchQuery, status, legalArea, offset, revision]);

  function changeView(value: View) { setView(value); setStatus(''); setOffset(0); setQuery(''); setLoading(true); }
  function inspect(value: Editor) { if (value.mode === 'client' && value.client) router.push(`/app/agenda/clients/${encodeURIComponent(value.client.id)}`); else if (canWrite) setEditor(value); else setDetail(value); }
  async function complete(activity: AgendaActivity) {
    setBusy(true); setFailure('');
    try { await agendaCall('k5_agenda_update_activity', { activityId: activity.id, version: activity.version, status: activity.status === 'completed' ? 'pending' : 'completed', idempotencyKey: crypto.randomUUID() }); refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível atualizar.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const missing = [...new Set([clientId, ...activities.map(activity => activity.clientId)].filter((id): id is string => Boolean(id)))].filter(id => !clients.some(client => client.id === id));
    if (!optionsReady || !missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(id => agendaCall('k5_crm_get_client', { clientId: id }).then(result => result.client).catch(() => null))).then(results => {
      const found = results.filter((client): client is CrmClient => client !== null);
      if (!cancelled && found.length) setClients(current => [...current, ...found.filter(client => !current.some(item => item.id === client.id))]);
    });
    return () => { cancelled = true; };
  }, [activities, clientId, clients, optionsReady]);

  const findName = (choices: Choice[], id: string | null) => choices.find(c => c.id === id)?.name;
  const period = (activity: AgendaActivity) => activity.kind === 'task'
    ? activity.dueOn ? dateLabel(activity.dueOn) : 'Sem data'
    : `${new Date(activity.startsAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} até ${new Date(activity.endsAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;

  const today = localDate(new Date());
  // ponytail: agrupa a página carregada (50 linhas); agrupar no servidor só se a lista passar disso.
  const taskGroup = (activity: AgendaActivity) => activity.status === 'cancelled' ? 'Canceladas'
    : activity.status === 'completed' ? 'Concluídas'
    : !activity.dueOn ? 'Sem data'
    : activity.dueOn < today ? 'Atrasadas'
    : activity.dueOn === today ? 'Hoje' : 'A seguir';
  const taskGroups = ['Atrasadas', 'Hoje', 'A seguir', 'Sem data', 'Concluídas', 'Canceladas'];
  const activityRow = (activity: AgendaActivity) => {
    // Na visão de tarefas o cabeçalho do grupo já diz o tipo, a situação e o prazo; sobra a data, e só onde ela informa algo.
    const group = taskGroup(activity);
    const meta = view === 'tasks'
      ? group === 'Hoje' || group === 'Sem data' ? '' : period(activity)
      : `${period(activity)} · ${activity.kind === 'meeting' ? 'Reunião' : 'Tarefa'} · ${statusLabels[activity.status]}${activity.kind === 'task' && activity.status === 'pending' && activity.dueOn && activity.dueOn < today ? ' · Atrasada' : ''}`;
    return <article key={activity.id} className="flex items-start gap-3 py-4">
      {canWrite && activity.kind === 'task' && activity.status !== 'cancelled' && <input aria-label={`${activity.status === 'completed' ? 'Reabrir' : 'Concluir'} ${activity.title}`} type="checkbox" checked={activity.status === 'completed'} disabled={busy} onChange={() => void complete(activity)} className="mt-1 size-5 shrink-0 accent-primary" />}
      <div className="min-w-0 flex-1"><button type="button" onClick={() => inspect({ mode: 'activity', activity })} className="break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{activity.title}</button>{meta && <p className="mt-1 text-[13px] text-muted-foreground">{meta}</p>}<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">{activity.clientId && <span>{findName(clients, activity.clientId)}</span>}{activity.assigneeId && <span>{findName(members, activity.assigneeId) ?? 'Responsável anterior'}</span>}{activity.caseId && cases.some(c => c.id === activity.caseId) && <Link href={`/app/vault/cases/${encodeURIComponent(activity.caseId)}`} className="underline underline-offset-4">{findName(cases, activity.caseId)}</Link>}</div></div>
    </article>;
  };

  return <div className="flex min-w-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10 [&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5"><h1 className="page-title max-md:sr-only">Tarefas e Agenda</h1><div className="flex gap-2"><Button variant="ghost" onClick={refresh} disabled={loading}>Atualizar</Button>{canWrite && <Button disabled={!optionsReady} className="h-11 md:h-9" onClick={() => setEditor({ mode: view === 'clients' ? 'client' : 'activity' })}>{view === 'clients' ? 'Novo cliente' : 'Nova atividade'}</Button>}</div></header>
    <nav aria-label="Visões de tarefas e agenda" className="flex gap-5 border-b">{([['tasks', 'Tarefas'], ['calendar', 'Agenda'], ['clients', 'Clientes']] as const).map(([value, label]) => <button key={value} type="button" aria-current={view === value ? 'page' : undefined} onClick={() => changeView(value)} className={`min-h-12 border-b-2 px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === value ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>{label}</button>)}</nav>
    <div className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4">
      <Input aria-label={view === 'clients' ? 'Buscar clientes' : 'Buscar atividades'} placeholder={view === 'clients' ? 'Buscar clientes' : 'Buscar atividades'} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); setLoading(true); }} className="h-11 md:h-9" />
      <select aria-label="Filtrar por caso" value={caseId} onChange={event => { setCaseId(event.target.value); setOffset(0); setLoading(true); }} className={selectStyle}><option value="">Todos os casos</option>{caseId && !cases.some(c => c.id === caseId) && <option value={caseId}>Caso selecionado</option>}{cases.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {view === 'clients' && <select aria-label="Filtrar área" value={legalArea} onChange={event => { setLegalArea(event.target.value); setOffset(0); setLoading(true); }} className={selectStyle}><option value="">Todas as áreas</option>{legalAreas.map(area => <option key={area} value={area}>{legalAreaLabels[area]}</option>)}</select>}
      {view !== 'clients' && <ClientPicker label="Filtrar por cliente" emptyLabel="Todos os clientes" value={clientId} choices={clients} onChange={(id, client) => { setClientId(id); setOffset(0); setLoading(true); if (client) setClients(current => [...current.filter(item => item.id !== client.id), client]); }} />}
      <select aria-label={view === 'clients' ? 'Filtrar relacionamento' : 'Filtrar situação'} value={status} onChange={event => { setStatus(event.target.value); setOffset(0); setLoading(true); }} className={selectStyle}><option value="">{view === 'clients' ? 'Todos os relacionamentos' : 'Todas as situações'}</option>{Object.entries(view === 'clients' ? stageLabels : statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {canWrite && optionsReady && view !== 'clients' && <AgendaSuggestions cases={cases} clients={clients} members={members} day={day} timeZone={timeZone} initialProposalId={initialProposalId} refreshed={refresh} />}
    {(failure || optionsFailure || detailFailure) && <div className="mb-4 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{failure || optionsFailure || detailFailure}</p><Button variant="outline" onClick={refresh}>Tentar novamente</Button></div>}
    {clientId && view !== 'clients' && clients.some(c => c.id === clientId) && <div className="mb-4"><Button variant="outline" onClick={() => inspect({ mode: 'client', client: clients.find(c => c.id === clientId)! })}>Dados de {findName(clients, clientId)}</Button></div>}
    <div className={view === 'calendar' ? 'flex flex-col gap-8 md:flex-row' : ''}>
      {view === 'calendar' && day && <div className="md:w-72 md:shrink-0"><Calendar day={day} markers={markers} onChange={value => { setDay(value); setOffset(0); setLoading(true); }} />{markersLoading && <p role="status" className="mt-3 text-xs text-muted-foreground">Carregando marcadores…</p>}{markerFailure && <div className="mt-3 space-y-2"><p role="alert" className="text-xs text-destructive">{markerFailure}</p><Button variant="ghost" onClick={refresh}>Tentar novamente</Button></div>}</div>}
      <section aria-label={view === 'clients' ? 'Clientes' : 'Atividades'} aria-busy={loading} className="min-w-0 flex-1">
        {view === 'calendar' && <div className="mb-4"><h2 className="text-base font-medium">{day && dateLabel(day)}</h2><p className="mt-1 text-xs text-muted-foreground">Horários em {timeZone}</p></div>}
        {loading ? <p role="status" className="py-10 text-sm text-muted-foreground">Carregando…</p> : failure ? null : total === 0 ? <p className="py-10 text-sm text-muted-foreground">{view === 'clients' ? 'Nenhum cliente encontrado.' : view === 'calendar' ? 'Nenhuma atividade para este dia.' : 'Nenhuma tarefa encontrada.'}</p> : view === 'clients' ? <div className="divide-y border-y">{clientRows.map(client => <article key={client.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><Link href={`/app/agenda/clients/${encodeURIComponent(client.id)}`} className="text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{client.name}</Link><p className="mt-1 break-words text-[13px] text-muted-foreground">{stageLabels[client.stage]}{client.legalAreas.length ? ` · ${client.legalAreas.map(area => legalAreaLabels[area]).join(', ')}` : ''}{client.city ? ` · ${client.city}${client.state ? `/${client.state}` : ''}` : ''}{client.email ? ` · ${client.email}` : ''}{client.phone ? ` · ${client.phone}` : ''}</p></div><Button variant="ghost" onClick={() => { setClientId(client.id); changeView('calendar'); }}>Ver agenda<span className="sr-only"> de {client.name}</span></Button></article>)}</div> : view === 'tasks' ? <div>{taskGroups.map(name => {
          const rows = activities.filter(activity => taskGroup(activity) === name);
          return rows.length ? <section key={name} className="pt-6 first:pt-0"><h2 className="pb-2 text-[13px] text-muted-foreground">{name}</h2><div className="divide-y border-y">{rows.map(activityRow)}</div></section> : null;
        })}</div> : <div className="divide-y border-y">{activities.map(activityRow)}</div>}
        {!loading && !failure && total > 0 && <div className="flex items-center justify-between gap-3 py-4 text-xs text-muted-foreground"><span>{offset + 1}–{Math.min(offset + 50, total)} de {total}</span><div className="flex gap-2"><Button variant="ghost" disabled={offset === 0} onClick={() => { setOffset(offset - 50); setLoading(true); }}>Anterior</Button><Button variant="ghost" disabled={offset + 50 >= total} onClick={() => { setOffset(offset + 50); setLoading(true); }}>Próxima</Button></div></div>}
      </section>
    </div>
    {detail && <section className="mt-6 space-y-3 border-t pt-5" aria-label="Detalhes"><div className="flex items-center justify-between gap-3"><h2 className="font-medium">{detail.mode === 'client' ? detail.client?.name : detail.activity?.title}</h2><Button variant="ghost" onClick={() => setDetail(null)}>Fechar detalhes</Button></div>{detail.mode === 'activity' && detail.activity && <p className="text-sm">{period(detail.activity)} · {statusLabels[detail.activity.status]}</p>}{detail.mode === 'client' && detail.client && <><p className="text-sm">{stageLabels[detail.client.stage]} · {detail.client.email} · {detail.client.phone}</p>{detail.client.caseIds.map(id => <Link key={id} href={`/app/vault/cases/${encodeURIComponent(id)}`} className="mr-4 text-sm underline">{findName(cases, id) ?? 'Caso'}</Link>)}</>}<p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{(detail.mode === 'client' ? detail.client?.notes : detail.activity?.notes) || 'Sem observações.'}</p>{canWrite && <Button variant="outline" disabled={!optionsReady} onClick={() => { setEditor(detail); setDetail(null); }}>Editar</Button>}</section>}
    {editor && optionsReady && day && <AgendaEditor {...editor} cases={cases} clients={clients} members={members} day={day} caseId={caseId} clientId={clientId} timeZone={timeZone} close={() => setEditor(null)} saved={() => { setEditor(null); refresh(); }} />}
  </div>;
}
