import { test } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';
import { ApiSession, admin, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

async function module(screen: Screen, label: string) {
  await screen.getByRole('button', 'Abrir módulos').tap();
  await screen.getByRole('navigation', 'Módulos').getByRole('button', label, { exact: false }).tap();
}

function answer(id: string, documentHref?: string) {
  const chunks = [
    { type: 'start', messageId: id },
    ...(documentHref ? [{ type: 'data-tool', id: `tool-${id}`, data: { callId: `call-${id}`, name: 'k5_artifacts_create', state: 'completed', summary: 'Documento criado', href: documentHref } }] : []),
    { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Pedido concluído.' },
    { type: 'text-end', id: 'text' }, { type: 'finish' },
  ];
  return { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' };
}

async function emptyConversation(api: ApiSession) {
  const { conversation } = await api.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  return conversation.id;
}

test('a conversa e o rascunho sobrevivem aos modos, módulos e alternância móvel', { session: 'admin' }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const conversationId = await emptyConversation(api);
  await app.open(`/app/command-center?lume=1&conversationId=${conversationId}`);
  const input = screen.getByRole('textbox', 'Pergunte ao Lume');
  await input.fill('Rascunho mantido enquanto consulto o escritório');
  await screen.getByRole('button', 'Ampliar conversa').tap();
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await screen.getByRole('button', 'Voltar ao painel flutuante').tap();
  await screen.getByRole('button', 'Recolher o Lume').tap();
  await expect(input).toBeHidden();
  await module(screen, 'Cofre');
  await expect(browser).toHaveURL(/\/app\/vault$/);
  await screen.getByRole('button', 'Abrir o Lume').tap();
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await module(screen, 'Escritório');
  await expect(browser).toHaveURL(/\/app\/agenda/);
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await module(screen, 'Cálculos jurídicos');
  await expect(browser).toHaveURL(/\/app\/calc$/);
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await browser.back();
  await expect(browser).toHaveURL(/\/app\/agenda/);
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await browser.setViewport({ width: 390, height: 844 });
  const switcher = screen.getByRole('navigation', 'Alternar conversa e canvas');
  await switcher.getByRole('button', 'Lume').tap();
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  await switcher.getByRole('button', 'Canvas').tap();
  await expect(input).toBeHidden();
  await expect(browser.locator('.lume-panel')).toHaveAttribute('inert');
  await switcher.getByRole('button', 'Lume').tap();
  await expect(input).toHaveValue('Rascunho mantido enquanto consulto o escritório');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
});

test('contrato frontend: o transporte envia o caso visível e uma saída tardia abre só uma aba de fundo', { session: 'admin', tags: ['frontend-contract'] }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const stamp = Date.now();
  const first = await api.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Contexto A ${stamp}` } });
  const second = await api.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Contexto B ${stamp}` } });
  const { artifact } = await api.json<{ artifact: { id: string; title: string } }>('/api/artifacts', { json: { title: `Saída tardia ${stamp}`, content: 'Documento de uma execução anterior.' } });
  const conversationId = await emptyConversation(api);
  const requests: Array<{ conversationId: string; canvasHref?: string; caseId?: string; trigger: string; message: { id: string } }> = [];
  const release = Promise.withResolvers<void>();
  await browser.route('**/api/chat', async route => {
    const body = JSON.parse(route.request.postData ?? '{}') as typeof requests[number];
    requests.push(body);
    if (requests.length === 1) await release.promise;
    return route.fulfill(answer(`shell-answer-${requests.length}`, requests.length === 1 ? `/app/documents/${artifact.id}` : undefined));
  });
  await app.open(`/app/vault/cases/${first.case.id}?lume=1&conversationId=${conversationId}`);
  await expect(screen.getByRole('heading', first.case.name, { exact: true })).toBeVisible();
  const chip = browser.locator('[aria-label="Contexto da próxima mensagem"]');
  await expect(chip).toContainText(first.case.name);
  const input = screen.getByRole('textbox', 'Pergunte ao Lume');
  await input.fill('Resuma este caso');
  await screen.getByRole('button', 'Enviar mensagem').tap();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ conversationId, caseId: first.case.id, canvasHref: `/app/vault/cases/${first.case.id}` });
  try {
    await module(screen, 'Cofre');
    await screen.getByRole('link', new RegExp(second.case.name)).tap();
    await expect(chip).toContainText(second.case.name);
    await expect(screen.getByRole('status').filter({ hasText: `Pedido em andamento · ${first.case.name}` })).toBeVisible();
  } finally { release.resolve(); }
  await expect(screen.getByText('Pedido concluído.')).toBeVisible();
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', artifact.title, { exact: true })).toBeVisible();
  await expect(browser).toHaveURL(`/app/vault/cases/${second.case.id}`);
  await input.fill('Agora resuma o segundo caso');
  await screen.getByRole('button', 'Enviar mensagem').tap();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ conversationId, caseId: second.case.id, canvasHref: `/app/vault/cases/${second.case.id}` });
  await expect(screen.getByRole('button', 'Gerar novamente').last()).toBeEnabled();
  await screen.getByRole('button', 'Gerar novamente').last().tap();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ trigger: 'regenerate-message', message: { id: requests[1].message.id } });
  expect(requests[2].caseId).toBeUndefined();
});

