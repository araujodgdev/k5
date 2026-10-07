'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Briefcase, CircleAlert, Scale } from 'lucide-react';
import { CanvasTrail } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { requestCapability } from '@/lib/capabilities/http-client';

type Run = { id: string; status: string; progress: number; error: string | null; artifactId: string | null };
export function ResearchDraftStatus({ runId, caseId }: { runId: string; caseId: string | null }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      const response = await requestCapability('k5_runs_get', { runId });
      running = false;
      if (cancelled) return;
      if (response.ok) setRun((response.data as { run: Run }).run);
      else setError(response.error);
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !error && (!run || ['queued', 'running'].includes(run.status))) void load();
    }, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [runId, run, error]);
  const back = caseId ? `/app/vault/cases/${encodeURIComponent(caseId)}?section=references` : '/app/research';
  const state = !run ? null : run.status === 'queued' ? 'Aguardando preparação.' : run.status === 'running' ? `Preparando minuta · ${run.progress}%`
    : run.status === 'completed' ? 'Minuta pronta para revisão.' : run.status === 'failed' ? run.error || 'Não foi possível preparar a minuta.' : 'Preparação interrompida.';
  return <>
    <CanvasTrail back={{ href: back, label: caseId ? 'Caso' : 'Pesquisa' }} icon={caseId ? <Briefcase /> : <Scale />} current="Minuta" />
    <CanvasPage>
      <CanvasHeader eyebrow="Pesquisa" title="Minuta" actions={run?.artifactId && <Button asChild size="lg" className="h-11 md:h-[34px]"><Link href={`/app/documents/${encodeURIComponent(run.artifactId)}`}>Abrir minuta</Link></Button>} />
      {loading && <p role="status" className="text-[13.5px] text-muted-foreground">Carregando minuta…</p>}
      {error && <p role="alert" className="flex gap-2 text-[13.5px] text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {state && <p aria-live="polite" className="text-[14.5px]">{state}</p>}
    </CanvasPage>
  </>;
}
