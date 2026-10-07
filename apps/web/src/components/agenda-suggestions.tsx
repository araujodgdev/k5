'use client';
import { useEffect, useId, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { CanvasRow } from './canvas/canvas-page';
import { LumeMark } from './lume-mark';
import { agendaCall, selectStyle, type Choice } from '@/lib/agenda-client';
import type { AgendaProposal } from '@/lib/typesafe/agenda-contracts';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import { clockTime, dayMonth } from './agenda-rows';

const AgendaEditor = dynamic(() => import('./agenda-forms').then(module => module.AgendaEditor));

const updates = ['reschedule', 'complete', 'cancel'];
const modeOf = (proposal: AgendaProposal) => proposal.payload.activityId || updates.includes(proposal.operation) ? 'update' : 'create';
const blank: AgendaActivity = {
  id: '', version: 1, kind: 'task', title: '', notes: '', status: 'pending', dueOn: null, startsAt: null, endsAt: null, clientId: null, caseId: null, assigneeId: null, createdAt: '', updatedAt: '',
};

/**
 * What the Lume prepared from a description and still waits for the person: tinted rows with the
 * mark, as in the prototype's module rows, each opening its review. `describing` opens the form
 * that asks the Lume for a new one.
 */
export function AgendaSuggestions({ cases, clients, members, day, timeZone, initialProposalId, refreshed, describing, onDescribingChange }: {
  cases: Choice[]; clients: Choice[]; members: Choice[]; day: string; timeZone: string; initialProposalId: string; refreshed: () => void;
  describing: boolean; onDescribingChange: (open: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [proposals, setProposals] = useState<AgendaProposal[]>([]);
  const [selected, setSelected] = useState<AgendaProposal | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'create' | 'update'>('create');
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<AgendaActivity[]>([]);
  const [targetId, setTargetId] = useState('');
  const [seed, setSeed] = useState<AgendaActivity | null>(null);
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    agendaCall('k5_agenda_list_proposals', {}).then(({ proposals }) => { if (!cancelled) setProposals(proposals); }).catch(() => { if (!cancelled) setError('Não foi possível consultar as sugestões do Lume.'); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    let cancelled = false;
    if (!initialProposalId) return;
    agendaCall('k5_agenda_get_proposal', { proposalId: initialProposalId }).then(({ proposal }) => { if (!cancelled) select(proposal); })
      .catch(() => { if (!cancelled) setError('Sugestão indisponível.'); });
    return () => { cancelled = true; };
  }, [initialProposalId]);
  useEffect(() => {
    if (mode !== 'update' || !selected) return;
    let cancelled = false;
    const timer = setTimeout(() => { agendaCall('k5_agenda_list_activities', { query: search, limit: 100, offset: 0 }).then(({ activities }) => { if (!cancelled) setTargets(activities); }).catch(() => { if (!cancelled) setError('Não foi possível buscar atividades.'); }); }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, selected, search]);
  function select(proposal: AgendaProposal) { setSelected(proposal); setMode(modeOf(proposal)); setTargetId(proposal.payload.activityId ?? ''); setError(''); }
  async function interpret() {
    setBusy(true); setError('');
    try {
      const { proposal } = await agendaCall('k5_agenda_interpret', { message, timeZone, idempotencyKey: crypto.randomUUID() });
      onDescribingChange(false); setMessage(''); select(proposal); setRevision(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível preparar a sugestão.'); }
    finally { setBusy(false); }
  }
  async function review() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const base = mode === 'update' ? (await agendaCall('k5_agenda_get_activity', { activityId: targetId })).activity : blank;
      if (mode === 'update' && selected.payload.activityId === base.id && selected.payload.version !== base.version) throw new Error('A atividade mudou desde a sugestão. Descreva novamente a alteração desejada.');
      // A different target must not inherit another activity's notes, links or schedule.
      const suggestion = mode === 'update' && selected.payload.activityId !== base.id
        ? (selected.operation === 'complete' ? { status: 'completed' as const } : selected.operation === 'cancel' ? { status: 'cancelled' as const } : {})
        : selected.payload;
      setSeed({ ...base, ...suggestion, id: base.id, version: base.version });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Selecione a atividade.'); }
    finally { setBusy(false); }
  }
  const when = (proposal: AgendaProposal) => proposal.payload.startsAt ? clockTime(proposal.payload.startsAt) : proposal.payload.dueOn ? dayMonth(proposal.payload.dueOn) : undefined;

  return <>
    {proposals.length > 0 && <section aria-label="Sugestões do Lume" className="flex flex-col gap-0.5">
      {proposals.map(proposal => <CanvasRow key={proposal.id} stacked icon={<LumeMark className="text-foreground" />} title={proposal.payload.title || proposal.message}
        detail={proposal.payload.title && proposal.payload.title !== proposal.message ? `Sugestão do Lume · ${proposal.message}` : 'Sugestão do Lume · revise antes de salvar'} meta={when(proposal)} status="precisa de você" onClick={() => select(proposal)}
        label={`Revisar sugestão: ${proposal.payload.title || proposal.message}`} className="bg-brand-soft hover:bg-brand/20" />)}
    </section>}
    {error && !selected && !describing && <p role="alert" className="text-[13px] text-destructive">{error}</p>}

    <Dialog open={describing} onOpenChange={open => { if (!busy) { onDescribingChange(open); setError(''); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Descrever ao Lume</DialogTitle><DialogDescription>O Lume prepara a tarefa ou a reunião, e nada é salvo antes da sua revisão.</DialogDescription></DialogHeader>
        <form id={`${id}-describe`} onSubmit={event => { event.preventDefault(); void interpret(); }} className="grid gap-1.5">
          <Label htmlFor={`${id}-message`}>O que você deseja organizar?</Label>
          <Textarea id={`${id}-message`} value={message} onChange={event => setMessage(event.target.value)} minLength={2} maxLength={4000} required rows={4} placeholder="Ex.: reunião amanhã das 9h às 10h para revisar o contrato." />
          {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onDescribingChange(false)}>Cancelar</Button>
          <Button type="submit" form={`${id}-describe`} disabled={busy || !timeZone}>{busy ? 'Preparando…' : 'Preparar sugestão'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(selected) && !seed} onOpenChange={open => { if (!open && !busy) { setSelected(null); setError(''); } }}>
      <DialogContent>
        {selected && <>
          <DialogHeader><DialogTitle>Revisão da sugestão</DialogTitle><DialogDescription className="break-words">{selected.message}</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            {selected.questions.length > 0 && <ul className="grid gap-1 text-[13.5px] text-muted-foreground">{selected.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
            <div className="grid gap-1.5"><Label htmlFor={`${id}-operation`}>Operação</Label><select id={`${id}-operation`} className={selectStyle} value={mode} onChange={event => setMode(event.target.value as 'create' | 'update')}><option value="create">Criar atividade</option><option value="update">Alterar atividade existente</option></select></div>
            {mode === 'update' && <>
              <div className="grid gap-1.5"><Label htmlFor={`${id}-target-search`}>Buscar atividade</Label><Input id={`${id}-target-search`} value={search} onChange={event => setSearch(event.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor={`${id}-target`}>Atividade que será alterada</Label><select id={`${id}-target`} className={selectStyle} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Selecione</option>{targetId && !targets.some(target => target.id === targetId) && <option value={targetId}>{selected.payload.title || 'Atividade sugerida'}</option>}{targets.map(target => <option key={target.id} value={target.id}>{target.title} · {target.dueOn || target.startsAt || 'Sem data'}</option>)}</select>
                <p className="text-xs text-muted-foreground">Até 100 resultados; refine a busca para localizar outra atividade.</p></div>
            </>}
            {busy && <p role="status" className="text-[13px] text-muted-foreground">Preparando…</p>}
            {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>Fechar</Button>
            <Button disabled={busy || (mode === 'update' && !targetId) || selected.status === 'applied'} onClick={() => void review()}>Revisar campos</Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>

    {seed && selected && <AgendaEditor mode="activity" activity={seed} cases={cases} clients={clients} members={members} day={day} caseId="" clientId="" timeZone={timeZone}
      close={() => setSeed(null)} saved={() => { setSeed(null); setSelected(null); setRevision(value => value + 1); refreshed(); }}
      onConfirm={payload => agendaCall('k5_agenda_apply_proposal', { proposalId: selected.id, version: selected.version, payload, ...(mode === 'update' ? { activityId: seed.id, activityVersion: seed.version } : {}) })} />}
  </>;
}
