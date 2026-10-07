import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { setGoogleTransport } from '../src/lib/google/transport';
import { sendMail } from '../src/lib/google/gmail/service';
import { createConversation } from '../src/lib/ai-store';
import { createPage } from '../src/lib/case-pages/service';
import { observePage, type ContentPolicy } from '../src/lib/content-policy';
import { createPrivateDocument } from '../src/lib/documents/service';
import { saveInstruction } from '../src/lib/agent-instructions';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { runCapability } from '../src/lib/agent-tools';
import {registerFiles,uploadVersion} from '../src/lib/google/drive/service';
import {createVaultDocument} from '../src/lib/vault';
import {personPolicy} from '../src/lib/content-policy';
import {approveProposal} from '../src/lib/application/approvals-service';
afterEach(() => setGoogleTransport(undefined));

async function fixture() {
  const f = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Limites de acesso', f.userId);
  return { ...f, caseId };
}

test('a reader cannot mail another contributor\'s restricted original', async () => {
  const a = await fixture(), b = await googleFixture();
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?),(?,?,?)').run(a.officeId, b.userId, a.userId, b.officeId, a.userId, b.userId);
  await db.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(a.officeId, a.caseId, b.userId, a.userId);
  const { folder } = await runCapability(b.context, 'k5_vault_create_folder', { caseId: a.caseId, name: 'Originais reservados', visibility: 'restricted', memberIds: [a.userId] }) as { folder: { id: string } };
  const bytes = 'ANOTHER_AUTHOR_RESTRICTED_ORIGINAL';
  const upload = await createUploadRef(b.context, new File([bytes], 'reservado.txt', { type: 'text/plain' }));
  const { document } = await runCapability(b.context, 'k5_vault_ingest_upload', { uploadRef: upload.id, scope: 'case', caseId: a.caseId, folderId: folder.id }) as { document: { id: string } };
  await assert.rejects(runCapability(a.context, 'k5_vault_update_document', { documentId: document.id, folderId: null }), { code: 'FORBIDDEN' });
  await setRule(a.officeId, 'gmail.send', { mode: 'automatic' });
  await setRule(a.officeId, 'gmail.send_attachments', { mode: 'automatic' });
  const fake = installFakeGoogle();
  const received: string[] = [];
  fake.on('POST', /\/users\/me\/messages\/send$/, request => {
    received.push(Buffer.from((request.json() as { raw: string }).raw, 'base64url').toString());
    return respond(200, { id: 'sent', threadId: 'thread' });
  });
  let caught: unknown;
  try { await sendMail(a.context, { to: ['destino@example.test'], cc: [], bcc: [], subject: 'Encaminhamento', body: 'Segue o arquivo.', replyToMessageId: null, attachments: [{ kind: 'vault', documentId: document.id }], idempotencyKey: randomUUID() }); }
  catch (error) { caught = error; }
  const leaked = received.some(mime => mime.includes(Buffer.from(bytes).toString('base64')));
  console.log(JSON.stringify({ finding: 'B1/C1', providerCalls: received.length, leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.notEqual((caught as { code?: string } | undefined)?.code, 'APPROVAL_REQUIRED', 'The diagnostic must reach source-policy enforcement, not the unrelated configurable send confirmation.');
  assert.equal(leaked, false);
});

test('disabled settings text retains source revocation in subsequent private derivation', async () => {
  const f = await fixture();
  const source = (await createPage(f.context, { caseId: f.caseId, title: 'Fonte', content: 'PROTECTED_SETTINGS_DERIVATION' })).page;
  const policy = (await observePage(f.userId, source.id, f.caseId)).policy;
  await saveInstruction({ ...f.context, invocation: 'agent', contentSources: [policy] }, 'personal', {
    title: 'Instrução desativada', content: 'PROTECTED_SETTINGS_DERIVATION', appliesTo: 'all', enabled: false,
  });
  const { id: conversationId } = await createConversation(db, f.context);
  const contentSources: ContentPolicy[] = [];
  const context = { ...f.context, invocation: 'agent' as const, conversationId, contentSources };
  assert.match(JSON.stringify(await runCapability(context, 'k5_agent_settings_get', {})), /PROTECTED_SETTINGS_DERIVATION/);
  const artifact = await createPrivateDocument(context, { title: 'Resposta', content: 'PROTECTED_SETTINGS_DERIVATION' });
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.caseId);
  let read: unknown, caught: unknown;
  try { read = await runCapability(context, 'k5_artifacts_get', { artifactId: artifact.id }); }
  catch (error) { caught = error; }
  const leaked = JSON.stringify(read ?? null).includes('PROTECTED_SETTINGS_DERIVATION');
  console.log(JSON.stringify({ finding: 'B2', leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.equal(leaked, false);
});

test('Drive disclosure accepts the pinned own private original and withholds a different contributor original',async()=>{
  const a=await fixture();
  const fileId='round3-private-original';
  const fake=installFakeGoogle();
  fake.on('GET',new RegExp(`/drive/v3/files/${fileId}$`),()=>respond(200,{id:fileId,name:'Arquivo externo',mimeType:'text/plain',version:'1',capabilities:{canModifyContent:true,canDownload:true}}));
  const remote=(await registerFiles(a.context,{googleFileIds:[fileId]})).files[0];
  const upload=await createUploadRef(a.context,new File(['OWN_PRIVATE_EXACT_BYTES'],'original.txt',{type:'text/plain'}));
  const own=await createVaultDocument(a.context,upload,{scope:'case',caseId:a.caseId,policy:personPolicy('',''),independentUpload:true});
  fake.on('PATCH',new RegExp(`/upload/drive/v3/files/${fileId}$`),request=>{assert.equal(request.text(),'OWN_PRIVATE_EXACT_BYTES');return respond(200,{id:fileId,name:'Original',mimeType:'text/plain',version:'2',capabilities:{canModifyContent:true,canDownload:true}});});
  const input={fileId:remote.id,documentId:own.id,idempotencyKey:randomUUID()};
  await assert.rejects(uploadVersion(a.context,input),{code:'APPROVAL_REQUIRED'});
  const approval=await db.prepare("SELECT id FROM capability_approval WHERE user_id=? AND capability_name='k5_drive_upload_version' AND status='pending'").get<{id:string}>(a.userId);
  await approveProposal(a.context,approval!.id);
  assert.equal((await uploadVersion(a.context,{...input,approvalId:approval!.id})).operation.status,'succeeded');
  assert.equal(fake.count('PATCH',new RegExp(`/upload/drive/v3/files/${fileId}$`)),1);
  const b=await googleFixture();
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?),(?,?,?)').run(a.officeId,b.userId,a.userId,b.officeId,a.userId,b.userId);
  await db.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(a.officeId,a.caseId,b.userId,a.userId);
  const {folder}=await runCapability(b.context,'k5_vault_create_folder',{caseId:a.caseId,name:'Contribuição restrita',visibility:'restricted',memberIds:[a.userId]}) as {folder:{id:string}};
  const foreignUpload=await createUploadRef(b.context,new File(['FOREIGN_RESTRICTED_BYTES'],'outro.txt',{type:'text/plain'}));
  const {document}=await runCapability(b.context,'k5_vault_ingest_upload',{uploadRef:foreignUpload.id,scope:'case',caseId:a.caseId,folderId:folder.id}) as {document:{id:string}};
  await assert.rejects(uploadVersion(a.context,{fileId:remote.id,documentId:document.id,idempotencyKey:randomUUID()}),error=>!!error && (error as {code:string}).code!=='APPROVAL_REQUIRED');
  assert.equal(fake.count('PATCH',new RegExp(`/upload/drive/v3/files/${fileId}$`)),1);
});
