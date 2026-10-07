import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { googleFixture } from './google-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument, createVaultFolder, readVaultDocumentFile, listVaultDocuments, processDocument } from '../src/lib/vault';
import { personPolicy, exposedPolicies, observeDocument, contentDigest } from '../src/lib/content-policy';
import { createPrivateDocument, updatePrivateDocument } from '../src/lib/documents/service';
import { changeAccess } from '../src/lib/collaboration/service';
import { runCapability } from '../src/lib/agent-tools';
import { analyzeAnnexes, generateAnnexes, getAnnexPlan } from '../src/lib/annexes';

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
async function provider(t: Parameters<typeof recordingWriter>[0], f: Awaited<ReturnType<typeof fixture>>, outputs: object[] = [{ documents: [{ label: 'Laudo PETITION_SECRET', startPage: 1, endPage: 1, mention: 'laudo familiar protegido' }] }]) {
  const wire = await recordingWriter(t, f.userId, outputs);
  const connection = await db.prepare('SELECT id FROM ai_connection WHERE name=?').get<{ id: string }>(`Writer fixture ${f.userId}`);
  assert.ok(connection);
  await updateModelAssignment(db, f.userId, { scope: 'task', target: 'extraction.annex_plan', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  return wire;
}

test('actual analyze -> edited review -> generate retains the petition policy in filenames and denies revocation', async t => {
  const f = await fixture(), guest = await googleFixture(); await provider(t, f);
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?)').run(f.officeId, guest.userId, f.userId);
  await changeAccess(f.context, { action: 'participant', caseId: f.caseId, userId: guest.userId, add: true });
  const plan = await runCapability(f.context, 'k5_vault_plan_annexes', { caseId: f.caseId, scanDocumentId: f.scan.id, petitionDocumentId: f.petition.id }) as Awaited<ReturnType<typeof analyzeAnnexes>>;
  assert.ok(plan.planId);
  assert.equal((await getAnnexPlan(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id })).plan?.planId, plan.planId);
  assert.deepEqual(await getAnnexPlan({ ...guest.context, officeId: f.officeId }, { caseId: f.caseId, scanDocumentId: f.scan.id }), { plan: null });
  const input = { caseId: f.caseId, scanDocumentId: plan.scanDocumentId, planId: plan.planId, items: [{ ...plan.items[0], label: 'Rótulo editado PETITION_SECRET' }], idempotencyKey: randomUUID() };
  const generated = await runCapability(f.context, 'k5_vault_generate_annexes', input) as Awaited<ReturnType<typeof generateAnnexes>>;
  const id = generated.documents[0].id;
  assert.ok((await readVaultDocumentFile(f.officeId, id, f.userId)).buffer.length);
  assert.ok(!(await listVaultDocuments(f.officeId, guest.userId, { caseId: f.caseId })).some(document => document.id === id));
  await assert.rejects(readVaultDocumentFile(f.officeId, id, guest.userId), /não encontrado/);
  const omitted = await generateAnnexes(f.context, { ...input, planId: undefined, folderName: 'Revisão sem ID' });
  await assert.rejects(readVaultDocumentFile(f.officeId, omitted.documents[0].id, guest.userId), /não encontrado/);
  await assert.rejects(generateAnnexes(f.context, { ...input, planId: randomUUID() }), { code: 'NOT_FOUND' });
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.petition.id);
  await assert.rejects(getAnnexPlan(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id }), { code: 'NOT_FOUND' });
  await assert.rejects(generateAnnexes(f.context, input), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(f.context, 'k5_vault_generate_annexes', input), { code: 'NOT_FOUND' });
});

test('reviewed scan V1 cannot silently cut V2; independent human splits still work', async t => {
  const f = await fixture(); await provider(t, f);
  const plan = await analyzeAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, petitionText: 'O documento de identificação está juntado para comprovar os fatos narrados pela pessoa nesta petição.' });
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); pdf.addPage();
  const ref = await createUploadRef(f.context, new File([new Uint8Array(await pdf.save())], 'v2.pdf', { type: 'application/pdf' }));
  await runCapability(f.context, 'k5_vault_add_document_version', { documentId: f.scan.id, uploadRef: ref.id });
  await assert.rejects(generateAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, planId: plan.planId, items: [{ label: 'Revisado', startPage: 1, endPage: 1 }] }), { code: 'CONFLICT' });
  await assert.rejects(generateAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, items: [{ label: 'Sem ID', startPage: 1, endPage: 1 }] }), { code: 'CONFLICT' });
  const independent = await fixture();
  const output = await generateAnnexes(independent.context, { caseId: independent.caseId, scanDocumentId: independent.scan.id, items: [{ label: 'Identificação humana', startPage: 1, endPage: 1 }] });
  assert.ok((await readVaultDocumentFile(independent.officeId, output.documents[0].id, independent.userId)).buffer.length);
});

