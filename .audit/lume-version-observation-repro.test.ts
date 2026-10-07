import { testDb as db } from '../apps/web/tests/test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFixture } from '../apps/web/tests/google-fixture';
import { createUploadRef } from '../apps/web/src/lib/application/uploads-service';
import { addDocumentVersion } from '../apps/web/src/lib/application/vault-service';
import { createVaultDocument, processDocument } from '../apps/web/src/lib/vault';
import { observeDocument } from '../apps/web/src/lib/content-policy';

test('a queued replacement cannot expose obsolete extracted text as its own content', async () => {
  const f = await googleFixture();
  const original = await createUploadRef(f.context, new File(['FIRST_VERSION_DEADLINE: cinco dias.'], 'prazo.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(f.officeId, f.userId, original, { scope: 'library' });
  await processDocument(document.id, f.officeId);
  const first = await observeDocument(f.userId, document.id);
  assert.match(first.content, /FIRST_VERSION_DEADLINE/);
  const replacement = await createUploadRef(f.context, new File(['SECOND_VERSION_DEADLINE: quinze dias.'], 'prazo.txt', { type: 'text/plain' }));
  const result = await addDocumentVersion(f.context, { documentId: document.id, uploadRef: replacement.id });
  assert.equal(result.version, 2);
  const row = await db.prepare('SELECT status FROM vault_document WHERE id=?').get<{ status: string }>(document.id);
  assert.equal(row?.status, 'queued');
  try {
    const observed = await observeDocument(f.userId, document.id);
    console.log(JSON.stringify({ observedVersion: observed.policy.observed.find(pin => pin.kind === 'document')?.version, content: observed.content }));
    assert.match(observed.content, /SECOND_VERSION_DEADLINE/, 'Returning content for the active replacement requires matching extraction identity');
    assert.doesNotMatch(observed.content, /FIRST_VERSION_DEADLINE/);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_READY') return;
    throw error;
  }
});
