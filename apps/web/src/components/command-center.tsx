'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { agendaCall } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import { Button } from './ui/button';
import type { AgendaActivity, CrmClient } from '@/lib/capabilities/agenda';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { OfficeRole } from '@/lib/offices';

type Overview = {
  tasks?: { activities: AgendaActivity[]; total: number };
  meetings?: { activities: AgendaActivity[]; total: number };
  clients?: { clients: CrmClient[]; total: number };
  vault?: CapabilityOutput<'k5_vault_list_cases'>;
  conversations?: CapabilityOutput<'k5_conversations_list'>;
};
const pendingSections = { tasks: true, meetings: true, clients: true, vault: true, conversations: true };
const linkStyle = 'inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function OverviewSection({ title, href, children, loading, failed }: { title: string; href: string; children: ReactNode; loading: boolean; failed: boolean }) {
  return <section aria-label={title} className="min-h-56 min-w-0 border-t pt-4"><header className="mb-2 flex items-center justify-between gap-3"><h2 className="font-medium">{title}</h2><Link href={href} className={linkStyle}>Ver tudo<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only"> em {title}</span></Link></header>{loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Carregando…</p> : failed ? <p role="alert" className="py-5 text-sm text-destructive">Não foi possível carregar. Use Atualizar para tentar novamente.</p> : children}</section>;
}

