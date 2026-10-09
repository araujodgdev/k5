import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformTickets } from '@/lib/feedback-tickets';
import {
  kindLabels, moduleLabels, priorityLabels, statusLabels, ticketKinds, ticketModules, ticketPriorities, ticketStatuses, type TicketPriority,
} from '@/lib/feedback-tickets-contract';
import { DataTable, Kpi, KpiRow, Pill } from '@/components/canvas/canvas-controls';
import { Button } from '@/components/ui/button';
import { AdminBar, AdminBlock, AdminGrid, AdminPages, adminButton } from '@/components/admin/admin-blocks';
import { AdminFilterChip, AdminFilterMenu } from '@/components/admin/admin-filters';
import { adminHref } from '@/components/admin/admin-href';
import { AdminMeta } from '@/components/admin/admin-meta';

export const metadata = { title: 'Feedback · Administração' };

const PAGE_SIZE = 50;
const urgent: ReadonlySet<TicketPriority> = new Set(['p0', 'p1']);
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
const count = (value: number) => value.toLocaleString('pt-BR');

type Choice = { value: string; label: string };
const choices = <T extends string>(values: readonly T[], labels: Record<T, string>): Choice[] => values.map(value => ({ value, label: labels[value] }));

async function PlatformFeedbackPage({ searchParams }: PageProps<'/app/admin/feedback'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const params = await searchParams;
  const filters = { status: one(params.status), kind: one(params.kind), module: one(params.module), priority: one(params.priority),
    officeId: one(params.officeId), review: one(params.review), page: Number(one(params.page)) || 0 };
  const data = await platformTickets(context.user.id, filters, context.db);
  const href = (patch: Record<string, string | number | undefined>) => adminHref('/app/admin/feedback', { ...filters, page: undefined, ...patch });
  /** A filter's chip: its name alone while it lets everything through, "Name: choice" once it narrows the list. */
  const menu = (key: 'status' | 'kind' | 'module' | 'priority' | 'officeId', name: string, options: Choice[], everything = '') => {
    const current = options.find(option => option.value === filters[key]) ?? options[0];
    return <AdminFilterMenu key={key} label={current.value === '' && everything === '' ? name : `${name}: ${current.label}`} active={current.value !== everything}
      options={options.map(option => ({ label: option.label, href: href({ [key]: option.value }), selected: option === current }))} />;
  };
  const pages = Math.ceil(data.total / PAGE_SIZE);
  return <>
    <AdminMeta title="Feedback" />
    <AdminGrid>
      <AdminBlock label="Tickets por situação">
        <KpiRow>{ticketStatuses.map(status => <Kpi key={status} size="small" label={statusLabels[status]} value={count(data.counts[status])} />)}</KpiRow>
      </AdminBlock>
      <AdminBlock label="Tickets">
        <AdminBar label="Filtrar tickets" actions={<Button asChild variant="outline" className={adminButton}><Link href="/app/admin/feedback/historico">Histórico A/B</Link></Button>}>
          {menu('status', 'Situação', [{ value: '', label: 'Abertos' }, ...choices(ticketStatuses, statusLabels), { value: 'all', label: 'Todos' }], 'all')}
          {menu('kind', 'Tipo', [{ value: '', label: 'Todos os tipos' }, ...choices(ticketKinds, kindLabels)])}
          {menu('module', 'Módulo', [{ value: '', label: 'Todos os módulos' }, ...choices(ticketModules, moduleLabels)])}
          {menu('priority', 'Prioridade', [{ value: '', label: 'Todas as prioridades' }, ...choices(ticketPriorities, priorityLabels)])}
          {menu('officeId', 'Escritório', [{ value: '', label: 'Todos os escritórios' }, ...data.offices.map(office => ({ value: office.id, label: office.name }))])}
          <AdminFilterChip pressed={filters.review === '1'} href={href({ review: filters.review === '1' ? '' : '1' })}>A revisar</AdminFilterChip>
        </AdminBar>
        <DataTable label="Tickets de feedback" tall rows={data.tickets} rowKey={ticket => ticket.id} rowHref={ticket => `/app/admin/feedback/${ticket.id}`}
          empty={Object.entries(filters).some(([key, value]) => key !== 'page' && value) ? 'Nenhum ticket com esses filtros.' : 'Nenhum ticket aberto.'} columns={[
          { header: 'Número', width: '44px', mono: true, cell: ticket => `#${ticket.number}` },
          { header: 'Prioridade', width: '92px', cell: ticket => <Pill tone={urgent.has(ticket.priority) ? 'accent' : 'muted'}>{priorityLabels[ticket.priority]}</Pill> },
          { header: 'Relato', width: 'minmax(0, 1fr)', cell: ticket => ticket.excerpt, sub: ticket => [
            ticket.officeName, ticket.userName ?? 'Usuário removido', dateFormat.format(new Date(ticket.createdAt)),
            ticket.securityFlag && 'Possível incidente de segurança', ticket.personalDataFlag && 'Contém dados pessoais',
            ticket.classificationStatus === 'pending' || ticket.classificationStatus === 'running' ? 'Classificando' : ticket.needsReview && 'Revisar classificação',
          ].filter(Boolean).join(' · ') },
          { header: 'Tipo', width: '72px', cell: ticket => ticket.kind ? kindLabels[ticket.kind] : '—' },
          { header: 'Módulo', width: '132px', cell: ticket => ticket.module ? moduleLabels[ticket.module] : '—' },
          { header: 'Situação', width: '88px', cell: ticket => <Pill>{statusLabels[ticket.status]}</Pill> },
        ]} />
        {pages > 1 && <AdminPages label="Páginas de tickets" page={data.page + 1} pages={pages} summary={`${count(data.total)} tickets`}
          href={page => href({ page: page > 1 ? page - 1 : undefined })} />}
      </AdminBlock>
    </AdminGrid>
  </>;
}

export default officePage('/app/admin/feedback', PlatformFeedbackPage, AdminCanvas);
