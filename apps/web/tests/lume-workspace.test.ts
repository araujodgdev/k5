import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasResourceReadError, LumeWorkspaceController, MAX_PLACES, PLACES_PER_MODULE, canonicalCanvasHref, copyMessageScope, restoreTabHrefs, resourceKey, tabStorageKey, type CanvasResource } from '../src/lib/lume-workspace';
import { moduleTabs } from '../src/components/shell/module-tabs';

test('legacy task and document destinations resolve to their canonical authorization identity', () => {
  assert.equal(canonicalCanvasHref('/app/agents?conversationId=owned&caseId=shared'), '/app/vault/cases/shared');
  assert.equal(canonicalCanvasHref('/app/agents?doc=private&conversationId=owned'), '/app/documents/private');
  assert.equal(canonicalCanvasHref('/app/agents?conversationId=owned'), '/app/command-center');
});
import { requestedMessageScope, storedMessageScope, accessLost } from '../src/lib/chat-scope';
import { documentKey } from '../src/lib/document-ref';

const caseA: CanvasResource = { kind: 'case', caseId: 'case-a', folderId: null, href: '/app/vault/cases/case-a', title: 'Caso A' };
const caseB: CanvasResource = { kind: 'case', caseId: 'case-b', folderId: null, href: '/app/vault/cases/case-b', title: 'Caso B' };

test('shared page send freezes namespaced document and selection; a late result cannot replace the new canvas', async () => {
  const document = { kind: 'case-page' as const, caseId: 'case-a', id: 'same-id' };
  const page: CanvasResource = { kind: 'document', document, href: '/app/vault/cases/case-a/pages/same-id', title: 'Página' };
  const workspace = new LumeWorkspaceController(page.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: page });
  const selected = { document: { ...document }, excerpt: 'Trecho compartilhado' };
  workspace.selectExcerpt(selected);
  const sent = workspace.takeScope();
  selected.document.caseId = 'forged';
  selected.excerpt = 'Outro trecho';
  assert.deepEqual(sent.document, document);
  assert.deepEqual(sent.selection, { document, excerpt: 'Trecho compartilhado' });
  assert.equal(sent.caseId, 'case-a');
  assert.notEqual(documentKey(document), documentKey({ kind: 'artifact', id: document.id }));
  workspace.dispatch({ type: 'changed', key: documentKey(document) });
  assert.equal(workspace.getSnapshot().revisions['artifact:same-id'], undefined);
  const started = workspace.getSnapshot().navigation;
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: caseB, explicit: true });
  assert.equal(workspace.canPresentResult(started), false);
  await workspace.resolveResource(page.href, async () => page);
  assert.equal(workspace.takeScope().caseId, 'case-b');
  assert.equal(workspace.takeScope().document, undefined);
  workspace.dispatch({ type: 'tab', resource: caseA });
  await workspace.resolveResource(caseA.href, async () => { throw new CanvasResourceReadError(404); });
  assert.ok(!workspace.getSnapshot().tabs.some(tab => resourceKey(tab) === resourceKey(page)));
});

test('legacy stored artifact focus is deliberately translated, while v2 regeneration keeps the original shared page', () => {
  const legacy = { id: 'legacy', role: 'user' as const, parts: [], metadata: { lumeScope: { version: 1, label: 'Particular', openDocumentId: 'draft', selection: { artifactId: 'draft', excerpt: 'Trecho' }, documentIds: [], researchReferenceIds: [] } } };
  assert.deepEqual(storedMessageScope(legacy)?.document, { kind: 'artifact', id: 'draft' });
  assert.deepEqual(storedMessageScope(legacy)?.selection, { document: { kind: 'artifact', id: 'draft' }, excerpt: 'Trecho' });
  const document = { kind: 'case-page' as const, caseId: 'case-a', id: 'page' };
  const shared = { ...legacy, id: 'shared', metadata: { lumeScope: { version: 2, label: 'Página', document, caseId: 'case-a', selection: { document, excerpt: 'Original' }, documentIds: [], researchReferenceIds: [] } } };
  const requested = requestedMessageScope([shared], shared.id, 'regenerate-message', { caseId: 'case-b', documentIds: [], researchReferenceIds: [] });
  assert.deepEqual(requested.document, document);
  assert.equal(requested.selection?.excerpt, 'Original');
});

