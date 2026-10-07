'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Calculator } from 'lucide-react';
import { BetaLabel } from '@/components/ads/beta-label';
import { CanvasCard, CanvasHeader, CanvasPage, CanvasRow, CanvasSection } from '@/components/canvas/canvas-page';
import { EmptyRows, RowsLoading } from '@/components/agenda-rows';
import { SearchField } from '@/components/agenda-filters';
import { VersionTabs } from '@/components/version-tabs';
import { Button } from '@/components/ui/button';
import { Failure } from '@/components/honorarios/fields';
import { money } from '@/components/honorarios/editor';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { calculators, calculationsList, savedCalculation, type CalculationKind, type SavedCalculation } from '@/lib/calc/contracts';
import { CalcBack, CalcForm, calcCall } from './form';
import { CalcResult } from './result';

const PAGE = 50;
type View = { kind: 'list' } | { kind: 'edit'; calculator: CalculationKind; seed?: SavedCalculation; key: number } | { kind: 'detail'; value: SavedCalculation };

/** Cálculos as a canvas module: the calculators as cards, then the saved calculations as rows. */
export function CalcPanel() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [list, setList] = useState<z.infer<typeof calculationsList> | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void calcCall('list', { query: search, offset }, calculationsList, controller.signal).then(value => { setList(value); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os cálculos.'); });
    return () => controller.abort();
  }, [search, offset, revision]);
  async function open(id: string, version?: number) {
    setBusy(true); setError('');
    try { const value = await calcCall('get', { id, version }, savedCalculation); setView({ kind: 'detail', value }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir.'); }
    finally { setBusy(false); }
  }
  const back = () => { setView({ kind: 'list' }); setRevision(value => value + 1); };
  const title = <span className="inline-flex flex-wrap items-center gap-3">Cálculos<BetaLabel /></span>;

  if (view.kind === 'edit') return <CanvasPage className="gap-5 md:gap-6">
    <CalcForm key={view.key} kind={view.calculator} seed={view.seed} saved={value => { setView({ kind: 'detail', value }); setRevision(current => current + 1); }} back={back} />
  </CanvasPage>;

  if (view.kind === 'detail') {
    const value = view.value;
    const kindName = calculators.find(item => item.kind === value.input.kind)?.name;
    return <CanvasPage className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <CalcBack onClick={back} />
        <CanvasHeader eyebrow={[kindName, `versão ${value.version} de ${value.latestVersion}`, `salvo em ${new Date(value.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`].filter(Boolean).join(' · ')}
          title={<span className="break-words">{value.title}</span>}
          actions={<>
            <Button variant="ghost" size="lg" className="text-muted-foreground max-md:h-11" onClick={() => setView({ kind: 'edit', calculator: value.input.kind, seed: { ...value, id: '', title: `${value.title} · cópia`, latestVersion: 0 }, key: Date.now() })}>Duplicar cenário</Button>
            <Button variant="outline" size="lg" className="max-md:h-11" onClick={() => setView({ kind: 'edit', calculator: value.input.kind, seed: value, key: Date.now() })}>Revisar parâmetros</Button>
          </>} />
      </div>
      <Failure message={error} />
      {value.latestVersion > 1 && <div className="flex flex-col gap-2">
        <VersionTabs label="Versões do cálculo" latest={value.latestVersion} current={value.version} onSelect={version => void open(value.id, version)} />
        {busy && <span role="status" className="text-[13px] text-muted-foreground">Abrindo versão…</span>}
      </div>}
      <CalcResult result={value.result} saved={value} />
      {value.result.totalCents > 0 && <Link className="inline-flex min-h-11 items-center self-start rounded-sm text-[13.5px] text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring md:min-h-8" href={`/app/honorarios/propostas?calculationId=${value.id}&version=${value.version}`}>Usar resultado como base de honorários</Link>}
      <CanvasSection title="Observações">
        <p className="max-w-[68ch] text-[14.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{value.notes || 'Sem observações.'}</p>
        {value.version > 1 && <Comparison id={value.id} version={value.version - 1} current={value.result.totalCents} />}
      </CanvasSection>
    </CanvasPage>;
  }

  return <CanvasPage className="gap-8 md:gap-10">
    <CanvasHeader eyebrow="Correção, juros, restituições e rescisões, com memória preservada por versão" title={title} />
    <CanvasSection title="Novo cálculo" label="Novo cálculo">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3">
        {calculators.map(item => <CanvasCard key={item.kind} onClick={() => setView({ kind: 'edit', calculator: item.kind, key: Date.now() })} className="gap-1.5 p-4">
          <span className="text-sm font-medium">{item.name}</span>{' '}
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{item.description}</span>
        </CanvasCard>)}
      </div>
    </CanvasSection>
    <CanvasSection title="Meus cálculos">
      <SearchField label="Buscar cálculos" value={query} onChange={value => { setQuery(value); setOffset(0); }} className="max-md:w-full" />
      {error && <div className="flex flex-wrap items-center gap-3"><Failure message={error} /><Button variant="outline" onClick={() => { setList(null); setRevision(value => value + 1); }}>Tentar novamente</Button></div>}
      {!list ? !error && <RowsLoading label="Carregando cálculos" rows={3} />
        : list.items.length === 0 ? <EmptyRows>{search ? 'Nenhum cálculo salvo para esta busca.' : 'Nenhum cálculo salvo ainda.'}</EmptyRows>
        : <div className="flex flex-col gap-0.5">{list.items.map(item => <CanvasRow key={item.id} stacked icon={<Calculator />} title={item.title}
          detail={`Versão ${item.version} · atualizado em ${new Date(item.updatedAt).toLocaleDateString('pt-BR')}`} meta={money(item.totalCents)}
          onClick={busy ? undefined : () => void open(item.id)} label={item.title} />)}</div>}
      {list && list.total > PAGE && <div className="flex items-center justify-between gap-3 pt-2">
        <span className="font-mono text-[12.5px] text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, list.total)} de {list.total}</span>
        <div className="flex gap-1"><Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE))}>Anterior</Button><Button variant="ghost" disabled={offset + PAGE >= list.total} onClick={() => setOffset(value => value + PAGE)}>Próxima</Button></div>
      </div>}
    </CanvasSection>
  </CanvasPage>;
}

function Comparison({ id, version, current }: { id: string; version: number; current: number }) {
  const [previous, setPrevious] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); void calcCall('get', { id, version }, savedCalculation, controller.signal).then(value => setPrevious(value.result.totalCents)).catch(() => { if (!controller.signal.aborted) setError('Não foi possível comparar as versões.'); }); return () => controller.abort(); }, [id, version]);
  return <p className="text-[13.5px] text-muted-foreground">{error || (previous === null ? 'Carregando comparação…' : <>Versão {version}: <span className="font-mono text-[12.5px] text-foreground">{money(previous)}</span>. Diferença desta versão: <span className="font-mono text-[12.5px] text-foreground">{money(current - previous)}</span>.</>)}</p>;
}
