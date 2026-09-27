import './test-setup';
import { postgresFixture } from './postgres-fixture';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import {
  AiConnectionError, connectionReferences, createAiConnection, deleteAiConnection, updateAiConnection, type AiProvider,
} from '../src/lib/ai-connections-core';
import {
  assignmentOverview, loadAssignmentSnapshot, pinRunModelPlan, planGroup, planTask, resolveLegacyRunModel, resolvePinnedTaskModel,
  resolveTaskModelFromDatabase, testModelAssignment, updateModelAssignment, type AssignmentUpdate, type TaskModelPlan,
} from '../src/lib/ai-assignments-core';
import { AI_TASK_KEYS, type AiTaskKey } from '../src/lib/ai-tasks';
import { DEFAULT_CHAT_MODEL } from '../src/lib/ai-defaults';
import { chatHearsAudio } from '../src/lib/ai-modalities';
import { encryptCredential } from '../src/lib/platform-crypto';
import { injectionDetector, measuredModel } from '../src/lib/agent-guard';
import type { Database } from '../src/lib/database';

async function fixture() {
  const { db } = await postgresFixture();
  const admin = randomUUID(), office = randomUUID();
  await db.prepare('INSERT INTO user (id,email,name) VALUES (?,?,?)').run(admin, `${admin}@example.test`, 'Admin');
  await db.prepare('INSERT INTO office (id,name) VALUES (?,?)').run(office, 'Alfa Advocacia');
  return { db, admin, office, key: randomBytes(32) };
}

const set = (db: Database, admin: string, input: AssignmentUpdate) => updateModelAssignment(db, admin, input);
const explicit = (connectionId: string, modelId: string) => ({ mode: 'explicit' as const, connectionId, modelId });
const inherit = { mode: 'inherit' as const };

// ---------- Migration 0030 reproduces the resolver it replaces ----------

type LegacyConnection = {
  id: string; provider: AiProvider; key: boolean; enabled?: boolean; deleted?: boolean; updatedAt: string;
  chat?: string; extraction?: string; drafting?: string;
};
type Outcome = { connectionId: string; modelId: string; effort: string | null } | 'not_found' | 'disabled';

/**
 * The resolution before 0030, written down as the reference: resolveModelConfigFromDatabase for
 * chat, extraction and drafting, the e-mail writer's request for gpt-6-luna with its fallback, the
 * guard on extraction, and transcription following the chat's provider.
 */
