import { testDb, testDatabase } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { saveConnection, connectionView, removeConnection } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { evaluate, type DecisionTransport, type DecisionRequest } from '../src/lib/typesafe/client';
import { rerank } from '../src/lib/typesafe/rerank';
import { localInstant, temporalCandidates } from '../src/lib/typesafe/agenda-time';
import { interpretAgenda } from '../src/lib/typesafe/agenda';
import { enqueueVerification, processNextVerification, getVerification } from '../src/lib/typesafe/verification';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import { publishedCapabilitiesForRole } from '../src/lib/capabilities/contracts';
import { agendaCapabilities } from '../src/lib/capabilities/agenda';
import type { WorkspaceContext } from '../src/lib/application/context';
import { ownedArtifact } from '../src/lib/ai-store';
import { createCredentialKeyring, decryptCredential, encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { reencryptAiConnectionSecrets } from '../src/lib/ai-connections-core';
import { runWorkerQueues } from '../src/lib/worker-scheduler';
import { enqueueDeletion, processNextDeletion } from '../src/lib/knowledge/indexing';

async function fixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID(); const userId = randomUUID();
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogado'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role));
  (await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId));
  return { officeId, userId, role };
}
async function configure(context: WorkspaceContext, patch: Record<string, unknown> = {}) {
  return saveConnection(context.userId, connectionSettings.parse({ apiKey: `fake-${context.officeId}`, enabled: true, rag: 'enabled', documents: 'enabled', agenda: 'enabled', version: (await connectionView()).version, ...patch }));
}
function response(request: DecisionRequest, choices: Record<string, string> = {}) {
  return { model: request.model, usage: { input_tokens: 100, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    if (question.type === 'noul') return [name, { type: 'noul', noul: 0.9 }];
    if (question.type === 'score') {
      const score = name.endsWith('_0') ? 0 : 3;
      return [name, { type: 'score', score, confidence: 1, legend: Object.fromEntries(question.criteria.map((v, i) => [i, v])), probabilities: Object.fromEntries(question.criteria.map((_, i) => [i, Number(i === score)])) }];
    }
    const choice = choices[name] ?? (Object.hasOwn(question.criteria, 'none') ? 'none' : Object.keys(question.criteria)[0]);
    return [name, { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) }];
  })) };
}
const send: DecisionTransport = async (_key, request) => response(request);
const request = { state: 'Texto de teste privado', questionVersion: 'test-v1', questions: { present: { type: 'noul' as const, instructions: 'Existe texto?' } } };

