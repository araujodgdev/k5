'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, CircleAlert, LoaderCircle, MessageCircle, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { CanvasTrail } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import { MessageAttachment } from '@/components/message-attachment';
import { messageWhen } from '@/components/messaging/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  connectionStatusDto, historyPageDto, sendReceiptDto, threadPageDto, uploadReceiptDto,
  type ConnectionStatus, type HistoryPage, type InboxMessage, type SendReceipt, type Thread, type ThreadPage,
} from '@/lib/whatsapp/domain';
import { requestMessage, useVisiblePoll, whatsappRequest, WhatsAppRequestError } from './client';

type Remote<T> = { kind: 'loading' } | { kind: 'error'; error: string } | { kind: 'ready'; data: T; error: string | null };
type SendIntent = { threadId: string; text: string; idempotencyKey: string; attachmentId?: string };
type UploadedAttachment = z.infer<typeof uploadReceiptDto>;
type SendAttempt =
  | { kind: 'sending'; intent: SendIntent }
  | { kind: 'uncertain'; intent: SendIntent; error: string }
  | { kind: 'failed'; intent: SendIntent; error: string }
  | { kind: 'receipt'; intent: SendIntent; receipt: SendReceipt };

const syncResult = z.object({ queued: z.boolean() });
const messageLabels = {
  received: 'Recebida', pending: 'Aguardando envio', dispatching: 'Enviando', accepted: 'Envio aceito',
  sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falha no envio', unknown: 'Envio não confirmado',
} satisfies Record<InboxMessage['status'], string>;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

function mergeThreads(current: Thread[], incoming: Thread[]) {
  const entries = new Map(current.map(thread => [thread.id, thread]));
  for (const thread of incoming) entries.set(thread.id, thread);
  return Array.from(entries.values()).sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
}

