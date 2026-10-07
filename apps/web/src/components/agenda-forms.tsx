'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { brazilianStates, type AgendaActivity, type CrmClient } from '@/lib/capabilities/agenda';
import { localInstant } from '@/lib/typesafe/agenda-time';
import { localDate } from '@/lib/calendar-days';
import { timeZoneLabel } from '@/lib/time-zone-label';
import { agendaCall, selectStyle, type Choice } from '@/lib/agenda-client';
import { ClientPicker } from './client-picker';
import { LegalAreaPicker } from './legal-area-picker';

/** A label above its control, as in the prototype's dialogs: 12px in the secondary ink, 6px apart. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
function Selection({ id, name, label, choices, value = '' }: { id: string; name: string; label: string; choices: Choice[]; value?: string | null }) {
  return <Field id={id} label={label}><select id={id} name={name} defaultValue={value ?? ''} className={selectStyle}><option value="">Sem vínculo</option>{value && !choices.some(c => c.id === value) && <option value={value}>Vínculo anterior</option>}{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>;
}
const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function matches(name: string, filter: string) {
  return !filter.trim() || plain(name).includes(plain(filter.trim()));
}
function localTime(instant: string | null) {
  if (!instant) return '';
  const date = new Date(instant);
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
const control = 'max-md:h-11';

export function AgendaEditor({ activity, client, mode, fields = 'all', initialKind = 'task', cases, clients, members, day, caseId, clientId, timeZone, close, saved, onConfirm }: {
  activity?: AgendaActivity; client?: CrmClient; mode: 'activity' | 'client'; fields?: 'all' | 'task-details';
  /** What a new activity starts as: Tarefas creates tasks, Agenda meetings. */
  initialKind?: AgendaActivity['kind']; cases: Choice[]; clients: Choice[]; members: Choice[];
  day: string; caseId: string; clientId: string; timeZone: string; close: () => void; saved: () => void;
  onConfirm?: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [kind, setKind] = useState(activity?.kind ?? initialKind);
  const [selectedClientId, setSelectedClientId] = useState(activity ? activity.clientId ?? '' : clientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  const [caseFilter, setCaseFilter] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    try {
      if (mode === 'client') {
        await agendaCall(client ? 'k5_crm_update_client' : 'k5_crm_create_client', {
          ...(client ? { clientId: client.id, version: client.version } : {}),
          name: text('name'), email: text('email') || null, phone: text('phone') || null,
          notes: text('notes'), stage: text('stage'), caseIds: form.getAll('caseIds'),
          legalAreas: form.getAll('legalAreas'), addressLine: text('addressLine') || null, city: text('city') || null,
          state: text('state') || null, postalCode: text('postalCode') || null, idempotencyKey,
        });
      } else {
        if (kind === 'meeting' && new Date(text('endsAt')).getTime() <= new Date(text('startsAt')).getTime()) {
          throw new Error('O fim da reunião deve ser posterior ao início.');
        }
        const payload = {
          ...(activity ? { activityId: activity.id, version: activity.version } : {}),
          kind, title: text('title'), notes: text('notes'), status: fields === 'task-details' && activity ? activity.status : text('status'),
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
  const title = onConfirm ? 'Revisar sugestão' : mode === 'client' ? (client ? 'Editar cliente' : 'Novo cliente') : `${activity ? 'Editar' : 'Nova'} ${kind === 'meeting' ? 'reunião' : 'tarefa'}`;
  // The fields scroll between the title and a fixed row of actions, so Cancelar and Salvar stay in
  // view on a phone instead of ending up at the bottom of a long scroll.
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent showCloseButton={!busy} className="flex flex-col overflow-hidden">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className={onConfirm ? undefined : 'sr-only'}>{onConfirm ? 'Confira todos os campos. A atividade só será salva ao confirmar.' : 'Preencha os dados e salve as alterações.'}</DialogDescription></DialogHeader>
    <form onSubmit={submit} onChange={() => setKey(crypto.randomUUID())} className="-mx-6 -mb-5 flex min-h-0 flex-col">
      <div className="min-h-0 overflow-y-auto px-6 pt-1 pb-5">
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        {mode === 'client' ? <>
          <Field id={fid('name')} label="Nome"><Input id={fid('name')} name="name" required minLength={2} maxLength={180} defaultValue={client?.name} className={control} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field id={fid('email')} label="E-mail"><Input id={fid('email')} name="email" type="email" maxLength={200} defaultValue={client?.email ?? ''} className={control} /></Field><Field id={fid('phone')} label="Telefone"><Input id={fid('phone')} name="phone" type="tel" maxLength={40} defaultValue={client?.phone ?? ''} className={control} /></Field></div>
          <Field id={fid('stage')} label="Relacionamento"><select id={fid('stage')} name="stage" defaultValue={client?.stage ?? 'prospect'} className={selectStyle}><option value="prospect">Potencial cliente</option><option value="active">Cliente ativo</option><option value="archived">Arquivado</option></select></Field>
          <LegalAreaPicker defaultValue={client?.legalAreas} disabled={busy} onChange={() => setKey(crypto.randomUUID())} />
          <Field id={fid('addressLine')} label="Endereço (opcional)"><Input id={fid('addressLine')} name="addressLine" maxLength={240} autoComplete="street-address" placeholder="Rua, número, complemento e bairro" defaultValue={client?.addressLine ?? ''} className={control} /></Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]"><Field id={fid('city')} label="Cidade"><Input id={fid('city')} name="city" maxLength={120} autoComplete="address-level2" defaultValue={client?.city ?? ''} className={control} /></Field><Field id={fid('state')} label="UF"><select id={fid('state')} name="state" autoComplete="address-level1" defaultValue={client?.state ?? ''} className={selectStyle}><option value="">—</option>{brazilianStates.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></Field><Field id={fid('postalCode')} label="CEP"><Input id={fid('postalCode')} name="postalCode" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{5}-?[0-9]{3}" title="CEP com 8 dígitos" maxLength={9} placeholder="00000-000" defaultValue={client?.postalCode ?? ''} className={control} /></Field></div>
          {/* min-w-0: a fieldset is as wide as its longest word by default, and one unbroken case name would widen the dialog. */}
          <fieldset className="grid min-w-0 gap-1.5"><legend className="mb-1.5 text-xs text-muted-foreground">Casos do Cofre</legend>{cases.length ? <>
            {/* The list grows with the form (one scroll, not a box inside it); a long list gets a filter. */}
            {cases.length > 8 && <Input aria-label="Filtrar casos pelo nome" placeholder="Filtrar casos" value={caseFilter} onChange={event => setCaseFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} className={`mb-1 ${control}`} />}
            <div className="grid">{cases.map(c => <label key={c.id} hidden={!matches(c.name, caseFilter)} className="flex min-h-11 items-center gap-2.5 py-1 text-[13.5px] md:min-h-8"><input type="checkbox" name="caseIds" value={c.id} defaultChecked={client?.caseIds.includes(c.id) ?? c.id === caseId} className="size-4 shrink-0 accent-primary" /><span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span></label>)}</div>
          </> : <p className="text-[13.5px] text-muted-foreground">Nenhum caso cadastrado no Cofre.</p>}</fieldset>
        </> : <>
          <Field id={fid('title')} label="Título"><Input id={fid('title')} name="title" required minLength={2} maxLength={180} defaultValue={activity?.title} className={control} /></Field>
          {fields === 'all' && <div className="grid gap-4 sm:grid-cols-2"><Field id={fid('kind')} label="Tipo"><select id={fid('kind')} value={kind} onChange={e => setKind(e.target.value as 'task' | 'meeting')} className={selectStyle}><option value="task">Tarefa</option><option value="meeting">Reunião</option></select></Field><Field id={fid('status')} label="Situação"><select id={fid('status')} name="status" defaultValue={activity?.status ?? 'pending'} className={selectStyle}><option value="pending">Pendente</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></Field></div>}
          {kind === 'task' ? <Field id={fid('dueOn')} label="Data (opcional)"><Input id={fid('dueOn')} name="dueOn" type="date" defaultValue={activity ? activity.dueOn ?? '' : day} className={control} /></Field>
            : <div className="grid gap-2"><div className="grid gap-4 sm:grid-cols-2"><Field id={fid('startsAt')} label="Início"><Input id={fid('startsAt')} name="startsAt" type="datetime-local" required defaultValue={localTime(activity?.startsAt ?? null) || (onConfirm ? '' : `${day}T09:00`)} className={control} /></Field><Field id={fid('endsAt')} label="Fim"><Input id={fid('endsAt')} name="endsAt" type="datetime-local" required defaultValue={localTime(activity?.endsAt ?? null) || (onConfirm ? '' : `${day}T10:00`)} className={control} /></Field></div><p className="text-xs text-muted-foreground">{timeZoneLabel(timeZone)}</p></div>}
          <Selection id={fid('assigneeId')} name="assigneeId" label="Responsável" choices={members} value={activity?.assigneeId} />
          <div className="grid gap-4 sm:grid-cols-2"><Field id={fid('clientId')} label="Cliente"><ClientPicker id={fid('clientId')} name="clientId" label="Cliente" value={selectedClientId} onChange={setSelectedClientId} choices={clients} /></Field><Selection id={fid('caseId')} name="caseId" label="Caso do Cofre" choices={cases} value={activity ? activity.caseId : caseId} /></div>
        </>}
        <Field id={fid('notes')} label="Observações"><Textarea id={fid('notes')} name="notes" maxLength={8000} rows={4} defaultValue={mode === 'client' ? client?.notes : activity?.notes} /></Field>
      </fieldset>
      </div>
      {error && <p role="alert" className="border-t border-border px-6 pt-3 text-[13px] text-destructive">{error}</p>}
      <DialogFooter className={error ? 'mx-0 mb-0 border-t-0' : 'mx-0 mb-0'}><Button type="button" variant="outline" size="lg" className="max-md:h-11" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" size="lg" className="max-md:h-11" disabled={busy}>{busy ? 'Salvando…' : onConfirm ? 'Confirmar e salvar' : 'Salvar'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
