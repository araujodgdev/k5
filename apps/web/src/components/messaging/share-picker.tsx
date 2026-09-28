'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { casePickPageDto, createShareInput, createShareOutput, documentPickPageDto, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { jsonPost, messageError, messageRequest, MessageRequestError } from './client';

type DocumentPage = z.infer<typeof documentPickPageDto>;
type CasePage = z.infer<typeof casePickPageDto>;
type PickPage = { kind: 'document'; page: DocumentPage } | { kind: 'case'; page: CasePage };
type Selection = { kind: 'document'; document: DocumentPage['documents'][number] } | { kind: 'case'; case: CasePage['cases'][number]; permission: 'viewer' | 'editor' };
type ShareInput = z.infer<typeof createShareInput>;

export function SharePicker({ thread, open, canShareDocuments, onClose, onShared }: {
  thread: Thread; open: boolean; canShareDocuments: boolean; onClose: (keepAttempt: boolean) => void; onShared: () => void;
}) {
  const [kind, setKind] = useState<'document' | 'case'>(canShareDocuments ? 'document' : 'case');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<PickPage | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
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
          const result: PickPage = kind === 'document'
            ? { kind, page: await messageRequest(`picks/documents?${params}`, documentPickPageDto, { signal: controller.signal }) }
            : { kind, page: await messageRequest(`picks/cases?${params}`, casePickPageDto, { signal: controller.signal }) };
          if (!controller.signal.aborted) setPage(result);
        } catch (failure) { if (!controller.signal.aborted) { setPage(null); setError(messageError(failure)); } }
        finally { if (!controller.signal.aborted) setLoading(false); }
      };
      void load();
    }, 200);
    return () => { controller.abort(); pagingController.current?.abort(); window.clearTimeout(timer); };
  }, [open, kind, query, revision]);

  async function more() {
    if (!page?.page.nextCursor || paging) return;
    const controller = new AbortController(); pagingController.current = controller; setPaging(true);
    const params = new URLSearchParams({ query: query.trim(), cursor: page.page.nextCursor, limit: '30' });
    try {
      if (page.kind === 'document') {
        const value = await messageRequest(`picks/documents?${params}`, documentPickPageDto, { signal: controller.signal });
        if (!controller.signal.aborted) setPage(current => current?.kind === 'document' ? { kind: 'document', page: { ...value, documents: [...new Map([...current.page.documents, ...value.documents].map(document => [document.id, document])).values()] } } : current);
      } else {
        const value = await messageRequest(`picks/cases?${params}`, casePickPageDto, { signal: controller.signal });
        if (!controller.signal.aborted) setPage(current => current?.kind === 'case' ? { kind: 'case', page: { ...value, cases: [...new Map([...current.page.cases, ...value.cases].map(item => [item.id, item])).values()] } } : current);
      }
    } catch (failure) { if (!controller.signal.aborted) setError(messageError(failure)); }
    finally { setPaging(false); }
  }

  async function share() {
    if (!selection || running.current) return;
    const next: ShareInput = attempt ?? (selection.kind === 'document'
      ? { kind: 'document', documentId: selection.document.id, version: selection.document.currentVersion, clientMessageId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }
      : { kind: 'case', caseId: selection.case.id, permission: selection.permission, canInvite: false, clientMessageId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
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
      <DialogDescription>Escolha o conteúdo do Cofre e confira o acesso antes de enviar.</DialogDescription>
      <div className="flex border-b border-line" role="group" aria-label="Tipo de compartilhamento">
        {canShareDocuments && <Button type="button" variant="ghost" disabled={disabled} aria-pressed={kind === 'document'} className={cn('min-h-11 flex-1 border-b-2 md:min-h-9', kind === 'document' ? 'border-foreground' : 'border-transparent')} onClick={() => { setKind('document'); setSelection(null); }}>Documento</Button>}
        <Button type="button" variant="ghost" disabled={disabled} aria-pressed={kind === 'case'} className={cn('min-h-11 flex-1 border-b-2 md:min-h-9', kind === 'case' ? 'border-foreground' : 'border-transparent')} onClick={() => { setKind('case'); setSelection(null); }}>Caso</Button>
      </div>
      <label className="grid gap-2 text-sm">{kind === 'document' ? 'Buscar documento' : 'Buscar caso'}<Input value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} maxLength={180} className="min-h-11 md:min-h-9" /></label>
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!attempt && <Button type="button" variant="ghost" onClick={() => setRevision(value => value + 1)} className="min-h-11 md:min-h-9">Tentar novamente</Button>}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y">
        {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Carregando o Cofre…</p> : <>
          {page?.kind === 'document' && (page.page.documents.length ? page.page.documents.map(document => <button type="button" key={document.id} disabled={disabled} aria-pressed={selection?.kind === 'document' && selection.document.id === document.id} className={cn('block w-full border-b border-l-2 px-3 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50', selection?.kind === 'document' && selection.document.id === document.id ? 'border-l-foreground' : 'border-l-transparent')} onClick={() => setSelection({ kind: 'document', document })}>
            <span className="block truncate text-sm font-medium">{document.name}</span><span className="mt-1 block text-xs text-muted-foreground">Versão {document.currentVersion} · {document.caseName || 'Biblioteca'}</span>
          </button>) : <p className="py-5 text-sm text-muted-foreground">Nenhum documento disponível para compartilhar.</p>)}
          {page?.kind === 'case' && (page.page.cases.length ? page.page.cases.map(item => <button type="button" key={item.id} disabled={disabled} aria-pressed={selection?.kind === 'case' && selection.case.id === item.id} className={cn('block w-full border-b border-l-2 px-3 py-4 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50', selection?.kind === 'case' && selection.case.id === item.id ? 'border-l-foreground' : 'border-l-transparent')} onClick={() => setSelection({ kind: 'case', case: item, permission: item.allowedPermissions.includes('viewer') ? 'viewer' : 'editor' })}>{item.name}</button>) : <p className="py-5 text-sm text-muted-foreground">Nenhum caso disponível para convidar esta pessoa.</p>)}
          {page?.page.nextCursor && <Button type="button" variant="ghost" disabled={paging || disabled} onClick={() => void more()} className="my-2 min-h-11 w-full md:min-h-9">{paging ? 'Carregando…' : 'Carregar mais'}</Button>}
        </>}
      </div>
      {selection && <div className="space-y-3 text-sm">
        <p className="break-words font-medium">{selection.kind === 'document' ? `${selection.document.name}, versão ${selection.document.currentVersion}` : selection.case.name}</p>
        {selection.kind === 'document' ? <p className="text-muted-foreground">Permite visualizar e baixar esta versão. Outros documentos e novas versões continuam privados.</p> : <>
          <label className="flex flex-wrap items-center justify-between gap-3">Acesso ao caso<select aria-label="Acesso ao caso" value={selection.permission} disabled={disabled} className="min-h-11 border border-input bg-background px-3 md:min-h-9" onChange={event => { const value = event.target.value; if (value === 'viewer' || value === 'editor') setSelection({ ...selection, permission: value }); }}>
            {selection.case.allowedPermissions.map(permission => <option key={permission} value={permission}>{permission === 'viewer' ? 'Consulta' : 'Colaboração'}</option>)}
          </select></label><p className="text-muted-foreground">{selection.permission === 'viewer' ? 'Após aceitar o convite, a pessoa poderá consultar e baixar os arquivos e fontes deste caso.' : 'Após aceitar o convite, a pessoa poderá consultar, adicionar, alterar e remover arquivos deste caso.'}</p>
        </>}
        {thread.channel === 'email_outbound' && <p className="text-muted-foreground">O convite será enviado por e-mail. O acesso exige entrar com o endereço destinatário.</p>}
      </div>}
      {attempt && !busy && <p role="status" className="border-l-2 border-brand pl-3 text-sm">O resultado ainda não foi confirmado. Confira o mesmo compartilhamento antes de criar outro.</p>}
      <Button type="button" disabled={!selection || busy} onClick={() => void share()} className="min-h-11 w-full md:min-h-9">{busy ? 'Confirmando…' : attempt ? 'Conferir compartilhamento' : selection?.kind === 'case' ? 'Enviar convite para o caso' : 'Compartilhar documento'}</Button>
    </DialogContent>
  </Dialog>;
}
