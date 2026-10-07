'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = { title: string; content: string; destination: string; audience: string; version: number | null };
export function PageApprovalReview({ approvalId, onReady }: { approvalId: string; onReady: (ready: boolean) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    onReady(false);
    void fetch(`/api/approvals/${encodeURIComponent(approvalId)}/page`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'A proposta não está disponível.');
      if (!controller.signal.aborted) { setPreview(body); onReady(true); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a proposta.'); });
    return () => controller.abort();
  }, [approvalId, attempt, onReady]);
  if (error) return <div role="alert" className="text-sm"><p>{error}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => { setPreview(null); setError(''); onReady(false); setAttempt(value => value + 1); }}>Tentar novamente</Button></div>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Carregando proposta…</p>;
  return <div className="min-w-0 text-sm" aria-label="Conteúdo proposto">
    <p>{preview.destination}</p><p className="mt-1 text-xs text-muted-foreground">{preview.audience}{preview.version ? ` Versão atual ${preview.version}.` : ''}</p>
    <div className="mt-3 max-h-[45dvh] overflow-y-auto whitespace-pre-wrap break-words" tabIndex={0}><p className="font-medium">{preview.title}</p><div className="mt-2">{preview.content}</div></div>
  </div>;
}