function legacy(connections: LegacyConnection[], task: AiTaskKey): Outcome {
  const active = connections.filter(item => item.enabled !== false && !item.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const profile = (column: 'chat' | 'extraction' | 'drafting') => {
    const assigned = active.find(item => item[column]);
    if (assigned?.key) return { connectionId: assigned.id, modelId: assigned[column]!, provider: assigned.provider };
    const fallback = active.find(item => item.key);
    return fallback ? { connectionId: fallback.id, modelId: DEFAULT_CHAT_MODEL[fallback.provider], provider: fallback.provider } : undefined;
  };
  const openai = (resolved: { provider: AiProvider } | undefined, effort: string) => resolved?.provider === 'openai' ? effort : null;
  const outcome = (resolved: ReturnType<typeof profile>, effort: string): Outcome =>
    resolved ? { connectionId: resolved.connectionId, modelId: resolved.modelId, effort: openai(resolved, effort) } : 'not_found';
  if (task === 'agent.chat') return outcome(profile('chat'), 'xhigh');
  if (task.startsWith('drafting.')) return outcome(profile('drafting'), 'xhigh');
  if (task.startsWith('extraction.')) return outcome(profile('extraction'), 'xhigh');
  if (task === 'classification.injection_guard') return outcome(profile('extraction'), 'low');
  if (task.startsWith('summary.')) {
    const effort = task === 'summary.email_digest' ? 'medium' : 'low';
    const requested = active.find(item => item.provider === 'openai');
    if (requested?.key) return { connectionId: requested.id, modelId: 'gpt-6-luna', effort };
    return outcome(profile('extraction'), effort);
  }
  const chat = profile('chat');
  if (!chat) return 'not_found';
  if (chat.provider === 'openai') return { connectionId: chat.connectionId, modelId: 'gpt-4o-mini-transcribe', effort: null };
  return chatHearsAudio(chat.provider, chat.modelId) ? { connectionId: chat.connectionId, modelId: chat.modelId, effort: null } : 'disabled';
}

const outcomeOf = (plan: TaskModelPlan): Outcome => plan.status === 'ready' ? { connectionId: plan.connectionId, modelId: plan.modelId, effort: plan.effort }
  : plan.status === 'disabled' ? 'disabled' : 'not_found';

const scenarios: Record<string, LegacyConnection[]> = {
  'no connection': [],
  'one OpenAI connection with the admin form saved': [{ id: 'o1', provider: 'openai', key: true, updatedAt: '2026-05-01T00:00:00Z', chat: 'gpt-6-sol', extraction: 'gpt-6-sol', drafting: 'gpt-6-sol' }],
  'only chat assigned': [{ id: 'o1', provider: 'openai', key: true, updatedAt: '2026-05-01T00:00:00Z', chat: 'gpt-6-sol' }],
  'Anthropic chat and an older OpenAI connection': [
    { id: 'a1', provider: 'anthropic', key: true, updatedAt: '2026-05-01T00:00:00Z', chat: 'claude-sonnet-5' },
    { id: 'o1', provider: 'openai', key: true, updatedAt: '2026-01-01T00:00:00Z' }],
  'Gemini chat and OpenAI extraction': [
    { id: 'g1', provider: 'google', key: true, updatedAt: '2026-05-01T00:00:00Z', chat: 'gemini-2.5-pro' },
    { id: 'o1', provider: 'openai', key: true, updatedAt: '2026-01-01T00:00:00Z', extraction: 'gpt-6-luna' }],
  'assigned connection disabled': [
    { id: 'o1', provider: 'openai', key: true, enabled: false, updatedAt: '2026-05-01T00:00:00Z', chat: 'gpt-6-sol' },
    { id: 'a1', provider: 'anthropic', key: true, updatedAt: '2026-01-01T00:00:00Z' }],
  'assigned connection without a key': [
    { id: 'o1', provider: 'openai', key: false, updatedAt: '2026-05-01T00:00:00Z', chat: 'gpt-6-sol', extraction: 'gpt-6-sol' },
    { id: 'a1', provider: 'anthropic', key: true, updatedAt: '2026-01-01T00:00:00Z' }],
  'assigned connection deleted': [
    { id: 'o1', provider: 'openai', key: false, enabled: false, deleted: true, updatedAt: '2026-05-01T00:00:00Z', chat: 'gpt-6-sol' },
    { id: 'g1', provider: 'google', key: true, updatedAt: '2026-01-01T00:00:00Z' }],
  'several connections, each task elsewhere': [
    { id: 'o1', provider: 'openai', key: true, updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'o2', provider: 'openai', key: true, updatedAt: '2026-05-01T00:00:00Z', drafting: 'gpt-6-sol' },
    { id: 'a1', provider: 'anthropic', key: true, updatedAt: '2026-03-01T00:00:00Z', chat: 'claude-opus-5' }],
  'the most recent OpenAI connection has no key': [
    { id: 'o1', provider: 'openai', key: false, updatedAt: '2026-05-01T00:00:00Z' },
    { id: 'o2', provider: 'openai', key: true, updatedAt: '2026-03-01T00:00:00Z' }],
};

test('migration 0030 gives every task the connection, model and effort it resolved to before', async () => {
  const { db, key } = await fixture();
  const migration = readFileSync(new URL('../db/postgres/0030_ai_model_assignments.sql', import.meta.url), 'utf8');
  const adoption = migration.slice(migration.indexOf('-- Adoption:'));
  for (const [name, connections] of Object.entries(scenarios)) {
    await db.exec('DELETE FROM ai_model_assignment; DELETE FROM ai_connection;');
    for (const item of connections) {
      await db.prepare(`INSERT INTO ai_connection (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model, extraction_model, drafting_model, enabled, updated_at, deleted_at)
        VALUES (?, NULL, ?, ?, ?, '••••', ?, ?, ?, ?, ?, ?)`).run(item.id, `Conexão ${item.id}`, item.provider, item.key ? encryptCredential(`sk-${item.id}`, key) : null,
        item.chat ?? null, item.extraction ?? null, item.drafting ?? null, item.enabled === false ? 0 : 1, item.updatedAt, item.deleted ? item.updatedAt : null);
    }
    await db.exec(adoption);
    const snapshot = await loadAssignmentSnapshot(db);
    for (const task of AI_TASK_KEYS) {
      assert.deepEqual(outcomeOf(planTask(task, snapshot)), legacy(connections, task), `${name}: ${task}`);
    }
  }
});

// ---------- Inheritance, effort and states ----------

test('a task takes its group, then the group\'s parents; model and effort are inherited separately', async () => {
  const { db, admin, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  const an = await createAiConnection(db, key, admin, { name: 'Anthropic', provider: 'anthropic', apiKey: 'sk-an' });
  await set(db, admin, { scope: 'group', target: 'agent', model: explicit(oa.id, 'gpt-6-sol'), effort: { mode: 'explicit', value: 'xhigh' } });
  const plan = async (task: AiTaskKey) => planTask(task, await loadAssignmentSnapshot(db));

  const chat = await resolveTaskModelFromDatabase(db, key, 'agent.chat');
  assert.deepEqual([chat.modelId, chat.apiKey, chat.effort, chat.modelSource, chat.effortSource], ['gpt-6-sol', 'sk-oa', 'xhigh', 'group:agent', 'group:agent']);
  // Drafting has no model of its own: the agent's, with drafting's own effort from the migration.
  assert.deepEqual(await plan('drafting.section'), { status: 'ready', connectionId: oa.id, connectionName: 'OpenAI', provider: 'openai', modelId: 'gpt-6-sol',
    effort: 'xhigh', modelOrigin: { scope: 'group', target: 'agent' }, effortOrigin: { scope: 'group', target: 'drafting' } });

  // Another model of the same provider keeps the effort chosen above it.
  await set(db, admin, { scope: 'task', target: 'drafting.outline', model: explicit(oa.id, 'gpt-6-luna'), effort: inherit });
  const outline = await plan('drafting.outline');
  assert.ok(outline.status === 'ready' && outline.modelId === 'gpt-6-luna' && outline.effort === 'xhigh' && !outline.effortNote);

  // Another provider does not: an effort chosen for OpenAI is not sent to Anthropic.
  await set(db, admin, { scope: 'task', target: 'drafting.section', model: explicit(an.id, 'claude-opus-5'), effort: inherit });
  const section = await plan('drafting.section');
  assert.ok(section.status === 'ready' && section.effort === null && section.effortNote === 'other_provider');

  // A provider that takes no effort never gets one, even when chosen at the same level.
  await set(db, admin, { scope: 'group', target: 'extraction', model: explicit(an.id, 'claude-sonnet-5'), effort: { mode: 'provider_default' } });
  const facts = await plan('extraction.chronology_facts');
  assert.ok(facts.status === 'ready' && facts.effort === null && facts.effortOrigin.scope === 'group' && facts.effortOrigin.target === 'extraction');
  // The guard and the e-mail writer follow extraction's model; their own efforts stay theirs, and only apply to OpenAI.
  const guard = await plan('classification.injection_guard');
  assert.ok(guard.status === 'ready' && guard.provider === 'anthropic' && guard.effort === null && guard.effortNote === 'unsupported');

  // Provider default at the task level beats every effort above it.
  await set(db, admin, { scope: 'task', target: 'agent.chat', model: inherit, effort: { mode: 'provider_default' } });
  const light = await plan('agent.chat');
  assert.ok(light.status === 'ready' && light.effort === null && light.effortOrigin.scope === 'task');
});

test('transcription follows the agent until it has a model, and can be switched off', async () => {
  const { db, admin, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  const gg = await createAiConnection(db, key, admin, { name: 'Google', provider: 'google', apiKey: 'sk-gg' });
  const an = await createAiConnection(db, key, admin, { name: 'Anthropic', provider: 'anthropic', apiKey: 'sk-an' });
  const voice = async () => planTask('transcription.voice_note', await loadAssignmentSnapshot(db));
  await set(db, admin, { scope: 'group', target: 'agent', model: explicit(oa.id, 'gpt-6-sol'), effort: inherit });
  assert.ok((await voice()).status === 'ready' && (await voice() as { modelId: string }).modelId === 'gpt-4o-mini-transcribe');
  await set(db, admin, { scope: 'group', target: 'agent', model: explicit(gg.id, 'gemini-2.5-pro'), effort: { mode: 'provider_default' } });
  assert.equal((await voice() as { modelId: string }).modelId, 'gemini-2.5-pro');
  await set(db, admin, { scope: 'group', target: 'agent', model: explicit(an.id, 'claude-sonnet-5'), effort: { mode: 'provider_default' } });
  assert.deepEqual(await voice(), { status: 'disabled', modelOrigin: { scope: 'default' }, reason: 'unsupported' });
  // A transcription model of its own works whatever the agent runs on.
  await set(db, admin, { scope: 'group', target: 'transcription', model: explicit(oa.id, 'gpt-4o-transcribe'), effort: inherit });
  assert.equal((await voice() as { connectionId: string }).connectionId, oa.id);
  await set(db, admin, { scope: 'group', target: 'transcription', model: { mode: 'disabled' }, effort: inherit });
  await assert.rejects(resolveTaskModelFromDatabase(db, key, 'transcription.voice_note'), (error) => error instanceof AiConnectionError && error.code === 'task_disabled');
});

test('a chosen connection that becomes unavailable fails with its reason instead of moving to another provider', async () => {
  const { db, admin, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  await createAiConnection(db, key, admin, { name: 'Anthropic', provider: 'anthropic', apiKey: 'sk-an' });
  await set(db, admin, { scope: 'group', target: 'summary', model: explicit(oa.id, 'gpt-6-luna'), effort: { mode: 'explicit', value: 'medium' } });
  await updateAiConnection(db, key, admin, oa.id, { enabled: false });
  await assert.rejects(resolveTaskModelFromDatabase(db, key, 'summary.email_digest'),
    (error) => error instanceof AiConnectionError && error.code === 'unavailable' && /Resumo e texto curto está desativada/.test(error.message));
  // Unassigned tasks still resolve: absence is not breakage.
  assert.equal((await resolveTaskModelFromDatabase(db, key, 'agent.chat')).provider, 'anthropic');
  const overview = await assignmentOverview(db);
  assert.equal(overview.groups.find(group => group.key === 'summary')?.plan.status, 'unavailable');
  assert.equal(planGroup('summary', await loadAssignmentSnapshot(db)).status, 'unavailable');
});

// ---------- Administration ----------

test('assignments are validated against the task\'s kind, the provider\'s effort and the connection', async () => {
  const { db, admin, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa-secret' });
  const gg = await createAiConnection(db, key, admin, { name: 'Google', provider: 'google', apiKey: 'sk-gg' });
  const off = await createAiConnection(db, key, admin, { name: 'Desativada', provider: 'openai', apiKey: 'sk-off', enabled: false });
  const invalid = (message: RegExp, code = 'invalid') => (error: unknown) => error instanceof AiConnectionError && error.code === code && message.test(error.message);
  await assert.rejects(set(db, admin, { scope: 'task', target: 'agent.unknown', model: inherit, effort: inherit }), invalid(/desconhecida/));
  await assert.rejects(set(db, admin, { scope: 'group', target: 'agent', model: explicit(off.id, 'gpt-6-sol'), effort: inherit }), invalid(/Ative a conexão/, 'disabled'));
  await assert.rejects(set(db, admin, { scope: 'group', target: 'agent', model: explicit(oa.id, 'gpt-4o-mini-transcribe'), effort: inherit }), invalid(/modelo de conversa/));
  await assert.rejects(set(db, admin, { scope: 'group', target: 'transcription', model: explicit(oa.id, 'gpt-6-sol'), effort: inherit }), invalid(/modelo de transcrição/));
  await set(db, admin, { scope: 'group', target: 'transcription', model: explicit(gg.id, 'gemini-2.5-flash'), effort: inherit });
  await assert.rejects(set(db, admin, { scope: 'group', target: 'transcription', model: explicit(gg.id, 'gemini-2.5-flash'), effort: { mode: 'explicit', value: 'low' } }), invalid(/não usa esforço/));
  await assert.rejects(set(db, admin, { scope: 'group', target: 'agent', model: { mode: 'disabled' }, effort: inherit }), invalid(/não pode ser desativada/));
  await assert.rejects(set(db, admin, { scope: 'group', target: 'agent', model: explicit(gg.id, 'gemini-2.5-pro'), effort: { mode: 'explicit', value: 'high' } }), invalid(/esforço padrão/));

  // Inheriting both removes the row, and every change is audited without secrets.
  await set(db, admin, { scope: 'task', target: 'summary.email_thread', model: explicit(oa.id, 'gpt-6-luna'), effort: { mode: 'explicit', value: 'minimal' } });
  await set(db, admin, { scope: 'task', target: 'summary.email_thread', model: inherit, effort: inherit });
  assert.equal(await db.prepare("SELECT 1 FROM ai_model_assignment WHERE scope='task' AND target='summary.email_thread'").get(), undefined);
  const audits = await db.prepare("SELECT connection_id, details_json FROM platform_audit_log WHERE action='ai_assignment.updated' ORDER BY created_at, id").all() as Array<{ connection_id: string | null; details_json: string }>;
  const last = JSON.parse(audits.at(-1)!.details_json);
  assert.deepEqual([last.scope, last.target, last.before.modelId, last.before.reasoningEffort, last.after], ['task', 'summary.email_thread', 'gpt-6-luna', 'minimal', null]);
  assert.equal(JSON.stringify(audits).includes('sk-oa'), false);
});

test('the assignment test probes the resolved model by the task\'s kind and never echoes the provider', async () => {
  const { db, admin, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  await set(db, admin, { scope: 'group', target: 'agent', model: explicit(oa.id, 'gpt-6-sol'), effort: { mode: 'explicit', value: 'high' } });
  const probes: string[] = [];
  const probe = async (config: { apiKey: string; modelId: string; effort: string | null }, execution: string) => { probes.push(`${config.apiKey}:${config.modelId}:${config.effort}:${execution}`); };
  assert.deepEqual(await testModelAssignment(db, key, admin, { scope: 'group', target: 'agent' }, probe), { provider: 'openai', modelId: 'gpt-6-sol', effort: 'high' });
  await testModelAssignment(db, key, admin, { scope: 'task', target: 'extraction.annex_plan' }, probe);
  await testModelAssignment(db, key, admin, { scope: 'task', target: 'transcription.voice_note' }, probe);
  assert.deepEqual(probes, ['sk-oa:gpt-6-sol:high:tool_agent', 'sk-oa:gpt-6-sol:xhigh:structured', 'sk-oa:gpt-4o-mini-transcribe:null:transcription']);
  await assert.rejects(testModelAssignment(db, key, admin, { scope: 'group', target: 'agent' }, async () => { throw new Error('401 sk-oa leaked'); }),
    (error) => error instanceof AiConnectionError && error.code === 'provider' && !error.message.includes('sk-'));
});

// ---------- Runs keep the models they were queued with ----------

test('a queued run keeps its pinned models, and its connection cannot be deleted or change provider under it', async () => {
  const { db, admin, office, key } = await fixture();
  const oa = await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  const an = await createAiConnection(db, key, admin, { name: 'Anthropic', provider: 'anthropic', apiKey: 'sk-an' });
  await set(db, admin, { scope: 'group', target: 'extraction', model: explicit(oa.id, 'gpt-6-luna'), effort: { mode: 'explicit', value: 'medium' } });
  const plan = pinRunModelPlan(await loadAssignmentSnapshot(db), ['extraction.chronology_facts', 'extraction.chronology_review']);
  assert.deepEqual(plan.tasks['extraction.chronology_facts'], { connectionId: oa.id, provider: 'openai', modelId: 'gpt-6-luna', effort: 'medium' });
  const runId = randomUUID();
  await db.prepare("INSERT INTO ai_run (id, office_id, user_id, kind, input, status, model_provider, model_id, model_plan) VALUES (?, ?, ?, 'chronology', '{}', 'queued', 'openai', 'gpt-6-luna', ?)")
    .run(runId, office, admin, JSON.stringify(plan));
  const stored = (await db.prepare('SELECT model_plan FROM ai_run WHERE id = ?').get(runId))!.model_plan;

  // The administration moves on; the run does not.
  await set(db, admin, { scope: 'group', target: 'extraction', model: explicit(an.id, 'claude-sonnet-5'), effort: { mode: 'provider_default' } });
  await updateAiConnection(db, key, admin, oa.id, { apiKey: 'sk-oa-rotated' });
  const pinned = await resolvePinnedTaskModel(db, key, stored, 'extraction.chronology_facts');
  assert.deepEqual([pinned.modelId, pinned.apiKey, pinned.effort, pinned.modelSource], ['gpt-6-luna', 'sk-oa-rotated', 'medium', 'run']);

  assert.deepEqual(await connectionReferences(db, oa.id), { assignments: [], runs: 1 });
  await assert.rejects(deleteAiConnection(db, admin, oa.id), (error) => error instanceof AiConnectionError && error.code === 'in_use' && /em andamento/.test(error.message));
  await assert.rejects(updateAiConnection(db, key, admin, oa.id, { provider: 'openrouter' }), (error) => error instanceof AiConnectionError && error.code === 'in_use');

  // Disabling is allowed, and stops the run with its reason.
  await updateAiConnection(db, key, admin, oa.id, { enabled: false });
  await assert.rejects(resolvePinnedTaskModel(db, key, stored, 'extraction.chronology_facts'), (error) => error instanceof AiConnectionError && error.code === 'unavailable');
  // A plan from an unknown format is refused rather than guessed.
  await assert.rejects(resolvePinnedTaskModel(db, key, { version: 2, tasks: {} }, 'extraction.chronology_facts'), (error) => error instanceof AiConnectionError && error.code === 'unavailable');

  // Once the run is over, the connection is free.
  await db.prepare("UPDATE ai_run SET status = 'completed' WHERE id = ?").run(runId);
  await deleteAiConnection(db, admin, oa.id);
});

test('runs queued before 0030 keep their provider and model, with the effort OpenAI calls carried then', async () => {
  const { db, admin, key } = await fixture();
  await createAiConnection(db, key, admin, { name: 'OpenAI', provider: 'openai', apiKey: 'sk-oa' });
  const legacyRun = await resolveLegacyRunModel(db, key, 'drafting.section', 'openai', 'gpt-6-sol');
  assert.deepEqual([legacyRun.modelId, legacyRun.apiKey, legacyRun.effort], ['gpt-6-sol', 'sk-oa', 'xhigh']);
  await assert.rejects(resolveLegacyRunModel(db, key, 'drafting.section', 'anthropic', 'claude-sonnet-5'), (error) => error instanceof AiConnectionError && error.code === 'unavailable');
});

// ---------- The guard is measured without changing it ----------

test('a measured model reports usage from generated and streamed answers, through a Mastra agent', async () => {
  const usage = { inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 7, text: 7, reasoning: 0 } };
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }) as never,
    doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'ok' }, { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ] }) }) as never,
  });
  const seen: unknown[] = [];
  const measured = measuredModel(model, reported => seen.push(reported));
  // The detector's own agent answers with structured output, as here.
  const agent = new Agent({ id: 'k5', name: 'Tises', instructions: 'Teste.', model: measured as never });
  new Mastra({ agents: { k5: agent }, logger: noopLogger });
  const result = await agent.generate('Responda.', { structuredOutput: { schema: z.object({ ok: z.boolean() }) } });
  assert.deepEqual(result.object, { ok: true });
  assert.deepEqual(seen, [{ inputTokens: 120, outputTokens: 7 }]);
  // A streamed answer reports on its finish part, and every part still reaches the reader.
  const { stream } = await measured.doStream({ prompt: [] } as never) as { stream: ReadableStream<{ type: string }> };
  const types: string[] = [];
  for await (const part of stream as unknown as AsyncIterable<{ type: string }>) types.push(part.type);
  assert.deepEqual(types, ['stream-start', 'text-start', 'text-delta', 'text-end', 'finish']);
  assert.deepEqual(seen, [{ inputTokens: 120, outputTokens: 7 }, { inputTokens: 120, outputTokens: 7 }]);
});

