'use client';

import { z } from 'zod';
import dynamic from 'next/dynamic';
import { useRouter } from '@/components/lume/canvas-navigation';
import { useCanvasRevision, useCanvasActive } from './lume/canvas-host';
import { useCallback, useEffect, useState } from 'react';
import { Columns3, List, Plus, RefreshCw } from 'lucide-react';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { agendaCall, type Choice } from '@/lib/agenda-client';
import { calendarDays, localDate } from '@/lib/calendar-days';
import { legalAreaLabels, legalAreas, type AgendaActivity, type CrmClient } from '@/lib/capabilities/agenda';
import { timeZoneLabel } from '@/lib/time-zone-label';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { LumeMark } from './lume-mark';
import { MonthCard } from './agenda-calendar';
import { FilterMenu, SearchField, Segmented } from './agenda-filters';
import { addDays, AgendaRow, ClientRow, EmptyRows, longDate, RowsLoading, stageLabels, TaskRow, type Names } from './agenda-rows';
import { AgendaSuggestions } from './agenda-suggestions';
import { ClientPicker } from './client-picker';
import { OfficeNavigation } from './office-navigation';
import { TaskBoard } from './task-board';
import { useTaskMoves } from './task-moves';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));
const CalendarPanel = dynamic(() => import('./google/calendar-panel').then(module => module.CalendarPanel));

type View = 'tasks' | 'calendar' | 'clients';
type Layout = 'list' | 'kanban';
type Situation = 'open' | 'completed' | 'cancelled';
type Editor = { mode: 'activity'; activity?: AgendaActivity } | { mode: 'client'; client?: CrmClient };
type LegalArea = (typeof legalAreas)[number];

