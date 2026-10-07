import { testDb as db } from '../apps/web/tests/test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const { PDFDocument } = createRequire(new URL('../apps/web/package.json', import.meta.url))('pdf-lib');
import { googleFixture } from '../apps/web/tests/google-fixture';
import { recordingWriter } from '../apps/web/tests/shared-writing-fixture';
import { updateModelAssignment } from '../apps/web/src/lib/ai-assignments-core';
import { createUploadRef } from '../apps/web/src/lib/application/uploads-service';
import { createVaultDocument, createVaultFolder, readVaultDocumentFile, listVaultDocuments, processDocument } from '../apps/web/src/lib/vault';
import { personPolicy, exposedPolicies, observeDocument, contentDigest } from '../apps/web/src/lib/content-policy';
import { createPrivateDocument, updatePrivateDocument } from '../apps/web/src/lib/documents/service';
import { changeAccess } from '../apps/web/src/lib/collaboration/service';
import { runCapability } from '../apps/web/src/lib/agent-tools';
import { analyzeAnnexes, generateAnnexes, getAnnexPlan } from '../apps/web/src/lib/annexes';

async function fixture() {
  const f = await googleFixture(); const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Anexos', f.userId);
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const upload = await createUploadRef(f.context, new File([new Uint8Array(await pdf.save())], 'scan.pdf', { type: 'application/pdf' }));
  const scan = await createVaultDocument(f.context, upload, { scope: 'case', caseId, policy: personPolicy('', '') });
  await db.prepare("UPDATE vault_document SET status='ready',extracted_version=1,extracted_sha256=sha256 WHERE id=?").run(scan.id);
  await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)')
    .run(randomUUID(), scan.id, f.officeId, 'página:1', 'Documentos de identificação.');
  const folder = await createVaultFolder(f.officeId, f.userId, caseId, 'Petição reservada', null, { visibility: 'private' }, f.context);
  const petitionUpload = await createUploadRef(f.context, new File(['PETITION_SECRET: laudo familiar protegido está juntado como documento comprobatório para exame da demanda.'], 'peticao.txt', { type: 'text/plain' }));
  const petition = await createVaultDocument(f.context, petitionUpload, { scope: 'case', caseId, folderId: folder.id, policy: personPolicy('', '') });
  await processDocument(petition.id, f.officeId);
  return { ...f, caseId, scan, petition };
}
async function provider(t: Parameters<typeof recordingWriter>[0], f: Awaited<ReturnType<typeof fixture>>, count = 1) {
  const wire = await recordingWriter(t, f.userId, Array.from({ length: count }, () => ({ documents: [{ label: 'Documento de identificação', startPage: 1, endPage: 1, mention: 'documento de identificação' }] })));
  const connection = await db.prepare('SELECT id FROM ai_connection WHERE name=?').get<{ id: string }>(`Writer fixture ${f.userId}`);
  assert.ok(connection);
  await updateModelAssignment(db, f.userId, { scope: 'task', target: 'extraction.annex_plan', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  return wire;
}


test('fresh independent annex analysis does not inherit a revoked earlier petition for the same scan', async t => {
  const f = await fixture();
  const wire = await provider(t, f, 2);
  const old = await analyzeAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, petitionDocumentId: f.petition.id });
  assert.ok(old.planId);
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.petition.id);
  let result: Awaited<ReturnType<typeof analyzeAnnexes>> | undefined, failure: unknown;
  try {
    result = await analyzeAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id,
      petitionText: 'O documento de identificação está juntado para comprovar os fatos narrados pela pessoa nesta nova petição independente.' });
  } catch (error) { failure = error; }
  console.log(JSON.stringify({ freshIndependentAnalysis: result ? 'succeeded' : 'blocked', code: (failure as { code?: string } | undefined)?.code ?? null, providerCalls: wire.length }));
  assert.equal(failure, undefined, 'A new admitted independent analysis must not retain an unrelated earlier petition');
  assert.notEqual(result!.planId, old.planId);
  assert.equal(wire.length, 2);
  assert.doesNotMatch(JSON.stringify(wire[1].body), /PETITION_SECRET/);
  assert.ok(exposedPolicies(result)?.every(policy => policy.guards.every(guard => guard.id !== f.petition.id)));
});

