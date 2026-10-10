import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { tutorialVideoResponse } from '../src/lib/tutorial-video-response';

test('every tutorial video reaches the Worker before the asset binding answers', () => {
  const list = readFileSync('wrangler.jsonc', 'utf8').match(/"run_worker_first"\s*:\s*(\[[^\]]*\])/)?.[1];
  assert.ok(list, 'wrangler.jsonc declares assets.run_worker_first');
  // Cloudflare's router turns each "*" into ".*" and matches the whole path.
  const rules = (JSON.parse(list) as string[]).map(rule => new RegExp(`^${rule.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));
  const videos = readdirSync('public/tutorial/videos', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `/tutorial/videos/${entry.name}/video.mp4`);
  assert.ok(videos.length > 0);
  assert.deepEqual(videos.filter(path => !rules.some(rule => rule.test(path))), []);
});

const bytes = new TextEncoder().encode('0123456789');
const assets = { fetch: async () => new Response(bytes, { headers: { 'Content-Type': 'video/mp4', ETag: '"video-v1"' } }) };
for (const [range, expected, contentRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10']]) {
  test(`tutorial delivers the requested segment ${range}`, async () => {
    const response = await tutorialVideoResponse(new Request('https://lume.test/tutorial/videos/clientes/video.mp4', { headers: { Range: range } }), assets);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), contentRange);
    assert.equal(await response.text(), expected);
  });
}
test('tutorial rejects an unsatisfiable range and serves the full changed representation', async () => {
  const invalid = await tutorialVideoResponse(new Request('https://lume.test', { headers: { Range: 'bytes=10-' } }), assets);
  assert.equal(invalid.status, 416);
  const changed = await tutorialVideoResponse(new Request('https://lume.test', { headers: { Range: 'bytes=2-4', 'If-Range': '"old"' } }), assets);
  assert.equal(changed.status, 200);
  assert.equal(await changed.text(), '0123456789');
});
test('tutorial crosses stream chunks and stops reading after the requested bytes', async () => {
  let cancelled = false;
  const streamed = { fetch: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes.subarray(0, 4)); controller.enqueue(bytes.subarray(4)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Length': '10' } }) };
  const response = await tutorialVideoResponse(new Request('https://lume.test', { headers: { Range: 'bytes=3-5' } }), streamed);
  assert.equal(await response.text(), '345');
  assert.equal(cancelled, true);
});
