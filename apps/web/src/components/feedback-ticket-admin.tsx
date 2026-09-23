'use client';

import { useState, type FormEvent } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import type { PlatformTicket } from '@/lib/feedback-tickets';
import {
  kindLabels, moduleLabels, priorityLabels, statusLabels, ticketKinds, ticketModules, ticketPriorities, ticketStatuses,
  type TicketKind, type TicketModule, type TicketPriority, type TicketStatus, type TicketUpdate,
} from '@/lib/feedback-tickets-contract';

const selectStyle = 'h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const percent = (value: number | undefined) => value === undefined ? '' : ` (${Math.round(value * 100)}%)`;
const eventLabels: Record<string, string> = { created: 'Enviado', classified: 'Classificado pelo TypeSafe', reclassified: 'Classificação corrigida', status_changed: 'Situação alterada', note: 'Nota interna' };
const triageLabels: Record<string, string> = { pending: 'Aguardando classificação', running: 'Classificando', classified: 'Classificado', disabled: 'TypeSafe desligado', unavailable: 'TypeSafe indisponível' };

function eventDetail(kind: string, details: Record<string, unknown>) {
  if (kind === 'note') return String(details.text ?? '');
  if (kind === 'status_changed') return `${statusLabels[details.from as keyof typeof statusLabels] ?? details.from} → ${statusLabels[details.to as keyof typeof statusLabels] ?? details.to}`;
  if (kind === 'reclassified') return Object.entries(details).map(([field, change]) => {
    const { from, to } = change as { from: string | null; to: string };
    const labels = (field === 'kind' ? kindLabels : field === 'module' ? moduleLabels : priorityLabels) as Record<string, string>;
    return `${field === 'kind' ? 'Tipo' : field === 'module' ? 'Módulo' : 'Prioridade'}: ${from ? labels[from] ?? from : '—'} → ${labels[to] ?? to}`;
  }).join(' · ');
  return '';
}

