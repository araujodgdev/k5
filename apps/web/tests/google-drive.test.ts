import './test-setup';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { FakeGoogle, googleFixture, respond, setRule } from './google-fixture';
import { setGoogleTransport } from '../src/lib/google/transport';
import { registerFiles, listFiles, refreshFile, importFile, listPermissions, revokePermission, renameFile, shareFile, readDoc, editDoc } from '../src/lib/google/drive/service';
import { processDriveImport } from '../src/lib/google/drive/import';
import { claimGoogleJob, type GoogleJob } from '../src/lib/google/jobs';
import { documentText, editRequests, resolveEdits } from '../src/lib/google/drive/docs';
import { GOOGLE_EXPORT_LIMIT_BYTES, MAX_IMPORT_BYTES, importFormatFor } from '../src/lib/google/drive/formats';
import { resetObjectStorageForTests } from '../src/lib/storage';

afterEach(() => { setGoogleTransport(undefined); resetObjectStorageForTests(); });
const fileId = 'drive-file-123456789';
async function caseFor(officeId: string, userId: string) {
  const id = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(id, officeId, 'Caso Drive', userId);
  return id;
}
function fakeDrive(mimeType = 'application/pdf', content = new TextEncoder().encode('%PDF-1.4\n')) {
  const fake = new FakeGoogle();
  let version = '1';
  const meta = () => ({ id: fileId, name: mimeType === 'application/pdf' ? 'Peça.pdf' : 'Peça',
    mimeType, size: mimeType === 'application/pdf' ? String(content.length) : undefined, version,
    modifiedTime: `2026-09-23T00:00:0${version}Z`, driveId: 'shared-drive-1', capabilities: {
      canRename: true, canShare: true, canEdit: true, canModifyContent: true, canDownload: true } });
  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, r => r.query.get('alt') === 'media' ? respond(200, content) : respond(200, meta()));
  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789\/export$/, () => respond(200, content));
  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789\/permissions$/, () => respond(200, { permissions: [
    { id: 'direct', type: 'user', role: 'reader', emailAddress: 'pessoa@example.com', permissionDetails: [{ inherited: false }] },
    { id: 'inherited', type: 'user', role: 'writer', emailAddress: 'equipe@example.com', permissionDetails: [{ inherited: true, inheritedFrom: 'shared-drive-1' }] },
  ] }));
  setGoogleTransport(fake);
  return { fake, version: (value: string) => { version = value; } };
}

test('seleção é verificada no Google e fica privada até para administrador do mesmo escritório', async () => {
  const owner = await googleFixture();
  const other = await googleFixture({ officeId: owner.officeId, role: 'administrator' });
  const alien = await googleFixture();
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  assert.equal(file.sharedDrive, true);
  assert.equal(file.version, '1');
  assert.equal((await listFiles(owner.context, { limit: 50, offset: 0 })).total, 1);
  assert.equal((await listFiles(other.context, { limit: 50, offset: 0 })).total, 0);
  assert.equal((await listFiles(alien.context, { limit: 50, offset: 0 })).total, 0);
  await assert.rejects(refreshFile(other.context, { fileId: file.id }), /não encontrado/i);
  await assert.rejects(refreshFile(alien.context, { fileId: file.id }), /não encontrado/i);
  assert.equal(fake.count('GET', /\/drive\/v3\/files\/drive-file-123456789$/), 1);
  const p = (await listPermissions(owner.context, { fileId: file.id })).permissions;
  assert.equal(p.find(x => x.id === 'direct')?.removable, true);
  assert.equal(p.find(x => x.id === 'inherited')?.removable, false);
});

