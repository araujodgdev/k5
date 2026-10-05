'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { feeTerms, feeQuoteDto, feeQuoteListDto, priceFees, type FeeQuote, type FeeTerms, type FeePricing } from '@/lib/honorarios/pricing';
import { oabCatalog } from '@/lib/honorarios/catalog';
import { savedCalculation, type SavedCalculation } from '@/lib/calc/contracts';
import { calcCall } from '@/components/calc/form';
import { honorariosCall } from './client';
import { Field, Failure, ReferenceSelect, controlClass } from './fields';
import { amountInput, money, parseAmount } from './editor';

type Draft = { kind: 'fixed' | 'hours' | 'percentage' | 'monthly'; label: string; due: 'contract' | 'success'; condition: string; amount: string; base: string; quantity: string; percent: string };
const emptyComponent = (): Draft => ({ kind: 'fixed', label: 'Contratação', due: 'contract', condition: '', amount: '', base: '', quantity: '1', percent: '20' });
function toDraft(terms: FeeTerms): Draft[] {
  return terms.components.map(item => ({ ...emptyComponent(), kind: item.kind, label: item.label, due: item.due, condition: item.condition, amount: amountInput(item.kind === 'hours' ? item.rateCents : item.kind === 'percentage' ? 0 : item.amountCents), base: item.kind === 'percentage' ? amountInput(item.baseCents) : '', quantity: item.kind === 'hours' ? item.quantity : item.kind === 'monthly' ? String(item.months) : '1', percent: item.kind === 'percentage' ? item.percent : '20' }));
}

