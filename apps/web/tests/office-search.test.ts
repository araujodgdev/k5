import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ensureOfficeForUser } from '../src/lib/offices';
import { fixtureSession } from './session-fixture';
import { invite, respond, changeAccess } from '../src/lib/collaboration/service';
import { runCapability } from '../src/lib/agent-tools';
import { createPage } from '../src/lib/case-pages/service';
import { observePage } from '../src/lib/content-policy';
import { createPrivateDocument } from '../src/lib/documents/service';
import { searchOffice } from '../src/lib/office-search';

test('search returns five meaningful kinds and all document stores without granting access through association', async () => {
  const prefix = 'Search'+randomUUID().slice(0,8);
  async function person(name:string) {
    const userId = randomUUID(), email = `${userId}@search.test`;
    await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(userId,name,email);
    const office = await ensureOfficeForUser(db,{id:userId,officeName:name});
    return {email,context:{officeId:office.officeId,userId,sessionId:await fixtureSession(userId)}};
  }
  const owner = await person(prefix+' owner'), guest = await person(prefix+' associate'), outsider = await person('Outsider');
  await respond(guest.context,(await invite(owner.context,{email:guest.email})).id,true);
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,owner.context.officeId,prefix+' case',owner.context.userId);
  await runCapability(owner.context,'k5_crm_create_client',{name:prefix+' client'});
  await runCapability(owner.context,'k5_agenda_create_activity',{kind:'task',title:prefix+' task'});
  const page = (await createPage(owner.context,{caseId,folderId:null,title:prefix+' page',content:'Independent text'})).page;
  const draft = await createPrivateDocument(owner.context,{title:prefix+' draft',content:'Independent private text'});
  const fileId = randomUUID();
  await db.prepare(`INSERT INTO vault_document(id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,?,'case',?,?,'text/plain',12,?,'ready',?)`).run(fileId,owner.context.officeId,caseId,prefix+' file',`${fileId}.txt`,'a'.repeat(64),owner.context.userId);
  await db.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active)
    SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?`).run(randomUUID(),fileId);
  await db.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(fileId);
  const hits = (await searchOffice(owner.context,prefix)).hits;
  assert.deepEqual([...new Set(hits.map(hit=>hit.kind))].sort(),['associate','case','client','document','task']);
  assert.deepEqual(hits.filter(hit=>hit.kind==='document').map(hit=>hit.documentKind).sort(),['draft','file','page']);
  assert.ok(hits.some(hit=>hit.href===`/app/vault/cases/${caseId}/pages/${page.id}`));
  assert.ok(hits.some(hit=>hit.href===`/app/documents/${draft.id}`));
  const associated = (await searchOffice(guest.context,prefix)).hits;
  assert.deepEqual(associated.map(hit=>hit.kind),['associate']);
  assert.deepEqual((await searchOffice(outsider.context,prefix)).hits,[]);
  await changeAccess(owner.context,{action:'participant',caseId,userId:guest.context.userId,add:true});
  const shared = (await searchOffice(guest.context,prefix)).hits;
  assert.ok(shared.some(hit=>hit.id===page.id));
  assert.ok(shared.some(hit=>hit.id===fileId));
  assert.equal(shared.some(hit=>hit.id===draft.id),false);
  const policy = (await observePage(guest.context.userId,page.id,caseId)).policy;
  const derived = await createPrivateDocument(guest.context,{title:prefix+' derived',content:'Derived text',sources:[policy]});
  assert.ok((await searchOffice(guest.context,prefix)).hits.some(hit=>hit.id===derived.id));
  await changeAccess(owner.context,{action:'participant',caseId,userId:guest.context.userId,add:false});
  const revoked = (await searchOffice(guest.context,prefix)).hits;
  assert.equal(revoked.some(hit=>[page.id,fileId,caseId,derived.id].includes(hit.id)),false);
});
