import './test-setup';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
let ApiError: typeof import('../src/lib/workspace-api').ApiError;
let limitedFormData: typeof import('../src/lib/workspace-api').limitedFormData;
before(async () => {
  process.env.BETTER_AUTH_SECRET ??= 'multipart-test-only-secret-with-at-least-32-characters';
  ({ ApiError, limitedFormData } = await import('../src/lib/workspace-api'));
});

const contentType = 'multipart/form-data; boundary=qa-boundary';
const multipart = Buffer.from('--qa-boundary\r\nContent-Disposition: form-data; name="file"; filename="teste.txt"\r\nContent-Type: text/plain\r\n\r\nOlá\r\n--qa-boundary--\r\n');

test('multipart accepts a small file without requiring Content-Length', async () => {
  const request = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': contentType }, body: multipart });
  const form = await limitedFormData(request, multipart.length);
  const file = form.get('file');
  assert.ok(file instanceof File);
  assert.equal(await file.text(), 'Olá');
});

test('multipart rejects a declared oversized body before reading it', async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(multipart); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const request = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': contentType, 'content-length': '10000' }, body, duplex: 'half' } as RequestInit);
  await assert.rejects(limitedFormData(request, 1000), (error: unknown) => error instanceof ApiError && error.status === 413);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

for (const declaredLength of [undefined, '1']) {
  test(`multipart stops an oversized stream with ${declaredLength ? 'false' : 'missing'} Content-Length`, async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const headers = new Headers({ 'content-type': contentType });
    if (declaredLength) headers.set('content-length', declaredLength);
    const request = new Request('http://localhost/upload', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    await assert.rejects(limitedFormData(request, 250), (error: unknown) => error instanceof ApiError && error.status === 413);
    assert.equal(reads, 3);
    assert.equal(cancelled, true);
  });
}

test('multipart rejects malformed data with a public validation error', async () => {
  const request = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': contentType }, body: 'invalid' });
  await assert.rejects(limitedFormData(request, 100), (error: unknown) => error instanceof ApiError && error.status === 400);
});