test('atualização marca arquivo na lixeira como indisponível sem perder metadados ou cópia no Cofre', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const imported = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'trash-copy' })).import;
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  await processDriveImport(job, testDb);
  const copy = await testDb.prepare(`SELECT i.vault_document_id,i.vault_version,d.sha256 FROM google_drive_import i
    JOIN vault_document d ON d.id=i.vault_document_id WHERE i.id=?`)
    .get<{ vault_document_id: string; vault_version: number; sha256: string }>(imported.id);
  assert.ok(copy);

  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, () => respond(200, {
    id: fileId, name: 'Peça.pdf', mimeType: 'application/pdf', trashed: true, version: '2',
  }));
  const missing = (await refreshFile(owner.context, { fileId: file.id })).file;
  assert.equal(missing.state, 'not_found');
  assert.equal(missing.name, file.name);
  assert.equal(missing.version, file.version);
  const listed = (await listFiles(owner.context, { limit: 50, offset: 0 })).files[0];
  assert.equal(listed.state, 'not_found');
  assert.equal(listed.version, file.version);
  const savedCopy = await testDb.prepare(`SELECT i.vault_document_id,i.vault_version,d.sha256 FROM google_drive_import i
    JOIN vault_document d ON d.id=i.vault_document_id WHERE i.id=?`)
    .get<{ vault_document_id: string; vault_version: number; sha256: string }>(imported.id);
  assert.deepEqual(savedCopy, copy);

  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, () => respond(500, { error: { errors: [{ reason: 'backendError' }] } }), 1);
  await assert.rejects(refreshFile(owner.context, { fileId: file.id }), /500/);
  assert.equal((await listFiles(owner.context, { limit: 50, offset: 0 })).files[0].state, 'not_found');

  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, () => respond(200, {
    id: fileId, name: 'Peça.pdf', mimeType: 'application/pdf', version: '2',
    modifiedTime: '2026-09-23T00:00:02Z', capabilities: { canDownload: true },
  }), 1);
  const restored = (await refreshFile(owner.context, { fileId: file.id })).file;
  assert.equal(restored.state, 'available');
  assert.equal(restored.version, '2');
});

test('importação repetida pela mesma chave é uma cópia só; novo pedido cria versão do mesmo documento', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { version } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const first = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'import-one' })).import;
  const replay = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'import-one' })).import;
  assert.equal(replay.id, first.id);
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  await processDriveImport(job, testDb);
  await processDriveImport(job, testDb);
  const done = await testDb.prepare('SELECT * FROM google_drive_import WHERE id=?').get<{ vault_document_id: string; vault_version: number; sha256: string; status: string }>(first.id);
  assert.equal(done?.status, 'completed');
  assert.equal(done?.vault_version, 1);
  assert.match(done!.sha256, /^[a-f0-9]{64}$/);
  version('2');
  const second = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'import-two' })).import;
  const secondJob = await claimGoogleJob('node', testDb);
  assert.ok(secondJob);
  await processDriveImport(secondJob, testDb);
  const latest = await testDb.prepare('SELECT vault_document_id,vault_version FROM google_drive_import WHERE id=?')
    .get<{ vault_document_id: string; vault_version: number }>(second.id);
  assert.equal(latest?.vault_document_id, done?.vault_document_id);
  assert.equal(latest?.vault_version, 2);
  const count = await testDb.prepare('SELECT count(*) AS n FROM vault_document WHERE id=?').get<{ n: number }>(done!.vault_document_id);
  assert.equal(count?.n, 1);
});

test('Biblioteca importa sem caso e reimporta como versão distinta do destino caso', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { version } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const first = (await importFile(owner.context, { fileId: file.id, scope: 'library', caseId: null,
    idempotencyKey: 'library-one' })).import;
  assert.equal(first.scope, 'library');
  assert.equal(first.caseId, null);
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  await processDriveImport(job, testDb);
  version('2');
  const second = (await importFile(owner.context, { fileId: file.id, scope: 'library', caseId: null,
    idempotencyKey: 'library-two' })).import;
  const secondJob = await claimGoogleJob('node', testDb);
  assert.ok(secondJob);
  await processDriveImport(secondJob, testDb);
  const library = await testDb.prepare('SELECT id,case_id,scope FROM vault_document WHERE id=?')
    .get<{ id: string; case_id: string | null; scope: string }>(first.id);
  assert.equal(library?.scope, 'library');
  assert.equal(library?.case_id, null);
  const repeated = await testDb.prepare('SELECT vault_document_id,vault_version FROM google_drive_import WHERE id=?')
    .get<{ vault_document_id: string; vault_version: number }>(second.id);
  assert.equal(repeated?.vault_document_id, first.id);
  assert.equal(repeated?.vault_version, 2);
  const inCase = (await importFile(owner.context, { fileId: file.id, caseId,
    idempotencyKey: 'same-source-case' })).import;
  const caseJob = await claimGoogleJob('node', testDb);
  assert.ok(caseJob);
  await processDriveImport(caseJob, testDb);
  const caseCopy = await testDb.prepare('SELECT vault_document_id FROM google_drive_import WHERE id=?')
    .get<{ vault_document_id: string }>(inCase.id);
  assert.notEqual(caseCopy?.vault_document_id, first.id);
});

