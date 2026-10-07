import assert from 'node:assert/strict';
import test from 'node:test';
import { initialTabs, parseStoredTabs, subjectOf, tabOf, tabsReducer, titleOf, visibleTabs, type TabsAction, type TabsState } from '../src/components/shell/canvas-tabs';

const run = (actions: TabsAction[], from: TabsState = initialTabs) => actions.reduce(tabsReducer, from);
const caseHref = '/app/vault/cases/c1';
const caseSubject = { kind: 'case' as const, caseId: 'c1', title: 'Silva vs. Construtora' };

test('a view that describes itself before its route arrives keeps its title and subject', () => {
  const describeFirst = run([
    { type: 'describe', href: caseHref, title: 'Silva vs. Construtora', subject: caseSubject },
    { type: 'arrive', href: caseHref },
    { type: 'restore', tabs: [] },
  ]);
  const arriveFirst = run([
    { type: 'arrive', href: caseHref },
    { type: 'restore', tabs: [] },
    { type: 'describe', href: caseHref, title: 'Silva vs. Construtora', subject: caseSubject },
  ]);
  for (const state of [describeFirst, arriveFirst]) {
    const tabs = visibleTabs(state, caseHref);
    assert.deepEqual(tabs.map(tabOf), ['inicio', 'case:c1']);
    assert.equal(titleOf(tabs[1]), 'Silva vs. Construtora');
    assert.deepEqual(subjectOf(tabs[1]), caseSubject);
  }
});

test('a description lasts only while its tab shows the same page', () => {
  const state = run([
    { type: 'arrive', href: '/app/agenda?view=tasks' },
    { type: 'describe', href: '/app/agenda', title: 'Tarefas da semana', subject: { kind: 'module', slug: 'agenda', title: 'Tarefas da semana' } },
    { type: 'arrive', href: '/app/agenda?view=calendar' },
  ]);
  const agenda = state.tabs.find((tab) => tabOf(tab) === 'agenda')!;
  assert.equal(agenda.href, '/app/agenda?view=calendar');
  assert.equal(titleOf(agenda), 'Tarefas da semana');
  const moved = run([{ type: 'arrive', href: '/app/agenda/tasks/t1' }], state);
  assert.equal(titleOf(moved.tabs.find((tab) => tabOf(tab) === 'agenda')!), 'Tarefa');
});

test('closing keeps Início and the saved tabs come back behind it', () => {
  const state = run([{ type: 'arrive', href: caseHref }, { type: 'arrive', href: '/app/honorarios' }, { type: 'close', tab: 'inicio' }, { type: 'close', tab: 'honorarios' }]);
  assert.deepEqual(state.tabs.map(tabOf), ['inicio', 'case:c1']);
  const restored = run([{ type: 'arrive', href: '/app/research' }, { type: 'restore', tabs: parseStoredTabs(JSON.stringify(state.tabs)) }]);
  assert.deepEqual(restored.tabs.map(tabOf), ['inicio', 'case:c1', 'research']);
  assert.deepEqual(parseStoredTabs(JSON.stringify([{ href: 'https://example.com/app' }, { href: '//evil/app' }])), []);
});

test('the Lume route belongs to the panel and never opens a canvas tab', () => {
  const state = run([
    { type: 'arrive', href: '/app/agents?conversationId=x' },
    { type: 'describe', href: '/app/agents', title: 'Lume', subject: { kind: 'module', slug: 'agents', title: 'Lume' } },
    { type: 'restore', tabs: parseStoredTabs(JSON.stringify([{ href: '/app/agents' }, { href: '/app/research' }])) },
    { type: 'arrive', href: '/app/command-center' },
  ]);
  assert.deepEqual(state.tabs.map(tabOf), ['inicio', 'research']);
});
