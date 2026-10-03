'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { formatCredits } from '@/lib/billing/credit-pricing';
import type { CreditOverview } from '@/lib/billing/credits';
import { CreditEntries } from './credits-section';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** A client's credits for the platform administrator: the balance, a manual grant and the latest entries. */
export function PlatformClientCredits({ officeId, credits }: { officeId: string; credits: CreditOverview }) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // One id per intended grant: a retried submission after a lost response adds nothing twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; form?: string }>({});
  const [message, setMessage] = useState('');

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    const next = {
      amount: Number.isInteger(value) && value >= 1 && value <= 100_000 ? undefined : 'Informe de 1 a 100.000 créditos.',
      reason: reason.trim() ? undefined : 'Informe o motivo.',
    };
    setErrors(next);
    setMessage('');
    if (next.amount || next.reason) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/platform/offices/${officeId}/credits`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credits: value, reason: reason.trim(), requestId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível adicionar os créditos.');
      setMessage(`${value.toLocaleString('pt-BR')} créditos adicionados.`);
      setAmount(''); setReason(''); setRequestId(crypto.randomUUID());
      router.refresh();
    } catch (failure) {
      setErrors({ form: failure instanceof Error ? failure.message : 'Não foi possível adicionar os créditos.' });
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="client-credits" className="space-y-4">
      <h3 id="client-credits" className="label-mono">Créditos</h3>
      <p className="text-xl"><span className="tabular-nums">{formatCredits(credits.balance)}</span> créditos <span className="text-sm text-muted-foreground">· usados neste mês: <span className="tabular-nums">{formatCredits(credits.usedThisMonth)}</span></span></p>
      <form noValidate onSubmit={event => void grant(event)} className="grid gap-4 md:grid-cols-[10rem_1fr_auto] md:items-start">
        <label className="grid gap-1.5 text-sm">Créditos
          <Input className="h-11" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'credit-amount-error' : undefined} />
          {errors.amount && <span id="credit-amount-error" className="text-xs text-destructive">{errors.amount}</span>}
        </label>
        <label className="grid gap-1.5 text-sm">Motivo
          <Input className="h-11" maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: cortesia de lançamento" aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'credit-reason-error' : undefined} />
          {errors.reason && <span id="credit-reason-error" className="text-xs text-destructive">{errors.reason}</span>}
        </label>
        <Button type="submit" disabled={busy} className="h-11 md:mt-[1.375rem]">{busy ? 'Aguarde…' : 'Adicionar créditos'}</Button>
      </form>
      {message && <p role="status" className="border-l-2 border-brand pl-3 text-sm">{message}</p>}
      {errors.form && <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />{errors.form}</p>}
      <CreditEntries entries={credits.entries} showActor />
    </section>
  );
}
