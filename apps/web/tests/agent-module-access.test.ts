import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import { moduleToolSelection } from '../src/lib/agent-tools/selection';
import { ToolReadGuard } from '../src/lib/agent-tools/repetition';
import { capabilities, publishedCapabilitiesForRole } from '../src/lib/capabilities/contracts';
import { helpContent, searchHelp } from '../src/lib/platform-help/search';
import { approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decideAgentApproval, describeAgentApproval } from '../src/lib/application/agent-approvals';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { toolOutcome, type ToolOutcome } from '../src/lib/chat-tool-outcome';
import type { WorkspaceContext } from '../src/lib/application/context';

async function fixture(role: WorkspaceContext['role'] = 'administrator') {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Pessoa');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  return { officeId, userId, role, invocation: 'agent' as const };
}
async function proposal(call: Promise<unknown>) {
  try { await call; } catch (error) {
    assert.ok(error instanceof CapabilityError); assert.equal(error.code, 'APPROVAL_REQUIRED');
    const id = approvalIdFromMessage(error.message); assert.ok(id); return id;
  }
  assert.fail('expected confirmation');
}

test('help uses the versioned public manual, validates semantic IDs and survives unavailable embeddings', async () => {
  const lexical = await searchHelp({ query: 'recebimento honorários' });
  assert.equal(lexical.mode, 'text');
  assert.ok(lexical.sources.some(source => /recebimento/i.test(source.title)));
  const section = helpContent.sections.find(section => /Integrações e Plano/.test(section.title))!;
  assert.ok(section);
  const semantic = await searchHelp({ query: 'mudar plano' }, async (_query, _limit, version) => {
    assert.equal(version, helpContent.version); return ['stale-or-foreign-id', section.id, section.id];
  });
  assert.equal(semantic.mode, 'semantic');
  assert.deepEqual(semantic.sources.map(source => source.text), [section.content]);
  assert.deepEqual(await searchHelp({ query: 'recebimento honorários' }, async () => { throw new Error('offline'); }), lexical);
  assert.deepEqual(await searchHelp({ query: 'recebimento honorários' }, async () => ['old-version-id']), lexical);
});

test('repeated reads compare normalized input, refresh after writes and allow job polling', () => {
  const guard = new ToolReadGuard();
  guard.before('k5_honorarios_list', { query: 'Maria', view: 'pending' }, 'read');
  assert.throws(() => guard.before('k5_honorarios_list', { view: 'pending', query: 'Maria' }, 'read'), { code: 'CONFLICT' });
  guard.before('k5_honorarios_list', { query: 'Maria', view: 'received' }, 'read');
  guard.before('k5_honorarios_receive', {}, 'write');
  guard.before('k5_honorarios_list', { query: 'Maria', view: 'pending' }, 'read');
  guard.before('k5_runs_get', { runId: 'pending' }, 'read');
  guard.before('k5_runs_get', { runId: 'pending' }, 'read');
});

test('module selection exposes the requested authorized tools in the next real agent step', async () => {
  const context = await fixture();
  const tools = agentTools(context);
  const selection = moduleToolSelection(new Set(Object.keys(tools)));
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let step = 0;
  const model = new MockLanguageModelV4({ doStream: async options => {
    const names = options.tools?.map(tool => tool.name) ?? [];
    assert.ok(names.length < 128);
    assert.ok(!names.includes('k5_google_save_policy'));
    if (step === 0) assert.ok(!names.includes('k5_honorarios_options'));
    else assert.ok(names.includes('k5_honorarios_options'));
    const call = step++ === 0
      ? { toolName: 'k5_tools_select_modules', input: JSON.stringify({ modules: ['honorarios'] }) }
      : step === 2 ? { toolName: 'k5_honorarios_options', input: '{}' } : undefined;
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(call ? [{ type: 'tool-call', toolCallId: `call-${step}`, ...call }] : []),
      { type: 'finish', finishReason: { unified: call ? 'tool-calls' : 'stop', raw: call ? 'tool_calls' : 'stop' }, usage },
    ] }) } as never;
  } });
  const agent = new Agent({ id: 'selection', name: 'Teste', instructions: 'Teste.', model, tools: { ...tools, k5_tools_select_modules: selection.tool } } as ConstructorParameters<typeof Agent>[0]);
  new Mastra({ agents: { selection: agent }, logger: noopLogger });
  const result = await agent.stream('Consulte as opções de honorários.', { maxSteps: 4, prepareStep: () => ({ activeTools: selection.activeTools() }) });
  const outcomes: ToolOutcome[] = [];
  for await (const chunk of result.fullStream) { const outcome = toolOutcome(chunk); if (outcome) outcomes.push(outcome); }
  assert.ok(outcomes.some(outcome => outcome.name === 'k5_honorarios_options' && !outcome.failed));
  assert.equal(step, 3);
  const maxModules = Object.values(capabilities).reduce<Record<string, number>>((counts, capability) => { counts[capability.module] = (counts[capability.module] ?? 0) + 1; return counts; }, {});
  assert.ok(Object.values(maxModules).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) + 22 < 128);
  assert.ok(!publishedCapabilitiesForRole('reviewer', 'agent').includes('k5_honorarios_receive'));
});

