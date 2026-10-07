import { notFound } from 'next/navigation';
import { Info } from 'lucide-react';
import { requirePlatformPage } from '@/lib/platform';
import { listOfficesForPlatform } from '@/lib/ai-connections-core';
import { platformFinance, type FinanceFilters } from '@/lib/billing/platform-billing';
import { PlatformPayments, PAYMENTS_PER_PAGE, formatMoney, paymentStatuses } from '@/components/platform-payments';
import { Kpi, KpiRow } from '@/components/canvas/canvas-controls';
import { AdminBar, AdminBlock, AdminBlockHead, AdminFooter, AdminGrid, AdminNote, AdminPages } from '@/components/admin/admin-blocks';
import { AdminFilterMenu } from '@/components/admin/admin-filters';
import { adminHref } from '@/components/admin/admin-href';

export const metadata = { title: 'Financeiro · Administração' };

const periods = [{ value: 30, label: 'Últimos 30 dias' }, { value: 90, label: 'Últimos 90 dias' }, { value: 0, label: 'Todo o período' }] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/** What the platform charged its clients: totals for the period and client, then the charges themselves. */
export default async function FinancePage({ searchParams }: PageProps<'/app/admin/finance'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const search = await searchParams;
  const status = one(search.status);
  const filters: FinanceFilters = {
    sandbox: one(search.environment) === 'sandbox',
    days: one(search.days) === '0' ? 0 : one(search.days) === '90' ? 90 : 30,
    status: Object.hasOwn(paymentStatuses, status) ? status : '',
    query: one(search.q).slice(0, 120),
    page: Math.floor(Math.max(1, Math.min(10000, Number(one(search.page)) || 1))),
  };
  const [data, offices] = await Promise.all([platformFinance(filters), listOfficesForPlatform(context.db)]);
  const current = { environment: filters.sandbox ? 'sandbox' : undefined, days: filters.days === 30 ? undefined : filters.days, status: filters.status, q: filters.query };
  const href = (patch: Partial<Record<keyof typeof current | 'page', string | number | undefined>>) => adminHref('/app/admin/finance', { ...current, ...patch });
  const period = periods.find(item => item.value === filters.days) ?? periods[0];
  const pages = Math.ceil(data.total / PAYMENTS_PER_PAGE);
  return <>
    <AdminGrid>
      <AdminBlock label="Filtros">
        <AdminBar label="Filtrar cobranças">
          <AdminFilterMenu label={`Cliente: ${filters.query || 'Todos'}`} active={Boolean(filters.query)} options={[
            { label: 'Todos', href: href({ q: undefined }), selected: !filters.query },
            ...offices.map(office => ({ label: office.name, href: href({ q: office.name }), selected: filters.query === office.name })),
          ]} />
          <AdminFilterMenu label={`Ambiente: ${filters.sandbox ? 'Teste' : 'Produção'}`} active options={[
            { label: 'Produção', href: href({ environment: undefined }), selected: !filters.sandbox },
            { label: 'Teste', href: href({ environment: 'sandbox' }), selected: filters.sandbox },
          ]} />
          <AdminFilterMenu label={`Período: ${period.label}`} active options={periods.map(item => (
            { label: item.label, href: href({ days: item.value === 30 ? undefined : item.value }), selected: item === period }
          ))} />
          <AdminFilterMenu label={`Situação: ${filters.status ? paymentStatuses[filters.status as keyof typeof paymentStatuses] : 'Todas'}`} active={Boolean(filters.status)} options={[
            { label: 'Todas', href: href({ status: undefined }), selected: !filters.status },
            ...Object.entries(paymentStatuses).map(([key, label]) => ({ label, href: href({ status: key }), selected: filters.status === key })),
          ]} />
        </AdminBar>
        {filters.sandbox && <AdminNote icon={Info}>Pagamentos de teste, sem movimentação real.</AdminNote>}
      </AdminBlock>
      <AdminBlock label="Totais do período">
        <KpiRow>
          <Kpi label="Recebido" value={formatMoney(data.summary.received)} />
          <Kpi label="Reembolsado" value={formatMoney(data.summary.refunded)} />
          <Kpi label="Após reembolsos" value={formatMoney(data.summary.received - data.summary.refunded)} />
          <Kpi label="Aguardando pagamento" value={formatMoney(data.summary.pending)} />
        </KpiRow>
        <AdminFooter>
          {data.recurring.count} {data.recurring.count === 1 ? 'assinatura ativa' : 'assinaturas ativas'} · {formatMoney(data.recurring.amount)} por mês em recorrência contratada · Valores antes das taxas
        </AdminFooter>
      </AdminBlock>
      <AdminBlock labelledBy="finance-charges">
        <AdminBlockHead id="finance-charges" title="Cobranças" />
        <PlatformPayments payments={data.payments} showClient />
        {pages > 1 && <AdminPages label="Páginas de cobranças" page={filters.page} pages={pages} href={page => href({ page: page > 1 ? page : undefined })} />}
      </AdminBlock>
    </AdminGrid>
  </>;
}
