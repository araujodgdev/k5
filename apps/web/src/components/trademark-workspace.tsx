'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleAlert, LoaderCircle, Search, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { viennaCode } from '@/lib/research/trademarks/inpi-contracts';
import { Label } from '@/components/ui/label';
import { sectionTab, sectionTabRow } from '@/components/section-tabs';
import { requestCapability } from '@/lib/capabilities/http-client';
import { trademarkCountries, trademarkLabels, trademarkSearchView, trademarkHistoryItem, trademarkUpload, activeTrademarkRun,
  trademarkSituation, type TrademarkSearchView, type TrademarkHistoryItem, type TrademarkSearchInput } from '@/lib/research/trademarks/contracts';

const selectStyle = 'h-11 w-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9';
const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const situations: Record<string, string> = { Registered: 'Registrada', Pending: 'Em análise', Ended: 'Encerrada', Expired: 'Expirada', Unknown: 'Situação não informada' };
export const trademarkSituationLabel = (value: string | null) => value ? value.replace(/^(Registered|Pending|Ended|Expired|Unknown)\b/, status => situations[status]) : 'Situação não informada';

export function TrademarkWorkspace({ initialSearchId }: { initialSearchId: string | null }) {
  const [tab, setTab] = useState<'search' | 'history'>('search');
  const [kind, setKind] = useState<TrademarkSearchInput['query']['kind']>('name');
  const [codes, setCodes] = useState('');
  const [viennaMatch, setViennaMatch] = useState<'any'|'all'>('any');
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<Extract<TrademarkSearchInput['query'], { kind: 'name' }>['strategy']>('contains');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [country, setCountry] = useState('BR');
  const [situation, setSituation] = useState<TrademarkSearchInput['situation']>('all');
  const [niceClass, setNiceClass] = useState('');
  const [view, setView] = useState<TrademarkSearchView | null>(null);
  const [history, setHistory] = useState<TrademarkHistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialSearchId));
  const [historyError, setHistoryError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);
  const show = useCallback((search: TrademarkSearchView) => {
    setView(search); setKind(search.input.query.kind); setCountry(search.input.country); setSituation(search.input.situation);
    setNiceClass(search.input.niceClass ? String(search.input.niceClass) : '');
    if (search.input.query.kind === 'name') { setName(search.input.query.name); setStrategy(search.input.query.strategy); }
    else if (search.input.query.kind==='logo') { setUploadId(search.input.query.uploadId); setPreview(`/api/research/trademarks/uploads/${search.input.query.uploadId}`); }
    else { setCodes(search.input.query.codes.join(', ')); setViennaMatch(search.input.query.match); }
    const url = new URL(window.location.href); url.searchParams.set('mode', 'trademarks'); url.searchParams.set('search', search.id);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    if (!initialSearchId) return;
    const controller = new AbortController();
    void requestCapability('k5_research_get_trademark_search', { searchId: initialSearchId }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) show(trademarkSearchView.parse(response.data && typeof response.data === 'object' && 'search' in response.data ? response.data.search : null));
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
          const parsed = trademarkSearchView.parse(response.data && typeof response.data === 'object' && 'search' in response.data ? response.data.search : null);
          setView(parsed); setError('');
          if (!activeTrademarkRun(parsed.state)) heading.current?.focus();
        } else setError(response.error);
      });
    }, 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [searchId, running]);

  async function loadHistory() {
    setHistoryError('');
    const response = await requestCapability('k5_research_list_trademark_searches', {});
    if (response.ok) {
      const raw = response.data && typeof response.data === 'object' && 'searches' in response.data ? response.data.searches : null;
      setHistory(trademarkHistoryItem.array().parse(raw));
    } else setHistoryError(response.error);
  }

  async function open(id: string) {
    setLoading(true); setError(''); setTab('search');
    const response = await requestCapability('k5_research_get_trademark_search', { searchId: id });
    if (response.ok) show(trademarkSearchView.parse(response.data && typeof response.data === 'object' && 'search' in response.data ? response.data.search : null));
    else setError(response.error);
    setLoading(false);
  }

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
      const parsedCodes=codes.split(/[,;\s]+/).filter(Boolean);
      if (kind==='vienna' && (!parsedCodes.length || parsedCodes.length>12 || parsedCodes.some(code=>!viennaCode.safeParse(code).success))) {
        throw new Error('Informe até 12 códigos de Viena válidos, como 1.1.1 ou 27.5.1.');
      }
      const query: TrademarkSearchInput['query'] = kind === 'name' ? { kind, name: name.trim(), strategy }
        : kind==='logo' ? { kind: 'logo', uploadId: imageId ?? '', strategy: 'concept' }
        : {kind:'vienna',codes:parsedCodes,match:viennaMatch};
      const response = await requestCapability('k5_research_start_trademark_search', { query, country, situation, niceClass: niceClass ? Number(niceClass) : null, idempotencyKey: crypto.randomUUID() });
      if (!response.ok) throw new Error(response.error);
      show(trademarkSearchView.parse(response.data && typeof response.data === 'object' && 'search' in response.data ? response.data.search : null));
      setHistory(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível iniciar a pesquisa.'); }
    finally { setBusy(false); }
  }

  async function action(name: 'k5_research_next_trademark_page' | 'k5_research_cancel_trademark_search') {
    if (!view || busy) return;
    setBusy(true); setError('');
    const response = await requestCapability(name, { searchId: view.id });
    if (response.ok) show(trademarkSearchView.parse(response.data && typeof response.data === 'object' && 'search' in response.data ? response.data.search : null));
    else setError(response.error);
    setBusy(false);
  }

  return <div className="min-w-0">
    <nav aria-label="Visões da pesquisa de marcas" className={sectionTabRow}>
      <button type="button" onClick={() => setTab('search')} aria-current={tab === 'search' ? 'page' : undefined} className={sectionTab(tab === 'search')}>Pesquisar</button>
      <button type="button" onClick={() => { setTab('history'); void loadHistory(); }} aria-current={tab === 'history' ? 'page' : undefined} className={sectionTab(tab === 'history')}>Histórico</button>
    </nav>
    {tab === 'history' ? <section className="py-5" aria-label="Histórico de pesquisas de marcas">
      {historyError ? <p role="alert" className="text-sm text-destructive">{historyError} <button type="button" className="min-h-11 underline" onClick={() => void loadHistory()}>Tentar novamente</button></p>
        : history === null ? <p role="status" className="text-sm text-muted-foreground">Carregando histórico…</p>
        : !history.length ? <p className="py-5 text-sm text-muted-foreground">Suas pesquisas de marcas aparecem aqui.</p>
        : <div className="border-t">{history.map(item => <button key={item.id} type="button" onClick={() => void open(item.id)} className="flex min-h-14 w-full items-center justify-between gap-4 border-b py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0"><span className="block truncate text-sm">{item.title}</span><span className="mt-1 block text-[13px] text-muted-foreground">{trademarkCountries.find(country => country.code === item.input.country)?.name} · {item.resultCount} resultados · {item.step}</span></span>
          <span className="label-mono shrink-0 text-subtle-foreground">{day.format(new Date(item.createdAt))}</span>
        </button>)}</div>}
    </section> : <>
      <form onSubmit={submit} className="grid gap-5 border-b py-5">
        <fieldset disabled={busy || running} className="grid min-w-0 gap-4">
          <legend className="mb-2 text-sm font-medium">Pesquisar por</legend>
          <div className="flex">{(['name', 'logo','vienna'] as const).map(value => <label key={value} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center border px-3 text-sm sm:flex-none ${kind === value ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-accent'} has-focus-visible:ring-2 has-focus-visible:ring-ring`}>
            <input type="radio" name="trademark-kind" checked={kind === value} onChange={() => {setKind(value); if(value==='vienna') setCountry('BR');}} className="sr-only" />{value === 'name' ? 'Nome' : value==='logo' ? 'Logotipo' : 'Viena'}
          </label>)}</div>
          {kind === 'name' ? <div className="grid gap-1.5"><Label htmlFor="trademark-name">Nome da marca</Label><Input id="trademark-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={200} required placeholder="Ex.: Lume" className="h-11 md:h-9" /></div>
            : kind==='logo' ? <div className="grid gap-2"><Label htmlFor="trademark-logo">Imagem da marca</Label><div className="flex flex-wrap items-center gap-4 border p-4">
              {preview && <Image src={preview} alt="Logotipo selecionado para a pesquisa" width={88} height={88} unoptimized className="size-22 object-contain" />}
              <div className="min-w-0 flex-1"><Input ref={fileInput} id="trademark-logo" type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-2" onChange={event => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                if (selected.size > 5 * 1024 * 1024) { setError('O logotipo deve ter até 5 MB.'); event.target.value = ''; return; }
                setFile(selected); setUploadId(null); setPreview(URL.createObjectURL(selected)); setError('');
              }} /><p className="mt-2 text-[13px] text-muted-foreground">PNG, JPG ou WebP, até 5 MB. {country==='BR' ? 'A IA sugere códigos de Viena para buscar elementos figurativos em comum na base INPI.' : 'A WIPO compara o conteúdo visual por similaridade conceitual.'}</p></div>
              {preview && <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label="Remover logotipo" onClick={() => { setFile(null); setUploadId(null); setPreview(null); if (fileInput.current) fileInput.current.value = ''; }}><X /></Button>}
            </div></div> : <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="trademark-vienna">Códigos de Viena</Label><Input id="trademark-vienna" value={codes} onChange={event => setCodes(event.target.value)} required maxLength={160} placeholder="Ex.: 1.1.1, 27.5.1" className="h-11 md:h-9" /><p className="text-[13px] text-muted-foreground">Separe os códigos por vírgulas.</p></div><div className="grid gap-1.5"><Label htmlFor="trademark-vienna-match">Elementos figurativos</Label><select id="trademark-vienna-match" value={viennaMatch} onChange={event => setViennaMatch(event.target.value==='all' ? 'all' : 'any')} className={selectStyle}><option value="any">Pelo menos um código</option><option value="all">Todos os códigos</option></select></div></div>}
          <div className={`grid gap-4 sm:grid-cols-2 ${kind === 'name' ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
            <div className="grid gap-1.5"><Label htmlFor="trademark-country">Território de proteção</Label><select id="trademark-country" value={country} disabled={kind==='vienna'} onChange={event => {setCountry(event.target.value); if(event.target.value==='BR' && strategy==='phonetic') setStrategy('contains');}} className={selectStyle}>{trademarkCountries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="trademark-situation">Situação</Label><select id="trademark-situation" value={situation} onChange={event => setSituation(trademarkSituation.parse(event.target.value))} className={selectStyle}>{Object.entries(trademarkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="trademark-nice">Classe Nice</Label><select id="trademark-nice" value={niceClass} onChange={event => setNiceClass(event.target.value)} className={selectStyle}><option value="">Todas as classes</option>{Array.from({ length: 45 }, (_, i) => <option key={i + 1} value={i + 1}>Classe {i + 1}</option>)}</select></div>
            {kind === 'name' && <div className="grid gap-1.5"><Label htmlFor="trademark-strategy">Correspondência</Label><select id="trademark-strategy" value={strategy} onChange={event => setStrategy(event.target.value === 'exact' ? 'exact' : event.target.value === 'fuzzy' ? 'fuzzy' : event.target.value === 'phonetic' ? 'phonetic' : 'contains')} className={selectStyle}><option value="contains">Contém o nome</option><option value="exact">Nome exato</option><option value="fuzzy">Nomes semelhantes</option>{country!=='BR' && <option value="phonetic">Semelhança fonética</option>}</select></div>}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy || running || (kind === 'name' ? name.trim().length < 2 : kind==='logo' ? !file && !uploadId : !codes.trim())} className="min-h-11 md:min-h-9">{busy ? <LoaderCircle className="animate-spin" /> : kind === 'logo' ? <Upload /> : <Search />}Pesquisar marcas</Button>
          {running && <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={busy} onClick={() => void action('k5_research_cancel_trademark_search')}>Cancelar pesquisa</Button>}
          <span className="text-[13px] text-muted-foreground">Fonte: {country==='BR' ? 'INPI · Dados abertos e RPI' : 'WIPO Global Brand Database'}</span></div>
      </form>
      {error && <p role="alert" className="flex items-start gap-2 py-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
      {loading ? <p role="status" className="py-8 text-sm text-muted-foreground">Carregando pesquisa…</p> : view ? <section className="py-5" aria-labelledby="trademark-results-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="trademark-results-heading" tabIndex={-1} ref={heading} className="text-base font-medium outline-none">Resultados</h2>
          <p role="status" className="text-[13px] text-muted-foreground">{running ? view.step : `${view.results.length} resultados obtidos${view.totalReported !== null ? ` de ${view.totalReported}` : ''}`}</p></div>
        {view.corpus && <p className="border-b py-3 text-[13px] leading-5 text-muted-foreground">{view.corpus.note}{view.corpus.latestEdition ? ` Última RPI importada: ${view.corpus.latestEdition}, de ${view.corpus.publishedOn}.` : ''}</p>}
        {view.analysis && <div className="border-b py-4"><h3 className="text-sm font-medium">Elementos do logotipo</h3><p className="mt-2 text-sm">{view.analysis.description}</p><dl className="mt-3">{view.analysis.codes.map(item => <div key={item.code} className="border-t py-2 text-[13px]"><dt>{item.code} · {item.description}</dt><dd className="mt-1 text-muted-foreground">{item.reason}</dd></div>)}</dl><p className="mt-2 text-[13px] leading-5 text-muted-foreground">{view.analysis.note}</p>{view.analysis.catalogSourceUrl && <a className="mt-2 inline-block text-[13px] underline underline-offset-4" href={view.analysis.catalogSourceUrl} target="_blank" rel="noopener noreferrer">Classificação de Viena · OMPI/WIPO e INPI<span className="sr-only">, abre em nova aba</span></a>}<Button type="button" variant="outline" className="mt-3 min-h-11" disabled={running} onClick={() => {setKind('vienna');setCodes(view.analysis?.codes.map(item => item.code).join(', ') ?? '');setCountry('BR');}}>Refinar códigos sugeridos</Button></div>}
        {view.error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b py-4"><p className="text-sm text-destructive">{view.error}</p><Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy} onClick={() => void action('k5_research_next_trademark_page')}>Tentar novamente</Button></div>}
        {!view.results.length && view.state === 'completed' ? <p className="py-8 text-sm text-muted-foreground">Nenhuma marca encontrada para estes critérios. Tente outro nome, imagem ou filtro.</p>
          : running && !view.results.length ? <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{view.step}… Você pode sair e acompanhar pelo histórico.</p> : null}
        <div className="mt-3 border-t">{view.results.map(result => <div key={result.id} className="flex gap-4 border-b py-4">
          {result.representationUrl && <Image src={result.representationUrl} alt={`Representação da marca ${result.name}`} width={64} height={64} unoptimized className="size-16 shrink-0 object-contain" />}
          <div className="min-w-0 flex-1"><Link href={`/app/research/trademarks/${result.id}`} prefetch={false} className="text-sm font-medium underline-offset-4 hover:underline">{result.name || 'Marca sem nome informado'}</Link>
            <p className="mt-1 text-[13px] text-muted-foreground">{trademarkSituationLabel(result.situation)}{result.office || result.territory ? ` · ${result.office ?? result.territory}` : ''}{result.niceClasses.length ? ` · Nice ${result.niceClasses.join(', ')}` : ''}</p>
            {!!result.viennaCodes.length && <p className="mt-1 text-[13px] text-muted-foreground">Viena {result.viennaCodes.join(', ')}</p>}
            {result.owner && <p className="mt-1 break-words text-sm text-muted-foreground">{result.owner}</p>}
            <a href={result.source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:underline">{result.source.provider==='inpi' ? 'Ver processo no INPI' : 'WIPO Global Brand Database'} <ArrowUpRight className="size-3.5" /><span className="sr-only">, abre em nova aba</span></a>
          </div>
        </div>)}</div>
        {view.hasMore && <Button variant="outline" className="mt-4 min-h-11 md:min-h-9" disabled={busy || running} onClick={() => void action('k5_research_next_trademark_page')}>{busy || running ? 'Consultando…' : 'Carregar mais resultados'}</Button>}
        {view.state === 'cancelled' && <p className="pt-4 text-sm text-muted-foreground">Pesquisa cancelada. Os resultados já obtidos foram preservados.</p>}
        <p className="pt-5 text-[13px] leading-5 text-subtle-foreground">A base pode ter lacunas e atrasos de atualização. Nenhum resultado não significa que a marca está disponível. Confira o registro no escritório de origem.</p>
      </section> : !error && <p className="py-8 text-sm text-muted-foreground">Pesquise pelo nome ou logotipo. Brasil e todos os status estão selecionados por padrão.</p>}
    </>}
  </div>;
}
