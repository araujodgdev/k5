'use client';
import Link from 'next/link';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, Scale } from 'lucide-react';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { CanvasTrail, Field } from '@/components/canvas/canvas-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestCapability } from '@/lib/capabilities/http-client';
import { researchCapabilities } from '@/lib/capabilities/research';
import type { JudgmentSummary, ResearchSearchView } from '@/lib/research/contracts';
import { useCanvasRevision, useCanvasActive } from './lume/canvas-host';

export function JurisprudenceWorkspace({ initialSearchId }: { initialSearchId: string | null }) {
  const revision = useCanvasRevision(), active = useCanvasActive();
  const [theme, setTheme] = useState('');
  const [court, setCourt] = useState('');
  const [includeSources, setIncludeSources] = useState(false);
  const [view, setView] = useState<ResearchSearchView | null>(null);
  const [loading, setLoading] = useState(Boolean(initialSearchId));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seed,setSeed] = useState({revision,active});
  if (seed.revision !== revision || seed.active !== active) { setSeed({revision,active}); setView(null); }
  const id = useId();
  const searchId = view?.id;
  const pending = view?.pages.some(page => page.status === 'queued' || page.status === 'running' || page.progress.pending > 0);
  useEffect(() => {
    if (!initialSearchId) return;
    const controller = new AbortController();
    void requestCapability('k5_research_get_search', { searchId: initialSearchId }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) {
        const { search } = researchCapabilities.k5_research_get_search.output.parse(response.data);
        setView(search); setTheme(search.theme); setCourt(search.filters.court ?? ''); setIncludeSources(search.includeSources);
      } else setError(response.error);
      setLoading(false);
    });
    return () => controller.abort();
  }, [initialSearchId, revision, active]);
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
      const response = await requestCapability('k5_research_start_search', { theme, filters, includeSources, idempotencyKey: crypto.randomUUID() });
      if (!response.ok) throw new Error(response.error);
      const search = researchCapabilities.k5_research_start_search.output.parse(response.data).search;
      setView(search);
      window.history.replaceState(window.history.state, '', `/app/research?mode=jurisprudence&search=${encodeURIComponent(search.id)}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível pesquisar.'); }
    finally { setBusy(false); }
  }
  async function loadMore() {
    if (!view) return;
    setBusy(true); setError('');
    const response = await requestCapability('k5_research_request_page', { searchId: view.id, cursor: view.pages.at(-1)?.nextCursor, idempotencyKey: crypto.randomUUID() });
    if (!response.ok) setError(response.error);
    else {
      const loaded = await requestCapability('k5_research_get_search', { searchId: view.id });
      if (loaded.ok) setView(researchCapabilities.k5_research_get_search.output.parse(loaded.data).search);
      else setError(loaded.error);
    }
    setBusy(false);
  }
  const results = view?.pages.flatMap(page => page.results) ?? [];
  return <>
    <CanvasTrail back={{ href: '/app/research', label: 'Pesquisa' }} icon={<Scale />} current={view?.theme ?? 'Jurisprudência'} />
    <CanvasPage className="md:gap-8">
      <CanvasHeader eyebrow="Jurisprudência" title={view ? view.theme : loading ? 'Pesquisa' : 'Nova pesquisa'} />
      {loading ? <p role="status" className="text-[13.5px] text-muted-foreground">Carregando pesquisa…</p> : <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Tema ou questão jurídica" htmlFor={`${id}-theme`}>
          <Input id={`${id}-theme`} value={theme} onChange={event => setTheme(event.target.value)} required minLength={2} maxLength={300} placeholder="Ex.: responsabilidade civil por atraso de voo" className="h-11 md:h-9" />
        </Field>
        <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-end">
          <Field label="Tribunal (opcional)" htmlFor={`${id}-court`}>
            <Input id={`${id}-court`} value={court} onChange={event => setCourt(event.target.value)} maxLength={40} placeholder="Ex.: STJ" className="h-11 md:h-9" />
          </Field>
          <label className="flex min-h-11 items-center gap-2.5 text-[13.5px] md:min-h-9">
            <input type="checkbox" checked={includeSources} onChange={event => setIncludeSources(event.target.checked)} className="size-4 accent-foreground" />
            Consultar também fontes oficiais habilitadas
          </label>
        </div>
        <div><Button size="lg" className="h-11 md:h-[34px]" disabled={busy || theme.trim().length < 2}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Pesquisar jurisprudência</Button></div>
      </form>
      {error && <p role="alert" className="text-[13.5px] text-destructive">{error}</p>}
      {view && (
        <CanvasSection title="Resultados" action={<p role="status" className="text-[13px] text-muted-foreground">
          {pending ? 'Consultando fontes e obtendo materiais…' : results.length === 1 ? '1 julgado' : `${results.length} julgados`}</p>}>
          {view.pages.map(page => page.sourceError && <p key={page.id} role="alert" className="text-[13.5px] text-destructive">{page.sourceError}</p>)}
          {!results.length && !pending ? <p className="text-[13.5px] text-muted-foreground">Nenhum julgado encontrado para estes critérios.</p> : (
            <div className="flex flex-col gap-0.5">{results.map(result => <JudgmentRow key={result.id} result={result} searchId={view.id} />)}</div>
          )}
          {view.pages.at(-1)?.nextCursor && <div><Button variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy || pending} onClick={() => void loadMore()}>Carregar mais resultados</Button></div>}
        </CanvasSection>
      )}
      </>}
    </CanvasPage>
  </>;
}

/** A found judgment: the title opens it, the ementa follows in three lines, the official source sits above the row link. */
function JudgmentRow({ result, searchId }: { result: JudgmentSummary; searchId: string }) {
  return <article className="relative -mx-2 flex flex-col gap-1 rounded-[10px] px-2 py-2.5 outline-offset-[-2px] outline-ring transition-colors hover:bg-accent has-[[data-row-action]:focus-visible]:outline-2 md:-mx-3 md:rounded-md md:px-3">
    <Link href={`/app/research/judgments/${encodeURIComponent(result.id)}?search=${encodeURIComponent(searchId)}`} data-row-action
      className="text-sm font-medium outline-none after:absolute after:inset-0">{result.title}</Link>
    <p className="text-[12.5px] text-muted-foreground">{result.tribunal}{result.caseNumber && <> · <span className="font-mono">{result.caseNumber}</span></>}</p>
    {result.ementa && <p className="line-clamp-3 text-[13.5px] leading-[1.6] text-muted-foreground">{result.ementa}</p>}
    {result.sourceUrl && <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="relative z-[1] inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-6">
      Fonte oficial<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">, abre em nova aba</span></a>}
  </article>;
}