test('settings wait for confirmation, bind the full edit and enforce office administrator access', async () => {
  const context = await fixture();
  const input = { scope: 'personal', idempotencyKey: randomUUID(), change: { action: 'create_instruction', title: 'Estilo', content: 'Use frases curtas.', appliesTo: 'chat', enabled: true } };
  const id = await proposal(runCapability(context, 'k5_agent_settings_change', input));
  const before = capabilities.k5_agent_settings_get.output.parse(await runCapability(context, 'k5_agent_settings_get', {}));
  assert.equal(before.instructions.personal.length, 0);
  assert.match(await describeAgentApproval(context, 'k5_agent_settings_change', input), /Use frases curtas/);
  assert.equal((await decideAgentApproval(context, id, 'confirm')).state, 'confirmed');
  const after = capabilities.k5_agent_settings_get.output.parse(await runCapability(context, 'k5_agent_settings_get', {}));
  assert.equal(after.instructions.personal[0].content, 'Use frases curtas.');
  const stranger = await fixture();
  assert.equal(capabilities.k5_agent_settings_get.output.parse(await runCapability(stranger, 'k5_agent_settings_get', {})).instructions.personal.length, 0);
  const lawyer = await fixture('lawyer');
  const denied = await proposal(runCapability(lawyer, 'k5_agent_settings_change', { ...input, scope: 'office', idempotencyKey: randomUUID() }));
  assert.equal((await decideAgentApproval(lawyer, denied, 'confirm')).state, 'failed');
});

test('personal message tools send only after confirmation and reject another person reading the thread', async () => {
  const sender = await fixture();
  const peer = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(peer, `${peer}@example.test`, 'Colega');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), sender.officeId, peer, 'lawyer');
  const { thread } = capabilities.k5_messages_start.output.parse(await runCapability(sender, 'k5_messages_start', { requestId: randomUUID(), recipient: { kind: 'known_user', userId: peer } }));
  const input = { threadId: thread.id, clientMessageId: randomUUID(), body: { kind: 'text', text: 'Mensagem de teste local.' } };
  const id = await proposal(runCapability(sender, 'k5_messages_send', input));
  assert.equal(capabilities.k5_messages_read.output.parse(await runCapability(sender, 'k5_messages_read', { threadId: thread.id })).messages.length, 0);
  assert.match(await describeAgentApproval(sender, 'k5_messages_send', input), /Mensagem de teste local/);
  assert.equal((await decideAgentApproval(sender, id, 'confirm')).state, 'confirmed');
  assert.equal(capabilities.k5_messages_read.output.parse(await runCapability(sender, 'k5_messages_read', { threadId: thread.id })).messages.length, 1);
  await assert.rejects(runCapability(await fixture(), 'k5_messages_read', { threadId: thread.id }), { code: 'NOT_FOUND' });
});

test('reviewers can manage their notification preferences without changing another user', async () => {
  const context = await fixture('reviewer');
  const other = await fixture('reviewer');
  const original = await runCapability(other, 'k5_notifications_get_preferences', {});
  const changed = capabilities.k5_notifications_update_preferences.output.parse(await runCapability(context, 'k5_notifications_update_preferences', { categories: { agenda: false } }));
  assert.equal(changed.categories.agenda, false);
  assert.deepEqual(await runCapability(other, 'k5_notifications_get_preferences', {}), original);
  await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(context.officeId, context.userId);
  await assert.rejects(runCapability(context, 'k5_notifications_get_preferences', {}), { code: 'FORBIDDEN' });
});

test('collaboration tools invite, accept and change access through separate confirmations', async () => {
  const owner = await fixture(), peer = await fixture('lawyer');
  const invitation = { change: { action: 'invite', invitation: { kind: 'team', email: `${peer.userId}@example.test`, role: 'lawyer' } } };
  const id = await proposal(runCapability(owner, 'k5_collaboration_change', invitation));
  assert.equal(capabilities.k5_collaboration_get.output.parse(await runCapability(owner, 'k5_collaboration_get', {})).outgoing.length, 0);
  assert.match(await describeAgentApproval(owner, 'k5_collaboration_change', invitation), /como advogado/);
  assert.equal((await decideAgentApproval(owner, id, 'confirm')).state, 'confirmed');
  const incoming = capabilities.k5_collaboration_get.output.parse(await runCapability(peer, 'k5_collaboration_get', {})).incoming;
  assert.equal(incoming.length, 1);
  const accept = await proposal(runCapability(peer, 'k5_collaboration_change', { change: { action: 'respond', id: incoming[0].id, accept: true } }));
  assert.equal((await decideAgentApproval(peer, accept, 'confirm')).state, 'confirmed');
  const change = { change: { action: 'member', userId: peer.userId, role: 'reviewer' } };
  const role = await proposal(runCapability(owner, 'k5_collaboration_change', change));
  assert.match(await describeAgentApproval(owner, 'k5_collaboration_change', change), /Alterar acesso para revisor de Pessoa/);
  assert.equal((await decideAgentApproval(owner, role, 'confirm')).state, 'confirmed');
  const overview = capabilities.k5_collaboration_get.output.parse(await runCapability(owner, 'k5_collaboration_get', {}));
  assert.equal(overview.members.find(member => member.id === peer.userId)?.role, 'reviewer');
  const stranger = await fixture();
  await assert.rejects(describeAgentApproval(owner, 'k5_collaboration_change', { change: { action: 'member', userId: stranger.userId, role: null } }), { code: 'NOT_FOUND' });
});