test('links privados canônicos e abas restauradas conservam autorização e rascunhos', { session: 'admin' }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const { artifact } = await api.json<{ artifact: { id: string; title: string } }>('/api/artifacts', { json: { title: `Minuta do canvas ${Date.now()}`, content: 'Texto original.' } });
  await browser.setViewport({ width: 390, height: 844 });
  await app.open(`/app/agents?doc=${artifact.id}`);
  await expect(browser).toHaveURL(`/app/documents/${artifact.id}`);
  const editor = screen.getByRole('textbox', 'Texto do documento');
  await editor.fill('Edição humana preservada nos dois espaços.');
  const switcher = screen.getByRole('navigation', 'Alternar conversa e canvas');
  await switcher.getByRole('button', 'Lume').tap();
  await screen.getByRole('textbox', 'Pergunte ao Lume').fill('Pedido ainda não enviado');
  await switcher.getByRole('button', 'Canvas').tap();
  await expect(editor).toContainText('Edição humana preservada nos dois espaços.');
  await module(screen, 'Cofre');
  await expect(browser).toHaveURL('/app/vault');
  expect((await api.json<{ artifact: { content: string } }>(`/api/artifacts/${artifact.id}`)).artifact.content).toContain('Edição humana preservada');
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('button', artifact.title, { exact: true }).tap();
  await expect(editor).toContainText('Edição humana preservada');
  await switcher.getByRole('button', 'Lume').tap();
  await expect(screen.getByRole('textbox', 'Pergunte ao Lume')).toHaveValue('Pedido ainda não enviado');
  await switcher.getByRole('button', 'Canvas').tap();
  await browser.reload();
  await expect(editor).toContainText('Edição humana preservada');
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', artifact.title, { exact: true })).toBeVisible();
  const serialized = await browser.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('lume:canvas:')).map(([, value]) => value));
  expect(serialized.some(value => value.includes(artifact.title))).toBe(false);
});

