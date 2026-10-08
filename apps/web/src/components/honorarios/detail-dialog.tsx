'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { honorarioDetailDto, paymentMethod, receiveHonorarioInput, type HonorarioDetail, type HonorarioInstallment, type HonorarioReceipt } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kpi, KpiRow } from '@/components/canvas/canvas-controls';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { honorariosCall, useHonorarioMutation } from './client';
import { amountInput, dateLabel, money, parseAmount } from './editor';
import { controlClass, dialogClass, Failure, Field } from './fields';
import { ChargeForm } from './charge-form';
import { PricingSummary } from './quote-panel';
import { useCanvasRevision, useCanvasActive } from '../lume/canvas-host';

const methods: Record<HonorarioReceipt['method'], string> = { pix: 'Pix', transfer: 'Transferência', cash: 'Dinheiro', card: 'Cartão', boleto: 'Boleto', other: 'Outro' };
export const installmentStatus: Record<HonorarioInstallment['status'], string> = { pending: 'A receber', partial: 'Recebida em parte', received: 'Recebida', cancelled: 'Cancelada' };
type FinancialAction = { kind: 'receive'; installment: HonorarioInstallment } | { kind: 'reverse'; receipt: HonorarioReceipt } | { kind: 'cancel' };
type Action = FinancialAction | { kind: 'charge'; installment: HonorarioInstallment };

