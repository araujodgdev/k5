import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChatRun, followable } from '../src/lib/chat-run';
import { AgentTrace, sweepAgentTraces } from '../src/lib/observability/agent-trace';
import { agentTraceDetail, listAgentTraces } from '../src/lib/agent-traces';
import { createConversation } from '../src/lib/ai-store';

async function read(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

test('chat run: a follower that joins late gets the whole turn, then the rest live', async () => {
  const run = new ChatRun();
  run.push({ type: 'start', messageId: 'answer-1' });
  run.push({ type: 'text-start', id: 'p' });
  run.push({ type: 'text-delta', id: 'p', delta: 'Olá' });
  // The page that sent the message went away; a reopened page follows from the start.
  const late = read(run.follow());
  run.push({ type: 'text-delta', id: 'p', delta: ', tudo certo.' });
  run.push({ type: 'text-end', id: 'p' });
  run.push({ type: 'finish' });
  run.finish();
  const body = await late;
  assert.match(body, /"messageId":"answer-1"/);
  assert.match(body, /"delta":"Olá"[^]*"delta":", tudo certo\."/);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(run.messageId, 'answer-1');
});

test('chat run: a page that already shows the finished answer gets nothing to replay', async () => {
  const run = new ChatRun();
  run.push({ type: 'start', messageId: 'answer-2' });
  assert.ok(followable(run, 'question-2'), 'still running: the page follows it');
  run.finish();
  assert.equal(followable(run, 'answer-2'), null);
  assert.ok(followable(run, 'question-2'), 'finished, but the page has not seen the answer yet');
  assert.equal(followable(undefined), null);
});

test('agent trace: events with content stay in PostgreSQL, readable by the platform and swept after 30 days', async () => {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogada');
  const conversation = await createConversation(testDb, { officeId, userId });
  const trace = new AgentTrace({ officeId, userId }, { conversationId: conversation.id, task: 'chat', provider: 'openai', modelId: 'gpt-test' });
  await trace.open();
  trace.stepStarted();
  trace.toolCall('call-1', 'web_search', { query: 'guarda de menor pelos avós' }, true);
  trace.toolResult('call-1', 'web_search', { sources: [{ url: 'https://stj.jus.br/x' }], big: 'x'.repeat(40_000) }, false);
  trace.stepFinished({ reason: 'tool-calls', usage: { inputTokens: 120, outputTokens: 30 } });
  await trace.close('failed', { inputTokens: 120, outputTokens: 30 }, new TypeError('provider exploded'));

  const [row] = (await listAgentTraces(testDb)).filter(item => item.id === trace.id);
  assert.equal(row.status, 'failed');
  assert.equal(row.steps, 1); assert.equal(row.toolCalls, 1); assert.equal(row.inputTokens, 120);
  assert.equal(row.error, 'TypeError');
  const detail = await agentTraceDetail(testDb, trace.id);
  assert.deepEqual(detail?.events.map(event => [event.kind, event.name]), [
    ['tool-call', 'web_search'], ['tool-result', 'web_search'], ['step', 'tool-calls'], ['error', 'TypeError']]);
  assert.match(detail!.events[0].data, /guarda de menor/);
  assert.match(detail!.events[1].data, /"truncated":true/, 'a large result is cut, not stored whole');
  assert.ok(detail!.events[1].data.length < 17_000);

  await sweepAgentTraces(Date.now() + 31 * 86_400_000);
  assert.equal(await agentTraceDetail(testDb, trace.id), null);
});
