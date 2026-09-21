'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import type { VerificationReport } from '@/lib/typesafe/verification-contracts';
const labels = { supported: 'A fonte indica suporte', unsupported: 'Suporte insuficiente', contradicted: 'Contradição com a fonte', insufficient_context: 'Contexto insuficiente', quote_not_found: 'Evidência vinculada ausente ou não localizada', unavailable: 'Não verificado' };
const statuses: Record<string, string> = { queued: 'Aguardando verificação pelo worker.', running: 'Verificando evidências…', completed: 'Verificação concluída. A revisão do advogado continua necessária.', incomplete: 'Verificação semântica incompleta.', stale: 'Verificação desatualizada. O documento ou suas fontes mudaram.', disabled: 'Verificação desativada.' };
export function DocumentVerification({ artifactId, version, dirty }: { artifactId: string; version: number; dirty: boolean }) {
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/artifacts/${artifactId}/verification`, { signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error);
        if (controller.signal.aborted) return;
        setReport(body.verification); setError('');
        if (['queued', 'running'].includes(body.verification?.status)) timer = setTimeout(load, 3000);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível consultar a verificação.'); }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [artifactId, version, revision]);
  async function verify() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/verification`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setRevision(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível iniciar.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 border-t pt-5" aria-label="Sustentação nas fontes">
    <h2 className="font-medium">Sustentação nas fontes</h2>
    <p className="mt-2 text-xs text-muted-foreground" role="status">{dirty ? 'Salve as alterações para verificar esta versão.' : report ? statuses[report.status] || 'Revisão necessária.' : 'Esta versão ainda não foi verificada.'}</p>
    {report && <p className="mt-2 text-xs text-muted-foreground">{report.checked} de {report.total} unidades processadas{report.mode === 'shadow' ? ' · Avaliação sem aplicar resultados' : ''}. A cobertura considera as unidades vinculadas abaixo.</p>}
    <Button className="mt-3 h-11 md:h-9" variant="outline" disabled={busy || dirty || report?.status === 'queued' || report?.status === 'running'} onClick={() => void verify()}>{busy ? 'Enfileirando…' : 'Verificar versão salva'}</Button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {report && !dirty && report.status !== 'stale' && <div className="mt-3 divide-y">{report.items.map(item => <details key={item.unitId} className="py-3 text-sm"><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring">{labels[item.outcome]}</summary><p className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>{item.sources.map((source, i) => <div key={i} className="mt-3"><a className="underline underline-offset-4" href={`/api/vault/documents/${encodeURIComponent(source.documentId)}/download`} target="_blank" rel="noreferrer">{source.sourceLabel}</a><p className="mt-1 break-words text-xs text-muted-foreground">{source.excerpt}</p></div>)}</details>)}</div>}
  </section>;
}
