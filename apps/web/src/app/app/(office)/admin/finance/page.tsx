import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformFinance, type FinanceFilters } from '@/lib/billing/platform-billing';
import { PlatformPayments, PaymentPagination, formatMoney, paymentStatuses } from '@/components/platform-payments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const metadata = { title: 'Financeiro · Administração' };
const selectStyle = 'h-11 w-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9';

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  if (!await requirePlatformPage()) notFound();
  const search = await searchParams;
  const filters: FinanceFilters = { sandbox: search.environment === 'sandbox', days: search.days === '0' ? 0 : search.days === '90' ? 90 : 30,
    status: typeof search.status === 'string' && Object.hasOwn(paymentStatuses,search.status) ? search.status : '', query: typeof search.q === 'string' ? search.q.slice(0,120) : '', page: Math.max(1,Math.min(10000,Number(search.page)||1)) };
  filters.page = Math.floor(filters.page);
  const data = await platformFinance(filters);
  function href(page: number) { return `/app/admin/finance?${new URLSearchParams({ environment: filters.sandbox ? 'sandbox' : 'production', days: String(filters.days),status: filters.status,q: filters.query,page: String(page) })}`; }
  return <section className="space-y-6">
    <div><h2 className="text-2xl tracking-tight">Financeiro</h2><p className="mt-2 text-sm text-muted-foreground">Cobranças dos clientes do Lume. {filters.sandbox ? 'Exibindo pagamentos de teste, sem movimentação real.' : 'Exibindo pagamentos reais.'}</p></div>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_9rem_12rem_auto] lg:items-end">
      <label className="grid gap-1.5 text-xs">Cliente<Input name="q" defaultValue={filters.query} placeholder="Buscar escritório" className="h-11 md:h-9" /></label>
      <label className="grid gap-1.5 text-xs">Ambiente<select className={selectStyle} name="environment" defaultValue={filters.sandbox ? 'sandbox' : 'production'}><option value="production">Produção</option><option value="sandbox">Teste</option></select></label>
      <label className="grid gap-1.5 text-xs">Período<select className={selectStyle} name="days" defaultValue={filters.days}><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="0">Todo o período</option></select></label>
      <label className="grid gap-1.5 text-xs">Situação<select className={selectStyle} name="status" defaultValue={filters.status}><option value="">Todas</option>{Object.entries(paymentStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <Button className="h-11 md:h-9" type="submit">Filtrar</Button>
    </form>
    <div className="grid grid-cols-2 border-y border-line lg:grid-cols-4">{[
      ['Recebido',formatMoney(data.summary.received)],['Reembolsado',formatMoney(data.summary.refunded)],['Após reembolsos',formatMoney(data.summary.received-data.summary.refunded)],['Aguardando pagamento',formatMoney(data.summary.pending)],
    ].map(([label,value])=><div className="py-5 pr-3" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl tabular-nums md:text-2xl">{value}</p></div>)}</div>
    <p className="text-sm text-muted-foreground">{data.recurring.count} assinaturas ativas · {formatMoney(data.recurring.amount)} por mês em recorrência contratada. Valores antes das taxas. Totais consideram período e cliente; a situação filtra a lista.</p>
    <PlatformPayments payments={data.payments} showClient />
    <PaymentPagination page={filters.page} total={data.total} href={href} />
  </section>;
}
