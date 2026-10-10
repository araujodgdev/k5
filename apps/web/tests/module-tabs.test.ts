import assert from 'node:assert/strict';
import test from 'node:test';
import { EXTRA_TAB, followModules, initialFollow, moduleOf, modulePlaces, moduleTabs, type ModuleFollow } from '../src/components/shell/module-tabs';
import { resourceKey, type CanvasResource } from '../src/lib/lume-workspace';

const home: CanvasResource = { kind: 'module', slug: 'command-center', href: '/app/command-center', title: 'Início' };
const vault: CanvasResource = { kind: 'module', slug: 'vault', href: '/app/vault', title: 'Cofre' };
const caseA: CanvasResource = { kind: 'case', caseId: 'a', folderId: null, href: '/app/vault/cases/a', title: 'Caso A' };
const caseB: CanvasResource = { kind: 'case', caseId: 'b', folderId: null, href: '/app/vault/cases/b', title: 'Caso B' };
const caseC: CanvasResource = { kind: 'case', caseId: 'c', folderId: null, href: '/app/vault/cases/c', title: 'Caso C' };
const tasks: CanvasResource = { kind: 'module', slug: 'agenda', href: '/app/agenda?view=tasks', title: 'Tarefas' };

/** Applies each step as the shell does: follow, then close what went stale. */
function run(steps: { tabs: CanvasResource[]; current: CanvasResource | null }[]) {
  let follow: ModuleFollow = initialFollow;
  let tabs: CanvasResource[] = [];
  for (const step of steps) {
    const result = followModules(follow, step.tabs, step.current);
    follow = result.follow;
    tabs = step.tabs.filter(tab => !result.stale.includes(tab));
  }
  return { follow, tabs };
}

test('each route belongs to one module tab', () => {
  assert.equal(moduleOf('/app/command-center'), 'inicio');
  assert.equal(moduleOf('/app/vault/cases/a?folder=f'), 'vault');
  assert.equal(moduleOf('/app/vault/files/x'), 'vault');
  assert.equal(moduleOf('/app/documents/d1'), 'vault');
  assert.equal(moduleOf('/app/agenda/clients/c1'), 'agenda');
  assert.equal(moduleOf('/app/research/judgments/j'), 'research');
  for (const href of ['/app/profile', '/app/admin/ai', '/app/tutorial', '/app/billing', '/app/integrations', '/app/agents/settings']) assert.equal(moduleOf(href), EXTRA_TAB, href);
});

test('the modules follow the navigation order and the office flags', () => {
  const ids = (whatsappEnabled: boolean) => moduleTabs({ whatsappEnabled, adsEnabled: false, platformAdmin: false }).map(tab => tab.id);
  assert.deepEqual(ids(false), ['inicio', 'vault', 'research', 'agenda', 'honorarios', 'calc', 'email', 'messages']);
  assert.ok(ids(true).includes('whatsapp'));
  assert.equal(moduleTabs({ whatsappEnabled: false, adsEnabled: false, platformAdmin: false })[1].title, 'Casos');
});

test('a module tab shows its latest place and keeps the few before it mounted', () => {
  const { follow, tabs } = run([
    { tabs: [home], current: home },
    { tabs: [home, vault], current: vault },
    { tabs: [home, vault, caseA], current: caseA },
    { tabs: [home, vault, caseA, caseB], current: caseB },
  ]);
  assert.equal(modulePlaces(follow).vault, resourceKey(caseB));
  assert.equal(modulePlaces(follow).inicio, resourceKey(home));
  assert.deepEqual(tabs, [home, vault, caseA, caseB]);
  const more = run([
    { tabs: [home, vault], current: vault },
    { tabs: [home, vault, caseA], current: caseA },
    { tabs: [home, vault, caseA, caseB], current: caseB },
    { tabs: [home, vault, caseA, caseB, caseC], current: caseC },
  ]);
  assert.deepEqual(more.tabs, [home, caseA, caseB, caseC]);
});

test('returning to an earlier place brings it to the front of its module', () => {
  const { follow, tabs } = run([
    { tabs: [home, vault, caseA], current: caseA },
    { tabs: [home, vault, caseA, caseB], current: caseB },
    { tabs: [home, vault, caseA, caseB], current: caseA },
    { tabs: [home, vault, caseA, caseB, caseC], current: caseC },
  ]);
  assert.deepEqual(follow.recent.vault, [resourceKey(caseC), resourceKey(caseA), resourceKey(caseB)]);
  assert.deepEqual(tabs, [home, caseA, caseB, caseC]);
});

test('a place the Lume opens behind the person takes its tab without closing the one on screen', () => {
  const { follow, tabs } = run([
    { tabs: [home, caseA], current: caseA },
    { tabs: [home, caseA, caseB], current: caseA },
  ]);
  assert.equal(modulePlaces(follow).vault, resourceKey(caseB));
  assert.deepEqual(tabs, [home, caseA, caseB]);
});

test('each view of a module is its own place', () => {
  const calendar = { ...tasks, href: '/app/agenda?view=calendar', title: 'Agenda' };
  const clients = { ...tasks, href: '/app/agenda?view=clients', title: 'Clientes' };
  const board = { ...tasks, href: '/app/agenda?view=board', title: 'Quadro' };
  assert.notEqual(resourceKey(tasks), resourceKey(calendar));
  const { follow, tabs } = run([
    { tabs: [home, tasks], current: tasks },
    { tabs: [home, tasks, calendar], current: calendar },
    { tabs: [home, tasks, calendar, clients], current: clients },
    { tabs: [home, tasks, calendar, clients, board], current: board },
  ]);
  assert.equal(modulePlaces(follow).agenda, resourceKey(board));
  assert.deepEqual(tabs, [home, calendar, clients, board]);
});

test('a view that changes an address detail keeps its place', () => {
  const filtered = { ...tasks, href: '/app/agenda?view=tasks&q=prazo' };
  const { follow } = run([
    { tabs: [home, tasks], current: tasks },
    { tabs: [home, filtered], current: filtered },
  ]);
  assert.equal(modulePlaces(follow).agenda, resourceKey(filtered));
  assert.equal(follow.seen.get(resourceKey(filtered)), '/app/agenda?view=tasks&q=prazo');
});

test('a revoked place leaves its module on the module start', () => {
  const { follow } = run([
    { tabs: [home, caseA], current: caseA },
    { tabs: [home], current: home },
  ]);
  assert.equal(modulePlaces(follow).vault, undefined);
});
