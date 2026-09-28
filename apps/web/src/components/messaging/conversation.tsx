'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, Paperclip, Send } from 'lucide-react';
import { z } from 'zod';
import { markReadOutput, messagePageDto, type PersonalMessage as Message, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { MessageAttachment } from '@/components/message-attachment';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { jsonPost, messageDate, messageError, messageRequest, revokeDocumentShare, useMessagePoll } from './client';

export type SendAttempt = { clientMessageId: string; text: string; phase: 'sending' | 'unknown' | 'failed'; error: string };
type MessagePage = z.infer<typeof messagePageDto>;
const emailLabels = { pending: 'Aguardando envio por e-mail', accepted: 'E-mail aceito para envio', retry: 'Aguardando nova tentativa de e-mail', unknown: 'Envio por e-mail não confirmado', failed: 'E-mail não enviado', cancelled: 'Envio por e-mail cancelado' };
const shareLabels = { active: 'Acesso disponível', pending_claim: 'Aguardando confirmação do destinatário', revoked: 'Acesso removido', unavailable: 'Documento indisponível' };
const invitationLabels = { pending: 'Convite aguardando aceite', accepted: 'Convite aceito', declined: 'Convite recusado', revoked: 'Convite cancelado', expired: 'Convite expirado' };

function mergeMessages(current: Message[], incoming: Message[]) {
  return [...new Map([...current, ...incoming].map(message => [message.id, message])).values()];
}

export function Conversation({ thread, draft, attempt, revision, onDraft, onSend, onBack, onShare, onRead, onChanged }: {
  thread: Thread; draft: string; attempt?: SendAttempt; revision: number; onDraft: (text: string) => void;
  onSend: (text: string) => void; onBack: () => void; onShare: () => void; onRead: () => void; onChanged: () => void;
}) {
  const [history, setHistory] = useState<MessagePage | null>(null);
  const [error, setError] = useState('');
  const [paging, setPaging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const paged = useRef(false);
  const markedRead = useRef('');
  const readInFlight = useRef(false);
  const pageController = useRef<AbortController | null>(null);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);
  const currentHistory = useRef<MessagePage | null>(null);
  const peerName = thread.channel === 'in_app' ? thread.peer.name : thread.peer.email;
  const path = `threads/${encodeURIComponent(thread.id)}`;

  useEffect(() => { title.current?.focus(); return () => pageController.current?.abort(); }, []);

  const markRead = useCallback(async (messages: Message[]) => {
    if (thread.channel !== 'in_app' || !nearEnd.current || document.visibilityState !== 'visible' || readInFlight.current) return;
    const latest = messages.findLast(message => message.direction === 'incoming');
    if (!latest || markedRead.current === latest.id) return;
    readInFlight.current = true;
    try {
      await messageRequest(`${path}/read`, markReadOutput, jsonPost({ throughMessageId: latest.id }));
      markedRead.current = latest.id; onRead();
    } catch { /* The next visible poll repeats this read receipt. */ }
    finally { readInFlight.current = false; }
  }, [thread.channel, path, onRead]);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const value = await messageRequest(`${path}/messages?limit=50`, messagePageDto, { signal });
      if (signal.aborted) return;
      const messages = value.messages.toReversed();
      setHistory(current => {
        const next = { ...value, messages: mergeMessages(current?.messages ?? [], messages), olderCursor: paged.current && current ? current.olderCursor : value.olderCursor };
        currentHistory.current = next; return next;
      });
      setError(''); await markRead(messages);
    } catch (failure) { if (!signal.aborted) setError(messageError(failure)); }
  }, [path, markRead]);
  useMessagePoll(load, `${revision}:${refresh}`);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || !history) return;
    if (scrollRestore.current) {
      node.scrollTop = scrollRestore.current.top + node.scrollHeight - scrollRestore.current.height;
      scrollRestore.current = null;
    } else if (nearEnd.current) node.scrollTop = node.scrollHeight;
  }, [history]);

  async function older() {
    if (!history?.olderCursor || paging) return;
    const controller = new AbortController(); pageController.current = controller; setPaging(true);
    try {
      const value = await messageRequest(`${path}/messages?${new URLSearchParams({ before: history.olderCursor, limit: '50' })}`, messagePageDto, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const node = viewport.current;
      if (node) scrollRestore.current = { height: node.scrollHeight, top: node.scrollTop };
      paged.current = true;
      setHistory(current => {
        const next = { ...value, messages: mergeMessages(value.messages.toReversed(), current?.messages ?? []) };
        currentHistory.current = next; return next;
      });
    } catch (failure) { if (!controller.signal.aborted) setError(messageError(failure)); }
    finally { setPaging(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (attempt?.phase === 'sending' || !draft.trim()) return;
    nearEnd.current = true; setAwayFromEnd(false); onSend(attempt?.phase === 'unknown' ? attempt.text : draft.trim());
  }

  return <section aria-labelledby="messaging-conversation-title" className="flex min-h-0 min-w-0 flex-col" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onBack(); } }}>
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4 md:px-8">
      <Button type="button" variant="ghost" className="min-h-11 min-w-11 md:hidden" aria-label="Voltar para as conversas" onClick={onBack}><ArrowLeft aria-hidden="true" /></Button>
      <div className="min-w-0 flex-1"><h2 ref={title} tabIndex={-1} id="messaging-conversation-title" className="truncate font-medium outline-none">{peerName}</h2><p className="mt-1 truncate text-xs text-muted-foreground">{thread.channel === 'in_app' ? thread.peer.email : 'E-mail somente de saída'}</p></div>
    </header>
    {thread.channel === 'email_outbound' && <p className="shrink-0 border-b px-5 py-3 text-sm text-muted-foreground md:px-8">Suas mensagens serão enviadas por e-mail. Respostas por e-mail não aparecem aqui.</p>}
    <div ref={viewport} role="region" aria-label={`Mensagens com ${peerName}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand" onScroll={event => {
      const node = event.currentTarget; nearEnd.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; setAwayFromEnd(!nearEnd.current);
      if (nearEnd.current && currentHistory.current) void markRead(currentHistory.current.messages);
    }}>
      {!history && !error && <p role="status" className="px-5 py-6 text-sm text-muted-foreground md:px-8">Carregando mensagens…</p>}
      {error && <div className="space-y-2 border-b px-5 py-4 md:px-8"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></div>}
      {history?.olderCursor && <div className="border-b px-5 py-2 md:px-8"><Button type="button" variant="ghost" className="min-h-11 w-full md:min-h-9" disabled={paging} onClick={() => void older()}>{paging ? 'Carregando…' : 'Mensagens anteriores'}</Button></div>}
      {history?.messages.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground md:px-8">Envie a primeira mensagem para iniciar a conversa.</p>}
      <div className="divide-y">{history?.messages.map(message => <MessageEntry key={message.id} message={message} onChanged={onChanged} />)}</div>
    </div>
    {awayFromEnd && <Button type="button" variant="ghost" className="min-h-11 shrink-0 border-t md:min-h-9" onClick={() => { nearEnd.current = true; setAwayFromEnd(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; if (currentHistory.current) void markRead(currentHistory.current.messages); }}><ArrowDown aria-hidden="true" />Mensagens recentes</Button>}
    <form className="shrink-0 border-t border-line bg-background px-5 py-4 md:px-8" onSubmit={submit}>
      {attempt?.error && <p role="alert" className="mb-3 text-sm text-destructive">{attempt.error}</p>}
      {attempt?.phase === 'unknown' && <p className="mb-3 border-l-2 border-brand pl-3 text-sm">O envio ainda não foi confirmado. Confira esta mensagem antes de escrever outra.</p>}
      <label htmlFor="personal-message" className="sr-only">Mensagem para {peerName}</label>
      <Textarea id="personal-message" value={draft} onChange={event => onDraft(event.target.value)} disabled={attempt?.phase === 'sending' || attempt?.phase === 'unknown'} maxLength={20_000} rows={3} className="max-h-36 min-h-22 resize-none text-sm" placeholder="Escreva uma mensagem" onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button id="personal-message-share" type="button" variant="ghost" onClick={onShare} className="min-h-11 md:min-h-9"><Paperclip aria-hidden="true" />Compartilhar do Cofre</Button>
        <Button type="submit" disabled={!draft.trim() || attempt?.phase === 'sending'} className="min-h-11 md:min-h-9"><Send aria-hidden="true" />{attempt?.phase === 'sending' ? 'Enviando…' : attempt?.phase === 'unknown' ? 'Conferir envio' : thread.channel === 'email_outbound' ? 'Enviar por e-mail' : 'Enviar'}</Button>
      </div>
    </form>
  </section>;
}

function MessageEntry({ message, onChanged }: { message: Message; onChanged: () => void }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState('');
  const body = message.body;
  async function revoke() {
    if (body.kind !== 'document_share' || revoking) return;
    setRevoking(true); setError('');
    try { await revokeDocumentShare(body.shareId); setRevoked(true); setConfirmRevoke(false); onChanged(); }
    catch (failure) { setError(messageError(failure)); }
    finally { setRevoking(false); }
  }
  const actionPath = body.kind === 'case_invitation' && body.actionPath && (body.actionPath.startsWith('/invite/') || body.actionPath.startsWith('/app/vault/cases/')) ? body.actionPath : null;
  return <article className={cn('min-w-0 px-5 py-5 md:px-8', message.direction === 'outgoing' && 'border-l-2 border-l-foreground')}>
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{message.direction === 'incoming' ? message.sender.name : 'Você'}</span><time dateTime={message.createdAt}>{messageDate(message.createdAt)}</time></div>
    {body.kind === 'text' && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{body.text}</p>}
    {body.kind === 'document_share' && <>
      {!revoked && body.state === 'active' && body.contentUrl ? <MessageAttachment filename={body.name} mimeType={body.mimeType} url={body.contentUrl} downloadUrl={`${body.contentUrl}${body.contentUrl.includes('?') ? '&' : '?'}download=1`} /> : <p className="break-words text-sm font-medium">{body.name}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Versão {body.version} · {shareLabels[revoked ? 'revoked' : body.state]}</p>
      {!revoked && body.canRevoke && (body.state === 'active' || body.state === 'pending_claim') && (confirmRevoke ? <div className="mt-3 border-l-2 border-brand pl-3"><p className="text-sm">Remover o acesso a este documento?</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" disabled={revoking} onClick={() => void revoke()} className="min-h-11 md:min-h-9">{revoking ? 'Removendo…' : 'Remover acesso'}</Button><Button type="button" variant="ghost" disabled={revoking} onClick={() => setConfirmRevoke(false)} className="min-h-11 md:min-h-9">Cancelar</Button></div></div>
        : <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(true)} className="mt-2 min-h-11 md:min-h-9">Remover acesso</Button>)}
    </>}
    {body.kind === 'case_invitation' && <div className="space-y-2"><p className="break-words text-sm font-medium">{body.caseName}</p><p className="text-xs text-muted-foreground">{invitationLabels[body.state]}</p>{actionPath && <Button variant="outline" className="min-h-11 md:min-h-9" asChild><Link href={actionPath}>{actionPath.startsWith('/app/vault/cases/') ? 'Abrir caso' : 'Ver convite'}</Link></Button>}</div>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {message.direction === 'outgoing' && <p className="mt-2 text-xs text-muted-foreground">{message.delivery.kind === 'in_app' ? message.delivery.state === 'read' ? 'Lida' : 'Enviada' : emailLabels[message.delivery.state]}{message.delivery.kind === 'email' && message.delivery.errorLabel ? `. ${message.delivery.errorLabel}` : ''}</p>}
  </article>;
}
