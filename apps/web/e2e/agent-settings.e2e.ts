import { Document, Packer, Paragraph } from 'docx';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

test('personalização do Lume reúne legados e novos itens em uma lista no desktop e celular', async ({ app, screen, browser }) => {
  const account = uniqueAccount('Personalização');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const createRule = (scope: 'office' | 'personal', title: string) => api.json('/api/agent/instructions', {
    json: { scope, title, content: 'Escreva em português claro.', appliesTo: 'all', enabled: true },
  });
  await createRule('office', 'Regra antiga');
  await createRule('personal', 'Regra pessoal');
  await signInWithSession({ app, screen, browser }, api);

  const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Modelo de teste')] }] }));
  const uploaded = await browser.evaluate(async (bytes: number[]) => {
    const documents: { id: string }[] = [];
    for (const file of [
      new File(['Referência de teste do Lume.'], 'referencia-lume.txt', { type: 'text/plain' }),
      new File([new Uint8Array(bytes)], 'modelo-lume.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ]) {
      const form = new FormData();
      form.set('file', file);
      form.set('scope', 'library');
      const response = await fetch('/api/vault/documents', { method: 'POST', body: form });
      if (!response.ok) throw new Error(`Upload de teste falhou: ${response.status}`);
      documents.push((await response.json() as { document: { id: string } }).document);
    }
    return documents;
  }, [...word]);
  for (const scope of ['office', 'personal'] as const) await api.json('/api/agent/knowledge', {
    json: { scope, documentId: uploaded[0].id, mode: 'search', note: '' },
  });
  await api.json('/api/agent/template', { method: 'PUT', json: { scope: 'office', documentId: uploaded[1].id } });

  await app.open('/app/agents/settings');
  await expect(screen.getByRole('heading', 'Personalizar Lume')).toBeVisible();
  await expect(screen.getByRole('button', 'Nova regra')).toHaveCount(1);
  await expect(screen.getByLabel('Adicionar do Cofre')).toHaveCount(1);
  await expect(screen.getByLabel('Escolher do Cofre')).toHaveCount(1);
  await expect(screen.getByText('Do escritório', { exact: true })).toHaveCount(0);
  await expect(screen.getByText('Minhas regras', { exact: true })).toHaveCount(0);
  await expect(screen.getByLabel('Modo de leitura de referencia-lume.txt')).toHaveCount(1);
  await expect(browser.locator('section[aria-labelledby="template-heading"]').getByText('modelo-lume.docx', { exact: true })).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('personalizacao-desktop');

  await screen.getByRole('button', 'Editar Regra antiga').tap();
  await screen.getByLabel('Título', { exact: true }).fill('Regra antiga revisada');
  await screen.getByRole('button', 'Salvar', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Editar Regra antiga revisada')).toBeVisible();
  const rules = await api.json<{ office: { title: string }[]; personal: { title: string }[] }>('/api/agent/instructions');
  expect(rules.office.map(rule => rule.title)).toEqual(['Regra antiga revisada']);

  const mode = screen.getByLabel('Modo de leitura de referencia-lume.txt');
  await mode.selectOption({ value: 'always' });
  await expect(mode).toBeEnabled();
  const knowledge = await api.json<{ office: { mode: string }[]; personal: { mode: string }[] }>('/api/agent/knowledge');
  expect([...knowledge.office, ...knowledge.personal].map(item => item.mode)).toEqual(['always', 'always']);

  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByRole('button', 'Nova regra').focus();
  await browser.keyboard.press('Enter');
  await screen.getByLabel('Título', { exact: true }).fill('Regra nova');
  await screen.getByLabel('Regra', { exact: true }).fill('Use datas por extenso.');
  await screen.getByRole('button', 'Salvar', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Editar Regra nova')).toBeVisible();
  expect((await api.json<{ personal: { title: string }[] }>('/api/agent/instructions')).personal.map(rule => rule.title)).toContain('Regra nova');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await app.screenshot('personalizacao-mobile');

  await screen.getByRole('button', 'Remover referencia-lume.txt').tap();
  await expect(screen.getByRole('button', 'Remover referencia-lume.txt')).toHaveCount(0);
  const removed = await api.json<{ office: unknown[]; personal: unknown[] }>('/api/agent/knowledge');
  expect(removed.office).toEqual([]);
  expect(removed.personal).toEqual([]);
  await screen.getByRole('button', 'Remover', { exact: true }).tap();
  await expect(screen.getByText('Nenhum. Os documentos saem em Word sem timbrado.')).toBeVisible();
  const templates = await api.json<{ office: unknown; personal: unknown }>('/api/agent/template');
  expect(templates).toEqual({ office: null, personal: null });
  await browser.reload();
  await expect(screen.getByText('Nenhum documento definido.')).toBeVisible();
  await expect(screen.getByText('Nenhum. Os documentos saem em Word sem timbrado.')).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});
