'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleAlert, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { WebSearchHistoryItem, WebSearchMode, WebSearchView } from '@/lib/research/contracts';
import { cn } from '@/lib/utils';

const modes: Array<{ value: WebSearchMode; label: string; hint: string }> = [
  { value: 'instant', label: 'Instantânea', hint: 'A resposta mais rápida, para consultas simples.' },
  { value: 'fast', label: 'Rápida', hint: 'Rápida, com um pouco mais de cuidado na busca.' },
  { value: 'auto', label: 'Automática', hint: 'A busca escolhe o melhor caminho para a pergunta.' },
  { value: 'deep', label: 'Profunda', hint: 'Pesquisa em várias etapas. Demora mais; use para questões difíceis.' },
];
const modeLabel = (mode: WebSearchMode) => modes.find(item => item.value === mode)?.label ?? mode;
const formatDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
function dateLabel(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : formatDate.format(parsed);
}
function updateLocation(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('search', id);
  else url.searchParams.delete('search');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
}
const tabStyle = (active: boolean) => cn('min-h-12 border-b-2 px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  active ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground');

export function ResearchWorkspace({ initialSearchId }: { initialSearchId: string | null }) {
  const [tab, setTab] = useState<'search' | 'history'>('search');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<WebSearchMode>('auto');
  const [view, setView] = useState<WebSearchView | null>(null);
  const [history, setHistory] = useState<WebSearchHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(!!initialSearchId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const show = (next: WebSearchView) => { setView(next); setQuery(next.query); setMode(next.mode); updateLocation(next.id); };


  useEffect(() => {
    if (!initialSearchId) return;
    let live = true;
    void requestCapability('k5_research_get_web_search', { searchId: initialSearchId }).then(response => {
      if (!live) return;
      if (response.ok) {
        const next = (response.data as { search: WebSearchView }).search;
        setView(next); setQuery(next.query); setMode(next.mode);
      } else { setError(response.error); updateLocation(null); }
      setLoading(false);
    });
    return () => { live = false; };
  }, [initialSearchId]);

  async function loadHistory() {
    setHistoryError('');
    const response = await requestCapability('k5_research_list_web_searches', {});
    if (response.ok) setHistory((response.data as { searches: WebSearchHistoryItem[] }).searches);
    else setHistoryError(response.error);
  }

  function changeTab(next: 'search' | 'history') {
    setTab(next);
    if (next === 'history' && history === null) void loadHistory();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2 || busy) return;
    setBusy(true); setError(''); setView(null);
    const response = await requestCapability('k5_research_web_search', { query: query.trim(), mode });
    if (response.ok) {
      show((response.data as { search: WebSearchView }).search);
      setHistory(null);
      requestAnimationFrame(() => resultHeading.current?.focus());
    } else setError(response.error);
    setBusy(false);
  }

  async function open(id: string) {
    setTab('search');
    if (view?.id === id) return;
    setLoading(true); setError('');
    const response = await requestCapability('k5_research_get_web_search', { searchId: id });
    if (response.ok) show((response.data as { search: WebSearchView }).search);
    else setError(response.error);
    setLoading(false);
  }

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10">
    <div className="border-b pb-5"><h1 className="page-title leading-none max-md:sr-only">Pesquisa</h1></div>
    <nav aria-label="Visões da pesquisa" className="flex gap-5 border-b">
      <button type="button" aria-current={tab === 'search' ? 'page' : undefined} onClick={() => changeTab('search')} className={tabStyle(tab === 'search')}>Pesquisar</button>
      <button type="button" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => changeTab('history')} className={tabStyle(tab === 'history')}>Histórico</button>
    </nav>

    {tab === 'history' ? <section aria-label="Histórico de pesquisas" className="py-5">
      {historyError ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{historyError}</p><Button variant="outline" onClick={() => void loadHistory()}>Tentar novamente</Button></div>
        : history === null ? <p role="status" className="py-8 text-sm text-muted-foreground">Carregando histórico…</p>
        : history.length === 0 ? <p className="py-10 text-sm text-subtle-foreground">Suas pesquisas aparecem aqui.</p>
        : <div className="border-t">{history.map(item => <button key={item.id} type="button" onClick={() => void open(item.id)} aria-current={view?.id === item.id ? 'true' : undefined}
          className="flex min-h-14 w-full items-center justify-between gap-4 border-b py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0"><span className="block truncate text-sm">{item.query}</span><span className="mt-1 block text-[13px] text-muted-foreground">{modeLabel(item.mode)} · {item.resultCount} {item.resultCount === 1 ? 'resultado' : 'resultados'}</span></span>
          <span className="label-mono shrink-0 text-subtle-foreground">{dateLabel(item.createdAt)}</span>
        </button>)}</div>}
    </section> : <>
      <form onSubmit={submit} className="grid gap-4 border-b py-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-1.5"><Label htmlFor="research-query">O que você quer pesquisar?</Label><Input id="research-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ex.: guarda de menor pela avó" minLength={2} maxLength={400} required className="h-11 md:h-9" /></div>
          <Button type="submit" disabled={busy || query.trim().length < 2} className="min-h-11 md:min-h-9">{busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search aria-hidden="true" />}Pesquisar</Button>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">Tipo de busca</legend>
          <div className="grid grid-cols-2 sm:flex">{modes.map(item => <label key={item.value}
            className={cn('-mt-px -ml-px flex min-h-11 cursor-pointer items-center justify-center border border-input px-4 text-sm transition-colors duration-200 ease-(--ease) has-focus-visible:ring-2 has-focus-visible:ring-ring md:min-h-9',
              mode === item.value ? 'relative bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <input type="radio" name="research-mode" value={item.value} checked={mode === item.value} onChange={() => setMode(item.value)} className="sr-only" />{item.label}
          </label>)}</div>
          <p className="text-[13px] text-muted-foreground">{modes.find(item => item.value === mode)?.hint}</p>
        </fieldset>
      </form>

      {error && <p role="alert" className="flex items-start gap-2 py-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {loading ? <p role="status" className="py-8 text-sm text-muted-foreground">Carregando pesquisa…</p>
        : busy ? <p role="status" className="py-10 text-sm text-muted-foreground">{mode === 'deep' ? 'Pesquisando em profundidade. Isso pode levar um minuto…' : 'Pesquisando na web…'}</p>
        : view ? <section aria-labelledby="research-results-heading" className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="research-results-heading" ref={resultHeading} tabIndex={-1} className="text-base font-medium outline-none">Resultados</h2><span className="text-[13px] text-muted-foreground">{modeLabel(view.mode)} · {view.results.length} {view.results.length === 1 ? 'página' : 'páginas'}</span></div>
          {view.results.length === 0 ? <p className="py-10 text-sm text-subtle-foreground">Nada encontrado. Tente outros termos ou a busca profunda.</p>
            : <div className="mt-3 border-t">{view.results.map(result => <ResultRow key={result.url} result={result} />)}</div>}
          <p className="pt-4 text-[13px] text-subtle-foreground">Resultados da web aberta. Confira a fonte antes de citar.</p>
        </section>
        : !error && <p className="py-10 text-sm text-subtle-foreground">Pesquise um tema para consultar a web.</p>}
    </>}
  </div>;
}

function ResultRow({ result }: { result: WebSearchView['results'][number] }) {
  const date = dateLabel(result.publishedDate);
  return <a href={result.url} target="_blank" rel="noopener noreferrer" className="group block border-b py-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
    <span className="block text-[13px] text-muted-foreground">{result.host}{date ? ` · ${date}` : ''}</span>
    <span className="mt-1 flex items-start gap-1.5 text-sm font-medium">{result.title}<ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--ease) group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /><span className="sr-only"> (abre em nova aba)</span></span>
    {result.excerpt && <span className="mt-1.5 block line-clamp-3 text-sm leading-6 text-muted-foreground">{result.excerpt}</span>}
  </a>;
}