test('a send copies the authorized destination and sources; a pending case cannot reuse the previous case', () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const sources = { caseId: 'case-a', caseLabel: 'Nome apenas da interface', documentIds: ['file-a'], researchReferenceIds: ['reference-a'] };
  workspace.dispatch({ type: 'sources', sources });
  const sent = workspace.takeScope();
  sources.documentIds.push('file-not-sent');
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
  workspace.dispatch({ type: 'authorized', resource: caseA });
  assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
  workspace.dispatch({ type: 'authorized', resource: caseB });
  assert.deepEqual(workspace.takeScope(), { canvasHref: caseB.href, caseId: 'case-b', documentIds: [], researchReferenceIds: [] });
  assert.deepEqual(sent, { canvasHref: caseA.href, caseId: 'case-a', documentIds: ['file-a'], researchReferenceIds: ['reference-a'] });
});

test('panel modes and mobile switching retain sources and do not invalidate the current run target', () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  workspace.dispatch({ type: 'sources', sources: { caseId: 'case-a', documentIds: ['file-a'], researchReferenceIds: [] } });
  const started = workspace.getSnapshot().navigation;
  for (const mode of ['focused', 'collapsed', 'floating'] as const) workspace.dispatch({ type: 'mode', mode });
  workspace.dispatch({ type: 'mobile', mobile: 'chat' });
  workspace.dispatch({ type: 'mobile', mobile: 'canvas' });
  assert.equal(workspace.canPresentResult(started), true);
  assert.deepEqual(workspace.takeScope().documentIds, ['file-a']);
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  assert.equal(workspace.canPresentResult(started), false);
  workspace.dispatch({ type: 'destination', href: caseA.href, resource: null });
  assert.equal(workspace.canPresentResult(started), false, 'returning to the same URL still counts as navigation');
});

test('a selected document excerpt is copied once and is cleared when leaving the document', () => {
  const resource: CanvasResource = { kind: 'document', document: { kind: 'artifact' as const, id: 'draft-a' }, href: '/app/documents/draft-a', title: 'Minuta A' };
  const workspace = new LumeWorkspaceController(resource.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource });
  const excerpt = { document: { kind: 'artifact' as const, id: 'draft-a' }, excerpt: 'Texto selecionado' };
  workspace.selectExcerpt(excerpt);
  const sent = workspace.takeScope();
  excerpt.excerpt = 'Outra seleção';
  assert.deepEqual(sent.selection, { document: { kind: 'artifact' as const, id: 'draft-a' }, excerpt: 'Texto selecionado' });
  assert.equal(workspace.takeScope().selection, undefined);
  workspace.selectExcerpt(excerpt);
  workspace.dispatch({ type: 'destination', href: caseA.href, resource: caseA });
  assert.equal(workspace.takeScope().selection, undefined);
});

test('tab identity keeps one case folder and restores only application URLs in the current identity namespace', () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  workspace.dispatch({ type: 'tab', resource: { ...caseA, href: caseA.href + '?section=references' } });
  workspace.dispatch({ type: 'tab', resource: { ...caseA, folderId: 'folder-a', href: caseA.href + '?folder=folder-a', title: 'Pasta' } });
  assert.equal(workspace.getSnapshot().tabs.length, 2);
  assert.equal(resourceKey(workspace.getSnapshot().tabs[0]), 'case:case-a:');
  assert.deepEqual(restoreTabHrefs(JSON.stringify(['/app/agenda?view=tasks&feedback=relatos', 'https://other.test/app/agenda', '//other.test/app/agenda', { title: 'Private' }])), ['/app/agenda?view=tasks']);
  assert.notEqual(tabStorageKey('user-a', 'office-a'), tabStorageKey('user-b', 'office-a'));
  for (const href of ['javascript:alert(1)', '/app/../../evil', '/app/\\evil', '/api/artifacts/id', 'https://example.test']) assert.equal(canonicalCanvasHref(href), null);
});