test('typesafe: an existing office key is adopted once as the platform connection', async () => {
  const a = (await fixture()); const b = (await fixture());
  (await testDb.prepare("INSERT INTO typesafe_connection(office_id,encrypted_api_key,key_hint,enabled,rag_mode,updated_at) VALUES(?,?,?,1,'shadow',CURRENT_TIMESTAMP - interval '1 day')").run(a.officeId, encryptCredential('older-key', parseCredentialKeyring()), 'older'));
  (await testDb.prepare("INSERT INTO typesafe_connection(office_id,encrypted_api_key,key_hint,enabled,rag_mode) VALUES(?,?,?,1,'enabled')").run(b.officeId, encryptCredential('legacy-office-key', parseCredentialKeyring()), 'lega-key'));
  const adopted = await connectionView();
  assert.equal(adopted.hasKey, true); assert.equal(adopted.keyHint, 'lega-key'); assert.equal(adopted.rag, 'enabled'); assert.equal(adopted.feedback, 'enabled');
  const row = (await testDb.prepare('SELECT encrypted_api_key,adopted_from_office_id FROM typesafe_platform_connection WHERE id=1').get<{ encrypted_api_key: string; adopted_from_office_id: string }>())!;
  assert.equal(decryptCredential(row.encrypted_api_key, parseCredentialKeyring()), 'legacy-office-key');
  assert.equal(row.adopted_from_office_id, b.officeId);
  // Every office now evaluates with that one key.
  for (const context of [a, b]) {
    const result = await evaluate(context, 'rag', request, { send: async (key, req) => { assert.equal(key, 'legacy-office-key'); return response(req); } });
    assert.equal(result.status, 'evaluated');
  }
  // Removing the platform key never re-adopts an office key.
  await removeConnection(a.userId);
  assert.equal((await connectionView()).hasKey, false);
});
test('typesafe: encrypted platform settings, platform authorization, defaults and stale versions', async () => {
  const a = (await fixture());
  assert.equal((await connectionView()).hasKey, false);
  const config = await configure(a);
  assert.ok(!JSON.stringify(config).includes(`fake-${a.officeId}`));
  const row = (await testDb.prepare('SELECT encrypted_api_key FROM typesafe_platform_connection WHERE id=1').get())!;
  assert.equal(decryptCredential(String(row.encrypted_api_key), parseCredentialKeyring()), `fake-${a.officeId}`);
  await assert.rejects(saveConnection(a.userId, connectionSettings.parse({ version: 0 })), { code: 'conflict' });
  (await testDb.prepare('DELETE FROM platform_admin WHERE user_id=?').run(a.userId));
  await assert.rejects(async () => (await configure(a)));
});
test('typesafe: one platform credential serves every office and provider failures never escape', async () => {
  const a = (await fixture()); const b = (await fixture()); await configure(a);
  for (const context of [a, b]) {
    const result = await evaluate(context, 'rag', request, { send: async (key, req) => { assert.equal(key, `fake-${a.officeId}`); return response(req); } });
    assert.equal(result.status, 'evaluated');
  }
  const offices = (await testDb.prepare('SELECT DISTINCT office_id FROM typesafe_evaluation WHERE office_id IN (?,?)').all(a.officeId, b.officeId));
  assert.equal(offices.length, 2);
  const failed = await evaluate(b, 'rag', request, { send: async () => { throw Object.assign(new Error('private provider response'), { status: 401 }); } });
  assert.equal(failed.status, 'unavailable'); assert.ok(!JSON.stringify(failed).includes('private provider'));
  assert.equal((await connectionView()).enabled, false);
  const audits = (await testDb.prepare('SELECT * FROM typesafe_evaluation WHERE office_id=?').all(b.officeId));
  assert.ok(!JSON.stringify(audits).includes('Texto de teste privado'));
});
test('typesafe: concurrent reservations bound spend and timeout remains charged', async () => {
  const context = (await fixture()); await configure(context, { concurrency: 1 });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const first = evaluate(context, 'rag', request, { send: async (_key, req) => { started(); await waiting; return response(req); } });
  await ready;
  assert.equal((await evaluate(context, 'rag', request, { send })).status, 'budget_exceeded');
  release(); assert.equal((await first).status, 'evaluated');
  const timed = await evaluate(context, 'rag', request, { deadlineMs: 5, send: async (_key, _req, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    setTimeout(() => reject(new Error('transport timeout')), 30);
  }) });
  assert.equal(timed.status, 'unavailable');
  const row = (await testDb.prepare('SELECT reserved_tokens,input_tokens FROM typesafe_evaluation WHERE id=?').get(timed.evaluationId!))!;
  assert.ok(Number(row.reserved_tokens) > 0); assert.equal(row.input_tokens, null);
});
test('typesafe: invalid answers, context limit, changed configuration and circuit breaker', async () => {
  const context = (await fixture()); await configure(context);
  assert.equal((await evaluate(context, 'rag', { ...request, state: 'x'.repeat(30000) }, { send })).status, 'budget_exceeded');
  const changed = await evaluate(context, 'rag', request, { send: async (_key, req) => { await configure(context); return response(req); } });
  assert.equal(changed.status, 'unavailable');
  for (let i = 0; i < 3; i++) await evaluate(context, 'rag', request, { send: async () => ({ secret: 'do not return' }) });
  let called = false;
  assert.equal((await evaluate(context, 'rag', request, { send: async () => { called = true; return {}; } })).status, 'unavailable');
  assert.equal(called, false);
});
test('typesafe: rerank shadow preserves RRF and enabled preserves source identities', async () => {
  const context = (await fixture()); await configure(context, { rag: 'shadow' });
  const sources = [{ sourceId: 'a', text: 'Contexto geral.' }, { sourceId: 'b', text: 'Evidência direta.' }];
  assert.deepEqual((await rerank(context, 'consulta', sources, { send })).sources, sources);
  await configure(context);
  assert.deepEqual((await rerank(context, 'consulta', sources, { send })).sources.map(s => s.sourceId), ['b', 'a']);
  assert.deepEqual((await rerank(context, 'consulta', sources, { send: async () => { throw new Error('down'); } })).sources, sources);
});