export function DetailHonorarioDialog({ agreementId, today, close, changed }: { agreementId: string; today: string; close: () => void; changed: () => void }) {
  const canvasRevision = useCanvasRevision(), active = useCanvasActive();
  const [detail, setDetail] = useState<HonorarioDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed,setSeed] = useState({canvasRevision,active});
  if (seed.canvasRevision !== canvasRevision || seed.active !== active) { setSeed({canvasRevision,active}); setDetail(null); }
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('get', { agreementId }, honorarioDetailDto, controller.signal).then(value => { if (!controller.signal.aborted) { setDetail(value); setError(''); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o honorário.'); });
    return () => controller.abort();
  }, [agreementId, revision, canvasRevision, active]);
  const agreement = detail?.agreement;
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!busy}>
      <DialogHeader><DialogTitle className="break-words">{agreement?.title ?? 'Honorário'}</DialogTitle><DialogDescription>{agreement ? agreement.status === 'cancelled' ? 'Honorário cancelado. O histórico permanece disponível.' : 'Parcelas e registros manuais de recebimento.' : 'Carregando detalhes…'}</DialogDescription></DialogHeader>
      {error ? <div className="flex flex-wrap items-center gap-3"><Failure message={error} /><Button variant="outline" onClick={() => { setError(''); setRevision(value => value + 1); }}>Tentar novamente</Button></div>
        : !detail || !agreement ? <p role="status" className="text-[13.5px] text-muted-foreground">Carregando honorário…</p>
        : action?.kind === 'charge' ? <ChargeForm installmentId={action.installment.id} back={() => setAction(null)} busy={setBusy} />
        : action ? <MutationForm key={action.kind === 'receive' ? action.installment.id : action.kind === 'reverse' ? action.receipt.id : 'cancel'} action={action} agreementId={agreementId} today={today} back={() => setAction(null)} busy={setBusy} saved={next => { setDetail(next); setAction(null); changed(); }} />
        : <>
        <div className="flex flex-col gap-1 text-[13.5px]">
          <p className="flex flex-wrap gap-x-2">{agreement.canManage ? <Link className={linkClass} href={`/app/agenda/clients/${encodeURIComponent(agreement.clientId)}`}>{agreement.clientName}</Link> : <span>{agreement.clientName}</span>}
            {agreement.caseId && <><span aria-hidden="true" className="text-muted-foreground">·</span><Link className={linkClass} href={`/app/vault/cases/${encodeURIComponent(agreement.caseId)}`}>{agreement.caseName ?? 'Abrir caso'}</Link></>}</p>
          {agreement.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground">{agreement.notes}</p>}
        </div>
        <KpiRow className="grid-cols-1 sm:grid-cols-3 md:grid-cols-3 md:grid-flow-row">
          <Kpi size="small" label="Valor contratado" value={money(agreement.totalCents)} />
          <Kpi size="small" label="Recebido" value={money(agreement.receivedCents)} />
          <Kpi size="small" label={agreement.status === 'cancelled' ? 'Valor cancelado' : 'A receber'} value={money(agreement.status === 'cancelled' ? agreement.totalCents : agreement.pendingCents)} />
        </KpiRow>
        <section aria-labelledby={`${agreementId}-parcelas`} className="flex flex-col gap-1">
          <h3 id={`${agreementId}-parcelas`} className="text-[15px] font-semibold">Parcelas</h3>
          <div className="flex flex-col">{detail.installments.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">Parcela {row.number} de {row.installmentCount}<span className="font-mono text-[12.5px]">{money(row.amountCents)}</span></p>
              <p className="text-[12.5px] text-muted-foreground"><span className="font-mono">{dateLabel(row.dueOn)}</span> · {row.overdue ? 'Em atraso' : installmentStatus[row.status]}{row.status === 'partial' && <> · recebido {money(row.receivedCents)}, saldo {money(row.pendingCents)}</>}</p>
            </div>
            {row.canManage && row.pendingCents > 0 && agreement.status === 'active' && <div className="flex flex-wrap gap-1.5">
              <Button variant="ghost" className={rowAction} aria-label={`Preparar cobrança da parcela ${row.number}`} onClick={() => setAction({ kind: 'charge', installment: row })}>Cobrança</Button>
              <Button variant="outline" className={rowAction} aria-label={`Registrar recebimento da parcela ${row.number}`} onClick={() => setAction({ kind: 'receive', installment: row })}>Registrar recebimento</Button>
            </div>}
          </div>)}</div>
        </section>
        {agreement.pricing && <details className="text-[13.5px]"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Formação dos honorários</summary><div className="pt-3"><PricingSummary pricing={agreement.pricing} /></div></details>}
        <section aria-labelledby={`${agreementId}-recebimentos`} className="flex flex-col gap-1">
          <h3 id={`${agreementId}-recebimentos`} className="text-[15px] font-semibold">Histórico de recebimentos</h3>
          {detail.receipts.length ? <div className="flex flex-col">{detail.receipts.map(receipt => <div key={receipt.id} className="py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm"><span className="font-mono text-[12.5px]">{money(receipt.amountCents)}</span> · {methods[receipt.method]}</p><p className="text-[12.5px] text-muted-foreground">{dateLabel(receipt.receivedOn)} · Parcela {detail.installments.find(row => row.id === receipt.installmentId)?.number} · {receipt.createdByName}</p></div>
              {agreement.canManage && !receipt.reversal && agreement.status === 'active' && <Button variant="ghost" className={rowAction} aria-label={`Desfazer recebimento de ${money(receipt.amountCents)}`} onClick={() => setAction({ kind: 'reverse', receipt })}>Desfazer registro</Button>}
            </div>
            {receipt.notes && <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] text-muted-foreground">{receipt.notes}</p>}
            {receipt.reversal && <p className="mt-1 break-words text-[13.5px]">Registro desfeito por {receipt.reversal.createdByName} em {new Date(receipt.reversal.createdAt).toLocaleString('pt-BR')}. Motivo: {receipt.reversal.reason}</p>}
          </div>)}</div> : <p className="py-1 text-[13.5px] text-muted-foreground">Nenhum recebimento registrado.</p>}
        </section>
        {agreement.status === 'cancelled' ? <p className="border-t border-border pt-4 text-[13.5px] break-words">Cancelado em {agreement.cancelledAt ? new Date(agreement.cancelledAt).toLocaleString('pt-BR') : ''}. Motivo: {agreement.cancelReason}</p>
          : agreement.canManage ? <div className="flex flex-col items-start gap-1 border-t border-border pt-4"><Button variant="ghost" className={`-ml-2 text-destructive hover:text-destructive ${rowAction}`} disabled={agreement.receivedCents > 0} onClick={() => setAction({ kind: 'cancel' })}>Cancelar honorário</Button><p className="text-xs text-muted-foreground">{agreement.receivedCents > 0 ? 'O cancelamento exige saldo recebido igual a zero. Se houver erro nos registros, desfaça-os primeiro.' : 'O cancelamento mantém o histórico e retira as parcelas dos valores a receber.'}</p></div>
          : <p className="border-t border-border pt-4 text-[13.5px] text-muted-foreground">Somente quem cadastrou pode alterar este honorário.</p>}
      </>}
    </DialogContent>
  </Dialog>;
}