function mergeMessages(current: InboxMessage[], incoming: InboxMessage[]) {
  const entries = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) entries.set(message.id, message);
  return Array.from(entries.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function failedRemote<T>(current: Remote<T>, error: string): Remote<T> {
  return current.kind === 'ready' ? { ...current, error } : { kind: 'error', error };
}

function sendingUnresolved(attempt: SendAttempt | undefined) {
  return attempt?.kind === 'sending' || attempt?.kind === 'uncertain' ||
    (attempt?.kind === 'receipt' && ['pending', 'dispatching', 'unknown'].includes(attempt.receipt.status));
}

export function WhatsAppInbox() {
  const [threads, setThreads] = useState<Remote<ThreadPage>>({ kind: 'loading' });
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, UploadedAttachment | undefined>>({});
  const [attempts, setAttempts] = useState<Record<string, SendAttempt>>({});
  const [sync, setSync] = useState<'idle' | 'requesting' | 'queued'>('idle');
  const [syncError, setSyncError] = useState('');
  const [paging, setPaging] = useState(false);
  const [revision, setRevision] = useState(0);
  const olderLoaded = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const sends = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const pendingRequests = requests.current;
    const pendingSends = sends.current;
    return () => {
      for (const controller of pendingRequests) controller.abort();
      for (const controller of pendingSends.values()) controller.abort();
    };
  }, []);

  const load = useCallback(async (signal: AbortSignal) => {
    void revision;
    await Promise.all([
      whatsappRequest('status', connectionStatusDto, 'Não foi possível verificar a conexão do WhatsApp.', { signal })
        .then(next => { if (!signal.aborted) { setStatus(next); setConnectionError(''); } })
        .catch(failure => { if (!signal.aborted) setConnectionError(requestMessage(failure, 'Não foi possível verificar a conexão do WhatsApp.')); }),
      whatsappRequest('threads?limit=30', threadPageDto, 'Não foi possível carregar as conversas.', { signal })
        .then(next => {
          if (signal.aborted) return;
          setThreads(current => ({ kind: 'ready', error: null, data: {
            ...next, items: current.kind === 'ready' ? mergeThreads(current.data.items, next.items) : next.items,
            nextCursor: olderLoaded.current && current.kind === 'ready' ? current.data.nextCursor : next.nextCursor,
          } }));
        })
        .catch(failure => { if (!signal.aborted) setThreads(current => failedRemote(current, requestMessage(failure, 'Não foi possível carregar as conversas.'))); }),
    ]);
  }, [revision]);
  useVisiblePoll(load);

  async function loadMoreThreads() {
    if (paging || threads.kind !== 'ready' || !threads.data.nextCursor) return;
    const controller = new AbortController();
    requests.current.add(controller);
    setPaging(true);
    try {
      const next = await whatsappRequest(`threads?limit=30&cursor=${encodeURIComponent(threads.data.nextCursor)}`, threadPageDto, 'Não foi possível carregar mais conversas.', { signal: controller.signal });
      if (controller.signal.aborted) return;
      olderLoaded.current = true;
      setThreads(current => current.kind === 'ready' ? { kind: 'ready', error: null, data: { ...current.data, items: mergeThreads(current.data.items, next.items), nextCursor: next.nextCursor } } : current);
    } catch (failure) {
      if (!controller.signal.aborted) setThreads(current => failedRemote(current, requestMessage(failure, 'Não foi possível carregar mais conversas.')));
    } finally {
      requests.current.delete(controller);
      if (!controller.signal.aborted) setPaging(false);
    }
  }

  async function synchronize() {
    if (sync === 'requesting') return;
    const controller = new AbortController();
    requests.current.add(controller);
    setSync('requesting'); setSyncError('');
    try {
      const result = await whatsappRequest('sync', syncResult, 'Não foi possível retomar a atualização.', { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) { setSync(result.queued ? 'queued' : 'idle'); setRevision(value => value + 1); }
    } catch (failure) {
      if (!controller.signal.aborted) { setSync('idle'); setSyncError(requestMessage(failure, 'Não foi possível solicitar a sincronização.')); }
    } finally { requests.current.delete(controller); }
  }

  async function send(intent: SendIntent, windowClosesAt: string | null, checkExisting = false) {
    if (sends.current.has(intent.threadId)) return;
    if (!checkExisting && (status?.connection?.status !== 'connected' || !windowClosesAt || Date.parse(windowClosesAt) <= Date.now())) {
      setAttempts(current => ({ ...current, [intent.threadId]: { kind: 'failed', intent, error: 'Não é possível enviar agora. Confira a conexão e o prazo de resposta.' } }));
      return;
    }
    const controller = new AbortController();
    sends.current.set(intent.threadId, controller);
    setAttempts(current => ({ ...current, [intent.threadId]: { kind: 'sending', intent } }));
    try {
      const receipt = await whatsappRequest('send', sendReceiptDto, 'Não foi possível concluir o envio.', {
        method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(intent),
      });
      if (controller.signal.aborted) return;
      setAttempts(current => ({ ...current, [intent.threadId]: { kind: 'receipt', intent, receipt } }));
      if (['accepted', 'sent', 'delivered', 'read'].includes(receipt.status)) {
        setDrafts(current => current[intent.threadId]?.trim() === intent.text ? { ...current, [intent.threadId]: '' } : current);
        setAttachments(current => current[intent.threadId]?.id === intent.attachmentId ? { ...current, [intent.threadId]: undefined } : current);
      }
      setRevision(value => value + 1);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const uncertain = !(failure instanceof WhatsAppRequestError) || failure.uncertain;
      setAttempts(current => ({ ...current, [intent.threadId]: {
        kind: uncertain ? 'uncertain' : 'failed', intent,
        error: uncertain ? 'A conexão caiu antes da confirmação. Verifique este envio antes de tentar enviar outra mensagem.' : requestMessage(failure, 'Não foi possível concluir o envio.'),
      } }));
    } finally { sends.current.delete(intent.threadId); }
  }

  function back() {
    const id = selected?.id;
    setSelected(null);
    requestAnimationFrame(() => { if (id) document.querySelector<HTMLElement>(`[data-thread="${id}"] button`)?.focus(); });
  }

  const connected = status?.enabled && status.connection?.status === 'connected';
  const currentThread = selected && threads.kind === 'ready' ? threads.data.items.find(thread => thread.id === selected.id) ?? selected : selected;
  const syncPending = sync === 'requesting' || (threads.kind === 'ready' && threads.data.syncState === 'pending');

  const notice = !status || connected ? '' : !status.enabled ? 'O WhatsApp está desativado para este escritório.'
    : status.connection?.status === 'reconnect_required' ? 'Reconecte a conta em Integrações para voltar a receber e enviar mensagens. O histórico disponível continua aqui.'
    : status.connection?.status === 'pending' ? 'Conclua a conexão no WhatsApp Business. As conversas aparecerão após a sincronização.'
    : status.connection?.status === 'disconnecting' ? 'A conta está sendo desconectada.'
    : 'Conecte o WhatsApp Business em Integrações para receber as conversas do escritório.';
  const quiet = 'text-[13.5px] text-muted-foreground';

  return <>
    {currentThread ? <Conversation key={currentThread.id} thread={currentThread} connected={Boolean(connected)} draft={drafts[currentThread.id] ?? ''} attempt={attempts[currentThread.id]} revision={revision}
      attachment={attachments[currentThread.id]} onAttachment={file => setAttachments(current => ({ ...current, [currentThread.id]: file }))}
      onDraft={text => setDrafts(current => ({ ...current, [currentThread.id]: text }))} onBack={back}
      onSend={(intent, windowClosesAt, checkExisting) => void send(intent, windowClosesAt, checkExisting)} />
      : <CanvasPage className="md:gap-6">
        <CanvasHeader eyebrow="Conversas dos clientes com o escritório" title="WhatsApp" actions={notice && status?.enabled &&
          <Button asChild variant="outline" size="lg" className="h-11 md:h-[34px]"><Link href="/app/integrations">Abrir Integrações</Link></Button>} />
        {(connectionError || syncError) && <p role="alert" className="flex items-center gap-2 text-[13.5px] text-destructive"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{syncError || connectionError}</p>}
        {notice && <p role="status" className="text-[13.5px]">{notice}</p>}
        {sync === 'queued' && !syncPending && <p role="status" className={quiet}>Sincronização solicitada. As conversas serão atualizadas aqui.</p>}
        {threads.kind === 'ready' && threads.data.syncState === 'error' && <div className="flex flex-wrap items-center gap-3"><p role="status" className={quiet}>Não foi possível atualizar as conversas.</p><Button variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={!connected || syncPending} onClick={() => void synchronize()}>{syncPending ? 'Atualizando…' : 'Tentar novamente'}</Button></div>}
        {threads.kind === 'loading' && <p role="status" className={quiet}>Carregando conversas…</p>}
        {threads.kind !== 'loading' && threads.error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{threads.error}</p><Button variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></div>}
        {threads.kind === 'ready' && <>
          {threads.data.items.length === 0 && <p className={quiet}>{threads.data.syncState === 'pending' ? 'Buscando as primeiras conversas…' : 'As mensagens recebidas aparecerão aqui automaticamente.'}</p>}
          {!!threads.data.items.length && <div role="list" aria-label="Conversas do WhatsApp" className="flex flex-col gap-0.5">{threads.data.items.map(thread => <div role="listitem" key={thread.id} data-thread={thread.id}>
            <CanvasRow stacked icon={<MessageCircle />} onClick={() => setSelected(thread)} urgent={thread.unreadCount > 0}
              title={<>{thread.participantName || 'Contato'}{thread.unreadCount > 0 && <span className="sr-only">, {thread.unreadCount} {thread.unreadCount === 1 ? 'não lida' : 'não lidas'}</span>}</>}
              detail={thread.lastText || 'Mensagem sem texto'} meta={<time dateTime={thread.lastMessageAt}>{messageWhen(thread.lastMessageAt)}</time>} />
          </div>)}</div>}
          {threads.data.nextCursor && <div><Button variant="ghost" size="lg" className="h-11 text-muted-foreground md:h-[34px]" disabled={paging} onClick={() => void loadMoreThreads()}>{paging ? 'Carregando…' : 'Carregar mais conversas'}</Button></div>}
        </>}
      </CanvasPage>}
  </>;
}

