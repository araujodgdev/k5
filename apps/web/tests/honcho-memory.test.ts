import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { testDatabase as db } from './test-setup';
import { describeMemory, clearMemory, forgetThread } from '../src/lib/agent-memory';
import { drainHonchoOutbox, honchoContext, honchoSession, honchoWorkspace, honchoConfig, queueMemoryChange } from '../src/lib/honcho-memory';

/** A stand-in for Honcho's v3 REST API: just the calls the Lume makes, recorded for the asserts. */
type Call = { method: string; path: string; body: unknown };
const calls: Call[] = [];
const messages = new Map<string, Array<{ peer_id: string; content: string; metadata: Record<string, unknown> }>>();
let failNextMessage: 'lose-answer' | 'reject' | null = null;
let contextDelay = 0;
// Holds the next message write until released, to forget while a send is on its way.
let messageGate: Promise<void> | null = null;
const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
  const path = request.url!.split('?')[0];
  calls.push({ method: request.method!, path, body });
  assert.equal(request.headers.authorization, 'Bearer honcho-test-key');
  const json = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const session = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions\/([^/]+)\/messages(\/list)?$/);
  if (session && request.method === 'POST' && session[3]) {
    const eventId = (body as { filters: { metadata: { event_id: string } } }).filters.metadata.event_id;
    return json({ items: (messages.get(session[2]) ?? []).filter(item => item.metadata.event_id === eventId) });
  }
  if (session && request.method === 'POST') {
    if (failNextMessage === 'reject') { failNextMessage = null; return json({ detail: 'invalid' }, 422); }
    if (messageGate) { const gate = messageGate; messageGate = null; await gate; }
    messages.set(session[2], [...(messages.get(session[2]) ?? []), ...(body as { messages: [] }).messages]);
    // Accepted remotely, but the answer never reaches the Lume.
    if (failNextMessage === 'lose-answer') { failNextMessage = null; request.socket.destroy(); return; }
    return json([{ id: randomUUID() }]);
  }
  if (path.endsWith('/peers/pessoa/context')) {
    if (contextDelay) await new Promise(resolve => setTimeout(resolve, contextDelay));
    return json({ peer_id: 'pessoa', target_id: 'pessoa', representation: 'Atua em direito societário.', peer_card: ['Prefere respostas curtas'] });
  }
  if (path.endsWith('/peers/pessoa/card')) return json({ peer_card: ['Prefere respostas curtas'] });
  if (path.endsWith('/sessions/list')) return json({ items: [{ id: 'conversa-antiga' }] });
  if (request.method === 'DELETE') return json({}, 202);
  return json({ id: 'ok' });
});

let previous: Record<string, string | undefined> = {};
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  previous = { HONCHO_API_KEY: process.env.HONCHO_API_KEY, HONCHO_URL: process.env.HONCHO_URL, HONCHO_ENVIRONMENT: process.env.HONCHO_ENVIRONMENT };
  process.env.HONCHO_API_KEY = 'honcho-test-key';
  process.env.HONCHO_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.HONCHO_ENVIRONMENT = 'test';
});
after(() => {
  for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  server.close();
});

async function owner() {
  const officeId = randomUUID(), userId = randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Memória');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Teste');
  return { officeId, userId };
}
const memory = (...lines: string[]) => `# Memória do Lume\n## Como a pessoa prefere trabalhar\n- Tom, tamanho e formato das respostas:\n${lines.join('\n')}`;
const outbox = (context: { officeId: string; userId: string }) => db.prepare('SELECT state, content, attempts FROM honcho_outbox WHERE office_id=? AND user_id=? ORDER BY created_at')
  .all<{ state: string; content: string; attempts: number }>(context.officeId, context.userId);

test('only new personal statements are queued and delivered once, to an opaque session that observes only the person', async () => {
  const context = await owner(), conversationId = randomUUID();
  assert.equal(await queueMemoryChange(context, conversationId, memory('- Prefere respostas curtas.')), true);
  assert.equal(await queueMemoryChange(context, conversationId, memory('- Prefere respostas curtas.')), false);
  assert.equal(await queueMemoryChange(context, conversationId, memory('- Prefere respostas curtas.', '- Atua em direito societário.')), true);
  assert.deepEqual((await outbox(context)).map(row => row.content.split('\n').slice(1)), [['- Prefere respostas curtas.'], ['- Atua em direito societário.']]);

  assert.deepEqual(await drainHonchoOutbox({ owner: context }), { delivered: 2, pending: 0, deletions: 0 });
  const config = honchoConfig()!;
  const workspace = honchoWorkspace(config, context, 1), session = honchoSession(context, conversationId);
  assert.match(workspace, /^lume-test-[0-9a-f]{32}$/);
  assert.ok(!workspace.includes(context.officeId) && !session.includes(conversationId));
  const created = calls.find(call => call.path === `/v3/workspaces/${workspace}/sessions` && call.method === 'POST');
  assert.deepEqual((created?.body as { peers: unknown }).peers, { pessoa: { observe_me: true, observe_others: false }, lume: { observe_me: false, observe_others: false } });
  const sent = messages.get(session)!;
  assert.equal(sent.length, 2);
  assert.ok(sent.every(item => item.peer_id === 'pessoa' && item.metadata.source === 'lume_working_memory'));
  assert.deepEqual((await outbox(context)).map(row => row.state), ['delivered', 'delivered']);
});

