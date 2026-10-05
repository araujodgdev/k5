import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, publishedCapabilities, type Capability } from '../src/lib/capabilities/contracts';
import { toolStatus } from '../src/lib/chat-status';

test('chat status: every tool the agent can call says where it is working', () => {
  const names = new Set(publishedCapabilities('agent'));
  const unnamed = [...names].filter(name => toolStatus(name, (capabilities[name] as Capability).effect) === 'Trabalhando…');
  assert.deepEqual(unnamed, [], 'a new group of tools needs a place in chat-status.ts');
});

test('chat status: reading consults, writing updates, and a few actions have their own words', () => {
  assert.equal(toolStatus('k5_vault_list_cases', 'read'), 'Consultando o Cofre…');
  assert.equal(toolStatus('k5_vault_delete_case', 'write'), 'Atualizando o Cofre…');
  assert.equal(toolStatus('k5_calc_list', 'read'), 'Consultando os cálculos…');
  assert.equal(toolStatus('k5_calc_save', 'write'), 'Atualizando os cálculos…');
  assert.equal(toolStatus('k5_artifacts_create', 'write'), 'Redigindo o documento…');
  assert.equal(toolStatus('web_search', undefined), 'Pesquisando na web…');
});