test('a revogação real de um caso remove a aba, o conteúdo e o contexto sem apagar o pedido privado', async ({ app, screen, browser }) => {
  const owner = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Dona do caso'));
  const guest = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Participante do caso'));
  const { user } = await guest.json<{ user: { id: string; email: string } }>('/api/auth/get-session');
  const invitation = await owner.json<{ id: string }>('/api/collaboration', { json: { action: 'invite', invitation: { email: user.email } } });
  await guest.json('/api/collaboration', { json: { action: 'respond', id: invitation.id, accept: true } });
  const { case: record } = await owner.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Caso revogado ${Date.now()}`, description: 'Conteúdo reservado do caso.' } });
  await owner.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: user.id, add: true } });
  const { artifact } = await owner.json<{ artifact: { id: string } }>('/api/artifacts', { json: { title: 'Minuta particular da dona', content: 'Compartilhar o caso não publica esta minuta.' } });
  expect((await guest.request(`/api/artifacts/${artifact.id}`)).status).toBe(404);
  await signInWithSession({ app, screen, browser }, guest);
  const href = `/app/vault/cases/${record.id}`;
  await app.open(href);
  await expect(screen.getByRole('heading', record.name, { exact: true })).toBeVisible();
  const input = screen.getByRole('textbox', 'Pergunte ao Lume');
  await input.fill('Pedido privado ainda não enviado');
  await owner.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: user.id, add: false } });
  expect((await guest.request(`/api/canvas/resource?href=${encodeURIComponent(href)}`)).status).toBe(404);
  await screen.getByRole('navigation', 'Abas do canvas').getByRole('button', record.name, { exact: true }).tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível abrir este recurso' })).toBeVisible();
  await expect(screen.getByRole('navigation', 'Abas do canvas').getByRole('button', record.name, { exact: true })).toHaveCount(0);
  await expect(screen.getByRole('heading', record.name, { exact: true })).toHaveCount(0);
  await expect(browser.locator('[aria-label="Contexto da próxima mensagem"]')).not.toContainText(record.name);
  await expect(input).toHaveValue('Pedido privado ainda não enviado');
  await expect(screen.getByRole('button', 'Enviar mensagem')).toBeDisabled();
  const { conversation } = await guest.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  const rejected = await guest.request('/api/chat', { json: { conversationId: conversation.id, canvasHref: href, caseId: record.id, message: { id: 'revoked-turn', role: 'user', parts: [{ type: 'text', text: 'Resuma o caso revogado' }] } } });
  expect(rejected.status).toBe(404);
  expect((await guest.json<{ messages: unknown[] }>(`/api/conversations/${conversation.id}`)).messages).toEqual([]);
  await app.screenshot('caso-revogado-sem-conteudo');
  await module(screen, 'Cofre');
  await expect(browser).toHaveURL('/app/vault');
  await expect(browser.locator('[aria-label="Contexto da próxima mensagem"]')).toContainText('Cofre');
  await expect(input).toHaveValue('Pedido privado ainda não enviado');
});

for (const status of [403, 404]) {
  test(`contrato frontend: a conversa restrita por ${status} não reaparece pelo cache`, { session: 'admin', tags: ['frontend-contract'] }, async ({ app, screen, browser }) => {
    const old = { id: `restricted-${status}`, title: `Privada ${status}`, updatedAt: new Date().toISOString() };
    const other = { id: `other-${status}`, title: 'Outra conversa', updatedAt: old.updatedAt };
    let denied = false;
    await browser.route('**/api/conversations', route => route.fulfill({ json: { conversations: [old, other] } }));
    await browser.route(`**/api/conversations/${old.id}`, route => denied ? route.fulfill({ status, json: { error: 'Acesso removido' } })
      : route.fulfill({ json: { conversation: old, messages: [{ id: 'private-message', role: 'assistant', parts: [{ type: 'text', text: 'Conteúdo privado que deve desaparecer' }] }] } }));
    await browser.route(`**/api/conversations/${other.id}`, route => route.fulfill({ json: { conversation: other, messages: [] } }));
    await browser.route('**/api/chat/**/stream**', route => route.fulfill({ status: 204 }));
    await app.open(`/app/agents?conversationId=${old.id}`);
    await expect(screen.getByText('Conteúdo privado que deve desaparecer')).toBeVisible();
    await screen.getByRole('button', 'Mostrar conversas').tap();
    await screen.getByRole('button', /^Outra conversa/).tap();
    await expect(screen.getByRole('textbox', 'Pergunte ao Lume')).toBeVisible();
    denied = true;
    await screen.getByRole('button', 'Mostrar conversas').tap();
    await screen.getByRole('button', new RegExp(`^Privada ${status}`)).tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Não foi possível abrir esta conversa.' })).toBeVisible();
    await expect(screen.getByText('Conteúdo privado que deve desaparecer')).toHaveCount(0);
  });
}
