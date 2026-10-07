'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, Search, X } from 'lucide-react';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { CanvasTrail, Field } from '@/components/canvas/canvas-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestCapability } from '@/lib/capabilities/http-client';
import { trademarkCountries, trademarkLabels, trademarkSearchView, trademarkUpload, activeTrademarkRun,
  trademarkSituation, type TrademarkSearchView, type TrademarkSearchInput, type TrademarkSummary } from '@/lib/research/trademarks/contracts';

const selectStyle = 'h-11 w-full rounded-md border bg-background text-[13.5px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const situations: Record<string, string> = { Registered: 'Registrada', Pending: 'Em análise', Ended: 'Encerrada', Expired: 'Expirada', Unknown: 'Situação não informada' };
export const trademarkSituationLabel = (value: string | null) => value ? value.replace(/^(Registered|Pending|Ended|Expired|Unknown)\b/, status => situations[status]) : 'Situação não informada';
const searchOf = (data: unknown) => trademarkSearchView.parse(data && typeof data === 'object' && 'search' in data ? data.search : null);

export function TrademarkWorkspace({ initialSearchId }: { initialSearchId: string | null }) {
  const [kind, setKind] = useState<TrademarkSearchInput['query']['kind']>('name');
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<Extract<TrademarkSearchInput['query'], { kind: 'name' }>['strategy']>('contains');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [country, setCountry] = useState('BR');
  const [situation, setSituation] = useState<TrademarkSearchInput['situation']>('all');
  const [niceClass, setNiceClass] = useState('');
  const [view, setView] = useState<TrademarkSearchView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialSearchId));
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);
  const show = useCallback((search: TrademarkSearchView) => {
    setView(search); setKind(search.input.query.kind); setCountry(search.input.country); setSituation(search.input.situation);
    setNiceClass(search.input.niceClass ? String(search.input.niceClass) : '');
    if (search.input.query.kind === 'name') { setName(search.input.query.name); setStrategy(search.input.query.strategy); }
    else { setUploadId(search.input.query.uploadId); setPreview(`/api/research/trademarks/uploads/${search.input.query.uploadId}`); }
    const url = new URL(window.location.href); url.searchParams.set('mode', 'trademarks'); url.searchParams.set('search', search.id);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    if (!initialSearchId) return;
    const controller = new AbortController();
    void requestCapability('k5_research_get_trademark_search', { searchId: initialSearchId }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) show(searchOf(response.data));
      else setError(response.error);
      setLoading(false);
    });
    return () => controller.abort();
  }, [initialSearchId, show]);

  const running = view ? activeTrademarkRun(view.state) : false;
  const searchId = view?.id;
  useEffect(() => {
    if (!searchId || !running) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void requestCapability('k5_research_get_trademark_search', { searchId }, controller.signal).then(response => {
        if (controller.signal.aborted) return;
        if (response.ok) {
          const parsed = searchOf(response.data);
          setView(parsed); setError('');
          if (!activeTrademarkRun(parsed.state)) heading.current?.focus();
        } else setError(response.error);
      });
    }, 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [searchId, running]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || running) return;
    setBusy(true); setError('');
    try {
      let imageId = uploadId;
      if (kind === 'logo' && file) {
        const body = new FormData(); body.set('file', file);
        const response = await fetch('/api/research/trademarks/uploads', { method: 'POST', body });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Não foi possível enviar o logotipo.');
        imageId = trademarkUpload.parse(data && typeof data === 'object' && 'upload' in data ? data.upload : null).id;
        setUploadId(imageId); setFile(null);
      }
      if (kind === 'logo' && !imageId) throw new Error('Selecione um logotipo.');
      const query: TrademarkSearchInput['query'] = kind === 'name' ? { kind, name: name.trim(), strategy }
        : { kind: 'logo', uploadId: imageId ?? '', strategy: 'concept' };
      const response = await requestCapability('k5_research_start_trademark_search', { query, country, situation, niceClass: niceClass ? Number(niceClass) : null, idempotencyKey: crypto.randomUUID() });
      if (!response.ok) throw new Error(response.error);
      show(searchOf(response.data));
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível iniciar a pesquisa.'); }
    finally { setBusy(false); }
  }

  async function action(capability: 'k5_research_next_trademark_page' | 'k5_research_cancel_trademark_search') {
    if (!view || busy) return;
    setBusy(true); setError('');
    const response = await requestCapability(capability, { searchId: view.id });
    if (response.ok) show(searchOf(response.data));
    else setError(response.error);
    setBusy(false);
  }

  function clearLogo() {
    setFile(null); setUploadId(null); setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  return <>
    <CanvasTrail back={{ href: '/app/research', label: 'Pesquisa' }} icon={<Search />} current={view?.title ?? 'Marcas'} />
    <CanvasPage className="md:gap-8">
      <CanvasHeader eyebrow="Marcas · WIPO Global Brand Database" title={view ? view.title : loading ? 'Pesquisa' : 'Nova pesquisa'} />
      {loading ? <p role="status" className="text-[13.5px] text-muted-foreground">Carregando pesquisa…</p> : <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy || running} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">Critérios da pesquisa de marcas</legend>
          <fieldset className="flex flex-wrap gap-x-6">
            <legend className="mb-1.5 text-xs text-muted-foreground">Pesquisar por</legend>
            {([['name', 'Nome'], ['logo', 'Logotipo']] as const).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2.5 text-[13.5px] md:min-h-8">
              <input type="radio" name={`${id}-kind`} value={value} checked={kind === value} onChange={() => setKind(value)} className="size-4 accent-foreground" />{label}
            </label>)}
          </fieldset>
          {kind === 'name' ? (
            <Field label="Nome da marca" htmlFor={`${id}-name`}>
              <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={200} required placeholder="Ex.: Lume" className="h-11 md:h-9" />
            </Field>
          ) : (
            <Field label="Imagem da marca" htmlFor={`${id}-logo`}>
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
                {preview && <Image src={preview} alt="Logotipo selecionado para a pesquisa" width={64} height={64} unoptimized className="size-16 rounded-md object-contain" />}
                <div className="min-w-0 flex-1">
                  <Input ref={fileInput} id={`${id}-logo`} type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-2" onChange={event => {
                    const selected = event.target.files?.[0];
                    if (!selected) return;
                    if (selected.size > MAX_LOGO_BYTES) { setError('O logotipo deve ter até 5 MB.'); event.target.value = ''; return; }
                    setFile(selected); setUploadId(null); setPreview(URL.createObjectURL(selected)); setError('');
                  }} />
                  <p className="mt-2 text-xs text-muted-foreground">PNG, JPG ou WebP, até 5 MB. A WIPO compara o conteúdo visual por similaridade conceitual.</p>
                </div>
                {preview && <Button type="button" variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Remover logotipo" onClick={clearLogo}><X /></Button>}
              </div>
            </Field>
          )}
          <div className={`grid gap-4 sm:grid-cols-2 ${kind === 'name' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            <Field label="Território de proteção" htmlFor={`${id}-country`}>
              <select id={`${id}-country`} value={country} onChange={event => setCountry(event.target.value)} className={selectStyle}>{trademarkCountries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
            </Field>
            <Field label="Situação" htmlFor={`${id}-situation`}>
              <select id={`${id}-situation`} value={situation} onChange={event => setSituation(trademarkSituation.parse(event.target.value))} className={selectStyle}>{Object.entries(trademarkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </Field>
            <Field label="Classe Nice" htmlFor={`${id}-nice`}>
              <select id={`${id}-nice`} value={niceClass} onChange={event => setNiceClass(event.target.value)} className={selectStyle}><option value="">Todas as classes</option>{Array.from({ length: 45 }, (_, i) => <option key={i + 1} value={i + 1}>Classe {i + 1}</option>)}</select>
            </Field>
            {kind === 'name' && <Field label="Correspondência" htmlFor={`${id}-strategy`}>
              <select id={`${id}-strategy`} value={strategy} onChange={event => setStrategy(event.target.value === 'exact' ? 'exact' : event.target.value === 'fuzzy' ? 'fuzzy' : event.target.value === 'phonetic' ? 'phonetic' : 'contains')} className={selectStyle}>
                <option value="contains">Contém o nome</option><option value="exact">Nome exato</option><option value="fuzzy">Nomes semelhantes</option><option value="phonetic">Semelhança fonética</option>
              </select>
            </Field>}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="lg" className="h-11 md:h-[34px]" disabled={busy || running || (kind === 'name' ? name.trim().length < 2 : !file && !uploadId)}>
            {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Pesquisar marcas
          </Button>
          {running && <Button type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy} onClick={() => void action('k5_research_cancel_trademark_search')}>Cancelar pesquisa</Button>}
        </div>
      </form>
      {error && <p role="alert" className="text-[13.5px] text-destructive">{error}</p>}
      {view ? (
        <section aria-labelledby={`${id}-results`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id={`${id}-results`} tabIndex={-1} ref={heading} className="text-[15px] font-semibold outline-none">Resultados</h2>
            <p role="status" className="text-[13px] text-muted-foreground">{running ? view.step : `${view.results.length} obtidos${view.totalReported !== null ? ` de ${view.totalReported}` : ''}`}</p>
          </div>
          {view.error && <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-[13.5px] text-destructive">{view.error}</p>
            <Button variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy} onClick={() => void action('k5_research_next_trademark_page')}>Tentar novamente</Button></div>}
          {!view.results.length && view.state === 'completed' ? <p className="text-[13.5px] text-muted-foreground">Nenhuma marca encontrada para estes critérios. Tente outro nome, imagem ou filtro.</p>
            : running && !view.results.length ? <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{view.step}… Você pode sair e acompanhar pela Pesquisa.</p> : null}
          {!!view.results.length && <div className="flex flex-col gap-0.5">{view.results.map(result => <TrademarkRow key={result.id} result={result} />)}</div>}
          {view.hasMore && <div><Button variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy || running} onClick={() => void action('k5_research_next_trademark_page')}>{busy || running ? 'Consultando…' : 'Carregar mais resultados'}</Button></div>}
          {view.state === 'cancelled' && <p className="text-[13.5px] text-muted-foreground">Pesquisa cancelada. Os resultados já obtidos foram preservados.</p>}
          <p className="text-xs leading-5 text-subtle-foreground">A base pode ter lacunas e atrasos de atualização. Nenhum resultado não significa que a marca está disponível. Confira o registro no escritório de origem.</p>
        </section>
      ) : !error && <p className="text-[13.5px] text-muted-foreground">Pesquise pelo nome ou logotipo. Brasil e todos os status estão selecionados por padrão.</p>}
      </>}
    </CanvasPage>
  </>;
}

/** A found trademark: its image, the name that opens it, situation and owner, the WIPO record above the row link. */
function TrademarkRow({ result }: { result: TrademarkSummary }) {
  const facts = [trademarkSituationLabel(result.situation), result.office ?? result.territory, result.niceClasses.length ? `Nice ${result.niceClasses.join(', ')}` : null].filter(Boolean).join(' · ');
  return <article className="relative -mx-2 flex items-start gap-3 rounded-[10px] px-2 py-2.5 outline-offset-[-2px] outline-ring transition-colors hover:bg-accent has-[[data-row-action]:focus-visible]:outline-2 md:-mx-3 md:rounded-md md:px-3">
    {result.representationUrl
      ? <Image src={result.representationUrl} alt={`Representação da marca ${result.name}`} width={40} height={40} unoptimized className="size-10 shrink-0 rounded-sm bg-card object-contain" />
      : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><Search className="size-4" /></span>}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <Link href={`/app/research/trademarks/${result.id}`} prefetch={false} data-row-action className="truncate text-sm font-medium outline-none after:absolute after:inset-0">{result.name || 'Marca sem nome informado'}</Link>
      <p className="text-[12.5px] text-muted-foreground">{facts}</p>
      {!!result.viennaCodes.length && <p className="text-[12.5px] text-muted-foreground">Viena {result.viennaCodes.join(', ')}</p>}
      {result.owner && <p className="break-words text-[13.5px] text-muted-foreground">{result.owner}</p>}
    </div>
    <a href={result.source.url} target="_blank" rel="noopener noreferrer" className="relative z-[1] inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-6">
      WIPO<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">, abre em nova aba</span></a>
  </article>;
}
