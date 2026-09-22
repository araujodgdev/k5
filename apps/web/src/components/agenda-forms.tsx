'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { AgendaActivity, CrmClient } from '@/lib/capabilities/agenda';
import { localInstant } from '@/lib/typesafe/agenda-time';
import { localDate } from '@/lib/calendar-days';
import { agendaCall, selectStyle, type Choice } from '@/lib/agenda-client';
import { ClientPicker } from './client-picker';

export function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-1.5"><Label htmlFor={name}>{label}</Label>{children}</div>;
}
function Selection({ name, label, choices, value = '' }: { name: string; label: string; choices: Choice[]; value?: string | null }) {
  return <Field name={name} label={label}><select id={name} name={name} defaultValue={value ?? ''} className={selectStyle}><option value="">Sem vínculo</option>{value && !choices.some(c => c.id === value) && <option value={value}>Vínculo anterior</option>}{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>;
}
function localTime(instant: string | null) {
  if (!instant) return '';
  const date = new Date(instant);
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function AgendaEditor({ activity, client, mode, cases, clients, members, day, caseId, clientId, timeZone, close, saved, onConfirm }: {
  activity?: AgendaActivity; client?: CrmClient; mode: 'activity' | 'client'; cases: Choice[]; clients: Choice[]; members: Choice[];
  day: string; caseId: string; clientId: string; timeZone: string; close: () => void; saved: () => void;
  onConfirm?: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [kind, setKind] = useState(activity?.kind ?? 'task');
  const [selectedClientId, setSelectedClientId] = useState(activity ? activity.clientId ?? '' : clientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    try {
      if (mode === 'client') {
        await agendaCall(client ? 'k5_crm_update_client' : 'k5_crm_create_client', {
          ...(client ? { clientId: client.id, version: client.version } : {}),
          name: text('name'), email: text('email') || null, phone: text('phone') || null,
          notes: text('notes'), stage: text('stage'), caseIds: form.getAll('caseIds'), idempotencyKey,
        });
      } else {
        if (kind === 'meeting' && new Date(text('endsAt')).getTime() <= new Date(text('startsAt')).getTime()) {
          throw new Error('O fim da reunião deve ser posterior ao início.');
        }
        const payload = {
          ...(activity ? { activityId: activity.id, version: activity.version } : {}),
          kind, title: text('title'), notes: text('notes'), status: text('status'),
          dueOn: kind === 'task' ? text('dueOn') || null : null,
          startsAt: kind === 'meeting' ? localInstant(text('startsAt').slice(0, 10), text('startsAt').slice(11), timeZone) : null,
          endsAt: kind === 'meeting' ? localInstant(text('endsAt').slice(0, 10), text('endsAt').slice(11), timeZone) : null,
          clientId: text('clientId') || null, caseId: text('caseId') || null, assigneeId: text('assigneeId') || null, idempotencyKey,
        };
        if (onConfirm) await onConfirm(payload);
        else await agendaCall(activity ? 'k5_agenda_update_activity' : 'k5_agenda_create_activity', payload);
      }
      saved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent showCloseButton={false} overlayClassName="bg-foreground/25 supports-backdrop-filter:backdrop-blur-none" className="max-h-[85dvh] overflow-y-auto sm:max-w-xl [&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9">
    <DialogHeader><DialogTitle>{onConfirm ? 'Revisar sugestão' : mode === 'client' ? (client ? 'Editar cliente' : 'Novo cliente') : (activity ? 'Editar atividade' : 'Nova atividade')}</DialogTitle><DialogDescription className={onConfirm ? 'text-sm text-muted-foreground' : 'sr-only'}>{onConfirm ? 'Confira todos os campos. A atividade só será salva ao confirmar.' : 'Preencha os dados e salve as alterações.'}</DialogDescription></DialogHeader>
    <form onSubmit={submit} onChange={() => setKey(crypto.randomUUID())} className="grid gap-4">
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        {mode === 'client' ? <>
          <Field name="name" label="Nome"><Input id="name" name="name" required minLength={2} maxLength={180} defaultValue={client?.name} className="h-11 md:h-9" /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field name="email" label="E-mail"><Input id="email" name="email" type="email" maxLength={200} defaultValue={client?.email ?? ''} className="h-11 md:h-9" /></Field><Field name="phone" label="Telefone"><Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={client?.phone ?? ''} className="h-11 md:h-9" /></Field></div>
          <Field name="stage" label="Relacionamento"><select id="stage" name="stage" defaultValue={client?.stage ?? 'prospect'} className={selectStyle}><option value="prospect">Potencial cliente</option><option value="active">Cliente ativo</option><option value="archived">Arquivado</option></select></Field>
          <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">Casos do Cofre</legend>{cases.length ? <div className="max-h-36 space-y-2 overflow-y-auto">{cases.map(c => <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8"><input type="checkbox" name="caseIds" value={c.id} defaultChecked={client?.caseIds.includes(c.id) ?? c.id === caseId} className="size-4 accent-primary" />{c.name}</label>)}</div> : <p className="text-sm text-muted-foreground">Nenhum caso cadastrado no Cofre.</p>}</fieldset>
        </> : <>
          <Field name="title" label="Título"><Input id="title" name="title" required minLength={2} maxLength={180} defaultValue={activity?.title} className="h-11 md:h-9" /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field name="kind" label="Tipo"><select id="kind" value={kind} onChange={e => setKind(e.target.value as 'task' | 'meeting')} className={selectStyle}><option value="task">Tarefa</option><option value="meeting">Reunião</option></select></Field><Field name="status" label="Situação"><select id="status" name="status" defaultValue={activity?.status ?? 'pending'} className={selectStyle}><option value="pending">Pendente</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></Field></div>
          {kind === 'task' ? <Field name="dueOn" label="Data (opcional)"><Input id="dueOn" name="dueOn" type="date" defaultValue={activity ? activity.dueOn ?? '' : day} className="h-11 md:h-9" /></Field> : <div className="space-y-2"><p className="text-xs text-muted-foreground">Horários em {timeZone}</p><div className="grid gap-4 sm:grid-cols-2"><Field name="startsAt" label="Início"><Input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={localTime(activity?.startsAt ?? null) || (onConfirm ? '' : `${day}T09:00`)} className="h-11 md:h-9" /></Field><Field name="endsAt" label="Fim"><Input id="endsAt" name="endsAt" type="datetime-local" required defaultValue={localTime(activity?.endsAt ?? null) || (onConfirm ? '' : `${day}T10:00`)} className="h-11 md:h-9" /></Field></div></div>}
          <Selection name="assigneeId" label="Responsável" choices={members} value={activity?.assigneeId} />
          <div className="grid gap-4 sm:grid-cols-2"><Field name="clientId" label="Cliente"><ClientPicker name="clientId" label="Cliente" value={selectedClientId} onChange={setSelectedClientId} choices={clients} /></Field><Selection name="caseId" label="Caso do Cofre" choices={cases} value={activity ? activity.caseId : caseId} /></div>
        </>}
        <Field name="notes" label="Observações"><Textarea id="notes" name="notes" maxLength={8000} rows={4} defaultValue={mode === 'client' ? client?.notes : activity?.notes} /></Field>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? 'Salvando…' : onConfirm ? 'Confirmar e salvar' : 'Salvar'}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
