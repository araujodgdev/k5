'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
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
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-10"><Link href={back} className="text-sm text-muted-foreground underline-offset-2 hover:underline">Voltar ao caso</Link><h1 className="page-title mt-4 border-b pb-5">Minuta</h1>
    {loading && <p className="py-8 text-sm text-muted-foreground">Carregando minuta…</p>}
    {error && <p role="alert" className="flex gap-2 py-5 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {run && <div className="space-y-4 py-6 text-sm" aria-live="polite"><p>{run.status === 'queued' ? 'Aguardando preparação.' : run.status === 'running' ? `Preparando minuta · ${run.progress}%` : run.status === 'completed' ? 'Minuta pronta para revisão.' : run.status === 'failed' ? run.error || 'Não foi possível preparar a minuta.' : 'Preparação interrompida.'}</p>{run.artifactId && <Button asChild><Link href={`/app/documents/${encodeURIComponent(run.artifactId)}`}>Abrir minuta</Link></Button>}</div>}
  </div>;
}
