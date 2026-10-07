import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { runCapability } from '../src/lib/agent-tools';
import { capabilities } from '../src/lib/capabilities/contracts';
import type { WorkspaceContext } from '../src/lib/application/context';

async function office() {
  const officeId = randomUUID(); const userId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  return { officeId, userId } as WorkspaceContext;
}

const open = async (context: WorkspaceContext, input: Record<string, unknown>) =>
  capabilities.k5_ui_open_resource.output.parse(await runCapability(context, 'k5_ui_open_resource', input));

/** A page the Lume wrote, with the run that produced it, as the document worker leaves them. */
async function page(context: WorkspaceContext, title: string) {
  const runId = randomUUID(); const id = randomUUID();
  await testDb.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,status) VALUES(?,?,?,'draft','{}','completed')").run(runId, context.officeId, context.userId);
  await testDb.prepare('INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content) VALUES(?,?,?,?,?,?)').run(id, context.officeId, context.userId, runId, title, 'Texto');
  await testDb.prepare('UPDATE ai_run SET artifact_id=? WHERE id=?').run(id, runId);
  return { id, runId };
}

async function file(context: WorkspaceContext, place: { caseId?: string; folderId?: string }) {
  const id = randomUUID();
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,scope,case_id,folder_id,original_name,stored_name,mime_type,byte_size,sha256,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, context.officeId, place.caseId ? 'case' : 'library', place.caseId ?? null, place.folderId ?? null,
    'laudo.pdf', `${id}.pdf`, 'application/pdf', 10, 'a'.repeat(64), context.userId);
  return id;
}

test('o Lume abre no canvas o caso, a página, o arquivo e o módulo pedidos, com o título da aba', async () => {
  const context = await office();
  const caseId = randomUUID(); const folderId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, context.officeId, 'Silva vs. Construtora', context.userId);
  await testDb.prepare('INSERT INTO vault_folder(id,office_id,case_id,name,created_by) VALUES(?,?,?,?,?)').run(folderId, context.officeId, caseId, 'Provas', context.userId);
  const { id: artifactId } = await page(context, 'Réplica');

  assert.deepEqual(await open(context, { resourceType: 'case', resourceId: caseId }), { path: `/app/vault/cases/${caseId}`, title: 'Silva vs. Construtora' });
  assert.deepEqual(await open(context, { resourceType: 'artifact', resourceId: artifactId }), { path: `/app/documents/${artifactId}`, title: 'Réplica' });
  assert.deepEqual(await open(context, { resourceType: 'document', resourceId: await file(context, { caseId, folderId }) }), { path: `/app/vault/cases/${caseId}?folder=${folderId}` });
  assert.deepEqual(await open(context, { resourceType: 'document', resourceId: await file(context, {}) }), { path: '/app/vault/library' });
  assert.deepEqual(await open(context, { resourceType: 'module', module: 'honorarios' }), { path: '/app/honorarios', title: 'Honorários' });
  assert.deepEqual(await open(context, { resourceType: 'module', module: 'tarefas' }), { path: '/app/agenda?view=tasks', title: 'Tarefas' });
  await assert.rejects(open(context, { resourceType: 'module' }));
});

test('uma tarefa de minuta abre o documento que gerou, e só depois de gerá-lo', async () => {
  const context = await office();
  const { id: artifactId, runId: done } = await page(context, 'Minuta');
  const queued = randomUUID();
  await testDb.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input) VALUES(?,?,?,'draft','{}')").run(queued, context.officeId, context.userId);

  assert.deepEqual(await open(context, { resourceType: 'run', resourceId: done }), { path: `/app/documents/${artifactId}`, title: 'Minuta' });
  await assert.rejects(open(context, { resourceType: 'run', resourceId: queued }), { code: 'INVALID' });
});

test('nada de outro escritório abre: caso, arquivo, página ou tarefa', async () => {
  const owner = await office();
  const stranger = await office();
  const caseId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, owner.officeId, 'Caso alheio', owner.userId);
  const { id: artifactId, runId } = await page(owner, 'Particular');

  await assert.rejects(open(stranger, { resourceType: 'case', resourceId: caseId }), { code: 'NOT_FOUND' });
  await assert.rejects(open(stranger, { resourceType: 'document', resourceId: await file(owner, { caseId }) }), { code: 'NOT_FOUND' });
  await assert.rejects(open(stranger, { resourceType: 'artifact', resourceId: artifactId }), { code: 'NOT_FOUND' });
  await assert.rejects(open(stranger, { resourceType: 'run', resourceId: runId }), { code: 'NOT_FOUND' });
});
