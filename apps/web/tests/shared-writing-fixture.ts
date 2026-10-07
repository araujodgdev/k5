import './test-setup';
import { testDb } from './test-setup';
import { randomUUID } from 'node:crypto';
import { createConversation } from '../src/lib/ai-store';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import type { WorkspaceContext } from '../src/lib/application/context';
import type { TestContext } from 'node:test';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';

export async function recordingWriter(t: TestContext, actor: string, outputs: object[]) {
  const connection = await testDb.prepare('SELECT id FROM ai_connection WHERE name=?').get<{ id: string }>(`Writer fixture ${actor}`) ?? await createAiConnection(testDb, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), actor,
    { name: `Writer fixture ${actor}`, provider: 'cliproxyapi', apiKey: 'synthetic-writer-key' });
  await updateModelAssignment(testDb, actor, { scope: 'task', target: 'drafting.section', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  const requests: { url: string; session: string | null; body: Record<string, unknown> }[] = [];
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith('data:')) return localFetch(request);
    if (request.url !== 'https://api.lume.software/v1/responses') throw new Error(`Unexpected network request: ${request.url}`);
    requests.push({ url: request.url, session: request.headers.get('session-id'), body: await request.json() });
    const output = outputs.shift();
    if (!output) throw new Error('No more provider fixture outputs.');
    return Response.json({ id: `resp_${requests.length}`, object: 'response', created_at: 1, model: 'gpt-6-luna', status: 'completed',
      output: [{ type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
    });
  });
  return requests;
}

export async function personRequestContext(context: WorkspaceContext, text: string) {
  const conversation = await createConversation(testDb, context);
  const scope = await authorizeMessageScope(context, { documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(context, conversation.id, randomUUID(), text, scope, []);
  return { ...context, conversationId: conversation.id, generationId: randomUUID(), submissionId };
}
