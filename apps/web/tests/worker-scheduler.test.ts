import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerQueues } from '../src/lib/worker-scheduler';

test('worker --once drains both queues even if one fails, without starting another verification', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const failure = new Error('document processing failed');
  const errors: unknown[] = [];
  let calls = 0; let finished = false;
  const running = runWorkerQueues({
    processDocuments: async () => { throw failure; },
    verifyDocuments: async () => { calls++; entered(); await gate; return true; },
    maintain: async () => false,
    stopping: () => false, once: true, onError: error => errors.push(error),
  }).then(() => { finished = true; });
  await ready;
  assert.equal(finished, false);
  release(); await running;
  assert.equal(calls, 1); assert.deepEqual(errors, [failure]);
});

test('signature reconciliation runs independently and shutdown waits for its in-flight work', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  let maintained = false, verified = false, finished = false;
  const running = runWorkerQueues({
    processDocuments: async () => true,
    verifyDocuments: async () => { verified = true; return true; },
    maintain: async () => { maintained = true; return true; },
    reconcileSignatures: async () => { entered(); await gate; return true; },
    stopping: () => false, once: true, onError: error => { throw error; },
  }).then(() => { finished = true; });
  await ready; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(maintained, true); assert.equal(verified, true); assert.equal(finished, false);
  release(); await running; assert.equal(finished, true);
});
