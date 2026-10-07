'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw, Scale } from 'lucide-react';
import { CanvasTrail, trailAction } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { JudgmentDetail, ResearchMaterial, ResearchMaterialStatus } from '@/lib/research/contracts';
import { researchSourceMessage } from '@/lib/research/messages';
import { ResearchCaseLinker } from './research-case-linker';

const formatDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
function dateLabel(value: string | null) {
  if (!value) return 'Data não informada';
  const parsed = new Date(value.includes('T') ? value : value.includes(' ') ? `${value.replace(' ', 'T')}Z` : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : formatDate.format(parsed);
}
function statusText(status: ResearchMaterialStatus, kind: 'ementa' | 'full_text') {
  const name = kind === 'ementa' ? 'Ementa' : 'Inteiro teor';
  switch (status) {
    case 'ready': return `${name} disponível`;
    case 'pending': return `${name} ainda não obtido`;
    case 'fetching': return `${name} em obtenção`;
    case 'processing': return `${name} em processamento`;
    case 'unavailable': return `${name} não disponibilizado pela fonte`;
    case 'failed': return `Não foi possível obter ${kind === 'ementa' ? 'a ementa' : 'o inteiro teor'}`;
    case 'restricted': return `${name} com acesso restrito`;
  }
}
function officialUrl(value: string | null) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' ? url.toString() : null; }
  catch { return null; }
}

export function ResearchReader({ judgmentId, searchId }: { judgmentId: string; searchId: string | null }) {
  return <ResearchReaderContent key={judgmentId} judgmentId={judgmentId} searchId={searchId} />;
}

function ResearchReaderContent({ judgmentId, searchId }: { judgmentId: string; searchId: string | null }) {
  const [judgment, setJudgment] = useState<JudgmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollBlocked, setPollBlocked] = useState(false);
  const [requestedKind, setRequestedKind] = useState<'ementa' | 'full_text' | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const response = await requestCapability('k5_research_get_judgment', { judgmentId });
    if (!mounted.current) return;
    if (response.ok) { setJudgment((response.data as { judgment: JudgmentDetail }).judgment); setError(''); setPollBlocked(false); }
    else { setError(response.error); setPollBlocked(true); }
    setLoading(false);
  }, [judgmentId]);
  useEffect(() => {
    const controller = new AbortController();
    void requestCapability('k5_research_get_judgment', { judgmentId }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) setJudgment((response.data as { judgment: JudgmentDetail }).judgment);
      else { setError(response.error); setPollBlocked(true); }
      setLoading(false);
    });
    return () => controller.abort();
  }, [judgmentId]);
  useEffect(() => {
    if (!judgment || pollBlocked || !judgment.materials.some(item => ['fetching', 'processing'].includes(item.status) || (item.kind === requestedKind && item.status === 'pending'))) return;
    let cancelled = false;
    let running = false;
    const id = judgmentId;
    const timer = window.setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      const response = await requestCapability('k5_research_get_judgment', { judgmentId: id });
      running = false;
      if (cancelled || !mounted.current) return;
      if (response.ok) setJudgment((response.data as { judgment: JudgmentDetail }).judgment);
      else { setError(response.error); setPollBlocked(true); }
    }, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [judgmentId, judgment, requestedKind, pollBlocked]);

  async function requestMaterial(kind: 'ementa' | 'full_text') {
    setBusy(true); setError('');
    const response = await requestCapability('k5_research_request_material', { judgmentId, kind, ...(searchId ? { searchId } : {}), idempotencyKey: crypto.randomUUID() });
    if (!response.ok) setError(response.error);
    else {
      const result = response.data as { jobId: string | null };
      setRequestedKind(result.jobId ? kind : null);
      setPollBlocked(false);
      await load();
    }
    setBusy(false);
  }

  const back = searchId ? `/app/research?mode=jurisprudence&search=${encodeURIComponent(searchId)}` : '/app/research';
  const ementa = judgment?.materials.find(item => item.kind === 'ementa');
  const full = judgment?.materials.find(item => item.kind === 'full_text');
  const source = officialUrl(judgment?.sourceUrl ?? null);
  return <>
    <CanvasTrail back={{ href: back, label: 'Pesquisa' }} icon={<Scale />} current={judgment?.title || 'Julgado'} actions={judgment && <>
      <Button type="button" variant="ghost" onClick={() => void load()} className={trailAction}><RefreshCw aria-hidden="true" /><span className="max-md:sr-only">Atualizar estado</span></Button>
      {source && <Button asChild variant="ghost" className={trailAction}><a href={source} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /><span className="max-md:sr-only">Fonte oficial</span><span className="sr-only">, abre em nova aba</span></a></Button>}
    </>} />
    <CanvasPage className="md:gap-8">
      {loading && <p role="status" className="text-[13.5px] text-muted-foreground">Carregando julgado…</p>}
      {error && <p role="alert" className="flex gap-2 text-[13.5px] text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {!loading && judgment && <>
        <div className="flex flex-col gap-2">
          <CanvasHeader eyebrow={[judgment.tribunal, judgment.courtUnit, dateLabel(judgment.decisionDate)].filter(Boolean).join(' · ')} title={judgment.title || 'Julgado'}
            actions={(judgment.ementaVersionId || judgment.fullTextVersionId) && <ResearchCaseLinker judgment={judgment} />} />
          {judgment.caseNumber && <p className="font-mono text-[12.5px] text-muted-foreground">Processo {judgment.caseNumber}</p>}
        </div>
        <div className="grid gap-8 lg:grid-cols-2">
          <MaterialSection kind="ementa" material={ementa} fallback={judgment.ementa} busy={busy} onRequest={() => void requestMaterial('ementa')} />
          <MaterialSection kind="full_text" material={full} fallback={null} busy={busy} onRequest={() => void requestMaterial('full_text')} />
        </div>
        <div className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>Origem: {judgment.tribunal}. Consultado em {dateLabel(judgment.collectedAt)}.</p>
          {judgment.sourceStatus === 'restricted' && <p>A fonte restringiu o acesso ao conteúdo.</p>}
          {judgment.sourceStatus === 'unavailable' && <p>A fonte está indisponível neste momento.</p>}
        </div>
      </>}
    </CanvasPage>
  </>;
}

