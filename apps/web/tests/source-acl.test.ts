import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ensureOfficeForUser } from '../src/lib/offices';
import { authStore } from '../src/lib/database';
import { changeAccess } from '../src/lib/collaboration/service';
import { createPage } from '../src/lib/case-pages/service';
import { googleFixture } from './google-fixture';
import { createFolder, updateFolderAccess, updateDocument } from '../src/lib/application/vault-service';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument } from '../src/lib/vault';
import { personPolicy } from '../src/lib/content-policy';

test('actual participant grant and page creation do not deadlock on office foreign keys', { timeout: 25_000 }, async () => {
  const ownerId = randomUUID(), guestId = randomUUID(), caseId = randomUUID();
  for (const userId of [ownerId, guestId]) await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@gate-repro.test`, 'Pessoa');
  const { officeId } = await ensureOfficeForUser(db, { id: ownerId, officeName: 'Repro de locks' });
  await ensureOfficeForUser(db, { id: guestId, officeName: 'Associado' });
  const context = { userId: ownerId, officeId };
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso de locks', ownerId);
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?)').run(officeId, guestId, ownerId);
  const pool = await authStore();
  const holder = await pool.connect();
  let grant: Promise<PromiseSettledResult<unknown>[]> | undefined;
  let page: Promise<PromiseSettledResult<unknown>[]> | undefined;
  const blocked = async (pattern: string) => {
    for (let observations = 0; observations < 200; observations++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const result = await holder.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1", [pattern]);
      if (result.rows[0].n > 0) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Production operation did not reach expected lock: ${pattern}`);
  };
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM office WHERE id=$1 FOR UPDATE', [officeId]);
    grant = Promise.allSettled([changeAccess(context, { action: 'participant', caseId, userId: guestId, add: true })]);
    await blocked('SELECT id FROM office WHERE%FOR UPDATE');
    page = Promise.allSettled([createPage(context, { caseId, title: 'Página concorrente', content: 'Texto' })]);
    await blocked('%pg_advisory_xact_lock_shared%');
    await holder.query('COMMIT');
    const results = [...await grant, ...await page];
    const outcomes = results.map(result => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, code: result.reason?.code, message: result.reason?.message });
    console.log(JSON.stringify({ actualProductionOutcomes: outcomes }));
    assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled'], 'Participant management and content creation must not acquire office/gate locks in opposite order');
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await Promise.all([grant, page]);
  }
});

test('a real folder restriction commits before a queued real move; denied move preserves source and bytes', async () => {
  const a = await googleFixture(), b = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, a.officeId, 'Mudança concorrente', a.userId);
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?)').run(a.officeId, b.userId, a.userId);
  await changeAccess(a.context, { action: 'participant', caseId, userId: b.userId, add: true });
  const folder = (await createFolder(a.context, { caseId, name: 'Origem', visibility: 'public' })).folder;
  const upload = await createUploadRef(a.context, new File(['UNCHANGED_SOURCE_BYTES'], 'contrato.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(a.context, upload, { scope: 'case', caseId, folderId: folder.id, policy: personPolicy('', '') });
  const guest = { ...b.context, officeId: a.officeId, caseScope: { caseId, homeOfficeId: b.officeId } };
  const holder = await (await authStore()).connect();
  const waitFor = async (count: number) => {
    for (let n = 0; ; n++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const r = await holder.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(%'");
      if (r.rows[0].n >= count) return;
      assert.ok(n < 250, 'Actual service mutations must reach the exclusive gate');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  let restriction: Promise<unknown> | undefined, move: Promise<void> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('lume:content-acl:' || current_schema(),0))");
    restriction = updateFolderAccess(a.context, { folderId: folder.id, visibility: 'private' });
    await waitFor(1);
    move = assert.rejects(updateDocument(guest, { documentId: document.id, folderId: null }), { code: 'NOT_FOUND' });
    await waitFor(2);
    await holder.query('COMMIT');
    await restriction; await move;
    assert.deepEqual(await db.prepare('SELECT folder_id,sha256 FROM vault_document WHERE id=?').get(document.id), { folder_id: folder.id, sha256: upload.sha256 });
    await updateFolderAccess(a.context, { folderId: folder.id, visibility: 'public' });
    assert.equal((await updateDocument(guest, { documentId: document.id, folderId: null })).document.folderId, null);
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await Promise.allSettled([restriction, move]); }
});
