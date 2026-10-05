'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { BetaLabel } from '@/components/ads/beta-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Failure } from '@/components/honorarios/fields';
import { money } from '@/components/honorarios/editor';
import { calculators, calculationsList, savedCalculation, type CalculationKind, type SavedCalculation } from '@/lib/calc/contracts';
import { CalcForm, calcCall } from './form';
import { CalcResult } from './result';

type View = { kind: 'list' } | { kind: 'edit'; calculator: CalculationKind; seed?: SavedCalculation; key: number } | { kind: 'detail'; value: SavedCalculation };
export function CalcPanel() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [list, setList] = useState<z.infer<typeof calculationsList> | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void calcCall('list', { query: filter, offset }, calculationsList, controller.signal).then(value => { setList(value); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os cálculos.'); });
    return () => controller.abort();
  }, [filter, offset, revision]);
  async function open(id: string, version?: number) {
    setBusy(true); setError('');
    try { const value = await calcCall('get', { id, version }, savedCalculation); setView({ kind: 'detail', value }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir.'); }
    finally { setBusy(false); }
  }
  const back = () => { setView({ kind: 'list' }); setRevision(value => value + 1); };
  return <div className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
    <header className="border-b border-line pb-6"><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Calc</p><div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-medium tracking-tight md:text-4xl">Cálculos jurídicos</h1><BetaLabel /></div></header>
    <div className="py-3"><Failure message={error} /></div>
    {view.kind === 'edit' ? <CalcForm key={view.key} kind={view.calculator} seed={view.seed} saved={value => { setView({ kind: 'detail', value }); setRevision(current => current + 1); }} back={back} /> : view.kind === 'detail' ? <>
      <div className="flex flex-wrap items-center justify-between gap-4 py-4"><div><h2 className="text-xl font-medium">{view.value.title}</h2><p className="mt-1 text-xs text-muted-foreground">Salvo em {new Date(view.value.createdAt).toLocaleString('pt-BR')} · versão {view.value.version}</p></div><Button variant="ghost" onClick={back}>Voltar aos cálculos</Button></div>
      <div className="flex flex-wrap items-center gap-3 border-y border-line py-4"><Button onClick={() => setView({ kind: 'edit', calculator: view.value.input.kind, seed: view.value, key: Date.now() })}>Revisar parâmetros</Button><Button variant="outline" onClick={() => setView({ kind: 'edit', calculator: view.value.input.kind, seed: { ...view.value, id: '', title: `${view.value.title} · cópia`, latestVersion: 0 }, key: Date.now() })}>Duplicar cenário</Button><label className="flex items-center gap-2 text-sm">Versão<select className="min-h-11 border border-input bg-background" disabled={busy} value={view.value.version} onChange={event => void open(view.value.id, Number(event.target.value))}>{Array.from({ length: view.value.latestVersion }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label></div>
      <CalcResult result={view.value.result} saved={view.value} />
      {view.value.result.totalCents > 0 && <Link className="inline-flex min-h-11 items-center text-sm underline" href={`/app/honorarios/propostas?calculationId=${view.value.id}&version=${view.value.version}`}>Usar resultado como base de honorários</Link>}
      <details className="border-t border-line py-4"><summary className="cursor-pointer text-sm">Observações e comparação com a versão anterior</summary><p className="mt-3 whitespace-pre-wrap text-sm">{view.value.notes || 'Sem observações.'}</p>{view.value.version > 1 && <Comparison id={view.value.id} version={view.value.version - 1} current={view.value.result.totalCents} />}</details>
    </> : <>
      <section className="grid border-t border-l border-line sm:grid-cols-2 xl:grid-cols-3" aria-label="Novo cálculo">{calculators.map(item => <button key={item.kind} className="min-w-0 border-r border-b border-line p-5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setView({ kind: 'edit', calculator: item.kind, key: Date.now() })}><span className="block text-lg font-medium">{item.name}</span><span className="mt-3 block text-sm text-muted-foreground">{item.description}</span><span className="mt-5 block text-xs underline">Novo cálculo</span></button>)}</section>
      <section className="mt-10"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-medium">Meus cálculos</h2><Button variant="ghost" onClick={() => { setList(null); setRevision(value => value + 1); }}>Atualizar</Button></div>
        <form className="flex gap-3 py-4" onSubmit={event => { event.preventDefault(); setList(null); setOffset(0); setFilter(query); setRevision(value => value + 1); }}><Input aria-label="Buscar cálculos" value={query} onChange={event => setQuery(event.target.value)} maxLength={180} /><Button variant="outline">Buscar</Button></form>
        {!list ? <p role="status" className="py-6">{error ? 'A consulta falhou. Use Atualizar para tentar novamente.' : 'Carregando cálculos…'}</p> : list.items.length === 0 ? <p className="border-y py-8 text-sm text-muted-foreground">Nenhum cálculo salvo para esta busca.</p> : <div className="divide-y border-y border-line">{list.items.map(item => <button disabled={busy} key={item.id} onClick={() => void open(item.id)} className="flex min-h-16 w-full flex-wrap items-center justify-between gap-3 py-4 text-left hover:bg-accent"><span className="min-w-0 break-words"><span className="block font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">Versão {item.version} · {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span></span><span className="tabular-nums">{money(item.totalCents)}</span></button>)}</div>}
        {list && list.total > 50 && <div className="flex items-center gap-3 py-4"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Anterior</Button><span className="text-sm">{offset + 1}–{Math.min(offset + 50, list.total)} de {list.total}</span><Button variant="outline" disabled={offset + 50 >= list.total} onClick={() => setOffset(value => value + 50)}>Próxima</Button></div>}
      </section>
    </>}
  </div>;
}
function Comparison({ id, version, current }: { id: string; version: number; current: number }) {
  const [previous, setPrevious] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); void calcCall('get', { id, version }, savedCalculation, controller.signal).then(value => setPrevious(value.result.totalCents)).catch(() => { if (!controller.signal.aborted) setError('Não foi possível comparar as versões.'); }); return () => controller.abort(); }, [id, version]);
  return <p className="mt-3 text-sm">{error || (previous === null ? 'Carregando comparação…' : `Versão ${version}: ${money(previous)}. Diferença desta versão: ${money(current - previous)}.`)}</p>;
}