const linkClass = 'underline decoration-border-strong underline-offset-4 hover:decoration-current';
const rowAction = 'h-11 text-[13px] md:h-[30px]';

function MutationForm({ action, agreementId, today, back, busy, saved }: { action: FinancialAction; agreementId: string; today: string; back: () => void; busy: (value: boolean) => void; saved: (detail: HonorarioDetail) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [amount, setAmount] = useState(action.kind === 'receive' ? amountInput(action.installment.pendingCents) : '');
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<HonorarioReceipt['method']>('pix');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useHonorarioMutation(saved);
  useEffect(() => { form.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus(); }, []);
  useEffect(() => { busy(mutation.pending); return () => busy(false); }, [busy, mutation.pending]);
  const heading = action.kind === 'receive' ? `Recebimento da parcela ${action.installment.number}` : action.kind === 'reverse' ? 'Desfazer recebimento' : 'Cancelar honorário';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (action.kind === 'receive') {
      const input = { installmentId: action.installment.id, amountCents: parseAmount(amount), receivedOn, method, notes };
      if (!receiveHonorarioInput.safeParse({ ...input, idempotencyKey: 'validation-only' }).success || !input.amountCents || input.amountCents > action.installment.pendingCents || receivedOn > today) { mutation.setError('Informe um valor dentro do saldo e uma data válida até hoje.'); return; }
      await mutation.submit('receive', input);
    } else {
      if (reason.trim().length < 3) { mutation.setError('Informe o motivo com pelo menos 3 caracteres.'); return; }
      await mutation.submit(action.kind, action.kind === 'reverse' ? { receiptId: action.receipt.id, reason } : { agreementId, reason });
    }
  }
  return <form ref={form} className="grid gap-4" onSubmit={submit}>
    <div className="grid gap-1"><h3 className="text-[15px] font-semibold">{heading}</h3>
    <p className="text-[13.5px] text-muted-foreground">{action.kind === 'receive' ? `Saldo da parcela: ${money(action.installment.pendingCents)}. Este registro é interno e não realiza uma cobrança.` : action.kind === 'reverse' ? `Corrija o registro de ${money(action.receipt.amountCents)}. O histórico será mantido. Esta ação não devolve dinheiro ao cliente.` : 'Todas as parcelas deste honorário serão canceladas. O histórico será mantido.'}</p></div>
    <fieldset disabled={mutation.pending} className="grid min-w-0 gap-4">
      {action.kind === 'receive' ? <>
        <Field label="Valor recebido (R$)">{id => <Input id={id} className="max-md:h-11" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />}</Field>
        <Field label="Data do recebimento">{id => <Input id={id} className="max-md:h-11" required type="date" max={today} value={receivedOn} onChange={event => setReceivedOn(event.target.value)} />}</Field>
        <Field label="Meio de recebimento">{id => <select id={id} className={controlClass} value={method} onChange={event => { const parsed = paymentMethod.safeParse(event.target.value); if (parsed.success) setMethod(parsed.data); }}>{paymentMethod.options.map(value => <option key={value} value={value}>{methods[value]}</option>)}</select>}</Field>
        <Field label="Observação do recebimento">{id => <Textarea id={id} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
      </> : <Field label={action.kind === 'reverse' ? 'Motivo da correção' : 'Motivo do cancelamento'}>{id => <Textarea id={id} required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />}</Field>}
    </fieldset>
    <Failure message={mutation.error} />
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="lg" className="max-md:h-11" variant="outline" disabled={mutation.pending} onClick={back}>Voltar</Button><Button size="lg" className="max-md:h-11" variant={action.kind === 'cancel' ? 'destructive' : 'default'} disabled={mutation.pending} type="submit">{mutation.pending ? 'Salvando…' : action.kind === 'receive' ? 'Salvar recebimento' : action.kind === 'reverse' ? 'Desfazer registro' : 'Confirmar cancelamento'}</Button></div>
  </form>;
}