test('regeneration and admitted retries use server-stored scope, never the new canvas or submitted labels', () => {
  const originalScope = { ...copyMessageScope(caseA, { caseId: null, documentIds: [], researchReferenceIds: [] }), version: 1 as const, label: 'Caso A' };
  const original = { id: 'message-a', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Resuma o caso' }], metadata: { lumeScope: originalScope } };
  const requested = copyMessageScope(caseB, { caseId: null, documentIds: [], researchReferenceIds: [] });
  for (const trigger of ['regenerate-message', 'submit-message']) {
    const scope = requestedMessageScope([original], original.id, trigger, requested);
    assert.equal(scope.caseId, 'case-a');
    assert.equal(scope.canvasHref, caseA.href);
    assert.equal('label' in scope, false, 'labels must be reloaded by server authorization');
  }
  assert.equal(storedMessageScope(original)?.label, 'Caso A');
  assert.throws(() => requestedMessageScope([{ ...original, metadata: undefined }], original.id, 'regenerate-message', requested), /anterior ao contexto/);
});

test('restricted history cannot use a cache fallback; transient failures can keep the draft', () => {
  assert.deepEqual([401, 403, 404, 408, 429, 500, 503].map(accessLost), [true, true, true, false, false, false, false]);
});

for (const status of [403, 404]) {
  test(`canvas ${status} removes its authorized tab and scope, while loader cleanup only suspends sending`, async () => {
    const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
    workspace.dispatch({ type: 'authorized', resource: caseA });
    workspace.dispatch({ type: 'sources', sources: { caseId: 'case-a', documentIds: ['file-a'], researchReferenceIds: ['reference-a'] } });
    workspace.dispatch({ type: 'unavailable', href: caseA.href });
    assert.deepEqual(workspace.getSnapshot().tabs, [caseA]);
    assert.equal(workspace.getSnapshot().revokedHref, null);
    workspace.dispatch({ type: 'authorized', resource: caseA });
    const result = await workspace.resolveResource(caseA.href, async () => { throw new CanvasResourceReadError(status); });
    assert.deepEqual(result, { status: 'revoked', resource: caseA });
    assert.deepEqual(workspace.getSnapshot().tabs, []);
    assert.equal(workspace.getSnapshot().revokedHref, caseA.href);
    assert.deepEqual(workspace.getSnapshot().sources, { caseId: null, documentIds: [], researchReferenceIds: [] });
    assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
    workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
    workspace.dispatch({ type: 'authorized', resource: caseB });
    assert.deepEqual(workspace.takeScope(), { canvasHref: caseB.href, caseId: 'case-b', documentIds: [], researchReferenceIds: [] });
  });
}

test('canvas network and server failures retain the authorized scope and tabs', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  for (const error of [new TypeError('Sem conexão'), new CanvasResourceReadError(500), new CanvasResourceReadError(503)]) {
    await assert.rejects(workspace.resolveResource(caseA.href, async () => { throw error; }), error);
    assert.equal(workspace.getSnapshot().revokedHref, null);
    assert.deepEqual(workspace.getSnapshot().tabs, [caseA]);
    assert.deepEqual(workspace.takeScope(), { canvasHref: caseA.href, caseId: 'case-a', documentIds: [], researchReferenceIds: [] });
  }
});

test('a background denial removes only that tab, preserving the newer canvas and its sources', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const pending = Promise.withResolvers<CanvasResource>();
  const resolving = workspace.resolveResource(caseA.href, () => pending.promise);
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: caseB });
  workspace.dispatch({ type: 'sources', sources: { caseId: 'case-b', documentIds: ['file-b'], researchReferenceIds: [] } });
  pending.reject(new CanvasResourceReadError(404));
  assert.deepEqual(await resolving, { status: 'revoked', resource: caseA });
  assert.deepEqual(workspace.getSnapshot().tabs, [caseB]);
  assert.equal(workspace.getSnapshot().revokedHref, null);
  assert.deepEqual(workspace.takeScope(), { canvasHref: caseB.href, caseId: 'case-b', documentIds: ['file-b'], researchReferenceIds: [] });
});

test('an old denial cannot revoke a resource authorized again after leaving and returning', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const pending = Promise.withResolvers<CanvasResource>();
  const resolving = workspace.resolveResource(caseA.href, () => pending.promise);
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: caseB });
  workspace.dispatch({ type: 'destination', href: caseA.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: { ...caseA, title: 'Caso A autorizado de novo' } });
  pending.reject(new CanvasResourceReadError(403));
  assert.deepEqual(await resolving, { status: 'stale' });
  assert.equal(workspace.getSnapshot().resource?.title, 'Caso A autorizado de novo');
  assert.equal(workspace.getSnapshot().revokedHref, null);
  assert.equal(workspace.takeScope().caseId, 'case-a');
});