const PAGE = 50;
const WEEK = 7;
const heads: Record<View, { title: string; action: string; empty: string; loading: string }> = {
  tasks: { title: 'Tarefas', action: 'Nova tarefa', empty: 'Nenhuma tarefa aberta.', loading: 'Carregando tarefas' },
  calendar: { title: 'Agenda', action: 'Nova reunião', empty: 'Nada marcado nestes sete dias.', loading: 'Carregando agenda' },
  clients: { title: 'Clientes', action: 'Novo cliente', empty: 'Nenhum cliente encontrado.', loading: 'Carregando clientes' },
};
const situations = [{ value: 'open', label: 'Abertas' }, { value: 'completed', label: 'Concluídas' }, { value: 'cancelled', label: 'Canceladas' }] as const;
const stageOptions = [{ value: '', label: 'Todos' }, ...Object.entries(stageLabels).map(([value, label]) => ({ value, label }))];
const areaOptions = [{ value: '', label: 'Todas' }, ...legalAreas.map(area => ({ value: area, label: legalAreaLabels[area] }))];
const layouts = [{ value: 'list', label: 'Ver em lista', icon: <List className="size-3.5" aria-hidden="true" /> }, { value: 'kanban', label: 'Ver em quadro', icon: <Columns3 className="size-3.5" aria-hidden="true" /> }] as const;
const sources = [{ value: 'office', label: 'Escritório' }, { value: 'personal', label: 'Google pessoal' }] as const;

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
function savedNotice(editor: Editor) {
  if (editor.mode === 'client') return editor.client ? 'Cliente atualizado.' : 'Cliente cadastrado.';
  return editor.activity ? 'Atividade atualizada.' : 'Atividade criada.';
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** The office's day to day as canvas modules: Tarefas, Agenda and Clientes, each a list of rows (`Main.dc.html`, `v.modulo`). */
export function AgendaWorkspace({ initialCaseId, initialClientId, initialActivityId, initialProposalId = '', initialView = 'tasks', initialAction = '', initialPersonalEventId = '', initialTaskLayout = 'list' }: {
  initialTaskLayout?: Layout; initialCaseId: string; initialClientId: string; initialActivityId: string; initialProposalId?: string; initialView?: View; initialAction?: string; initialPersonalEventId?: string;
}) {
  const router = useRouter();
  const view = initialView;
  const [taskLayout, setTaskLayout] = useState(initialTaskLayout);
  const board = view === 'tasks' && taskLayout === 'kanban';
  const [calendarMode, setCalendarMode] = useState<'office' | 'personal'>(initialPersonalEventId ? 'personal' : 'office');
  const personal = view === 'calendar' && calendarMode === 'personal';
  const [markers, setMarkers] = useState<Record<string, number>>({});
  const [markerFailure, setMarkerFailure] = useState('');
  const [markersLoading, setMarkersLoading] = useState(false);
  const [day, setDay] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [caseId, setCaseId] = useState(initialCaseId);
  const [clientId, setClientId] = useState(initialClientId);
  const [situation, setSituation] = useState<Situation>('open');
  const [stage, setStage] = useState('');
  const [legalArea, setLegalArea] = useState('');
  const [query, setQuery] = useState('');
  const searchQuery = useDebouncedValue(query);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [cases, setCases] = useState<Choice[]>([]);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const canvasRevision = useCanvasRevision(), active = useCanvasActive();
  const [members, setMembers] = useState<Choice[]>([]);
  const [activities, setActivities] = useState<AgendaActivity[]>([]);
  const [clientRows, setClientRows] = useState<CrmClient[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [optionsReady, setOptionsReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [optionsFailure, setOptionsFailure] = useState('');
  const [canvasSeed, setCanvasSeed] = useState({canvasRevision,active});
  if (canvasSeed.canvasRevision !== canvasRevision || canvasSeed.active !== active) { setCanvasSeed({canvasRevision,active}); setActivities([]); setClientRows([]); setMembers([]); setClients([]); setCases([]); setOptionsReady(false); setTotal(0); setSummary(''); }
  const [editor, setEditor] = useState<Editor | null>(initialAction === 'new' ? { mode: view === 'clients' ? 'client' : 'activity' } : null);
  const [describing, setDescribing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);
  const moves = useTaskMoves(activities);
  const names: Names = { cases, clients, members };
  const today = day ? localDate(new Date()) : '';

  useEffect(() => {
    // Resolve the person's civil date after hydration, rather than using the server's timezone.
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
      } catch (error) { if (!cancelled) { setOptionsFailure(message(error, 'Não foi possível carregar os vínculos.')); setOptionsReady(false); } }
    }
    void load(); return () => { cancelled = true; };
  }, [revision, canvasRevision, active]);

  useEffect(() => {
    if (!initialActivityId) return;
    let cancelled = false;
    agendaCall('k5_agenda_get_activity', { activityId: initialActivityId })
      .then(({ activity }) => { if (!cancelled) setEditor({ mode: 'activity', activity }); })
      .catch(error => { if (!cancelled) setFailure(message(error, 'Atividade indisponível.')); });
    return () => { cancelled = true; };
  }, [initialActivityId]);

  // The eyebrow over the title counts the whole office, whatever the filters show.
  useEffect(() => {
    if (view === 'calendar' || !day) return;
    let cancelled = false;
    const yesterday = addDays(day, -1);
    const counts = view === 'tasks'
      ? Promise.all([agendaCall('k5_agenda_list_activities', { kind: 'task', openOnly: true, limit: 1 }), agendaCall('k5_agenda_list_activities', { kind: 'task', openOnly: true, dueTo: yesterday, limit: 1 })])
        .then(([open, late]) => open.total ? `${count(open.total, 'aberta', 'abertas')}${late.total ? `, ${count(late.total, 'atrasada', 'atrasadas')}` : ''}` : 'Nenhuma tarefa aberta')
      : Promise.all([agendaCall('k5_crm_list_clients', { limit: 1 }), agendaCall('k5_crm_list_clients', { stage: 'prospect', limit: 1 })])
        .then(([all, prospects]) => all.total ? `${count(all.total, 'cliente', 'clientes')}${prospects.total ? `, ${prospects.total} em prospecção` : ''}` : 'Nenhum cliente cadastrado');
    counts.then(text => { if (!cancelled) setSummary(text); }, () => { if (!cancelled) setSummary(''); });
    return () => { cancelled = true; };
  }, [view, day, revision, canvasRevision, active]);

  const month = day.slice(0, 7);
  useEffect(() => {
    if (view !== 'calendar' || calendarMode !== 'office' || !month) return;
    let cancelled = false;
    async function load() {
      setMarkers({}); setMarkerFailure(''); setMarkersLoading(true);
      try {
        const [year, index] = month.split('-').map(Number);
        const from = new Date(year, index - 1, 1); const to = new Date(year, index, 1);
        const all: AgendaActivity[] = [];
        for (let next = 0; ; next += 100) {
          const result = await agendaCall('k5_agenda_list_activities', { query: searchQuery, dueFrom: localDate(from), dueTo: localDate(new Date(year, index, 0)), from: from.toISOString(), to: to.toISOString(), ...(caseId ? { caseId } : {}), ...(clientId ? { clientId } : {}), limit: 100, offset: next });
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
  }, [view, calendarMode, month, caseId, clientId, searchQuery, revision, canvasRevision, active]);

  useEffect(() => {
    if (!day || personal) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setFailure('');
      try {
        if (view === 'clients') {
          const result = await agendaCall('k5_crm_list_clients', { query: searchQuery, ...(caseId ? { caseId } : {}), ...(stage ? { stage } : {}), ...(legalArea ? { legalArea: legalArea as LegalArea } : {}), limit: PAGE, offset });
          if (!cancelled) { setClientRows(result.clients); setTotal(result.total); }
          return;
        }
        const links = { ...(caseId ? { caseId } : {}), ...(clientId ? { clientId } : {}) };
        const start = new Date(`${day}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + WEEK);
        const scope = view === 'tasks'
          ? { kind: 'task' as const, ...(board ? {} : situation === 'open' ? { openOnly: true } : { status: situation }) }
          : { dueFrom: day, dueTo: addDays(day, WEEK - 1), from: start.toISOString(), to: end.toISOString() };
        const result = await agendaCall('k5_agenda_list_activities', { query: searchQuery, ...scope, ...links, limit: PAGE, offset });
        const all = [...result.activities];
        // The board shows every task at once, so it reads the remaining pages too.
        for (let next = all.length; board && next < result.total; next += 100) {
          const page = await agendaCall('k5_agenda_list_activities', { kind: 'task', query: searchQuery, ...links, limit: 100, offset: next });
          if (cancelled) return;
          all.push(...page.activities);
          if (!page.activities.length) break;
        }
        if (!cancelled) { setActivities(all); setTotal(result.total); }
      } catch (error) { if (!cancelled) setFailure(message(error, 'Não foi possível carregar.')); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [view, board, personal, day, caseId, clientId, searchQuery, situation, stage, legalArea, offset, revision, canvasRevision, active]);

  // Labels for the rows: clients beyond the first page of the CRM are read one by one.
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

  function filter<T>(set: (value: T) => void) {
    return (value: T) => { set(value); setOffset(0); setLoading(true); };
  }
  async function toggle(activity: AgendaActivity) {
    setBusy(true); setFailure('');
    try { await agendaCall('k5_agenda_update_activity', { activityId: activity.id, version: activity.version, status: activity.status === 'completed' ? 'pending' : 'completed', idempotencyKey: crypto.randomUUID() }); refresh(); }
    catch (error) { setFailure(message(error, 'Não foi possível atualizar.')); }
    finally { setBusy(false); }
  }
  async function delegate(activity: AgendaActivity) {
    setBusy(true); setFailure('');
    try {
      const response = await fetch('/api/agenda/delegate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activityId: activity.id, timeZone }) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(result).error);
      router.push(z.object({ url: z.string() }).parse(result).url);
    } catch (error) { setFailure(message(error, 'Não foi possível iniciar a sessão.')); }
    finally { setBusy(false); }
  }
  function changeTaskLayout(layout: Layout) {
    if (layout === taskLayout) return;
    setTaskLayout(layout); setOffset(0); setLoading(true);
    const url = new URL(window.location.href);
    url.searchParams.set('layout', layout);
    window.history.replaceState(null, '', url);
  }
  function create() { setNotice(''); setEditor({ mode: view === 'clients' ? 'client' : 'activity' }); }

  const head = heads[view];
  const opening = editor !== null && !optionsReady && !optionsFailure;
  const eyebrow = view === 'calendar' ? day && [longDate(day), timeZoneLabel(timeZone)].filter(Boolean).join(' · ') : summary;
  const problem = failure || optionsFailure;
  const empty = view === 'tasks' && situation !== 'open' ? `Nenhuma tarefa ${situation === 'completed' ? 'concluída' : 'cancelada'}.` : head.empty;
  const rows = view === 'clients' ? clientRows.map(client => <ClientRow key={client.id} client={client} />)
    : view === 'tasks' ? activities.map(activity => <TaskRow key={activity.id} activity={activity} today={today} names={names} busy={busy} onToggle={activity => void toggle(activity)} />)
    : activities.map(activity => <AgendaRow key={activity.id} activity={activity} today={today} names={names} onOpen={activity => setEditor({ mode: 'activity', activity })} />);

  const list = <section aria-label={head.title} aria-busy={loading} className="flex min-w-0 flex-1 flex-col gap-3">
    {view !== 'clients' && optionsReady && !personal && <AgendaSuggestions cases={cases} clients={clients} members={members} day={day} timeZone={timeZone} initialProposalId={initialProposalId} refreshed={refresh} describing={describing} onDescribingChange={setDescribing} />}
    {problem && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{problem}</p><Button variant="outline" onClick={refresh}>Tentar novamente</Button></div>}
    {board && moves.failure && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{moves.failure}</p><Button variant="outline" onClick={moves.dismiss}>Fechar</Button></div>}
    {loading || !day ? <RowsLoading label={head.loading} /> : failure ? null
      : board ? <TaskBoard activities={moves.activities} names={names} today={today} busy={busy} saving={moves.saving} move={moves.move} delegate={activity => void delegate(activity)} />
      : total === 0 ? <EmptyRows>{empty}</EmptyRows>
      : <div className="flex flex-col gap-0.5">{rows}</div>}
    {!loading && !failure && !board && total > PAGE && <div className="flex items-center justify-between gap-3 pt-2">
      <span className="font-mono text-[12.5px] text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, total)} de {total}</span>
      <div className="flex gap-1"><Button variant="ghost" disabled={offset === 0} onClick={() => { setOffset(offset - PAGE); setLoading(true); }}>Anterior</Button><Button variant="ghost" disabled={offset + PAGE >= total} onClick={() => { setOffset(offset + PAGE); setLoading(true); }}>Próxima</Button></div>
    </div>}
  </section>;

  return <CanvasPage width={board ? 'wide' : 'default'} className="gap-5 md:gap-5">
    <CanvasHeader eyebrow={eyebrow || <span aria-hidden="true">&nbsp;</span>} title={head.title}
      actions={!personal && <Button variant="outline" size="lg" className="max-md:h-11 [&_svg]:size-3.5" aria-busy={opening} onClick={create}><Plus aria-hidden="true" />{opening ? 'Abrindo…' : head.action}</Button>} />
    <OfficeNavigation view={view} />
    {notice && <p role="status" className="text-[13px] text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {view === 'calendar' && <Segmented label="Origem da agenda" value={calendarMode} options={sources} onChange={value => { setCalendarMode(value); setLoading(true); }} />}
      {!personal && <>
        <SearchField label={view === 'clients' ? 'Buscar clientes' : view === 'tasks' ? 'Buscar tarefas' : 'Buscar na agenda'} value={query} onChange={filter(setQuery)} className="max-md:order-first max-md:w-full" />
        {view === 'tasks' && !board && <FilterMenu label="Situação" value={situation} options={situations} onChange={filter(value => setSituation(value as Situation))} />}
        {view === 'clients' && <FilterMenu label="Relacionamento" value={stage} options={stageOptions} onChange={filter(setStage)} />}
        {view === 'clients' && <FilterMenu label="Área" value={legalArea} options={areaOptions} onChange={filter(setLegalArea)} />}
        <FilterMenu label="Caso" value={caseId} options={[{ value: '', label: 'Todos os casos' }, ...(caseId && !cases.some(item => item.id === caseId) ? [{ value: caseId, label: 'Caso selecionado' }] : []), ...cases.map(item => ({ value: item.id, label: item.name }))]} onChange={filter(setCaseId)} />
        {view !== 'clients' && <ClientPicker variant="chip" label="Cliente" emptyLabel="Todos os clientes" value={clientId} choices={clients} onChange={(id, client) => { filter(setClientId)(id); if (client) setClients(current => [...current.filter(item => item.id !== client.id), client]); }} />}
      </>}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Atualizar" onClick={refresh} disabled={loading || markersLoading}><RefreshCw aria-hidden="true" className="size-3.5" /></Button>
        {view !== 'clients' && !personal && optionsReady && <Button variant="ghost" className="h-[30px] text-[13px] text-muted-foreground max-md:hidden" onClick={() => setDescribing(true)}><LumeMark aria-hidden="true" className="size-3.5 text-foreground" />Descrever ao Lume</Button>}
        {view === 'tasks' && <Segmented label="Visualização das tarefas" value={taskLayout} options={layouts} onChange={changeTaskLayout} />}
      </div>
    </div>
    {view === 'calendar'
      ? <div className="flex flex-col gap-8 md:flex-row md:items-start">
        {personal && day ? <section aria-label="Agenda Google pessoal" className="min-w-0 flex-1"><CalendarPanel day={day} initialEventId={initialPersonalEventId} /></section> : list}
        {day && <div className="md:w-[264px] md:shrink-0"><MonthCard day={day} markers={calendarMode === 'office' ? markers : {}} showMarkers={calendarMode === 'office'} onChange={value => { setDay(value); setOffset(0); setLoading(true); }}
          status={calendarMode === 'office' && (markersLoading ? <p role="status" className="mt-2 text-xs text-muted-foreground">Carregando marcadores…</p> : markerFailure && <div className="mt-2 flex items-center justify-between gap-2"><p role="alert" className="text-xs text-destructive">{markerFailure}</p><Button variant="ghost" size="sm" onClick={refresh}>Tentar novamente</Button></div>)} /></div>}
      </div>
      : list}
    {editor && optionsReady && day && <AgendaEditor {...editor} initialKind={view === 'calendar' ? 'meeting' : 'task'} cases={cases} clients={clients} members={members} day={day} caseId={caseId} clientId={clientId} timeZone={timeZone}
      close={() => setEditor(null)} saved={() => { setNotice(savedNotice(editor)); setEditor(null); refresh(); }} />}
  </CanvasPage>;
}
