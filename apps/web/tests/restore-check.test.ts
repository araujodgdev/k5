import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './test-setup';
import { postgresFixture } from './postgres-fixture';
import { localObjectStorage, storageKey } from '../src/lib/storage';
import { createCredentialKeyring, encryptCredential } from '../src/lib/platform-crypto';
import { restoreCheck } from '../src/lib/restore-check';

const migrations = new URL('../db/postgres/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('the restore check passes a faithful copy and names each missing original, changed byte, unreadable secret and unindexed document', async () => {
  const { db } = await postgresFixture();
  const storage = localObjectStorage(mkdtempSync(join(tmpdir(), 'k5-restore-')));
  const key = randomBytes(32), keyring = createCredentialKeyring(key);
  const officeId = randomUUID(), userId = randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Restauração');
  await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Teste');
  const documents: Array<{ id: string; key: string }> = [];
  for (const name of ['contrato.pdf', 'procuracao.pdf']) {
    const id = randomUUID(), stored = storageKey(officeId, id, '.pdf'), bytes = Buffer.from(`original de ${name}`);
    await storage.put(stored, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await db.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,extracted_characters,created_by)
      VALUES(?,?,'library',?,?,'application/pdf',?,?,'ready',10,?)`).run(id, officeId, name, stored, bytes.length, sha256, userId);
    await db.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by)
      VALUES(?,?,?,1,?,?,'application/pdf',?,?,?)`).run(randomUUID(), officeId, id, name, stored, bytes.length, sha256, userId);
    await db.prepare(`INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,'p1','texto')`).run(randomUUID(), id, officeId);
    documents.push({ id, key: stored });
  }
  await db.prepare(`INSERT INTO ai_connection(id,office_id,name,provider,encrypted_api_key,api_key_hint) VALUES(?,?,?,?,?,?)`)
    .run(randomUUID(), officeId, 'Conexão', 'openai', encryptCredential('sk-restaurada', key), '••••');

  const run = (options: Partial<Parameters<typeof restoreCheck>[0]> = {}) => restoreCheck({ database: db, storage, keyring, migrations, sample: 0, ...options });
  const faithful = await run();
  assert.equal(faithful.ok, true, JSON.stringify(faithful, null, 2));
  assert.equal(faithful.migrations.pending.length, 0);
  assert.equal(faithful.originals.checked, 2);
  assert.deepEqual(faithful.credentials, [{ column: 'ai_connection.encrypted_api_key', checked: 1, failed: 0 }]);
  assert.equal(faithful.counts.vault_document, 2);
  assert.ok(faithful.lastWrite);

  await storage.delete(documents[0].key);
  await storage.put(documents[0].key, Buffer.from('bytes trocados'));
  await storage.delete(documents[1].key);
  await db.prepare('DELETE FROM vault_document_chunk WHERE document_id=?').run(documents[1].id);
  const broken = await run({ keyring: createCredentialKeyring(randomBytes(32)) });
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.originals.mismatched, [documents[0].key]);
  assert.deepEqual(broken.originals.missing, [documents[1].key]);
  assert.equal(broken.credentials[0].failed, 1);
  assert.deepEqual(broken.index.withoutChunks, [documents[1].id]);

  await db.prepare("INSERT INTO postgres_migration(name,checksum) VALUES('9999_futura.sql','x')").run();
  assert.deepEqual((await run()).migrations.unknown, ['9999_futura.sql'], 'a copy newer than this code is flagged');
});
