import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AiConnectionError, createAiConnection, deleteAiConnection, resolveModelConfigFromDatabase, updateAiConnection } from '../src/lib/ai-connections-core';
import { AI_PROFILES, DEFAULT_REASONING_EFFORT, PROFILE_DEFINITIONS } from '../src/lib/ai-profiles';
import { listProfileOverrides, resolveProfileConfigFromDatabase, resolveProfileVariantFromDatabase, updateProfileOverride } from '../src/lib/ai-profiles-core';
import { generateStructured, StructuredGenerationError } from '../src/lib/ai-runtime';
import { aiUsageSummary } from '../src/lib/ai-usage';
import { dateAppearsIn, needsEscalation, textHasDate } from '../src/lib/document-composition';
import { parseCredentialKeyring } from '../src/lib/platform-crypto';
import { runProfile } from '../src/lib/run-profiles';
import { extractWithEscalation, type ChunkAttempt, type ChunkAttemptFn } from '../src/lib/document-workflows';

const key = () => parseCredentialKeyring();

/** Profiles live in one platform table, so each test starts from none and removes what it created. */
async function platform() {
  await testDb.prepare('DELETE FROM ai_profile_override').run();
  await testDb.prepare("UPDATE ai_connection SET chat_model=NULL,extraction_model=NULL,drafting_model=NULL,embedding_model=NULL,enabled=0 WHERE office_id IS NULL").run();
  const admin = randomUUID(), officeId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(admin, `${admin}@example.test`, 'Admin');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  const sol = await createAiConnection(testDb, key(), admin, { name: `Sol ${admin}`, provider: 'openai', apiKey: 'sk-sol-test',
    models: { chat: 'gpt-6-sol', extraction: 'gpt-6-sol', drafting: 'gpt-6-sol' } });
  const luna = await createAiConnection(testDb, key(), admin, { name: `Luna ${admin}`, provider: 'openai', apiKey: 'sk-luna-test' });
  return { admin, officeId, sol, luna };
}

test('profiles: with no settings every step resolves exactly as its task did, at xhigh', async () => {
  await platform();
  for (const profile of AI_PROFILES) {
    const task = PROFILE_DEFINITIONS[profile].task;
    const config = await resolveProfileConfigFromDatabase(testDb, key(), profile);
    const before = await resolveModelConfigFromDatabase(testDb, key(), task);
    assert.equal(config.connectionId, before.connectionId, profile);
    assert.equal(config.modelId, before.modelId, profile);
    assert.equal(config.reasoningEffort, DEFAULT_REASONING_EFFORT);
    assert.equal(config.maxOutputTokens, PROFILE_DEFINITIONS[profile].maxOutputTokens);
  }
  assert.ok((await listProfileOverrides(testDb)).every(item => item.updatedAt === null));
});

