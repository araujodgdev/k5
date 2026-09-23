import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformTickets } from '@/lib/feedback-tickets';
import { kindLabels, moduleLabels, priorityLabels, statusLabels, ticketKinds, ticketModules, ticketPriorities, ticketStatuses } from '@/lib/feedback-tickets-contract';

export const metadata = { title: 'Feedback' };

const selectStyle = 'h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export default async function PlatformFeedbackPage({ searchParams }: PageProps<'/platform/feedback'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const params = await searchParams;
  const filters = { status: one(params.status), kind: one(params.kind), module: one(params.module), priority: one(params.priority),
    officeId: one(params.officeId), review: one(params.review), page: Number(one(params.page)) || 0 };
  const data = await platformTickets(context.user.id, filters, context.db);
  const query = (page: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== 'page' && value)), page: String(page) })}`;
  return <section className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="page-title">Feedback</h1>
      <Link href="/platform/feedback/historico" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 md:min-h-0">Histórico A/B</Link></header>
    <p className="mt-2 text-sm text-muted-foreground">{ticketStatuses.map(status => `${statusLabels[status]}: ${data.counts[status]}`).join(' · ')}</p>
    <form className="mt-6 grid gap-3 border-b pb-5 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filtrar tickets">
      <select name="status" aria-label="Situação" defaultValue={filters.status} className={selectStyle}><option value="">Abertos</option>{ticketStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}<option value="all">Todos</option></select>
      <select name="kind" aria-label="Tipo" defaultValue={filters.kind} className={selectStyle}><option value="">Todos os tipos</option>{ticketKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select>
      <select name="module" aria-label="Módulo" defaultValue={filters.module} className={selectStyle}><option value="">Todos os módulos</option>{ticketModules.map(value => <option key={value} value={value}>{moduleLabels[value]}</option>)}</select>
      <select name="priority" aria-label="Prioridade" defaultValue={filters.priority} className={selectStyle}><option value="">Todas as prioridades</option>{ticketPriorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select>
      <select name="officeId" aria-label="Escritório" defaultValue={filters.officeId} className={selectStyle}><option value="">Todos os escritórios</option>{data.offices.map(office => <option key={office.id} value={office.id}>{office.name}</option>)}</select>
      <div className="flex items-center gap-3"><label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9"><input type="checkbox" name="review" value="1" defaultChecked={filters.review === '1'} className="size-4 accent-primary" />A revisar</label>
        <button type="submit" className="ml-auto inline-flex h-11 items-center rounded-md border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 md:h-9">Filtrar</button></div>
    </form>
    {data.tickets.length === 0 ? <p className="py-12 text-sm text-muted-foreground">Nenhum ticket com esses filtros.</p> : <>
      <div className="hidden grid-cols-[4.5rem_7rem_minmax(0,1fr)_7rem_9rem_6rem] gap-4 border-b py-3 text-[13px] text-muted-foreground md:grid" aria-hidden="true">
        <span>Número</span><span>Prioridade</span><span>Relato</span><span>Tipo</span><span>Módulo</span><span>Situação</span></div>
      <div className="divide-y border-b">{data.tickets.map(ticket => <Link key={ticket.id} href={`/platform/feedback/${ticket.id}`}
        className="grid gap-1 py-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[4.5rem_7rem_minmax(0,1fr)_7rem_9rem_6rem] md:gap-4">
        <span className="text-sm tabular-nums text-muted-foreground">#{ticket.number}</span>
        <span className={`text-sm ${ticket.priority === 'p0' ? 'font-medium' : ''}`}>{priorityLabels[ticket.priority]}</span>
        <span className="min-w-0"><span className="line-clamp-2 break-words text-sm">{ticket.excerpt}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{[ticket.officeName, ticket.userName ?? 'Usuário removido', dateFormat.format(new Date(ticket.createdAt)),
            ticket.securityFlag && 'Possível incidente de segurança', ticket.personalDataFlag && 'Contém dados pessoais',
            ticket.classificationStatus === 'pending' || ticket.classificationStatus === 'running' ? 'Classificando' : ticket.needsReview && 'Revisar classificação'].filter(Boolean).join(' · ')}</span></span>
        <span className="text-sm">{ticket.kind ? kindLabels[ticket.kind] : '—'}</span>
        <span className="text-sm">{ticket.module ? moduleLabels[ticket.module] : '—'}</span>
        <span className="text-sm">{statusLabels[ticket.status]}</span>
      </Link>)}</div>
      {data.total > 50 && <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-2 text-sm">
        {data.page > 0 ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={query(data.page - 1)}>Anterior</Link> : <span />}
        <span className="text-xs text-muted-foreground">{data.page * 50 + 1}–{Math.min((data.page + 1) * 50, data.total)} de {data.total}</span>
        {(data.page + 1) * 50 < data.total ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={query(data.page + 1)}>Próxima</Link> : <span />}
      </nav>}
    </>}
  </section>;
}
