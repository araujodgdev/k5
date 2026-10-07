'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CalendarDays, CheckSquare, FolderClosed, Plus, Wallet } from 'lucide-react';
import { agendaCall } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import { Button } from './ui/button';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { HomeOverview } from '@/lib/home-overview';

type Overview = {
  tasks: CapabilityOutput<'k5_agenda_list_activities'>;
  meetings: CapabilityOutput<'k5_agenda_list_activities'>;
  fees: CapabilityOutput<'k5_honorarios_list'>;
  notifications: CapabilityOutput<'k5_notifications_list'>;
  home: HomeOverview;
};
const pendingSections = { tasks: true, meetings: true, fees: true, notifications: true, home: true };
const linkStyle = 'inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const date = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function DailyRow({ icon, title, detail, href, time, children }: { icon: ReactNode; title: string; detail: string; href: string; time?: string; children?: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-3 py-3">
    <span className="flex min-h-11 shrink-0 items-center text-muted-foreground">{children ?? icon}</span>
    <Link href={href} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
      <span className="min-w-0 flex-1 basis-48"><span className="break-words text-sm font-medium">{title}</span><span className="mt-1 block break-words text-[13px] text-muted-foreground lg:ml-2 lg:inline">{detail}</span></span>
      {time && <span className="shrink-0 font-mono text-xs text-muted-foreground">{time}</span>}
    </Link>
  </div>;
}