test('profiles: one step changes alone, is audited, falls back when its connection is off, and resets', async () => {
  const { admin, sol, luna } = await platform();
  await updateProfileOverride(testDb, admin, 'extraction_chunk', { connectionId: luna.id, modelId: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 4000 });
  const chunk = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk');
  assert.deepEqual([chunk.connectionId, chunk.modelId, chunk.reasoningEffort, chunk.maxOutputTokens], [luna.id, 'gpt-6-luna', 'medium', 4000]);
  assert.equal(chunk.apiKey, 'sk-luna-test');
  const review = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_review');
  assert.deepEqual([review.connectionId, review.modelId, review.reasoningEffort], [sol.id, 'gpt-6-sol', 'xhigh'], 'the sibling step is untouched');
  const audit = await testDb.prepare("SELECT details_json FROM platform_audit_log WHERE action='ai_profile.updated' AND actor_user_id=?").get<{ details_json: string }>(admin);
  assert.equal(JSON.parse(audit!.details_json).profile, 'extraction_chunk');
  assert.equal(audit!.details_json.includes('sk-'), false, 'no key reaches the audit log');

  await assert.rejects(deleteAiConnection(testDb, admin, luna.id), (error: unknown) => error instanceof AiConnectionError && error.code === 'in_use');
  await updateAiConnection(testDb, key(), admin, luna.id, { enabled: false });
  assert.equal((await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk')).connectionId, sol.id, 'a disabled connection falls back to the task');

  await updateProfileOverride(testDb, admin, 'extraction_chunk', { connectionId: null, modelId: null, reasoningEffort: null, maxOutputTokens: null });
  assert.equal(await testDb.prepare("SELECT 1 FROM ai_profile_override WHERE profile='extraction_chunk'").get(), undefined, 'reset leaves no row');
  assert.ok(await testDb.prepare("SELECT 1 FROM platform_audit_log WHERE action='ai_profile.reset' AND actor_user_id=?").get(admin));
});

test('profiles: invalid settings are refused', async () => {
  const { admin, luna } = await platform();
  await assert.rejects(updateProfileOverride(testDb, admin, 'extraction_chunk', { connectionId: luna.id }), (error: unknown) => error instanceof AiConnectionError && error.code === 'invalid');
  await assert.rejects(updateProfileOverride(testDb, admin, 'chat', { escalate: { connectionId: luna.id, modelId: 'gpt-6-sol' } }), (error: unknown) => error instanceof AiConnectionError && error.code === 'invalid');
  await assert.rejects(updateProfileOverride(testDb, admin, 'drafting', { connectionId: randomUUID(), modelId: 'x' }), (error: unknown) => error instanceof AiConnectionError && error.code === 'not_found');
  await assert.rejects(updateProfileOverride(testDb, admin, 'drafting', { reasoningEffort: 'turbo' as never }));
  await assert.rejects(updateProfileOverride(testDb, admin, 'drafting', { maxOutputTokens: 10 }));
});

test('profiles: escalation and shadow models resolve only when set, and runs keep what they were queued with', async () => {
  const { admin, sol, luna } = await platform();
  assert.equal(await resolveProfileVariantFromDatabase(testDb, key(), 'extraction_chunk', 'escalate'), null);
  await updateProfileOverride(testDb, admin, 'extraction_chunk', { connectionId: luna.id, modelId: 'gpt-6-luna', reasoningEffort: 'medium',
    escalate: { connectionId: sol.id, modelId: 'gpt-6-sol', reasoningEffort: 'high' } });
  const escalate = await resolveProfileVariantFromDatabase(testDb, key(), 'extraction_chunk', 'escalate');
  assert.deepEqual([escalate?.modelId, escalate?.reasoningEffort, escalate?.apiKey], ['gpt-6-sol', 'high', 'sk-sol-test']);

  const pinned = JSON.stringify({ extraction_chunk: { provider: 'openai', modelId: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 12000 },
    'extraction_chunk:escalate': { provider: 'openai', modelId: 'gpt-6-sol', reasoningEffort: 'high', maxOutputTokens: 12000 } });
  const run = { model_provider: 'openai', model_id: 'gpt-6-luna', model_profiles: pinned };
  assert.equal(runProfile(run, 'extraction_chunk', 'escalate')?.reasoningEffort, 'high');
  assert.equal(runProfile(run, 'extraction_chunk', 'shadow'), undefined, 'a variant is never inferred');
  const legacy = { model_provider: 'openai', model_id: 'gpt-5', model_profiles: null };
  assert.deepEqual(runProfile(legacy, 'extraction_review'), { provider: 'openai', modelId: 'gpt-5' }, 'runs queued before profiles keep their model');
  // A pinned run ignores a later change in the administration.
  await updateProfileOverride(testDb, admin, 'extraction_chunk', { reasoningEffort: 'low' });
  const resolved = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk', runProfile(run, 'extraction_chunk'));
  assert.deepEqual([resolved.modelId, resolved.reasoningEffort], ['gpt-6-luna', 'medium']);
  // The pin names its connection: an escalation queued on Sol keeps Sol's key even though Luna,
  // another OpenAI connection, was updated more recently.
  const pinnedSol = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk',
    { provider: 'openai', modelId: 'gpt-6-sol', reasoningEffort: 'high', maxOutputTokens: 12000, connectionId: sol.id });
  assert.deepEqual([pinnedSol.connectionId, pinnedSol.apiKey], [sol.id, 'sk-sol-test']);
  const pinnedLuna = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk',
    { provider: 'openai', modelId: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 12000, connectionId: luna.id });
  assert.deepEqual([pinnedLuna.connectionId, pinnedLuna.apiKey], [luna.id, 'sk-luna-test']);
  const old = await resolveProfileConfigFromDatabase(testDb, key(), 'extraction_chunk', runProfile(legacy, 'extraction_chunk'));
  assert.equal(old.reasoningEffort, 'xhigh', 'the old default effort, not the new setting');
});