test('an old success cannot restore a tab after a newer denial', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const pending = Promise.withResolvers<CanvasResource>();
  const old = workspace.resolveResource(caseA.href, () => pending.promise);
  await workspace.resolveResource(caseA.href, async () => { throw new CanvasResourceReadError(404); });
  pending.resolve(caseA);
  assert.deepEqual(await old, { status: 'stale' });
  assert.equal(workspace.getSnapshot().revokedHref, caseA.href);
  assert.deepEqual(workspace.getSnapshot().tabs, []);
  assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
  await workspace.resolveResource(caseA.href, async () => caseA);
  assert.deepEqual(workspace.getSnapshot().tabs, [caseA]);
});

test('revoked document selection cannot leak into a later authorized message', async () => {
  const resource: CanvasResource = { kind: 'document', document: { kind: 'artifact' as const, id: 'draft-a' }, href: '/app/documents/draft-a', title: 'Minuta A' };
  const workspace = new LumeWorkspaceController(resource.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource });
  workspace.selectExcerpt({ document: { kind: 'artifact' as const, id: 'draft-a' }, excerpt: 'Trecho privado' });
  await workspace.resolveResource(resource.href, async () => { throw new CanvasResourceReadError(404); });
  workspace.dispatch({ type: 'authorized', resource });
  assert.deepEqual(workspace.takeScope(), { canvasHref: resource.href, caseId: undefined, document: { kind: 'artifact', id: 'draft-a' }, documentIds: [], researchReferenceIds: [] });
});

test('a confirmed case denial removes its folder and file tabs, but a folder denial leaves other case resources authorized', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  const folder: CanvasResource = { ...caseA, folderId: 'private-folder', href: `${caseA.href}?folder=private-folder`, title: 'Pasta privada' };
  const file: CanvasResource = { kind: 'file', documentId: 'private-file', caseId: 'case-a', href: '/app/vault/files/private-file', title: 'Arquivo privado' };
  workspace.dispatch({ type: 'authorized', resource: caseA });
  workspace.dispatch({ type: 'tab', resource: folder });
  workspace.dispatch({ type: 'tab', resource: file });
  await workspace.resolveResource(folder.href, async () => { throw new CanvasResourceReadError(404); });
  assert.deepEqual(workspace.getSnapshot().tabs, [caseA, file]);
  assert.equal(workspace.takeScope().caseId, 'case-a');
  workspace.dispatch({ type: 'tab', resource: folder });
  await workspace.resolveResource(caseA.href, async () => { throw new CanvasResourceReadError(404); });
  assert.deepEqual(workspace.getSnapshot().tabs, []);
  assert.equal(workspace.getSnapshot().revokedHref, caseA.href);
});

test('a stale case denial cannot poison a file authorized in that case since the request began', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  const file: CanvasResource = { kind: 'file', documentId: 'file-a', caseId: 'case-a', href: '/app/vault/files/file-a', title: 'Arquivo A' };
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const pending = Promise.withResolvers<CanvasResource>();
  const resolving = workspace.resolveResource(caseA.href, () => pending.promise);
  workspace.dispatch({ type: 'destination', href: file.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: file });
  pending.reject(new CanvasResourceReadError(404));
  assert.deepEqual(await resolving, { status: 'stale' });
  assert.deepEqual(workspace.takeScope(), { canvasHref: file.href, caseId: 'case-a', documentIds: ['file-a'], researchReferenceIds: [] });
  assert.deepEqual(workspace.getSnapshot().tabs, [caseA, file]);
});