export function CommandCenter({ role, name }: { role: OfficeRole; name: string }) {
  const [data, setData] = useState<Overview>({});
  const [pending, setPending] = useState(pendingSections);
  const loading = Object.values(pending).some(Boolean);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const [today, setToday] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const now = new Date(); const day = localDate(now);
      setToday(day);
      setPending(pendingSections);
      async function section<K extends keyof Overview>(key: K, request: Promise<NonNullable<Overview[K]>>) {
        try {
          const value = await request;
          if (!cancelled) setData(current => ({ ...current, [key]: value }));
        } catch {
          if (!cancelled) setData(current => ({ ...current, [key]: undefined }));
        } finally {
          if (!cancelled) setPending(current => ({ ...current, [key]: false }));
        }
      }
      await Promise.all([
        section('tasks', agendaCall('k5_agenda_list_activities', { kind: 'task', status: 'pending', dueTo: day, limit: 5 })),
        section('meetings', agendaCall('k5_agenda_list_activities', { kind: 'meeting', status: 'pending', from: now.toISOString(), limit: 4 })),
        section('clients', agendaCall('k5_crm_list_clients', { stage: 'active', limit: 4 })),
        section('vault', agendaCall('k5_vault_list_cases', {})),
        section('conversations', agendaCall('k5_conversations_list', { limit: 3 })),
      ]);
    }
    void load(); return () => { cancelled = true; };
  }, [revision]);

  async function complete(activity: AgendaActivity) {
    setBusy(activity.id); setFailure('');
    try { await agendaCall('k5_agenda_update_activity', { activityId: activity.id, version: activity.version, status: 'completed', idempotencyKey: crypto.randomUUID() }); setRevision(value => value + 1); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível concluir a tarefa.'); }
    finally { setBusy(null); }
  }
  const date = today ? new Date(`${today}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const empty = (text: string) => <p className="py-5 text-sm text-muted-foreground">{text}</p>;
  return <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="display text-[28px]">Início</h1><p className="mt-3 min-h-10 text-sm text-muted-foreground">Olá, {name.replace(/[.!?]+$/, '')}.{date && ` Hoje é ${date}.`}</p></div><div className="flex items-center gap-2"><Button variant="ghost" size="lg" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</Button>{role !== 'reviewer' && <Button asChild size="lg"><Link href="/app/agenda?action=new"><Plus className="size-4" />Nova atividade</Link></Button>}</div></header>
    <div className="my-7 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 sm:grid-cols-4" aria-label="Resumo do escritório">
      {[
        ['Até hoje', data.tasks?.total, '/app/agenda'],
        ['Reuniões a seguir', data.meetings?.total, '/app/agenda?view=calendar'],
        ['Clientes ativos', data.clients?.total, '/app/agenda?view=clients'],
        ['Casos no Cofre', data.vault?.cases.length, '/app/vault'],
      ].map(([label, count, href]) => <Link key={label} href={String(href)} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-xs text-muted-foreground">{label}</span><span className="mt-2 block text-2xl tabular-nums">{count === undefined ? '—' : count}</span></Link>)}
    </div>
    {failure && <p role="alert" className="mb-4 text-sm text-destructive">{failure}</p>}
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
      <OverviewSection title="Tarefas até hoje" href="/app/agenda" loading={pending.tasks && !data.tasks} failed={!data.tasks}>
        {data.tasks?.activities.length ? <div className="divide-y">{data.tasks.activities.map(activity => <article key={activity.id} className="flex items-start gap-3 py-3">
          {role !== 'reviewer' && <label className="flex min-h-11 shrink-0 items-start pt-0.5"><input type="checkbox" aria-label={`Concluir ${activity.title}`} disabled={busy !== null} checked={busy === activity.id} onChange={() => void complete(activity)} className="size-5 accent-primary" /></label>}
          <Link href={`/app/agenda?activityId=${encodeURIComponent(activity.id)}`} className="min-w-0 flex-1 py-0.5 underline-offset-4 hover:underline"><p className="break-words text-sm">{activity.title}</p><p className={`mt-1 text-xs ${activity.dueOn! < today ? 'text-schedule' : 'text-muted-foreground'}`}>{activity.dueOn! < today ? `Atrasada · ${new Date(`${activity.dueOn}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Hoje'}</p></Link>
        </article>)}</div> : empty('Tudo em dia. Nenhuma tarefa pendente até hoje.')}
      </OverviewSection>
      <OverviewSection title="Próximas reuniões" href="/app/agenda?view=calendar" loading={pending.meetings && !data.meetings} failed={!data.meetings}>
        {data.meetings?.activities.length ? <div className="divide-y">{data.meetings.activities.map(activity => <Link key={activity.id} href={`/app/agenda?view=calendar&activityId=${encodeURIComponent(activity.id)}`} className="flex items-start gap-4 py-4 underline-offset-4 hover:underline"><time dateTime={activity.startsAt!} className="w-16 shrink-0 text-sm tabular-nums text-schedule">{new Date(activity.startsAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><div className="min-w-0"><p className="break-words text-sm">{activity.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(activity.startsAt!).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</p></div></Link>)}</div> : empty('Nenhuma reunião agendada.')}
      </OverviewSection>
      <OverviewSection title="Casos no Cofre" href="/app/vault" loading={pending.vault && !data.vault} failed={!data.vault}>
        {data.vault?.cases.length ? <div className="divide-y">{data.vault.cases.slice(0, 4).map(item => <Link key={item.id} href={`/app/vault/cases/${encodeURIComponent(item.id)}`} className="flex min-h-14 items-center justify-between gap-3 py-3 text-sm underline-offset-4 hover:underline"><span className="truncate">{item.name}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>)}</div> : empty('Seus casos e documentos aparecerão aqui.')}
        <Link href="/app/vault" className={linkStyle}>Abrir documentos do escritório</Link>
      </OverviewSection>
      <OverviewSection title="Clientes ativos" href="/app/agenda?view=clients" loading={pending.clients && !data.clients} failed={!data.clients}>
        {data.clients?.clients.length ? <div className="divide-y">{data.clients.clients.map(client => <Link key={client.id} href={`/app/agenda/clients/${encodeURIComponent(client.id)}`} className="block py-3 underline-offset-4 hover:underline"><p className="break-words text-sm">{client.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{client.email || client.phone || 'Contato não informado'}</p></Link>)}</div> : empty('Nenhum cliente ativo cadastrado.')}
        {role !== 'reviewer' && <Link href="/app/agenda?view=clients&action=new" className={linkStyle}>Cadastrar cliente</Link>}
      </OverviewSection>
      <div className="lg:col-span-2"><OverviewSection title="Conversas com Lume" href="/app/agents" loading={pending.conversations && !data.conversations} failed={!data.conversations}>
        {data.conversations?.conversations.length ? <div className="divide-y">{data.conversations.conversations.slice(0, 3).map(conversation => <Link key={conversation.id} href={`/app/agents?conversationId=${encodeURIComponent(conversation.id)}`} className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm underline-offset-4 hover:underline"><span className="truncate">{conversation.title}</span><span className="shrink-0 text-xs text-muted-foreground">Retomar<ArrowUpRight className="ml-1 inline size-3.5" aria-hidden="true" /></span></Link>)}</div> : <div className="flex flex-wrap items-center justify-between gap-3 py-4"><p className="text-sm text-muted-foreground">Consulte documentos e organize o trabalho com Lume.</p><Link href="/app/agents" className={linkStyle}>Abrir conversa<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>}
      </OverviewSection></div>
    </div>
  </div>;
}
