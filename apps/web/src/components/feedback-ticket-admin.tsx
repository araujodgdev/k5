'use client';

import { useState, type FormEvent } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Field } from './canvas/canvas-controls';
import { AdminBlock, AdminBlockHead, AdminDetailHead, AdminFact, AdminFacts, AdminGrid, adminButton, adminSelect } from './admin/admin-blocks';
import type { PlatformTicket } from '@/lib/feedback-tickets';
import {
  kindLabels, moduleLabels, priorityLabels, reportKindLabels, statusLabels, ticketKinds, ticketModules, ticketPriorities, ticketStatuses,
  type TicketKind, type TicketModule, type TicketPriority, type TicketStatus, type TicketUpdate,
} from '@/lib/feedback-tickets-contract';

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

/** The two forms of the page; a result shows beside the form that produced it. */
type Form = 'triage' | 'note';
type Notice = { form: Form; tone: 'status' | 'alert'; text: string };

function NoticeLine({ notice, form }: { notice: Notice | null; form: Form }) {
  if (notice?.form !== form) return null;
  if (notice.tone === 'status') return <p role="status" className="text-[12.5px] text-muted-foreground">{notice.text}</p>;
  return <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{notice.text}</p>;
}

export function FeedbackTicketAdmin({ initial }: { initial: PlatformTicket }) {
  const [ticket, setTicket] = useState(initial);
  type Draft = { status: TicketStatus; kind: TicketKind | ''; module: TicketModule | ''; priority: TicketPriority; resolutionNote: string };
  const [draft, setDraft] = useState<Draft>({ status: initial.status, kind: initial.kind ?? '', module: initial.module ?? '', priority: initial.priority, resolutionNote: initial.resolutionNote });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function save(form: Form, changes: Omit<TicketUpdate, 'version'>, done: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: ticket.version, ...changes }),
      });
      const data = await response.json().catch(() => ({})) as { ticket?: PlatformTicket; error?: string };
      if (!response.ok || !data.ticket) throw new Error(data.error || 'Não foi possível salvar.');
      setTicket(data.ticket);
      setDraft({ status: data.ticket.status, kind: data.ticket.kind ?? '', module: data.ticket.module ?? '', priority: data.ticket.priority, resolutionNote: data.ticket.resolutionNote });
      setNotice({ form, tone: 'status', text: done }); return true;
    } catch (failure) { setNotice({ form, tone: 'alert', text: failure instanceof Error ? failure.message : 'Não foi possível salvar.' }); return false; }
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
    if (!Object.keys(changes).length) { setNotice({ form: 'triage', tone: 'status', text: 'Nada mudou.' }); return; }
    void save('triage', changes, draft.status === 'resolved' && ticket.status !== 'resolved' ? 'Ticket resolvido. O autor foi notificado.' : 'Alterações salvas.');
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await save('note', { note }, 'Nota adicionada.')) setNote('');
  }
  const answers = ticket.classification?.answers ?? {};

  return <>
    <AdminDetailHead back={{ href: '/app/admin/feedback', label: 'Voltar para feedback' }} title={`Ticket #${ticket.number}`}
      sub={[ticket.officeName, ticket.userName ?? 'Usuário removido', ticket.userEmail, dateFormat.format(new Date(ticket.createdAt))].filter(Boolean).join(' · ')} />
    <AdminGrid>
      <AdminBlock half card labelledBy="ticket-message">
        <AdminBlockHead id="ticket-message" level={3} title="Relato" />
        {(ticket.securityFlag || ticket.personalDataFlag) && <p className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {[ticket.securityFlag && 'Possível incidente de segurança: verifique antes dos demais.', ticket.personalDataFlag && 'O texto pode conter dados pessoais de clientes; não copie para fora da plataforma.'].filter(Boolean).join(' ')}</p>}
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{ticket.message}</p>
        {ticket.hasAttachment && <a href={`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}/attachment`} target="_blank" rel="noreferrer"
          className="block w-fit rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated image */}
          <img src={`/api/platform/feedback/tickets/${encodeURIComponent(ticket.id)}/attachment`} alt="Print enviado com o relato" className="max-h-96 rounded-md border border-border" />
        </a>}
        <AdminFacts>
          <AdminFact label="Informado pela pessoa">{[ticket.reportedKind && reportKindLabels[ticket.reportedKind], ticket.reportedModule && moduleLabels[ticket.reportedModule]].filter(Boolean).join(' · ') || 'Não informado'}</AdminFact>
          <AdminFact label="Tela de origem" mono>{ticket.pagePath || 'Não informada'}</AdminFact>
          <AdminFact label="Navegador">{ticket.userAgent || 'Não informado'}</AdminFact>
        </AdminFacts>
      </AdminBlock>

      <AdminBlock half card labelledBy="ticket-actions">
        <form onSubmit={submit} aria-labelledby="ticket-actions" className="flex flex-col gap-3.5">
          <AdminBlockHead id="ticket-actions" level={3} title="Triagem" />
          <div className="grid gap-x-2.5 gap-y-3.5 sm:grid-cols-2">
            <Field label="Situação" htmlFor="ticket-status"><select id="ticket-status" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as typeof draft.status })} className={adminSelect}>{ticketStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></Field>
            <Field label="Prioridade" htmlFor="ticket-priority"><select id="ticket-priority" value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as typeof draft.priority })} className={adminSelect}>{ticketPriorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></Field>
            <Field label="Tipo" htmlFor="ticket-kind"><select id="ticket-kind" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as typeof draft.kind })} className={adminSelect}>{!draft.kind && <option value="">Sem classificação</option>}{ticketKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></Field>
            <Field label="Módulo" htmlFor="ticket-module"><select id="ticket-module" value={draft.module} onChange={event => setDraft({ ...draft, module: event.target.value as typeof draft.module })} className={adminSelect}>{!draft.module && <option value="">Sem classificação</option>}{ticketModules.map(value => <option key={value} value={value}>{moduleLabels[value]}</option>)}</select></Field>
          </div>
          <Field label="Resposta ao autor" htmlFor="ticket-resolution">
            <Textarea id="ticket-resolution" value={draft.resolutionNote} onChange={event => setDraft({ ...draft, resolutionNote: event.target.value })} rows={4} maxLength={2000} aria-describedby="ticket-resolution-help" />
            <p id="ticket-resolution-help" className="text-xs text-muted-foreground">Aparece para quem enviou quando o ticket estiver resolvido.</p>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className={adminButton} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
            <NoticeLine notice={notice} form="triage" />
          </div>
        </form>
      </AdminBlock>

      <AdminBlock half card labelledBy="ticket-triage">
        <AdminBlockHead id="ticket-triage" level={3} title="Classificação automática"
          sub={`${triageLabels[ticket.classificationStatus] ?? ticket.classificationStatus}${ticket.classifiedBy === 'admin' ? ' · corrigida manualmente' : ''}${ticket.needsReview ? ' · confiança baixa, revise' : ''}`} />
        {ticket.classification?.status === 'evaluated' && <AdminFacts>
          <AdminFact label="Tipo sugerido">{answers.kind?.choice ? kindLabels[answers.kind.choice as keyof typeof kindLabels] : '—'}{percent(answers.kind?.confidence)}</AdminFact>
          <AdminFact label="Módulo sugerido">{answers.module?.choice ? moduleLabels[answers.module.choice as keyof typeof moduleLabels] : '—'}{percent(answers.module?.confidence)}</AdminFact>
          <AdminFact label="Gravidade, se for problema (0 a 3)" mono>{answers.severity?.score?.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) ?? '—'}</AdminFact>
          <AdminFact label="Relevância, se for melhoria (0 a 3)" mono>{answers.value?.score?.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) ?? '—'}</AdminFact>
          <AdminFact label="Sinais">Segurança{percent(answers.security?.noul)} · Dados pessoais{percent(answers.personal_data?.noul)}</AdminFact>
        </AdminFacts>}
      </AdminBlock>

      <AdminBlock half card labelledBy="ticket-history">
        <AdminBlockHead id="ticket-history" level={3} title="Histórico" />
        <ol className="flex flex-col">
          {ticket.events.map((event, index) => (
            <li key={index} className="flex flex-col gap-0.5 py-2.5 first:pt-0">
              <p className="text-xs text-muted-foreground"><span className="font-mono">{dateFormat.format(new Date(event.createdAt))}</span> · {eventLabels[event.kind] ?? event.kind}{event.actorName ? ` · ${event.actorName}` : ''}</p>
              {eventDetail(event.kind, event.details) && <p className="text-[13.5px] break-words whitespace-pre-wrap">{eventDetail(event.kind, event.details)}</p>}
            </li>
          ))}
        </ol>
        <form onSubmit={addNote} className="flex flex-col gap-2.5">
          <Field label="Nota interna" htmlFor="ticket-note">
            <Textarea id="ticket-note" value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={4000} disabled={busy} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" className={adminButton} disabled={busy || !note.trim()}>Adicionar nota</Button>
            <NoticeLine notice={notice} form="note" />
          </div>
        </form>
      </AdminBlock>
    </AdminGrid>
  </>;
}
