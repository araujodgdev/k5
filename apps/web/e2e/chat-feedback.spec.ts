import { test, expect } from '@playwright/test';

test('citation links and two independent approval decisions remain visible after remount', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
  await page.goto('/app/agents');
  const dismiss = page.getByRole('button', { name: 'Agora não', exact: true });
  if (await dismiss.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) await dismiss.click();
  const conversation = { id: 'chat-feedback-fixture', title: 'Teste de citações e autorizações', updatedAt: new Date().toISOString() };
  const approvals = ['confirm-fixture', 'cancel-fixture'].map(approvalId => ({ type: 'data-approval', id: approvalId,
    data: { approvalId, capability: 'k5_vault_delete_folder', summary: `Remover pasta ${approvalId}`, state: 'pending', result: '' } }));
  const messages = [{ id: 'answer-fixture', role: 'assistant', parts: [
    { type: 'text', text: 'Fundamento consultado. \uE200cite\uE202turn0search2\uE201 Outra referência. \uE200cite\uE202turn3view0\uE201' },
    { type: 'data-web-sources', data: { sources: [{ id: 'turn0search2', url: 'https://example.test/fonte', title: 'Fonte oficial' }] } },
    ...approvals,
  ] }];
  await page.route('**/api/conversations', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { conversation } }) : route.continue());
  await page.route('**/api/conversations/chat-feedback-fixture', route => route.fulfill({ json: { conversation, messages } }));
  await page.route('**/api/chat/chat-feedback-fixture/stream*', route => route.fulfill({ status: 204 }));
  const calls: string[] = [];
  let failOnce = true;
  await page.route('**/api/chat/approvals/*-fixture', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const decision = route.request().postDataJSON().decision;
    if (decision === 'confirm' && failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, json: { error: 'Falha temporária de conexão.' } });
      return;
    }
    const part = approvals.find(part => part.id === id)!;
    calls.push(`${id}:${decision}`);
    part.data.state = decision === 'confirm' ? 'confirmed' : 'cancelled';
    part.data.result = decision === 'confirm' ? 'Pasta removida.' : 'Nada foi alterado.';
    await route.fulfill({ json: { state: part.data.state, result: part.data.result } });
  });
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  const groups = page.getByRole('group', { name: 'Confirmação', exact: true });
  await expect(groups).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Fonte 1', exact: true })).toHaveAttribute('href', 'https://example.test/fonte');
  await expect(page.getByText('(fonte não vinculada)', { exact: false })).toBeVisible();
  await expect(page.getByText(/turn0search2|turn3view0/)).toHaveCount(0);
  await groups.nth(0).getByRole('button', { name: 'Confirmar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(groups.nth(0).getByRole('alert')).toHaveText('Falha temporária de conexão.');
  await groups.nth(0).getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(groups.nth(0)).toContainText('Confirmado');
  await expect(groups.nth(0).getByRole('button')).toHaveCount(0);
  await expect(groups.nth(1).getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  await groups.nth(1).getByRole('button', { name: 'Cancelar' }).click();
  await expect(groups.nth(1)).toContainText('Cancelado');
  await expect(groups.nth(1).getByRole('button')).toHaveCount(0);
  expect(calls).toEqual(['confirm-fixture:confirm', 'cancel-fixture:cancel']);
  // Return through a new mounted chat instead of relying on the cards' local state.
  await page.goto('/app/agents');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await expect(groups.nth(0)).toContainText('Confirmado');
  await expect(groups.nth(1)).toContainText('Cancelado');
  await expect(groups.getByRole('button')).toHaveCount(0);
});
