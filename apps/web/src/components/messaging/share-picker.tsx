'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { createShareInput, createShareOutput, documentPickPageDto, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { jsonPost, messageError, messageRequest, MessageRequestError } from './client';

type DocumentPage = z.infer<typeof documentPickPageDto>;
type Picked = DocumentPage['documents'][number];
type ShareInput = z.infer<typeof createShareInput>;

/** Shares one version of a Cofre document. Cases are shared with associates inside the case, not here. */
export function SharePicker({ thread, open, onClose, onShared }: {
  thread: Thread; open: boolean; onClose: (keepAttempt: boolean) => void; onShared: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<DocumentPage | null>(null);
  const [selection, setSelection] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<ShareInput | null>(null);
  const [revision, setRevision] = useState(0);
  const running = useRef(false);
  const pagingController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); pagingController.current?.abort();
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ query: query.trim(), limit: '30' });
      const load = async () => {
        try {
          const result = await messageRequest(`picks/documents?${params}`, documentPickPageDto, { signal: controller.signal });
          if (!controller.signal.aborted) setPage(result);
        } catch (failure) { if (!controller.signal.aborted) { setPage(null); setError(messageError(failure)); } }
        finally { if (!controller.signal.aborted) setLoading(false); }
      };
      void load();
    }, 200);
    return () => { controller.abort(); pagingController.current?.abort(); window.clearTimeout(timer); };
  }, [open, query, revision]);

  async function more() {
    if (!page?.nextCursor || paging) return;
    const controller = new AbortController(); pagingController.current = controller; setPaging(true);
    const params = new URLSearchParams({ query: query.trim(), cursor: page.nextCursor, limit: '30' });
    try {
      const value = await messageRequest(`picks/documents?${params}`, documentPickPageDto, { signal: controller.signal });
      if (!controller.signal.aborted) setPage(current => current ? { ...value, documents: [...new Map([...current.documents, ...value.documents].map(document => [document.id, document])).values()] } : current);
    } catch (failure) { if (!controller.signal.aborted) setError(messageError(failure)); }
    finally { setPaging(false); }
  }

  async function share() {
    if (!selection || running.current) return;
    const next: ShareInput = attempt ?? { kind: 'document', documentId: selection.id, version: selection.currentVersion, clientMessageId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    running.current = true; setBusy(true); setError(''); setAttempt(next);
    try {
      await messageRequest(`threads/${encodeURIComponent(thread.id)}/shares`, createShareOutput, jsonPost(next));
      setAttempt(null); onShared();
    } catch (failure) {
      setError(messageError(failure));
      if (!(failure instanceof MessageRequestError) || !failure.uncertain) setAttempt(null);
    } finally { running.current = false; setBusy(false); }
  }

  const disabled = busy || Boolean(attempt);
  const peerName = thread.channel === 'in_app' ? thread.peer.name : thread.peer.email;
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(Boolean(attempt)); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto sm:max-w-xl [&_[data-slot=dialog-close]]:size-11 md:[&_[data-slot=dialog-close]]:size-9" onCloseAutoFocus={event => { event.preventDefault(); document.getElementById('personal-message-share')?.focus(); }}>
      <DialogTitle className="break-words pr-10">Compartilhar com {peerName}</DialogTitle>
      <DialogDescription>Escolha um documento do Cofre e confira o acesso antes de enviar.</DialogDescription>
      <label className="grid gap-2 text-sm">Buscar documento<Input value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} maxLength={180} className="min-h-11 md:min-h-9" /></label>
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!attempt && <Button type="button" variant="ghost" onClick={() => setRevision(value => value + 1)} className="min-h-11 md:min-h-9">Tentar novamente</Button>}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y">
        {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Carregando o Cofre…</p> : <>
          {page && (page.documents.length ? page.documents.map(document => <button type="button" key={document.id} disabled={disabled} aria-pressed={selection?.id === document.id} className={cn('block w-full border-b border-l-2 px-3 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50', selection?.id === document.id ? 'border-l-foreground' : 'border-l-transparent')} onClick={() => setSelection(document)}>
            <span className="block truncate text-sm font-medium">{document.name}</span><span className="mt-1 block text-xs text-muted-foreground">Versão {document.currentVersion} · {document.caseName || 'Biblioteca'}</span>
          </button>) : <p className="py-5 text-sm text-muted-foreground">Nenhum documento disponível para compartilhar.</p>)}
          {page?.nextCursor && <Button type="button" variant="ghost" disabled={paging || disabled} onClick={() => void more()} className="my-2 min-h-11 w-full md:min-h-9">{paging ? 'Carregando…' : 'Carregar mais'}</Button>}
        </>}
      </div>
      {selection && <div className="space-y-3 text-sm">
        <p className="break-words font-medium">{selection.name}, versão {selection.currentVersion}</p>
        <p className="text-muted-foreground">Permite visualizar e baixar esta versão. Outros documentos e novas versões continuam privados.</p>
        {thread.channel === 'email_outbound' && <p className="text-muted-foreground">O link será enviado por e-mail. O acesso exige entrar com o endereço destinatário.</p>}
      </div>}
      {attempt && !busy && <p role="status" className="border-l-2 border-brand pl-3 text-sm">O resultado ainda não foi confirmado. Confira o mesmo compartilhamento antes de criar outro.</p>}
      <Button type="button" disabled={!selection || busy} onClick={() => void share()} className="min-h-11 w-full md:min-h-9">{busy ? 'Confirmando…' : attempt ? 'Conferir compartilhamento' : 'Compartilhar documento'}</Button>
    </DialogContent>
  </Dialog>;
}