test('a send whose answer was lost is reconciled by its event id instead of being sent twice', async () => {
  const context = await owner(), conversationId = randomUUID();
  await queueMemoryChange(context, conversationId, memory('- Pede para lembrar o prazo de recurso em 15 dias.'));
  failNextMessage = 'lose-answer';
  assert.equal((await drainHonchoOutbox({ owner: context })).pending, 1);
  assert.equal((await outbox(context))[0].state, 'uncertain');
  assert.equal((await drainHonchoOutbox({ owner: context })).delivered, 1);
  assert.equal(messages.get(honchoSession(context, conversationId))!.length, 1);

  await queueMemoryChange(context, conversationId, memory('- Pede para lembrar o prazo de recurso em 15 dias.', '- Usa tratamento formal.'));
  failNextMessage = 'reject';
  await drainHonchoOutbox({ owner: context });
  assert.equal((await outbox(context))[1].state, 'pending');
  await drainHonchoOutbox({ owner: context });
  assert.equal((await outbox(context))[1].state, 'delivered');
});

test('the learned context is fallible, bounded in time and absent without a key', async () => {
  const context = await owner();
  assert.match(await honchoContext(context), /podem estar erradas[\s\S]*- Prefere respostas curtas[\s\S]*direito societário/);
  assert.deepEqual((await describeMemory(context)).inferred, ['Prefere respostas curtas']);
  contextDelay = 2_500;
  const started = Date.now();
  assert.equal(await honchoContext(context), '');
  assert.ok(Date.now() - started < 2_400);
  contextDelay = 0;
  const key = process.env.HONCHO_API_KEY;
  delete process.env.HONCHO_API_KEY;
  try {
    assert.equal(await honchoContext(context), '');
    assert.equal(await queueMemoryChange(context, randomUUID(), memory('- Algo novo.')), false);
  } finally { process.env.HONCHO_API_KEY = key; }
});

test('forgetting starts a new generation, drops what was queued and deletes the old workspace and deleted conversations', async () => {
  const context = await owner(), conversationId = randomUUID();
  await queueMemoryChange(context, conversationId, memory('- Prefere petições objetivas.'));
  await drainHonchoOutbox({ owner: context });
  const config = honchoConfig()!, oldWorkspace = honchoWorkspace(config, context, 1);
  await queueMemoryChange(context, conversationId, memory('- Prefere petições objetivas.', '- Atua no TJSP.'));
  await clearMemory(context);
  assert.deepEqual((await outbox(context)).map(row => [row.state, row.content]), [['delivered', (await outbox(context))[0].content], ['discarded', '']]);
  assert.equal((await db.prepare('SELECT generation FROM honcho_memory WHERE office_id=? AND user_id=?').get<{ generation: number }>(context.officeId, context.userId))?.generation, 2);

  await queueMemoryChange(context, conversationId, memory('- Atua no TJSP.'));
  await forgetThread(context, conversationId);
  assert.equal((await outbox(context)).at(-1)?.state, 'discarded');
  const result = await drainHonchoOutbox({ owner: context });
  assert.equal(result.deletions, 2);
  assert.ok(calls.some(call => call.method === 'DELETE' && call.path === `/v3/workspaces/${oldWorkspace}`));
  assert.ok(calls.some(call => call.method === 'DELETE' && call.path === `/v3/workspaces/${honchoWorkspace(config, context, 2)}/sessions/${honchoSession(context, conversationId)}`));
  const states = await db.prepare('SELECT state FROM honcho_deletion WHERE office_id=? AND user_id=?').all<{ state: string }>(context.officeId, context.userId);
  assert.deepEqual(states.map(row => row.state), ['accepted', 'accepted']);
});

test('a send that did not go through does not hold up the scheduled run for other people', async () => {
  const first = await owner(), second = await owner();
  await queueMemoryChange(first, randomUUID(), memory('- Prefere prazos em dias úteis.'));
  await queueMemoryChange(second, randomUUID(), memory('- Atua em direito trabalhista.'));
  failNextMessage = 'reject';
  const result = await drainHonchoOutbox();
  assert.equal(result.pending, 1);
  assert.equal(result.delivered, 1);
  assert.equal((await outbox(first))[0].state, 'pending');
  assert.equal((await outbox(second))[0].state, 'delivered');
});

test('forgetting during a send waits for it before deleting the workspace, and the send stays discarded', async () => {
  const context = await owner(), conversationId = randomUUID();
  await queueMemoryChange(context, conversationId, memory('- Prefere audiências pela manhã.'));
  let release!: () => void;
  messageGate = new Promise(resolve => { release = resolve; });
  const session = honchoSession(context, conversationId), workspace = honchoWorkspace(honchoConfig()!, context, 1);
  const messagePath = `/v3/workspaces/${workspace}/sessions/${session}/messages`;
  const draining = drainHonchoOutbox({ owner: context });
  while (!calls.some(call => call.path === messagePath)) await new Promise(resolve => setTimeout(resolve, 10));

  await clearMemory(context);
  assert.equal((await outbox(context))[0].state, 'discarded');
  assert.equal((await drainHonchoOutbox({ owner: context })).deletions, 0);
  assert.ok(!calls.some(call => call.method === 'DELETE' && call.path === `/v3/workspaces/${workspace}`));

  release();
  assert.equal((await draining).deletions, 1);
  assert.deepEqual((await outbox(context)).map(row => [row.state, row.content]), [['discarded', '']]);
  const written = calls.findIndex(call => call.path === messagePath), deleted = calls.findIndex(call => call.method === 'DELETE' && call.path === `/v3/workspaces/${workspace}`);
  assert.ok(written >= 0 && deleted > written);
});
