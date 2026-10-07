import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FinancePayment } from '@/lib/billing/platform-billing';
import { DataTable, Pill, type DataColumn } from './canvas/canvas-controls';
import { adminLink, adminQuietAction } from './admin/admin-blocks';

export const formatMoney = (value: number) => (value/100).toLocaleString('pt-BR',{ style: 'currency', currency: 'BRL' });
export const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR',{ dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
export const paymentStatuses = { PENDING: 'Aguardando pagamento', PAID: 'Pago', REFUNDED: 'Reembolsado', EXPIRED: 'Expirado', CANCELLED: 'Cancelado' };
/** The same statuses, short enough for a pill. */
const paymentPills: Record<FinancePayment['status'], string> = { PENDING: 'Aguardando', PAID: 'Pago', REFUNDED: 'Reembolsado', EXPIRED: 'Expirado', CANCELLED: 'Cancelado' };
export const PAYMENTS_PER_PAGE = 25;

const kindLabel = (payment: FinancePayment) =>
  `${payment.kind === 'SUBSCRIPTION' ? 'Assinatura mensal' : payment.kind === 'CREDITS' ? `Pacote de ${payment.credits} créditos` : 'Um mês avulso'}${payment.devMode ? ' · Teste' : ''}`;
const refundPending = (payment: FinancePayment) => Boolean(payment.actionStatus && payment.actionStatus !== 'SUCCEEDED');

/**
 * Payments as the prototype's table. With `showClient` (Financeiro) the office leads the row;
 * on a client's page the date does, and `actions` adds the row's own buttons beside the receipt.
 */
export function PlatformPayments({ payments, showClient = false, actions }: { payments: FinancePayment[]; showClient?: boolean; actions?: (payment: FinancePayment) => ReactNode }) {
  const kind: DataColumn<FinancePayment> = { header: 'Tipo', width: showClient ? '140px' : 'minmax(0, 1fr)', cell: kindLabel,
    sub: payments.some(refundPending) ? payment => refundPending(payment) ? 'Reembolso em confirmação' : undefined : undefined };
  const date: DataColumn<FinancePayment> = { header: 'Data', width: '96px', mono: true, cell: payment => formatDate(payment.paidAt ?? payment.createdAt) };
  const columns: DataColumn<FinancePayment>[] = [
    ...(showClient
      ? [{ header: 'Escritório', width: 'minmax(0, 1fr)', cell: (payment: FinancePayment) => <Link className={adminLink} href={`/app/admin/clients/${payment.officeId}`}>{payment.officeName}</Link> }, kind, date]
      : [date, kind]),
    { header: 'Valor', width: showClient ? '96px' : '100px', align: 'end', mono: true, cell: payment => formatMoney(payment.amount) },
    { header: 'Situação', width: '108px', cell: payment => <Pill tone={payment.status === 'PENDING' ? 'accent' : 'muted'}>{paymentPills[payment.status]}</Pill> },
    { header: '', width: actions ? '176px' : '96px', align: 'end', cell: payment => (
      <span className="inline-flex flex-wrap justify-end gap-x-3">
        {payment.receiptUrl && <a className={adminQuietAction} href={payment.receiptUrl} target="_blank" rel="noreferrer">Comprovante</a>}
        {actions?.(payment)}
      </span>
    ) },
  ];
  return <DataTable label="Cobranças" rows={payments} rowKey={payment => payment.id} columns={columns} empty="Nenhuma cobrança encontrada." />;
}
