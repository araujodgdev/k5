'use client';

import { useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { CircleAlert, ImagePlus, X } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { authorStatusLabels, FEEDBACK_IMAGE_TYPES, MAX_FEEDBACK_IMAGE_BYTES, MAX_FEEDBACK_MESSAGE, type AuthorTicket } from '@/lib/feedback-tickets-contract';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** The screen the person came from is context for triage; only same-origin app paths are kept. */
function originPath() {
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === location.origin && referrer.pathname.startsWith('/app') && referrer.pathname !== '/app/feedback' ? referrer.pathname.slice(0, 300) : '';
  } catch { return ''; }
}

export function FeedbackForm({ initial }: { initial: AuthorTicket[] }) {
  const [tickets, setTickets] = useState(initial);
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function attach(file: File | null | undefined) {
    setError('');
    if (!file) return;
    if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) { setError('Envie o print como PNG, JPEG ou WebP.'); return; }
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) { setError('O print deve ter até 5 MB.'); return; }
    setImage(file);
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); attach(file); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSent(null);
    try {
      const body = new FormData();
      body.set('message', message); body.set('pagePath', originPath());
      if (image) body.set('image', image);
      const response = await fetch('/api/feedback', { method: 'POST', body });
      const data = await response.json().catch(() => ({})) as { ticket?: { number: number }; error?: string };
      if (!response.ok || !data.ticket) throw new Error(data.error || 'Não foi possível enviar. Tente novamente.');
      setSent(data.ticket.number); setMessage(''); setImage(null);
      if (fileInput.current) fileInput.current.value = '';
      const list = await fetch('/api/feedback', { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<{ tickets: AuthorTicket[] }> : null).catch(() => null);
      if (list) setTickets(list.tickets);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-12 md:py-11">
    <h1 className="display text-[28px] max-md:sr-only">Feedback</h1>
    <form onSubmit={submit} className="mt-6 grid gap-4 border-b pb-8">
      <div className="grid gap-1.5">
        <Label htmlFor="feedback-message">O que aconteceu ou o que você gostaria?</Label>
        <Textarea id="feedback-message" value={message} onChange={event => setMessage(event.target.value)} onPaste={paste} required minLength={3}
          maxLength={MAX_FEEDBACK_MESSAGE} rows={6} disabled={busy} aria-describedby="feedback-privacy" />
        <p id="feedback-privacy" className="text-xs text-muted-foreground">Não inclua dados de clientes, como nomes, CPF ou números de processo.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileInput} id="feedback-image" type="file" accept={FEEDBACK_IMAGE_TYPES.join(',')} className="sr-only" onChange={event => attach(event.target.files?.[0])} disabled={busy} />
        {image ? <p className="flex min-h-11 min-w-0 items-center gap-2 text-sm md:min-h-9"><span className="truncate">{image.name || 'Print colado'}</span>
          <Button type="button" variant="ghost" size="icon" aria-label="Remover print" onClick={() => { setImage(null); if (fileInput.current) fileInput.current.value = ''; }}><X className="size-4" /></Button></p>
          : <Button type="button" variant="outline" size="lg" className="md:h-9" onClick={() => fileInput.current?.click()} disabled={busy}><ImagePlus className="size-4" aria-hidden="true" />Anexar print (opcional)</Button>}
        <Button type="submit" size="lg" className="md:h-9 sm:ml-auto" disabled={busy || message.trim().length < 3}>{busy ? 'Enviando…' : 'Enviar'}</Button>
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {sent !== null && <p role="status" className="text-sm">Recebemos o relato #{sent}. Você será avisado quando ele for resolvido.</p>}
    </form>
    <section aria-labelledby="feedback-history" className="pt-8">
      <h2 id="feedback-history" className="font-medium">Seus relatos</h2>
      {tickets.length === 0 ? <p className="py-6 text-sm text-muted-foreground">Você ainda não enviou nenhum relato.</p>
        : <div className="mt-3 divide-y border-y">{tickets.map(ticket => <article key={ticket.id} className="py-4">
          <p className="text-xs text-muted-foreground">#{ticket.number} · {dateFormat.format(new Date(ticket.createdAt))} · {authorStatusLabels[ticket.status]}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm">{ticket.message}</p>
          {ticket.resolutionNote && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">Resposta da equipe: {ticket.resolutionNote}</p>}
        </article>)}</div>}
    </section>
  </div>;
}
