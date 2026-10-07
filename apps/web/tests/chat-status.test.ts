import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, platformCapabilities, publishedCapabilities, type Capability } from '../src/lib/capabilities/contracts';
import { toolModule, toolStatus } from '../src/lib/chat-status';

test('chat status: every tool the agent can call says where it is working', () => {
  const names = new Set(publishedCapabilities('agent'));
  const unnamed = [...names].filter(name => toolStatus(name, (capabilities[name] as Capability).effect) === 'Trabalhando…');
  assert.deepEqual(unnamed, [], 'a new group of tools needs a place in chat-status.ts');
});

test('chat status: every tool resolves to its capability module without loading the catalog', () => {
  const callable: Array<[string, Capability]> = [
    ...publishedCapabilities('agent').map(name => [name, capabilities[name] as Capability] as [string, Capability]),
    ...Object.entries(platformCapabilities as Record<string, Capability>),
  ];
  const wrong = callable.filter(([name, capability]) => toolModule(name) !== capability.module)
    .map(([name, capability]) => `${name}: ${toolModule(name)} != ${capability.module}`);
  assert.deepEqual(wrong, [], 'a new prefix needs its module in chat-status.ts');
  assert.equal(toolModule('web_search'), 'web');
  assert.equal(toolModule('updateWorkingMemory'), 'memory');
  assert.equal(toolModule('k5_tools_select_modules'), null);
});

test('chat status: reading consults, writing updates, and a few actions have their own words', () => {
  assert.equal(toolStatus('k5_vault_list_cases', 'read'), 'Consultando o Cofre…');
  assert.equal(toolStatus('k5_vault_delete_case', 'write'), 'Atualizando o Cofre…');
  assert.equal(toolStatus('k5_calc_list', 'read'), 'Consultando os cálculos…');
  assert.equal(toolStatus('k5_calc_save', 'write'), 'Atualizando os cálculos…');
  assert.equal(toolStatus('k5_artifacts_create', 'write'), 'Redigindo o documento…');
  assert.equal(toolStatus('web_search', undefined), 'Pesquisando na web…');
});

test('chat status: a status line names the module it works in', async () => {
  const { statusModule } = await import('../src/lib/chat-status');
  assert.equal(statusModule('Consultando o Cofre…'), 'vault');
  assert.equal(statusModule('Atualizando os documentos do Cofre…'), 'knowledge');
  assert.equal(statusModule('Pesquisando na web…'), 'web');
  assert.equal(statusModule('Redigindo o documento…'), 'artifacts');
  assert.equal(statusModule('Pensando…'), null);
});
