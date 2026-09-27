import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { loadAssignmentSnapshot, pinRunModelPlan, updateModelAssignment } from '../src/lib/ai-assignments-core';
import { processNextRun, RUN_TASKS } from '../src/lib/document-workflows';
import { parseCredentialKeyring } from '../src/lib/platform-crypto';

test('a chronology stops with its reason when the review connection is disabled during the run', async () => {
  const officeId = randomUUID(), userId = randomUUID(), documentId = randomUUID();
  await testDb.prepare('INSERT INTO user (id,email,name) VALUES (?,?,?)').run(userId, `${userId}@example.test`, 'Advogada');
  await testDb.prepare('INSERT INTO office (id,name) VALUES (?,?)').run(officeId, 'Escritório da cronologia');
  await testDb.prepare("INSERT INTO office_member (id,office_id,user_id,role) VALUES (?,?,?,'lawyer')").run(randomUUID(), officeId, userId);
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,'library','contrato.txt',?,'text/plain',60,'hash','ready',?)`).run(documentId, officeId, documentId, userId);
  const chunks = [randomUUID(), randomUUID()];
  for (const [ordinal, chunk] of chunks.entries()) {
    await testDb.prepare("INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,?,?,?)")
      .run(chunk, documentId, officeId, ordinal, `parágrafo:${ordinal + 1}`, `Em 0${ordinal + 1}/03/2026 o contrato foi assinado pela parte ${ordinal + 1}.`);
  }

  // Facts and review on different connections; the review's is the one that goes away.
  const key = parseCredentialKeyring();
  const facts = await createAiConnection(testDb, key, userId, { name: `Fatos ${officeId}`, provider: 'openai', apiKey: 'sk-facts' });
  const review = await createAiConnection(testDb, key, userId, { name: `Revisão ${officeId}`, provider: 'openai', apiKey: 'sk-review' });
  await updateModelAssignment(testDb, userId, { scope: 'task', target: 'extraction.chronology_facts', model: { mode: 'explicit', connectionId: facts.id, modelId: 'gpt-6-luna' }, effort: { mode: 'inherit' } });
  await updateModelAssignment(testDb, userId, { scope: 'task', target: 'extraction.chronology_review', model: { mode: 'explicit', connectionId: review.id, modelId: 'gpt-6-sol' }, effort: { mode: 'inherit' } });
  const plan = pinRunModelPlan(await loadAssignmentSnapshot(testDb), RUN_TASKS.chronology);

  const runId = randomUUID();
  const input = { kind: 'chronology', documentIds: [documentId], instructions: 'Monte a cronologia.', researchReferenceIds: [], approvedCitationIds: [] };
  await testDb.prepare("INSERT INTO ai_run (id,office_id,user_id,kind,input,model_provider,model_id,model_plan) VALUES (?,?,?,'chronology',?,'openai','gpt-6-luna',?)")
    .run(runId, officeId, userId, JSON.stringify(input), JSON.stringify(plan));
  // Extraction already done, so no provider is called before the review.
  for (const [index, chunk] of chunks.entries()) {
    await testDb.prepare('INSERT INTO ai_checkpoint(run_id,step_key,result) VALUES(?,?,?)').run(runId, `extract:${chunk}`, JSON.stringify({
      events: [{ date: `2026-03-0${index + 1}`, description: `Assinatura pela parte ${index + 1}.`, quote: 'o contrato foi assinado' }],
      gaps: [], sourceId: chunk, sourceLabel: `contrato.txt — parágrafo:${index + 1}`,
    }));
  }
  // The run itself reaches 70% right before the review: that is where the connection is disabled.
  await testDb.exec(`CREATE FUNCTION disable_review_connection() RETURNS trigger AS $$ BEGIN
      UPDATE ai_connection SET enabled = 0 WHERE id = '${review.id}'; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER disable_review_connection AFTER UPDATE OF progress ON ai_run FOR EACH ROW WHEN (NEW.progress = 70) EXECUTE FUNCTION disable_review_connection();`);

  assert.equal(await processNextRun(), true);
  const run = await testDb.prepare('SELECT status, error FROM ai_run WHERE id = ?').get<{ status: string; error: string }>(runId);
  assert.equal(run?.status, 'failed');
  assert.match(run?.error ?? '', /conexão de IA fixada para esta tarefa foi desativada/);
  assert.equal(await testDb.prepare('SELECT 1 FROM ai_artifact WHERE run_id = ?').get(runId), undefined, 'no chronology without its review');
});