function MaterialSection({ kind, material, fallback, busy, onRequest }: {
  kind: 'ementa' | 'full_text'; material: (ResearchMaterial & JudgmentDetail['materials'][number]) | undefined;
  fallback: string | null; busy: boolean; onRequest: () => void;
}) {
  const name = kind === 'ementa' ? 'Ementa' : 'Inteiro teor';
  const text = material?.version?.textContent || material?.chunks.map(chunk => chunk.textContent).join('\n\n') || fallback;
  const status = material?.status ?? (fallback ? 'ready' : 'unavailable');
  const retry = !text && ['pending', 'failed'].includes(status);
  const original = material?.version && (material.version as typeof material.version & { originalAvailable?: boolean }).originalAvailable ? material.version : null;
  return <CanvasSection label={name} title={name} action={<span className="text-xs text-muted-foreground">{statusText(status, kind)}</span>} className="min-w-0">
    {text ? <div className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.7]">{text}</div> : <p className="text-[13.5px] text-subtle-foreground">{statusText(status, kind)}.</p>}
    {material?.unavailableReason && !text && <p className="text-[13px] text-muted-foreground">{researchSourceMessage(material.unavailableReason)}</p>}
    {(original || retry) && <div className="flex flex-wrap gap-2">
      {original && <Button asChild variant="outline" size="lg" className="h-11 md:h-[34px]"><a href={`/api/research/materials/${encodeURIComponent(original.id)}/original`} target="_blank" rel="noopener noreferrer">{original.mimeType === 'application/pdf' ? 'Abrir original' : 'Baixar original'}</a></Button>}
      {retry && <Button type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy} onClick={onRequest}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Tentar obter</Button>}
    </div>}
  </CanvasSection>;
}
