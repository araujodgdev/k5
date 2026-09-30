'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Search, LoaderCircle, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sectionTab, sectionTabRow } from '@/components/section-tabs';
import { requestCapability } from '@/lib/capabilities/http-client';
import { researchCapabilities } from '@/lib/capabilities/research';
import type { OfficeRole } from '@/lib/offices';
import type { JudgmentSummary, ResearchSearchView, SearchHistoryItem } from '@/lib/research/contracts';

export function JurisprudenceWorkspace({ initialSearchId, role }: { initialSearchId: string | null; role: OfficeRole }) {
  const [tab, setTab] = useState<'search' | 'history'>('search');
  const [theme, setTheme] = useState('');
  const [court, setCourt] = useState('');
  const [includeSources, setIncludeSources] = useState(false);
  const [view, setView] = useState<ResearchSearchView | null>(null);
  const [localResults, setLocalResults] = useState<JudgmentSummary[] | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canStart = role === 'administrator' || role === 'lawyer';
  const searchId = view?.id;
  const pending = view?.pages.some(page => page.status === 'queued' || page.status === 'running' || page.progress.pending > 0);
  useEffect(() => {
    if (!initialSearchId) return;
    const controller = new AbortController();
    void requestCapability('k5_research_get_search', { searchId: initialSearchId }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) { const parsed = researchCapabilities.k5_research_get_search.output.parse(response.data); setView(parsed.search); setTheme(parsed.search.theme); }
      else setError(response.error);
    });
    return () => controller.abort();
  }, [initialSearchId]);
  useEffect(() => {
    if (!pending || !searchId) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void requestCapability('k5_research_get_search', { searchId }, controller.signal).then(response => {
        if (controller.signal.aborted) return;
        if (response.ok) setView(researchCapabilities.k5_research_get_search.output.parse(response.data).search);
        else setError(response.error);
      });
    }, 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pending, searchId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const filters = court.trim() ? { court: court.trim() } : {};
    try {
      if (canStart) {
        const response = await requestCapability('k5_research_start_search', { theme, filters, includeSources, idempotencyKey: crypto.randomUUID() });
        if (!response.ok) throw new Error(response.error);
        const search = researchCapabilities.k5_research_start_search.output.parse(response.data).search;
        setView(search); setLocalResults(null);
        window.history.replaceState(window.history.state, '', `/app/research?mode=jurisprudence&search=${encodeURIComponent(search.id)}`);
      } else {
        const response = await requestCapability('k5_research_search_corpus', { theme, filters });
        if (!response.ok) throw new Error(response.error);
        setLocalResults(researchCapabilities.k5_research_search_corpus.output.parse(response.data).results); setView(null);
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível pesquisar.'); }
    finally { setBusy(false); }
  }
  const results = localResults ?? view?.pages.flatMap(page => page.results) ?? [];
  return <div>
    <nav aria-label="Visões da pesquisa de jurisprudência" className={sectionTabRow}>
      <button type="button" className={sectionTab(tab === 'search')} aria-current={tab === 'search' ? 'page' : undefined} onClick={() => setTab('search')}>Pesquisar</button>
      <button type="button" className={sectionTab(tab === 'history')} aria-current={tab === 'history' ? 'page' : undefined} onClick={async () => {
        setTab('history'); setError(''); const response = await requestCapability('k5_research_list_history', {});
        if (response.ok) setHistory(researchCapabilities.k5_research_list_history.output.parse(response.data).searches); else setError(response.error);
      }}>Histórico</button>
    </nav>
    {error && <p role="alert" className="py-4 text-sm text-destructive">{error}</p>}
    {tab === 'history' ? <section className="py-5">{history === null ? !error && <p role="status" className="text-sm text-muted-foreground">Carregando histórico…</p>
      : !history.length ? <p className="text-sm text-muted-foreground">Suas pesquisas de jurisprudência aparecem aqui.</p>
      : history.map(item => <Link key={item.id} href={`/app/research?mode=jurisprudence&search=${encodeURIComponent(item.id)}`} className="block border-b py-4 text-sm hover:underline">{item.theme}</Link>)}</section>
      : <>
        <form onSubmit={submit} className="grid gap-4 border-b py-5">
          <div className="grid gap-1.5"><Label htmlFor="judicial-theme">Tema ou questão jurídica</Label><Input id="judicial-theme" value={theme} onChange={event => setTheme(event.target.value)} required minLength={2} maxLength={300} placeholder="Ex.: responsabilidade civil por atraso de voo" /></div>
          <div className="grid max-w-sm gap-1.5"><Label htmlFor="judicial-court">Tribunal (opcional)</Label><Input id="judicial-court" value={court} onChange={event => setCourt(event.target.value)} maxLength={40} placeholder="Ex.: STJ" /></div>
          {canStart && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includeSources} onChange={event => setIncludeSources(event.target.checked)} className="size-4" />Consultar também fontes oficiais habilitadas</label>}
          <Button className="min-h-11 justify-self-start" disabled={busy || theme.trim().length < 2}>{busy ? <LoaderCircle className="animate-spin" /> : <Search />}Pesquisar jurisprudência</Button>
        </form>
        {pending && <p role="status" className="py-4 text-sm text-muted-foreground">Consultando fontes e obtendo materiais…</p>}
        {view?.pages.map(page => page.sourceError && <p key={page.id} role="alert" className="py-3 text-sm text-destructive">{page.sourceError}</p>)}
        {(view || localResults) && !results.length && !pending && <p className="py-8 text-sm text-muted-foreground">Nenhum julgado encontrado para estes critérios.</p>}
        {results.map(result => <article key={result.id} className="border-b py-5">
          <Link href={`/app/research/judgments/${encodeURIComponent(result.id)}${searchId ? `?search=${encodeURIComponent(searchId)}` : ''}`} className="text-sm font-medium hover:underline">{result.title}</Link>
          <p className="mt-1 text-[13px] text-muted-foreground">{result.tribunal}{result.caseNumber ? ` · ${result.caseNumber}` : ''}</p>
          {result.ementa && <p className="mt-3 line-clamp-5 text-sm leading-6 text-muted-foreground">{result.ementa}</p>}
          {result.sourceUrl && <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm underline">Fonte oficial<ArrowUpRight className="size-3.5" /><span className="sr-only">, abre em nova aba</span></a>}
        </article>)}
        {canStart && view?.pages.at(-1)?.nextCursor && <Button variant="outline" className="mt-4" disabled={busy || pending} onClick={async () => {
          setBusy(true); const response = await requestCapability('k5_research_request_page', { searchId: view.id, cursor: view.pages.at(-1)?.nextCursor, idempotencyKey: crypto.randomUUID() });
          if (!response.ok) setError(response.error);
          else { const loaded = await requestCapability('k5_research_get_search', { searchId: view.id }); if (loaded.ok) setView(researchCapabilities.k5_research_get_search.output.parse(loaded.data).search); }
          setBusy(false);
        }}>Carregar mais resultados</Button>}
      </>}
  </div>;
}
