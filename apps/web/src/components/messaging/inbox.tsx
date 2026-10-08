'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from '@/components/lume/canvas-navigation';
import { Mail, MessageSquare, Plus } from 'lucide-react';
import { z } from 'zod';
import { sendMessageOutput, startThreadOutput, threadPageDto, type PersonalThread as Thread } from '@/lib/personal-chat/domain';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Conversation, type SendAttempt } from './conversation';
import { jsonPost, messageError, messageRequest, MessageRequestError, messageWhen, useMessagePoll } from './client';
import { NewConversation } from './new-conversation';
import { SharePicker } from './share-picker';

type ThreadPage = z.infer<typeof threadPageDto>;
const threadHref = (id: string) => `/app/messages?thread=${encodeURIComponent(id)}`;
function mergeThreads(current: Thread[], incoming: Thread[]) {
  return [...new Map([...current, ...incoming].map(thread => [thread.id, thread])).values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id));
}

export function MessagesInbox() {
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
    if (!selectedId && previous) document.querySelector<HTMLElement>(`a[href="${threadHref(previous)}"]`)?.focus();
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
    router.push(threadHref(thread.id), { scroll: false });
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

  const status = 'text-[13.5px] text-muted-foreground';
  return <>
    <CanvasMeta title="Mensagens" subject={{ kind: 'module', slug: 'messages', title: 'Mensagens' }} />
    {selected ? <Conversation key={selected.id} thread={selected} draft={drafts[selected.id] ?? ''} attempt={attempts[selected.id]} revision={revision} onDraft={text => updateDraft(selected.id, text)} onSend={text => void send(selected, text)} onBack={back} onShare={() => setShare(current => current ? { ...current, open: true } : { thread: selected, open: true })} onRead={read} onChanged={refresh} />
      : selectedId ? <CanvasPage>
        <p role={detailError ? 'alert' : 'status'} className={detailError ? 'text-[13.5px] text-destructive' : status}>{detailError || 'Abrindo conversa…'}</p>
        <div className="flex flex-wrap gap-2">
          {detailError && <Button variant="outline" size="lg" onClick={refresh} className="h-11 md:h-[34px]">Tentar novamente</Button>}
          <Button variant="ghost" size="lg" onClick={back} className="h-11 md:h-[34px]">Voltar para as conversas</Button>
        </div>
      </CanvasPage>
      : <CanvasPage className="md:gap-6">
        <CanvasHeader eyebrow="Equipe, associados e clientes" title="Mensagens" actions={
          <Button id="new-message-conversation" type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => setNewOpen(true)}><Plus className="size-3.5" aria-hidden="true" />Nova mensagem</Button>} />
        {!threads && !error && <p role="status" className={status}>Carregando conversas…</p>}
        {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{error}</p><Button type="button" variant="outline" size="lg" onClick={refresh} className="h-11 md:h-[34px]">Tentar novamente</Button></div>}
        {threads?.threads.length === 0 && <p className={status}>Nenhuma conversa ainda. Escreva a um associado ou a alguém pelo e-mail.</p>}
        {!!threads?.threads.length && <div role="list" aria-label="Conversas" className="flex flex-col gap-0.5">
          {threads.threads.map(thread => <div role="listitem" key={thread.id}>
            <ThreadRow thread={thread} />
          </div>)}
        </div>}
        {threads?.nextCursor && <div><Button type="button" variant="ghost" size="lg" className="h-11 md:h-[34px]" disabled={paging} onClick={() => void moreThreads()}>{paging ? 'Carregando…' : 'Mais conversas'}</Button></div>}
      </CanvasPage>}
    <NewConversation open={newOpen} onOpenChange={setNewOpen} onCreated={openThread} />
    {share && <SharePicker thread={share.thread} open={share.open} onClose={keepAttempt => setShare(current => keepAttempt && current ? { ...current, open: false } : null)} onShared={() => { setShare(null); refresh(); }} />}
  </>;
}

/** A conversation in the list (`Main.dc.html`, mensagens): the person, the last message under it, the time at the end. */
function ThreadRow({ thread }: { thread: Thread }) {
  const inApp = thread.channel === 'in_app';
  const unread = thread.unreadCount > 0;
  return <CanvasRow stacked href={threadHref(thread.id)} icon={inApp ? <MessageSquare /> : <Mail />} urgent={unread}
    title={<>{inApp ? thread.peer.name : `${thread.peer.email} · E-mail`}{unread && <span className="sr-only">, {thread.unreadCount} {thread.unreadCount === 1 ? 'não lida' : 'não lidas'}</span>}</>}
    detail={thread.lastMessage?.preview || 'Conversa iniciada'}
    meta={<time dateTime={thread.updatedAt}>{messageWhen(thread.updatedAt)}</time>} />;
}
