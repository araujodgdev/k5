'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from '@/components/lume/canvas-navigation';
import { z } from 'zod';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import { BetaLabel } from '@/components/ads/beta-label';
import { CanvasHeader, CanvasPage, CanvasRow, CanvasSection } from '@/components/canvas/canvas-page';
import { Kpi, KpiRow } from '@/components/canvas/canvas-controls';
import { BackLink } from '@/components/agenda-detail';
import { EmptyRows, RowsLoading } from '@/components/agenda-rows';
import { VersionTabs } from '@/components/version-tabs';
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
  const title = <span className="inline-flex flex-wrap items-center gap-3">Propostas e contratos<BetaLabel /></span>;
  const toList = () => { setActive(null); setEditing(false); };
  if (editing) return <CanvasPage className="gap-6 md:gap-8">
    <div className="flex flex-col gap-3">
      <QuoteBack onClick={() => setEditing(false)} />
      <CanvasHeader eyebrow={active ? `Revisão da versão ${active.version}` : calculation ? `Base trazida do Calc: ${calculation.title}` : 'Nova proposta'} title={active ? <span className="break-words">{active.title}</span> : 'Nova proposta'} />
    </div>
    <Failure message={error} />
    <QuoteEditor key={active?.id ?? calculation?.id ?? 'new'} seed={active} calculation={calculation} saved={save} back={() => setEditing(false)} />
  </CanvasPage>;
  if (active) return <CanvasPage className="gap-6 md:gap-8">
    <div className="flex flex-col gap-3">
      <QuoteBack onClick={toList} />
      <CanvasHeader eyebrow={`${active.pricing.terms.uf === 'PE' ? 'Pernambuco' : 'Rio Grande do Sul'} · versão ${active.version} de ${active.latestVersion}`} title={<span className="break-words">{active.title}</span>}
        actions={<Button variant="outline" size="lg" className="max-md:h-11" disabled={loadingVersion || active.billed.length > 0 || active.version !== active.latestVersion} onClick={() => setEditing(true)}>Revisar proposta</Button>} />
    </div>
    <Failure message={error} />
    {active.latestVersion > 1 && <VersionTabs label="Versões da proposta" latest={active.latestVersion} current={active.version} onSelect={version => void openVersion(active.id, version)} />}
    <div className="flex flex-wrap items-center gap-2">
      <a className={download} href={`/api/honorarios/${active.id}/proposal?format=pdf&version=${active.version}`}><Download aria-hidden="true" />Baixar proposta PDF</a>
      <a className={download} href={`/api/honorarios/${active.id}/proposal?format=json&version=${active.version}`}><Download aria-hidden="true" />Baixar dados da proposta</a>
    </div>
    {active.version !== active.latestVersion && <p className="text-[13.5px] text-muted-foreground">Versão histórica. Abra a versão atual para registrar contratação ou êxito.</p>}
    <PricingSummary pricing={active.pricing} />
    <CanvasSection title="Componentes">
      <div className="flex flex-col gap-6">{active.pricing.components.map((component, index) => {
        const billed = active.billed.find(item => item.component === index);
        return <section key={index} aria-label={component.label} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="text-sm font-medium">{component.label}</h3><span className="font-mono text-[12.5px]">{money(component.totalCents)}{component.due === 'success' ? <span className="ml-1 font-sans text-xs text-muted-foreground">estimados</span> : ''}</span></div>
          {billed ? <p className="text-[13.5px] text-muted-foreground">Parcelas geradas: <span className="font-mono text-[12.5px] text-foreground">{money(billed.amountCents)}</span>. <Link className="text-foreground underline underline-offset-4" href={`/app/honorarios?agreementId=${billed.agreementId}`}>Abrir recebimentos</Link></p>
            : active.version === active.latestVersion && <BillComponent quote={active} index={index} saved={save} />}
        </section>;
      })}</div>
    </CanvasSection>
  </CanvasPage>;
  return <CanvasPage className="gap-5 md:gap-5">
    <div className="flex flex-col gap-3">
      <BackLink href="/app/honorarios">Honorários</BackLink>
      <CanvasHeader eyebrow="Tabelas OAB de PE e RS, edição 2026" title={title}
        actions={<Button variant="outline" size="lg" className="max-md:h-11" onClick={() => { setActive(null); setCalculation(null); setEditing(true); }}>Nova proposta</Button>} />
    </div>
    {error && <div className="flex flex-wrap items-center gap-3"><Failure message={error} /><Button variant="outline" onClick={() => { setQuotes(null); setRevision(value => value + 1); }}>Tentar novamente</Button></div>}
    {quotes === null ? !error && <RowsLoading label="Carregando propostas" rows={3} />
      : quotes.length === 0 ? <EmptyRows>Nenhuma proposta cadastrada. Consulte as referências de PE e RS e defina a contratação.</EmptyRows>
      : <div className="flex flex-col gap-0.5">{quotes.map(quote => <CanvasRow key={quote.id} stacked icon={<FileText />} title={quote.title}
        detail={`${quote.pricing.terms.uf} · versão ${quote.version} · ${quote.billed.length} ${quote.billed.length === 1 ? 'componente com parcelas' : 'componentes com parcelas'}`}
        meta={money(quote.pricing.totalCents)} status="estimados" onClick={() => setActive(quote)} label={quote.title} />)}</div>}
    <p className="text-xs text-subtle-foreground">Até 100 propostas recentes. Propostas são privadas; gerar parcelas de um caso permite a consulta dos valores pelos participantes.</p>
  </CanvasPage>;
}

