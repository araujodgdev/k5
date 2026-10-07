import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from './google-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { createConversation } from '../src/lib/ai-store';
import { createPage, proposePageWrite } from '../src/lib/case-pages/service';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { createChatAttachment, resolveChatAttachments, claimChatAttachments } from '../src/lib/chat-attachments';
import { objectStorage } from '../src/lib/storage';
import { generateStructured } from '../src/lib/ai-runtime';
import { contentAdmission } from '../src/lib/content-admission';
import { observePage } from '../src/lib/content-policy';
import { z } from 'zod';

test('real structured SDK transient retry retains original denial after first provider attempt',async t=>{
  const f=await googleFixture(),caseId=randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Retry protegido',f.userId);
  const page=(await createPage(f.context,{caseId,title:'Fonte',content:'PROTECTED_RETRY_BYTES'})).page;
  const source=await observePage(f.userId,page.id,caseId);
  await recordingWriter(t,f.userId,[]);
  let entries=0;
  t.mock.method(globalThis,'fetch',async (input:RequestInfo|URL)=>{
    assert.equal(String(input),'https://api.lume.software/v1/responses');entries++;
    await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
    return Response.json({error:{message:'Controlled transient failure',type:'server_error'}},{status:503});
  });
  await assert.rejects(generateStructured(f.officeId,f.userId,'drafting.section',source.content,z.object({ok:z.boolean()}),{
    admission:contentAdmission(f.context,source.content,[source.policy]),timeoutMs:10000,
  }),{code:'NOT_FOUND'});
  assert.equal(entries,1);
  const usage=await db.prepare('SELECT status,error_class FROM ai_usage WHERE user_id=? AND task=?').all(f.userId,'drafting.section');
  assert.deepEqual(usage,[{status:'failed',error_class:'denied'}]);
});

test('shared writer rechecks source access after image storage awaits and before provider dispatch', async t => {
  const f = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Geração compartilhada', f.userId);
  const { id: conversationId } = await createConversation(db, f.context);
  const source = (await createPage(f.context, { caseId, title: 'Fonte autorizada', content: 'REVOKED_DURING_IMAGE_PREPARATION' })).page;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF8cAAAAASUVORK5CYII=', 'base64');
  const attachment = await createChatAttachment(f.context, conversationId, new File([bytes], 'fonte.png', { type: 'image/png' }));
  const messageId = randomUUID();
  const rows = await resolveChatAttachments(f.context, conversationId, messageId, [attachment.id]);
  const scope = await authorizeMessageScope(f.context, { caseId, document: { kind: 'case-page', id: source.id, caseId }, documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.context, conversationId, messageId, 'Resuma a página usando a imagem.', scope, rows);
  await claimChatAttachments(f.context, conversationId, messageId, rows);
  const storage = await objectStorage();
  const get = storage.get.bind(storage);
  let revocationCompleted = false;
  t.mock.method(storage, 'get', async (...args: Parameters<typeof storage.get>) => {
    const result = await get(...args);
    await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
    revocationCompleted = true;
    return result;
  });
  const wire = await recordingWriter(t, f.userId, [{ title: 'Resultado', content: 'Resposta independente.' }]);
  let caught: unknown;
  try {
    await proposePageWrite({ ...f.context, invocation: 'agent', conversationId, submissionId, generationId: randomUUID() },
      'k5_case_pages_create', { caseId, folderId: null });
  } catch (error) { caught = error; }
  const leaked = wire.some(request => JSON.stringify(request.body).includes('REVOKED_DURING_IMAGE_PREPARATION'));
  console.log(JSON.stringify({ finding: 'A4', revocationCompleted, providerCalls: wire.length, leaked, error: caught instanceof Error ? { code: (caught as { code?: string }).code, message: caught.message } : caught }));
  assert.equal(revocationCompleted, true);
  assert.equal(leaked, false);
});
