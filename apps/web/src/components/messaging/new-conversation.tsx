'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { contactPageDto, startThreadOutput, type PersonalThread as Thread, type StartThreadInput } from '@/lib/personal-chat/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { jsonPost, messageError, messageRequest, MessageRequestError } from './client';

type ContactPage = z.infer<typeof contactPageDto>;
type Recipient = StartThreadInput['recipient'];
type Attempt = StartThreadInput;
const sourceLabels = { team: 'Equipe', associate: 'Associado', case_participant: 'Participante de caso' };

export function NewConversation({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (thread: Thread) => void }) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [revision, setRevision] = useState(0);
  const running = useRef(false);
  const pageController = useRef<AbortController | null>(null);
  const openedThread = useRef(false);
  const address = z.email().safeParse(query.trim());

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    pageController.current?.abort();
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      void messageRequest(`contacts?${new URLSearchParams({ query: query.trim().slice(0, 160), limit: '30' })}`, contactPageDto, { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setContacts(value); })
        .catch(failure => { if (!controller.signal.aborted) { setContacts(null); setError(messageError(failure)); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); pageController.current?.abort(); window.clearTimeout(timer); };
  }, [open, query, revision]);

  async function more() {
    if (!contacts?.nextCursor || paging) return;
    const controller = new AbortController(); pageController.current = controller; setPaging(true);
    try {
      const value = await messageRequest(`contacts?${new URLSearchParams({ query: query.trim().slice(0, 160), cursor: contacts.nextCursor, limit: '30' })}`, contactPageDto, { signal: controller.signal });
      if (!controller.signal.aborted) setContacts(current => current ? { ...value, contacts: [...new Map([...current.contacts, ...value.contacts].map(contact => [contact.userId, contact])).values()] } : value);
    } catch (failure) { if (!controller.signal.aborted) setError(messageError(failure)); }
    finally { setPaging(false); }
  }

  async function start(recipient: Recipient) {
    if (running.current) return;
    const next = attempt ?? { requestId: crypto.randomUUID(), recipient };
    running.current = true; setBusy(true); setError(''); setAttempt(next);
    try {
      const { thread } = await messageRequest('threads', startThreadOutput, jsonPost(next));
      setAttempt(null); setQuery(''); openedThread.current = true;
      onCreated(thread); onOpenChange(false);
    } catch (failure) {
      setError(messageError(failure));
      if (!(failure instanceof MessageRequestError) || !failure.uncertain) setAttempt(null);
    } finally { running.current = false; setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (attempt) void start(attempt.recipient);
    else if (address.success) void start({ kind: 'exact_email', email: address.data });
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-y-auto sm:max-w-lg" onCloseAutoFocus={event => {
      event.preventDefault();
      document.getElementById(openedThread.current ? 'messaging-conversation-title' : 'new-message-conversation')?.focus();
      openedThread.current = false;
    }}>
      <DialogTitle className="pr-10">Nova mensagem</DialogTitle>
      <DialogDescription>Escolha um contato ou informe o e-mail completo.</DialogDescription>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">Nome ou e-mail<Input value={query} onChange={event => setQuery(event.target.value)} disabled={busy || Boolean(attempt)} autoComplete="off" maxLength={254} placeholder="Nome ou pessoa@escritorio.com.br" className="h-11 text-foreground md:h-9" /></label>
        {attempt ? <div className="flex flex-col items-start gap-2"><p className="text-[13.5px]">A abertura da conversa ainda não foi confirmada.</p><Button type="submit" size="lg" disabled={busy} className="h-11 md:h-[34px]">{busy ? 'Conferindo…' : 'Conferir conversa'}</Button></div>
          : address.success && <Button type="submit" size="lg" disabled={busy} className="h-11 w-full md:h-[34px]">{busy ? 'Abrindo…' : 'Continuar com este e-mail'}</Button>}
      </form>
      {error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-[13.5px] text-destructive">{error}</p>{!attempt && <Button variant="ghost" size="lg" onClick={() => setRevision(value => value + 1)} className="h-11 md:h-[34px]">Tentar novamente</Button>}</div>}
      <div className="-mx-3 flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain">
        {loading ? <p role="status" className="px-3 py-3 text-[13.5px] text-muted-foreground">Buscando contatos…</p>
          : contacts?.contacts.length === 0 ? <p className="px-3 py-3 text-[13.5px] text-muted-foreground">Nenhum contato encontrado. Informe um e-mail completo para iniciar.</p>
            : contacts?.contacts.map(contact => <button type="button" key={contact.userId} disabled={busy || Boolean(attempt)} className="flex min-h-14 w-full flex-col gap-px rounded-md px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:opacity-50" onClick={() => void start({ kind: 'known_user', userId: contact.userId })}>
              <span className="truncate text-sm font-medium">{contact.name}</span><span className="truncate text-[12.5px] text-muted-foreground">{contact.email} · {contact.sources.map(source => sourceLabels[source]).join(' · ')}</span>
            </button>)}
        {contacts?.nextCursor && <Button type="button" variant="ghost" disabled={paging || busy || Boolean(attempt)} onClick={() => void more()} className="h-11 w-full text-muted-foreground md:h-[34px]">{paging ? 'Carregando…' : 'Mais contatos'}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
