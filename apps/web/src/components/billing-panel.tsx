'use client';

import { useState } from 'react';
import { ArrowUpRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { DataTable, Kpi, KpiRow, type DataColumn } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import type { BillingCheckoutRow } from '@/lib/billing/office-billing';
import type { CreditOverview } from '@/lib/billing/credits';
import { CreditsSection } from '@/components/credits-section';

type Overview = { configured: boolean; price: number; paidUntil: string | null; active: boolean; checkouts: BillingCheckoutRow[] };

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const longDay = (value: string) => new Date(value).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const shortDay = (value: string) => new Date(value).toLocaleDateString('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
const statuses: Record<BillingCheckoutRow['status'], string> = {
  PENDING: 'Aguardando pagamento', PAID: 'Pago', EXPIRED: 'Expirado', CANCELLED: 'Cancelado', REFUNDED: 'Reembolsado',
};

const paymentColumns: DataColumn<BillingCheckoutRow>[] = [
  { header: 'Data', width: '96px', mono: true, cell: checkout => shortDay(checkout.paidAt ?? checkout.createdAt) },
  { header: 'Situação', width: 'minmax(0, 1fr)', cell: checkout => statuses[checkout.status],
    sub: checkout => checkout.kind === 'CREDITS' ? `${checkout.credits?.toLocaleString('pt-BR')} créditos`
      : checkout.status === 'PAID' && checkout.periodEnd ? `Até ${shortDay(checkout.periodEnd)}` : null },
  { header: 'Valor', width: '120px', align: 'end', mono: true, cell: checkout => money(checkout.amount) },
  { header: 'Ações', width: '120px', align: 'end', interactive: true, cell: checkout =>
    checkout.status === 'PAID' && checkout.receiptUrl ? <RowLink href={checkout.receiptUrl}>Comprovante</RowLink>
      : checkout.status === 'PENDING' ? <RowLink href={checkout.url}>Continuar</RowLink> : null },
];

/** Plano: the office's plan in one line of tiles, the one action that pays for a month, the credits and the payments. */
export function BillingPanel({ overview, credits, exempt = false, returned, hasSubscription = false }: { overview: Overview; credits: CreditOverview; exempt?: boolean; returned: boolean; hasSubscription?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { configured, price, paidUntil, active, checkouts } = overview;
  const latestStatus = checkouts[0]?.status;

  async function pay() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.url !== 'string') throw new Error(body.error ?? 'Não foi possível abrir o pagamento.');
      window.location.assign(body.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o pagamento.');
      setPending(false);
    }
  }

  return (
    <CanvasPage className="md:gap-10">
      <CanvasMeta title="Plano" subject={{ kind: 'module', slug: 'billing', title: 'Plano' }} />
      <div className="flex flex-col gap-4 md:gap-6">
        <CanvasHeader eyebrow={active && paidUntil ? `Plano Lume ativo até ${longDay(paidUntil)}` : paidUntil ? `Plano Lume vencido em ${longDay(paidUntil)}` : 'Plano Lume ainda não contratado'} title="Plano" actions={configured &&
          <Button size="lg" className="h-11 md:h-[34px]" disabled={pending} onClick={() => void pay()}>
            {pending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {pending ? 'Abrindo pagamento…' : active ? 'Adicionar um mês' : 'Pagar um mês'}
          </Button>} />
        {returned && (
          <p role="status" className="text-[13.5px]">
            {latestStatus === 'PAID' ? 'Pagamento confirmado. Obrigado!' : latestStatus === 'PENDING'
              ? 'Aguardando a confirmação do pagamento. Atualize a página para conferir o novo prazo e os créditos.'
              : 'Nenhum novo pagamento confirmado. Confira a situação nos pagamentos abaixo.'}
          </p>
        )}
        <section aria-label="Situação do plano" className="flex flex-col gap-3">
          <KpiRow>
            <Kpi label={active ? 'Ativo até' : paidUntil ? 'Venceu em' : 'Prazo'} value={paidUntil ? shortDay(paidUntil) : '—'} />
            <Kpi label="Mensalidade por escritório" value={money(price)} />
          </KpiRow>
          <p className="text-[13.5px] text-muted-foreground">Cada pagamento soma um mês ao prazo e {credits.planMonthlyCredits.toLocaleString('pt-BR')} créditos ao saldo. PIX ou cartão, na página segura da AbacatePay.</p>
          {hasSubscription && <p className="text-[13.5px]">Assinatura mensal ativa, com renovação automática. Para gerenciar ou cancelar, fale com a administração do Lume. Um pagamento avulso adiciona um mês além da assinatura.</p>}
          {!configured && <p className="text-[13.5px] text-muted-foreground">Os pagamentos ainda não foram configurados neste ambiente.</p>}
          {error && <p role="alert" className="flex items-center gap-2 text-[13.5px] text-destructive"><CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />{error}</p>}
        </section>
      </div>

      <CreditsSection credits={credits} configured={configured} exempt={exempt} />

      <CanvasSection title="Pagamentos" label="Pagamentos">
        <DataTable label="Pagamentos" columns={paymentColumns} rows={checkouts} rowKey={checkout => checkout.id}
          tall={checkouts.some(checkout => checkout.kind === 'CREDITS' || (checkout.status === 'PAID' && checkout.periodEnd))} empty="Nenhum pagamento ainda." />
      </CanvasSection>
    </CanvasPage>
  );
}

function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-sm text-[13px] text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0">
      {children}<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">, abre em nova aba</span>
    </a>
  );
}
