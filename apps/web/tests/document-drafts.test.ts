import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentConflictError, DocumentDrafts, type DocumentWrite } from '../src/lib/document-drafts';

const original = { title: 'Minuta', content: 'Texto original', version: 1 };

test('unsaved document survives leaving and reopening, then a retry saves the retained text', async () => {
  const drafts = new DocumentDrafts();
  const editor = drafts.get('document');
  editor.open(original);
  editor.edit({ content: 'Texto revisado' });
  assert.equal(await editor.save(async () => { throw new TypeError('Sem conexão'); }, false), false);
  const reopened = drafts.get('document');
  reopened.open(original);
  assert.equal(reopened.getSnapshot()?.content, 'Texto revisado');
  assert.equal(reopened.getSnapshot()?.state, 'error');
  assert.equal(drafts.hasUnsaved(), true);
  assert.equal(await reopened.save(async sent => { assert.equal(sent.content, 'Texto revisado'); return { version: 2 }; }, true), true);
  assert.equal(drafts.hasUnsaved(), false);
});

test('successive editors serialize writes and use the acknowledged version for newer edits', async () => {
  const drafts = new DocumentDrafts();
  const editor = drafts.get('document');
  editor.open(original);
  editor.edit({ content: 'Primeira alteração' });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<{ version: number }>();
  const writes: DocumentWrite[] = [];
  const first = editor.save(async sent => { writes.push(sent); started.resolve(); return release.promise; }, false);
  await started.promise;
  const reopened = drafts.get('document');
  reopened.edit({ content: 'Segunda alteração' });
  const second = reopened.save(async sent => { writes.push(sent); return { version: 3 }; }, true);
  assert.equal(writes.length, 1);
  release.resolve({ version: 2 });
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(writes.map(({ content, version }) => ({ content, version })), [
    { content: 'Primeira alteração', version: 1 }, { content: 'Segunda alteração', version: 2 },
  ]);
  assert.equal(reopened.getSnapshot()?.state, 'saved');
});

test('a remotely changed version preserves edits and requires explicit conflict resolution', async () => {
  const draft = new DocumentDrafts().get('document');
  draft.open(original);
  draft.edit({ content: 'Minha alteração' });
  draft.open({ ...original, content: 'Outra alteração', version: 2 });
  assert.equal(draft.getSnapshot()?.state, 'conflict');
  assert.equal(draft.getSnapshot()?.content, 'Minha alteração');
  assert.equal(await draft.save(async () => { assert.fail('Conflict must not overwrite the server'); }, true), false);
  draft.rebase(2);
  assert.equal(await draft.save(async sent => { assert.equal(sent.version, 2); return { version: 3 }; }, true), true);
  draft.edit({ content: 'Mais uma alteração' });
  assert.equal(await draft.save(async () => { throw new DocumentConflictError('Conflito'); }, true), false);
  assert.equal(draft.getSnapshot()?.state, 'conflict');
});

test('a lost response is reconciled with stored content; separate scopes never share drafts', async () => {
  const first = new DocumentDrafts();
  const draft = first.get('document');
  draft.open(original);
  draft.edit({ title: 'Novo título', content: 'Minha alteração' });
  await draft.save(async () => { throw new TypeError('Resposta perdida'); }, true);
  draft.open({ title: 'Novo título', content: 'Minha alteração', version: 2 });
  assert.equal(draft.getSnapshot()?.state, 'saved');
  assert.equal(draft.getSnapshot()?.version, 2);
  assert.equal(new DocumentDrafts().get('document').getSnapshot(), null);
  first.clear();
  assert.equal(first.get('document').getSnapshot(), null);
});
