'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { OfficeRole } from '@/lib/offices';
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

export function ResearchReader({ judgmentId, searchId, role }: { judgmentId: string; searchId: string | null; role: OfficeRole }) {
  return <ResearchReaderContent key={judgmentId} judgmentId={judgmentId} searchId={searchId} role={role} />;
}

function ResearchReaderContent({ judgmentId, searchId, role }: { judgmentId: string; searchId: string | null; role: OfficeRole }) {
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

  const back = `/app/research${searchId ? `?search=${encodeURIComponent(searchId)}` : ''}`;
  const ementa = judgment?.materials.find(item => item.kind === 'ementa');
  const full = judgment?.materials.find(item => item.kind === 'full_text');
  const source = officialUrl(judgment?.sourceUrl ?? null);
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-10">
    <nav aria-label="Trilha" className="flex items-center gap-1 text-sm text-muted-foreground"><Link href={back} className="rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Pesquisa</Link><ChevronRight className="size-4" aria-hidden="true" /><span aria-current="page">Julgado</span></nav>
    {loading && <p className="py-10 text-sm text-muted-foreground">Carregando julgado…</p>}
    {error && <p role="alert" className="flex gap-2 py-5 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {!loading && judgment && <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0"><h1 className="page-title leading-tight">{judgment.title || 'Julgado'}</h1><p className="mt-2 text-sm text-muted-foreground">{judgment.tribunal}{judgment.courtUnit ? ` · ${judgment.courtUnit}` : ''} · {dateLabel(judgment.decisionDate)}</p>{judgment.caseNumber && <p className="mt-1 text-[13px] text-muted-foreground">Processo {judgment.caseNumber}</p>}</div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => void load()} className="min-h-11 md:min-h-9">Atualizar estado</Button>{source && <Button asChild variant="outline" className="min-h-11 md:min-h-9"><a href={source} target="_blank" rel="noopener noreferrer">Abrir fonte oficial <ExternalLink className="size-4" aria-hidden="true" /></a></Button>}{role !== 'reviewer' && (judgment.ementaVersionId || judgment.fullTextVersionId) && <ResearchCaseLinker judgment={judgment} />}</div>
      </div>
      <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MaterialSection kind="ementa" material={ementa} fallback={judgment.ementa} canWrite={role !== 'reviewer' && judgment.sourceStatus === 'active'} busy={busy} onRequest={() => void requestMaterial('ementa')} />
        <MaterialSection kind="full_text" material={full} fallback={null} canWrite={role !== 'reviewer' && judgment.sourceStatus === 'active'} busy={busy} onRequest={() => void requestMaterial('full_text')} />
      </div>
      <div className="border-t py-4 text-[13px] text-muted-foreground"><p>Origem: {judgment.tribunal}. Consultado em {dateLabel(judgment.collectedAt)}.</p>{judgment.sourceStatus === 'restricted' && <p className="mt-1">A fonte restringiu o acesso ao conteúdo.</p>}{judgment.sourceStatus === 'unavailable' && <p className="mt-1">A fonte está indisponível neste momento.</p>}</div>
    </>}
  </div>;
}

function MaterialSection({ kind, material, fallback, canWrite, busy, onRequest }: {
  kind: 'ementa' | 'full_text'; material: (ResearchMaterial & JudgmentDetail['materials'][number]) | undefined;
  fallback: string | null; canWrite: boolean; busy: boolean; onRequest: () => void;
}) {
  const name = kind === 'ementa' ? 'Ementa' : 'Inteiro teor';
  const text = material?.version?.textContent || material?.chunks.map(chunk => chunk.textContent).join('\n\n') || fallback;
  const status = material?.status ?? (fallback ? 'ready' : 'unavailable');
  const retry = canWrite && !text && ['pending', 'failed'].includes(status);
  return <section aria-label={name} className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><h2 className="text-base font-medium">{name}</h2><span className="text-[13px] text-muted-foreground">{statusText(status, kind)}</span></div>
    {text ? <div className="whitespace-pre-wrap break-words py-5 text-sm leading-7">{text}</div> : <p className="py-5 text-sm text-subtle-foreground">{statusText(status, kind)}.</p>}
    {material?.unavailableReason && !text && <p className="text-[13px] text-muted-foreground">{researchSourceMessage(material.unavailableReason)}</p>}
    {material?.version && (material.version as typeof material.version & { originalAvailable?: boolean }).originalAvailable && <Button asChild variant="outline" className="mt-2 min-h-11 md:min-h-9"><a href={`/api/research/materials/${encodeURIComponent(material.version.id)}/original`} target="_blank" rel="noopener noreferrer">{material.version.mimeType === 'application/pdf' ? 'Abrir original' : 'Baixar original'}</a></Button>}
    {retry && <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={busy} onClick={onRequest}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Tentar obter</Button>}
  </section>;
}