test('Biblioteca rejeita pasta, destino de outro escritório e papel somente leitura', async () => {
  const owner = await googleFixture();
  const reviewer = await googleFixture({ officeId: owner.officeId, role: 'reviewer' });
  const alien = await googleFixture();
  const alienCase = await caseFor(alien.officeId, alien.userId);
  fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  await assert.rejects(importFile(owner.context, { fileId: file.id, scope: 'library', caseId: null,
    folderId: randomUUID(), idempotencyKey: 'library-folder' }), /Biblioteca/);
  await assert.rejects(importFile(owner.context, { fileId: file.id, caseId: alienCase,
    idempotencyKey: 'other-office' }), /não encontrado/i);
  await assert.rejects(importFile(reviewer.context, { fileId: file.id, scope: 'library', caseId: null,
    idempotencyKey: 'reader-library' }), /consultas/i);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM google_drive_import WHERE office_id=?')
    .get<{ n: number }>(owner.officeId))?.n, 0);
});

test('pastas do mesmo caso recebem cópias independentes', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const folderId = randomUUID();
  await testDb.prepare('INSERT INTO vault_folder(id,office_id,case_id,name,created_by) VALUES(?,?,?,?,?)')
    .run(folderId, owner.officeId, caseId, 'Pasta Drive', owner.userId);
  fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const root = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'root-copy' })).import;
  const rootJob = await claimGoogleJob('node', testDb);
  assert.ok(rootJob);
  await processDriveImport(rootJob, testDb);
  const folder = (await importFile(owner.context, { fileId: file.id, caseId, folderId,
    idempotencyKey: 'folder-copy' })).import;
  const folderJob = await claimGoogleJob('node', testDb);
  assert.ok(folderJob);
  await processDriveImport(folderJob, testDb);
  const copy = await testDb.prepare('SELECT id,folder_id FROM vault_document WHERE id=?')
    .get<{ id: string; folder_id: string | null }>(folder.id);
  assert.equal(copy?.folder_id, folderId);
  assert.notEqual(copy?.id, root.id);
  await assert.rejects(importFile(owner.context, { fileId: file.id, caseId, folderId,
    idempotencyKey: 'root-copy' }), /idempotência/i);
});

test('reimportação não altera cópia que foi movida para outra pasta', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const originFolder = randomUUID();
  const newFolder = randomUUID();
  await testDb.prepare('INSERT INTO vault_folder(id,office_id,case_id,name,created_by) VALUES(?,?,?,?,?),(?,?,?,?,?)')
    .run(originFolder, owner.officeId, caseId, 'Origem', owner.userId,
      newFolder, owner.officeId, caseId, 'Destino', owner.userId);
  fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const first = (await importFile(owner.context, { fileId: file.id, caseId, folderId: originFolder,
    idempotencyKey: 'before-move' })).import;
  const firstJob = await claimGoogleJob('node', testDb);
  assert.ok(firstJob);
  await processDriveImport(firstJob, testDb);
  await testDb.prepare('UPDATE vault_document SET folder_id=? WHERE id=? AND office_id=?')
    .run(newFolder, first.id, owner.officeId);

  const second = (await importFile(owner.context, { fileId: file.id, caseId, folderId: originFolder,
    idempotencyKey: 'after-move' })).import;
  const secondJob = await claimGoogleJob('node', testDb);
  assert.ok(secondJob);
  await processDriveImport(secondJob, testDb);
  const moved = await testDb.prepare('SELECT folder_id FROM vault_document WHERE id=?')
    .get<{ folder_id: string | null }>(first.id);
  const fresh = await testDb.prepare('SELECT folder_id FROM vault_document WHERE id=?')
    .get<{ folder_id: string | null }>(second.id);
  const oldVersions = await testDb.prepare('SELECT count(*) AS n FROM vault_document_version WHERE document_id=?')
    .get<{ n: number }>(first.id);
  assert.equal(moved?.folder_id, newFolder);
  assert.equal(fresh?.folder_id, originFolder);
  assert.equal(oldVersions?.n, 1);
});

