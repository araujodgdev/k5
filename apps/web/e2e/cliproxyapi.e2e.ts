import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect } from 'e2e';
import { describe } from '@e2e-dev/web';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';
import type { AssignmentOverview } from '../src/lib/ai-assignments-core';
import { preserveModelAssignment } from './support/seed';

async function administrator(baseUrl: string) {
  const account = uniqueAccount('Proxy admin');
  const api = await new ApiSession(baseUrl).signIn(account);
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/platform-admin.ts', 'grant', '--email', account.email], { windowsHide: true });
  return api;
}

describe('seleção do CLIProxyAPI', { serial: true }, () => {
for (const width of [1280, 390]) {
  test(`administra CLIProxyAPI e escolhe uma tarefa pelo teclado em ${width}px`, async ({ app, browser, screen, sql }) => {
    const api = await administrator(app.baseUrl!);
    const before = await api.json<AssignmentOverview>('/api/platform/ai/assignments');
    const restoreAssignment = await preserveModelAssignment('group', 'summary');
    const name = `Proxy de teste ${width} ${Date.now()}`;
    let connectionId: string | undefined;
    await browser.setViewport({ width, height: 844 });
    await signInWithSession({ app, browser, screen }, api);
    try {
      await app.open('/app/admin/ai');
      await screen.getByRole('button', 'Nova conexão').tap();
      const creation = browser.locator('form').filter({ has: screen.getByRole('heading', 'Nova conexão') });
      await creation.getByLabel('Nome').fill(name);
      await creation.getByRole('combobox', 'Provider').focus();
      await browser.keyboard.press('Enter');
      await screen.getByRole('option', 'CLIProxyAPI (Lume)').tap();
      await expect(screen.getByText('O CLIProxyAPI responde pelo endereço fixo do Lume', { exact: false }).first()).toBeVisible();
      await creation.getByLabel('Chave da API').fill('synthetic-e2e-key-not-a-credential');
      await screen.getByRole('button', 'Criar conexão').tap();
      await expect(screen.getByRole('heading', name)).toBeVisible();
      const overview = await api.json<AssignmentOverview>('/api/platform/ai/assignments');
      connectionId = overview.connections.find(connection => connection.name === name)!.id;
      expect(overview.groups.find(group => group.key === 'agent')!.plan).toEqual(before.groups.find(group => group.key === 'agent')!.plan);
      const group = screen.getByRole('article').filter({ has: screen.getByRole('heading', 'Resumo e texto curto') });
      await group.getByRole('button', 'Editar').first().tap();
      await group.getByRole('combobox', 'Modelo').tap();
      await screen.getByRole('option', 'Escolher conexão e modelo').tap();
      await group.getByRole('combobox', 'Conexão').tap();
      await screen.getByRole('option', name).tap();
      await group.getByRole('combobox', 'Escolher da lista').tap();
      await screen.getByRole('option', 'gpt-6-luna').tap();
      await group.getByRole('button', 'Salvar').focus();
      await browser.keyboard.press('Enter');
      await expect(group.getByRole('button', 'Salvar')).toBeHidden();
      await browser.reload();
      await expect(group).toContainText(name);
      await expect(group).toContainText('gpt-6-luna');
      expect(await sql('SELECT c.provider,a.model_id FROM ai_model_assignment a JOIN ai_connection c ON c.id=a.connection_id WHERE a.scope=$1 AND a.target=$2', ['group', 'summary'])).toEqual([{ provider: 'cliproxyapi', model_id: 'gpt-6-luna' }]);
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`proxy-selection-${width}`);
    } finally {
      await restoreAssignment();
      if (connectionId) expect((await api.request(`/api/platform/ai/connections/${connectionId}`, { method: 'DELETE' })).status).toBe(204);
    }
  });
}
});

test('novo usuário conversa pelo proxy, recarrega o histórico e mantém isolamento', {
  skip: process.env.K5_E2E_REAL_AI !== '1' ? 'Requer K5_E2E_REAL_AI=1 e uma chave de teste do CLIProxyAPI.' : false,
  timeout: 240_000,
}, async ({ app, browser, screen, sql }) => {
  const apiKey = process.env.K5_E2E_CLIPROXYAPI_KEY_FILE
    ? (await readFile(process.env.K5_E2E_CLIPROXYAPI_KEY_FILE, 'utf8')).trim()
    : process.env.K5_E2E_CLIPROXYAPI_KEY?.trim();
  if (!apiKey) throw new Error('Configure K5_E2E_CLIPROXYAPI_KEY_FILE ou K5_E2E_CLIPROXYAPI_KEY no processo do teste.');
  const api = await administrator(app.baseUrl!);
  const restoreAssignment = await preserveModelAssignment('task', 'agent.chat');
  const created = await api.request('/api/platform/ai/connections', { json: { name: `Proxy real ${Date.now()}`, provider: 'cliproxyapi', apiKey } });
  expect(created.status).toBe(201);
  const { connection } = await created.json();
  try {
    await api.json('/api/platform/ai/assignments', { method: 'PUT', json: { scope: 'task', target: 'agent.chat', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } } });
    const account = uniqueAccount('Conversa proxy');
    const user = await new ApiSession(app.baseUrl!).signIn(account);
    await signInWithSession({ app, browser, screen }, user);
    const { conversation } = await user.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
    await app.open(`/app/agents?conversationId=${conversation.id}`);
    const marker = `MARCADOR-${Date.now()}`;
    await screen.getByPlaceholder('Pergunte ao Lume').fill(`Responda apenas com ${marker}.`);
    await screen.getByRole('button', 'Enviar mensagem').tap();
    await expect.poll(async () => {
      const detail = await user.json<{ messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }>(`/api/conversations/${conversation.id}`);
      return detail.messages.filter(message => message.role === 'assistant').flatMap(message => message.parts.map(part => part.text ?? '')).join('');
    }, { timeout: 180_000 }).toContain(marker);
    await browser.reload();
    await expect(screen.getByText(marker, { exact: true })).toBeVisible();
    expect(await sql('SELECT c.user_id=u.id AS owned,c.busy_until=0 AS released FROM ai_conversation c JOIN "user" u ON u.email=$1 WHERE c.id=$2', [account.email, conversation.id])).toEqual([{ owned: true, released: true }]);
    const other = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Outra pessoa proxy'));
    expect((await other.request(`/api/conversations/${conversation.id}`)).status).toBe(404);
    await app.screenshot('proxy-history-reloaded');
  } finally {
    await restoreAssignment();
    expect((await api.request(`/api/platform/ai/connections/${connection.id}`, { method: 'DELETE' })).status).toBe(204);
  }
});
