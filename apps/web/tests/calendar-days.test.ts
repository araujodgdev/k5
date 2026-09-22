import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDays } from '../src/lib/calendar-days';
import type { AgendaActivity } from '../src/lib/capabilities/agenda';

function activity(overrides: Partial<AgendaActivity>): AgendaActivity {
  return { id: 'test', kind: 'task', title: 'Atividade', status: 'pending', notes: '', dueOn: null, startsAt: null, endsAt: null, caseId: null, clientId: null, assigneeId: null, version: 1, createdAt: '', updatedAt: '', ...overrides };
}

test('calendar markers combine tasks and overlapping meetings without marking an exclusive midnight end', () => {
  const marks = calendarDays('2026-09', [
    activity({ dueOn: '2026-09-22' }),
    activity({ dueOn: null }),
    activity({ dueOn: '2026-10-01' }),
    activity({ kind: 'meeting', startsAt: new Date(2026, 8, 21, 23).toISOString(), endsAt: new Date(2026, 8, 23).toISOString() }),
  ]);
  assert.deepEqual(marks, { '2026-09-21': 1, '2026-09-22': 2 });
});

test('calendar markers clip meetings crossing month boundaries and handle leap days', () => {
  const marks = calendarDays('2024-02', [
    activity({ kind: 'meeting', startsAt: new Date(2024, 0, 31, 23).toISOString(), endsAt: new Date(2024, 1, 1, 1).toISOString() }),
    activity({ kind: 'meeting', startsAt: new Date(2024, 1, 29, 23).toISOString(), endsAt: new Date(2024, 2, 1, 1).toISOString() }),
  ]);
  assert.deepEqual(marks, { '2024-02-01': 1, '2024-02-29': 1 });
  assert.deepEqual(calendarDays('2026-09', []), {});
});
