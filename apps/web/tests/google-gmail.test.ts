import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { setGoogleTransport } from '../src/lib/google/transport';
import { createMailUpload, deleteDraft, getThread, importAttachment, listThreads, saveDraft, sendMail } from '../src/lib/google/gmail/service';
import { decodeHeaderWords, gmailHeader, htmlAsText, mimeMessage } from '../src/lib/google/gmail/mime';

afterEach(() => setGoogleTransport(undefined));
const empty = { to: [], cc: [], bcc: [], subject: '', body: '', replyToMessageId: null, attachments: [] };
const encoded = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const headers = (...rows: [string, string][]) => rows.map(([name, value]) => ({ name, value }));

test('HTML de terceiros vira texto inerte; identidade e cabeçalhos são protegidos', () => {
  assert.equal(htmlAsText('<script>roube()</script><p>Olá &amp; bem-vindo</p><img src="https://evil.test/pixel">'), 'Olá & bem-vindo');
  assert.throws(() => mimeMessage({ from: 'a@example.com\r\nBcc: evil@example.com', to: ['b@example.com'], cc: [], bcc: [],
    subject: 'Assunto', body: '', messageId: '<safe@example.com>', files: [] }), /cabeçalho/);
  const mime = mimeMessage({ from: 'a@example.com', to: ['b@example.com'], cc: [], bcc: [],
    subject: 'Olá', body: 'Texto', messageId: '<stable@example.com>', files: [] });
  const raw = Buffer.from(mime.raw, 'base64url').toString();
  assert.match(raw, /Message-ID: <stable@example.com>/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
});

test('assuntos MIME codificados em UTF-8 e ISO-8859-1 são exibidos em texto legível', () => {
  assert.equal(decodeHeaderWords('=?UTF-8?B?VmVyaWZpY2HDp8OjbyA=?= \r\n =?ISO-8859-1?Q?local_=E7?='),
    'Verificação local ç');
  assert.equal(gmailHeader({ headers: headers(['Subject', '=?UTF-8?Q?Ol=C3=A1_mundo?=']) }, 'Subject'), 'Olá mundo');
  assert.equal(decodeHeaderWords('=?UTF-8?Q?texto_=ZZ?='), '=?UTF-8?Q?texto_=ZZ?=');
  assert.equal(decodeHeaderWords('=?unknown?B?dGV4dG8=?='), '=?unknown?B?dGV4dG8=?=');
});

test('lista paginada e leitura pessoal sem HTML remoto', async () => {
  const owner = await googleFixture();
  const other = await googleFixture({ officeId: owner.officeId });
  const fake = installFakeGoogle();
  const message = { id: 'msg1', threadId: 'thread1', internalDate: '1700000000000', labelIds: ['UNREAD'],
    payload: { headers: headers(['From', 'Pessoa <pessoa@example.com>'], ['Subject', 'Tema']),
      parts: [{ partId: '0', mimeType: 'text/html', body: { data: encoded('<img src="https://evil.test/pixel"><p>Mensagem</p>') } }] } };
  fake.on('GET', /\/users\/me\/threads$/, () => respond(200, { threads: [{ id: 'thread1' }], nextPageToken: 'next' }));
  fake.on('GET', /\/users\/me\/threads\/thread1$/, () => respond(200, { id: 'thread1', messages: [message] }));
  const list = await listThreads(owner.context, { label: 'INBOX', limit: 10 });
  assert.equal(list.nextPageToken, 'next');
  assert.equal(list.threads[0].unread, true);
  const read = await getThread(owner.context, { threadId: 'thread1' });
  assert.equal(read.thread.messages[0].html, null);
  assert.equal(read.thread.messages[0].text, 'Mensagem');
  assert.equal(read.thread.messages[0].remoteContentBlocked, true);
  await getThread(other.context, { threadId: 'thread1' });
  assert.equal(fake.calls.filter(c => c.path.endsWith('/threads/thread1')).length, 3);
  const admin = await googleFixture({ officeId: owner.officeId, role: 'administrator' });
  await assert.rejects(() => getThread({ ...admin.context, userId: 'missing' }, { threadId: 'thread1' }), /acesso/);
});

test('envio tem Message-ID durável; resposta perdida mantém unknown e nova chave não reenvia', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  fake.on('GET', /\/users\/me\/messages$/, () => respond(200, { messages: [] }));
  fake.failNetwork('POST', /\/users\/me\/messages\/send$/, request => {
    const raw = Buffer.from((request.json() as { raw: string }).raw, 'base64url').toString();
    assert.match(raw, new RegExp(`From: ${owner.email}`));
    assert.match(raw, /Message-ID: <lume-/);
    return respond(200, { id: 'sent1', threadId: 'thread1' });
  });
  const input = { ...empty, to: ['destino@example.com'], subject: 'Assunto', body: 'Conteúdo',
    idempotencyKey: randomUUID() };
  const first = await sendMail(owner.context, input);
  assert.equal(first.operation.status, 'unknown');
  assert.equal(first.messageId, null);
  await assert.rejects(() => sendMail(owner.context, { ...input, idempotencyKey: randomUUID() }), /operação equivalente/);
  assert.equal(fake.count('POST', /\/messages\/send$/), 1);
  const row = await testDb.prepare('SELECT reconcile_key, status FROM google_operation WHERE id=?').get<{
    reconcile_key: string; status: string }>(first.operation.id);
  assert.match(row!.reconcile_key, /^lume-/);
});

