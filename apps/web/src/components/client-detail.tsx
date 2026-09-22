'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AgendaEditor, agendaCall, localDate, type Choice } from './agenda-forms';
import { Button } from './ui/button';
import type { CrmClient, AgendaActivity } from '@/lib/capabilities/agenda';
import type { OfficeRole } from '@/lib/offices';

const stages = { prospect: 'Potencial cliente', active: 'Cliente ativo', archived: 'Arquivado' };
const statuses = { pending: 'Pendente', completed: 'Concluída', cancelled: 'Cancelada' };

export function ClientDetail({ clientId, role }: { clientId: string; role: OfficeRole }) {
  const [client, setClient] = useState<CrmClient | null>(null);
  const [cases, setCases] = useState<Choice[]>([]);
  const [activities, setActivities] = useState<AgendaActivity[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setFailure('');
      try {
        const [detail, vault, agenda] = await Promise.all([
          agendaCall('k5_crm_get_client', { clientId }),
          agendaCall('k5_vault_list_cases', {}),
          agendaCall('k5_agenda_list_activities', { clientId, limit: 20, offset }),
        ]);
        if (!cancelled) { setClient(detail.client); setCases(vault.cases); setActivities(agenda.activities); setTotal(agenda.total); }
      } catch (error) { if (!cancelled) setFailure(error instanceof Error ? error.message : 'Não foi possível carregar o cliente.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [clientId, revision, offset]);

  return <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
    <Link href="/app/agenda?view=clients" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"><ArrowLeft className="size-4" />Clientes</Link>
    {failure ? <div className="space-y-3"><h1 className="display text-[28px]">Cliente indisponível</h1><p role="alert" className="text-sm text-destructive">{failure}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></div> : loading ? <p role="status" className="py-8 text-muted-foreground">Carregando cliente…</p> : client && <>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div className="min-w-0"><h1 className="display break-words text-[28px]">{client.name}</h1><p className="mt-2 text-sm text-muted-foreground">{stages[client.stage]}</p></div>{role !== 'reviewer' && <Button variant="outline" size="lg" onClick={() => setEditing(true)}>Editar cliente</Button>}</header>
      <div className="grid gap-10 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <section aria-labelledby="client-contact"><h2 id="client-contact" className="mb-4 font-medium">Contato</h2><dl className="space-y-4 text-sm"><div><dt className="mb-1 text-xs text-muted-foreground">E-mail</dt><dd className="break-all">{client.email ? <a className="underline underline-offset-4" href={`mailto:${client.email}`}>{client.email}</a> : 'Não informado'}</dd></div><div><dt className="mb-1 text-xs text-muted-foreground">Telefone</dt><dd>{client.phone ? <a className="underline underline-offset-4" href={`tel:${client.phone.replace(/[^+\d]/g, '')}`}>{client.phone}</a> : 'Não informado'}</dd></div></dl></section>
          <section aria-labelledby="client-notes"><h2 id="client-notes" className="mb-3 font-medium">Observações</h2><p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{client.notes || 'Sem observações.'}</p></section>
          <section aria-labelledby="client-cases"><h2 id="client-cases" className="mb-3 font-medium">Casos no Cofre</h2>{client.caseIds.length ? <div className="divide-y">{client.caseIds.map(id => <Link key={id} href={`/app/vault/cases/${encodeURIComponent(id)}`} className="block py-3 text-sm underline-offset-4 hover:underline">{cases.find(item => item.id === id)?.name ?? 'Abrir caso'}</Link>)}</div> : <p className="text-sm text-muted-foreground">Nenhum caso vinculado.</p>}</section>
        </div>
        <section aria-labelledby="client-activities"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="client-activities" className="font-medium">Tarefas e reuniões <span className="ml-2 text-sm font-normal text-muted-foreground">{total}</span></h2>{role !== 'reviewer' && <Button asChild size="lg"><Link href={`/app/agenda?clientId=${encodeURIComponent(clientId)}&action=new`}>Nova atividade</Link></Button>}</div>
          {activities.length ? <div className="divide-y border-y">{activities.map(activity => <Link key={activity.id} href={`/app/agenda?clientId=${encodeURIComponent(clientId)}&activityId=${encodeURIComponent(activity.id)}`} className="block py-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"><p className="break-words text-sm font-medium">{activity.title}</p><p className="mt-1 text-[13px] text-muted-foreground">{activity.kind === 'meeting' ? `Reunião · ${new Date(activity.startsAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : `Tarefa · ${activity.dueOn ? new Date(`${activity.dueOn}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data'}`} · {statuses[activity.status]}</p></Link>)}</div> : <p className="py-6 text-sm text-muted-foreground">Nenhuma atividade vinculada a este cliente.</p>}
          {total > 20 && <div className="mt-4 flex items-center justify-between gap-2"><Button variant="ghost" disabled={!offset} onClick={() => setOffset(value => value - 20)}>Anterior</Button><span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + 20, total)} de {total}</span><Button variant="ghost" disabled={offset + 20 >= total} onClick={() => setOffset(value => value + 20)}>Próxima</Button></div>}
          <Link href={`/app/agenda?view=calendar&clientId=${encodeURIComponent(clientId)}`} className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Ver na agenda</Link>
        </section>
      </div>
    </>}
    {editing && client && <AgendaEditor mode="client" client={client} cases={cases} clients={[client]} members={[]} day={localDate(new Date())} clientId={clientId} caseId="" timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} close={() => setEditing(false)} saved={() => { setEditing(false); setRevision(value => value + 1); }} />}
  </div>;
}
