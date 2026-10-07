import assert from 'node:assert/strict';
import test from 'node:test';
import { dayOf, doneLabel, initials, todayItems, updatedLabel, type JudicialAlert } from '../src/components/inicio/today';
import type { AgendaActivity } from '../src/lib/capabilities/agenda';
import type { HonorarioInstallment } from '../src/lib/honorarios/contracts';

const now = new Date(2026, 9, 6, 10, 30);
const day = dayOf(now);

function activity(overrides: Partial<AgendaActivity>): AgendaActivity {
  return { id: 'a', kind: 'task', title: 'Atividade', status: 'pending', notes: '', dueOn: null, startsAt: null, endsAt: null, caseId: null, clientId: null, assigneeId: null, version: 1, createdAt: '', updatedAt: '', ...overrides };
}

function fee(overrides: Partial<HonorarioInstallment>): HonorarioInstallment {
  return { id: 'f', agreementId: 'g', number: 3, installmentCount: 10, clientId: 'c', clientName: 'Felipe Antunes da Silva', caseId: null, caseName: null, title: 'Honorários', dueOn: '2026-10-07', amountCents: 150000, receivedCents: 0, pendingCents: 150000, status: 'pending', overdue: false, canManage: true, ...overrides };
}

const alert = (overrides: Partial<JudicialAlert>): JudicialAlert => ({ id: 'p', eventKind: 'new_publication', subjectKind: 'publication', subjectId: 's', summary: 'Despacho de citação', installationId: null, caseId: 'k', caseName: 'Execução fiscal', read: false, createdAt: new Date(2026, 9, 6, 9, 12).toISOString(), ...overrides });

test('Hoje puts the urgent items first, then follows the day', () => {
  const items = todayItems({
    tasks: [activity({ id: 'today', title: 'Revisar quadro de credores', dueOn: '2026-10-06', caseId: 'k' }), activity({ id: 'late', title: 'Réplica', dueOn: '2026-10-02' })],
    meetings: [activity({ id: 'meet', kind: 'meeting', title: 'Reunião com Felipe', startsAt: new Date(2026, 9, 6, 15).toISOString(), endsAt: new Date(2026, 9, 6, 16).toISOString() })],
    fees: [fee({}), fee({ id: 'later', dueOn: '2026-10-20' })],
    alerts: [alert({}), alert({ id: 'old', eventKind: 'historical_publication' }), alert({ id: 'seen', read: true })],
  }, day, { k: 'Execução fiscal' });
  assert.deepEqual(items.map((item) => [item.key, item.when, item.urgent]), [
    ['task:late', '02/10', 'Atrasada'],
    ['publication:p', '09:12', 'Nova'],
    ['meeting:meet', '15:00', null],
    ['task:today', 'hoje', null],
    ['fee:f', '07/10', null],
  ]);
  assert.equal(items[3].detail, 'Execução fiscal');
  assert.equal(items[4].title, 'Parcela 3 de 10 vence amanhã');
  assert.match(items[4].detail ?? '', /^Felipe Antunes da Silva · R\$\s1\.500,00$/);
  assert.equal(items[0].href, '/app/agenda/tasks/late');
});

test('a publication without a case and a task without a date stay out of Hoje', () => {
  const items = todayItems({ tasks: [activity({ dueOn: null })], meetings: [], fees: [], alerts: [alert({ caseId: null })] }, day, {});
  assert.deepEqual(items, []);
});

test('times read like the prototype', () => {
  assert.equal(updatedLabel(new Date(2026, 9, 6, 9, 20).toISOString(), now), 'atualizado há 1 h');
  assert.equal(updatedLabel(new Date(2026, 9, 6, 10, 25).toISOString(), now), 'atualizado há 5 min');
  assert.equal(updatedLabel(new Date(2026, 9, 5, 18).toISOString(), now), 'atualizado ontem');
  assert.equal(updatedLabel(new Date(2026, 8, 28).toISOString(), now), 'atualizado em 28/09');
  assert.equal(doneLabel(new Date(2026, 9, 6, 9, 14).toISOString(), now), '09:14');
  assert.equal(doneLabel(new Date(2026, 9, 5, 22).toISOString(), now), 'ontem');
  assert.equal(initials('Helena Mendes da Rocha'), 'HR');
  assert.equal(initials('verificação'), 'VE');
});
