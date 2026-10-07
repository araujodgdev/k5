import { test } from './support/fixtures';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { claimChatAttachment, seedConversationDocument } from './support/seed';
import { signInWithSession } from './support/sign-in';
import { overflowsHorizontally } from './support/fixtures';

test('Artefatos lista o que a conversa criou e recebeu e salva no Cofre pela interface', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Artefatos');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const { conversation } = await api.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  await seedConversationDocument(account.email, conversation.id, 'Parecer societário', '# Parecer\n\nCliente José, participação de 20%.');
  const form = new FormData();
  form.set('conversationId', conversation.id);
  form.set('file', new File(['Contrato social em texto simples.'], 'contrato-social.txt', { type: 'text/plain' }));
  const upload = await api.request('/api/chat/attachments', { form });
  expect(upload.status).toBe(201);
  const { attachment } = await upload.json() as { attachment: { id: string } };
  await claimChatAttachment(account.email, attachment.id);

  await signInWithSession({ app, screen, browser }, api);
  // The conversation opens in the Lume's panel; its artifacts are under the previous conversations.
  await app.open(`/app/command-center?conversationId=${conversation.id}`);
  await screen.getByRole('button', 'Conversas anteriores').tap();
  await screen.getByRole('button', /^Artefatos desta conversa/).tap();
  await expect(screen.getByRole('dialog', 'Artefatos desta conversa')).toBeVisible();
  await expect(screen.getByRole('button', 'Parecer societário')).toBeVisible();
  await expect(screen.getByText('contrato-social.txt')).toBeVisible();

  // A failed save keeps the form open and offers to try again.
  let failures = 1;
  await browser.route(`**/api/conversations/${conversation.id}/artifacts`, route => {
    if (route.request.method === 'POST' && failures-- > 0) return route.fulfill({ status: 503, json: { error: 'Cofre indisponível no momento.' } });
    return route.continue();
  });
  const documentRow = screen.getByRole('listitem').filter({ hasText: 'Parecer societário' });
  await documentRow.getByRole('button', 'Salvar no Cofre').tap();
  await documentRow.getByRole('radio', 'DOCX').tap();
  await documentRow.getByRole('button', 'Salvar').tap();
  await expect(documentRow.getByRole('alert')).toHaveText('Cofre indisponível no momento.');
  await documentRow.getByRole('button', 'Tentar de novo').tap();
  await expect(screen.getByText('Parecer societário.docx foi salvo em Biblioteca.', { exact: false })).toBeVisible();
  await expect(documentRow.getByText('No Cofre (DOCX, versão 1):', { exact: false })).toBeVisible();

  // The attachment goes through the keyboard, on a phone.
  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  const attachmentRow = screen.getByRole('listitem').filter({ hasText: 'contrato-social.txt' });
  await attachmentRow.getByRole('button', 'Salvar no Cofre').focus();
  await browser.keyboard.press('Enter');
  // Salvar waits for the person's cases, which fill the destination list.
  await expect(attachmentRow.getByRole('button', 'Salvar')).toBeEnabled();
  await attachmentRow.getByRole('button', 'Salvar').focus();
  await browser.keyboard.press('Enter');
  await expect(screen.getByText('contrato-social.txt foi salvo em Biblioteca.', { exact: false })).toBeVisible();
  await expect(attachmentRow.getByRole('link', 'Biblioteca')).toHaveAttribute('href', '/app/vault/library');

  const copies = await sql<{ kind: string }>(`SELECT o.source_kind AS kind FROM vault_agent_origin o JOIN "user" u ON u.id=o.user_id
    WHERE lower(u.email)=lower($1) ORDER BY o.source_kind`, [account.email]);
  expect(copies.map(row => row.kind)).toEqual(['artifact_docx', 'chat_attachment']);
  const denied = await new ApiSession(app.baseUrl!).request(`/api/conversations/${conversation.id}/artifacts`);
  expect(denied.status).toBe(401);
});
