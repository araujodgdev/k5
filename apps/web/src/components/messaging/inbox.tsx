'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { sendMessageOutput, startThreadOutput, threadPageDto, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Conversation, type SendAttempt } from './conversation';
import { jsonPost, messageDate, messageError, messageRequest, MessageRequestError, useMessagePoll } from './client';
import { NewConversation } from './new-conversation';
import { SharePicker } from './share-picker';

type ThreadPage = z.infer<typeof threadPageDto>;
function mergeThreads(current: Thread[], incoming: Thread[]) {
  return [...new Map([...current, ...incoming].map(thread => [thread.id, thread])).values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id));
}

export function MessagesInbox({ canShareDocuments }: { canShareDocuments: boolean }) {
  const router = useRouter();
  const selectedId = useSearchParams().get('thread');
  const [threads, setThreads] = useState<ThreadPage | null>(null);
  const [detail, setDetail] = useState<Thread | null>(null);
  const [error, setError] = useState('');
  const [failedDetail, setFailedDetail] = useState<{ threadId: string; message: string } | null>(null);
  const [paging, setPaging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [share, setShare] = useState<{ thread: Thread; open: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, SendAttempt | undefined>>({});
  const inFlight = useRef(new Map<string, SendAttempt>());
  const paged = useRef(false);
  const previousSelected = useRef<string | null>(null);
  const detailError = failedDetail?.threadId === selectedId ? failedDetail.message : '';
  const selected = detailError ? null : detail?.id === selectedId ? detail : threads?.threads.find(thread => thread.id === selectedId);

  useEffect(() => {
    const previous = previousSelected.current;
    previousSelected.current = selectedId;
    if (!selectedId && previous) document.getElementById(`message-thread-${previous}`)?.focus();
  }, [selectedId]);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const page = await messageRequest('threads?limit=30', threadPageDto, { signal });
      if (!signal.aborted) { setThreads(current => ({ threads: mergeThreads(current?.threads ?? [], page.threads), nextCursor: paged.current && current ? current.nextCursor : page.nextCursor })); setError(''); }
    } catch (failure) { if (!signal.aborted) setError(messageError(failure)); }
  }, []);
  useMessagePoll(load, revision);

  const loadSelected = useCallback(async (signal: AbortSignal) => {
    if (!selectedId) return;
    try {
      const { thread } = await messageRequest(`threads/${encodeURIComponent(selectedId)}`, startThreadOutput, { signal });
      if (!signal.aborted) { setDetail(thread); setFailedDetail(null); }
    } catch (failure) { if (!signal.aborted) { setDetail(null); setFailedDetail({ threadId: selectedId, message: messageError(failure) }); } }
  }, [selectedId]);
  useMessagePoll(loadSelected, revision);

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const read = useCallback(() => {
    if (!selectedId) return;
    setThreads(current => current ? { ...current, threads: current.threads.map(thread => thread.id === selectedId ? { ...thread, unreadCount: 0 } : thread) } : current);
    setDetail(current => current?.id === selectedId ? { ...current, unreadCount: 0 } : current);
  }, [selectedId]);

  async function moreThreads() {
    if (!threads?.nextCursor || paging) return;
    setPaging(true);
    try {
      const page = await messageRequest(`threads?${new URLSearchParams({ cursor: threads.nextCursor, limit: '30' })}`, threadPageDto);
      paged.current = true; setThreads(current => ({ threads: mergeThreads(current?.threads ?? [], page.threads), nextCursor: page.nextCursor }));
    } catch (failure) { setError(messageError(failure)); }
    finally { setPaging(false); }
  }

  function openThread(thread: Thread) {
    setDetail(thread); setFailedDetail(null);
    setThreads(current => ({ threads: mergeThreads(current?.threads ?? [], [thread]), nextCursor: current?.nextCursor ?? null }));
    router.push(`/app/messages?thread=${encodeURIComponent(thread.id)}`, { scroll: false });
  }

  function back() {
    router.push('/app/messages', { scroll: false });
  }

  function updateDraft(threadId: string, text: string) {
    setDrafts(current => ({ ...current, [threadId]: text }));
    if (inFlight.current.get(threadId)?.phase === 'failed') {
      inFlight.current.delete(threadId); setAttempts(current => ({ ...current, [threadId]: undefined }));
    }
  }

  async function send(thread: Thread, text: string) {
    const previous = inFlight.current.get(thread.id);
    if (previous?.phase === 'sending') return;
    const attempt: SendAttempt = { clientMessageId: previous?.clientMessageId ?? crypto.randomUUID(), text: previous?.text ?? text, phase: 'sending', error: '' };
    inFlight.current.set(thread.id, attempt); setAttempts(current => ({ ...current, [thread.id]: attempt }));
    try {
      const result = await messageRequest(`threads/${encodeURIComponent(thread.id)}/messages`, sendMessageOutput, jsonPost({ clientMessageId: attempt.clientMessageId, body: { kind: 'text', text: attempt.text } }));
      inFlight.current.delete(thread.id); setAttempts(current => ({ ...current, [thread.id]: undefined }));
      setDrafts(current => ({ ...current, [thread.id]: '' }));
      setThreads(current => ({ threads: mergeThreads(current?.threads ?? [], [result.thread]), nextCursor: current?.nextCursor ?? null }));
      setDetail(current => current?.id === result.thread.id ? result.thread : current); refresh();
    } catch (failure) {
      const failed: SendAttempt = { ...attempt, phase: failure instanceof MessageRequestError && failure.uncertain ? 'unknown' : 'failed', error: messageError(failure) };
      inFlight.current.set(thread.id, failed); setAttempts(current => ({ ...current, [thread.id]: failed }));
    }
  }

  return <div className="messaging-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <header className={cn('flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 max-md:justify-end md:h-(--shell-header) md:px-10 md:py-0', selectedId && 'max-md:hidden')}><h1 className="page-title max-md:sr-only">Mensagens</h1><Button id="new-message-conversation" type="button" className="min-h-11 md:min-h-9" onClick={() => setNewOpen(true)}><Plus aria-hidden="true" />Nova conversa</Button></header>
    <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden md:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
      <section aria-label="Conversas pessoais" className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden border-line md:border-r', selectedId && 'hidden md:flex')}>
        <div className="shrink-0 border-b px-5 py-3"><h2 className="label-mono text-muted-foreground">Conversas</h2></div>
        {!threads && !error && <p role="status" className="px-5 py-6 text-sm text-muted-foreground">Carregando conversas…</p>}
        {error && <div className="space-y-2 border-b px-5 py-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={refresh} className="min-h-11 md:min-h-9">Tentar novamente</Button></div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {threads?.threads.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">Inicie uma conversa com alguém da equipe, um associado ou pelo e-mail.</p>}
          {threads?.threads.map(thread => <button type="button" key={thread.id} id={`message-thread-${thread.id}`} aria-current={selectedId === thread.id ? 'true' : undefined} onClick={() => openThread(thread)} className={cn('group hover-rise block w-full border-b border-l-2 px-5 py-4 text-left outline-none hover:text-brand-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand', selectedId === thread.id ? 'border-l-foreground bg-brand-soft' : 'border-l-transparent')}>
            <span className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{thread.channel === 'in_app' ? thread.peer.name : thread.peer.email}</span><time dateTime={thread.updatedAt} className="shrink-0 text-[11px] text-muted-foreground group-hover:text-brand-foreground">{messageDate(thread.updatedAt)}</time></span>
            <span className="mt-1 block truncate text-sm text-muted-foreground group-hover:text-brand-foreground">{thread.lastMessage?.preview || 'Conversa iniciada'}</span>
            {thread.channel === 'email_outbound' && <span className="mt-2 block text-xs">E-mail de saída</span>}
            {thread.unreadCount > 0 && <span className="mt-2 block text-xs">{thread.unreadCount} {thread.unreadCount === 1 ? 'não lida' : 'não lidas'}</span>}
          </button>)}
          {threads?.nextCursor && <div className="p-4"><Button type="button" variant="outline" className="min-h-11 w-full md:min-h-9" disabled={paging} onClick={() => void moreThreads()}>{paging ? 'Carregando…' : 'Mais conversas'}</Button></div>}
        </div>
      </section>
      {selected ? <Conversation key={selected.id} thread={selected} draft={drafts[selected.id] ?? ''} attempt={attempts[selected.id]} revision={revision} onDraft={text => updateDraft(selected.id, text)} onSend={text => void send(selected, text)} onBack={back} onShare={() => setShare(current => current ? { ...current, open: true } : { thread: selected, open: true })} onRead={read} onChanged={refresh} />
        : selectedId ? <div className="space-y-4 px-5 py-6 md:px-8"><p role={detailError ? 'alert' : 'status'} className={cn('text-sm', detailError ? 'text-destructive' : 'text-muted-foreground')}>{detailError || 'Abrindo conversa…'}</p>{detailError && <Button variant="outline" onClick={refresh} className="min-h-11 md:min-h-9">Tentar novamente</Button>}<Button variant="ghost" onClick={back} className="min-h-11 md:min-h-9">Voltar para as conversas</Button></div>
          : <div className="hidden items-center justify-center p-10 text-sm text-muted-foreground md:flex">Escolha uma conversa para ler as mensagens.</div>}
    </div>
    <NewConversation open={newOpen} onOpenChange={setNewOpen} onCreated={openThread} />
    {share && <SharePicker thread={share.thread} open={share.open} canShareDocuments={canShareDocuments} onClose={keepAttempt => setShare(current => keepAttempt && current ? { ...current, open: false } : null)} onShared={() => { setShare(null); refresh(); }} />}
  </div>;
}
