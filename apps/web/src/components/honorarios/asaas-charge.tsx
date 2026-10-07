'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { asaasChargeDto, asaasPaymentLabel, type AsaasCharge, type AsaasPayment } from '@/lib/asaas/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Failure, Field } from './fields';
import { money } from './editor';

type Operation = 'get' | 'create' | 'cancel' | 'confirm';
const dateLabel = (value: string) => value.split('-').reverse().join('/');

async function asaasCall(operation: Operation, data: Record<string, unknown>, signal?: AbortSignal): Promise<AsaasCharge> {
  const response = await fetch('/api/asaas/charges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, data }), signal, cache: 'no-store' });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(body);
    throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente para continuar.' : failure.success ? failure.data.error : 'Não foi possível concluir. Tente novamente.');
  }
  const result = asaasChargeDto.safeParse(body);
  if (!result.success) throw new Error('Não foi possível conferir a resposta. Tente novamente.');
  return result.data;
}

/** The installment's charge in the office's Asaas account: issue, follow, confirm a lost answer, cancel. */
export function AsaasChargeSection({ installmentId, busy, changed }: { installmentId: string; busy: (value: boolean) => void; changed: () => void }) {
  const [charge, setCharge] = useState<AsaasCharge | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [revision, setRevision] = useState(0);
  const running = useRef(false);
  const attempt = useRef<{ input: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void asaasCall('get', { installmentId }, controller.signal).then(value => {
      setCharge(value); setDueOn(current => current || value.suggestedDueOn); setError('');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a cobrança do Asaas.'); });
    return () => controller.abort();
  }, [installmentId, revision]);
  useEffect(() => { busy(pending); return () => busy(false); }, [busy, pending]);

  async function perform(action: () => Promise<string>) {
    if (running.current) return;
    running.current = true; setPending(true); setError(''); setNotice('');
    try { setNotice(await action()); changed(); }
    catch (cause) {
      setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível falar com o Lume. Tente novamente.');
      setRevision(value => value + 1);
    } finally { running.current = false; setPending(false); }
  }
  function create() {
    return perform(async () => {
      const input = { installmentId, dueOn, document: charge?.needsDocument ? taxId : null };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.input !== fingerprint) attempt.current = { input: fingerprint, key: crypto.randomUUID() };
      const next = await asaasCall('create', { ...input, idempotencyKey: attempt.current.key });
      setCharge(next); setTaxId('');
      return next.active?.state === 'open' ? 'Cobrança emitida no Asaas. Envie o link ao cliente.' : 'O Asaas ainda não confirmou a cobrança.';
    });
  }
  function act(operation: 'cancel' | 'confirm', payment: AsaasPayment) {
    return perform(async () => {
      const next = await asaasCall(operation, { installmentId, paymentId: payment.id });
      setCharge(next); setConfirmCancel(false);
      if (operation === 'cancel') return 'Cobrança cancelada no Asaas.';
      return next.active?.state === 'open' ? 'Cobrança confirmada no Asaas.' : 'O Asaas não registrou a cobrança. Emita uma nova, se quiser.';
    });
  }

  const active = charge?.active;
  const past = charge?.history.filter(payment => payment.id !== active?.id) ?? [];
  return <section aria-labelledby={`asaas-${installmentId}`} className="grid min-w-0 gap-3 border-y border-border py-4">
    <h3 id={`asaas-${installmentId}`} className="text-[15px] font-semibold">Cobrança pelo Asaas</h3>
    {!charge ? <>{error ? <><Failure message={error} /><Button variant="outline" size="lg" className="max-md:h-11 justify-self-start" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></> : <p role="status" className="text-[13.5px] text-muted-foreground">Carregando cobrança do Asaas…</p>}</>
      : !charge.connection ? <p className="text-[13.5px] text-muted-foreground">Para emitir PIX, boleto ou cartão pelo Lume, <Link className="underline underline-offset-4" href="/app/integrations">conecte a conta do Asaas em Integrações</Link>.</p>
      : <>
        {charge.connection.environment === 'sandbox' && <p className="text-[13.5px] text-muted-foreground">Conta de sandbox: as cobranças são de teste e não movimentam dinheiro.</p>}
        {active ? <>
          <dl className="grid gap-1 text-[13.5px] sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground">Situação</dt><dd>{asaasPaymentLabel(active)}</dd>
            <dt className="text-muted-foreground">Valor</dt><dd className="font-mono text-[12.5px]">{money(active.amountCents)}</dd>
            <dt className="text-muted-foreground">Vencimento</dt><dd>{dateLabel(active.dueOn)}</dd>
          </dl>
          {active.state === 'open' && active.invoiceUrl && <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="lg" className="max-md:h-11"><a href={active.invoiceUrl} target="_blank" rel="noopener noreferrer">Abrir fatura no Asaas</a></Button>
            <Button variant="outline" size="lg" className="max-md:h-11" disabled={pending} onClick={() => void perform(async () => { await navigator.clipboard.writeText(active.invoiceUrl ?? ''); return 'Link de pagamento copiado.'; })}>Copiar link de pagamento</Button>
            <Button variant="ghost" size="lg" className="max-md:h-11" disabled={pending} aria-expanded={confirmCancel} onClick={() => setConfirmCancel(value => !value)}>Cancelar cobrança</Button>
          </div>}
          {active.state === 'open' && confirmCancel && <div className="grid gap-3 border-t border-border pt-3">
            <p className="text-[13.5px]">A cobrança será removida do Asaas e o link deixará de aceitar pagamentos.</p>
            <div className="flex flex-wrap gap-2"><Button size="lg" className="max-md:h-11" variant="destructive" disabled={pending} onClick={() => void act('cancel', active)}>{pending ? 'Cancelando…' : 'Confirmar cancelamento'}</Button>
              <Button size="lg" className="max-md:h-11" variant="ghost" disabled={pending} onClick={() => setConfirmCancel(false)}>Manter cobrança</Button></div>
          </div>}
          {active.state === 'creating' && (active.unconfirmed
            ? <><p className="text-[13.5px]">O Asaas não respondeu quando a cobrança foi enviada. Confira antes de emitir outra.</p><Button size="lg" className="max-md:h-11 justify-self-start" disabled={pending} onClick={() => void act('confirm', active)}>{pending ? 'Conferindo…' : 'Conferir no Asaas'}</Button></>
            : <Button variant="outline" size="lg" className="max-md:h-11 justify-self-start" disabled={pending} onClick={() => setRevision(value => value + 1)}>Atualizar situação</Button>)}
        </> : charge.chargeable ? <form className="grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void create(); }}>
          <fieldset disabled={pending} className="grid min-w-0 gap-3">
            <p className="text-[13.5px] text-muted-foreground">O Asaas gera um link em que o cliente paga {money(charge.pendingCents)} com PIX, boleto ou cartão. As tarifas seguem o plano da sua conta no Asaas.</p>
            <Field label="Vencimento">{id => <Input id={id} type="date" className="max-md:h-11" min={charge.today} required value={dueOn} onChange={event => setDueOn(event.target.value)} />}</Field>
            {charge.needsDocument && <Field label="CPF ou CNPJ do cliente">{id => <Input id={id} className="max-md:h-11" inputMode="numeric" autoComplete="off" maxLength={18} required value={taxId} onChange={event => setTaxId(event.target.value)} />}</Field>}
            {charge.needsDocument && <p className="-mt-2 text-xs text-muted-foreground">Usado só para cadastrar o cliente no Asaas. O Lume não guarda o número.</p>}
            <Button type="submit" size="lg" className="max-md:h-11 justify-self-start">{pending ? 'Emitindo…' : 'Emitir cobrança no Asaas'}</Button>
          </fieldset>
        </form> : <p className="text-[13.5px] text-muted-foreground">Esta parcela foi quitada ou cancelada.</p>}
        {past.length > 0 && <div className="grid gap-1"><h4 className="text-xs text-muted-foreground">Cobranças anteriores no Asaas</h4>
          <div>{past.map(payment => <p key={payment.id} className="py-2 text-[13.5px]">{asaasPaymentLabel(payment)} · {money(payment.amountCents)} · vencimento {dateLabel(payment.dueOn)}{payment.failure && ` — ${payment.failure}`}</p>)}</div></div>}
        <Failure message={error} />{notice && <p role="status" className="text-[13.5px] text-muted-foreground">{notice}</p>}
      </>}
  </section>;
}
