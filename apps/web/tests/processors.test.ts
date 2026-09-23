import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { processorBindingRequest, type ProcessorBindings } from '../src/workers/processor-bindings';
import { dueProcessors } from '../src/lib/processor-schedule';
import { postgresFixture } from './postgres-fixture';

test('private container bridge preserves object bytes and rejects invalid keys and public hosts', async () => {
  const objects = new Map<string, Uint8Array>();
  const env: ProcessorBindings = {
    VAULT: {
      async put(key, stream) { objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer())); },
      async get(key) { const bytes = objects.get(key); return bytes ? { body: new Response(new Uint8Array(bytes)).body! } : null; },
      async delete(key) { objects.delete(key); },
    },
    KNOWLEDGE: { async upsert() {}, async query() { return { matches: [] }; }, async deleteByIds() {} },
  };
  const key = `${randomUUID()}/${randomUUID()}/${randomUUID()}.pdf`;
  const url = `http://k5-bindings/objects/${encodeURIComponent(key)}`;
  const bytes = Uint8Array.from([0, 255, 13, 10, 128]);
  assert.equal((await processorBindingRequest(new Request(url, { method: 'PUT', body: bytes }), env)).status, 204);
  assert.deepEqual(new Uint8Array(await (await processorBindingRequest(new Request(url), env)).arrayBuffer()), bytes);
  assert.equal((await processorBindingRequest(new Request('http://k5-bindings/objects/..%2fsecret'), env)).status, 400);
  assert.equal((await processorBindingRequest(new Request(url.replace('k5-bindings', 'public.example')), env)).status, 404);
  assert.equal((await processorBindingRequest(new Request(url, { method: 'DELETE' }), env)).status, 204);
  assert.equal((await processorBindingRequest(new Request(url), env)).status, 404);
});

test('processor scheduling wakes due queues, recovers expired leases and leaves empty containers asleep', async () => {
  const { db } = await postgresFixture();
  const now = Date.now();
  assert.deepEqual(await dueProcessors(db, now, false), { documents: false, judicial: false });
  assert.deepEqual(await dueProcessors(db, now, true), { documents: true, judicial: false });
  const office = randomUUID(), user = randomUUID(), document = randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES (?,?)').run(office, 'QA');
  await db.prepare('INSERT INTO "user"(id,email,name) VALUES (?,?,?)').run(user, 'processor@example.test', 'QA');
  await db.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by)
    VALUES (?,?,'library','qa.pdf',?,'application/pdf',1,'qa',?)`).run(document, office, `${office}/${document}/${randomUUID()}.pdf`, user);
  assert.equal((await dueProcessors(db, now, false)).documents, true);
  await db.prepare("UPDATE vault_document SET status='processing',lease_expires_at=CURRENT_TIMESTAMP + INTERVAL '1 hour' WHERE id=?").run(document);
  assert.equal((await dueProcessors(db, now, false)).documents, false);
  await db.prepare("UPDATE vault_document SET lease_expires_at=CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id=?").run(document);
  assert.equal((await dueProcessors(db, now, false)).documents, true);
  await db.prepare("UPDATE vault_document SET status='ready' WHERE id=?").run(document);
  assert.equal((await dueProcessors(db, now, false)).documents, false);
});
