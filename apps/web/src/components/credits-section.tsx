'use client';

import { useState } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { DataTable, Kpi, KpiRow, type DataColumn } from '@/components/canvas/canvas-controls';
import { CanvasSection } from '@/components/canvas/canvas-page';
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
    <CanvasSection title="Créditos" label="Créditos">
      <KpiRow>
        <Kpi label="Saldo" value={<>{formatCredits(credits.balance)} <span className="font-sans text-[13px] tracking-normal text-muted-foreground">créditos</span></>} />
        <Kpi label="Usados neste mês" value={formatCredits(credits.usedThisMonth)} />
        <Kpi label="Incluídos por mês" value={credits.planMonthlyCredits.toLocaleString('pt-BR')} />
      </KpiRow>
      <p className="text-[13.5px] text-muted-foreground">O plano inclui {credits.planMonthlyCredits.toLocaleString('pt-BR')} créditos por mês, e o que sobra continua no saldo.</p>
      {exempt
        ? <p className="text-[13.5px]">Como administrador da plataforma, seu uso não consome créditos.</p>
        : empty && <p role="status" className="text-[13.5px]">Os créditos acabaram. A IA e a leitura de documentos digitalizados voltam assim que você comprar mais.</p>}
      {configured && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Comprar créditos" className="flex flex-wrap gap-2">
            {CREDIT_PACKAGES.map(amount => (
              <Button key={amount} variant="outline" size="lg" className="h-11 gap-2 md:h-[34px]" disabled={pending !== null} onClick={() => void buy(amount)}>
                {amount.toLocaleString('pt-BR')} créditos
                <span className="font-mono text-[12.5px] text-muted-foreground">{pending === amount ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-label="Abrindo pagamento" /> : money(amount * credits.creditPriceCents)}</span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Créditos comprados não vencem e continuam valendo mesmo sem plano ativo.</p>
          {error && <p role="alert" className="flex items-center gap-2 text-[13px] text-destructive"><CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />{error}</p>}
        </div>
      )}
      <CreditEntries entries={credits.entries} />
    </CanvasSection>
  );
}

const entryColumns: DataColumn<CreditEntryRow>[] = [
  { header: 'Data', width: '96px', mono: true, cell: entry => shortDay(entry.createdAt) },
  { header: 'Movimento', width: 'minmax(0, 1fr)', cell: creditEntryLabel,
    sub: entry => entry.kind === 'admin_grant' && entry.description ? entry.description : null },
  { header: 'Créditos', width: '96px', align: 'end', mono: true, cell: entry => Math.abs(entry.amount) < MILLI / 10 ? '< 0,1' : signed(entry.amount) },
];

export function CreditEntries({ entries }: { entries: CreditEntryRow[] }) {
  return <DataTable label="Últimas movimentações de créditos" columns={entryColumns} rows={entries} rowKey={entry => entry.id}
    tall={entries.some(entry => entry.kind === 'admin_grant' && entry.description)} empty="Nenhuma movimentação ainda." />;
}
