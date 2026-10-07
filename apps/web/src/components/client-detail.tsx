'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Folder, Plus } from 'lucide-react';
import { CanvasHeader, CanvasPage, CanvasRow, CanvasSection, CanvasSectionLink } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { agendaCall, type Choice } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import { legalAreaLabels, type AgendaActivity, type CrmClient } from '@/lib/capabilities/agenda';
import { Button } from './ui/button';
import { BreakableEmail } from './breakable-email';
import { PortalManager } from './client-portal/manager';
import { BackLink, Facts } from './agenda-detail';
import { AgendaRow, EmptyRows, RowsLoading, stageLabels } from './agenda-rows';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));

const PAGE = 20;
const linkClass = 'underline decoration-border-strong underline-offset-4 hover:decoration-current';
const andList = new Intl.ListFormat('pt-BR', { type: 'conjunction' });

function address(client: CrmClient) {
  const place = [[client.city, client.state].filter(Boolean).join('/'), client.postalCode && `CEP ${client.postalCode}`].filter(Boolean).join(' · ');
  if (!client.addressLine && !place) return 'Não informado';
  return <>{client.addressLine && <span className="block">{client.addressLine}</span>}{place && <span className="block">{place}</span>}</>;
}

/** A client as a page of the canvas: contact, cases, tasks and meetings, notes and the client portal. */
export function ClientDetail({ clientId }: { clientId: string }) {
  const router = useRouter();
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
          agendaCall('k5_agenda_list_activities', { clientId, limit: PAGE, offset }),
        ]);
        if (!cancelled) { setClient(detail.client); setCases(vault.cases); setActivities(agenda.activities); setTotal(agenda.total); }
      } catch (error) { if (!cancelled) setFailure(error instanceof Error ? error.message : 'Não foi possível carregar o cliente.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [clientId, revision, offset]);

  const back = <BackLink href="/app/agenda?view=clients">Clientes</BackLink>;
  if (failure) return <CanvasPage className="gap-5 md:gap-5">{back}<CanvasHeader title="Cliente indisponível" />
    <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{failure}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></div></CanvasPage>;
  if (!client) return <CanvasPage className="gap-5 md:gap-5">{back}<RowsLoading label="Carregando cliente" /></CanvasPage>;

  const today = localDate(new Date());
  const areas = client.legalAreas.map(area => legalAreaLabels[area]);
  const encoded = encodeURIComponent(clientId);
  return <CanvasPage className="gap-8 md:gap-10">
    <CanvasMeta title={client.name} subject={{ kind: 'module', slug: 'agenda', title: client.name }} />
    <div className="flex flex-col gap-3">
      {back}
      <CanvasHeader eyebrow={[stageLabels[client.stage], areas.length ? andList.format(areas) : ''].filter(Boolean).join(' · ')} title={<span className="break-words">{client.name}</span>}
        actions={<>
          <Button asChild variant="ghost" size="lg" className="text-muted-foreground max-md:h-11"><Link href={`/app/honorarios?clientId=${encoded}`}>Ver honorários deste cliente</Link></Button>
          <Button variant="outline" size="lg" className="max-md:h-11" onClick={() => setEditing(true)}>Editar cliente</Button>
        </>} />
    </div>
    <Facts items={[
      { label: 'E-mail', value: client.email ? <a className={linkClass} href={`mailto:${client.email}`}><BreakableEmail email={client.email} /></a> : 'Não informado' },
      { label: 'Telefone', value: client.phone ? <a className={linkClass} href={`tel:${client.phone.replace(/[^+\d]/g, '')}`}>{client.phone}</a> : 'Não informado' },
      { label: 'Endereço', value: address(client) },
    ]} />
    <CanvasSection title={<>Tarefas e reuniões <span className="ml-1 font-mono text-[12.5px] font-normal text-muted-foreground">{total}</span></>}
      action={<CanvasSectionLink href={`/app/agenda?view=calendar&clientId=${encoded}`}>Ver na agenda</CanvasSectionLink>}>
      <div aria-busy={loading} className="flex flex-col gap-0.5">
        {loading ? <RowsLoading label="Carregando atividades" rows={2} /> : activities.length
          ? activities.map(activity => <AgendaRow key={activity.id} activity={activity} today={today} names={{ cases, clients: [], members: [] }}
            onOpen={meeting => router.push(`/app/agenda?view=calendar&clientId=${encoded}&activityId=${encodeURIComponent(meeting.id)}`)} />)
          : <EmptyRows>Nenhuma atividade vinculada a este cliente.</EmptyRows>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" className="-ml-3 text-muted-foreground max-md:h-11 [&_svg]:size-3.5"><Link href={`/app/agenda?clientId=${encoded}&action=new`}><Plus aria-hidden="true" />Nova atividade</Link></Button>
        {total > PAGE && <div className="flex items-center gap-1"><span className="mr-2 font-mono text-[12.5px] text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, total)} de {total}</span><Button variant="ghost" disabled={!offset} onClick={() => setOffset(value => value - PAGE)}>Anterior</Button><Button variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(value => value + PAGE)}>Próxima</Button></div>}
      </div>
    </CanvasSection>
    <CanvasSection title="Casos no Cofre">
      {client.caseIds.length ? <div className="flex flex-col gap-0.5">{client.caseIds.map(id => <CanvasRow key={id} icon={<Folder />} title={cases.find(item => item.id === id)?.name ?? 'Abrir caso'} href={`/app/vault/cases/${encodeURIComponent(id)}`} />)}</div>
        : <EmptyRows>Nenhum caso vinculado.</EmptyRows>}
    </CanvasSection>
    <CanvasSection title="Observações">
      <p className="max-w-[68ch] text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{client.notes || 'Sem observações.'}</p>
    </CanvasSection>
    <PortalManager clientId={clientId} initialEmail={client.email ?? ''} />
    {editing && <AgendaEditor mode="client" client={client} cases={cases} clients={[client]} members={[]} day={today} clientId={clientId} caseId="" timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      close={() => setEditing(false)} saved={() => { setEditing(false); setRevision(value => value + 1); }} />}
  </CanvasPage>;
}