test('parallel restores keep independent folder tabs, and a file result predating case revocation stays discarded', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const first: CanvasResource = { ...caseA, folderId: 'first', href: `${caseA.href}?folder=first`, title: 'Primeira pasta' };
  const second: CanvasResource = { ...caseA, folderId: 'second', href: `${caseA.href}?folder=second`, title: 'Segunda pasta' };
  const restored = await Promise.all([workspace.resolveResource(first.href, async () => first), workspace.resolveResource(second.href, async () => second)]);
  assert.deepEqual(restored.map(result => result.status), ['authorized', 'authorized']);
  assert.deepEqual(workspace.getSnapshot().tabs, [caseA, first, second]);
  const pending = Promise.withResolvers<CanvasResource>();
  const file = workspace.resolveResource('/app/vault/files/new-file', () => pending.promise);
  await workspace.resolveResource(caseA.href, async () => { throw new CanvasResourceReadError(404); });
  pending.resolve({ kind: 'file', documentId: 'new-file', caseId: 'case-a', href: '/app/vault/files/new-file', title: 'Arquivo privado' });
  assert.deepEqual(await file, { status: 'stale' });
  assert.deepEqual(workspace.getSnapshot().tabs, []);
  assert.equal(workspace.getSnapshot().revokedHref, caseA.href);
});

test('a denied URL variant invalidates the same resource identity and protects a newer authorization', async () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const variant = `${caseA.href}?section=references`;
  const pending = Promise.withResolvers<CanvasResource>();
  const resolving = workspace.resolveResource(variant, () => pending.promise);
  workspace.dispatch({ type: 'authorized', resource: caseA });
  pending.reject(new CanvasResourceReadError(404));
  assert.deepEqual(await resolving, { status: 'stale' });
  assert.equal(workspace.takeScope().caseId, 'case-a');
  const denied = await workspace.resolveResource(variant, async () => { throw new CanvasResourceReadError(404); });
  assert.deepEqual(denied, { status: 'revoked', resource: caseA });
  assert.deepEqual(workspace.getSnapshot().tabs, []);
  assert.equal(workspace.getSnapshot().revokedHref, caseA.href);
});

test('editor-discovered denial clears its tab, sources and excerpt, and pending reads cannot register it again', async () => {
  const page: CanvasResource = { kind: 'document', document: { kind: 'case-page', caseId: 'case-a', id: 'page-a' }, href: '/app/vault/cases/case-a/pages/page-a', title: 'Página A' };
  const workspace = new LumeWorkspaceController(page.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: page });
  workspace.dispatch({ type: 'sources', sources: { caseId: 'case-a', documentIds: ['file-a'], researchReferenceIds: ['ref-a'] } });
  workspace.selectExcerpt({ document: page.document, excerpt: 'Trecho revogado' });
  const pending = Promise.withResolvers<CanvasResource>();
  const reading = workspace.resolveResource(page.href, () => pending.promise);
  const access = workspace.captureResourceAccess(page);
  assert.equal(workspace.invalidateResource(access), true);
  assert.equal(workspace.getSnapshot().revokedHref, page.href);
  assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
  pending.resolve(page);
  assert.deepEqual(await reading, { status: 'stale' });
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: caseB });
  assert.deepEqual(workspace.getSnapshot().tabs, [caseB]);
  assert.deepEqual(workspace.takeScope(), { canvasHref: caseB.href, caseId: 'case-b', documentIds: [], researchReferenceIds: [] });
});

test('a stale editor denial preserves a later document and a new authorization of the original', () => {
  const page: CanvasResource = { kind: 'document', document: { kind: 'case-page', caseId: 'case-a', id: 'page-a' }, href: '/app/vault/cases/case-a/pages/page-a', title: 'Página A' };
  const workspace = new LumeWorkspaceController(page.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: page });
  const access = workspace.captureResourceAccess(page);
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: caseB });
  assert.equal(workspace.invalidateResource(access), true);
  assert.deepEqual(workspace.getSnapshot().tabs, [caseB]);
  assert.equal(workspace.takeScope().caseId, 'case-b');
  workspace.dispatch({ type: 'destination', href: page.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: { ...page, title: 'Página autorizada novamente' } });
  assert.equal(workspace.invalidateResource(access), false);
  assert.equal(workspace.getSnapshot().resource?.title, 'Página autorizada novamente');
  assert.equal(workspace.takeScope().document?.id, 'page-a');
});