test('private tools cannot classify arbitrary petition text or edited labels as human intent', async t => {
  const f = await fixture(); await provider(t, f);
  const actor = { ...f.context, invocation: 'agent' as const };
  await assert.rejects(analyzeAnnexes(actor, { caseId: f.caseId, scanDocumentId: f.scan.id, petitionText: 'Private arbitrary planner body '.repeat(5) }), { code: 'INVALID' });
  const plan = await analyzeAnnexes(actor, { caseId: f.caseId, scanDocumentId: f.scan.id, petitionDocumentId: f.petition.id });
  const normal = await generateAnnexes(actor, { caseId: f.caseId, scanDocumentId: f.scan.id, planId: plan.planId, items: [{ label: plan.items[0].label, startPage: 1, endPage: 1 }] });
  assert.ok(exposedPolicies(normal)?.every(policy => policy.eligible));
  const changed = await generateAnnexes(actor, { caseId: f.caseId, scanDocumentId: f.scan.id, planId: plan.planId, folderName: 'Edição particular', items: [{ label: 'PRIVATE_PLANNER_LABEL', startPage: 1, endPage: 1 }] });
  assert.ok(exposedPolicies(changed)?.every(policy => !policy.eligible));
});

test('artifact petition retains its exact reviewed version and policy after later private editing', async t => {
  const f = await fixture(); await provider(t, f);
  const source = await observeDocument(f.userId, f.petition.id);
  const artifact = await createPrivateDocument(f.context, { title: 'Petição particular', content: source.content, sources: [source.policy] });
  const plan = await analyzeAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, petitionArtifactId: artifact.id });
  const retained = await db.prepare('SELECT petition_policy FROM annex_plan WHERE id=?').get<{ petition_policy: { observed: { kind: string; id: string; version: string; digest: string }[] } }>(plan.planId);
  assert.ok(retained?.petition_policy.observed.some(pin => pin.kind === 'artifact' && pin.id === artifact.id && pin.version === '1' && pin.digest === contentDigest(artifact.title, artifact.content)));
  await updatePrivateDocument(f.context, { id: artifact.id, title: artifact.title, content: 'Unrelated later private revision.', version: 1 });
  const generated = await generateAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, planId: plan.planId, items: [{ label: plan.items[0].label, startPage: 1, endPage: 1 }] });
  assert.ok(exposedPolicies(generated)?.some(policy => policy.observed.some(pin => pin.kind === 'artifact' && pin.id === artifact.id && pin.version === '1')));
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.petition.id);
  await assert.rejects(generateAnnexes(f.context, { caseId: f.caseId, scanDocumentId: f.scan.id, planId: plan.planId, items: [{ label: 'Reviewed', startPage: 1, endPage: 1 }] }), { code: 'NOT_FOUND' });
});

test('independent plans for one scan retain only their own petitions while known edited plans stay bound', async t => {
  const f = await fixture();
  const publicOutput = { documents: [{ label: 'Identificação', startPage: 1, endPage: 1, mention: 'documento de identificação' }] };
  const wire = await provider(t, f, [publicOutput, { documents: [{ label: 'Laudo PETITION_SECRET', startPage: 1, endPage: 1, mention: 'laudo familiar protegido' }] }, publicOutput]);
  const selected = { caseId: f.caseId, scanDocumentId: f.scan.id };
  const petitionText = 'O documento de identificação está juntado para comprovar os fatos narrados nesta petição independente.';
  const publicPlan = await analyzeAnnexes(f.context, { ...selected, petitionText });
  const privatePlan = await analyzeAnnexes(f.context, { ...selected, petitionDocumentId: f.petition.id });
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.petition.id);
  await assert.rejects(getAnnexPlan(f.context, selected), { code: 'NOT_FOUND' });
  const items = [{ label: 'Identificação revisada', startPage: 1, endPage: 1 }];
  await assert.rejects(generateAnnexes(f.context, { ...selected, planId: privatePlan.planId, items }), { code: 'NOT_FOUND' });
  const historical = await generateAnnexes(f.context, { ...selected, planId: publicPlan.planId, folderName: 'Plano histórico', items });
  assert.ok((await readVaultDocumentFile(f.officeId, historical.documents[0].id, f.userId)).buffer.length);
  const fresh = await analyzeAnnexes(f.context, { ...selected, petitionText });
  assert.equal(wire.length, 3);
  assert.doesNotMatch(JSON.stringify(wire[2].body), /PETITION_SECRET/);
  assert.notEqual(fresh.planId, publicPlan.planId);
  assert.equal((await getAnnexPlan(f.context, selected)).plan?.planId, fresh.planId);
  const generated = await generateAnnexes(f.context, { ...selected, folderName: 'Novo plano independente', items });
  assert.ok((await readVaultDocumentFile(f.officeId, generated.documents[0].id, f.userId)).buffer.length);
  for (const result of [historical, fresh, generated]) {
    assert.ok(exposedPolicies(result)?.every(policy => policy.guards.every(guard => guard.id !== f.petition.id)));
  }
});