test('resposta perdida é reconciliada por prova positiva e não duplica o mesmo envio', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  let sentId = '';
  fake.failNetwork('POST', /\/users\/me\/messages\/send$/, request => {
    const raw = Buffer.from((request.json() as { raw: string }).raw, 'base64url').toString();
    sentId = raw.match(/Message-ID: (<[^>]+>)/)![1];
    return respond(200, { id: 'sent1', threadId: 'thread1' });
  });
  fake.on('GET', /\/users\/me\/messages$/, () => respond(200, sentId ? { messages: [{ id: 'sent1' }] } : { messages: [] }));
  fake.on('GET', /\/users\/me\/messages\/sent1$/, () => respond(200, {
    id: 'sent1', threadId: 'thread1', labelIds: ['SENT'], payload: { headers: headers(['Message-ID', sentId]) } }));
  const input = { ...empty, to: ['destino@example.com'], subject: 'Assunto', body: 'Conteúdo',
    idempotencyKey: randomUUID() };
  const first = await sendMail(owner.context, input);
  assert.equal(first.operation.status, 'succeeded');
  const repeated = await sendMail(owner.context, input);
  assert.equal(repeated.messageId, 'sent1');
  assert.equal(fake.count('POST', /\/messages\/send$/), 1);
});

test('resposta mantém threadId e cabeçalhos de encadeamento', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  fake.on('GET', /\/users\/me\/messages\/original$/, () => respond(200, {
    id: 'original', threadId: 'thread1', payload: { headers: headers(
      ['Message-ID', '<original@example.com>'], ['References', '<older@example.com>'], ['Subject', 'Tema']) } }));
  fake.on('POST', /\/users\/me\/messages\/send$/, request => {
    const body = request.json() as { raw: string; threadId: string };
    const raw = Buffer.from(body.raw, 'base64url').toString();
    assert.equal(body.threadId, 'thread1');
    assert.match(raw, /In-Reply-To: <original@example.com>/);
    assert.match(raw, /References: <older@example.com> <original@example.com>/);
    return respond(200, { id: 'reply1', threadId: 'thread1' });
  });
  const result = await sendMail(owner.context, { ...empty, to: ['destino@example.com'], subject: 'Re: Tema',
    body: 'Resposta', replyToMessageId: 'original', idempotencyKey: randomUUID() });
  assert.equal(result.threadId, 'thread1');
});

