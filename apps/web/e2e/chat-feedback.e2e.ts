import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

for (const width of [1280, 390]) {
  test(`citações e duas aprovações independentes continuam visíveis depois de remontar o chat em ${width}px`, { session: 'admin' }, async ({ app, screen, browser }) => {
    await browser.setViewport({ width, height: 844 });
    const conversation = { id: 'chat-feedback-fixture', title: 'Teste de citações e autorizações', updatedAt: new Date().toISOString() };
    const approvals = ['confirm-fixture', 'cancel-fixture'].map(approvalId => ({ type: 'data-approval', id: approvalId,
      data: { approvalId, capability: 'k5_vault_delete_folder', summary: `Remover pasta ${approvalId}`, state: 'pending', result: '' } }));
    const messages = [{ id: 'answer-fixture', role: 'assistant', parts: [
      { type: 'text', text: 'Fundamento consultado. citeturn0search2 Outra referência. citeturn3view0' },
      { type: 'data-tool', data: { name: 'web_search', callId: 'search-1', summary: 'Pesquisou na web: primeiro resultado', state: 'completed' } },
      { type: 'data-tool', data: { name: 'web_search', callId: 'search-2', summary: 'Pesquisou na web: segundo resultado', state: 'completed' } },
      { type: 'data-web-sources', data: { sources: [{ id: 'turn0search2', url: 'https://example.test/fonte', title: 'Fonte oficial' }] } },
      ...approvals,
    ] }];
    let created = 0;
    await browser.route('**/api/conversations', route => {
      if (route.request.method !== 'POST') return route.continue();
      // A new id per request, as the server would: re-creating with the same id clears the
      // messages without reloading them, which a real new conversation never does.
      created++;
      return route.fulfill({ json: { conversation: { ...conversation, id: `chat-feedback-fixture-${created}` } } });
    });
    await browser.route(/\/api\/conversations\/chat-feedback-fixture-\d+$/, route => route.fulfill({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation, messages }) }));
    await browser.route(/\/api\/chat\/chat-feedback-fixture-\d+\/stream/, route => route.fulfill({ status: 204 }));
    const calls: string[] = [];
    let failOnce = true;
    await browser.route('**/api/chat/approvals/*-fixture', async route => {
      const id = new URL(route.request.url).pathname.split('/').at(-1);
      const { decision } = JSON.parse(route.request.postData ?? '{}') as { decision: string };
      if (decision === 'confirm' && failOnce) {
        failOnce = false;
        return route.fulfill({ status: 503, json: { error: 'Falha temporária de conexão.' } });
      }
      const part = approvals.find(part => part.id === id)!;
      calls.push(`${id}:${decision}`);
      part.data.state = decision === 'confirm' ? 'confirmed' : 'cancelled';
      part.data.result = decision === 'confirm' ? 'Pasta removida.' : 'Nada foi alterado.';
      return route.fulfill({ json: { state: part.data.state, result: part.data.result } });
    });
    const openChat = async () => {
      await app.open('/app/agents');
      // The button is server-rendered; a tap that lands before hydration does nothing, so tap again
      // until the app asks for the conversation (the mock always returns the same one).
      const before = created;
      await expect.poll(async () => {
        if (created === before) await screen.getByRole('button', 'Nova conversa', { visible: true }).tap();
        return created;
      }).toBeGreaterThan(before);
    };
    await openChat();
    const groups = screen.getByRole('group', 'Confirmação');
    await expect(groups).toHaveCount(2);
    await expect(screen.getByText('Pesquisou na web · 2 chamadas')).toBeVisible();
    expect(await browser.evaluate(() => {
      const activity=document.querySelector('[aria-label="Atividade do Lume"]');
      return !!activity && !!activity.parentElement?.textContent?.trim().startsWith('Pesquisou na web');
    })).toBe(true);
    await screen.getByText('Pesquisou na web · 2 chamadas').focus();
    await browser.keyboard.press('Enter');
    await expect(screen.getByText('Pesquisou na web: segundo resultado')).toBeVisible();
    await expect(screen.getByRole('link', 'Fonte 1')).toHaveAttribute('href', 'https://example.test/fonte');
    await expect(screen.getByText('(fonte não vinculada)', { exact: false })).toBeVisible();
    await expect(screen.getByText(/turn0search2|turn3view0/)).toHaveCount(0);
    // The first decision goes through the keyboard and survives a failed request.
    await groups.nth(0).getByRole('button', 'Confirmar').focus();
    await browser.keyboard.press('Enter');
    await expect(groups.nth(0).getByRole('alert')).toHaveText('Falha temporária de conexão.');
    await groups.nth(0).getByRole('button', 'Confirmar').tap();
    await expect(groups.nth(0)).toContainText('Confirmado');
    await expect(groups.nth(0).getByRole('button')).toHaveCount(0);
    await expect(groups.nth(1).getByRole('button', 'Cancelar')).toBeEnabled();
    await groups.nth(1).getByRole('button', 'Cancelar').tap();
    await expect(groups.nth(1)).toContainText('Cancelado');
    await expect(groups.nth(1).getByRole('button')).toHaveCount(0);
    expect(calls).toEqual(['confirm-fixture:confirm', 'cancel-fixture:cancel']);
    // Return through a newly mounted chat instead of relying on the cards' local state.
    await openChat();
    await expect(groups.nth(0)).toContainText('Confirmado');
    await expect(groups.nth(1)).toContainText('Cancelado');
    await expect(groups.getByRole('button')).toHaveCount(0);
  });
}