export function CommandCenter() {
  const [data, setData] = useState<Partial<Overview>>({});
  const [pending, setPending] = useState(pendingSections);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const [today, setToday] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const now = new Date(), day = localDate(now);
      setToday(day); setPending(pendingSections); setData({});
      async function section<K extends keyof Overview>(key: K, request: Promise<Overview[K]>) {
        try { const value = await request; if (!cancelled) setData(current => ({ ...current, [key]: value })); }
        finally { if (!cancelled) setPending(current => ({ ...current, [key]: false })); }
      }
      await Promise.allSettled([
        section('tasks', agendaCall('k5_agenda_list_activities', { kind: 'task', openOnly: true, dueTo: day, limit: 10 })),
        section('meetings', agendaCall('k5_agenda_list_activities', { kind: 'meeting', status: 'pending', from: now.toISOString(), limit: 4 })),
        section('fees', agendaCall('k5_honorarios_list', { dueTo: day, view: 'pending', limit: 5 })),
        section('notifications', agendaCall('k5_notifications_list', { unreadOnly: true, limit: 4 })),
        section('home', fetch(`/api/home?today=${day}`, { cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<HomeOverview>; })),
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
  function status(key: keyof Overview, label: string) {
    if (pending[key]) return <p role="status" className="py-3 text-sm text-muted-foreground">Carregando {label}…</p>;
    if (!data[key]) return <p role="alert" className="py-3 text-sm text-destructive">Não foi possível carregar {label}. Use Atualizar para tentar novamente.</p>;
    return null;
  }
  const due = (day: string) => day === today ? 'hoje' : `atrasada · ${date(day)}`;
  const home = data.home;
  const dailyEmpty = data.tasks && home && data.fees && data.notifications && !data.tasks.activities.length && !home.tasks.length && !data.fees.installments.length && !data.notifications.notifications.length && !home.partial.tasks;
  return <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="sr-only">Início</h1><p className="mb-2 text-sm text-muted-foreground">{today && new Date(`${today}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h2 className="text-3xl font-semibold tracking-tight">Hoje</h2></div>
      <div className="flex gap-2"><Button variant="ghost" className="min-h-11" disabled={Object.values(pending).some(Boolean)} onClick={() => setRevision(value => value + 1)}>Atualizar</Button><Button asChild className="min-h-11"><Link href="/app/agenda?action=new"><Plus className="size-4" />Nova atividade</Link></Button></div>
    </header>
    {failure && <p role="alert" className="mb-4 text-sm text-destructive">{failure}</p>}
    <section aria-label="Trabalho de hoje" className="mb-8">
      <p className="mb-2 text-xs text-muted-foreground">Tarefas e parcelas com prazo até hoje, e notificações novas.</p>
      {status('tasks', 'tarefas pessoais')}{status('home', 'casos e tarefas compartilhadas')}{status('fees', 'honorários')}{status('notifications', 'notificações')}
      {data.tasks?.activities.map(item => <DailyRow key={item.id} icon={<CheckSquare className="size-4" />} title={item.title} detail="Tarefa pessoal" href={`/app/agenda?activityId=${encodeURIComponent(item.id)}`} time={item.dueOn ? due(item.dueOn) : undefined}><input type="checkbox" aria-label={`Concluir ${item.title}`} disabled={busy !== null} checked={busy === item.id} onChange={() => void complete(item)} className="size-5 accent-primary" /></DailyRow>)}
      {home?.tasks.map(item => <DailyRow key={item.id} icon={<CheckSquare className="size-4" />} title={item.title} detail={item.caseName} href={`/app/vault/cases/${encodeURIComponent(item.caseId)}?section=tasks&task=${encodeURIComponent(item.id)}`} time={due(item.dueOn)} />)}
      {home?.partial.tasks && <p role="alert" className="py-3 text-sm text-destructive">Algumas tarefas compartilhadas não puderam ser carregadas. Atualize para tentar novamente.</p>}
      {data.notifications?.notifications.map(item => <DailyRow key={item.id} icon={<Bell className="size-4" />} title={item.title} detail={item.summary} href={item.href} time={new Date(item.createdAt).toLocaleDateString('pt-BR')} />)}
      {data.fees?.installments.map(item => <DailyRow key={item.id} icon={<Wallet className="size-4" />} title={item.title} detail={`Parcela ${item.number} de ${item.installmentCount} · Saldo ${(item.pendingCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} href={`/app/honorarios?agreementId=${encodeURIComponent(item.agreementId)}`} time={due(item.dueOn)} />)}
      {dailyEmpty && <p className="py-5 text-sm text-muted-foreground">Tudo em dia. Nenhuma tarefa, parcela ou notificação pendente neste recorte.</p>}
      {!!data.tasks && data.tasks.total > data.tasks.activities.length && <Link className={linkStyle} href="/app/agenda">Ver todas as tarefas pessoais</Link>}
      {!!data.fees && data.fees.total > data.fees.installments.length && <Link className={`${linkStyle} ml-3`} href="/app/honorarios">Ver todas as parcelas</Link>}
      <div className="mt-4 border-t pt-4"><h3 className="text-sm font-medium">Próximas reuniões</h3>{status('meetings', 'reuniões')}
        {data.meetings?.activities.map(item => <DailyRow key={item.id} icon={<CalendarDays className="size-4" />} title={item.title} detail={new Date(item.startsAt!).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })} href={`/app/agenda?view=calendar&activityId=${encodeURIComponent(item.id)}`} time={new Date(item.startsAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} />)}
        {data.meetings && !data.meetings.activities.length && <p className="py-3 text-sm text-muted-foreground">Nenhuma reunião agendada.</p>}
      </div>
    </section>
    <section aria-label="Casos recentes" className="mb-9"><header className="mb-3 flex items-center justify-between"><h2 className="font-medium">Casos recentes</h2><Link className={linkStyle} href="/app/vault">Ver todos</Link></header>
      {status('home', 'casos recentes')}
      {home && !home.cases.length && <p className="py-5 text-sm text-muted-foreground">Seus casos aparecerão aqui. Crie um caso no Cofre para começar.</p>}
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">{home?.cases.map(item => <Link key={item.id} href={`/app/vault/cases/${encodeURIComponent(item.id)}`} className="min-w-0 rounded-xl border p-4 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><p className="flex min-w-0 items-center gap-2 text-sm font-medium"><FolderClosed className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{item.name}</span></p><p className="mt-3 line-clamp-3 min-h-12 break-words text-[13px] leading-5 text-muted-foreground">{item.description || 'Sem descrição.'}</p><p className="mt-4 text-xs text-muted-foreground">Atualizado em <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('pt-BR')}</time></p></Link>)}</div>
    </section>
    <section aria-label="Atividade recente"><h2 className="font-medium">Atividade recente</h2><p className="mt-2 text-xs text-muted-foreground">Páginas, acessos, arquivos e tarefas dos casos recentes disponíveis para você.</p>{status('home', 'atividade recente')}
      {home?.partial.activity && <p role="alert" className="py-3 text-sm text-destructive">A atividade de alguns casos não pôde ser carregada. Atualize para tentar novamente.</p>}
      {home && !home.activity.length && !home.partial.activity && <p className="py-5 text-sm text-muted-foreground">Nenhuma atividade disponível nos casos recentes.</p>}
      {home?.activity.map(item => <Link key={item.id} href={item.href} className="flex min-h-11 min-w-0 flex-wrap items-start justify-between gap-3 border-b py-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1 basis-48"><span className="block break-words text-sm">{item.title}</span><span className="mt-1 block break-words text-[13px] text-muted-foreground">{item.actor ? item.actor + ' · ' : ''}{item.detail} · {item.caseName}</span></span><time dateTime={item.at} className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></Link>)}
    </section>
  </div>;
}