export function FeeQuotePanel() {
  const params = useSearchParams();
  const [quotes, setQuotes] = useState<FeeQuote[] | null>(null);
  const [active, setActive] = useState<FeeQuote | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [calculation, setCalculation] = useState<SavedCalculation | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const calculationId = params.get('calculationId');
  const calculationVersion = params.get('version');
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('quote-list', {}, feeQuoteListDto, controller.signal).then(value => { setQuotes(value.items); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar.'); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!calculationId) return;
    const controller = new AbortController();
    void calcCall('get', { id: calculationId, version: calculationVersion ? Number(calculationVersion) : undefined }, savedCalculation, controller.signal).then(value => { setCalculation(value); setEditing(true); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível importar a base.'); });
    return () => controller.abort();
  }, [calculationId, calculationVersion]);
  const save = (quote: FeeQuote) => { setActive(quote); setCalculation(null); setEditing(false); setRevision(value => value + 1); };
  async function openVersion(id: string, version: number) {
    setLoadingVersion(true); setError('');
    try { setActive(await honorariosCall('quote-get', { id, version }, feeQuoteDto)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a versão.'); }
    finally { setLoadingVersion(false); }
  }
  return <div className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8"><header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6"><div><Link href="/app/honorarios" className="text-xs underline">Honorários</Link><h1 className="mt-3 text-3xl font-medium tracking-tight">Propostas e contratos</h1></div><Button onClick={() => { setActive(null); setCalculation(null); setEditing(true); }}>Nova proposta</Button></header>
    <div className="py-3"><Failure message={error} /></div>
    {editing ? <QuoteEditor key={active?.id ?? calculation?.id ?? 'new'} seed={active} calculation={calculation} saved={save} back={() => setEditing(false)} /> : active ? <>
      <div className="flex flex-wrap justify-between gap-3 py-4"><h2 className="text-xl font-medium">{active.title}</h2><div className="flex flex-wrap gap-3"><Button variant="ghost" onClick={() => setActive(null)}>Voltar às propostas</Button><Button variant="outline" disabled={loadingVersion || active.billed.length > 0 || active.version !== active.latestVersion} onClick={() => setEditing(true)}>Revisar proposta</Button></div></div>
      <label className="flex items-center gap-3 text-sm">Versão da proposta<select className={controlClass} disabled={loadingVersion} value={active.version} onChange={event => void openVersion(active.id, Number(event.target.value))}>{Array.from({ length: active.latestVersion }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      {active.version !== active.latestVersion && <p className="mt-3 text-sm text-muted-foreground">Versão histórica. Abra a versão atual para registrar contratação ou êxito.</p>}
      <PricingSummary pricing={active.pricing} />
      <div className="flex flex-wrap gap-4 border-y border-line py-4 text-sm underline"><a href={`/api/honorarios/${active.id}/proposal?format=pdf&version=${active.version}`}>Baixar proposta PDF</a><a href={`/api/honorarios/${active.id}/proposal?format=json&version=${active.version}`}>Baixar dados da proposta</a></div>
      <div className="divide-y">{active.pricing.components.map((component, index) => {
        const billed = active.billed.find(item => item.component === index);
        return <section key={index} className="py-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium">{component.label}</h3><span className="tabular-nums">{money(component.totalCents)}{component.due === 'success' ? ' estimados' : ''}</span></div>{billed ? <p className="mt-3 text-sm">Parcelas geradas: {money(billed.amountCents)}. <Link className="underline" href={`/app/honorarios?agreementId=${billed.agreementId}`}>Abrir recebimentos</Link></p> : active.version === active.latestVersion && <BillComponent quote={active} index={index} saved={save} />}</section>;
      })}</div>
    </> : <section className="divide-y border-y border-line">{quotes === null ? <p role="status" className="py-8">{error ? 'Use Atualizar para tentar novamente.' : 'Carregando propostas…'}</p> : quotes.length === 0 ? <p className="py-8 text-sm text-muted-foreground">Nenhuma proposta cadastrada. Consulte as referências de PE e RS e defina a contratação.</p> : quotes.map(quote => <button className="flex w-full flex-wrap justify-between gap-3 py-5 text-left hover:bg-accent" key={quote.id} onClick={() => setActive(quote)}><span><span className="block font-medium">{quote.title}</span><span className="mt-1 block text-xs text-muted-foreground">{quote.pricing.terms.uf} · versão {quote.version} · {quote.billed.length} componentes com parcelas</span></span><span>{money(quote.pricing.totalCents)} estimados</span></button>)}<Button className="my-4" variant="ghost" onClick={() => setRevision(value => value + 1)}>Atualizar</Button><p className="pb-4 text-xs text-muted-foreground">Até 100 propostas recentes. Propostas são privadas; gerar parcelas de um caso permite a consulta dos valores pelos participantes.</p></section>}
  </div>;
}

function QuoteEditor({ seed, calculation, saved, back }: { seed: FeeQuote | null; calculation: SavedCalculation | null; saved: (quote: FeeQuote) => void; back: () => void }) {
  const [uf, setUf] = useState<'PE' | 'RS'>(seed?.pricing.terms.uf ?? 'PE');
  const [referenceId, setReferenceId] = useState(seed?.pricing.terms.referenceId ?? '');
  const [clientId, setClientId] = useState(seed?.clientId ?? calculation?.clientId ?? '');
  const [caseId, setCaseId] = useState(seed?.caseId ?? calculation?.caseId ?? '');
  const [components, setComponents] = useState<Draft[]>(seed ? toDraft(seed.pricing.terms) : calculation && calculation.result.totalCents > 0 ? [{ ...emptyComponent(), kind: 'percentage', base: amountInput(calculation.result.totalCents) }] : [emptyComponent()]);
  const [allocations, setAllocations] = useState(seed?.pricing.terms.allocations ?? []);
  const [preview, setPreview] = useState<FeePricing | null>(seed?.pricing ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const running = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const reference = oabCatalog.find(item => item.id === referenceId);
  const update = (i: number, patch: Partial<Draft>) => { setComponents(current => current.map((item, index) => index === i ? { ...item, ...patch } : item)); setPreview(null); };
  function terms(data: FormData) {
    return feeTerms.parse({ uf, referenceId: referenceId || null, serviceOn: data.get('serviceOn'), scope: data.get('scope'), paymentTerms: data.get('paymentTerms'), justification: data.get('justification'), calculation: calculation ? { id: calculation.id, version: calculation.version } : seed?.pricing.terms.calculation ?? null, allocations,
      components: components.map(item => ({ label: item.label, due: item.due, condition: item.condition, kind: item.kind, ...(item.kind === 'percentage' ? { baseCents: parseAmount(item.base), percent: item.percent.replace(',', '.') } : item.kind === 'hours' ? { rateCents: parseAmount(item.amount), quantity: item.quantity.replace(',', '.') } : item.kind === 'monthly' ? { amountCents: parseAmount(item.amount), months: Number(item.quantity) } : { amountCents: parseAmount(item.amount) }) })) });
  }
  async function submit(save: boolean) {
    if (!form.current?.reportValidity() || running.current) return;
    setError('');
    try {
      const data = new FormData(form.current); const inputTerms = terms(data); setPreview(priceFees(inputTerms));
      if (!save) return;
      if (!clientId) throw new Error('Selecione o cliente antes de salvar.');
      running.current = true; setBusy(true);
      const payload = { id: seed?.id, expectedVersion: seed?.version ?? 0, title: String(data.get('title')), clientId, caseId: caseId || null, terms: inputTerms };
      const fingerprint = JSON.stringify(payload);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
      saved(await honorariosCall('quote-save', { ...payload, idempotencyKey: attempt.current.key }, feeQuoteDto));
    } catch (cause) { setError(cause instanceof z.ZodError ? cause.issues[0]?.message ?? 'Confira a proposta.' : cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { running.current = false; setBusy(false); }
  }
  return <form ref={form} onSubmit={event => { event.preventDefault(); void submit(true); }} onChange={() => setPreview(null)} className="grid min-w-0 gap-5 py-5"><fieldset disabled={busy} className="grid min-w-0 gap-5">
    <Field label="Título da proposta">{id => <Input id={id} name="title" required minLength={3} maxLength={180} defaultValue={seed?.title ?? 'Proposta de honorários'} />}</Field>
    <div className="grid gap-4 sm:grid-cols-2"><ReferenceSelect kind="clients" value={clientId} onChange={setClientId} /><ReferenceSelect kind="cases" value={caseId} onChange={setCaseId} optional /></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="UF do serviço">{id => <select id={id} className={controlClass} value={uf} onChange={event => { const value = event.target.value; if (value === 'PE' || value === 'RS') { setUf(value); setReferenceId(''); } }}><option value="PE">Pernambuco</option><option value="RS">Rio Grande do Sul</option></select>}</Field><Field label="Data de referência do serviço">{id => <Input id={id} name="serviceOn" type="date" required defaultValue={seed?.pricing.terms.serviceOn ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })} />}</Field></div>
    <Field label="Atividade na tabela OAB 2026">{id => <select id={id} className={controlClass} value={referenceId} onChange={event => setReferenceId(event.target.value)}><option value="">Outra atividade, consultar tabela integral</option>{oabCatalog.filter(item => item.uf === uf).map(item => <option key={item.id} value={item.id}>{item.code} · {item.area} · {item.label}</option>)}</select>}</Field>
    {reference && <div className="border-y border-line py-4 text-sm"><p>{money(reference.fixedCents)}{reference.percent ? ` · referência percentual: ${reference.percent}` : ''}</p><p className="mt-2">{reference.rule}</p><a className="mt-2 block underline" href={reference.source} target="_blank" rel="noreferrer">Abrir OAB-{uf}, edição 2026, página {reference.page}</a><p className="mt-2 text-xs text-muted-foreground">Referência consultada em 04/10/2026. Confira vigência e enquadramento. As colunas da tabela não são somadas automaticamente.</p></div>}
    {calculation && <p className="border-l-2 border-brand pl-3 text-sm">Base trazida do Calc: {calculation.title}, versão {calculation.version}, {money(calculation.result.totalCents)}.</p>}
    <Field label="Escopo, atos e instâncias incluídos">{id => <Textarea id={id} name="scope" required minLength={5} maxLength={4000} defaultValue={seed?.pricing.terms.scope} />}</Field>
    <Field label="Condições de pagamento, despesas e hipótese de acordo">{id => <Textarea id={id} name="paymentTerms" required minLength={5} maxLength={4000} defaultValue={seed?.pricing.terms.paymentTerms} />}</Field>
    <section className="min-w-0 border-y border-line py-4"><h2 className="font-medium">Composição dos honorários</h2><div className="divide-y">{components.map((item, i) => <div key={i} className="grid min-w-0 gap-4 py-5">
      <div className="grid gap-4 sm:grid-cols-2"><Field label={`Componente ${i + 1}: descrição`}>{id => <Input id={id} required value={item.label} onChange={event => update(i, { label: event.target.value })} />}</Field><Field label={`Componente ${i + 1}: modalidade`}>{id => <select id={id} className={controlClass} value={item.kind} onChange={event => { const kind = z.enum(['fixed', 'hours', 'percentage', 'monthly']).parse(event.target.value); update(i, { kind }); }}><option value="fixed">Fixo / fase / ato</option><option value="hours">Por hora</option><option value="percentage">Percentual</option><option value="monthly">Mensalidade por período</option></select>}</Field></div>
      <div className="grid gap-4 sm:grid-cols-3">{item.kind === 'percentage' ? <><Field label={`Componente ${i + 1}: base (R$)`}>{id => <Input id={id} required inputMode="decimal" value={item.base} onChange={event => update(i, { base: event.target.value })} />}</Field><Field label={`Componente ${i + 1}: percentual (%)`}>{id => <Input id={id} required inputMode="decimal" value={item.percent} onChange={event => update(i, { percent: event.target.value })} />}</Field></> : <><Field label={`Componente ${i + 1}: valor ${item.kind === 'hours' ? 'por hora' : item.kind === 'monthly' ? 'mensal' : 'fixo'} (R$)`}>{id => <Input id={id} required inputMode="decimal" value={item.amount} onChange={event => update(i, { amount: event.target.value })} />}</Field>{item.kind !== 'fixed' && <Field label={`Componente ${i + 1}: ${item.kind === 'hours' ? 'horas' : 'meses'}`}>{id => <Input id={id} required inputMode="decimal" value={item.quantity} onChange={event => update(i, { quantity: event.target.value })} />}</Field>}</>}
      <Field label={`Componente ${i + 1}: exigibilidade`}>{id => <select id={id} className={controlClass} value={item.due} onChange={event => update(i, { due: event.target.value === 'success' ? 'success' : 'contract' })}><option value="contract">Conforme contratação</option><option value="success">Condicionado ao êxito</option></select>}</Field></div>
      <Field label={`Componente ${i + 1}: condição ou evento de êxito`}>{id => <Textarea id={id} value={item.condition} required={item.due === 'success'} onChange={event => update(i, { condition: event.target.value })} />}</Field>
      <Button className="justify-self-start" type="button" variant="ghost" disabled={components.length === 1} onClick={() => { setComponents(current => current.filter((_, index) => index !== i)); setPreview(null); }}>Remover componente {i + 1}</Button>
    </div>)}</div><Button variant="outline" type="button" disabled={components.length >= 20} onClick={() => { setComponents(current => [...current, emptyComponent()]); setPreview(null); }}>Adicionar componente</Button></section>
    <section className="grid gap-3"><h2 className="font-medium">Rateio previsto</h2><p className="text-xs text-muted-foreground">Planejamento entre profissionais. Não transfere valores nem concede acesso à proposta.</p>{allocations.map((item, i) => <div key={i} className="grid gap-3 sm:grid-cols-3"><Field label={`Rateio ${i + 1}: profissional`}>{id => <Input id={id} required value={item.name} onChange={event => setAllocations(current => current.map((row, index) => index === i ? { ...row, name: event.target.value } : row))} />}</Field><Field label={`Rateio ${i + 1}: percentual`}>{id => <Input id={id} required value={item.percent} onChange={event => setAllocations(current => current.map((row, index) => index === i ? { ...row, percent: event.target.value.replace(',', '.') } : row))} />}</Field><Button className="self-end" type="button" variant="ghost" onClick={() => setAllocations(current => current.filter((_, index) => index !== i))}>Remover rateio {i + 1}</Button></div>)}<Button className="justify-self-start" type="button" variant="outline" onClick={() => setAllocations(current => [...current, { name: '', percent: '' }])}>Adicionar profissional</Button></section>
    <Field label="Justificativa e observações da precificação">{id => <Textarea id={id} name="justification" maxLength={2000} defaultValue={seed?.pricing.terms.justification} />}</Field>
    </fieldset><Failure message={error} /><div className="flex flex-wrap gap-3"><Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar proposta'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>Conferir composição</Button><Button type="button" variant="ghost" disabled={busy} onClick={back}>Voltar</Button></div>{preview && <PricingSummary pricing={preview} />}
  </form>;
}

export function PricingSummary({ pricing }: { pricing: FeePricing }) {
  return <section className="grid gap-4 py-5"><div className="grid gap-3 border-y border-line py-4 sm:grid-cols-3"><p className="text-sm">Contratação <span className="mt-2 block text-xl tabular-nums">{money(pricing.contractedCents)}</span></p><p className="text-sm">Êxito estimado <span className="mt-2 block text-xl tabular-nums">{money(pricing.contingentCents)}</span></p><p className="text-sm">Total estimado <span className="mt-2 block text-xl tabular-nums">{money(pricing.totalCents)}</span></p></div>{pricing.components.map((item, index) => <p key={index} className="text-sm">{item.label}: {item.formula} = {money(item.totalCents)}.</p>)}<p className="whitespace-pre-wrap text-sm">{pricing.terms.scope}</p><p className="whitespace-pre-wrap text-sm">{pricing.terms.paymentTerms}</p>{pricing.reference && <a className="text-sm underline" target="_blank" rel="noreferrer" href={pricing.reference.source}>OAB-{pricing.reference.uf} 2026 · {pricing.reference.code} · {pricing.reference.label}: {money(pricing.reference.fixedCents)}{pricing.reference.percent ? `; ${pricing.reference.percent}` : ''}</a>}{pricing.warnings.map((warning, i) => <p key={i} className="text-xs text-muted-foreground">{warning}</p>)}{pricing.terms.allocations.map((allocation, i) => <p className="text-sm" key={i}>Rateio previsto: {allocation.name}, {allocation.percent}%.</p>)}{pricing.terms.justification && <p className="text-sm">Justificativa: {pricing.terms.justification}</p>}</section>;
}
function BillComponent({ quote, index, saved }: { quote: FeeQuote; index: number; saved: (value: FeeQuote) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const running = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const component = quote.pricing.terms.components[index];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (running.current) return;
    const data = new FormData(event.currentTarget);
    const payload = { id: quote.id, version: quote.version, component: index, firstDueOn: data.get('date'), count: Number(data.get('count')), evidence: String(data.get('evidence')), ...(component.kind === 'percentage' && component.due === 'success' ? { realizedBaseCents: parseAmount(String(data.get('base'))) } : {}) };
    const fingerprint = JSON.stringify(payload); if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    running.current = true; setBusy(true); setError('');
    try { saved(await honorariosCall('quote-bill', { ...payload, idempotencyKey: attempt.current.key }, feeQuoteDto)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar as parcelas.'); }
    finally { setBusy(false); running.current = false; }
  }
  return <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 text-sm underline">{component.due === 'success' ? 'Confirmar êxito e gerar parcelas' : 'Registrar contratação e gerar parcelas'}</summary><form onSubmit={event => void submit(event)} className="grid gap-4 py-4"><fieldset disabled={busy} className="grid gap-4"><p className="text-sm">{component.condition || 'Registre a contratação aprovada antes de gerar valores a receber.'}</p><div className="grid gap-4 sm:grid-cols-2"><Field label={`Componente ${index + 1}: primeiro vencimento`}>{id => <Input id={id} name="date" type="date" required />}</Field><Field label={`Componente ${index + 1}: parcelas`}>{id => <Input id={id} name="count" type="number" min={1} max={120} defaultValue={component.kind === 'monthly' ? component.months : 1} required />}</Field></div>{component.kind === 'percentage' && component.due === 'success' && <Field label={`Componente ${index + 1}: benefício efetivamente obtido (R$)`}>{id => <Input id={id} name="base" inputMode="decimal" required />}</Field>}<Field label={`Componente ${index + 1}: evidência da contratação ou êxito`}>{id => <Textarea id={id} name="evidence" minLength={5} maxLength={2000} required />}</Field><Button className="justify-self-start" disabled={busy}>{busy ? 'Gerando…' : 'Gerar parcelas deste componente'}</Button></fieldset><Failure message={error} /></form></details>;
}