test('formato nativo, limite de exportação e texto de abas têm tratamento explícito', async () => {
  assert.equal(importFormatFor('application/vnd.google-apps.document')?.extension, '.docx');
  assert.equal(importFormatFor('application/vnd.google-apps.spreadsheet')?.extension, '.xlsx');
  assert.equal(importFormatFor('application/vnd.google-apps.presentation')?.extension, '.pdf');
  assert.equal(importFormatFor('application/vnd.google-apps.folder'), null);
  assert.equal(GOOGLE_EXPORT_LIMIT_BYTES, 10 * 1024 * 1024);
  const doc = documentText({ tabs: [
    { tabProperties: { tabId: 'a' }, documentTab: { body: { content: [{ paragraph: { elements: [{ startIndex: 1, textRun: { content: 'Primeiro' } }] } }] } } },
    { tabProperties: { tabId: 'b' }, documentTab: { body: { content: [{ paragraph: { elements: [{ startIndex: 1, textRun: { content: 'Segundo' } }] } }] } } },
  ] });
  assert.match(doc.text, /Primeiro/);
  const resolved = resolveEdits(doc, [{ find: 'Segundo', replace: 'Outro' }], false);
  assert.equal(resolved[0].tabId, 'b');
  assert.deepEqual((editRequests(resolved)[0] as { deleteContentRange: { range: { tabId: string } } }).deleteContentRange.range.tabId, 'b');
  assert.throws(() => resolveEdits(doc, [{ find: 'Primeiro￼Segundo', replace: 'x' }], false));
});

test('Google Docs escolhido exporta DOCX e recusa exportação acima de 10 MB sem criar documento', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { fake } = fakeDrive('application/vnd.google-apps.document', new Uint8Array(GOOGLE_EXPORT_LIMIT_BYTES + 1));
  fake.on('GET', /\/docs\.googleapis\.com\/v1\/documents\/drive-file-123456789$/, () => respond(200, {
    documentId: fileId, title: 'Peça', revisionId: 'r1',
    tabs: [{ tabProperties: { tabId: 'tab-1' }, documentTab: { body: { content: [{ paragraph: { elements: [{ startIndex: 1, textRun: { content: 'Texto do cliente' } }] } }] } } }],
  }));
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  assert.equal(file.importFormat, 'DOCX');
  assert.equal((await readDoc(owner.context, { fileId: file.id })).document.text, 'Texto do cliente');
  const queued = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'large-export' })).import;
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  await processDriveImport(job, testDb);
  const result = await testDb.prepare('SELECT status,error_message,vault_document_id FROM google_drive_import WHERE id=?')
    .get<{ status: string; error_message: string; vault_document_id: string | null }>(queued.id);
  assert.equal(result?.status, 'failed');
  assert.match(result!.error_message, /10 MB/);
  assert.equal(result?.vault_document_id, null);
});

test('limite de 50 MB é aplicado antes de criar job ou baixar arquivo', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { fake } = fakeDrive();
  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, r => r.query.get('alt') === 'media'
    ? respond(200, new Uint8Array([1])) : respond(200, { id: fileId, name: 'Grande.pdf', mimeType: 'application/pdf',
      size: String(MAX_IMPORT_BYTES + 1), version: '1', modifiedTime: '2026-09-23T00:00:01Z', capabilities: { canDownload: true } }));
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  await assert.rejects(importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'too-large' }), /50 MB/);
  assert.equal(fake.count('GET', /\/drive\/v3\/files\/drive-file-123456789$/), 2);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM google_drive_import WHERE office_id=?').get<{ n: number }>(owner.officeId))?.n, 0);
});

