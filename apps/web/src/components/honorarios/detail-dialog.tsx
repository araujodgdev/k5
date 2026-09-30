'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { honorarioDetailDto, paymentMethod, receiveHonorarioInput, type HonorarioDetail, type HonorarioInstallment, type HonorarioReceipt } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { honorariosCall, useHonorarioMutation } from './client';
import { amountInput, dateLabel, money, parseAmount } from './editor';
import { controlClass, dialogClass, Failure, Field } from './fields';
import { ChargeForm } from './charge-form';

const methods: Record<HonorarioReceipt['method'], string> = { pix: 'Pix', transfer: 'Transferência', cash: 'Dinheiro', card: 'Cartão', other: 'Outro' };
export const installmentStatus: Record<HonorarioInstallment['status'], string> = { pending: 'A receber', partial: 'Recebida em parte', received: 'Recebida', cancelled: 'Cancelada' };
type FinancialAction = { kind: 'receive'; installment: HonorarioInstallment } | { kind: 'reverse'; receipt: HonorarioReceipt } | { kind: 'cancel' };
type Action = FinancialAction | { kind: 'charge'; installment: HonorarioInstallment };

export function DetailHonorarioDialog({ agreementId, today, close, changed }: { agreementId: string; today: string; close: () => void; changed: () => void }) {
  const [detail, setDetail] = useState<HonorarioDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('get', { agreementId }, honorarioDetailDto, controller.signal).then(value => { setDetail(value); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o honorário.'); });
    return () => controller.abort();
  }, [agreementId, revision]);
  const agreement = detail?.agreement;
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!busy}>
      <DialogHeader className="pr-10"><DialogTitle className="break-words">{agreement?.title ?? 'Honorário'}</DialogTitle><DialogDescription>{agreement ? agreement.status === 'cancelled' ? 'Honorário cancelado. O histórico permanece disponível.' : 'Parcelas e registros manuais de recebimento.' : 'Carregando detalhes…'}</DialogDescription></DialogHeader>
      {error ? <><Failure message={error} /><Button variant="outline" className="min-h-11" onClick={() => { setError(''); setRevision(value => value + 1); }}>Tentar novamente</Button></> : !detail || !agreement ? <p role="status">Carregando honorário…</p> : action?.kind === 'charge' ? <ChargeForm installmentId={action.installment.id} back={() => setAction(null)} busy={setBusy} /> : action ? <MutationForm key={action.kind === 'receive' ? action.installment.id : action.kind === 'reverse' ? action.receipt.id : 'cancel'} action={action} agreementId={agreementId} today={today} back={() => setAction(null)} busy={setBusy} saved={next => { setDetail(next); setAction(null); changed(); }} /> : <>
        <div className="grid gap-2 text-sm">{agreement.canManage ? <Link className="min-h-11 py-2 underline underline-offset-4" href={`/app/agenda/clients/${encodeURIComponent(agreement.clientId)}`}>{agreement.clientName}</Link> : <p>{agreement.clientName}</p>}{agreement.caseId && <Link className="min-h-11 py-2 underline underline-offset-4" href={`/app/vault/cases/${encodeURIComponent(agreement.caseId)}`}>{agreement.caseName ?? 'Abrir caso'}</Link>}{agreement.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground">{agreement.notes}</p>}</div>
        <dl className="grid grid-cols-1 divide-y border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="py-3 sm:pr-3"><dt className="text-xs text-muted-foreground">Valor contratado</dt><dd className="mt-1 font-medium">{money(agreement.totalCents)}</dd></div><div className="py-3 sm:px-3"><dt className="text-xs text-muted-foreground">Recebido</dt><dd className="mt-1 font-medium">{money(agreement.receivedCents)}</dd></div><div className="py-3 sm:pl-3"><dt className="text-xs text-muted-foreground">{agreement.status === 'cancelled' ? 'Valor cancelado' : 'A receber'}</dt><dd className="mt-1 font-medium">{money(agreement.status === 'cancelled' ? agreement.totalCents : agreement.pendingCents)}</dd></div></dl>
        <section><h2 className="font-medium">Parcelas</h2><div className="mt-2 divide-y">{detail.installments.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="text-sm">Parcela {row.number} de {row.installmentCount} · {money(row.amountCents)}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(row.dueOn)} · {row.overdue ? 'Em atraso' : installmentStatus[row.status]}</p>{row.status === 'partial' && <p className="mt-1 text-xs">Recebido {money(row.receivedCents)} · Saldo {money(row.pendingCents)}</p>}</div>{row.canManage && row.pendingCents > 0 && agreement.status === 'active' && <div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" aria-label={`Preparar cobrança da parcela ${row.number}`} onClick={() => setAction({ kind: 'charge', installment: row })}>Cobrança</Button><Button className="min-h-11" variant="outline" aria-label={`Registrar recebimento da parcela ${row.number}`} onClick={() => setAction({ kind: 'receive', installment: row })}>Registrar recebimento</Button></div>}</div>)}</div></section>
        <section className="border-t border-line pt-4"><h2 className="font-medium">Histórico de recebimentos</h2>{detail.receipts.length ? <div className="mt-2 divide-y">{detail.receipts.map(receipt => <div key={receipt.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm">{money(receipt.amountCents)} · {methods[receipt.method]}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(receipt.receivedOn)} · Parcela {detail.installments.find(row => row.id === receipt.installmentId)?.number} · {receipt.createdByName}</p></div>{agreement.canManage && !receipt.reversal && agreement.status === 'active' && <Button className="min-h-11" variant="ghost" aria-label={`Desfazer recebimento de ${money(receipt.amountCents)}`} onClick={() => setAction({ kind: 'reverse', receipt })}>Desfazer registro</Button>}</div>{receipt.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{receipt.notes}</p>}{receipt.reversal && <p className="mt-2 break-words text-sm">Registro desfeito por {receipt.reversal.createdByName} em {new Date(receipt.reversal.createdAt).toLocaleString('pt-BR')}. Motivo: {receipt.reversal.reason}</p>}</div>)}</div> : <p className="py-4 text-sm text-muted-foreground">Nenhum recebimento registrado.</p>}</section>
        {agreement.status === 'cancelled' ? <p className="border-t border-line pt-4 text-sm break-words">Cancelado em {agreement.cancelledAt ? new Date(agreement.cancelledAt).toLocaleString('pt-BR') : ''}. Motivo: {agreement.cancelReason}</p> : agreement.canManage ? <div className="border-t border-line pt-4"><Button className="min-h-11" variant="ghost" disabled={agreement.receivedCents > 0} onClick={() => setAction({ kind: 'cancel' })}>Cancelar honorário</Button><p className="mt-1 text-xs text-muted-foreground">{agreement.receivedCents > 0 ? 'O cancelamento exige saldo recebido igual a zero. Se houver erro nos registros, desfaça-os primeiro.' : 'O cancelamento mantém o histórico e retira as parcelas dos valores a receber.'}</p></div> : <p className="border-t border-line pt-4 text-sm text-muted-foreground">Somente quem cadastrou pode alterar este honorário.</p>}
      </>}
    </DialogContent>
  </Dialog>;
}

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
  return <form ref={form} className="grid gap-5" onSubmit={submit}>
    <h2 className="text-lg font-medium">{heading}</h2>
    <p className="text-sm text-muted-foreground">{action.kind === 'receive' ? `Saldo da parcela: ${money(action.installment.pendingCents)}. Este registro é interno e não realiza uma cobrança.` : action.kind === 'reverse' ? `Corrija o registro de ${money(action.receipt.amountCents)}. O histórico será mantido. Esta ação não devolve dinheiro ao cliente.` : 'Todas as parcelas deste honorário serão canceladas. O histórico será mantido.'}</p>
    <fieldset disabled={mutation.pending} className="grid min-w-0 gap-4">
      {action.kind === 'receive' ? <>
        <Field label="Valor recebido (R$)">{id => <Input id={id} className="min-h-11" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />}</Field>
        <Field label="Data do recebimento">{id => <Input id={id} className="min-h-11" required type="date" max={today} value={receivedOn} onChange={event => setReceivedOn(event.target.value)} />}</Field>
        <Field label="Meio de recebimento">{id => <select id={id} className={controlClass} value={method} onChange={event => { const parsed = paymentMethod.safeParse(event.target.value); if (parsed.success) setMethod(parsed.data); }}>{paymentMethod.options.map(value => <option key={value} value={value}>{methods[value]}</option>)}</select>}</Field>
        <Field label="Observação do recebimento">{id => <Textarea id={id} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
      </> : <Field label={action.kind === 'reverse' ? 'Motivo da correção' : 'Motivo do cancelamento'}>{id => <Textarea id={id} required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />}</Field>}
    </fieldset>
    <Failure message={mutation.error} />
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" className="min-h-11" variant="ghost" disabled={mutation.pending} onClick={back}>Voltar</Button><Button className="min-h-11" disabled={mutation.pending} type="submit">{mutation.pending ? 'Salvando…' : action.kind === 'receive' ? 'Salvar recebimento' : action.kind === 'reverse' ? 'Desfazer registro' : 'Confirmar cancelamento'}</Button></div>
  </form>;
}
