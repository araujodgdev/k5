import { testDb } from './test-setup';
import { fixtureSession } from './session-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { agentTools, runCapability, type ApprovalRequest } from '../src/lib/agent-tools';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { createVaultFolder, findVaultFolder } from '../src/lib/vault';
import { approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decideAgentApproval, describeAgentApproval, resourceHref } from '../src/lib/application/agent-approvals';
import { takeApproval, toolOutcome, type ToolOutcome } from '../src/lib/chat-tool-outcome';
import type { WorkspaceContext } from '../src/lib/application/context';
import { conversation, saveMessages } from '../src/lib/ai-store';

async function office() {
  const officeId = randomUUID(); const userId = randomUUID(); const caseId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Divórcio', userId);
  const context: WorkspaceContext = { officeId, userId,sessionId:await fixtureSession(userId) };
  return { context, caseId, agent: { ...context, invocation: 'agent' as const } };
}

async function proposal(promise: Promise<unknown>) {
  try { await promise; } catch (error) {
    assert.ok(error instanceof CapabilityError); assert.equal(error.code, 'APPROVAL_REQUIRED');
    const id = approvalIdFromMessage(error.message); assert.ok(id, 'the refusal names the proposal'); return id;
  }
  assert.fail('expected the action to wait for confirmation');
}

async function chatWithApproval(context: WorkspaceContext, approvalId: string) {
  const { conversation } = await runCapability(context, 'k5_conversations_create', { title: 'Organizar pastas' }) as { conversation: { id: string } };
  const messages = [{ id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: 'Posso remover a pasta.' },
    { type: 'data-approval', id: approvalId, data: { approvalId, capability: 'k5_vault_delete_folder', summary: 'Remover a pasta', state: 'pending' } }] }];
  await testDb.prepare('UPDATE ai_conversation SET messages=? WHERE id=?').run(JSON.stringify(messages), conversation.id);
  return conversation.id;
}

test('agent autonomy: low-impact writes run at once, with a link to the result', async () => {
  const { agent, caseId } = await office();
  const { activity } = await runCapability(agent, 'k5_agenda_create_activity', { kind: 'task', title: 'Revisar a procuração', dueOn: '2026-09-24' }) as { activity: { id: string; title: string } };
  assert.equal(activity.title, 'Revisar a procuração');
  assert.equal(resourceHref('k5_agenda_create_activity', { activity }), `/app/agenda?activityId=${activity.id}`);
  const { folder } = await runCapability(agent, 'k5_vault_create_folder', { caseId, name: 'Anexos' }) as { folder: { id: string } };
  assert.ok(await findVaultFolder(agent.officeId, folder.id, null), 'creating a folder needs no confirmation');
});

test('agent approvals: deleting waits for Confirmar in the chat, then runs exactly what was proposed', async () => {
  const { context, agent, caseId } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Rascunhos');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: folder.id }));
  assert.ok(await findVaultFolder(context.officeId, folder.id, null), 'nothing is removed before the person confirms');
  assert.equal(await describeAgentApproval(context, 'k5_vault_delete_folder', { folderId: folder.id }), 'Remover a pasta “Rascunhos” (o conteúdo sobe um nível)');

  const conversationId = await chatWithApproval(context, approvalId);
  const decided = await decideAgentApproval(context, approvalId, 'confirm');
  assert.equal(decided.state, 'confirmed');
  assert.equal(await findVaultFolder(context.officeId, folder.id, null), undefined);
  const stored = await conversation(testDb, context, conversationId);
  const part = stored!.messages[0].parts[1];
  assert.ok(part.type === 'data-approval');
  assert.equal((part.data as { state: string }).state, 'confirmed', 'the button does not come back after a reload');
  assert.equal((await decideAgentApproval(context, approvalId, 'confirm')).state,'confirmed');
  assert.equal(await findVaultFolder(context.officeId, folder.id, null), undefined);
});

test('agent approvals: gated calls in the agent stream become a Confirmar each, paired by call', async () => {
  const { context, agent, caseId } = await office();
  const drafts = await createVaultFolder(context.officeId, context.userId, caseId, 'Rascunhos');
  const evidence = await createVaultFolder(context.officeId, context.userId, caseId, 'Provas');
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const call = (toolCallId: string, folderId: string) => ({ type: 'tool-call', toolCallId, toolName: 'k5_vault_delete_folder', input: JSON.stringify({ folderId }) });
  const turns: Array<Array<Record<string, unknown>>> = [
    [{ type: 'stream-start', warnings: [] }, call('call-drafts', drafts.id), call('call-evidence', evidence.id), call('call-missing', randomUUID()),
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }],
    [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Confirme abaixo.' }, { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }],
  ];
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: turns.shift() ?? [] }) }) as never });
  const pending: ApprovalRequest[] = [];
  const tises = new Agent({ id: 'k5', name: 'Lume', instructions: 'Teste.', model, tools: agentTools(agent, request => pending.push(request)) } as ConstructorParameters<typeof Agent>[0]);
  new Mastra({ agents: { k5: tises }, logger: noopLogger });

  const outcomes: ToolOutcome[] = [];
  for await (const chunk of (await tises.stream('Apague as pastas Rascunhos e Provas.', { maxSteps: 3 })).fullStream) {
    const outcome = toolOutcome(chunk);
    if (outcome) outcomes.push(outcome);
  }
  const byCall = new Map(outcomes.map(outcome => [outcome.callId, outcome]));
  assert.deepEqual([...byCall.keys()].sort(), ['call-drafts', 'call-evidence', 'call-missing']);
  assert.ok(outcomes.every(outcome => outcome.failed));

  const missing = takeApproval(pending, byCall.get('call-missing')!);
  assert.equal(missing, undefined, 'an ordinary failure is a failed step, not a confirmation');
  const evidenceRequest = takeApproval(pending, byCall.get('call-evidence')!);
  const draftsRequest = takeApproval(pending, byCall.get('call-drafts')!);
  assert.equal(evidenceRequest?.input.folderId, evidence.id);
  assert.equal(draftsRequest?.input.folderId, drafts.id);
  assert.equal(pending.length, 0);
  assert.ok(await findVaultFolder(context.officeId, drafts.id, null), 'nothing is removed before the person confirms');

  assert.equal((await decideAgentApproval(context, draftsRequest!.approvalId, 'confirm')).state, 'confirmed');
  assert.equal(await findVaultFolder(context.officeId, drafts.id, null), undefined);
  assert.ok(await findVaultFolder(context.officeId, evidence.id, null), 'confirming one card runs only its own call');
});