const download = 'inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:h-[30px] [&_svg]:size-3.5';

function QuoteBack({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick}
    className="-ml-1.5 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:h-[26px]">
    <ArrowLeft aria-hidden="true" className="size-3.5" />Propostas
  </button>;
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
  return <form ref={form} onSubmit={event => { event.preventDefault(); void submit(true); }} onChange={() => setPreview(null)} className="grid min-w-0 gap-6"><fieldset disabled={busy} className="grid min-w-0 gap-5">
    <Field label="Título da proposta">{id => <Input id={id} name="title" required minLength={3} maxLength={180} defaultValue={seed?.title ?? 'Proposta de honorários'} />}</Field>
    <div className="grid gap-4 sm:grid-cols-2"><ReferenceSelect kind="clients" value={clientId} onChange={setClientId} /><ReferenceSelect kind="cases" value={caseId} onChange={setCaseId} optional /></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="UF do serviço">{id => <select id={id} className={controlClass} value={uf} onChange={event => { const value = event.target.value; if (value === 'PE' || value === 'RS') { setUf(value); setReferenceId(''); } }}><option value="PE">Pernambuco</option><option value="RS">Rio Grande do Sul</option></select>}</Field><Field label="Data de referência do serviço">{id => <Input id={id} name="serviceOn" type="date" required defaultValue={seed?.pricing.terms.serviceOn ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })} />}</Field></div>
    <Field label="Atividade na tabela OAB 2026">{id => <select id={id} className={controlClass} value={referenceId} onChange={event => setReferenceId(event.target.value)}><option value="">Outra atividade, consultar tabela integral</option>{oabCatalog.filter(item => item.uf === uf).map(item => <option key={item.id} value={item.id}>{item.code} · {item.area} · {item.label}</option>)}</select>}</Field>
    {reference && <div className="rounded-lg border border-border bg-card px-4 py-3.5 text-[13.5px]"><p>{money(reference.fixedCents)}{reference.percent ? ` · referência percentual: ${reference.percent}` : ''}</p><p className="mt-2">{reference.rule}</p><a className="mt-2 block text-foreground underline underline-offset-4" href={reference.source} target="_blank" rel="noreferrer">Abrir OAB-{uf}, edição 2026, página {reference.page}</a><p className="mt-2 text-xs text-muted-foreground">Referência consultada em 04/10/2026. Confira vigência e enquadramento. As colunas da tabela não são somadas automaticamente.</p></div>}
    {calculation && <p className="text-[13.5px] text-muted-foreground">Base trazida do Calc: {calculation.title}, versão {calculation.version}, {money(calculation.result.totalCents)}.</p>}
    <Field label="Escopo, atos e instâncias incluídos">{id => <Textarea id={id} name="scope" required minLength={5} maxLength={4000} defaultValue={seed?.pricing.terms.scope} />}</Field>
    <Field label="Condições de pagamento, despesas e hipótese de acordo">{id => <Textarea id={id} name="paymentTerms" required minLength={5} maxLength={4000} defaultValue={seed?.pricing.terms.paymentTerms} />}</Field>
    <section className="flex min-w-0 flex-col gap-3"><h2 className="text-[15px] font-semibold">Composição dos honorários</h2><div className="flex flex-col gap-10">{components.map((item, i) => <div key={i} className="grid min-w-0 gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label={`Componente ${i + 1}: descrição`}>{id => <Input id={id} required value={item.label} onChange={event => update(i, { label: event.target.value })} />}</Field><Field label={`Componente ${i + 1}: modalidade`}>{id => <select id={id} className={controlClass} value={item.kind} onChange={event => { const kind = z.enum(['fixed', 'hours', 'percentage', 'monthly']).parse(event.target.value); update(i, { kind }); }}><option value="fixed">Fixo / fase / ato</option><option value="hours">Por hora</option><option value="percentage">Percentual</option><option value="monthly">Mensalidade por período</option></select>}</Field></div>
      <div className="grid gap-4 sm:grid-cols-3">{item.kind === 'percentage' ? <><Field label={`Componente ${i + 1}: base (R$)`}>{id => <Input id={id} required inputMode="decimal" value={item.base} onChange={event => update(i, { base: event.target.value })} />}</Field><Field label={`Componente ${i + 1}: percentual (%)`}>{id => <Input id={id} required inputMode="decimal" value={item.percent} onChange={event => update(i, { percent: event.target.value })} />}</Field></> : <><Field label={`Componente ${i + 1}: valor ${item.kind === 'hours' ? 'por hora' : item.kind === 'monthly' ? 'mensal' : 'fixo'} (R$)`}>{id => <Input id={id} required inputMode="decimal" value={item.amount} onChange={event => update(i, { amount: event.target.value })} />}</Field>{item.kind !== 'fixed' && <Field label={`Componente ${i + 1}: ${item.kind === 'hours' ? 'horas' : 'meses'}`}>{id => <Input id={id} required inputMode="decimal" value={item.quantity} onChange={event => update(i, { quantity: event.target.value })} />}</Field>}</>}
      <Field label={`Componente ${i + 1}: exigibilidade`}>{id => <select id={id} className={controlClass} value={item.due} onChange={event => update(i, { due: event.target.value === 'success' ? 'success' : 'contract' })}><option value="contract">Conforme contratação</option><option value="success">Condicionado ao êxito</option></select>}</Field></div>
      <Field label={`Componente ${i + 1}: condição ou evento de êxito`}>{id => <Textarea id={id} value={item.condition} required={item.due === 'success'} onChange={event => update(i, { condition: event.target.value })} />}</Field>
      <Button className="justify-self-start" type="button" variant="ghost" disabled={components.length === 1} onClick={() => { setComponents(current => current.filter((_, index) => index !== i)); setPreview(null); }}>Remover componente {i + 1}</Button>
    </div>)}</div><Button variant="outline" type="button" className="self-start" disabled={components.length >= 20} onClick={() => { setComponents(current => [...current, emptyComponent()]); setPreview(null); }}>Adicionar componente</Button></section>
    <section className="grid gap-3"><h2 className="text-[15px] font-semibold">Rateio previsto</h2><p className="text-xs text-muted-foreground">Planejamento entre profissionais. Não transfere valores nem concede acesso à proposta.</p>{allocations.map((item, i) => <div key={i} className="grid gap-3 sm:grid-cols-3"><Field label={`Rateio ${i + 1}: profissional`}>{id => <Input id={id} required value={item.name} onChange={event => setAllocations(current => current.map((row, index) => index === i ? { ...row, name: event.target.value } : row))} />}</Field><Field label={`Rateio ${i + 1}: percentual`}>{id => <Input id={id} required value={item.percent} onChange={event => setAllocations(current => current.map((row, index) => index === i ? { ...row, percent: event.target.value.replace(',', '.') } : row))} />}</Field><Button className="self-end" type="button" variant="ghost" onClick={() => setAllocations(current => current.filter((_, index) => index !== i))}>Remover rateio {i + 1}</Button></div>)}<Button className="justify-self-start" type="button" variant="outline" onClick={() => setAllocations(current => [...current, { name: '', percent: '' }])}>Adicionar profissional</Button></section>
    <Field label="Justificativa e observações da precificação">{id => <Textarea id={id} name="justification" maxLength={2000} defaultValue={seed?.pricing.terms.justification} />}</Field>
    </fieldset><Failure message={error} /><div className="flex flex-wrap gap-2"><Button size="lg" className="max-md:h-11" disabled={busy}>{busy ? 'Salvando…' : 'Salvar proposta'}</Button><Button type="button" variant="outline" size="lg" className="max-md:h-11" disabled={busy} onClick={() => void submit(false)}>Conferir composição</Button><Button type="button" variant="ghost" size="lg" className="max-md:h-11" disabled={busy} onClick={back}>Voltar</Button></div>{preview && <PricingSummary pricing={preview} />}
  </form>;
}

