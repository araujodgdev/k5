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

test('worker shutdown drains the active verification and does not claim its requeued batch', async () => {
  let stopping = false; let calls = 0;
  await runWorkerQueues({
    processDocuments: async () => false, maintain: async () => false,
    verifyDocuments: async () => { calls++; stopping = true; await Promise.resolve(); return true; },
    stopping: () => stopping, once: false, onError: error => { throw error; },
  });
  assert.equal(calls, 1);
});
