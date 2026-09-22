'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, ChevronDown, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { OfficeRole } from '@/lib/offices';
import type { CorpusPage, JudgmentSummary, ResearchSearchView, SearchHistoryItem } from '@/lib/research/contracts';
import { researchSourceMessage } from '@/lib/research/messages';

const formatDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
function dateLabel(value: string | null | undefined) {
  if (!value) return 'Data não informada';
  const parsed = new Date(value.includes('T') ? value : value.includes(' ') ? `${value.replace(' ', 'T')}Z` : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : formatDate.format(parsed);
}
function body<T>(result: Awaited<ReturnType<typeof requestCapability>>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}
function materialLabel(result: JudgmentSummary) {
  if (result.fullTextStatus === 'ready') return 'Inteiro teor disponível';
  if (result.fullTextStatus === 'pending') return 'Inteiro teor ainda não obtido';
  if (['fetching', 'processing'].includes(result.fullTextStatus)) return 'Inteiro teor em obtenção';
  if (result.fullTextStatus === 'restricted') return 'Inteiro teor restrito';
  if (result.fullTextStatus === 'failed') return 'Falha na obtenção do inteiro teor';
  return 'Inteiro teor indisponível';
}
function active(view: ResearchSearchView | null) {
  return !!view && (['queued', 'running'].includes(view.status) || view.pages.some(page =>
    ['queued', 'running'].includes(page.status)));
}
function updateLocation(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('search', id);
  else url.searchParams.delete('search');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
}

export function ResearchWorkspace({ role, initialSearchId }: { role: OfficeRole; initialSearchId: string | null }) {
  const canWrite = role !== 'reviewer';
  const [theme, setTheme] = useState('');
  const [court, setCourt] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [includeSources, setIncludeSources] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ResearchSearchView | null>(null);
  const [local, setLocal] = useState<CorpusPage | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(!!initialSearchId);
  const [busy, setBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollBlockedSearchId, setPollBlockedSearchId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const restoreSearchId = useRef(initialSearchId);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const responses = await Promise.allSettled([
        requestCapability('k5_research_list_history', {}),
        initialSearchId ? requestCapability('k5_research_get_search', { searchId: initialSearchId }) : Promise.resolve(null),
      ]);
      if (!live) return;
      if (responses[0].status === 'fulfilled' && responses[0].value.ok) setHistory((responses[0].value.data as { searches: SearchHistoryItem[] }).searches);
      if (initialSearchId) {
        const result = responses[1];
        if (result.status === 'fulfilled' && result.value?.ok) {
          const next = (result.value.data as { search: ResearchSearchView }).search;
          setView(next); setTheme(next.theme); setCourt(next.filters.court ?? '');
          setFromDate(next.filters.fromDate ?? ''); setToDate(next.filters.toDate ?? '');
          setIncludeSources(next.includeSources); setHasSearched(true);
        } else setError(result.status === 'fulfilled' && result.value && !result.value.ok ? result.value.error : 'Não foi possível abrir a pesquisa.');
      }
      setLoading(false);
    };
    void load();
    return () => { live = false; };
  }, [initialSearchId]);

  useEffect(() => {
    if (!view || loading || restoreSearchId.current !== view.id) return;
    const frame = requestAnimationFrame(() => {
      const position = sessionStorage.getItem(`research:scroll:${view.id}`);
      if (position && scroller.current) scroller.current.scrollTop = Number(position);
      restoreSearchId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, loading]);

  useEffect(() => {
    if (!view || !active(view) || pollBlockedSearchId === view.id) return;
    const searchId = view.id;
    let cancelled = false;
    let running = false;
    const timer = window.setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      const response = await requestCapability('k5_research_get_search', { searchId });
      running = false;
      if (cancelled) return;
      if (response.ok) setView(current => current?.id === searchId ? (response.data as { search: ResearchSearchView }).search : current);
      else { setError(response.error); setPollBlockedSearchId(searchId); }
    }, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [view, pollBlockedSearchId]);

  function filters() {
    return { ...(court.trim() ? { court: court.trim() } : {}), ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (theme.trim().length < 2 || busy) return;
    setBusy(true); setError(''); setPollBlockedSearchId(null); setHasSearched(true); setLocal(null); setView(null);
    try {
      if (canWrite) {
        const next = body<{ search: ResearchSearchView }>(await requestCapability('k5_research_start_search', {
          theme: theme.trim(), filters: filters(), includeSources, idempotencyKey: crypto.randomUUID(),
        })).search;
        setView(next); updateLocation(next.id);
        const response = await requestCapability('k5_research_list_history', {});
        if (response.ok) setHistory((response.data as { searches: SearchHistoryItem[] }).searches);
      } else {
        setLocal(body<CorpusPage>(await requestCapability('k5_research_search_corpus', { theme: theme.trim(), filters: filters() })));
        updateLocation(null);
      }
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível pesquisar.'); }
    finally { setBusy(false); }
  }

  async function openHistory(id: string) {
    if (view?.id === id) return;
    restoreSearchId.current = id;
    setLoading(true); setError(''); setPollBlockedSearchId(null); setLocal(null);
    const response = await requestCapability('k5_research_get_search', { searchId: id });
    if (response.ok) {
      const next = (response.data as { search: ResearchSearchView }).search;
      setView(next); setTheme(next.theme); setCourt(next.filters.court ?? '');
      setFromDate(next.filters.fromDate ?? ''); setToDate(next.filters.toDate ?? '');
      setIncludeSources(next.includeSources); setHasSearched(true); updateLocation(next.id);
    } else setError(response.error);
    setLoading(false);
  }

  async function nextPage() {
    if (pageBusy) return;
    setPageBusy(true); setError('');
    try {
      if (view) {
        const cursor = view.pages.at(-1)?.nextCursor;
        if (!cursor) return;
        body(await requestCapability('k5_research_request_page', { searchId: view.id, cursor, idempotencyKey: crypto.randomUUID() }));
        setView(body<{ search: ResearchSearchView }>(await requestCapability('k5_research_get_search', { searchId: view.id })).search);
      } else if (local?.nextCursor) {
        const next = body<CorpusPage>(await requestCapability('k5_research_search_corpus', { theme: theme.trim(), filters: filters(), cursor: local.nextCursor }));
        setLocal({ ...next, results: [...local.results, ...next.results] });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais resultados.'); }
    finally { setPageBusy(false); }
  }

  async function cancelDownloads() {
    if (!view) return;
    setPageBusy(true); setError('');
    try {
      body(await requestCapability('k5_research_cancel_downloads', { searchId: view.id, idempotencyKey: crypto.randomUUID() }));
      setView(body<{ search: ResearchSearchView }>(await requestCapability('k5_research_get_search', { searchId: view.id })).search);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível parar a obtenção.'); }
    finally { setPageBusy(false); }
  }

  async function refreshSources() {
    if (!view || busy) return;
    setBusy(true); setError(''); setPollBlockedSearchId(null);
    try {
      const next = body<{ search: ResearchSearchView }>(await requestCapability('k5_research_start_search', {
        theme: view.theme, filters: view.filters, includeSources: true, refreshSources: true,
        idempotencyKey: crypto.randomUUID(),
      })).search;
      setView(next); updateLocation(next.id);
      const response = await requestCapability('k5_research_list_history', {});
      if (response.ok) setHistory((response.data as { searches: SearchHistoryItem[] }).searches);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar as fontes.'); }
    finally { setBusy(false); }
  }

  const pages = view?.pages ?? [];
  const results = view ? pages.flatMap(page => page.results) : (local?.results ?? []);
  const nextCursor = view ? pages.at(-1)?.nextCursor : local?.nextCursor;
  const pending = pages.reduce((total, page) => total + page.progress.pending, 0);
  const ready = pages.reduce((total, page) => total + page.progress.ready, 0);
  const unavailable = pages.reduce((total, page) => total + page.progress.unavailable + page.progress.failed, 0);
  const sourceErrors = pages.flatMap(page => page.sourceError ? [page.sourceError] : []);

  return <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
    <div className="flex items-end justify-between gap-4 border-b pb-5"><h1 className="display text-[28px] leading-none">Pesquisa</h1></div>
    <form onSubmit={submit} className="border-b py-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-1.5"><Label htmlFor="research-theme">Tema ou questão jurídica</Label><Input id="research-theme" value={theme} onChange={event => setTheme(event.target.value)} placeholder="Ex.: guarda de menor pela avó" minLength={2} maxLength={300} required className="h-11 md:h-9" /></div>
        <Button type="submit" disabled={busy || theme.trim().length < 2} className="min-h-11 md:min-h-9">{busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search aria-hidden="true" />}Pesquisar</Button>
      </div>
      <button type="button" className="mt-3 flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-expanded={filtersOpen} aria-controls="research-filters" onClick={() => setFiltersOpen(value => !value)}>Filtros e escopo <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} /></button>
      <div id="research-filters" className={`${filtersOpen ? 'grid' : 'hidden'} mt-3 gap-4 md:grid md:grid-cols-[minmax(0,1fr)_10rem_10rem]`}>
        <div className="grid gap-1.5"><Label htmlFor="research-court">Tribunal</Label><Input id="research-court" value={court} onChange={event => setCourt(event.target.value)} placeholder="Todos" maxLength={40} className="h-11 md:h-9" /></div>
        <div className="grid gap-1.5"><Label htmlFor="research-from">De</Label><Input id="research-from" type="date" value={fromDate} max={toDate || undefined} onChange={event => setFromDate(event.target.value)} className="h-11 md:h-9" /></div>
        <div className="grid gap-1.5"><Label htmlFor="research-to">Até</Label><Input id="research-to" type="date" value={toDate} min={fromDate || undefined} onChange={event => setToDate(event.target.value)} className="h-11 md:h-9" /></div>
        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm md:col-span-3"><legend className="mb-1 text-sm font-medium">Onde pesquisar</legend>
          <label className="flex min-h-11 items-center gap-2 md:min-h-8"><input type="radio" name="research-scope" checked={!includeSources} onChange={() => setIncludeSources(false)} className="accent-foreground" />Acervo</label>
          {canWrite && <label className="flex min-h-11 items-center gap-2 md:min-h-8"><input type="radio" name="research-scope" checked={includeSources} onChange={() => setIncludeSources(true)} className="accent-foreground" />Acervo e fontes</label>}
        </fieldset>
      </div>
    </form>

    {error && <p role="alert" className="flex items-start gap-2 py-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {loading && <p className="py-8 text-sm text-muted-foreground">Carregando pesquisa…</p>}
    {!loading && <section aria-labelledby="research-results-heading" className="py-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="research-results-heading" ref={resultHeading} tabIndex={-1} className="text-base font-medium outline-none">Resultados</h2>{hasSearched && <span className="text-[13px] text-muted-foreground">{results.length} {results.length === 1 ? 'julgado' : 'julgados'} nesta consulta</span>}</div>
      {view && pages.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground" aria-live="polite"><span>Inteiro teor: {ready} prontos · {pending} pendentes · {unavailable} indisponíveis</span>{active(view) && <span>Consultando fontes e obtendo materiais…</span>}{canWrite && pending > 0 && <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pageBusy} onClick={() => void cancelDownloads()}>Parar obtenção</Button>}{canWrite && view.includeSources && !active(view) && <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={busy} onClick={() => void refreshSources()}>Atualizar fontes</Button>}</div>}
      {sourceErrors.length > 0 && <p className="mt-3 text-sm text-muted-foreground" role="status">Resultados parciais. {researchSourceMessage(sourceErrors[0])}</p>}
      {!hasSearched && <p className="py-10 text-sm text-subtle-foreground">Pesquise um tema para consultar julgados do acervo.</p>}
      {hasSearched && busy && <p className="py-10 text-sm text-muted-foreground">Pesquisando o acervo…</p>}
      {hasSearched && !busy && !error && results.length === 0 && <p className="py-10 text-sm text-subtle-foreground">{active(view) ? 'Consultando fontes. Os resultados aparecem aqui quando estiverem prontos.' : 'Nenhum julgado encontrado. Tente outros termos ou filtros.'}</p>}
      {results.map((result, index) => <ResultRow key={`${'resultId' in result ? result.resultId : result.id}-${index}`} result={result} searchId={view?.id ?? null} onOpen={() => { if (view && scroller.current) sessionStorage.setItem(`research:scroll:${view.id}`, String(scroller.current.scrollTop)); }} />)}
      {nextCursor && <div className="py-5"><Button type="button" variant="outline" disabled={pageBusy} onClick={() => void nextPage()} className="min-h-11 md:min-h-9">{pageBusy ? 'Carregando…' : 'Mais resultados'}</Button></div>}
    </section>}

    {history.length > 0 && <section aria-labelledby="research-history-heading" className="mt-4 border-t py-5"><h2 id="research-history-heading" className="text-base font-medium">Histórico</h2><div className="mt-3">{history.map(item => <button key={item.id} type="button" onClick={() => void openHistory(item.id)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-current={view?.id === item.id ? 'true' : undefined}><span className="min-w-0 truncate">{item.theme}</span><span className="shrink-0 text-[13px] text-muted-foreground">{dateLabel(item.createdAt)}</span></button>)}</div></section>}
  </div>;
}

function ResultRow({ result, searchId, onOpen }: { result: JudgmentSummary; searchId: string | null; onOpen: () => void }) {
  const href = `/app/research/judgments/${encodeURIComponent(result.id)}${searchId ? `?search=${encodeURIComponent(searchId)}` : ''}`;
  return <Link href={href} onClick={onOpen} className="block min-h-24 border-b py-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="block text-[13px] text-muted-foreground">{result.tribunal}{result.courtUnit ? ` · ${result.courtUnit}` : ''} · {dateLabel(result.decisionDate)}</span><span className="mt-1 block text-sm font-medium">{result.title || result.caseNumber || 'Julgado'}</span>{result.ementa && <span className="mt-1.5 block line-clamp-3 text-sm leading-6 text-muted-foreground">{result.ementa}</span>}<span className="mt-2 block text-[13px] text-subtle-foreground">{result.caseNumber ? `${result.caseNumber} · ` : ''}{materialLabel(result)}</span></Link>;
}