test('a newer pending resource read cannot suppress a confirmed editor denial', async () => {
  const page: CanvasResource = { kind: 'document', document: { kind: 'case-page', caseId: 'case-a', id: 'page-a' }, href: '/app/vault/cases/case-a/pages/page-a', title: 'Página A' };
  const workspace = new LumeWorkspaceController(page.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: page });
  const access = workspace.captureResourceAccess(page);
  const pending = Promise.withResolvers<CanvasResource>();
  const reading = workspace.resolveResource(page.href, () => pending.promise);
  assert.equal(workspace.invalidateResource(access), true);
  pending.reject(new CanvasResourceReadError(503));
  assert.deepEqual(await reading, { status: 'stale' });
  assert.equal(workspace.getSnapshot().revokedHref, page.href);
  assert.throws(() => workspace.takeScope(), /Aguarde o contexto/);
  workspace.dispatch({ type: 'destination', href: caseB.href, resource: null, explicit: true });
  workspace.dispatch({ type: 'authorized', resource: caseB });
  assert.deepEqual(workspace.getSnapshot().tabs, [caseB]);
  assert.equal(workspace.takeScope().caseId, 'case-b');
});

test('a pending authorized leaf loses its publication token when its resource is revoked', () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const access = workspace.captureResourceAccess(caseA);
  assert.equal(workspace.isResourceAccessCurrent(access), true);
  workspace.invalidateResource(access);
  assert.equal(workspace.isResourceAccessCurrent(access), false);
  assert.deepEqual(workspace.getSnapshot().tabs, []);
});

test('case revocation also invalidates a pending file leaf that was never registered as a tab', () => {
  const workspace = new LumeWorkspaceController(caseA.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: caseA });
  const file: CanvasResource = { kind: 'file', documentId: 'pending-file', caseId: 'case-a', href: '/app/vault/files/pending-file', title: 'Arquivo ainda carregando' };
  const access = workspace.captureResourceAccess(file);
  workspace.invalidateResource(workspace.captureResourceAccess(caseA));
  assert.equal(workspace.isResourceAccessCurrent(access), false);
  assert.equal(workspace.isResourceAccessCurrent(workspace.captureResourceAccess(caseB)), true);
});

test('the place limit keeps home, the current canvas and the requested destination', () => {
  const workspace = new LumeWorkspaceController('/app/command-center', 'canvas');
  workspace.dispatch({ type: 'authorized', resource: { kind: 'module', slug: 'command-center', href: '/app/command-center', title: 'Início' } });
  const cases: CanvasResource[] = Array.from({length:MAX_PLACES}, (_, index) => ({ kind:'case',caseId:String(index),folderId:null,href:`/app/vault/cases/${index}`,title:`Caso ${index}` }));
  for (const resource of cases.slice(0,MAX_PLACES-1)) workspace.dispatch({type:'tab',resource});
  workspace.dispatch({type:'destination',href:cases[0].href,resource:cases[0]});
  workspace.dispatch({type:'tab',resource:cases[MAX_PLACES-1]});
  const tabs = workspace.getSnapshot().tabs;
  assert.equal(tabs.length,MAX_PLACES);
  assert.equal(tabs.some(tab => tab.href === '/app/command-center'),true);
  assert.equal(tabs.some(tab => tab.href === cases[0].href),true);
  assert.equal(tabs.some(tab => tab.href === cases[MAX_PLACES-1].href),true);
  assert.equal(tabs.some(tab => tab.href === cases[1].href),false);
});

test('the place limit holds the retained places of every module tab', () => {
  const groups = moduleTabs({ whatsappEnabled: true, adsEnabled: true, platformAdmin: true }).length + 1;
  assert.ok(MAX_PLACES > groups * PLACES_PER_MODULE);
});

test('module views are separate places; other address details are not', () => {
  const tasks: CanvasResource = { kind: 'module', slug: 'agenda', href: '/app/agenda?view=tasks', title: 'Tarefas' };
  assert.notEqual(resourceKey(tasks), resourceKey({ ...tasks, href: '/app/agenda?view=calendar' }));
  assert.equal(resourceKey(tasks), resourceKey({ ...tasks, href: '/app/agenda?view=tasks&q=prazo' }));
  const workspace = new LumeWorkspaceController(tasks.href, 'canvas');
  workspace.dispatch({ type: 'authorized', resource: tasks });
  workspace.dispatch({ type: 'tab', resource: { ...tasks, href: '/app/agenda?view=calendar', title: 'Agenda' } });
  assert.equal(workspace.getSnapshot().tabs.length, 2);
});