test('typesafe: two rerank batches can share an office with concurrency one', async () => {
  const context = (await fixture()); await configure(context, { concurrency: 1 });
  const sources = [{ sourceId: 'a', text: 'a'.repeat(12000) }, { sourceId: 'b', text: 'b'.repeat(12000) }];
  let calls = 0; let active = 0; let maximum = 0;
  const ranked = await rerank(context, 'consulta', sources, { send: async (_key, req) => {
    const score = calls++ === 0 ? 0 : 3;
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { model: req.model, usage: { input_tokens: 100, output_tokens: 0 }, answers: {
      source_0: { type: 'score', score, confidence: 1, probabilities: { '0': Number(score === 0), '1': 0, '2': 0, '3': Number(score === 3) } },
    } };
  } });
  assert.equal(ranked.status, 'evaluated', JSON.stringify({ status: ranked.status, reason: ranked.reason, calls }));
  assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(ranked.applied, true);
  assert.deepEqual(ranked.sources.map(source => source.sourceId), ['b', 'a']);
});

test('agenda dates: rejected DST times have an actionable Portuguese error', () => {
  for (const [day, time] of [['2026-03-08', '02:30'], ['2026-11-01', '01:30']]) {
    assert.throws(() => localInstant(day, time, 'America/New_York'), /horário.*Escolha outro horário/);
  }
});

