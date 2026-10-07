import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase as db } from './test-setup';
import { createPrivateDocument } from '../src/lib/documents/service';
import { personPolicy } from '../src/lib/content-policy';
import { caseArtifacts } from '../src/lib/case-artifacts';
import { saveArtifactToVault } from '../src/lib/application/vault-service';

test('case artifacts include only related private originals and visible Vault copies', async () => {
  const owner = { userId: randomUUID(), officeId: randomUUID() };
  const outsider = { userId: randomUUID(), officeId: randomUUID() };
  for (const identity of [owner, outsider]) {
    await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(identity.officeId, 'Artefatos por caso');
    await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(identity.userId, `${identity.userId}@example.test`, 'Advogado');
    await db.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), identity.officeId, identity.userId);
  }
  const caseId = randomUUID(), otherCaseId = randomUUID();
  for (const id of [caseId, otherCaseId]) await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(id, owner.officeId, 'Caso de verificação', owner.userId);
  const source = personPolicy('Caso', 'Texto');
  source.guards = [{ kind: 'case', id: caseId }];
  const related = await createPrivateDocument(owner, { title: 'Minuta do caso', content: 'Texto próprio.', sources: [source] });
  const unrelated = await createPrivateDocument(owner, { title: 'Outra minuta', content: 'Outro texto.' });
  assert.deepEqual((await caseArtifacts(owner, caseId)).map(item => item.id), [related.id]);
  assert.deepEqual(await caseArtifacts(owner, otherCaseId), []);
  await assert.rejects(caseArtifacts(outsider, caseId), /acesso removido/);
  const copy = await saveArtifactToVault(owner, { artifactId: related.id, version: related.version, format: 'docx', scope: 'case', caseId });
  const items = await caseArtifacts(owner, caseId);
  assert.ok(items.some(item => item.id === related.id && item.place === 'private'));
  assert.ok(items.some(item => item.id === copy.document.id && item.place === 'vault' && Number(item.version) === related.version));
  assert.ok(!items.some(item => item.id === unrelated.id));
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(copy.document.id);
  assert.ok(!(await caseArtifacts(owner, caseId)).some(item => item.id === copy.document.id));
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  await assert.rejects(caseArtifacts(owner, caseId), /acesso removido/);
});
