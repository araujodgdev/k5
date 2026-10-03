import Link from 'next/link';
import type { FinancePayment } from '@/lib/billing/platform-billing';

export const formatMoney = (value: number) => (value/100).toLocaleString('pt-BR',{ style: 'currency', currency: 'BRL' });
export const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR',{ dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
export const paymentStatuses = { PENDING: 'Aguardando pagamento', PAID: 'Pago', REFUNDED: 'Reembolsado', EXPIRED: 'Expirado', CANCELLED: 'Cancelado' };

export function PlatformPayments({ payments, showClient = false, actions }: { payments: FinancePayment[]; showClient?: boolean; actions?: (payment: FinancePayment) => React.ReactNode }) {
  if (!payments.length) return <p className="py-10 text-sm text-subtle-foreground">Nenhuma cobrança encontrada.</p>;
  return <div className="divide-y border-y border-line">{payments.map(payment => <div key={payment.id} className="grid gap-3 py-4 md:grid-cols-[1fr_9rem_11rem] md:items-start">
    <div className="min-w-0">
      {showClient && <Link className="font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring" href={`/app/admin/clients/${payment.officeId}`}>{payment.officeName}</Link>}
      <p className="text-sm">{payment.kind === 'SUBSCRIPTION' ? 'Assinatura mensal' : payment.kind === 'CREDITS' ? `Pacote de ${payment.credits} créditos` : 'Um mês avulso'}{payment.devMode ? ' · Teste' : ''}</p>
      <p className="mt-1 text-xs text-muted-foreground">{formatDate(payment.paidAt ?? payment.createdAt)} · <span className="break-all">{payment.id}</span></p>
    </div>
    <div className="text-sm md:text-right"><p className="tabular-nums">{formatMoney(payment.amount)}</p><p className="mt-1 text-muted-foreground">{paymentStatuses[payment.status]}</p>{payment.actionStatus && payment.actionStatus !== 'SUCCEEDED' && <p className="mt-1">Reembolso em confirmação</p>}</div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm md:justify-end">
      {payment.receiptUrl && <a className="underline underline-offset-4" href={payment.receiptUrl} target="_blank" rel="noreferrer">Comprovante</a>}
      {actions?.(payment)}
    </div>
  </div>)}</div>;
}

export function PaymentPagination({ page,total,href }: { page: number; total: number; href: (page: number) => string }) {
  return <nav aria-label="Paginação de cobranças" className="flex items-center justify-between gap-4 py-4 text-sm">
    <span className="text-muted-foreground">{total} {total === 1 ? 'cobrança' : 'cobranças'} · Página {page} de {Math.max(1,Math.ceil(total/25))}</span>
    <div className="flex gap-4">{page>1 && <Link className="underline" href={href(page-1)}>Anterior</Link>}{page*25<total && <Link className="underline" href={href(page+1)}>Próxima</Link>}</div>
  </nav>;
}
