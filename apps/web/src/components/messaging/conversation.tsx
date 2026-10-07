'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle, Mail, MessageSquare, Paperclip } from 'lucide-react';
import { z } from 'zod';
import { markReadOutput, messagePageDto, type PersonalMessage as Message, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { CanvasTrail } from '@/components/canvas/canvas-controls';
import { MessageAttachment } from '@/components/message-attachment';
import { Button } from '@/components/ui/button';
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

  const sending = attempt?.phase === 'sending';
  const column = 'mx-auto w-full max-w-[720px] px-4 md:px-10';
  return <section aria-labelledby="messaging-conversation-title" className="messaging-workspace flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onBack(); } }}>
    <CanvasTrail back={{ href: '/app/messages', label: 'Mensagens' }} icon={thread.channel === 'in_app' ? <MessageSquare /> : <Mail />} current={peerName} />
    <div ref={viewport} role="region" aria-label={`Mensagens com ${peerName}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" onScroll={event => {
      const node = event.currentTarget; nearEnd.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; setAwayFromEnd(!nearEnd.current);
      if (nearEnd.current && currentHistory.current) void markRead(currentHistory.current.messages);
    }}>
      <div className={cn(column, 'flex flex-col gap-5 pt-6 pb-4 md:pt-10')}>
        <header className="flex flex-col gap-1">
          <h1 ref={title} tabIndex={-1} id="messaging-conversation-title" className="truncate text-[22px] font-semibold tracking-[-0.02em] outline-none md:text-2xl">{peerName}</h1>
          <p className="text-[13px] text-muted-foreground">{thread.channel === 'in_app' ? thread.peer.email : 'Suas mensagens saem por e-mail. Respostas por e-mail não aparecem aqui.'}</p>
        </header>
        {!history && !error && <p role="status" className="text-[13.5px] text-muted-foreground">Carregando mensagens…</p>}
        {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{error}</p><Button type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></div>}
        {history?.olderCursor && <Button type="button" variant="ghost" size="lg" className="h-11 self-center text-muted-foreground md:h-[34px]" disabled={paging} onClick={() => void older()}>{paging ? 'Carregando…' : 'Mensagens anteriores'}</Button>}
        {history?.messages.length === 0 && <p className="text-[13.5px] text-muted-foreground">Envie a primeira mensagem para iniciar a conversa.</p>}
        {history?.messages.map(message => <MessageEntry key={message.id} message={message} onChanged={onChanged} />)}
      </div>
    </div>
    <form className={cn(column, 'relative shrink-0 pt-2 pb-4 md:pb-6')} onSubmit={submit}>
      {awayFromEnd && <Button type="button" variant="outline" size="sm" className="absolute -top-9 left-1/2 h-11 -translate-x-1/2 rounded-full bg-card shadow-[var(--shadow-float)] md:h-7" onClick={() => { nearEnd.current = true; setAwayFromEnd(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; if (currentHistory.current) void markRead(currentHistory.current.messages); }}><ArrowDown aria-hidden="true" />Mensagens recentes</Button>}
      {attempt?.error && <p role="alert" className="mb-2 text-[13.5px] text-destructive">{attempt.error}</p>}
      {attempt?.phase === 'unknown' && <p className="mb-2 text-[13.5px]">O envio ainda não foi confirmado. Confira esta mensagem antes de escrever outra.</p>}
      <div className="flex flex-col gap-1.5 rounded-[14px] border border-border-strong bg-card pt-2.5 pr-2.5 pb-2 pl-3.5 transition-shadow focus-within:ring-3 focus-within:ring-ring/30">
        <label htmlFor="personal-message" className="sr-only">Mensagem para {peerName}</label>
        <textarea id="personal-message" value={draft} onChange={event => onDraft(event.target.value)} disabled={sending || attempt?.phase === 'unknown'} maxLength={20_000} rows={2}
          className="max-h-36 min-h-12 w-full resize-none bg-transparent py-0.5 text-[14.5px] leading-[1.5] outline-none placeholder:text-subtle-foreground disabled:opacity-60"
          placeholder={thread.channel === 'email_outbound' ? 'Escreva um e-mail' : 'Escreva uma mensagem'}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="flex items-center gap-1">
          <Button id="personal-message-share" type="button" variant="ghost" className="-ml-1.5 h-11 gap-1.5 px-2 text-[13px] text-muted-foreground md:h-[30px]" onClick={onShare}><Paperclip aria-hidden="true" />Compartilhar do Cofre</Button>
          <span className="flex-1" />
          <Button type="submit" size="icon" disabled={!draft.trim() || sending} className="size-11 rounded-full md:size-8"
            aria-label={sending ? 'Enviando…' : attempt?.phase === 'unknown' ? 'Conferir envio' : thread.channel === 'email_outbound' ? 'Enviar por e-mail' : 'Enviar'}>
            {sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </Button>
        </div>
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
  const own = message.direction === 'outgoing';
  const quiet = 'h-11 px-2.5 text-[13px] md:h-[30px]';
  return <article aria-label={`${own ? 'Você' : message.sender.name}, ${messageDate(message.createdAt)}`} className={cn('flex min-w-0 flex-col gap-1', own ? 'items-end' : 'items-start')}>
    <div className={cn('flex min-w-0 max-w-[86%] flex-col gap-2', own ? 'rounded-[14px] bg-muted px-3.5 py-2.5' : 'py-0.5')}>
      {body.kind === 'text' && <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.55] [overflow-wrap:anywhere]">{body.text}</p>}
      {body.kind === 'document_share' && <>
        {!revoked && body.state === 'active' && body.contentUrl ? <MessageAttachment filename={body.name} mimeType={body.mimeType} url={body.contentUrl} downloadUrl={`${body.contentUrl}${body.contentUrl.includes('?') ? '&' : '?'}download=1`} /> : <p className="break-words text-sm font-medium">{body.name}</p>}
        <p className="text-xs text-muted-foreground">Versão {body.version} · {shareLabels[revoked ? 'revoked' : body.state]}</p>
        {!revoked && body.canRevoke && (body.state === 'active' || body.state === 'pending_claim') && (confirmRevoke ? <div className="flex flex-col gap-2"><p className="text-[13.5px]">Remover o acesso a este documento?</p><div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={revoking} onClick={() => void revoke()} className={quiet}>{revoking ? 'Removendo…' : 'Remover acesso'}</Button><Button type="button" variant="ghost" disabled={revoking} onClick={() => setConfirmRevoke(false)} className={quiet}>Cancelar</Button></div></div>
          : <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(true)} className={cn(quiet, 'self-start text-muted-foreground')}>Remover acesso</Button>)}
      </>}
      {body.kind === 'case_invitation' && <div className="flex flex-col gap-1.5"><p className="break-words text-sm font-medium">{body.caseName}</p><p className="text-xs text-muted-foreground">{invitationLabels[body.state]}</p>{actionPath && <Button variant="outline" size="lg" className="h-11 self-start md:h-[34px]" asChild><Link href={actionPath}>{actionPath.startsWith('/app/vault/cases/') ? 'Abrir caso' : 'Ver convite'}</Link></Button>}</div>}
      {error && <p role="alert" className="text-[13.5px] text-destructive">{error}</p>}
    </div>
    <p className="px-1 text-xs text-muted-foreground">
      {!own && <>{message.sender.name} · </>}<time dateTime={message.createdAt}>{messageDate(message.createdAt)}</time>
      {own && <> · {message.delivery.kind === 'in_app' ? message.delivery.state === 'read' ? 'Lida' : 'Enviada' : emailLabels[message.delivery.state]}{message.delivery.kind === 'email' && message.delivery.errorLabel ? `. ${message.delivery.errorLabel}` : ''}</>}
    </p>
  </article>;
}
