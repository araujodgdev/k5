'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { AgendaEditor, agendaCall, selectStyle, type Choice } from './agenda-forms';
import type { AgendaProposal } from '@/lib/typesafe/agenda-contracts';
import type { AgendaActivity } from '@/lib/capabilities/agenda';

export function AgendaSuggestions({ cases, clients, members, day, timeZone, initialProposalId, refreshed }: {
  cases: Choice[]; clients: Choice[]; members: Choice[]; day: string; timeZone: string; initialProposalId: string; refreshed: () => void;
}) {
  const [open, setOpen] = useState(Boolean(initialProposalId));
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
  useEffect(() => {
    let cancelled = false;
    agendaCall('k5_agenda_list_proposals', {}).then(({ proposals }) => { if (!cancelled) setProposals(proposals); }).catch(() => { if (!cancelled) setError('Não foi possível consultar as sugestões.'); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    let cancelled = false;
    if (!initialProposalId) return;
    agendaCall('k5_agenda_get_proposal', { proposalId: initialProposalId }).then(({ proposal }) => {
      if (!cancelled) { setSelected(proposal); setMode(proposal.payload.activityId || ['reschedule', 'complete', 'cancel'].includes(proposal.operation) ? 'update' : 'create'); setTargetId(proposal.payload.activityId ?? ''); }
    }).catch(() => { if (!cancelled) setError('Sugestão indisponível.'); });
    return () => { cancelled = true; };
  }, [initialProposalId]);
  useEffect(() => {
    if (mode !== 'update' || !selected) return;
    let cancelled = false;
    const timer = setTimeout(() => { agendaCall('k5_agenda_list_activities', { query: search, limit: 100, offset: 0 }).then(({ activities }) => { if (!cancelled) setTargets(activities); }).catch(() => { if (!cancelled) setError('Não foi possível buscar atividades.'); }); }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, selected, search]);
  function select(proposal: AgendaProposal) { setSelected(proposal); setMode(proposal.payload.activityId || ['reschedule', 'complete', 'cancel'].includes(proposal.operation) ? 'update' : 'create'); setTargetId(proposal.payload.activityId ?? ''); setError(''); }
  async function interpret() {
    setBusy(true); setError('');
    try { const { proposal } = await agendaCall('k5_agenda_interpret', { message, timeZone, idempotencyKey: crypto.randomUUID() }); select(proposal); setRevision(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível preparar a sugestão.'); }
    finally { setBusy(false); }
  }
  async function review() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const base: AgendaActivity = mode === 'update' ? (await agendaCall('k5_agenda_get_activity', { activityId: targetId })).activity : {
        id: '', version: 1, kind: 'task', title: '', notes: '', status: 'pending', dueOn: null, startsAt: null, endsAt: null, clientId: null, caseId: null, assigneeId: null, createdAt: '', updatedAt: '',
      };
      if (mode === 'update' && selected.payload.activityId === base.id && selected.payload.version !== base.version) throw new Error('A atividade mudou desde a sugestão. Descreva novamente a alteração desejada.');
      // A different target must not inherit another activity's notes, links or schedule.
      const suggestion = mode === 'update' && selected.payload.activityId !== base.id
        ? (selected.operation === 'complete' ? { status: 'completed' as const } : selected.operation === 'cancel' ? { status: 'cancelled' as const } : {})
        : selected.payload;
      setSeed({ ...base, ...suggestion, id: base.id, version: base.version });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Selecione a atividade.'); }
    finally { setBusy(false); }
  }
  return <section className="mb-6 border-b pb-5" aria-label="Sugestões de agenda">
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>Descrever atividade{proposals.length ? ` (${proposals.length} ${proposals.length === 1 ? 'sugestão' : 'sugestões'})` : ''}</Button>
    {open && <div className="mt-4 grid max-w-2xl gap-4">
      <form onSubmit={event => { event.preventDefault(); void interpret(); }} className="grid gap-2"><Label htmlFor="agenda-message">O que você deseja organizar?</Label><Textarea id="agenda-message" value={message} onChange={event => setMessage(event.target.value)} minLength={2} maxLength={4000} required placeholder="Ex.: reunião amanhã das 9h às 10h para revisar o contrato." /><Button className="justify-self-start" disabled={busy || !timeZone}>Preparar sugestão</Button></form>
      {busy && <p role="status" className="text-sm text-muted-foreground">Preparando…</p>}
      {proposals.length > 0 && <div className="divide-y">{proposals.map(proposal => <button key={proposal.id} type="button" className="block min-h-11 w-full break-words py-2 text-left text-sm underline-offset-4 hover:underline focus-visible:ring-2" onClick={() => select(proposal)}>{proposal.message}</button>)}</div>}
      {selected && <div className="grid gap-3 border-t pt-4"><h2 className="text-sm font-medium">Revisão da sugestão</h2><p className="break-words text-sm">{selected.message}</p>{selected.questions.map((question, i) => <p key={i} className="text-sm text-muted-foreground">{question}</p>)}
        <Label htmlFor="agenda-operation">Operação</Label><select id="agenda-operation" className={selectStyle} value={mode} onChange={event => setMode(event.target.value as 'create' | 'update')}><option value="create">Criar atividade</option><option value="update">Alterar atividade existente</option></select>
        {mode === 'update' && <><Label htmlFor="agenda-target-search">Buscar atividade</Label><Input id="agenda-target-search" value={search} onChange={event => setSearch(event.target.value)} /><Label htmlFor="agenda-target">Atividade que será alterada</Label><select id="agenda-target" className={selectStyle} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Selecione</option>{targetId && !targets.some(target => target.id === targetId) && <option value={targetId}>{selected.payload.title || 'Atividade sugerida'}</option>}{targets.map(target => <option key={target.id} value={target.id}>{target.title} · {target.dueOn || target.startsAt || 'Sem data'}</option>)}</select><p className="text-xs text-muted-foreground">Até 100 resultados; refine a busca para localizar outra atividade.</p></>}
        <Button className="justify-self-start" variant="outline" disabled={busy || (mode === 'update' && !targetId) || selected.status === 'applied'} onClick={() => void review()}>Revisar campos</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
    {seed && selected && <AgendaEditor mode="activity" activity={seed} cases={cases} clients={clients} members={members} day={day} caseId="" clientId="" timeZone={timeZone} close={() => setSeed(null)} saved={() => { setSeed(null); setSelected(null); setMessage(''); setRevision(value => value + 1); refreshed(); }} onConfirm={payload => agendaCall('k5_agenda_apply_proposal', { proposalId: selected.id, version: selected.version, payload, ...(mode === 'update' ? { activityId: seed.id, activityVersion: seed.version } : {}) })} />}
  </section>;
}