test('typesafe: cancelling a multi-batch rerank preserves the baseline and skips remaining calls', async () => {
  const context = (await fixture()); await configure(context, { concurrency: 1 });
  const sources = [{ sourceId: 'a', text: 'a'.repeat(12000) }, { sourceId: 'b', text: 'b'.repeat(12000) }];
  const controller = new AbortController(); let calls = 0;
  const result = await rerank(context, 'consulta', sources, { signal: controller.signal, send: async (_key, req) => {
    calls++; controller.abort(); return response(req);
  } });
  assert.equal(calls, 1); assert.equal(result.applied, false); assert.deepEqual(result.sources, sources);
});
test('agenda interpretation: no mutation, no invented meeting end, owner-scoped suggestions', async () => {
  const context = (await fixture()); const other = (await fixture()); await configure(context);
  const result = await interpretAgenda(context, { message: 'Reunião amanhã às 9h', timeZone: 'America/Sao_Paulo' }, async (_key, req) => response(req, { intent: 'create_meeting', date: 'date_0', start: 'time_0' }));
  assert.equal(result.proposal.payload.kind, 'meeting');
  assert.equal(result.proposal.payload.endsAt, null);
  assert.ok(result.proposal.questions.some(q => q.includes('fim')));
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 0);
  await assert.rejects(runCapability(other, 'k5_agenda_get_proposal', { proposalId: result.proposal.id }), { code: 'NOT_FOUND' });
});
test('agenda confirmation: server adapters prevent model writes and ignore forged confirmation flags', async () => {
  const context = (await fixture());
  const catalog = publishedCapabilitiesForRole('lawyer', 'webmcp');
  assert.ok(catalog.includes('k5_agenda_interpret')); assert.ok(!catalog.includes('k5_agenda_create_activity')); assert.ok(!catalog.includes('k5_agenda_apply_proposal'));
  assert.ok(!agentTools(context).k5_agenda_create_activity);
  await assert.rejects(runCapability({ ...context, invocation: 'agent' }, 'k5_agenda_create_activity', { kind: 'task', title: 'Não salvar', confirmed: true, origin: 'user' }), { code: 'APPROVAL_REQUIRED' });
  const reviewer = (await fixture('reviewer'));
  await assert.rejects(runCapability(reviewer, 'k5_agenda_interpret', { message: 'Criar tarefa' }), { code: 'FORBIDDEN' });
});
test('agenda confirmation: concurrent retries and changed payload, receipt survives missing idempotency cache', async () => {
  const context = (await fixture());
  const { proposal } = await interpretAgenda(context, { message: 'Revisar contrato' });
  const input = { proposalId: proposal.id, version: 1, payload: { kind: 'task', title: 'Revisar contrato' } };
  const [a, b] = await Promise.all([runCapability(context, 'k5_agenda_apply_proposal', input), runCapability(context, 'k5_agenda_apply_proposal', input)]);
  assert.deepEqual(a, b);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 1);
  (await testDb.prepare('DELETE FROM capability_idempotency WHERE office_id=?').run(context.officeId));
  assert.deepEqual(await runCapability(context, 'k5_agenda_apply_proposal', input), a);
  await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { ...input, payload: { ...input.payload, title: 'Outro título' } }), { code: 'CONFLICT' });
});
test('agenda confirmation: receipt and activity roll back together on persistence failure', async () => {
  const context = (await fixture()); const { proposal } = await interpretAgenda(context, { message: 'Revisar minuta' });
  (await testDb.exec("CREATE FUNCTION fail_proposal_receipt_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failure'; END $$; CREATE TRIGGER fail_proposal_receipt BEFORE UPDATE OF result ON agenda_proposal FOR EACH ROW WHEN (NEW.result IS NOT NULL) EXECUTE FUNCTION fail_proposal_receipt_fn()"));
  try {
    await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { proposalId: proposal.id, version: 1, payload: { kind: 'task', title: 'Revisar minuta' } }));
    assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 0);
  } finally { (await testDb.exec('DROP TRIGGER fail_proposal_receipt ON agenda_proposal')); }
});
test('agenda dates: civil date, year omission, midnight, invalid and duplicated local times', () => {
  assert.deepEqual(temporalCandidates('amanhã às 9h', '2026-09-22T01:00:00Z', 'America/Sao_Paulo').dates, ['2026-09-22']);
  assert.ok(temporalCandidates('dia 30/02/2026', '2026-09-21T12:00:00Z', 'America/Sao_Paulo').questions.length);
  assert.ok(temporalCandidates('sexta às 9', '2026-09-21T12:00:00Z', 'America/Sao_Paulo').questions.length);
  assert.equal(localInstant('2026-09-21', '09:00', 'America/Sao_Paulo'), '2026-09-21T12:00:00Z');
  assert.throws(() => localInstant('2026-03-08', '02:30', 'America/New_York'));
  assert.throws(() => localInstant('2026-11-01', '01:30', 'America/New_York'));
});
async function documentFixture(context: WorkspaceContext) {
  const docId = randomUUID(); const sourceId = randomUUID(); const artifactId = randomUUID(); const runId = randomUUID();
  const quote = 'O pagamento de R$ 500 foi realizado em 20/09/2026.';
  (await testDb.prepare("INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by) VALUES(?,?,'library','recibo.txt',?,'text/plain',60,'hash','ready',?)").run(docId, context.officeId, docId, context.userId));
  (await testDb.prepare("INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,'parágrafo:1',?)").run(sourceId, docId, context.officeId, quote));
  (await testDb.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,status) VALUES(?,?,?,'draft','{}','completed')").run(runId, context.officeId, context.userId));
  (await testDb.prepare("INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content) VALUES(?,?,?,?,'Minuta','O valor foi de R$ 700.')").run(artifactId, context.officeId, context.userId, runId));
  return { artifact: (await ownedArtifact(testDatabase, context, artifactId))!, docId, sourceId, units: [{ id: 'p1', text: 'O valor foi de R$ 700.', evidence: [{ sourceId, quote }] }] };
}
test('document verification: semantic contradiction, incomplete coverage, no automatic approval and version invalidation', async () => {
  const context = (await fixture()); await configure(context); const data = await documentFixture(context);
  await enqueueVerification(context, data.artifact, [...data.units, { id: 'p2', text: 'Afirmação sem evidência.', evidence: [] }]);
  await processNextVerification({ send: async (_key, req) => response(req, { unit_0: 'contradicted' }) });
  const report = (await getVerification(context, { artifactId: data.artifact.id })).verification!;
  assert.equal(report.status, 'completed'); assert.equal(report.items[0].outcome, 'contradicted'); assert.equal(report.items[1].outcome, 'quote_not_found');
  assert.notEqual((await testDb.prepare('SELECT status FROM ai_artifact WHERE id=?').get(data.artifact.id))!.status, 'approved');
  (await testDb.prepare('UPDATE ai_artifact SET content=?,version=version+1 WHERE id=?').run('Texto editado.', data.artifact.id));
  assert.equal((await getVerification(context, { artifactId: data.artifact.id })).verification!.status, 'stale');
});
test('document verification: source removal and owner isolation; disabled configuration makes no calls', async () => {
  const context = (await fixture()); const other = (await fixture()); await configure(context); const data = await documentFixture(context);
  await enqueueVerification(context, data.artifact, data.units);
  (await testDb.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(data.docId));
  let called = false; await processNextVerification({ send: async () => { called = true; return {}; } });
  assert.equal(called, false);
  assert.equal((await getVerification(context, { artifactId: data.artifact.id })).verification!.status, 'stale');
  await assert.rejects(getVerification(other, { artifactId: data.artifact.id }), { code: 'NOT_FOUND' });
});
test('document verification: concurrent enqueue, checkpoints and lost lease never publish stale results', async () => {
  const context = (await fixture()); await configure(context); const data = await documentFixture(context);
  const units = Array.from({ length: 9 }, (_, i) => ({ ...data.units[0], id: `p${i}` }));
  const [a, b] = await Promise.all([enqueueVerification(context, data.artifact, units), enqueueVerification(context, data.artifact, units)]);
  assert.equal(a, b);
  await processNextVerification({ send });
  let report = (await getVerification(context, { artifactId: data.artifact.id })).verification!;
  assert.equal(report.checked, 4); assert.equal(report.status, 'queued');
  await processNextVerification({ send });
  report = (await getVerification(context, { artifactId: data.artifact.id })).verification!;
  assert.equal(report.checked, 8);
  await processNextVerification({ send: async (_key, req) => {
    (await testDb.prepare('UPDATE artifact_verification SET lease_until=0 WHERE id=?').run(a!));
    return response(req);
  } });
  report = (await getVerification(context, { artifactId: data.artifact.id })).verification!;
  assert.equal(report.status, 'stale'); assert.equal(report.checked, 8);
});

