import { expect } from 'e2e';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, uniqueAccount } from './support/accounts';
import { setConversationMessages } from './support/seed';
import { signInWithSession } from './support/sign-in';

test('revisão no chat: carregamento, erro, nova tentativa e confirmação exata pelo teclado', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Revisão de fontes');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Caso da revisão exata' } });
  const { artifact } = await api.json<{ artifact: { id: string; version: number } }>('/api/artifacts', { json: { title: 'Proposta conferida', content: 'Texto exato retornado pelo endpoint autorizado.' } });
  const proposal = await api.json<{ approvalId: string }>(`/api/cases/${record.id}/pages/publication`, { json: { artifactId: artifact.id, artifactVersion: artifact.version, folderId: null } });
  const { conversation } = await api.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  await setConversationMessages(account.email, conversation.id, [{ id: 'review-card', role: 'assistant', parts: [{ type: 'data-approval', data: { approvalId: proposal.approvalId, capability: 'k5_case_pages_publish', summary: 'UNTRACKED_PREVIEW_MUST_NOT_RENDER', state: 'pending' } }] }]);
  const release = Promise.withResolvers<void>();
  let unavailable = true;
  await browser.route(`**/api/approvals/${proposal.approvalId}/page`, async route => {
    if (!unavailable) return route.continue();
    await release.promise;
    return route.fulfill({ status: 503, json: { error: 'Revisão temporariamente indisponível.' } });
  });
  await signInWithSession({ app, screen, browser }, api);
  await app.open('/app/command-center?lume=1');
  const confirm = screen.getByRole('button', 'Confirmar', { exact: true });
  try {
    await expect(screen.getByText('Carregando proposta…')).toBeVisible();
    await expect(confirm).toBeDisabled();
    await app.screenshot('revisao-carregando');
  } finally { release.resolve(); }
  await expect(screen.getByRole('group', 'Confirmação').getByRole('alert')).toContainText('Revisão temporariamente indisponível.');
  await expect(confirm).toBeDisabled();
  unavailable = false;
  await screen.getByRole('button', 'Tentar novamente').tap();
  await expect(screen.getByText('Texto exato retornado pelo endpoint autorizado.')).toBeVisible();
  await expect(screen.getByText('UNTRACKED_PREVIEW_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  await app.screenshot('revisao-autorizada-desktop');
  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await app.screenshot('revisao-autorizada-mobile');
  await browser.keyboard.press('Enter');
  await expect(screen.getByText('Confirmado', { exact: false })).toBeVisible({ timeout: 60_000 });
  expect(await sql('SELECT content,version FROM case_page WHERE case_id=$1', [record.id])).toMatchObject([{ content: 'Texto exato retornado pelo endpoint autorizado.', version: 1 }]);
  expect(await sql('SELECT status FROM capability_approval WHERE id=$1', [proposal.approvalId])).toMatchObject([{ status: 'consumed' }]);
});

test('seleção explícita de proposta e novo pedido independente pelo teclado, desktop e mobile', async ({ app, screen, browser }) => {
  const account = uniqueAccount('Continuação explícita');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Continuação' } });
  const { artifact } = await api.json<{ artifact: { id: string; version: number } }>('/api/artifacts', { json: { title: 'Proposta selecionável', content: 'Texto conferido.' } });
  const proposal = await api.json<{ approvalId: string }>(`/api/cases/${record.id}/pages/publication`, { json: { artifactId: artifact.id, artifactVersion: artifact.version, folderId: null } });
  const { conversation } = await api.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  await setConversationMessages(account.email, conversation.id, [{ id: 'continuation-card', role: 'assistant', parts: [{ type: 'data-approval', data: {
    approvalId: proposal.approvalId, capability: 'k5_case_pages_create', summary: 'Proposta', state: 'pending',
  } }] }]);
  await signInWithSession({ app, screen, browser }, api);
  await app.open('/app/command-center?lume=1');
  await expect(screen.getByText('Texto conferido.')).toBeVisible();
  const select = screen.getByRole('button', 'Continuar esta proposta', { exact: true });
  await select.focus(); await browser.keyboard.press('Enter');
  await expect(screen.getByText('Continuando a proposta selecionada')).toBeVisible();
  await app.screenshot('continuacao-desktop');
  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('continuacao-mobile');
  const clear = screen.getByRole('button', 'Novo pedido independente', { exact: true });
  await clear.focus(); await browser.keyboard.press('Enter');
  await expect(screen.getByText('Continuando a proposta selecionada')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Continuar esta proposta', { exact: true })).toBeVisible();
});