function Conversation({ thread, connected, draft, attempt, revision, attachment, onAttachment, onDraft, onBack, onSend }: {
  thread: Thread; connected: boolean; draft: string; attempt: SendAttempt | undefined; revision: number;
  attachment: UploadedAttachment | undefined; onAttachment: (attachment: UploadedAttachment | undefined) => void;
  onDraft: (text: string) => void; onBack: () => void; onSend: (intent: SendIntent, windowClosesAt: string | null, checkExisting?: boolean) => void;
}) {
  const [history, setHistory] = useState<Remote<HistoryPage>>({ kind: 'loading' });
  const [paging, setPaging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const nearEnd = useRef(true);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const threadId = thread.id;

  useEffect(() => () => uploadController.current?.abort(), []);

  async function upload(file: File) {
    if (uploading) return;
    if (file.size > 25_000_000) { setUploadError('O arquivo deve ter até 25 MB. Imagens têm limite de 5 MB e áudio ou vídeo, 16 MB.'); return; }
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true); setUploadError('');
    try {
      const form = new FormData(); form.set('threadId', threadId); form.set('file', file);
      const uploaded = await whatsappRequest('attachments', uploadReceiptDto, 'Não foi possível anexar o arquivo. Confira o formato e o tamanho.', { method: 'POST', body: form, signal: controller.signal });
      if (!controller.signal.aborted) onAttachment(uploaded);
    } catch (error) {
      if (!controller.signal.aborted) setUploadError(requestMessage(error, 'Não foi possível anexar o arquivo.'));
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      uploadController.current = null;
    }
  }

  const load = useCallback(async (signal: AbortSignal) => {
    void revision; void refresh;
    setNow(Date.now());
    try {
      const next = await whatsappRequest(`threads/${encodeURIComponent(threadId)}/messages?limit=30`, historyPageDto, 'Não foi possível carregar as mensagens.', { signal });
      if (signal.aborted) return;
      setHistory(current => ({ kind: 'ready', error: null, data: current.kind === 'ready'
        ? { ...next, items: mergeMessages(current.data.items, next.items), nextCursor: current.data.nextCursor }
        : { ...next, items: mergeMessages([], next.items) } }));
    } catch (failure) {
      if (!signal.aborted) setHistory(current => failedRemote(current, requestMessage(failure, 'Não foi possível carregar as mensagens.')));
    }
  }, [threadId, revision, refresh]);
  useVisiblePoll(load);
  useEffect(() => { title.current?.focus({ preventScroll: true }); return () => pageController.current?.abort(); }, []);

  const messages = history.kind === 'ready' ? history.data.items : null;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !messages) return;
    if (scrollAnchor.current) {
      element.scrollTop = scrollAnchor.current.top + element.scrollHeight - scrollAnchor.current.height;
      scrollAnchor.current = null;
    } else if (nearEnd.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (pageController.current || history.kind !== 'ready' || !history.data.nextCursor) return;
    const controller = new AbortController();
    pageController.current = controller;
    setPaging(true);
    try {
      const next = await whatsappRequest(`threads/${encodeURIComponent(threadId)}/messages?limit=30&cursor=${encodeURIComponent(history.data.nextCursor)}`, historyPageDto, 'Não foi possível carregar as mensagens anteriores.', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (viewport.current) scrollAnchor.current = { height: viewport.current.scrollHeight, top: viewport.current.scrollTop };
      setHistory(current => current.kind === 'ready' ? { kind: 'ready', error: null, data: { ...current.data, items: mergeMessages(next.items, current.data.items), nextCursor: next.nextCursor } } : current);
    } catch (failure) {
      if (!controller.signal.aborted) setHistory(current => failedRemote(current, requestMessage(failure, 'Não foi possível carregar as mensagens anteriores.')));
    } finally {
      if (!controller.signal.aborted) setPaging(false);
      pageController.current = null;
    }
  }

  const loadedThread = history.kind === 'ready' ? history.data.thread : thread;
  const windowOpen = loadedThread.windowClosesAt !== null && Date.parse(loadedThread.windowClosesAt) > now;
  const allowed = connected && history.kind === 'ready' && history.data.canSend && windowOpen;
  const unresolved = sendingUnresolved(attempt);
  const disabledReason = !connected ? 'Reconecte a conta em Integrações para enviar mensagens.' : history.kind !== 'ready' ? 'Aguarde o carregamento da conversa.' : !windowOpen ? 'O prazo de 24 horas terminou. Aguarde uma nova mensagem do cliente para responder pelo Lume.' : !history.data.canSend ? 'O envio não está disponível para esta conversa.' : '';
  const checkable = attempt?.kind === 'uncertain' || (attempt?.kind === 'receipt' && ['pending', 'dispatching', 'unknown'].includes(attempt.receipt.status));
  const audioAttachment = attachment?.mimeType?.startsWith('audio/') ?? false;
  const textLimit = attachment ? audioAttachment ? 0 : 1024 : 4096;

  function submit() {
    const text = draft.trim();
    if (!allowed || unresolved || uploading || (!text && !attachment) || text.length > textLimit) return;
    onSend({ threadId, text, idempotencyKey: crypto.randomUUID(), ...(attachment && { attachmentId: attachment.id }) }, loadedThread.windowClosesAt);
  }

  const column = 'mx-auto w-full max-w-[720px] px-4 md:px-10';
  const name = thread.participantName || 'Contato';
  return <section aria-labelledby="whatsapp-conversation-title" className="whatsapp-workspace flex min-h-0 min-w-0 flex-1 flex-col" data-whatsapp-inbox
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onBack(); } }}>
    <CanvasTrail back={{ label: 'WhatsApp', onClick: onBack }} icon={<MessageCircle />} current={name} />
    <div ref={viewport} role="region" aria-label="Mensagens da conversa" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" onScroll={event => {
      const element = event.currentTarget;
      nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
      setAwayFromEnd(!nearEnd.current);
    }}>
      <div className={cn(column, 'flex flex-col gap-5 pt-6 pb-4 md:pt-10')}>
        <header className="flex flex-col gap-1">
          <h1 ref={title} tabIndex={-1} id="whatsapp-conversation-title" className="truncate text-[22px] font-semibold tracking-[-0.02em] outline-none md:text-2xl">{name}</h1>
          <p className="text-[13px] text-muted-foreground">{windowOpen && loadedThread.windowClosesAt ? `Respostas pelo Lume até ${dateLabel(loadedThread.windowClosesAt)}` : 'Prazo de resposta encerrado'}</p>
        </header>
        {history.kind === 'loading' && <p role="status" className="text-[13.5px] text-muted-foreground">Carregando mensagens…</p>}
        {history.kind !== 'loading' && history.error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{history.error}</p><Button variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></div>}
        {history.kind === 'ready' && <>
          {!history.data.thread.historyComplete && <p className="text-[13px] text-muted-foreground">Parte do histórico ainda não foi carregada.</p>}
          {history.data.nextCursor && <Button variant="ghost" size="lg" className="h-11 self-center text-muted-foreground md:h-[34px]" disabled={paging} onClick={() => void loadOlder()}>{paging ? 'Carregando…' : 'Carregar mensagens anteriores'}</Button>}
          {history.data.items.length === 0 && <p className="text-[13.5px] text-muted-foreground">Nenhuma mensagem disponível nesta conversa.</p>}
          {history.data.items.map(message => {
            const own = message.direction === 'outbound';
            const author = own ? message.source === 'whatsapp_business_app' ? 'Enviada pelo celular' : 'Escritório' : name;
            return <article key={message.id} aria-label={`${author}, ${dateLabel(message.createdAt)}`} className={cn('flex min-w-0 flex-col gap-1', own ? 'items-end' : 'items-start')}>
              <div className={cn('flex min-w-0 max-w-[86%] flex-col gap-2', own ? 'rounded-[14px] bg-muted px-3.5 py-2.5' : 'py-0.5')}>
                {message.deleted ? <p className="text-[14.5px] text-muted-foreground">Mensagem apagada.</p> : <>
                  {message.text && <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.55] [overflow-wrap:anywhere]">{message.text}</p>}
                  {message.attachments.map((file, index) => file.state === 'ready' && file.contentUrl
                    ? <MessageAttachment key={file.id ?? index} filename={file.filename || 'Anexo'} mimeType={file.mimeType} url={file.contentUrl} downloadUrl={`${file.contentUrl}?download=1`} />
                    : <div key={file.id ?? index} className="flex flex-col gap-0.5 text-[13.5px]"><p className="break-words font-medium">{file.filename || 'Anexo'}</p><p className="text-muted-foreground">{file.state === 'pending' ? 'Carregando anexo…' : 'Este anexo não está mais disponível.'}</p></div>)}
                  {!message.text && message.attachments.length === 0 && <p className="text-[14.5px] text-muted-foreground">Mensagem sem conteúdo disponível.</p>}
                </>}
              </div>
              <p className="px-1 text-xs text-muted-foreground">{own ? author : name} · <time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time>{own && ` · ${messageLabels[message.status]}`}{message.edited ? ' · Editada' : ''}</p>
            </article>;
          })}
        </>}
      </div>
    </div>
    <form className={cn(column, 'relative shrink-0 pt-2 pb-4 md:pb-6')} onSubmit={event => { event.preventDefault(); submit(); }}>
      {awayFromEnd && <Button type="button" variant="outline" size="sm" className="absolute -top-9 left-1/2 h-11 -translate-x-1/2 rounded-full bg-card shadow-[var(--shadow-float)] md:h-7" onClick={() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; nearEnd.current = true; setAwayFromEnd(false); }}><ArrowDown aria-hidden="true" />Mensagens recentes</Button>}
      {disabledReason && <p id="whatsapp-compose-reason" className="mb-2 text-[13px] text-muted-foreground">{disabledReason}</p>}
      <div className="flex flex-col gap-1.5 rounded-[14px] border border-border-strong bg-card pt-2.5 pr-2.5 pb-2 pl-3.5 transition-shadow focus-within:ring-3 focus-within:ring-ring/30">
        {attachment && <div className="flex min-w-0 items-start justify-between gap-3"><MessageAttachment filename={attachment.filename || 'Anexo'} mimeType={attachment.mimeType} url={attachment.contentUrl} downloadUrl={`${attachment.contentUrl}?download=1`} /><Button type="button" variant="ghost" size="icon" className="size-11 md:size-8" disabled={unresolved || uploading} aria-label="Remover anexo" onClick={() => onAttachment(undefined)}><X aria-hidden="true" /></Button></div>}
        <label htmlFor="whatsapp-reply" className="sr-only">Mensagem para {thread.participantName || 'o contato'}</label>
        <textarea id="whatsapp-reply" rows={2} maxLength={textLimit || 4096} value={draft} onChange={event => onDraft(event.target.value)} disabled={!allowed || unresolved || audioAttachment}
          aria-describedby={disabledReason ? 'whatsapp-compose-help whatsapp-compose-reason' : 'whatsapp-compose-help'} placeholder={audioAttachment ? 'Áudio sem legenda' : 'Escreva uma mensagem'}
          className="max-h-40 min-h-12 w-full resize-none bg-transparent py-0.5 text-[14.5px] leading-[1.5] outline-none placeholder:text-subtle-foreground disabled:opacity-60" />
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-label="Arquivo para enviar" accept="image/jpeg,image/png,video/mp4,audio/mpeg,audio/ogg,audio/amr,audio/aac,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/plain" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" className="-ml-1.5 h-11 gap-1.5 px-2 text-[13px] text-muted-foreground md:h-[30px]" disabled={!allowed || unresolved || uploading} onClick={() => fileInput.current?.click()}><Paperclip aria-hidden="true" />{uploading ? 'Anexando…' : 'Anexar'}</Button>
          <p id="whatsapp-compose-help" className="min-w-0 flex-1 truncate text-right text-xs text-subtle-foreground">{audioAttachment ? 'Envie o áudio sem texto.' : `${draft.length.toLocaleString('pt-BR')} de ${textLimit.toLocaleString('pt-BR')}`}</p>
          <Button type="submit" size="icon" className="size-11 rounded-full md:size-8" aria-label={attempt?.kind === 'sending' ? 'Enviando…' : 'Enviar'}
            disabled={!allowed || unresolved || uploading || (!draft.trim() && !attachment) || draft.trim().length > textLimit}>
            {attempt?.kind === 'sending' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {audioAttachment && draft.trim() && <p role="status" className="mt-2 text-[13px] text-muted-foreground">Remova o áudio para enviar o texto já escrito, ou limpe o texto para enviar só o áudio. <button type="button" className="min-h-11 underline underline-offset-2 md:min-h-0" onClick={() => onDraft('')}>Limpar texto</button></p>}
      {uploadError && <p role="alert" className="mt-2 text-[13.5px] text-destructive">{uploadError}</p>}
      {attempt && <div className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite">
        <p className={cn('text-[13.5px]', attempt.kind === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          {attempt.kind === 'sending' ? 'Aguardando a confirmação do envio…' : attempt.kind === 'failed' || attempt.kind === 'uncertain' ? attempt.error : attempt.receipt.status === 'unknown' ? 'O envio ainda não foi confirmado. Confira no WhatsApp Business antes de enviar novamente.' : attempt.receipt.status === 'failed' ? 'A mensagem não foi enviada. Você pode revisar o texto e tentar novamente.' : messageLabels[attempt.receipt.status]}
        </p>
        {checkable && <Button type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => onSend(attempt.intent, loadedThread.windowClosesAt, true)}>Verificar este envio</Button>}
      </div>}
    </form>
  </section>;
}