export function PricingSummary({ pricing }: { pricing: FeePricing }) {
  return <section aria-label="Formação dos honorários" className="flex min-w-0 flex-col gap-4">
    <KpiRow>
      <Kpi label="Contratação" value={money(pricing.contractedCents)} />
      <Kpi label="Êxito estimado" value={money(pricing.contingentCents)} />
      <Kpi label="Total estimado" value={money(pricing.totalCents)} />
    </KpiRow>
    <div className="flex flex-col gap-2 text-[13.5px]">
      {pricing.components.map((item, index) => <p key={index}>{item.label}: <span className="text-muted-foreground">{item.formula}</span> = <span className="font-mono text-[12.5px]">{money(item.totalCents)}</span>.</p>)}
      <p className="whitespace-pre-wrap text-muted-foreground">{pricing.terms.scope}</p>
      <p className="whitespace-pre-wrap text-muted-foreground">{pricing.terms.paymentTerms}</p>
      {pricing.reference && <a className="self-start text-foreground underline underline-offset-4" target="_blank" rel="noreferrer" href={pricing.reference.source}>OAB-{pricing.reference.uf} 2026 · {pricing.reference.code} · {pricing.reference.label}: {money(pricing.reference.fixedCents)}{pricing.reference.percent ? `; ${pricing.reference.percent}` : ''}</a>}
      {pricing.warnings.map((warning, i) => <p key={i} className="text-xs text-muted-foreground">{warning}</p>)}
      {pricing.terms.allocations.map((allocation, i) => <p key={i}>Rateio previsto: {allocation.name}, {allocation.percent}%.</p>)}
      {pricing.terms.justification && <p>Justificativa: {pricing.terms.justification}</p>}
    </div>
  </section>;
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
  return <details><summary className="flex min-h-11 cursor-pointer items-center text-[13.5px] text-foreground underline underline-offset-4 md:min-h-8">{component.due === 'success' ? 'Confirmar êxito e gerar parcelas' : 'Registrar contratação e gerar parcelas'}</summary><form onSubmit={event => void submit(event)} className="grid gap-4 py-4"><fieldset disabled={busy} className="grid gap-4"><p className="text-sm">{component.condition || 'Registre a contratação aprovada antes de gerar valores a receber.'}</p><div className="grid gap-4 sm:grid-cols-2"><Field label={`Componente ${index + 1}: primeiro vencimento`}>{id => <Input id={id} name="date" type="date" required />}</Field><Field label={`Componente ${index + 1}: parcelas`}>{id => <Input id={id} name="count" type="number" min={1} max={120} defaultValue={component.kind === 'monthly' ? component.months : 1} required />}</Field></div>{component.kind === 'percentage' && component.due === 'success' && <Field label={`Componente ${index + 1}: benefício efetivamente obtido (R$)`}>{id => <Input id={id} name="base" inputMode="decimal" required />}</Field>}<Field label={`Componente ${index + 1}: evidência da contratação ou êxito`}>{id => <Textarea id={id} name="evidence" minLength={5} maxLength={2000} required />}</Field><Button className="justify-self-start" size="lg" disabled={busy}>{busy ? 'Gerando…' : 'Gerar parcelas deste componente'}</Button></fieldset><Failure message={error} /></form></details>;
}
