import { updateArtifact } from './document-writes';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import { testDatabase as db } from './test-setup';
import { createConversation, ownedArtifact } from '../src/lib/ai-store';
import { createChatAttachment, claimChatAttachments, resolveChatAttachments } from '../src/lib/chat-attachments';
import { importChatAttachment, saveArtifactToVault } from '../src/lib/application/vault-service';
import { createArtifact } from '../src/lib/application/artifacts-service';
import { conversationArtifacts } from '../src/lib/conversation-artifacts';
import { readVaultDocumentFile } from '../src/lib/vault';

async function owner() {
  const officeId = randomUUID(), userId = randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Artefatos do Lume');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Teste');
  await db.prepare("INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)").run(randomUUID(),officeId,userId);
  return { officeId, userId };
}

test('a Lume document is saved to the Vault per version, format and destination without duplicates', async () => {
  const context = await owner();
  const conversation = await createConversation(db, context);
  const scoped = { ...context, conversationId: conversation.id, invocation: 'agent' as const };
  const created = await createArtifact(scoped, { title: 'Parecer: sócio/ingresso', content: '# Parecer\n\nCliente José, participação de 20%.' });
  const input = { artifactId: created.artifact.id, version: created.artifact.version, format: 'pdf' as const, scope: 'library' as const };

  const [first, second] = await Promise.all([saveArtifactToVault(scoped, input), saveArtifactToVault(scoped, input)]);
  assert.equal(first.document.id, second.document.id);
  assert.equal(first.document.name, 'Parecer_ sócio_ingresso.pdf');
  const pdf = await readVaultDocumentFile(context.officeId, first.document.id, context.userId);
  assert.match((await extractText(new Uint8Array(pdf.buffer), { mergePages: true })).text, /José/);
  assert.ok((await PDFDocument.load(pdf.buffer)).getPageCount() >= 1);

  const docx = await saveArtifactToVault(scoped, { ...input, format: 'docx' });
  assert.notEqual(docx.document.id, first.document.id);
  assert.equal((await readVaultDocumentFile(context.officeId, docx.document.id, context.userId)).buffer.subarray(0, 2).toString(), 'PK');

  const artifact = await ownedArtifact(db, context, created.artifact.id);
  assert.ok(artifact);
  const updated = await updateArtifact(db, context, artifact.id, artifact.title, '# Parecer\n\nTexto revisado.', artifact.version);
  assert.ok(updated);
  await assert.rejects(saveArtifactToVault(scoped, input), /documento mudou/);
  const next = await saveArtifactToVault(scoped, { ...input, version: updated.version });
  assert.notEqual(next.document.id, first.document.id);

  await assert.rejects(saveArtifactToVault({ ...scoped, userId: randomUUID() }, input), /não encontrado/);
  await assert.rejects(saveArtifactToVault(scoped, { ...input, version: updated.version, scope: 'case', caseId: randomUUID() }), /origem continua não verificável/);
  const origins = await db.prepare("SELECT source_kind AS kind, source_version AS version FROM vault_agent_origin WHERE source_id=? ORDER BY source_kind, source_version")
    .all<{ kind: string; version: number }>(created.artifact.id);
  assert.deepEqual(origins.map(row => `${row.kind}:${row.version}`), ['artifact_docx:1', 'artifact_pdf:1', 'artifact_pdf:2']);
});

test('the Artefatos list holds the conversation documents, sent files and their Vault copies, only for their owner', async () => {
  const context = await owner();
  const conversation = await createConversation(db, context);
  const other = await createConversation(db, context);
  const scoped = { ...context, conversationId: conversation.id, invocation: 'agent' as const };
  const created = await createArtifact(scoped, { title: 'Minuta', content: 'Texto da minuta.' });
  await createArtifact({ ...context, conversationId: other.id, invocation: 'agent' }, { title: 'Outra conversa', content: 'Texto.' });
  const file = await createChatAttachment(context, conversation.id, new File(['Contrato social em texto.'], 'contrato.txt', { type: 'text/plain' }));
  const pending = await createChatAttachment(context, conversation.id, new File(['Ainda não enviado.'], 'rascunho.txt', { type: 'text/plain' }));
  await claimChatAttachments(context, conversation.id, 'msg', await resolveChatAttachments(context, conversation.id, 'msg', [file.id]));
  await importChatAttachment(scoped, { attachmentId: file.id, scope: 'library' });
  await saveArtifactToVault(scoped, { artifactId: created.artifact.id, version: 1, format: 'docx', scope: 'library' });

  const listed = await conversationArtifacts(context, conversation.id);
  assert.ok(listed);
  assert.deepEqual(listed.documents.map(item => item.title), ['Minuta']);
  assert.deepEqual(listed.documents[0].copies.map(copy => [copy.format, copy.version, copy.href]), [['docx', 1, '/app/vault/library']]);
  assert.deepEqual(listed.attachments.map(item => item.name), ['contrato.txt']);
  assert.ok(!listed.attachments.some(item => item.id === pending.id));
  assert.equal(listed.attachments[0].copies[0].format, null);

  assert.equal(await conversationArtifacts({ ...context, userId: randomUUID() }, conversation.id), null);
  assert.equal(await conversationArtifacts({ ...context, officeId: randomUUID() }, conversation.id), null);
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id IN (SELECT document_id FROM vault_agent_origin WHERE source_id=?)').run(file.id);
  assert.deepEqual((await conversationArtifacts(context, conversation.id))?.attachments[0].copies, []);
});
