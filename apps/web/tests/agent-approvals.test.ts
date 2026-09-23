import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runCapability } from '../src/lib/agent-tools';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { createVaultFolder, findVaultFolder } from '../src/lib/vault';
import { approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decideAgentApproval, describeAgentApproval, resourceHref } from '../src/lib/application/agent-approvals';
import type { WorkspaceContext } from '../src/lib/application/context';

async function office(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID(); const userId = randomUUID(); const caseId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Divórcio', userId);
  const context: WorkspaceContext = { officeId, userId, role };
  return { context, caseId, agent: { ...context, invocation: 'agent' as const } };
}

/** The gate's refusal carries the proposal id the chat turns into a Confirmar button. */
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
  assert.ok(await findVaultFolder(agent.officeId, folder.id), 'creating a folder needs no confirmation');
});

test('agent approvals: deleting waits for Confirmar in the chat, then runs exactly what was proposed', async () => {
  const { context, agent, caseId } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Rascunhos');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: folder.id }));
  assert.ok(await findVaultFolder(context.officeId, folder.id), 'nothing is removed before the person confirms');
  assert.equal(await describeAgentApproval(context, 'k5_vault_delete_folder', { folderId: folder.id }), 'Remover a pasta “Rascunhos” (o conteúdo sobe um nível)');

  const conversationId = await chatWithApproval(context, approvalId);
  const decided = await decideAgentApproval(context, approvalId, 'confirm', conversationId);
  assert.equal(decided.state, 'confirmed');
  assert.equal(await findVaultFolder(context.officeId, folder.id), undefined);
  const stored = await testDb.prepare('SELECT messages FROM ai_conversation WHERE id=?').get<{ messages: string }>(conversationId);
  const part = JSON.parse(stored!.messages)[0].parts[1];
  assert.equal(part.data.state, 'confirmed', 'the button does not come back after a reload');
  await assert.rejects(decideAgentApproval(context, approvalId, 'confirm'), { code: 'CONFLICT' });
});

test('agent approvals: cancel changes nothing, and a proposal cannot be reused for another target', async () => {
  const { context, agent, caseId } = await office();
  const kept = await createVaultFolder(context.officeId, context.userId, caseId, 'Provas');
  const cancelled = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: kept.id }));
  assert.deepEqual(await decideAgentApproval(context, cancelled, 'cancel'), { state: 'cancelled', result: 'Cancelado. Nada foi alterado.' });
  assert.ok(await findVaultFolder(context.officeId, kept.id));

  const other = await createVaultFolder(context.officeId, context.userId, caseId, 'Outra');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: kept.id }));
  await testDb.prepare("UPDATE capability_approval SET status='approved' WHERE id=?").run(approvalId);
  await assert.rejects(runCapability(agent, 'k5_vault_delete_folder', { folderId: other.id, approvalId }), { code: 'FORBIDDEN' });
  assert.ok(await findVaultFolder(context.officeId, other.id));
});

test('agent approvals: the interface is not gated, and other people cannot decide', async () => {
  const { context, caseId, agent } = await office();
  const folder = await createVaultFolder(context.officeId, context.userId, caseId, 'Temporária');
  await runCapability(context, 'k5_vault_delete_folder', { folderId: folder.id });
  assert.equal(await findVaultFolder(context.officeId, folder.id), undefined, 'a click in the interface is already a confirmation');

  const second = await createVaultFolder(context.officeId, context.userId, caseId, 'Segunda');
  const approvalId = await proposal(runCapability(agent, 'k5_vault_delete_folder', { folderId: second.id }));
  const stranger = await office();
  await assert.rejects(decideAgentApproval(stranger.context, approvalId, 'confirm'), { code: 'NOT_FOUND' });
  const reviewer = await office('reviewer');
  await assert.rejects(runCapability(reviewer.agent, 'k5_vault_delete_folder', { folderId: second.id }), { code: 'FORBIDDEN' });
});

test('agent approvals: only gated actions can be confirmed from the chat', async () => {
  const { context } = await office();
  await testDb.prepare(`INSERT INTO capability_approval (id, office_id, user_id, capability_name, normalized_input, status, expires_at) VALUES (?,?,?,?,?,'pending',?)`)
    .run(randomUUID(), context.officeId, context.userId, 'k5_session_end_global', '{}', Date.now() + 60_000);
  const row = await testDb.prepare("SELECT id FROM capability_approval WHERE office_id=? AND capability_name='k5_session_end_global'").get<{ id: string }>(context.officeId);
  await assert.rejects(decideAgentApproval(context, row!.id, 'confirm'), { code: 'FORBIDDEN' });
});