test('telemetry: a failed structured call records profile, effort, error kind and latency, with the effort on the wire', async (t) => {
  const { admin, officeId, luna } = await platform();
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : await new Request(input, init).text()));
    // Rejected on purpose after reading the request: no provider is contacted.
    return Response.json({ error: { message: 'Controlled rejection', type: 'invalid_request_error', code: 'invalid_api_key' } }, { status: 400 });
  });
  const schema = z.object({ ok: z.boolean() });
  await assert.rejects(generateStructured(officeId, admin, 'extraction_chunk', 'Teste.', schema, { meta: { runId: 'run-1', stepKey: 'extract:a', attempt: 1 } }),
    (error: unknown) => error instanceof StructuredGenerationError && error.kind === 'provider');
  const effort = (body: Record<string, unknown>) => (body.reasoning as { effort?: string } | undefined)?.effort ?? body.reasoning_effort;
  assert.equal(effort(bodies.at(-1)!), 'xhigh');
  assert.equal(bodies.at(-1)!.max_output_tokens, 12000);

  await updateProfileOverride(testDb, admin, 'extraction_chunk', { connectionId: luna.id, modelId: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 3000 });
  await assert.rejects(generateStructured(officeId, admin, 'extraction_chunk', 'Teste.', schema));
  assert.equal(effort(bodies.at(-1)!), 'medium');
  assert.equal(bodies.at(-1)!.max_output_tokens, 3000);
  assert.equal(bodies.at(-1)!.model, 'gpt-6-luna');

  const rows = await testDb.prepare("SELECT task,profile,reasoning_effort,error_kind,duration_ms,run_id,step_key,attempt,status FROM ai_usage WHERE office_id=? ORDER BY created_at")
    .all<{ task: string; profile: string; reasoning_effort: string; error_kind: string; duration_ms: number | null; run_id: string | null; step_key: string | null; attempt: number | null; status: string }>(officeId);
  assert.deepEqual(rows.map(row => [row.task, row.profile, row.reasoning_effort, row.error_kind, row.status]),
    [['extraction', 'extraction_chunk', 'xhigh', 'provider', 'failed'], ['extraction', 'extraction_chunk', 'medium', 'provider', 'failed']]);
  assert.ok(rows.every(row => row.duration_ms !== null));
  assert.deepEqual([rows[0].run_id, rows[0].step_key, Number(rows[0].attempt)], ['run-1', 'extract:a', 1]);
  const summary = await aiUsageSummary(testDb);
  assert.ok(summary.some(row => row.profile === 'extraction_chunk' && row.reasoningEffort === 'medium' && row.failed >= 1));
});