test('document verification: revocation during a provider call discards the judgment', async () => {
  const context = (await fixture()); await configure(context); const data = await documentFixture(context);
  await enqueueVerification(context, data.artifact, data.units);
  await processNextVerification({ send: async (_key, req) => {
    (await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(context.officeId, context.userId));
    return response(req);
  } });
  const report = (await testDb.prepare('SELECT status,results FROM artifact_verification WHERE artifact_id=?').get(data.artifact.id))!;
  assert.equal(report.status, 'stale'); assert.equal(report.results, '[]');
});

test('agenda confirmation: changed target version and foreign-office links require correction', async () => {
  const context = (await fixture()); const other = (await fixture());
  const { activity } = agendaCapabilities.k5_agenda_create_activity.output.parse(await runCapability(context, 'k5_agenda_create_activity', { kind: 'task', title: 'Atividade original' }));
  const { proposal } = await interpretAgenda(context, { message: 'Concluir atividade original' });
  await runCapability(context, 'k5_agenda_update_activity', { activityId: activity.id, version: activity.version, title: 'Editada por outra sessão' });
  await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { proposalId: proposal.id, version: 1, activityId: activity.id, activityVersion: activity.version, payload: { kind: 'task', title: activity.title, status: 'completed' } }), { code: 'CONFLICT' });
  assert.equal((await testDb.prepare('SELECT status FROM agenda_activity WHERE id=?').get(activity.id))!.status, 'pending');
  await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { proposalId: proposal.id, version: 1, payload: { kind: 'task', title: 'Não salvar', assigneeId: other.userId } }));
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 1);
});