test('agent approvals: cancel changes nothing, and a proposal cannot be reused for another target', async () => {
  const { context, agent, caseId } = await office();
  const kept = await createVaultFolder(context.officeId, context.userId, caseId, 'Provas');
  const cancelled = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: kept.id }));
  assert.deepEqual(await decideAgentApproval(context, cancelled, 'cancel'), { state: 'cancelled', result: 'Cancelado. Nada foi alterado.' });
  assert.ok(await findVaultFolder(context.officeId, kept.id, null));

  const other = await createVaultFolder(context.officeId, context.userId, caseId, 'Outra');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: kept.id }));
  await testDb.prepare("UPDATE capability_approval SET status='approved' WHERE id=?").run(approvalId);
  await assert.rejects(runCapability(agent, 'k5_vault_delete_folder', { folderId: other.id, approvalId }), { code: 'FORBIDDEN' });
  assert.ok(await findVaultFolder(context.officeId, other.id, null));
});

test('approval decisions survive a chat turn saving its older pending messages', async () => {
  const { context, agent, caseId } = await office();
  for (const decision of ['confirm', 'cancel'] as const) {
    const folder = await createVaultFolder(context.officeId, context.userId, caseId, decision);
    const id = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: folder.id }));
    const conversationId = await chatWithApproval(context, id);
    const before = await conversation(testDb, context, conversationId);
    assert.ok(before);
    const result = await decideAgentApproval(context, id, decision);
    await saveMessages(testDb, context, conversationId, before.messages);
    const after = await conversation(testDb, context, conversationId);
    const part = after?.messages[0].parts.find(part => part.type === 'data-approval');
    assert.ok(part && part.type === 'data-approval');
    assert.equal((part.data as { state: string }).state, result.state);
  }
});

test('approval decided during streaming survives the first save of its message', async () => {
  const { context, agent, caseId } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Manter');
  const id = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: folder.id }));
  await decideAgentApproval(context, id, 'cancel');
  const conversationId = await chatWithApproval(context, id);
  const stored = await conversation(testDb, context, conversationId);
  const part = stored?.messages[0].parts.find(part => part.type === 'data-approval');
  assert.ok(part && part.type === 'data-approval');
  assert.equal((part.data as { state: string }).state, 'cancelled');
});

test('legacy completed messages keep their known outcome when no separate result was stored', async () => {
  const { context, agent, caseId } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Antiga');
  const id = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: folder.id }));
  const conversationId = await chatWithApproval(context, id);
  const result = await decideAgentApproval(context, id, 'confirm');
  const stored = await conversation(testDb, context, conversationId);
  assert.ok(stored);
  await saveMessages(testDb, context, conversationId, stored.messages);
  await testDb.prepare('UPDATE capability_approval SET chat_result=NULL WHERE id=?').run(id);
  const restored = await conversation(testDb, context, conversationId);
  const part = restored?.messages[0].parts.find(part => part.type === 'data-approval');
  assert.ok(part && part.type === 'data-approval');
  assert.equal((part.data as { state: string }).state, result.state);
});

test('agent approvals: the interface is not gated, and other people cannot decide', async () => {
  const { context, caseId, agent } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Temporária');
  await runCapability(context, 'k5_vault_delete_folder', { folderId: folder.id });
  assert.equal(await findVaultFolder(context.officeId, folder.id, null), undefined, 'a click in the interface is already a confirmation');

  const second = await createVaultFolder(context.officeId, context.userId, caseId, 'Segunda');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: second.id }));
  const stranger = await office();
  await assert.rejects(decideAgentApproval(stranger.context, approvalId, 'confirm'), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(stranger.agent, 'k5_vault_delete_folder', { folderId: second.id }), { code: 'NOT_FOUND' });
});

test('agent approvals: only gated actions can be confirmed from the chat', async () => {
  const { context } = await office();
  await testDb.prepare(`INSERT INTO capability_approval (id, office_id, user_id, capability_name, normalized_input, status, expires_at) VALUES (?,?,?,?,?,'pending',?)`)
    .run(randomUUID(), context.officeId, context.userId, 'k5_session_end_global', '{}', Date.now() + 60_000);
  const row = await testDb.prepare("SELECT id FROM capability_approval WHERE office_id=? AND capability_name='k5_session_end_global'").get<{ id: string }>(context.officeId);
  await assert.rejects(decideAgentApproval(context, row!.id, 'confirm'), { code: 'FORBIDDEN' });
});