test('escalation: code checks, not the model, decide when a passage is redone', () => {
  const source = 'Em 5 de março de 2024 o contrato foi assinado. O pagamento venceu em 10/04/2024 e não foi feito.';
  const signed = { date: '2024-03-05', description: 'Contrato assinado', quote: 'Em 5 de março de 2024 o contrato foi assinado' };
  const due = { date: '2024-04-10', description: 'Vencimento', quote: 'O pagamento venceu em 10/04/2024' };
  assert.equal(needsEscalation({ returned: 2, kept: [signed, due], sourceText: source }), null);
  assert.equal(needsEscalation({ returned: 4, kept: [signed, due], sourceText: source }), 'discarded', 'half the events had no literal quote');
  assert.equal(needsEscalation({ returned: 5, kept: [signed, due, signed, due], sourceText: source }), null, 'one in five is within the limit');
  assert.equal(needsEscalation({ returned: 0, kept: [], sourceText: source }), 'empty_with_dates');
  assert.equal(needsEscalation({ returned: 0, kept: [], sourceText: 'Sem nenhuma data neste trecho.' }), null);
  // The quote exists, but the date was not in it: a real quote does not make the event right.
  assert.equal(needsEscalation({ returned: 1, kept: [{ ...due, date: '2024-04-11' }], sourceText: source }), 'date_not_in_source');
  assert.equal(needsEscalation({ returned: 1, kept: [{ ...due, date: '2024-04' }], sourceText: source }), null, 'partial dates are not checked');

  assert.equal(dateAppearsIn('2024-03-05', 'assinado em 05/03/2024'), true);
  assert.equal(dateAppearsIn('2024-03-05', 'assinado em 5.3.24'), true);
  assert.equal(dateAppearsIn('2024-03-05', 'em 5º de Março de 2024'), true);
  assert.equal(dateAppearsIn('2024-03-05', 'em 15/03/2024'), false);
  assert.equal(dateAppearsIn('2024-03-05', 'em 2024-03-05'), true);
  assert.equal(textHasDate('audiência em 1º de dezembro de 2025'), true);
  assert.equal(textHasDate('processo 123/2024'), false);
});