test('a failed guard model resolution is retried on the next check instead of staying cached for the turn', async () => {
  let attempts = 0;
  const detect = injectionDetector(async () => { attempts += 1; throw new AiConnectionError('credential', 'Chave ilegível.'); });
  await assert.rejects(detect('Texto de terceiros.'), AiConnectionError);
  await assert.rejects(detect('Outro texto de terceiros.'), AiConnectionError);
  assert.equal(attempts, 2);
});

// ---------- The administration says what a change reaches ----------

test('changing the agent warns that the voice note follows it until transcription has a model', async () => {
  const { reach } = await import('../src/components/ai-task-models');
  const agent = { scope: 'group' as const, target: 'agent' };
  const none = new Map();
  assert.equal(reach(agent, none).voiceNote, true);
  assert.ok(!reach(agent, none).items.some(item => item.task === 'transcription.voice_note'), 'transcription is not in the agent chain');
  assert.equal(reach({ scope: 'group', target: 'extraction' }, none).voiceNote, false);
  const own = new Map([['group:transcription', { model: { mode: 'explicit' as const, connectionId: 'c', modelId: 'gpt-4o-mini-transcribe' }, effort: { mode: 'inherit' as const, value: null }, updatedAt: '' }]]);
  assert.equal(reach(agent, own).voiceNote, false);
});
