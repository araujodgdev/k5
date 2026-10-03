'use client';

import { useState } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CREDIT_PACKAGES, formatCredits, MILLI, type CreditPackage } from '@/lib/billing/credit-pricing';
import type { CreditEntryRow, CreditOverview } from '@/lib/billing/credits';

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDay = (value: string) => new Date(value).toLocaleDateString('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
const signed = (millicredits: number) => `${millicredits > 0 ? '+' : millicredits < 0 ? '−' : ''}${formatCredits(Math.abs(millicredits))}`;

/** What each kind of entry reads as when it carries no description of its own. */
const entryKinds: Record<CreditEntryRow['kind'], string> = {
  initial: 'Créditos iniciais', plan: 'Créditos do mês do plano', purchase: 'Compra de créditos', admin_grant: 'Créditos concedidos pela administração',
  usage: 'Uso de IA', ocr: 'Leitura de páginas digitalizadas', refund: 'Estorno',
};

export function creditEntryLabel(entry: CreditEntryRow) {
  return entry.kind === 'admin_grant' ? entryKinds.admin_grant : entry.description || entryKinds[entry.kind];
}

/** The office's credits on the Plano page: the balance, the packages to buy, and the latest entries. */
export function CreditsSection({ credits, configured, exempt }: { credits: CreditOverview; configured: boolean; exempt: boolean }) {
  const [pending, setPending] = useState<CreditPackage | null>(null);
  const [error, setError] = useState('');

  async function buy(amount: CreditPackage) {
    setPending(amount);
    setError('');
    try {
      const response = await fetch('/api/billing/credits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credits: amount }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.url !== 'string') throw new Error(body.error ?? 'Não foi possível abrir o pagamento.');
      window.location.assign(body.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o pagamento.');
      setPending(null);
    }
  }

  const empty = credits.balance <= 0 && !exempt;
  return (
    <section aria-labelledby="credits" className="space-y-6" data-reveal>
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-3">
          <h2 id="credits" className="label-mono flex items-center gap-2.5 text-muted-foreground"><span className="square-dot" aria-hidden="true" />Créditos</h2>
          <p className="display text-4xl md:text-5xl"><span className="tabular-nums">{formatCredits(credits.balance)}</span> créditos</p>
          <p className="text-sm text-muted-foreground">
            O plano inclui {credits.planMonthlyCredits.toLocaleString('pt-BR')} créditos por mês, e o que sobra continua no saldo.
            {' '}Usados neste mês: <span className="tabular-nums">{formatCredits(credits.usedThisMonth)}</span>.
          </p>
          {exempt
            ? <p className="text-sm">Como administrador da plataforma, seu uso não consome créditos.</p>
            : empty && <p role="status" className="text-sm">Os créditos acabaram. A IA e a leitura de documentos digitalizados voltam assim que você comprar mais.</p>}
        </div>
        {configured && (
          <div className="grid gap-2 md:w-80">
            {CREDIT_PACKAGES.map(amount => (
              <Button key={amount} variant="outline" size="lg" className="h-12 w-full justify-between px-4 text-[15px]" disabled={pending !== null} onClick={() => void buy(amount)}>
                <span>{amount.toLocaleString('pt-BR')} créditos</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {pending === amount ? <><span>Abrindo…</span><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /></> : money(amount * credits.creditPriceCents)}
                </span>
              </Button>
            ))}
            <p className="text-[13px] text-subtle-foreground">Créditos comprados não vencem e continuam valendo mesmo sem plano ativo.</p>
            {error && <p role="alert" className="flex items-center gap-2 text-[13px] text-destructive"><CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />{error}</p>}
          </div>
        )}
      </div>
      <CreditEntries entries={credits.entries} />
    </section>
  );
}

export function CreditEntries({ entries, showActor = false }: { entries: CreditEntryRow[]; showActor?: boolean }) {
  if (!entries.length) return <p className="py-2 text-sm text-subtle-foreground">Nenhuma movimentação ainda.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Últimas movimentações de créditos</caption>
      <thead className="text-left text-[13px] text-muted-foreground">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pr-4 font-normal">Data</th>
          <th scope="col" className="py-2 pr-4 font-normal">Movimento</th>
          <th scope="col" className="py-2 text-right font-normal">Créditos</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(entry => (
          <tr key={entry.id} className="border-b border-border align-top">
            <td className="py-3 pr-4 whitespace-nowrap">{shortDay(entry.createdAt)}</td>
            <td className="py-3 pr-4">
              {creditEntryLabel(entry)}
              {entry.kind === 'admin_grant' && entry.description && <span className="block text-[13px] text-muted-foreground">{entry.description}{showActor && entry.actorName ? ` · ${entry.actorName}` : ''}</span>}
            </td>
            <td className="py-3 text-right whitespace-nowrap tabular-nums">
              {Math.abs(entry.amount) < MILLI / 10 ? '< 0,1' : signed(entry.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
