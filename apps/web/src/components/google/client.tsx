'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { googleStatusDto } from '@/lib/capabilities/google';
import { googleOperationPath, type GoogleOperation } from '@/lib/google/routes';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type GoogleStatus = z.infer<typeof googleStatusDto>;
export class GoogleClientError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}
export async function googleCall<T>(operation: GoogleOperation, input: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(googleOperationPath(operation), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new GoogleClientError(body.error ?? 'Não foi possível concluir a operação.', body.code);
  return body as T;
}

export function GoogleApprovalReview({ approvalId, onReady }: { approvalId: string; onReady?: (ready: boolean) => void }) {
  const [review, setReview] = useState<Array<{ label: string; value: string }> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    onReady?.(false);
    fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, { cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar a confirmação.');
      if (active) { setReview(body.review); onReady?.(body.review === null || body.review.length > 0); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a confirmação.'); });
    return () => { active = false; };
  }, [approvalId, onReady]);
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!review) return null;
  if (!review.length) return <p role="alert">A proposta não contém uma revisão completa. Prepare a operação novamente.</p>;
  return <dl className="grid max-h-[55dvh] gap-3 overflow-auto text-sm">{review.map((item, index) => <div key={index}><dt className="font-medium">{item.label}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{item.value || '—'}</dd></div>)}</dl>;
}

/** All surfaces use the same exact, server-bound approval; cancellation never replays the write. */
export function useGoogleAction() {
  const [pending, setPending] = useState<{ id: string; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const decision = useRef<((approved: boolean) => void) | null>(null);
  useEffect(() => () => decision.current?.(false), []);
  const run = useCallback(async <T,>(operation: GoogleOperation, input: Record<string, unknown> = {}): Promise<T> => {
    const request = { ...input, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() };
    try { return await googleCall<T>(operation, request); }
    catch (failure) {
      const id = failure instanceof GoogleClientError && failure.code === 'APPROVAL_REQUIRED'
        ? /Proposta registrada \[id: ([0-9a-f-]{36})\]/i.exec(failure.message)?.[1] : null;
      if (!id) throw failure;
      if (decision.current) throw new Error('Conclua a confirmação em aberto antes de continuar.');
      setReady(false); setError(''); setPending({ id, message: failure instanceof Error ? failure.message.split(' Proposta registrada')[0] : 'Revise a ação.' });
      const approved = await new Promise<boolean>(resolve => { decision.current = resolve; });
      decision.current = null; setPending(null);
      if (!approved) throw new GoogleClientError('Operação cancelada.', 'CANCELLED');
      return googleCall<T>(operation, { ...request, approvalId: id });
    }
  }, []);
  async function decide(approve: boolean) {
    if (!pending) return;
    if (!approve) { decision.current?.(false); return; }
    setConfirming(true); setError('');
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(pending.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Não foi possível confirmar.'); }
      decision.current?.(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível confirmar.'); }
    finally { setConfirming(false); }
  }
  const approvalDialog = <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open && !confirming) void decide(false); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Confirme a ação no Google</DialogTitle><DialogDescription>{pending?.message}</DialogDescription></DialogHeader>{pending && <GoogleApprovalReview key={pending.id} approvalId={pending.id} onReady={setReady} />}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={confirming} onClick={() => void decide(false)}>Cancelar</Button><Button disabled={!ready || confirming} onClick={() => void decide(true)}>{confirming ? 'Confirmando…' : 'Confirmar'}</Button></DialogFooter></DialogContent></Dialog>;
  return { run, approvalDialog };
}

export function GoogleConnectionNotice({ status, module }: { status: GoogleStatus; module: 'gmail' | 'calendar' | 'drive' | 'docs' }) {
  const path = usePathname();
  const feature = status.modules.find(item => item.module === module);
  const message = !status.configured ? 'A integração Google ainda não foi configurada neste ambiente.'
    : !feature?.rolledOut ? 'Este recurso ainda não foi liberado para o escritório.'
      : !feature.enabledByOffice ? 'O administrador desativou este recurso para o escritório.'
        : status.connection?.status === 'reauth_required' ? 'Reconecte sua conta Google para continuar.'
          : !feature.granted ? 'Conecte sua conta Google e autorize este recurso para continuar.' : null;
  if (!message) return null;
  return <div className="py-8 text-sm"><p>{message}</p>{path !== '/app/integrations' && <Link href="/app/integrations" className="mt-3 inline-block underline underline-offset-4">Abrir integrações</Link>}</div>;
}
