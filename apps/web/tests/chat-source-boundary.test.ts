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
import { PDFDocument } from 'pdf-lib';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument } from '../src/lib/vault';
import { personPolicy } from '../src/lib/content-policy';
import { LEGAL_VERSION } from '../src/lib/legal-version';

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

test('authenticated HTTP chat keeps personalization privately and creates an exact bounded proposal through the real tool and provider runtime', async t => {
  const pool = await authStore();
  (globalThis as typeof globalThis & { k5Postgres?: { database: typeof db; store: typeof pool } }).k5Postgres = { database: db, store: pool };
  const { auth } = await import('../src/lib/auth');
  const { POST } = await import('../src/app/api/chat/route');
  const origin = 'http://localhost:3000';
  const signup = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Pessoa', officeName: 'Fontes HTTP', email: `${randomUUID()}@test.local`, password: 'Http-Sources-2026!', acceptedLegalVersion: LEGAL_VERSION }),
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
  const wire: { body: Record<string, unknown>; session: string | null }[] = [];
  let step = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
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
    method: 'POST', headers, body: JSON.stringify({ conversationId: id, caseId, documentIds: [], researchReferenceIds: [],
      message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'PERSON_HTTP_SENTINEL: crie uma página com um resumo.' }] } }),
  }))));
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /data-approval/);
  const privateRequest = JSON.stringify(wire.find(item => item.body.stream)?.body);
  assert.match(privateRequest, /PRIVATE_TRANSCRIPT_SENTINEL/);
  assert.match(privateRequest, /PRIVATE_MEMORY_SENTINEL/);
  assert.match(privateRequest, /PRIVATE_SETTING_SENTINEL/);
  assert.doesNotMatch(privateRequest, /PRIVATE_PREVIEW_SENTINEL/);
  const writer = wire.filter(item => !item.body.stream);
  assert.equal(writer.length, 1);
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
  const { DELETE } = await import('../src/app/api/conversations/[id]/route');
  const removed = await withPostgres(pool, () => requestHeaders.run(headers, () => DELETE(new Request(`${origin}/api/conversations/${id}`, { method: 'DELETE', headers }), { params: Promise.resolve({ id }) })));
  assert.equal(removed.status, 204);
  assert.ok(await db.prepare('SELECT 1 FROM case_page WHERE case_id=?').get(caseId));
  assert.equal(await db.prepare('SELECT 1 FROM content_generation_attempt WHERE office_id=?').get(owner.officeId), undefined);
});

test('authenticated private case chat admits queued original PDF and failed metadata without stale extracted text', async t => {
  const pool = await authStore();
  const { auth } = await import('../src/lib/auth'), { POST } = await import('../src/app/api/chat/route');
  const origin = 'http://localhost:3000';
  const signup = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', headers: { origin, 'cf-connecting-ip': '10.77.1.1', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Pessoa', officeName: 'Chat privado', email: `${randomUUID()}@test.local`, password: 'Http-Private-2026!', acceptedLegalVersion: LEGAL_VERSION }) })));
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), { user } = await signup.json();
  const member = await db.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(user.id);
  const owner = { officeId: member!.office_id, userId: user.id }, caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, owner.officeId, 'Chat com processamento pendente', user.id);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  const upload = await createUploadRef(owner, new File([new Uint8Array(bytes)], 'pendente.pdf', { type: 'application/pdf' }));
  const queued = await createVaultDocument(owner, upload, { scope: 'case', caseId, policy: personPolicy('', '') });
  const failedRef = await createUploadRef(owner, new File(['Original sem extração'], 'falhou.txt', { type: 'text/plain' }));
  const failed = await createVaultDocument(owner, failedRef, { scope: 'case', caseId, policy: personPolicy('', '') });
  await db.prepare("UPDATE vault_document SET status='failed' WHERE id=?").run(failed.id);
  for (const doc of [queued, failed]) await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)')
    .run(randomUUID(), doc.id, owner.officeId, 'linha:1', 'STALE_EXTRACTION_MUST_NOT_ENTER_PROVIDER');
  const connection = await createAiConnection(db, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), user.id, { name: 'Native PDF provider', provider: 'openai', apiKey: 'synthetic-native-pdf' });
  await updateModelAssignment(db, user.id, { scope: 'task', target: 'agent.chat', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-5' }, effort: { mode: 'provider_default' } });
  const wire: Record<string, unknown>[] = [], localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init); if (request.url.startsWith('data:')) return localFetch(request);
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    wire.push(await request.json()); return streamed(wire.length);
  });
  const headers = new Headers({ origin, cookie, 'cf-connecting-ip': '10.77.1.1', 'content-type': 'application/json' });
  async function chat(documentIds: string[]) {
    const conversation = await createConversation(db, owner);
    return { id: conversation.id, response: await withPostgres(pool, () => requestHeaders.run(headers, () => POST(new Request(`${origin}/api/chat`, { method: 'POST', headers,
      body: JSON.stringify({ conversationId: conversation.id, caseId, documentIds, researchReferenceIds: [], message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Olá, podemos conversar sobre o caso?' }] } }) })))) };
  }
  const explicit = await chat([queued.id]); assert.notEqual(explicit.response.status, 200); assert.equal(wire.length, 0);
  const ordinary = await chat([]); assert.equal(ordinary.response.status, 200);
  const output = await ordinary.response.text(); assert.match(output, /Confira a proposta/); assert.doesNotMatch(output, /error-message/);
  assert.equal(wire.length, 1);
  const admitted = JSON.stringify(wire[0]);
  assert.match(admitted, /pendente.pdf|falhou.txt/); assert.doesNotMatch(admitted, /STALE_EXTRACTION_MUST_NOT_ENTER_PROVIDER/);
  assert.ok(admitted.includes(Buffer.from(bytes).toString('base64')), 'native PDF admission uses the observed original bytes');
  const stored = await conversation(db, owner, ordinary.id);
  const policy = (stored!.messages.at(-1)!.metadata as { contentPolicy: { observed: { id: string; version: string }[] } }).contentPolicy;
  assert.ok(policy.observed.some(pin => pin.id === queued.id && pin.version === '1'));
  assert.ok(policy.observed.some(pin => pin.id === failed.id && pin.version === '1'));
});
