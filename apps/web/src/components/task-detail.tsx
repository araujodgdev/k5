'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { agendaCall, type Choice } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import type { AgendaActivity, CrmClient } from '@/lib/capabilities/agenda';
import { Button } from './ui/button';
import { LumeMark } from './lume-mark';
import { BackLink, Facts } from './agenda-detail';
import { dayWord, statusWords } from './agenda-rows';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));

const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
const instantLabel = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const linkClass = 'underline decoration-border-strong underline-offset-4 hover:decoration-current';

type TaskState =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; activity: AgendaActivity; members: Choice[]; cases: Choice[]; client: CrmClient | null; partial: boolean };

function when(activity: AgendaActivity, today: string) {
  if (!activity.dueOn) return statusWords[activity.status];
  const open = activity.status === 'pending' || activity.status === 'in_progress';
  if (!open) return `${statusWords[activity.status]} · ${dateLabel(activity.dueOn)}`;
  return `${statusWords[activity.status]} · ${activity.dueOn < today ? 'venceu' : 'vence'} ${dayWord(activity.dueOn, today, { withDate: true })}`;
}

/** A task as its own page in the canvas: what it is about, who has it, and its notes. */
export function TaskDetail({ taskId, from = 'list' }: { taskId: string; from?: 'list' | 'kanban' }) {
  const [state, setState] = useState<TaskState>({ phase: 'loading' });
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState(current => current.phase === 'ready' ? current : { phase: 'loading' });
      try {
        const { activity } = await agendaCall('k5_agenda_get_activity', { activityId: taskId });
        if (activity.kind !== 'task') throw new Error('Registro não encontrado neste escritório.');
        const [members, cases, client] = await Promise.allSettled([
          agendaCall('k5_agenda_list_members', {}),
          agendaCall('k5_vault_list_cases', {}),
          activity.clientId ? agendaCall('k5_crm_get_client', { clientId: activity.clientId }) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setState({
          phase: 'ready', activity,
          members: members.status === 'fulfilled' ? members.value.members : [],
          cases: cases.status === 'fulfilled' ? cases.value.cases : [],
          client: client.status === 'fulfilled' ? client.value?.client ?? null : null,
          partial: [members, cases, client].some(result => result.status === 'rejected'),
        });
      } catch (error) { if (!cancelled) setState({ phase: 'failed', message: error instanceof Error ? error.message : 'Não foi possível carregar a tarefa.' }); }
    }
    void load(); return () => { cancelled = true; };
  }, [taskId, revision]);
  const retry = () => setRevision(value => value + 1);

  const back = from === 'kanban' ? <BackLink href="/app/agenda?view=tasks&layout=kanban">Voltar ao quadro</BackLink> : <BackLink href="/app/agenda?view=tasks">Tarefas</BackLink>;
  if (state.phase === 'loading') return <CanvasPage>{back}<p role="status" className="text-[13.5px] text-muted-foreground">Carregando tarefa…</p></CanvasPage>;
  if (state.phase === 'failed') return <CanvasPage className="gap-5 md:gap-5">{back}<CanvasHeader title="Tarefa indisponível" />
    <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{state.message}</p><Button variant="outline" onClick={retry}>Tentar novamente</Button></div></CanvasPage>;

  const { activity, members, cases, client } = state;
  const today = localDate(new Date());
  const caseName = cases.find(item => item.id === activity.caseId)?.name;
  return <CanvasPage className="gap-6 md:gap-8">
    <CanvasMeta title={activity.title} subject={{ kind: 'module', slug: 'agenda', title: activity.title }} />
    <div className="flex flex-col gap-3">
      {back}
      <CanvasHeader eyebrow={when(activity, today)} title={<span className="break-words">{activity.title}</span>}
        actions={<Button variant="outline" size="lg" className="max-md:h-11" onClick={() => { setNotice(''); setEditing(true); }}>Editar tarefa</Button>} />
    </div>
    {notice && <p role="status" className="-mt-3 text-[13px] text-muted-foreground">{notice}</p>}
    {state.partial && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">Alguns vínculos não puderam ser carregados e aparecem sem nome.</p><Button variant="outline" onClick={retry}>Tentar novamente</Button></div>}
    <CanvasSection title="Detalhes">
      <Facts items={[
        { label: 'Situação', value: statusWords[activity.status] },
        { label: 'Data', value: activity.dueOn ? dateLabel(activity.dueOn) : 'Sem data', mono: Boolean(activity.dueOn) },
        { label: 'Responsável', value: activity.assigneeId ? members.find(member => member.id === activity.assigneeId)?.name ?? 'Responsável anterior' : 'Sem responsável' },
        { label: 'Cliente', value: activity.clientId ? <Link href={`/app/agenda/clients/${encodeURIComponent(activity.clientId)}`} className={linkClass}>{client?.name ?? 'Abrir cliente'}</Link> : 'Sem cliente' },
        { label: 'Caso do Cofre', value: activity.caseId ? <Link href={`/app/vault/cases/${encodeURIComponent(activity.caseId)}`} className={linkClass}>{caseName ?? 'Abrir caso'}</Link> : 'Sem caso' },
        { label: 'Criada em', value: instantLabel(activity.createdAt), mono: true },
        { label: 'Atualizada em', value: instantLabel(activity.updatedAt), mono: true },
      ]} />
    </CanvasSection>
    <CanvasSection title="Observações">
      <p className="max-w-[68ch] text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{activity.notes || 'Sem observações.'}</p>
    </CanvasSection>
    {activity.agentConversationId && <Link href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-md text-[13.5px] text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring md:min-h-8"><LumeMark aria-hidden="true" className="size-4" />Abrir sessão do Lume</Link>}
    {editing && <AgendaEditor mode="activity" fields="task-details" activity={activity} cases={cases} clients={client ? [client] : []} members={members} day={today} caseId="" clientId="" timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      close={() => setEditing(false)} saved={() => { setEditing(false); setNotice('Tarefa atualizada.'); retry(); }} />}
  </CanvasPage>;
}
