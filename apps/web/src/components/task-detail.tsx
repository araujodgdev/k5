'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { agendaCall, type Choice } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import type { AgendaActivity, CrmClient } from '@/lib/capabilities/agenda';
import { Button } from './ui/button';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));

const statuses = { pending: 'Pendente', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada' };
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
const instantLabel = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type TaskState =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; activity: AgendaActivity; members: Choice[]; cases: Choice[]; client: CrmClient | null; partial: boolean };

export function TaskDetail({ taskId }: { taskId: string }) {
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

  const ready = state.phase === 'ready' ? state : null;
  const activity = ready?.activity;
  return <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10">
    <Link href="/app/agenda?layout=kanban" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"><ArrowLeft className="size-4" />Voltar ao Kanban</Link>
    {state.phase === 'failed' ? <div className="space-y-3"><h1 className="page-title">Tarefa indisponível</h1><p role="alert" className="text-sm text-destructive">{state.message}</p><Button variant="outline" size="lg" onClick={retry}>Tentar novamente</Button></div>
      : state.phase === 'loading' ? <p role="status" className="py-8 text-muted-foreground">Carregando tarefa…</p>
      : ready && activity && <>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><h1 className="page-title min-w-0 break-words">{activity.title}</h1><Button variant="outline" size="lg" onClick={() => { setNotice(''); setEditing(true); }}>Editar tarefa</Button></header>
        {notice && <p role="status" className="mt-4 border-l-2 border-brand pl-3 text-sm">{notice}</p>}
        {ready.partial && <div className="mt-4 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">Alguns vínculos não puderam ser carregados e aparecem sem nome.</p><Button variant="outline" size="lg" onClick={retry}>Tentar novamente</Button></div>}
        <div className="grid gap-10 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section aria-labelledby="task-info"><h2 id="task-info" className="mb-4 font-medium">Detalhes</h2><dl className="space-y-4 text-sm">
            <div><dt className="mb-1 text-xs text-muted-foreground">Situação</dt><dd>{statuses[activity.status]}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Data</dt><dd>{activity.dueOn ? dateLabel(activity.dueOn) : 'Sem data'}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Responsável</dt><dd className="break-words">{activity.assigneeId ? ready.members.find(member => member.id === activity.assigneeId)?.name ?? 'Responsável anterior' : 'Sem responsável'}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Cliente</dt><dd className="break-words">{activity.clientId ? <Link href={`/app/agenda/clients/${encodeURIComponent(activity.clientId)}`} className="underline underline-offset-4">{ready.client?.name ?? 'Abrir cliente'}</Link> : 'Sem cliente'}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Caso do Cofre</dt><dd className="break-words">{activity.caseId ? <Link href={`/app/vault/cases/${encodeURIComponent(activity.caseId)}`} className="underline underline-offset-4">{ready.cases.find(item => item.id === activity.caseId)?.name ?? 'Abrir caso'}</Link> : 'Sem caso'}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Criada em</dt><dd>{instantLabel(activity.createdAt)}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">Atualizada em</dt><dd>{instantLabel(activity.updatedAt)}</dd></div>
          </dl></section>
          <section aria-labelledby="task-notes"><h2 id="task-notes" className="mb-3 font-medium">Observações</h2><p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{activity.notes || 'Sem observações.'}</p>
            {activity.agentConversationId && <Link href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`} className="mt-6 flex min-h-11 items-center text-sm text-brand-ink underline underline-offset-4">Abrir sessão do Lume</Link>}
          </section>
        </div>
      </>}
    {editing && ready && activity && <AgendaEditor mode="activity" fields="task-details" activity={activity} cases={ready.cases} clients={ready.client ? [ready.client] : []} members={ready.members} day={localDate(new Date())} caseId="" clientId="" timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} close={() => setEditing(false)} saved={() => { setEditing(false); setNotice('Tarefa atualizada.'); retry(); }} />}
  </div>;
}
