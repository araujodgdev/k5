'use client';

import { forwardRef, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { ArrowLeft, Bug, CircleAlert, CircleHelp, ImagePlus, Lightbulb, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import {
  authorStatusLabels, FEEDBACK_IMAGE_TYPES, MAX_FEEDBACK_IMAGE_BYTES, MAX_FEEDBACK_MESSAGE, moduleForPath, reportKindLabels, reportKinds,
  reportModuleLabels, reportModules, type AuthorTicket, type ReportKind, type TicketModule,
} from '@/lib/feedback-tickets-contract';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
/** Each kind the person can pick: its tile, the question the text answers, and the action's name. */
const kindChoices: Record<ReportKind, { Icon: typeof Bug; label: string; question: string; action: string }> = {
  problem: { Icon: Bug, label: 'Algo quebrou', question: 'O que você esperava que acontecesse, e o que aconteceu?', action: 'Reportar problema' },
  suggestion: { Icon: Lightbulb, label: 'Tenho uma ideia', question: 'O que você gostaria de fazer, e como isso ajudaria?', action: 'Enviar ideia' },
  question: { Icon: CircleHelp, label: 'Não entendi algo', question: 'O que você tentou entender, e onde ficou confuso?', action: 'Enviar dúvida' },
};
type View = 'form' | 'history';

/** The bug icon beside Instalar; it only asks the shell to open the one feedback dialog. */
export const FeedbackTrigger = forwardRef<HTMLButtonElement, { onOpen: (opener: HTMLElement) => void; className?: string }>(function FeedbackTrigger({ onOpen, className }, ref) {
  return <Button ref={ref} variant="ghost" size="icon" onClick={event => onOpen(event.currentTarget)} aria-label="Enviar feedback" title="Enviar feedback"
    className={cn('size-11 text-muted-foreground hover:text-foreground md:size-9', className)}><Bug aria-hidden="true" /></Button>;
});

export function FeedbackDialog({ open, onOpenChange, initialView = 'form', pathname, onCloseFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialView?: View; pathname: string; onCloseFocus: () => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [kind, setKind] = useState<ReportKind>('problem');
  const [module, setModule] = useState<TicketModule>(() => moduleForPath(pathname));
  const [message, setMessage] = useState('');
  // The preview URL is made when the file is chosen and released when it is replaced or removed.
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const [tickets, setTickets] = useState<AuthorTicket[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The screen the dialog was opened on is the triage's context; it is captured when it opens.
  const [origin, setOrigin] = useState(pathname);

  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setOrigin(pathname);
      setView(initialView); setError(''); setSent(null); setHistoryError(false);
      // A draft in progress keeps its place; a fresh one starts where the person is.
      if (!message.trim()) setModule(moduleForPath(pathname));
    }
  }
  function showHistory() { setView('history'); setHistoryError(false); }


  useEffect(() => {
    if (!open || view !== 'history') return;
    let cancelled = false;
    fetch('/api/feedback', { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ tickets: AuthorTicket[] }> : Promise.reject(new Error('history')))
      .then(data => { if (!cancelled) setTickets(data.tickets); })
      .catch(() => { if (!cancelled) setHistoryError(true); });
    return () => { cancelled = true; };
  }, [open, view]);

  function attach(file: File | null | undefined) {
    setError('');
    if (!file) return;
    if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) { setError('Envie a imagem como PNG, JPEG ou WebP.'); return; }
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) { setError('A imagem deve ter até 5 MB.'); return; }
    if (image) URL.revokeObjectURL(image.preview);
    setImage({ file, preview: URL.createObjectURL(file) });
  }
  function clearImage() {
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); attach(file); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSent(null);
    try {
      const body = new FormData();
      body.set('message', message); body.set('kind', kind); body.set('module', module);
      body.set('pagePath', origin.startsWith('/app') ? origin.slice(0, 300) : '');
      if (image) body.set('image', image.file);
      const response = await fetch('/api/feedback', { method: 'POST', body });
      const data = await response.json().catch(() => ({})) as { ticket?: { number: number }; error?: string };
      if (!response.ok || !data.ticket) throw new Error(data.error || 'Não foi possível enviar. Tente novamente.');
      setSent(data.ticket.number); setMessage(''); clearImage(); setTickets(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* A panel beside the menu, over a softly blurred page: feedback without leaving the screen. */}
    <DialogContent overlayClassName="bg-overlay/20 backdrop-blur-[6px]"
      className="feedback-panel top-auto right-2 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+.5rem)] left-2 max-h-[calc(100dvh-6rem)] w-auto max-w-none translate-x-0 translate-y-0 gap-5 overflow-y-auto p-5 sm:max-w-none md:right-auto md:max-h-[calc(100dvh-1.5rem)] md:w-[23rem] data-open:slide-in-from-bottom-3 data-open:zoom-in-100 data-closed:zoom-out-100"
      onCloseAutoFocus={event => { event.preventDefault(); onCloseFocus(); }}>
      {view === 'form' ? <>
        <div className="grid gap-1 pr-8">
          <DialogTitle className="font-sans text-base font-medium">Enviar feedback</DialogTitle>
          <DialogDescription className="text-muted-foreground">Conte sem sair do que estava fazendo.</DialogDescription>
        </div>
        {sent !== null ? <div className="grid gap-5">
          <p role="status" className="text-sm leading-6">Recebemos o relato #{sent}. Você será avisado quando ele for resolvido.</p>
          <div className="grid gap-2">
            <Button type="button" size="lg" className="h-11 w-full" onClick={() => onOpenChange(false)}>Fechar</Button>
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="lg" className="-ml-2 md:h-9" onClick={showHistory}>Ver seus relatos</Button>
              <Button type="button" variant="ghost" size="lg" className="-mr-2 md:h-9" onClick={() => setSent(null)}>Enviar outro</Button>
            </div>
          </div>
        </div> : <form onSubmit={submit} className="grid gap-4">
          <fieldset className="grid gap-1.5">
            <legend className="sr-only">Tipo de relato</legend>
            <div className="grid grid-cols-3 gap-2">
              {reportKinds.map(value => {
                const { Icon, label } = kindChoices[value];
                return <label key={value} className={cn('flex min-h-[4.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 border px-1.5 py-2 text-center text-[13px] leading-tight transition-colors duration-300 ease-(--ease) has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  kind === value ? 'border-foreground bg-foreground font-medium text-background' : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground')}>
                  <input type="radio" name="feedback-kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="sr-only" disabled={busy} />
                  <Icon className="size-4" aria-hidden="true" />{label}
                </label>;
              })}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="feedback-message" className="sr-only">{kindChoices[kind].question}</Label>
            <Textarea id="feedback-message" value={message} onChange={event => setMessage(event.target.value)} onPaste={paste} required minLength={3}
              maxLength={MAX_FEEDBACK_MESSAGE} rows={4} disabled={busy} aria-describedby="feedback-privacy"
              placeholder={kindChoices[kind].question} className="min-h-28" />
          </div>
          <div className="flex gap-3 border border-border p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="grid min-w-0 gap-1 text-[13px] leading-snug">
              <p className="font-medium">
                Enviado a partir de{' '}
                <label htmlFor="feedback-module" className="sr-only">Onde aconteceu</label>
                <select id="feedback-module" value={module} onChange={event => setModule(event.target.value as TicketModule)} disabled={busy}
                  className="max-w-full cursor-pointer border-b border-foreground/40 bg-transparent font-medium outline-none hover:border-foreground focus-visible:border-brand">
                  {reportModules.map(value => <option key={value} value={value}>{reportModuleLabels[value]}</option>)}
                </select>
              </p>
              <p id="feedback-privacy" className="text-muted-foreground">Só a tela vai junto. Não inclua dados de clientes, como nomes, CPF ou números de processo.</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3 border border-border p-3">
            <input ref={fileInput} id="feedback-image" type="file" accept={FEEDBACK_IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1}
              onChange={event => attach(event.target.files?.[0])} disabled={busy} />
            {image ? <>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
              <img src={image.preview} alt="" className="size-10 shrink-0 border object-cover" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{image.file.name || 'Imagem colada'}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Remover captura de tela" onClick={clearImage} disabled={busy}><X className="size-4" /></Button>
            </> : <>
              <div className="grid min-w-0 flex-1 gap-0.5 text-[13px] leading-snug">
                <p className="font-medium">Incluir captura de tela</p>
                <p className="text-muted-foreground">Cole com Ctrl+V no texto ou escolha uma imagem.</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 md:h-8" onClick={() => fileInput.current?.click()} disabled={busy}>
                <ImagePlus aria-hidden="true" />Escolher</Button>
            </>}
          </div>
          {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
          <div className="grid gap-1">
            <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || message.trim().length < 3}>
              {busy ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Enviando…</> : kindChoices[kind].action}
            </Button>
            <Button type="button" variant="ghost" size="lg" className="mx-auto md:h-9" onClick={showHistory}>Ver seus relatos</Button>
          </div>
        </form>}
      </> : <>
        <div className="flex items-center gap-2 pr-8">
          <Button type="button" variant="ghost" size="icon" aria-label="Voltar ao novo relato" onClick={() => setView('form')} className="-ml-2"><ArrowLeft className="size-4" /></Button>
          <DialogTitle className="font-sans text-base font-medium">Seus relatos</DialogTitle>
          <DialogDescription className="sr-only">Relatos enviados por você neste escritório, com a situação e a resposta da equipe.</DialogDescription>
        </div>
        {historyError ? <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Não foi possível carregar seus relatos.</p>
          : tickets === null ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Carregando…</p>
            : tickets.length === 0 ? <p className="text-sm text-subtle-foreground">Você ainda não enviou nenhum relato.</p>
              : <div className="-mx-5 divide-y border-y px-5">{tickets.map(ticket => <article key={ticket.id} className="py-3">
                <p className="text-xs text-muted-foreground">{[`#${ticket.number}`, dateFormat.format(new Date(ticket.createdAt)), ticket.kind && reportKindLabels[ticket.kind],
                  ticket.module && ticket.module in reportModuleLabels ? reportModuleLabels[ticket.module as keyof typeof reportModuleLabels] : null, authorStatusLabels[ticket.status]].filter(Boolean).join(' · ')}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm">{ticket.message}</p>
                {ticket.resolutionNote && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">Resposta da equipe: {ticket.resolutionNote}</p>}
              </article>)}</div>}
      </>}
    </DialogContent>
  </Dialog>;
}
