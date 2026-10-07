'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { CanvasHeader } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, Failure, ReferenceSelect, controlClass } from '@/components/honorarios/fields';
import { amountInput, parseAmount } from '@/components/honorarios/editor';
import { calculationInput, calculationResult, calculators, savedCalculation, type CalculationKind, type CalculationInput, type CalculationResult, type SavedCalculation } from '@/lib/calc/contracts';
import { CalcResult } from './result';

export async function calcCall<T>(operation: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/calc/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const body: unknown = await response.json();
  if (!response.ok) { const error = z.object({ error: z.string() }).safeParse(body); throw new Error(error.success ? error.data.error : 'Não foi possível concluir o cálculo.'); }
  return schema.parse(body);
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const amount = (data: FormData, name: string) => {
  const value = text(data, name);
  if (/^0([,.]0{1,2})?$/.test(value)) return 0;
  const parsed = parseAmount(value);
  if (parsed === null) throw new Error(`Confira o valor de ${name}. Use o formato 1.000,00.`);
  return parsed;
};
const percentage = (data: FormData, name: string) => text(data, name).replace(',', '.');
function ValueField({ label, name, initial = '', type = 'text' }: { label: string; name: string; initial?: string | number; type?: 'text' | 'date' | 'number' }) {
  return <Field label={label}>{id => <Input id={id} name={name} className="max-md:h-11" type={type} inputMode={type === 'text' ? 'decimal' : undefined} defaultValue={initial} required />}</Field>;
}
function BasisField({ label, name, initial = '' }: { label: string; name: string; initial?: string }) {
  return <Field label={label}>{id => <Textarea id={id} name={name} defaultValue={initial} minLength={5} maxLength={2000} required />}</Field>;
}

/** The way back to the list above a calculation, the button form of the detail pages' back link. */
export function CalcBack({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick}
    className="-ml-1.5 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 md:h-[26px]">
    <ArrowLeft aria-hidden="true" className="size-3.5" />Cálculos
  </button>;
}

type EntryDraft = { description: string; dueOn: string; interestFrom: string; amount: string };
type PaymentDraft = { installment: number; paidOn: string; amount: string };
export function CalcForm({ kind, seed, saved, back }: { kind: CalculationKind; seed?: SavedCalculation; saved: (value: SavedCalculation) => void; back: () => void }) {
  const initial = seed?.input;
  const title = calculators.find(item => item.kind === kind)?.name ?? 'Cálculo';
  const [clientId, setClientId] = useState(seed?.clientId ?? '');
  const [caseId, setCaseId] = useState(seed?.caseId ?? '');
  const [entries, setEntries] = useState<EntryDraft[]>(initial && 'entries' in initial ? initial.entries.map(item => ({ description: item.description, dueOn: item.dueOn, interestFrom: item.interestFrom ?? '', amount: amountInput(item.amountCents) })) : [{ description: 'Parcela 1', dueOn: '', interestFrom: '', amount: '' }]);
  const [payments, setPayments] = useState<PaymentDraft[]>(initial && 'payments' in initial ? initial.payments.map(item => ({ installment: item.installment, paidOn: item.paidOn, amount: amountInput(item.amountCents) })) : []);
  const [result, setResult] = useState<CalculationResult | null>(seed?.result ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const running = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const monetary = !['tax', 'labor', 'revision'].includes(kind);
  function build(data: FormData): CalculationInput {
    const asOf = text(data, 'data-base');
    if (kind === 'tax') return calculationInput.parse({ kind, operation: text(data, 'operação'), asOf, originOn: text(data, 'origem'), moraStart: text(data, 'mora'), principalCents: amount(data, 'principal'), legalBasis: text(data, 'fundamento') });
    if (kind === 'revision') return calculationInput.parse({ kind, principalCents: amount(data, 'principal'), contractualMonthlyPercent: percentage(data, 'taxa contratada'), alternativeMonthlyPercent: percentage(data, 'taxa alternativa'), installments: Number(text(data, 'parcelas')), paidInstallments: Number(text(data, 'pagas')), system: text(data, 'sistema'), rateSource: text(data, 'fundamento') });
    if (kind === 'labor') return calculationInput.parse({ kind, salaryCents: amount(data, 'salário'), salaryDays: Number(text(data, 'dias')), thirteenthMonths: Number(text(data, 'avos13')), vacationMonths: Number(text(data, 'avosférias')), vacationPeriods: Number(text(data, 'períodos')), noticeDays: Number(text(data, 'aviso')), fgtsBaseCents: amount(data, 'FGTS'), deductionsCents: amount(data, 'deduções'), termination: text(data, 'desligamento'), basis: text(data, 'fundamento') });
    const interestKind = text(data, 'juros');
    const common = { kind, asOf, entries: entries.map(item => ({ description: item.description, dueOn: item.dueOn, interestFrom: item.interestFrom || undefined, amountCents: parseAmount(item.amount) })), payments: payments.map(item => ({ installment: item.installment, paidOn: item.paidOn, amountCents: parseAmount(item.amount) })), index: text(data, 'índice'), interest: interestKind === 'monthly' ? { kind: interestKind, percent: percentage(data, 'taxa') } : { kind: interestKind }, penaltyPercent: kind === 'consumer' ? '0' : percentage(data, 'multa') };
    return calculationInput.parse({ ...common, ...(kind === 'pension' ? { basis: text(data, 'fundamento') } : kind === 'consumer' ? { restitution: text(data, 'restituição'), legalBasis: text(data, 'fundamento') } : kind === 'rent' ? { contractBasis: text(data, 'fundamento'), anniversary: text(data, 'aniversário'), annualAdjustmentPercent: percentage(data, 'reajuste') } : {}) });
  }
  async function submit(save: boolean) {
    if (running.current || !form.current?.reportValidity()) return;
    running.current = true; setBusy(true); setError('');
    try {
      const data = new FormData(form.current);
      const input = build(data);
      if (save) {
        const payload = { id: seed?.id || undefined, expectedVersion: seed?.id ? seed.version : 0, title: text(data, 'título'), clientId: clientId || null, caseId: caseId || null, notes: text(data, 'notas'), input };
        const fingerprint = JSON.stringify(payload);
        if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
        saved(await calcCall('save', { ...payload, idempotencyKey: attempt.current.key }, savedCalculation));
      } else { setResult(await calcCall('preview', { input }, calculationResult)); setDirty(true); }
    } catch (cause) { setError(cause instanceof z.ZodError ? cause.issues[0]?.message ?? 'Confira os parâmetros.' : cause instanceof Error ? cause.message : 'Não foi possível calcular.'); }
    finally { setBusy(false); running.current = false; }
  }
  const base = initial && 'entries' in initial ? initial : null;
  const tax = initial?.kind === 'tax' ? initial : null;
  const labor = initial?.kind === 'labor' ? initial : null;
  const revision = initial?.kind === 'revision' ? initial : null;
  return <div className="flex min-w-0 flex-col gap-8">
    <div className="flex flex-col gap-3">
      <CalcBack onClick={back} disabled={busy} />
      <CanvasHeader eyebrow={seed?.id ? `Versão ${seed.version} de ${seed.latestVersion} · ${new Date(seed.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Novo cálculo'} title={title} />
    </div>
    <form ref={form} onSubmit={event => { event.preventDefault(); void submit(false); }} onChange={() => { setDirty(true); setResult(null); }} className="grid gap-6">
      <fieldset disabled={busy} className="grid min-w-0 gap-6">
        <Field label="Título do cálculo">{id => <Input id={id} name="título" defaultValue={seed?.title ?? title} minLength={3} maxLength={180} required className="max-md:h-11" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2"><ReferenceSelect kind="clients" optional value={clientId} onChange={value => { setClientId(value); setDirty(true); }} /><ReferenceSelect kind="cases" optional value={caseId} onChange={value => { setCaseId(value); setDirty(true); }} /></div>
        <p className="text-xs text-muted-foreground">Cálculo privado. Vincular ao cliente ou a um caso próprio não publica o resultado.</p>
        {(monetary || kind === 'tax') && <ValueField label="Data-base" name="data-base" type="date" initial={initial && 'asOf' in initial ? initial.asOf : today()} />}
        {monetary && <>
          {kind === 'consumer' && <><Field label="Forma de restituição">{id => <select id={id} name="restituição" className={controlClass} defaultValue={initial?.kind === 'consumer' ? initial.restitution : 'simple'}><option value="simple">Simples</option><option value="double">Em dobro</option></select>}</Field><BasisField label="Fundamento da restituição e da hipótese escolhida" name="fundamento" initial={initial?.kind === 'consumer' ? initial.legalBasis : ''} /><p className="text-sm text-muted-foreground">Informe somente o excesso efetivamente pago. A devolução em dobro depende da hipótese jurídica; não é aplicada automaticamente.</p></>}
          {kind === 'pension' && <BasisField label="Título, base da pensão e alterações por competência" name="fundamento" initial={initial?.kind === 'pension' ? initial.basis : ''} />}
          {kind === 'rent' && <><BasisField label="Cláusula de reajuste e encargos do contrato" name="fundamento" initial={initial?.kind === 'rent' ? initial.contractBasis : ''} /><div className="grid gap-4 sm:grid-cols-2"><ValueField label="Primeiro aniversário de reajuste" name="aniversário" type="date" initial={initial?.kind === 'rent' ? initial.anniversary : ''} /><ValueField label="Reajuste anual contratado (%)" name="reajuste" initial={initial?.kind === 'rent' ? initial.annualAdjustmentPercent : '0'} /></div><p className="text-sm text-muted-foreground">Informe o aluguel-base anterior ao primeiro reajuste. A taxa fixa será aplicada a cada aniversário. Para contratos com índice variável, informe parcelas já reajustadas e taxa zero.</p></>}
          <section className="flex min-w-0 flex-col gap-3"><h3 className="text-[15px] font-semibold">{kind === 'consumer' ? 'Valores pagos indevidamente' : 'Parcelas'}</h3>
            <div>{entries.map((entry, i) => <div className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-[1fr_10rem_10rem_10rem_auto]" key={i}>
              <Field label={`Parcela ${i + 1}: descrição`}>{id => <Input id={id} required maxLength={120} value={entry.description} onChange={event => setEntries(current => current.map((item, index) => index === i ? { ...item, description: event.target.value } : item))} />}</Field>
              <Field label={kind === 'consumer' ? `Parcela ${i + 1}: data do pagamento indevido` : `Parcela ${i + 1}: vencimento`}>{id => <Input id={id} type="date" required value={entry.dueOn} onChange={event => setEntries(current => current.map((item, index) => index === i ? { ...item, dueOn: event.target.value } : item))} />}</Field>
              <Field label={`Parcela ${i + 1}: valor (R$)`}>{id => <Input id={id} inputMode="decimal" required value={entry.amount} onChange={event => setEntries(current => current.map((item, index) => index === i ? { ...item, amount: event.target.value } : item))} />}</Field>
              <Field label={`Parcela ${i + 1}: início dos juros (opcional)`}>{id => <Input id={id} type="date" value={entry.interestFrom} onChange={event => setEntries(current => current.map((item, index) => index === i ? { ...item, interestFrom: event.target.value } : item))} />}</Field>
              <Button type="button" variant="ghost" className="self-end" aria-label={`Remover parcela ${i + 1}`} disabled={entries.length === 1} onClick={() => { setEntries(current => current.filter((_, index) => index !== i)); setPayments(current => current.filter(item => item.installment !== i + 1).map(item => ({ ...item, installment: item.installment > i + 1 ? item.installment - 1 : item.installment }))); setResult(null); setDirty(true); }}>Remover</Button>
            </div>)}</div><Button type="button" variant="outline" className="self-start" disabled={entries.length >= 240} onClick={() => { setEntries(current => [...current, { description: `Parcela ${current.length + 1}`, dueOn: '', interestFrom: '', amount: '' }]); setResult(null); setDirty(true); }}>Adicionar parcela</Button><p className="text-xs text-muted-foreground">Se o início dos juros ficar em branco, será usada a origem da parcela. Informe outro marco, como a citação, quando aplicável.</p>
          </section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Correção monetária">{id => <select id={id} name="índice" className={controlClass} defaultValue={base?.index ?? 'none'}><option value="none">Sem correção</option><option value="ipca">IPCA · BCB</option><option value="inpc">INPC · BCB</option></select>}</Field>
            <Field label="Regra de juros">{id => <select id={id} name="juros" className={controlClass} defaultValue={base?.interest.kind ?? 'none'}><option value="none">Sem juros</option><option value="monthly">Taxa mensal simples</option><option value="legal">Taxa Legal · BCB</option></select>}</Field>
            <ValueField label="Taxa mensal informada (%)" name="taxa" initial={base?.interest.kind === 'monthly' ? base.interest.percent : '0'} />
            {kind !== 'consumer' && <ValueField label="Multa única (%)" name="multa" initial={base?.penaltyPercent ?? '0'} />}
          </div>
          <p className="text-xs text-muted-foreground">A taxa informada só é usada com “Taxa mensal simples”. Correção por meses completos após o vencimento, até o mês anterior à data-base. Juros proporcionais aos dias de cada mês, sem capitalização. Confira a convenção do título antes de usar.</p>
          <section className="flex min-w-0 flex-col gap-3"><h3 className="text-[15px] font-semibold">{kind === 'consumer' ? 'Restituições já recebidas' : 'Pagamentos e abatimentos'}</h3>{payments.length === 0 && <p className="py-3 text-sm text-muted-foreground">Nenhum pagamento informado.</p>}
            {payments.map((payment, i) => <div className="grid gap-3 py-4 sm:grid-cols-4" key={i}><Field label={`Pagamento ${i + 1}: parcela`}>{id => <select id={id} className={controlClass} value={payment.installment} onChange={event => setPayments(current => current.map((item, index) => index === i ? { ...item, installment: Number(event.target.value) } : item))}>{entries.map((entry, index) => <option key={index} value={index + 1}>{index + 1}. {entry.description}</option>)}</select>}</Field><Field label={`Pagamento ${i + 1}: data`}>{id => <Input id={id} type="date" required value={payment.paidOn} onChange={event => setPayments(current => current.map((item, index) => index === i ? { ...item, paidOn: event.target.value } : item))} />}</Field><Field label={`Pagamento ${i + 1}: valor (R$)`}>{id => <Input id={id} required inputMode="decimal" value={payment.amount} onChange={event => setPayments(current => current.map((item, index) => index === i ? { ...item, amount: event.target.value } : item))} />}</Field><Button type="button" variant="ghost" className="self-end" aria-label={`Remover pagamento ${i + 1}`} onClick={() => { setPayments(current => current.filter((_, index) => index !== i)); setResult(null); setDirty(true); }}>Remover</Button></div>)}
            <Button type="button" variant="outline" className="self-start" disabled={payments.length >= 480} onClick={() => { setPayments(current => [...current, { installment: 1, paidOn: '', amount: '' }]); setResult(null); setDirty(true); }}>Adicionar pagamento</Button>
          </section>
        </>}
        {kind === 'tax' && <>
          <Field label="Operação tributária">{id => <select id={id} className={controlClass} name="operação" defaultValue={tax?.operation ?? 'debt'}><option value="debt">Débito federal em atraso</option><option value="credit">Pagamento federal indevido ou a maior</option></select>}</Field>
          <div className="grid gap-4 sm:grid-cols-3"><ValueField label="Principal (R$)" name="principal" initial={tax ? amountInput(tax.principalCents) : ''} /><ValueField label="Vencimento legal ou recolhimento indevido" name="origem" type="date" initial={tax?.originOn} /><ValueField label="Primeiro dia útil da mora (débito)" name="mora" type="date" initial={tax?.moraStart} /></div>
          <BasisField label="Tributo, período e fundamento do débito ou crédito" name="fundamento" initial={tax?.legalBasis} />
          <p className="text-sm text-muted-foreground">Débito: multa de 0,33% por dia, limitada a 20%, e SELIC somada. Crédito: pagamento indevido comum desde 1998, sem multa. No crédito, repita a data do recolhimento no campo da mora. Não apura o tributo, emite DARF ou declara elegibilidade para compensação. ICMS, ISS, IPTU, IRPF de ajuste, saldo negativo, créditos previdenciários e regimes especiais precisam de cálculo próprio.</p>
        </>}
        {kind === 'labor' && <>
          <Field label="Motivo do desligamento">{id => <select id={id} className={controlClass} name="desligamento" defaultValue={labor?.termination ?? 'dismissal'}><option value="dismissal">Dispensa sem justa causa</option><option value="resignation">Pedido de demissão</option><option value="agreement">Acordo do art. 484-A</option></select>}</Field>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><ValueField label="Remuneração-base mensal (R$)" name="salário" initial={labor ? amountInput(labor.salaryCents) : ''} /><ValueField label="Dias de saldo salarial (0 a 30)" name="dias" type="number" initial={labor?.salaryDays ?? 0} /><ValueField label="Avos de 13º (0 a 12)" name="avos13" type="number" initial={labor?.thirteenthMonths ?? 0} /><ValueField label="Avos de férias proporcionais (0 a 12)" name="avosférias" type="number" initial={labor?.vacationMonths ?? 0} /><ValueField label="Períodos integrais de férias simples" name="períodos" type="number" initial={labor?.vacationPeriods ?? 0} /><ValueField label="Dias de aviso indenizado (0 a 90)" name="aviso" type="number" initial={labor?.noticeDays ?? 0} /><ValueField label="Base rescisória do FGTS (R$)" name="FGTS" initial={labor ? amountInput(labor.fgtsBaseCents) : '0,00'} /><ValueField label="Deduções conferidas (R$)" name="deduções" initial={labor ? amountInput(labor.deductionsCents) : '0,00'} /></div>
          <BasisField label="Admissão, desligamento, projeção do aviso e bases conferidas" name="fundamento" initial={labor?.basis} />
          <p className="text-sm text-muted-foreground">Rescisão assistida de mensalista. Informe os avos após conferir a projeção do aviso. O acordo reduz o aviso indenizado pela metade. Não calcula automaticamente tributos, férias em dobro, horas extras, adicionais ou depósitos de FGTS faltantes.</p>
        </>}
        {kind === 'revision' && <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><ValueField label="Capital financiado (R$)" name="principal" initial={revision ? amountInput(revision.principalCents) : ''} /><ValueField label="Taxa contratada mensal (%)" name="taxa contratada" initial={revision?.contractualMonthlyPercent ?? ''} /><ValueField label="Taxa alternativa mensal (%)" name="taxa alternativa" initial={revision?.alternativeMonthlyPercent ?? ''} /><ValueField label="Quantidade de parcelas" name="parcelas" type="number" initial={revision?.installments ?? 12} /><ValueField label="Parcelas pagas" name="pagas" type="number" initial={revision?.paidInstallments ?? 0} /><Field label="Sistema de amortização">{id => <select id={id} name="sistema" className={controlClass} defaultValue={revision?.system ?? 'price'}><option value="price">Price</option><option value="sac">SAC</option></select>}</Field></div>
          <BasisField label="Contrato, modalidade, data e fonte da taxa alternativa" name="fundamento" initial={revision?.rateSource} /><p className="text-sm text-muted-foreground">Compara prestações mensais regulares. Não inclui tarifas, seguros, carência ou atraso. A diferença para uma taxa de referência não determina abusividade.</p>
        </>}
        <Field label="Observações do cálculo">{id => <Textarea id={id} name="notas" maxLength={4000} defaultValue={seed?.notes ?? ''} />}</Field>
      </fieldset>
      <Failure message={error} />
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" className="max-md:h-11" disabled={busy}>{busy ? 'Calculando…' : 'Conferir cálculo'}</Button><Button type="button" variant="outline" size="lg" className="max-md:h-11" disabled={busy} onClick={() => void submit(true)}>{seed ? 'Salvar nova versão' : 'Salvar cálculo'}</Button></div>
    </form>
    {result && <CalcResult result={result} saved={!dirty ? seed : undefined} />}
    {!result && dirty && <p className="text-[13.5px] text-muted-foreground">Confira o cálculo para ver o resultado destas alterações.</p>}
  </div>;
}
