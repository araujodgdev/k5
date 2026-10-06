import { useMemo, useRef, useState } from 'react';
import { agendaCall } from '@/lib/agenda-client';
import type { AgendaActivity } from '@/lib/capabilities/agenda';

export type TaskStatus = AgendaActivity['status'];

export const taskColumns = [
  { status: 'pending', title: 'A fazer' },
  { status: 'in_progress', title: 'Em andamento' },
  { status: 'completed', title: 'Concluídas' },
  { status: 'cancelled', title: 'Canceladas' },
] as const;

type Pending = { phase: 'saving'; status: TaskStatus } | { phase: 'refreshing' };
type Moves = { pending: ReadonlyMap<string, Pending>; acks: ReadonlyMap<string, AgendaActivity> };

const none: Moves = { pending: new Map(), acks: new Map() };
const newest = (row: AgendaActivity, ack: AgendaActivity | undefined) => ack && ack.version > row.version ? ack : row;
function put<V>(map: ReadonlyMap<string, V>, id: string, value: V | null) {
  const next = new Map(map);
  if (value) next.set(id, value); else next.delete(id);
  return next;
}

export function useTaskMoves(snapshot: AgendaActivity[]) {
  const [moves, setMoves] = useState(none);
  const [failure, setFailure] = useState('');
  const latest = useRef(none);

  function commit(next: Moves) { latest.current = next; setMoves(next); }

  async function save(row: AgendaActivity, status: TaskStatus) {
    try {
      const { activity } = await agendaCall('k5_agenda_update_activity', { activityId: row.id, version: row.version, status, idempotencyKey: crypto.randomUUID() });
      commit({ pending: put(latest.current.pending, row.id, null), acks: put(latest.current.acks, row.id, activity) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setFailure(`Não foi possível mover “${row.title}” para ${taskColumns.find(column => column.status === status)?.title}. ${reason}`.trim());
      commit({ pending: put(latest.current.pending, row.id, { phase: 'refreshing' }), acks: latest.current.acks });
      const fresh = await agendaCall('k5_agenda_get_activity', { activityId: row.id }).then(result => result.activity, () => null);
      commit({ pending: put(latest.current.pending, row.id, null), acks: fresh ? put(latest.current.acks, row.id, fresh) : latest.current.acks });
    }
  }

  function move(id: string, status: TaskStatus) {
    const row = snapshot.find(item => item.id === id);
    const { pending, acks } = latest.current;
    if (!row || pending.has(id)) return;
    const current = newest(row, acks.get(id));
    if (current.status === status) return;
    setFailure('');
    commit({ pending: put(pending, id, { phase: 'saving', status }), acks });
    void save(current, status);
  }

  const activities = useMemo(() => snapshot.map(row => {
    const current = newest(row, moves.acks.get(row.id));
    const pending = moves.pending.get(row.id);
    return pending?.phase === 'saving' ? { ...current, status: pending.status } : current;
  }), [snapshot, moves]);
  const saving = useMemo(() => new Set(moves.pending.keys()), [moves.pending]);

  return { activities, saving, failure, move, dismiss: () => setFailure('') };
}
