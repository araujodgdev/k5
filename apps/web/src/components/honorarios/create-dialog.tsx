'use client';

import { useState } from 'react';
import { createHonorarioInput, type HonorarioDetail } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useHonorarioMutation } from './client';
import { money, monthlySchedule, parseAmount, type InstallmentDraft } from './editor';
import { dialogClass, Failure, Field, ReferenceSelect } from './fields';

export function CreateHonorarioDialog({ clientId: initialClientId, caseId: initialCaseId, close, saved }: { clientId: string; caseId: string; close: () => void; saved: (detail: HonorarioDetail) => void }) {
  const [clientId, setClientId] = useState(initialClientId);
  const [caseId, setCaseId] = useState(initialCaseId);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('1');
  const [first, setFirst] = useState('');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([]);
  const mutation = useHonorarioMutation(saved);
  const previewTotal = installments.reduce((sum, row) => sum + (parseAmount(row.amount) ?? 0), 0);
  function generate(nextTotal: string, nextCount: string, nextFirst: string) {
    setInstallments(monthlySchedule(parseAmount(nextTotal) ?? 0, Number(nextCount), nextFirst));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { clientId, caseId: caseId || null, title, notes, installments: installments.map(row => ({ amountCents: parseAmount(row.amount), dueOn: row.dueOn })) };
    const result = createHonorarioInput.safeParse({ ...input, idempotencyKey: 'validation-only' });
    if (!result.success || !parseAmount(total) || previewTotal !== parseAmount(total)) {
      mutation.setError('Confira cliente, descrição, datas e valores. A soma das parcelas deve ser igual ao valor total.'); return;
    }
    await mutation.submit('create', input);
  }
  return <Dialog open onOpenChange={open => { if (!open && !mutation.pending) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!mutation.pending}>
      <DialogHeader className="pr-10"><DialogTitle>Novo honorário</DialogTitle><DialogDescription>Cadastre o valor combinado e confira cada parcela antes de salvar.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-5">
        <fieldset disabled={mutation.pending} className="grid min-w-0 gap-5">
          <div className="grid min-w-0 gap-5 sm:grid-cols-2"><ReferenceSelect kind="clients" value={clientId} onChange={setClientId} /><ReferenceSelect kind="cases" value={caseId} onChange={setCaseId} optional /></div>
          <p className="text-xs text-muted-foreground">Os participantes do caso poderão consultar estes honorários.</p>
          <Field label="Descrição">{id => <Input id={id} className="min-h-11" required minLength={2} maxLength={180} value={title} onChange={event => setTitle(event.target.value)} />}</Field>
          <Field label="Observações">{id => <Textarea id={id} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <Field label="Valor total (R$)">{id => <Input id={id} className="min-h-11" required inputMode="decimal" placeholder="0,00" value={total} onChange={event => { setTotal(event.target.value); generate(event.target.value, count, first); }} />}</Field>
            <Field label="Número de parcelas">{id => <Input id={id} className="min-h-11" required type="number" min={1} max={120} step={1} value={count} onChange={event => { setCount(event.target.value); generate(total, event.target.value, first); }} />}</Field>
            <Field label="Primeiro vencimento">{id => <Input id={id} className="min-h-11" required type="date" value={first} onChange={event => { setFirst(event.target.value); generate(total, count, event.target.value); }} />}</Field>
          </div>
          <section aria-labelledby="schedule-title" className="border-y border-line py-4">
            <h2 id="schedule-title" className="font-medium">Parcelas</h2>
            <p className="mt-1 text-xs text-muted-foreground">Ajuste os valores e vencimentos abaixo. Alterar o total, a quantidade ou o primeiro vencimento refaz a divisão mensal.</p>
            {installments.length ? <div className="mt-4 divide-y">{installments.map((row, index) => <div key={index} className="grid min-w-0 grid-cols-2 gap-3 py-3">
              <Field label={`Parcela ${index + 1}: valor (R$)`}>{id => <Input id={id} className="min-h-11" required inputMode="decimal" value={row.amount} onChange={event => setInstallments(rows => rows.map((item, number) => number === index ? { ...item, amount: event.target.value } : item))} />}</Field>
              <Field label={`Parcela ${index + 1}: vencimento`}>{id => <Input id={id} className="min-h-11" required type="date" value={row.dueOn} onChange={event => setInstallments(rows => rows.map((item, number) => number === index ? { ...item, dueOn: event.target.value } : item))} />}</Field>
            </div>)}<p className="pt-3 text-sm" aria-live="polite">Total das parcelas: {money(previewTotal)}</p></div> : <p className="py-5 text-sm text-muted-foreground">Preencha valor, quantidade e primeiro vencimento para conferir as parcelas.</p>}
          </section>
        </fieldset>
        <Failure message={mutation.error} />
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={mutation.pending} onClick={close}>Voltar</Button><Button type="submit" className="min-h-11" disabled={mutation.pending || !installments.length}>{mutation.pending ? 'Cadastrando…' : 'Cadastrar honorário'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