test('não revoga acesso herdado ou arquivo de outra pessoa', async () => {
  const owner = await googleFixture();
  const other = await googleFixture({ officeId: owner.officeId, role: 'administrator' });
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  await assert.rejects(revokePermission(owner.context, { fileId: file.id, permissionId: 'inherited', idempotencyKey: 'inherited' }), /herdado/i);
  await assert.rejects(revokePermission(other.context, { fileId: file.id, permissionId: 'direct', idempotencyKey: 'other-owner' }), /não encontrado/i);
  assert.equal(fake.count('DELETE', /\/drive\/v3\/files\/drive-file-123456789\/permissions\//), 0);
});

test('Docs exige revisão lida novamente quando texto remoto mudou', async () => {
  const owner = await googleFixture();
  const { fake } = fakeDrive('application/vnd.google-apps.document');
  fake.on('GET', /\/docs\.googleapis\.com\/v1\/documents\/drive-file-123456789$/, () => respond(200, {
    documentId: fileId, title: 'Peça', revisionId: 'r2',
    tabs: [{ tabProperties: { tabId: 'tab-1' }, documentTab: { body: { content: [{ paragraph: { elements: [
      { startIndex: 1, textRun: { content: 'Texto alterado no Google' } },
    ] } }] } } }],
  }));
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  await assert.rejects(editDoc(owner.context, { fileId: file.id, revisionId: 'r1',
    edits: [{ find: 'Texto alterado no Google', replace: 'Novo texto' }], idempotencyKey: 'stale-doc' }), /mudou/i);
  assert.equal(fake.count('POST', /\/documents\/drive-file-123456789:batchUpdate$/), 0);
});

test('importação para se o titular perder acesso ao escritório antes do worker', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const queued = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'revoked-owner' })).import;
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(owner.officeId, owner.userId);
  await processDriveImport(job, testDb);
  const row = await testDb.prepare('SELECT status,vault_document_id FROM google_drive_import WHERE id=?')
    .get<{ status: string; vault_document_id: string | null }>(queued.id);
  assert.equal(row?.status, 'failed');
  assert.equal(row?.vault_document_id, null);
});

test('versão alterada no Google depois da fila exige novo pedido e não copia bytes novos', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { fake, version } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const queued = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'changed-source' })).import;
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  version('2');
  await processDriveImport(job, testDb);
  const row = await testDb.prepare('SELECT status,vault_document_id FROM google_drive_import WHERE id=?')
    .get<{ status: string; vault_document_id: string | null }>(queued.id);
  assert.equal(row?.status, 'failed');
  assert.equal(row?.vault_document_id, null);
  assert.equal(fake.calls.filter(call => call.query?.get('alt') === 'media').length, 0);
});

test('lease vencida após download não marca importação como falha terminal nem cria versão', async () => {
  const owner = await googleFixture();
  const caseId = await caseFor(owner.officeId, owner.userId);
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  const queued = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'lost-lease' })).import;
  const job = await claimGoogleJob('node', testDb);
  assert.ok(job);
  fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, async r => {
    if (r.query.get('alt') === 'media') {
      await testDb.prepare("UPDATE google_job SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE id=?").run(job.id);
      return respond(200, new TextEncoder().encode('%PDF-1.4\n'));
    }
    return respond(200, { id: fileId, name: 'Peça.pdf', mimeType: 'application/pdf', size: '9', version: '1',
      modifiedTime: '2026-09-23T00:00:01Z', capabilities: { canDownload: true } });
  });
  await assert.rejects(processDriveImport(job, testDb), /licença da fila expirou/i);
  const row = await testDb.prepare('SELECT status,vault_document_id FROM google_drive_import WHERE id=?')
    .get<{ status: string; vault_document_id: string | null }>(queued.id);
  assert.equal(row?.status, 'running');
  assert.equal(row?.vault_document_id, null);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM vault_document WHERE case_id=?').get<{ n: number }>(caseId))?.n, 0);
});

test('efeito desconhecido de renomear bloqueia compartilhamento do mesmo arquivo', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'drive.rename', { mode: 'automatic' });
  await setRule(owner.officeId, 'drive.share', { mode: 'automatic' });
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  fake.failNetwork('PATCH', /\/drive\/v3\/files\/drive-file-123456789$/);
  const renamed = await renameFile(owner.context, { fileId: file.id, name: 'Novo nome.pdf', idempotencyKey: 'uncertain-rename' });
  assert.equal(renamed.operation.status, 'unknown');
  const replay = await renameFile(owner.context, { fileId: file.id, name: 'Novo nome.pdf', idempotencyKey: 'uncertain-rename' });
  assert.equal(replay.operation.status, 'unknown');
  assert.equal(fake.count('PATCH', /\/drive\/v3\/files\/drive-file-123456789$/), 1);
  await assert.rejects(shareFile(owner.context, { fileId: file.id, email: 'pessoa@example.com', role: 'reader', notify: true,
    idempotencyKey: 'share-different-key' }), /em andamento|em verificação/i);
  assert.equal(fake.count('POST', /\/drive\/v3\/files\/drive-file-123456789\/permissions$/), 0);
});