export function FeedbackTicketAdmin({ initial }: { initial: PlatformTicket }) {
  const [ticket, setTicket] = useState(initial);
  type Draft = { status: TicketStatus; kind: TicketKind | ''; module: TicketModule | ''; priority: TicketPriority; resolutionNote: string };
  const [draft, setDraft] = useState<Draft>({ status: initial.status, kind: initial.kind ?? '', module: initial.module ?? '', priority: initial.priority, resolutionNote: initial.resolutionNote });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function save(changes: Omit<TicketUpdate, 'version'>, done: string) {
    setBusy(true); setError(''); setSaved('');
    try {
      const response = await fetch(`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: ticket.version, ...changes }),
      });
      const data = await response.json().catch(() => ({})) as { ticket?: PlatformTicket; error?: string };
      if (!response.ok || !data.ticket) throw new Error(data.error || 'Não foi possível salvar.');
      setTicket(data.ticket);
      setDraft({ status: data.ticket.status, kind: data.ticket.kind ?? '', module: data.ticket.module ?? '', priority: data.ticket.priority, resolutionNote: data.ticket.resolutionNote });
      setSaved(done); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); return false; }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes: Omit<TicketUpdate, 'version'> = {};
    if (draft.status !== ticket.status) changes.status = draft.status;
    if (draft.kind && draft.kind !== ticket.kind) changes.kind = draft.kind;
    if (draft.module && draft.module !== ticket.module) changes.module = draft.module;
    if (draft.priority !== ticket.priority) changes.priority = draft.priority;
    if (draft.resolutionNote !== ticket.resolutionNote) changes.resolutionNote = draft.resolutionNote;
    if (!Object.keys(changes).length) { setSaved('Nada mudou.'); return; }
    void save(changes, draft.status === 'resolved' && ticket.status !== 'resolved' ? 'Ticket resolvido. O autor foi notificado.' : 'Alterações salvas.');
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await save({ note }, 'Nota adicionada.')) setNote('');
  }
  const answers = ticket.classification?.answers ?? {};

  return <div className="mt-5">
    <header className="border-b pb-5">
      <h1 className="page-title">Ticket #{ticket.number}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{[ticket.officeName, ticket.userName ?? 'Usuário removido', ticket.userEmail, dateFormat.format(new Date(ticket.createdAt))].filter(Boolean).join(' · ')}</p>
    </header>
    <div className="grid gap-10 py-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="ticket-message">
          <h2 id="ticket-message" className="mb-3 font-medium">Relato</h2>
          {(ticket.securityFlag || ticket.personalDataFlag) && <p className="mb-3 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {[ticket.securityFlag && 'Possível incidente de segurança: verifique antes dos demais.', ticket.personalDataFlag && 'O texto pode conter dados pessoais de clientes; não copie para fora da plataforma.'].filter(Boolean).join(' ')}</p>}
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{ticket.message}</p>
          {ticket.hasAttachment && <a href={`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}/attachment`} target="_blank" rel="noreferrer" className="mt-4 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated image */}
            <img src={`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}/attachment`} alt="Print enviado com o relato" className="max-h-96 rounded-md border" />
          </a>}
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Tela de origem</dt><dd className="break-all">{ticket.pagePath || 'Não informada'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Navegador</dt><dd className="break-words">{ticket.userAgent || 'Não informado'}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="ticket-triage">
          <h2 id="ticket-triage" className="mb-3 font-medium">Classificação automática</h2>
          <p className="text-sm text-muted-foreground">{triageLabels[ticket.classificationStatus] ?? ticket.classificationStatus}{ticket.classifiedBy === 'admin' ? ' · corrigida manualmente' : ''}{ticket.needsReview ? ' · confiança baixa, revise' : ''}</p>
          {ticket.classification?.status === 'evaluated' && <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Tipo sugerido</dt><dd>{answers.kind?.choice ? kindLabels[answers.kind.choice as keyof typeof kindLabels] : '—'}{percent(answers.kind?.confidence)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Módulo sugerido</dt><dd>{answers.module?.choice ? moduleLabels[answers.module.choice as keyof typeof moduleLabels] : '—'}{percent(answers.module?.confidence)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Gravidade, se for problema (0 a 3)</dt><dd>{answers.severity?.score?.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Sinais</dt><dd>Segurança{percent(answers.security?.noul)} · Dados pessoais{percent(answers.personal_data?.noul)}</dd></div>
          </dl>}
        </section>
        <section aria-labelledby="ticket-history">
          <h2 id="ticket-history" className="mb-3 font-medium">Histórico</h2>
          <div className="divide-y border-y">{ticket.events.map((event, index) => <div key={index} className="py-3 text-sm">
            <p className="text-xs text-muted-foreground">{dateFormat.format(new Date(event.createdAt))} · {eventLabels[event.kind] ?? event.kind}{event.actorName ? ` · ${event.actorName}` : ''}</p>
            {eventDetail(event.kind, event.details) && <p className="mt-1 whitespace-pre-wrap break-words">{eventDetail(event.kind, event.details)}</p>}
          </div>)}</div>
          <form onSubmit={addNote} className="mt-4 grid gap-2">
            <Label htmlFor="ticket-note">Nota interna</Label>
            <Textarea id="ticket-note" value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={4000} disabled={busy} />
            <Button type="submit" variant="outline" size="lg" className="justify-self-start md:h-9" disabled={busy || !note.trim()}>Adicionar nota</Button>
          </form>
        </section>
      </div>
      <form onSubmit={submit} className="grid content-start gap-4" aria-labelledby="ticket-actions">
        <h2 id="ticket-actions" className="font-medium">Triagem</h2>
        <div className="grid gap-1.5"><Label htmlFor="ticket-status">Situação</Label><select id="ticket-status" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as typeof draft.status })} className={selectStyle}>{ticketStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="ticket-priority">Prioridade</Label><select id="ticket-priority" value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as typeof draft.priority })} className={selectStyle}>{ticketPriorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="ticket-kind">Tipo</Label><select id="ticket-kind" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as typeof draft.kind })} className={selectStyle}>{!draft.kind && <option value="">Sem classificação</option>}{ticketKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="ticket-module">Módulo</Label><select id="ticket-module" value={draft.module} onChange={event => setDraft({ ...draft, module: event.target.value as typeof draft.module })} className={selectStyle}>{!draft.module && <option value="">Sem classificação</option>}{ticketModules.map(value => <option key={value} value={value}>{moduleLabels[value]}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="ticket-resolution">Resposta ao autor</Label>
          <Textarea id="ticket-resolution" value={draft.resolutionNote} onChange={event => setDraft({ ...draft, resolutionNote: event.target.value })} rows={4} maxLength={2000} aria-describedby="ticket-resolution-help" />
          <p id="ticket-resolution-help" className="text-xs text-muted-foreground">Aparece para quem enviou quando o ticket estiver resolvido.</p></div>
        <Button type="submit" size="lg" className="justify-self-start md:h-9" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">{saved}</p>}
      </form>
    </div>
  </div>;
}
