'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowUp, CircleAlert, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  connectionStatusDto, historyPageDto, sendReceiptDto, threadPageDto,
  type ConnectionStatus, type HistoryPage, type InboxMessage, type SendReceipt, type Thread, type ThreadPage,
} from '@/lib/whatsapp/domain';
import { requestMessage, useVisiblePoll, whatsappRequest, WhatsAppRequestError } from './client';

type Remote<T> = { kind: 'loading' } | { kind: 'error'; error: string } | { kind: 'ready'; data: T; error: string | null };
type SendIntent = { threadId: string; text: string; idempotencyKey: string };
type SendAttempt =
  | { kind: 'sending'; intent: SendIntent }
  | { kind: 'uncertain'; intent: SendIntent; error: string }
  | { kind: 'failed'; intent: SendIntent; error: string }
  | { kind: 'receipt'; intent: SendIntent; receipt: SendReceipt };

const syncResult = z.object({ queued: z.literal(true) });
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

export function WhatsAppInbox({ canSendRole }: { canSendRole: boolean }) {
  const [threads, setThreads] = useState<Remote<ThreadPage>>({ kind: 'loading' });
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
      await whatsappRequest('sync', syncResult, 'Não foi possível solicitar a sincronização.', { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) { setSync('queued'); setRevision(value => value + 1); }
    } catch (failure) {
      if (!controller.signal.aborted) { setSync('idle'); setSyncError(requestMessage(failure, 'Não foi possível solicitar a sincronização.')); }
    } finally { requests.current.delete(controller); }
  }

  async function send(intent: SendIntent, windowClosesAt: string | null, checkExisting = false) {
    if (sends.current.has(intent.threadId)) return;
    if (!checkExisting && (!canSendRole || status?.connection?.status !== 'connected' || !windowClosesAt || Date.parse(windowClosesAt) <= Date.now())) {
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
    requestAnimationFrame(() => { if (id) document.getElementById(`whatsapp-thread-${id}`)?.focus(); });
  }

  const connected = status?.enabled && status.connection?.status === 'connected';
  const currentThread = selected && threads.kind === 'ready' ? threads.data.items.find(thread => thread.id === selected.id) ?? selected : selected;
  const syncPending = sync === 'requesting' || (threads.kind === 'ready' && threads.data.syncState === 'pending');

  return <div className="whatsapp-workspace flex min-h-0 min-w-0 flex-1 flex-col" data-whatsapp-inbox>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 md:px-10 md:py-6">
      <h1 className="page-title max-md:sr-only">WhatsApp</h1>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="min-h-11 md:min-h-9" disabled={!connected || syncPending} onClick={() => void synchronize()}><RefreshCw aria-hidden="true" />{syncPending ? 'Sincronizando…' : 'Sincronizar conversas'}</Button>
        <Link href="/app/integrations" className="text-sm underline underline-offset-4 decoration-input/40 hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Gerenciar conexão</Link>
      </div>
    </header>
    {(connectionError || syncError) && <p role="alert" className="flex items-center gap-2 border-b px-5 py-3 text-sm text-destructive md:px-10"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{syncError || connectionError}</p>}
    {status && !connected && <p role="status" className="border-b border-line px-5 py-3 text-sm md:px-10">{!status.enabled ? 'O WhatsApp está desativado para este escritório.' : status.connection?.status === 'reconnect_required' ? 'Reconecte a conta em Integrações para voltar a receber e enviar mensagens. O histórico disponível continua aqui.' : status.connection?.status === 'pending' ? 'Conclua a conexão no WhatsApp Business. As conversas aparecerão após a sincronização.' : status.connection?.status === 'disconnecting' ? 'A conta está sendo desconectada.' : 'Conecte o WhatsApp Business em Integrações para receber as conversas do escritório.'}</p>}
    {sync === 'queued' && !syncPending && <p role="status" className="border-b px-5 py-2 text-sm text-muted-foreground md:px-10">Sincronização solicitada. As conversas serão atualizadas aqui.</p>}
    {threads.kind === 'ready' && threads.data.syncState === 'error' && <p className="border-b px-5 py-2 text-sm text-muted-foreground md:px-10">A última sincronização não terminou. Você pode solicitá-la novamente.</p>}
    <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden md:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
      <section aria-label="Conversas do WhatsApp" className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden border-line md:border-r', selected && 'hidden md:flex')}>
        <div className="flex items-center justify-between border-b px-5 py-3"><h2 className="label-mono text-muted-foreground">Conversas</h2>{threads.kind === 'ready' && <span className="text-xs text-muted-foreground">{threads.data.items.length} carregadas</span>}</div>
        {threads.kind === 'loading' && <p role="status" className="px-5 py-6 text-sm text-muted-foreground">Carregando conversas…</p>}
        {threads.kind !== 'loading' && threads.error && <div className="space-y-3 border-b px-5 py-4"><p role="alert" className="text-sm text-destructive">{threads.error}</p><Button variant="outline" className="min-h-11 md:min-h-9" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></div>}
        {threads.kind === 'ready' && <>
          {threads.data.items.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">{threads.data.syncState === 'pending' ? 'Buscando as primeiras conversas…' : 'Nenhuma conversa disponível. Sincronize a conta para buscar mensagens.'}</p>}
          <div className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">{threads.data.items.map(thread => <button key={thread.id} id={`whatsapp-thread-${thread.id}`} type="button" aria-current={selected?.id === thread.id ? 'true' : undefined} aria-label={`${thread.participantName || 'Contato'}, ${thread.unreadCount} mensagens não lidas`} onClick={() => setSelected(thread)} className={cn('group hover-rise relative block w-full border-l-2 px-5 py-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand hover:text-brand-foreground', selected?.id === thread.id ? 'border-foreground bg-brand-soft' : 'border-transparent')}>
            <span className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{thread.participantName || 'Contato'}</span><time dateTime={thread.lastMessageAt} className="shrink-0 text-[11px] text-muted-foreground group-hover:text-brand-foreground">{dateLabel(thread.lastMessageAt)}</time></span>
            <span className="mt-1 block truncate text-sm text-muted-foreground group-hover:text-brand-foreground">{thread.lastText || 'Mensagem sem texto'}</span>
            {thread.unreadCount > 0 && <span className="mt-2 block text-xs">{thread.unreadCount} {thread.unreadCount === 1 ? 'não lida' : 'não lidas'}</span>}
          </button>)}</div>
          {threads.data.nextCursor && <div className="p-4"><Button variant="outline" className="min-h-11 w-full md:min-h-9" disabled={paging} onClick={() => void loadMoreThreads()}>{paging ? 'Carregando…' : 'Carregar mais conversas'}</Button></div>}
        </>}
      </section>
      {currentThread ? <Conversation key={currentThread.id} thread={currentThread} canSendRole={canSendRole} connected={Boolean(connected)} draft={drafts[currentThread.id] ?? ''} attempt={attempts[currentThread.id]} revision={revision}
        onDraft={text => setDrafts(current => ({ ...current, [currentThread.id]: text }))} onBack={back}
        onSend={(intent, windowClosesAt, checkExisting) => void send(intent, windowClosesAt, checkExisting)}
        onSync={() => void synchronize()} syncPending={syncPending} /> : <div className="hidden items-center justify-center p-10 text-sm text-muted-foreground md:flex">Escolha uma conversa para ler as mensagens.</div>}
    </div>
  </div>;
}