test('403 explícito antes de qualquer efeito conclui operação como falha definitiva', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'drive.rename', { mode: 'automatic' });
  const { fake } = fakeDrive();
  const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
  fake.on('PATCH', /\/drive\/v3\/files\/drive-file-123456789$/, () => respond(403, {
    error: { code: 403, message: 'Forbidden', errors: [{ reason: 'insufficientFilePermissions' }] },
  }));
  await assert.rejects(renameFile(owner.context, { fileId: file.id, name: 'Recusado.pdf', idempotencyKey: 'explicit-403' }), /permissão|Google/i);
  const row = await testDb.prepare("SELECT status,has_effect FROM google_operation WHERE office_id=? AND idempotency_key='key:explicit-403'")
    .get<{ status: string; has_effect: number }>(owner.officeId);
  assert.equal(row?.status, 'failed');
  assert.equal(row?.has_effect, 0);
});

for (const staleFinishesFirst of [false, true]) {
  test(`expired import attempt cannot delete the winner's object (${staleFinishesFirst ? 'stale cleanup before commit' : 'winner commits first'})`, { timeout: 15_000 }, async () => {
    const owner = await googleFixture();
    const caseId = await caseFor(owner.officeId, owner.userId);
    const { fake } = fakeDrive();
    const file = (await registerFiles(owner.context, { googleFileIds: [fileId] })).files[0];
    const queued = (await importFile(owner.context, { fileId: file.id, caseId, idempotencyKey: 'lease-race' })).import;
    const claim = () => testDb.prepare(`UPDATE google_job SET status='running',lease_token=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '2 minutes',attempts=attempts+1
      WHERE subject_id=? AND kind='drive_import' RETURNING *`).get<GoogleJob>(randomUUID(), queued.id);
    const first = await claim();
    assert.ok(first);
    const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
    const downloading = gate(), releaseDownload = gate(), winnerStored = gate(), releaseWinner = gate();
    let downloads = 0;
    fake.on('GET', /\/drive\/v3\/files\/drive-file-123456789$/, async request => {
      if (request.query.get('alt') === 'media') {
        if (++downloads === 1) { downloading.release(); await releaseDownload.promise; }
        return respond(200, new TextEncoder().encode('%PDF-1.4\n'));
      }
      return respond(200, { id: fileId, name: 'Peça.pdf', mimeType: 'application/pdf', size: '9', version: '1',
        modifiedTime: '2026-09-23T00:00:01Z', capabilities: { canDownload: true } });
    });
    const objects = new Map<string, Buffer>(), keys: string[] = [];
    resetObjectStorageForTests({
      async put(key, bytes) {
        keys.push(key); objects.set(key, Buffer.from(bytes));
        if (keys.length === 1) { winnerStored.release(); if (staleFinishesFirst) await releaseWinner.promise; }
      },
      async get(key) { const bytes = objects.get(key); assert.ok(bytes, 'referenced object must exist'); return bytes; },
      async delete(key) { objects.delete(key); },
    });
    const stale = processDriveImport(first, testDb);
    const staleResult = staleFinishesFirst ? assert.rejects(stale, /licença da fila expirou/i) : stale;
    try {
      await downloading.promise;
      await testDb.prepare("UPDATE google_job SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?").run(first.id);
      const second = await claim(); assert.ok(second);
      const winner = processDriveImport(second, testDb);
      await winnerStored.promise;
      if (staleFinishesFirst) {
        releaseDownload.release(); await staleResult; releaseWinner.release(); await winner;
      } else {
        await winner; releaseDownload.release(); await staleResult;
      }
      const saved = await testDb.prepare(`SELECT i.status,v.stored_name FROM google_drive_import i
        JOIN vault_document_version v ON v.document_id=i.vault_document_id AND v.version=i.vault_version WHERE i.id=?`)
        .get<{ status: string; stored_name: string }>(queued.id);
      assert.equal(saved?.status, 'completed');
      assert.equal(keys.length, 2);
      assert.notEqual(keys[0], keys[1], 'each attempt needs its own object key');
      assert.equal(saved?.stored_name, keys[0]);
      assert.equal(objects.size, 1);
      assert.equal(objects.get(saved!.stored_name)?.toString(), '%PDF-1.4\n');
    } finally { releaseDownload.release(); releaseWinner.release(); }
  });
}
