'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/reveal';
import type { BillingCheckoutRow } from '@/lib/billing/office-billing';

type Overview = { configured: boolean; price: number; paidUntil: string | null; active: boolean; checkouts: BillingCheckoutRow[] };

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const longDay = (value: string) => new Date(value).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const shortDay = (value: string) => new Date(value).toLocaleDateString('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
const statuses: Record<BillingCheckoutRow['status'], string> = {
  PENDING: 'Aguardando pagamento', PAID: 'Pago', EXPIRED: 'Expirado', CANCELLED: 'Cancelado', REFUNDED: 'Reembolsado',
};

/** The office's plan: its state in one sentence, the one action that pays for a month, and the history. */
export function BillingPanel({ overview, canPay, returned, hasSubscription = false }: { overview: Overview; canPay: boolean; returned: boolean; hasSubscription?: boolean }) {
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
    <Reveal className="w-full max-w-5xl space-y-10 px-5 py-6 md:px-10 md:py-10">
      <h1 className="page-title max-md:sr-only" data-reveal>Plano</h1>

      {returned && (
        <p role="status" className="border-l-2 border-brand pl-3 text-sm" data-reveal>
          {latestStatus === 'PAID' ? 'Pagamento confirmado. Obrigado!' : latestStatus === 'PENDING'
            ? 'Aguardando a confirmação do pagamento. Atualize a página para conferir o novo prazo.'
            : 'Nenhum novo pagamento confirmado. Confira a situação no histórico abaixo.'}
        </p>
      )}

      {/* On a phone the header's line already opens the page, so the cell drops its top rule and
          padding there instead of drawing a second line under an empty strip. */}
      <section aria-labelledby="plan-state" className={`grid gap-6 border-y border-line py-8 md:grid-cols-[1fr_auto] md:items-end ${returned ? '' : 'max-md:border-t-0 max-md:pt-0'}`} data-reveal>
        <div className="space-y-3">
          <p className="label-mono flex items-center gap-2.5 text-muted-foreground"><span className="square-dot" aria-hidden="true" />Plano Lume</p>
          <h2 id="plan-state" className="display text-4xl md:text-5xl">
            {active && paidUntil ? `Ativo até ${longDay(paidUntil)}` : paidUntil ? `Venceu em ${longDay(paidUntil)}` : 'Sem plano ativo'}
          </h2>
          <p className="text-sm text-muted-foreground">{money(price)} por mês, por escritório. Cada pagamento soma um mês ao prazo.</p>
          {hasSubscription && <p className="text-sm">Assinatura mensal ativa, com renovação automática. Para gerenciar ou cancelar, fale com a administração do Lume. Um pagamento avulso adiciona um mês além da assinatura.</p>}
        </div>
        {!configured ? (
          <p className="text-sm text-subtle-foreground">Os pagamentos ainda não foram configurados neste ambiente.</p>
        ) : canPay ? (
          <div className="grid gap-2 md:w-80">
            <Button size="lg" className="h-12 w-full justify-between px-4 text-[15px] md:h-12" disabled={pending} onClick={() => void pay()}>
              {pending ? 'Abrindo pagamento…' : active ? 'Adicionar um mês' : 'Pagar um mês'}
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
            </Button>
            <p className="text-[13px] text-subtle-foreground">PIX ou cartão, na página segura da AbacatePay.</p>
            {error && <p role="alert" className="flex items-center gap-2 text-[13px] text-destructive"><CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />{error}</p>}
          </div>
        ) : (
          <p className="text-sm text-subtle-foreground">Só administradores podem pagar o plano do escritório.</p>
        )}
      </section>

      <section aria-labelledby="payments" className="space-y-4" data-reveal>
        <h2 id="payments" className="label-mono flex items-center gap-2.5 text-muted-foreground"><span className="square-dot" aria-hidden="true" />Pagamentos</h2>
        {checkouts.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-normal">Data</th>
                <th scope="col" className="py-2 pr-4 font-normal">Valor</th>
                <th scope="col" className="py-2 pr-4 font-normal">Situação</th>
                <th scope="col" className="py-2 font-normal"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {checkouts.map((checkout) => (
                <tr key={checkout.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 whitespace-nowrap">{shortDay(checkout.paidAt ?? checkout.createdAt)}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{money(checkout.amount)}</td>
                  <td className="py-3 pr-4">
                    {statuses[checkout.status]}
                    {checkout.status === 'PAID' && checkout.periodEnd && <span className="block text-[13px] text-muted-foreground">Até {shortDay(checkout.periodEnd)}</span>}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {checkout.status === 'PAID' && checkout.receiptUrl && <RowLink href={checkout.receiptUrl}>Comprovante</RowLink>}
                    {checkout.status === 'PENDING' && canPay && <RowLink href={checkout.url}>Continuar</RowLink>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-2 text-sm text-subtle-foreground">Nenhum pagamento ainda.</p>
        )}
      </section>
    </Reveal>
  );
}

function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1 text-brand-ink underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}<ArrowUpRight className="size-3.5 transition-transform duration-300 ease-(--ease) group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
    </a>
  );
}
