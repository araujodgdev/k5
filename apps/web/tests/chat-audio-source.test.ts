import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { authStore, withPostgres } from '../src/lib/database';
import { requestHeaders } from './support/request-headers';
import { createConversation, conversation } from '../src/lib/ai-store';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';
import { saveInstruction } from '../src/lib/agent-instructions';
import { memoryResource } from '../src/lib/agent-memory';
import { approvalPreview } from '../src/lib/case-pages/service';
import { decideAgentApproval } from '../src/lib/application/agent-approvals';

process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'next/headers' ? { url: new URL('./support/request-headers.ts', import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
after(() => hooks.deregister());

function streamed(step: number, call?: { name: string; input: unknown }) {
  const item = call ? { type: 'function_call', id: `fc_${step}`, call_id: `call_${step}`, name: call.name, arguments: JSON.stringify(call.input), status: 'completed' }
    : { type: 'message', id: `msg_${step}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Confira a proposta.', annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: `resp_${step}`, created_at: 1, model: 'gpt-6-luna' } },
    { type: 'response.output_item.added', output_index: 0, item: call ? { ...item, arguments: '' } : item },
    ...(call ? [{ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: JSON.stringify(call.input) }]
      : [{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, delta: 'Confira a proposta.' }]),
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

test('authenticated HTTP: authenticated voice instruction reaches the shared provider request', async t => {
  const pool = await authStore();
  (globalThis as typeof globalThis & { k5Postgres?: { database: typeof db; store: typeof pool } }).k5Postgres = { database: db, store: pool };
  const { auth } = await import('../src/lib/auth');
  const { POST } = await import('../src/app/api/chat/route');
  const origin = 'http://localhost:3000';
  const signup = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Pessoa', officeName: 'Fontes HTTP', email: `${randomUUID()}@test.local`, password: 'Http-Sources-2026!' }),
  })));
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const { user } = await signup.json();
  const member = await db.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(user.id);
  const owner = { officeId: member!.office_id, userId: user.id };
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, owner.officeId, 'Caso HTTP', user.id);
  const { id } = await createConversation(db, owner);
  await db.prepare('UPDATE ai_conversation SET messages=? WHERE id=?').run(JSON.stringify([
    { id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'PRIVATE_TRANSCRIPT_SENTINEL' }, { type: 'data-approval', data: { summary: 'PRIVATE_PREVIEW_SENTINEL' } }] },
  ]), id);
  await db.prepare('INSERT INTO mastra_resources(id,"workingMemory","createdAt","updatedAt") VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .run(memoryResource(owner), 'PRIVATE_MEMORY_SENTINEL: prefere respostas curtas.');
  await saveInstruction(owner, 'personal', { title: 'Tom', content: 'ELIGIBLE_STYLE_SENTINEL', appliesTo: 'all', enabled: true });
  await saveInstruction({ ...owner, invocation: 'agent' }, 'personal', { title: 'Regra privada', content: 'PRIVATE_SETTING_SENTINEL', appliesTo: 'all', enabled: true });
  const connection = await createAiConnection(db, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), user.id,
    { name: 'Provider HTTP', provider: 'cliproxyapi', apiKey: 'synthetic-http-key' });
  for (const target of ['agent.chat', 'drafting.section']) await updateModelAssignment(db, user.id,
    { scope: 'task', target, model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  const voiceConnection = await createAiConnection(db, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), user.id,
    { name: 'Voice repro', provider: 'openai', apiKey: 'synthetic-voice-key' });
  await updateModelAssignment(db, user.id, { scope: 'task', target: 'transcription.voice_note', model: { mode: 'explicit', connectionId: voiceConnection.id, modelId: 'whisper-1' }, effort: { mode: 'provider_default' } });
  const wire: { body: Record<string, unknown>; session: string | null }[] = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF8cAAAAASUVORK5CYII=', 'base64');
  const originalFetch = globalThis.fetch;
  let step = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith('data:')) return originalFetch(input, init);
    if (request.url === 'https://api.openai.com/v1/audio/transcriptions') return Response.json({ text: 'PERSON_AUDIO_SENTINEL: inclua o prazo de quinze dias no resumo.' });
    assert.equal(request.url, 'https://api.lume.software/v1/responses');
    const body = await request.json(); wire.push({ body, session: request.headers.get('session-id') });
    if (!body.stream) return Response.json({ id: 'resp_writer', object: 'response', created_at: 1, model: 'gpt-6-luna', status: 'completed',
      output: [{ type: 'message', id: 'msg_writer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ title: 'Proposta HTTP', content: 'EXACT_HTTP_PROPOSAL' }), annotations: [] }] }],
      usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } });
    step++;
    if (step === 1) return streamed(step, { name: 'k5_tools_select_modules', input: { modules: ['case_pages'] } });
    if (step === 2) return streamed(step, { name: 'k5_case_pages_create', input: { caseId, folderId: null, title: 'PRIVATE_PLANNER_SENTINEL', content: 'PRIVATE_PLAN_SENTINEL' } });
    assert.ok(step <= 3, 'the real runtime completed without an extra tool loop');
    return streamed(step);
  });
  const headers = new Headers({ origin, cookie, 'content-type': 'application/json' });
  const response = await withPostgres(pool, () => requestHeaders.run(headers, () => POST(new Request(`${origin}/api/chat`, {
    method: 'POST', headers, body: JSON.stringify({ conversationId: id, caseId, documentIds: [], researchReferenceIds: [], attachments: [{ mediaType: 'audio/ogg', data: Buffer.from('synthetic audio').toString('base64') }, { mediaType: 'image/png', data: png.toString('base64') }],
      message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'PERSON_HTTP_SENTINEL: crie uma página com um resumo.' }] } }),
  }))));
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /data-approval/);
  const privateRequest = JSON.stringify(wire.find(item => item.body.stream)?.body);
  assert.match(privateRequest, /PERSON_AUDIO_SENTINEL/);
  assert.match(privateRequest, /PRIVATE_TRANSCRIPT_SENTINEL/);
  assert.match(privateRequest, /PRIVATE_MEMORY_SENTINEL/);
  assert.match(privateRequest, /PRIVATE_SETTING_SENTINEL/);
  assert.doesNotMatch(privateRequest, /PRIVATE_PREVIEW_SENTINEL/);
  const writer = wire.filter(item => !item.body.stream);
  assert.equal(writer.length, 1);
  assert.ok(JSON.stringify(writer[0].body).includes(png.toString('base64')), 'The final shared provider request retains the inline image bytes');
  const submission = await db.prepare('SELECT request_text FROM content_submission WHERE conversation_id=?').get<{ request_text: string }>(id);
  console.log(JSON.stringify({ audioReachedPrivate: privateRequest.includes('PERSON_AUDIO_SENTINEL'), audioCapturedSubmission: submission!.request_text.includes('PERSON_AUDIO_SENTINEL'), audioReachedSharedWriter: JSON.stringify(writer[0].body).includes('PERSON_AUDIO_SENTINEL') }));
  assert.equal(JSON.stringify(writer[0].body).includes('PERSON_AUDIO_SENTINEL'), true, 'The shared writer must receive the actual authenticated voice instruction');
  assert.match(JSON.stringify(writer[0].body), /PERSON_HTTP_SENTINEL/);
  assert.match(JSON.stringify(writer[0].body), /ELIGIBLE_STYLE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(writer[0].body), /PRIVATE_|previous_response_id|item_reference/);
  assert.deepEqual(writer[0].body.tools ?? [], []);
  assert.equal(writer[0].body.store, false);
  assert.match(writer[0].session!, /^lume-task-/);
  const stored = await conversation(db, owner, id);
  const part = stored!.messages.at(-1)!.parts.find(p => p.type === 'data-approval')!;
  const approvalId = (part as { data: { approvalId: string } }).data.approvalId;
  assert.equal((await approvalPreview(owner, approvalId)).content, 'EXACT_HTTP_PROPOSAL');
  assert.equal((await decideAgentApproval(owner, approvalId, 'confirm')).state, 'confirmed');
  const page = await db.prepare('SELECT content FROM case_page WHERE case_id=?').get<{ content: string }>(caseId);
  assert.equal(page!.content, 'EXACT_HTTP_PROPOSAL');
});
