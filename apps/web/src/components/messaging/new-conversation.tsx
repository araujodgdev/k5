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
    <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-y-auto sm:max-w-lg [&_[data-slot=dialog-close]]:size-11 md:[&_[data-slot=dialog-close]]:size-9" onCloseAutoFocus={event => {
      event.preventDefault();
      document.getElementById(openedThread.current ? 'messaging-conversation-title' : 'new-message-conversation')?.focus();
      openedThread.current = false;
    }}>
      <DialogTitle className="pr-10">Nova conversa</DialogTitle>
      <DialogDescription>Escolha um contato ou informe o e-mail completo.</DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <label className="grid gap-2 text-sm">Nome ou e-mail<Input value={query} onChange={event => setQuery(event.target.value)} disabled={busy || Boolean(attempt)} autoComplete="off" maxLength={254} placeholder="Nome ou pessoa@escritorio.com.br" className="min-h-11 md:min-h-9" /></label>
        {attempt ? <div className="space-y-2 border-l-2 border-brand pl-3"><p className="text-sm">A abertura da conversa ainda não foi confirmada.</p><Button type="submit" disabled={busy} className="min-h-11 md:min-h-9">{busy ? 'Conferindo…' : 'Conferir conversa'}</Button></div>
          : address.success && <Button type="submit" disabled={busy} className="min-h-11 w-full md:min-h-9">{busy ? 'Abrindo…' : 'Continuar com este e-mail'}</Button>}
      </form>
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!attempt && <Button variant="ghost" onClick={() => setRevision(value => value + 1)} className="min-h-11 md:min-h-9">Tentar novamente</Button>}</div>}
      <div className="min-h-0 overflow-y-auto overscroll-contain border-t">
        {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Buscando contatos…</p>
          : contacts?.contacts.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Nenhum contato encontrado. Informe um e-mail completo para iniciar.</p>
            : contacts?.contacts.map(contact => <button type="button" key={contact.userId} disabled={busy || Boolean(attempt)} className="hover-rise block min-h-16 w-full border-b px-2 py-3 text-left outline-none hover:text-brand-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50" onClick={() => void start({ kind: 'known_user', userId: contact.userId })}>
              <span className="block truncate text-sm font-medium">{contact.name}</span><span className="block truncate text-xs">{contact.email}</span><span className="mt-1 block text-xs">{contact.sources.map(source => sourceLabels[source]).join(' · ')}</span>
            </button>)}
        {contacts?.nextCursor && <Button type="button" variant="ghost" disabled={paging || busy || Boolean(attempt)} onClick={() => void more()} className="my-2 min-h-11 w-full md:min-h-9">{paging ? 'Carregando…' : 'Mais contatos'}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