test('escalation: a checked second answer replaces a rejected passage; otherwise the first stands; shadow never decides or waits', async () => {
  const source = 'O contrato foi assinado em 05/03/2024 pelas partes.';
  const event = (date: string) => ({ date, description: 'Assinatura', quote: 'O contrato foi assinado em 05/03/2024' });
  const extraction = (date: string, producedBy: string) => ({ events: [event(date)], gaps: [], sourceId: 's1', sourceLabel: 'Contrato', producedBy });
  const plan = { primary: { modelId: 'gpt-6-luna' }, escalate: { modelId: 'gpt-6-sol' }, shadow: { modelId: 'shadow-model' } };
  const calls: Array<{ model?: string; attempt?: number; variant?: string; escalatedFrom?: string }> = [];
  const attempts = (answers: Record<string, ChunkAttempt>): ChunkAttemptFn => async (pinned, meta) => {
    calls.push({ model: pinned?.modelId, attempt: meta.attempt, variant: meta.variant, escalatedFrom: meta.escalatedFrom });
    return answers[pinned?.modelId ?? ''];
  };

  // A wrong date inside a real quote sends the passage to the escalation model.
  const redone = await extractWithEscalation(source, plan, attempts({
    'gpt-6-luna': { returned: 1, extraction: extraction('2024-03-06', 'gpt-6-luna') },
    'gpt-6-sol': { returned: 1, extraction: extraction('2024-03-05', 'gpt-6-sol') },
    'shadow-model': { error: 'schema' },
  }), { runId: 'r', stepKey: 'extract:s1' });
  assert.equal(redone.producedBy, 'gpt-6-sol');
  assert.deepEqual(calls.find(call => call.variant === 'escalate'), { model: 'gpt-6-sol', attempt: 2, variant: 'escalate', escalatedFrom: 'gpt-6-luna' });
  assert.ok(calls.some(call => call.variant === 'shadow'), 'the shadow model ran');

  // A passing first answer is kept and nothing is escalated.
  calls.length = 0;
  const kept = await extractWithEscalation(source, plan, attempts({
    'gpt-6-luna': { returned: 1, extraction: extraction('2024-03-05', 'gpt-6-luna') }, 'shadow-model': { returned: 1, extraction: extraction('2024-03-05', 'shadow-model') },
  }), {});
  assert.equal(kept.producedBy, 'gpt-6-luna');
  assert.equal(calls.some(call => call.variant === 'escalate'), false);

  // The escalation fails: the checked first answer stands. Both fail: the passage fails with the first error.
  const fallback = await extractWithEscalation(source, plan, attempts({
    'gpt-6-luna': { returned: 1, extraction: extraction('2024-03-06', 'gpt-6-luna') }, 'gpt-6-sol': { error: 'timeout' }, 'shadow-model': { error: 'provider' },
  }), {});
  assert.equal(fallback.producedBy, 'gpt-6-luna');
  // The second answer fails the checks too, or the call rejects: the first answer is not replaced.
  const emptied = await extractWithEscalation(source, plan, attempts({
    'gpt-6-luna': { returned: 2, extraction: extraction('2024-03-05', 'gpt-6-luna') }, 'gpt-6-sol': { returned: 0, extraction: { ...extraction('2024-03-05', 'gpt-6-sol'), events: [] } },
    'shadow-model': { error: 'provider' },
  }), {});
  assert.equal(emptied.producedBy, 'gpt-6-luna', 'an empty second answer does not erase the events the first one kept');
  const rejected = await extractWithEscalation(source, plan, async (pinned, meta) => {
    if (meta.variant === 'escalate') throw new Error('conexão removida');
    return { returned: 1, extraction: extraction('2024-03-06', pinned?.modelId ?? '') };
  }, {});
  assert.equal(rejected.producedBy, 'gpt-6-luna');
  // A slow shadow model does not hold the passage.
  const idle = await extractWithEscalation(source, plan, (pinned) => pinned?.modelId === 'shadow-model'
    ? new Promise<ChunkAttempt>(() => undefined)
    : Promise.resolve({ returned: 1, extraction: extraction('2024-03-05', pinned?.modelId ?? '') }), {});
  assert.equal(idle.producedBy, 'gpt-6-luna');
  // With the run's gate, a passage skips the shadow call while the previous one is open.
  const gate = { busy: false };
  let release = () => {};
  const shadowCalls: string[] = [];
  const gated: ChunkAttemptFn = (pinned, meta) => {
    if (meta.variant === 'shadow') { shadowCalls.push(meta.stepKey ?? ''); return new Promise<ChunkAttempt>(done => { release = () => done({ error: 'timeout' }); }); }
    return Promise.resolve({ returned: 1, extraction: extraction('2024-03-05', pinned?.modelId ?? '') });
  };
  await extractWithEscalation(source, { ...plan, shadowGate: gate }, gated, { stepKey: 'a' });
  await extractWithEscalation(source, { ...plan, shadowGate: gate }, gated, { stepKey: 'b' });
  assert.deepEqual(shadowCalls, ['a'], 'the second passage did not open another shadow call');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gate.busy, false);
  await extractWithEscalation(source, { ...plan, shadowGate: gate }, gated, { stepKey: 'c' });
  assert.deepEqual(shadowCalls, ['a', 'c']);
  await assert.rejects(extractWithEscalation(source, plan, attempts({ 'gpt-6-luna': { error: 'incomplete' }, 'gpt-6-sol': { error: 'provider' }, 'shadow-model': { error: 'provider' } }), {}),
    (error: unknown) => error instanceof StructuredGenerationError && error.kind === 'incomplete');
  // Without an escalation model a failure fails as before, even when the shadow model succeeded.
  await assert.rejects(extractWithEscalation(source, { primary: plan.primary, shadow: plan.shadow }, attempts({
    'gpt-6-luna': { error: 'schema' }, 'shadow-model': { returned: 1, extraction: extraction('2024-03-05', 'shadow-model') },
  }), {}), (error: unknown) => error instanceof StructuredGenerationError && error.kind === 'schema');
});
