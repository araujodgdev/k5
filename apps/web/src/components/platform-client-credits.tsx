'use client';

import { useRouter } from '@/components/lume/canvas-navigation';
import { useId, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { formatCredits, MILLI } from '@/lib/billing/credit-pricing';
import type { CreditEntryRow, CreditOverview } from '@/lib/billing/credits';
import { creditEntryLabel } from './credits-section';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DataTable, Field } from './canvas/canvas-controls';
import { AdminBlock, AdminBlockHead, AdminFact, AdminFacts, AdminFields, adminButton, adminInput } from './admin/admin-blocks';

const day = (value: string) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const signed = (millicredits: number) => Math.abs(millicredits) < MILLI / 10 ? '< 0,1'
  : `${millicredits > 0 ? '+' : '−'}${formatCredits(Math.abs(millicredits))}`;
/** An administrator's grant reads as its reason; the other entries as their kind or task. */
const reason = (entry: CreditEntryRow) => entry.kind === 'admin_grant' && entry.description ? entry.description : creditEntryLabel(entry);

/** A client's credits for the platform administrator: the balance, a manual grant and the latest entries. */
export function PlatformClientCredits({ officeId, credits }: { officeId: string; credits: CreditOverview }) {
  const router = useRouter();
  const id = useId();
  const [amount, setAmount] = useState('');
  const [motive, setMotive] = useState('');
  // One id per intended grant: a retried submission after a lost response adds nothing twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; motive?: string; form?: string }>({});
  const [message, setMessage] = useState('');

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    const next = {
      amount: Number.isInteger(value) && value >= 1 && value <= 100_000 ? undefined : 'Informe de 1 a 100.000 créditos.',
      motive: motive.trim() ? undefined : 'Informe o motivo.',
    };
    setErrors(next);
    setMessage('');
    if (next.amount || next.motive) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/platform/offices/${officeId}/credits`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credits: value, reason: motive.trim(), requestId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível adicionar os créditos.');
      setMessage(`${value.toLocaleString('pt-BR')} créditos adicionados.`);
      setAmount(''); setMotive(''); setRequestId(crypto.randomUUID());
      router.refresh();
    } catch (failure) {
      setErrors({ form: failure instanceof Error ? failure.message : 'Não foi possível adicionar os créditos.' });
    } finally { setBusy(false); }
  }

  return (
    <AdminBlock card labelledBy={`${id}-title`}>
      <AdminBlockHead id={`${id}-title`} level={3} title="Créditos" />
      <AdminFacts>
        <AdminFact label="Saldo" mono>{formatCredits(credits.balance)} créditos</AdminFact>
        <AdminFact label="Usados neste mês" mono>{formatCredits(credits.usedThisMonth)}</AdminFact>
      </AdminFacts>
      <form noValidate onSubmit={event => void grant(event)} className="flex flex-col gap-2">
        <AdminFields>
          <Field label="Créditos" htmlFor={`${id}-amount`} className="min-w-[140px] flex-[1_1_0]">
            <Input id={`${id}-amount`} className={adminInput} inputMode="numeric" placeholder="1 a 100.000" value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))}
              aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? `${id}-amount-error` : undefined} />
          </Field>
          <Field label="Motivo" htmlFor={`${id}-reason`} className="min-w-[140px] flex-[3_1_0]">
            <Input id={`${id}-reason`} className={adminInput} maxLength={200} placeholder="Por que estes créditos" value={motive} onChange={event => setMotive(event.target.value)}
              aria-invalid={Boolean(errors.motive)} aria-describedby={errors.motive ? `${id}-reason-error` : undefined} />
          </Field>
          <Button type="submit" disabled={busy} className={adminButton}>{busy ? 'Aguarde…' : 'Adicionar créditos'}</Button>
        </AdminFields>
        {errors.amount && <p id={`${id}-amount-error`} className="text-xs text-destructive">{errors.amount}</p>}
        {errors.motive && <p id={`${id}-reason-error`} className="text-xs text-destructive">{errors.motive}</p>}
        {message && <p role="status" className="text-[12.5px] text-muted-foreground">{message}</p>}
        {errors.form && <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{errors.form}</p>}
      </form>
      <DataTable label="Últimas movimentações de créditos" rows={credits.entries} rowKey={entry => entry.id} empty="Nenhuma movimentação ainda." columns={[
        { header: 'Quando', width: '64px', mono: true, cell: entry => day(entry.createdAt) },
        { header: 'Créditos', width: '72px', align: 'end', mono: true, cell: entry => signed(entry.amount) },
        { header: 'Motivo', width: 'minmax(0, 1fr)', cell: reason },
        { header: 'Quem', width: '190px', cell: entry => entry.actorName ?? <span className="text-muted-foreground">Automático</span> },
      ]} />
    </AdminBlock>
  );
}