test('confirmação de envio inclui corpo e anexos exatos; rascunho é persistido no Gmail', async () => {
  const owner = await googleFixture();
  const fake = installFakeGoogle();
  const input = { ...empty, to: ['destino@example.com'], subject: 'Contrato', body: 'Texto integral',
    idempotencyKey: randomUUID() };
  await assert.rejects(() => sendMail(owner.context, input), /confirmação|aprovação/i);
  assert.equal(fake.count('POST', /\/messages\/send$/), 0);
  const proposal = await testDb.prepare(`SELECT normalized_input FROM capability_approval WHERE office_id=? AND user_id=?
    ORDER BY created_at DESC LIMIT 1`).get<{ normalized_input: string }>(owner.officeId, owner.userId);
  assert.match(proposal?.normalized_input ?? '', /Texto integral/);
  await setRule(owner.officeId, 'gmail.draft', { mode: 'automatic' });
  fake.on('POST', /\/users\/me\/drafts$/, () => respond(200, { id: 'draft1', message: { id: 'msgdraft' } }));
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => respond(200, { id: 'draft1', message: {
    id: 'msgdraft', payload: { headers: headers(['To', 'destino@example.com'], ['Subject', 'Contrato']),
      parts: [{ mimeType: 'text/plain', body: { data: encoded('Texto integral') } }] } } }));
  const saved = await saveDraft(owner.context, input);
  assert.equal(saved.draft?.id, 'draft1');
  assert.equal(saved.operation.status, 'succeeded');
});

test('anexo importado exige parte existente na mensagem e caso explícito', async () => {
  const owner = await googleFixture();
  const fake = installFakeGoogle();
  fake.on('GET', /\/users\/me\/messages\/msg1$/, () => respond(200, { id: 'msg1', payload: {
    parts: [{ partId: '1', filename: 'contrato.pdf', mimeType: 'application/pdf', body: { size: 100, attachmentId: 'a1' } }] } }));
  await assert.rejects(() => importAttachment(owner.context, { messageId: 'msg1', partId: 'fake',
    caseId: randomUUID(), idempotencyKey: randomUUID() }), /Anexo não encontrado/);
});

test('upload de e-mail pertence apenas ao titular, inclusive dentro do mesmo escritório', async () => {
  const owner = await googleFixture();
  const other = await googleFixture({ officeId: owner.officeId });
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  await setRule(owner.officeId, 'gmail.send_attachments', { mode: 'automatic' });
  const upload = await createMailUpload(owner.context, new File([new Uint8Array([1, 2, 3])], 'documento.pdf',
    { type: 'application/pdf' }));
  const fake = installFakeGoogle();
  await assert.rejects(() => sendMail(other.context, { ...empty, to: ['destino@example.com'], subject: 'Tema',
    body: 'Texto', attachments: [{ kind: 'upload', uploadId: upload.id }], idempotencyKey: randomUUID() }), /não encontrado|expirado/);
  assert.equal(fake.count('POST', /\/messages\/send$/), 0);
});

test('editar rascunho permite remover todos os anexos e preserva resposta encadeada', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.draft', { mode: 'automatic' });
  const fake = installFakeGoogle();
  const draft = { id: 'draft1', message: { id: 'draftMessage1', threadId: 'thread1', internalDate: '1700000000000',
    payload: { headers: headers(['To', 'destino@example.com'], ['Subject', 'Re: Tema'],
      ['In-Reply-To', '<original@example.com>'], ['References', '<older@example.com> <original@example.com>']),
      parts: [{ mimeType: 'text/plain', body: { data: encoded('Texto') } },
        { partId: '2', filename: 'velho.pdf', mimeType: 'application/pdf', body: { data: encoded('anexo'), size: 5 } }] } } };
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => respond(200, draft));
  fake.on('PUT', /\/users\/me\/drafts\/draft1$/, request => {
    const body = request.json() as { message: { raw: string; threadId: string } };
    const raw = Buffer.from(body.message.raw, 'base64url').toString();
    assert.equal(body.message.threadId, 'thread1');
    assert.match(raw, /In-Reply-To: <original@example.com>/);
    assert.match(raw, /References: <older@example.com> <original@example.com>/);
    assert.doesNotMatch(raw, /velho\.pdf|multipart\/mixed/);
    return respond(200, draft);
  });
  const result = await saveDraft(owner.context, { ...empty, draftId: 'draft1', to: ['destino@example.com'],
    subject: 'Re: Tema', body: 'Texto editado', attachments: [], idempotencyKey: randomUUID() });
  assert.equal(result.operation.status, 'succeeded');
  assert.equal(fake.count('PUT', /\/drafts\/draft1$/), 1);
});

