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

for (const outcome of ['saved', 'failed'] as const) {
  test(`revocation clears cached document text and a pending ${outcome} write cannot restore it`, async () => {
    const drafts = new DocumentDrafts();
    const editor = drafts.get('revoked');
    editor.open(original);
    editor.edit({ content: 'Rascunho privado revogado' });
    const other = drafts.get('allowed');
    other.open({ title: 'Outro documento', content: 'Texto ainda autorizado', version: 1 });
    const pending = Promise.withResolvers<{ version: number }>();
    const saving = editor.save(() => pending.promise, true);
    await Promise.resolve();
    drafts.invalidate('revoked');
    if (outcome === 'saved') pending.resolve({ version: 2 });
    else pending.reject(new Error('Acesso removido'));
    assert.equal(await saving, false);
    assert.equal(editor.getSnapshot(), null);
    assert.equal(drafts.get('revoked').getSnapshot(), null);
    assert.equal(other.getSnapshot()?.content, 'Texto ainda autorizado');
    assert.equal(drafts.hasUnsaved(), false);
  });
}

for (const field of ['title', 'content'] as const) {
  for (const autosaved of [false, true]) {
    test(`a pending replacement preserves intervening ${field} edits even when autosaved=${autosaved}`, async () => {
      const draft = new DocumentDrafts().get('page');
      draft.open(original);
      const read = draft.captureRevision();
      draft.edit({ [field]: 'Edição depois de restaurar' });
      if (autosaved) assert.equal(await draft.save(async () => ({ version: 2 }), false), true);
      assert.equal(draft.replace({ ...original, version: 3 }, read), false);
      assert.equal(draft.getSnapshot()?.[field], 'Edição depois de restaurar');
      assert.equal(draft.getSnapshot()?.state, 'conflict');
      const explicitReload = draft.captureRevision();
      assert.equal(draft.replace({ ...original, version: 3 }, explicitReload), true);
      assert.equal(draft.getSnapshot()?.[field], original[field]);
    });
  }
}

test('a pending reopen preserves newer saved edits and an invalidated draft cannot reopen or replace', async () => {
  const drafts = new DocumentDrafts();
  const draft = drafts.get('page');
  draft.open(original);
  const pendingRead = draft.captureRevision();
  draft.edit({ title: 'Título digitado durante a leitura' });
  await draft.save(async () => ({ version: 2 }), false);
  draft.open({ ...original, version: 2 }, pendingRead);
  assert.equal(draft.getSnapshot()?.title, 'Título digitado durante a leitura');
  assert.equal(draft.getSnapshot()?.state, 'conflict');
  const beforeRevocation = draft.captureRevision();
  drafts.invalidate('page');
  draft.open(original, beforeRevocation);
  assert.equal(draft.replace(original, beforeRevocation), false);
  draft.open(original);
  assert.equal(draft.replace(original), false);
  assert.equal(draft.isValid(beforeRevocation), false);
  assert.equal(draft.getSnapshot(), null);
  assert.equal(drafts.hasUnsaved(), false);
  const reopened = drafts.get('page');
  reopened.open(original);
  assert.equal(reopened.getSnapshot()?.content, 'Texto original');
});

test('revocation before a queued writer starts cancels it without retaining a navigation blocker', async () => {
  const drafts = new DocumentDrafts();
  const draft = drafts.get('page');
  draft.open(original);
  draft.edit({ content: 'Texto que perdeu acesso' });
  const saving = draft.save(async () => { assert.fail('A revoked resource cannot start another write'); }, true);
  drafts.invalidate('page');
  assert.equal(await saving, false);
  assert.equal(drafts.hasUnsaved(), false);
  const authorized = drafts.get('other-page');
  authorized.open(original);
  authorized.edit({ content: 'Outro texto autorizado' });
  assert.equal(await authorized.save(async () => ({ version: 2 }), true), true);
  assert.equal(authorized.getSnapshot()?.content, 'Outro texto autorizado');
});

for (const outcome of ['successful', 'failed'] as const) {
  test(`a pending ${outcome} save cannot dismiss a conflict discovered by another editor operation`, async () => {
    const draft = new DocumentDrafts().get('page');
    draft.open(original);
    draft.edit({ content: 'Texto autosalvo enquanto a restauração conflita' });
    const pending = Promise.withResolvers<{ version: number }>();
    const saving = draft.save(() => pending.promise, false);
    await Promise.resolve();
    draft.conflict();
    if (outcome === 'successful') pending.resolve({ version: 2 });
    else pending.reject(new TypeError('Resposta perdida depois do conflito'));
    assert.equal(await saving, false);
    assert.equal(draft.getSnapshot()?.state, 'conflict');
    assert.equal(draft.getSnapshot()?.content, 'Texto autosalvo enquanto a restauração conflita');
    draft.rebase(2);
    assert.equal(await draft.save(async () => ({ version: 3 }), true), true);
    assert.equal(draft.getSnapshot()?.state, 'saved');
  });
}

test('revocation releases a pending save, queued exit save and read without waiting for the old response', { timeout: 1000 }, async () => {
  const drafts = new DocumentDrafts();
  const draft = drafts.get('page');
  draft.open(original);
  draft.edit({ content: 'Texto salvo antes de perder acesso' });
  const pending = Promise.withResolvers<{ version: number }>();
  const saving = draft.save(() => pending.promise, false);
  await Promise.resolve();
  const exiting = draft.save(async () => { assert.fail('A revoked exit cannot start a queued write'); }, true);
  const reading = draft.waitForSave();
  drafts.invalidate('page');
  assert.equal(await saving, false);
  assert.equal(await exiting, true);
  await reading;
  assert.equal(drafts.hasUnsaved(), false);
  pending.resolve({ version: 2 });
  await pending.promise;
  assert.equal(draft.getSnapshot(), null);
});

test('a saved editor retains its draft while hidden and another document opens', async () => {
  const drafts = new DocumentDrafts();
  const first = drafts.get('first');
  first.open(original);
  const unsubscribe = first.subscribe(() => {});
  unsubscribe();
  drafts.get('second').open(original);
  assert.equal(drafts.get('first'), first);
  first.edit({ content: 'Alteração depois de voltar à aba' });
  assert.equal(drafts.hasUnsaved(), true);
  assert.equal(await drafts.get('first').save(async input => {
    assert.equal(input.content, 'Alteração depois de voltar à aba');
    return { version: 2 };
  }, true), true);
});