function Conversation({ thread, canSendRole, connected, draft, attempt, revision, onDraft, onBack, onSend, onSync, syncPending }: {
  thread: Thread; canSendRole: boolean; connected: boolean; draft: string; attempt: SendAttempt | undefined; revision: number;
  onDraft: (text: string) => void; onBack: () => void; onSend: (intent: SendIntent, windowClosesAt: string | null, checkExisting?: boolean) => void;
  onSync: () => void; syncPending: boolean;
}) {
  const [history, setHistory] = useState<Remote<HistoryPage>>({ kind: 'loading' });
  const [paging, setPaging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const nearEnd = useRef(true);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const threadId = thread.id;

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
  const allowed = canSendRole && connected && history.kind === 'ready' && history.data.canSend && windowOpen;
  const unresolved = sendingUnresolved(attempt);
  const disabledReason = !canSendRole ? 'Seu acesso permite apenas ler as conversas.' : !connected ? 'Reconecte a conta em Integrações para enviar mensagens.' : history.kind !== 'ready' ? 'Aguarde o carregamento da conversa.' : !windowOpen ? 'O prazo de 24 horas terminou. Aguarde uma nova mensagem do cliente para responder pelo Tises.' : !history.data.canSend ? 'O envio não está disponível para esta conversa.' : '';
  const checkable = attempt?.kind === 'uncertain' || (attempt?.kind === 'receipt' && ['pending', 'dispatching', 'unknown'].includes(attempt.receipt.status));

  function submit() {
    const text = draft.trim();
    if (!allowed || unresolved || !text || text.length > 4096) return;
    onSend({ threadId, text, idempotencyKey: crypto.randomUUID() }, loadedThread.windowClosesAt);
  }

  return <section aria-labelledby="whatsapp-conversation-title" className="flex min-h-0 min-w-0 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4 md:px-8">
      <Button variant="ghost" className="min-h-11 min-w-11 md:hidden" aria-label="Voltar para as conversas" onClick={onBack}><ArrowLeft aria-hidden="true" /></Button>
      <div className="min-w-0"><h2 ref={title} tabIndex={-1} id="whatsapp-conversation-title" className="truncate font-medium outline-none">{thread.participantName || 'Contato'}</h2><p className="mt-1 text-xs text-muted-foreground">{windowOpen && loadedThread.windowClosesAt ? `Respostas pelo Tises até ${dateLabel(loadedThread.windowClosesAt)}` : 'Prazo de resposta encerrado'}</p></div>
    </header>
    <div ref={viewport} role="region" aria-label="Mensagens da conversa" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand" onScroll={event => {
      const element = event.currentTarget;
      nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
      setAwayFromEnd(!nearEnd.current);
    }}>
      {history.kind === 'loading' && <p role="status" className="px-5 py-6 text-sm text-muted-foreground md:px-8">Carregando mensagens…</p>}
      {history.kind !== 'loading' && history.error && <div className="space-y-3 border-b px-5 py-4 md:px-8"><p role="alert" className="text-sm text-destructive">{history.error}</p><Button variant="outline" className="min-h-11 md:min-h-9" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></div>}
      {history.kind === 'ready' && <>
        {!history.data.thread.historyComplete && <div className="space-y-2 border-b px-5 py-4 md:px-8"><p className="text-sm text-muted-foreground">O histórico está parcial. Algumas mensagens ainda não foram sincronizadas.</p><Button variant="outline" className="min-h-11 md:min-h-9" disabled={!connected || syncPending} onClick={onSync}>{syncPending ? 'Sincronizando…' : 'Buscar histórico'}</Button></div>}
        {history.data.nextCursor && <div className="border-b px-5 py-3 md:px-8"><Button variant="ghost" className="min-h-11 w-full md:min-h-9" disabled={paging} onClick={() => void loadOlder()}>{paging ? 'Carregando…' : 'Carregar mensagens anteriores'}</Button></div>}
        {history.data.items.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground md:px-8">Nenhuma mensagem disponível nesta conversa.</p>}
        <div className="divide-y">{history.data.items.map(message => <article key={message.id} className={cn('px-5 py-5 md:px-8', message.direction === 'outbound' && 'border-l-2 border-l-brand')}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{message.direction === 'inbound' ? thread.participantName || 'Contato' : message.source === 'whatsapp_business_app' ? 'Enviada pelo celular' : 'Escritório'}</span><time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time></div>
          {message.deleted ? <p className="text-sm text-muted-foreground">Mensagem apagada.</p> : <>
            {message.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>}
            {message.attachments.map((attachment, index) => <div key={`${attachment.kind}-${index}`} className="mt-3 space-y-1 text-sm"><p className="break-words font-medium">{attachment.filename || 'Anexo'}</p><p className="text-muted-foreground">Abra este anexo no WhatsApp Business.</p></div>)}
            {!message.text && message.attachments.length === 0 && <p className="text-sm text-muted-foreground">Mensagem sem conteúdo disponível.</p>}
          </>}
          <p className="mt-2 text-xs text-muted-foreground">{messageLabels[message.status]}{message.edited ? ' · Editada' : ''}</p>
        </article>)}</div>
      </>}
    </div>
    {awayFromEnd && <Button variant="ghost" className="min-h-11 shrink-0 border-t md:min-h-9" onClick={() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; nearEnd.current = true; setAwayFromEnd(false); }}><ArrowUp className="rotate-180" aria-hidden="true" />Ir para as mensagens recentes</Button>}
    <form className="shrink-0 border-t border-line bg-background px-5 py-4 md:px-8" onSubmit={event => { event.preventDefault(); submit(); }}>
      {disabledReason && <p id="whatsapp-compose-reason" className="mb-3 text-sm text-muted-foreground">{disabledReason}</p>}
      {canSendRole && <>
        <label htmlFor="whatsapp-reply" className="sr-only">Mensagem para {thread.participantName || 'o contato'}</label>
        <Textarea id="whatsapp-reply" rows={3} maxLength={4096} value={draft} onChange={event => onDraft(event.target.value)} disabled={!allowed || unresolved} aria-describedby={disabledReason ? 'whatsapp-compose-help whatsapp-compose-reason' : 'whatsapp-compose-help'} placeholder="Escreva uma mensagem" className="max-h-40 min-h-24 resize-y disabled:bg-transparent" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p id="whatsapp-compose-help" className="text-xs text-muted-foreground">Somente texto. {draft.length.toLocaleString('pt-BR')} de 4.096 caracteres.</p><Button type="submit" className="min-h-11 md:min-h-9" disabled={!allowed || unresolved || draft.trim().length === 0 || draft.length > 4096}><Send aria-hidden="true" />{attempt?.kind === 'sending' ? 'Enviando…' : 'Enviar'}</Button></div>
      </>}
      {attempt && <div className="mt-3 space-y-2 border-l-2 border-brand pl-3" aria-live="polite">
        <p className={cn('text-sm', attempt.kind === 'failed' && 'text-destructive')}>
          {attempt.kind === 'sending' ? 'Aguardando a confirmação do envio…' : attempt.kind === 'failed' || attempt.kind === 'uncertain' ? attempt.error : attempt.receipt.status === 'unknown' ? 'O envio ainda não foi confirmado. Confira no WhatsApp Business antes de enviar novamente.' : attempt.receipt.status === 'failed' ? 'A mensagem não foi enviada. Você pode revisar o texto e tentar novamente.' : messageLabels[attempt.receipt.status]}
        </p>
        {checkable && <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => onSend(attempt.intent, loadedThread.windowClosesAt, true)}>Verificar este envio</Button>}
      </div>}
    </form>
  </section>;
}