test('rascunho alterado remotamente após preparação não é sobrescrito', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.draft', { mode: 'automatic' });
  const fake = installFakeGoogle();
  let reads = 0;
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => {
    reads++;
    return respond(200, { id: 'draft1', message: { id: reads === 1 ? 'original' : 'novo', threadId: 'thread1',
      payload: { headers: headers(['To', 'destino@example.com'], ['Subject', 'Tema']),
        parts: [{ mimeType: 'text/plain', body: { data: encoded(reads === 1 ? 'Original' : 'Outro texto') } }] } } });
  });
  await assert.rejects(() => saveDraft(owner.context, { ...empty, draftId: 'draft1', to: ['destino@example.com'],
    subject: 'Tema', body: 'Minha edição', idempotencyKey: randomUUID() }), /rascunho mudou/);
  assert.equal(fake.count('PUT', /\/drafts\/draft1$/), 0);
});

test('mesmo rascunho com nova chave não é enviado duas vezes enquanto o resultado é desconhecido', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => respond(200, { id: 'draft1', message: {
    id: 'draftMessage1', threadId: 'thread1', payload: { headers: headers(['To', 'destino@example.com'], ['Subject', 'Tema']),
      parts: [{ mimeType: 'text/plain', body: { data: encoded('Texto') } }] } } }));
  fake.on('GET', /\/users\/me\/messages$/, () => respond(200, { messages: [] }));
  fake.failNetwork('POST', /\/users\/me\/drafts\/send$/, () => respond(200, { id: 'sent1', threadId: 'thread1' }));
  const first = await sendMail(owner.context, { ...empty, draftId: 'draft1', idempotencyKey: randomUUID() });
  assert.equal(first.operation.status, 'unknown');
  await assert.rejects(() => sendMail(owner.context, { ...empty, draftId: 'draft1', idempotencyKey: randomUUID() }),
    /operação equivalente/);
  assert.equal(fake.count('POST', /\/drafts\/send$/), 1);
});

test('exclusão de rascunho passa pelo executor e retorna sucesso real', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.draft', { mode: 'automatic' });
  const fake = installFakeGoogle();
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => respond(200, { id: 'draft1', message: {
    id: 'draftMessage1', payload: { headers: headers(['Subject', 'Tema']) } } }));
  fake.on('DELETE', /\/users\/me\/drafts\/draft1$/, () => respond(204));
  const input = { draftId: 'draft1', idempotencyKey: randomUUID() };
  const result = await deleteDraft(owner.context, input);
  assert.deepEqual(result, { success: true });
  assert.equal(fake.count('DELETE', /\/drafts\/draft1$/), 1);
  assert.deepEqual(await deleteDraft(owner.context, input), { success: true });
  assert.equal(fake.count('DELETE', /\/drafts\/draft1$/), 1);
});

test('envio concluído de rascunho repete resultado pela chave sem tentar buscar rascunho removido', async () => {
  const owner = await googleFixture();
  await setRule(owner.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  let draftReads = 0;
  fake.on('GET', /\/users\/me\/drafts\/draft1$/, () => {
    draftReads++;
    if (draftReads > 2) return respond(404, { error: { message: 'gone' } });
    return respond(200, { id: 'draft1', message: { id: 'draftMessage1', threadId: 'thread1',
      payload: { headers: headers(['To', 'destino@example.com'], ['Subject', 'Tema']),
        parts: [{ mimeType: 'text/plain', body: { data: encoded('Texto') } }] } } });
  });
  fake.on('POST', /\/users\/me\/drafts\/send$/, () => respond(200, { id: 'sent1', threadId: 'thread1' }));
  const input = { ...empty, draftId: 'draft1', idempotencyKey: randomUUID() };
  const first = await sendMail(owner.context, input);
  assert.equal(first.messageId, 'sent1');
  const replay = await sendMail(owner.context, input);
  assert.equal(replay.messageId, 'sent1');
  assert.equal(fake.count('POST', /\/drafts\/send$/), 1);
  assert.equal(draftReads, 2);
});