test('typesafe: an incomplete reranking batch leaves the entire baseline unchanged', async () => {
  const context = (await fixture()); await configure(context);
  const sources = Array.from({ length: 3 }, (_, i) => ({ sourceId: String(i), text: String(i).repeat(12000) }));
  let calls = 0;
  const ranked = await rerank(context, 'consulta', sources, { send: async (_key, req) => {
    if (++calls === 2) throw new Error('temporary'); return response(req);
  } });
  assert.equal(calls, 2); assert.equal(ranked.applied, false); assert.deepEqual(ranked.sources, sources);
});

test('worker scheduling: a blocked verification does not delay pending deletion or subsequent work', async () => {
  const context = (await fixture()); await configure(context); const data = await documentFixture(context);
  await enqueueVerification(context, data.artifact, Array.from({ length: 9 }, (_, i) => ({ ...data.units[0], id: `p${i}` })));
  // A nonexistent legacy object is still a real deletion-queue item; cleanup must close it.
  await enqueueDeletion(context.officeId, 'object', `missing-${randomUUID()}.txt`);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let progressed!: () => void; const progress = new Promise<void>(resolve => { progressed = resolve; });
  let stopping = false; let passes = 0;
  const errors: unknown[] = [];
  const running = runWorkerQueues({
    processDocuments: async () => { passes++; return false; },
    verifyDocuments: () => processNextVerification({ send: async (_key, req) => { entered(); await blocked; return response(req); } }),
    maintain: async () => {
      const worked = await processNextDeletion();
      if (passes > 1) progressed();
      return worked;
    },
    stopping: () => stopping, once: false, onError: error => errors.push(error),
    sleep: () => new Promise(resolve => setTimeout(resolve, 1)),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await started;
    // No provider timer: hold its promise until the assertions have inspected queue progress.
    await Promise.race([progress, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Subsequent worker passes remained blocked')), 1000);
    })]);
    const deletion = (await testDb.prepare('SELECT completed_at FROM vault_deletion_queue WHERE office_id=?').get(context.officeId))!;
    assert.ok(deletion.completed_at, 'Deletion remained pending behind the provider request');
    assert.ok(passes > 1, 'Subsequent worker passes remained blocked');
  } finally { clearTimeout(timer); stopping = true; release(); await running; }
  assert.deepEqual(errors, []);
  const report = (await getVerification(context, { artifactId: data.artifact.id })).verification!;
  assert.equal(report.checked, 4); assert.equal(report.total, 9); assert.equal(report.status, 'queued');
});

test('typesafe: key rotation includes decision connections in the atomic batch', async () => {
  const context = (await fixture()); await configure(context);
  const current = parseCredentialKeyring(); const next = createCredentialKeyring(randomBytes(32), [current.current.key]);
  const result = await reencryptAiConnectionSecrets(testDatabase, next, context.userId);
  assert.ok(result.reencrypted > 0);
  const row = (await testDb.prepare('SELECT encrypted_api_key FROM typesafe_platform_connection WHERE id=1').get())!;
  assert.equal(decryptCredential(String(row.encrypted_api_key), next), `fake-${context.officeId}`);
});
