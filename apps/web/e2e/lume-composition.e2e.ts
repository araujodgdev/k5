import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';
import { localDate } from '../src/lib/calendar-days';

test('composição real do Início e Tudo preserva contexto, paginação, rascunhos e compartilhamento em 390px', { timeout: 360_000 }, async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Helena de verificação'), api = await new ApiSession(app.baseUrl!).signIn(account);
  const peerAccount = uniqueAccount('Participante de verificação'), peer = await new ApiSession(app.baseUrl!).signIn(peerAccount);
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Caso da composição', description: 'Documentos e prazos registrados para a verificação.' } });
  const { id: invitation } = await api.json<{ id: string }>('/api/collaboration', { json: { action: 'invite', invitation: { email: peerAccount.email } } });
  await peer.json('/api/collaboration', { json: { action: 'respond', id: invitation, accept: true } });
  const { viewerId } = await peer.json<{ viewerId: string }>('/api/collaboration');
  await api.json('/api/collaboration', { json: { action: 'participant', caseId: record.id, userId: viewerId, add: true } });
  const href = `/app/vault/cases/${record.id}`;
  const { page } = await api.json<{ page: { id: string } }>(`/api/cases/${record.id}/pages`, { json: { title: 'Sobre o caso', content: 'Texto real salvo na página para conferir a prévia.' } });
  const today = localDate(new Date());
  await api.json(`/api/cases/${record.id}/tasks`, { json: { title: 'Conferir prazo compartilhado', dueOn: today, assigneeId: viewerId, idempotencyKey: randomUUID() } });
  await api.json('/api/agenda/activities/create', { json: { kind: 'task', title: 'Conferir trabalho pessoal', dueOn: today, idempotencyKey: randomUUID() } });
  const { client } = await api.json<{ client: { id: string } }>('/api/agenda/clients/create', { json: { name: 'Cliente da composição', caseIds: [record.id], idempotencyKey: randomUUID() } });
  await api.json('/api/honorarios/create', { json: { clientId: client.id, caseId: record.id, title: 'Honorário da composição', installments: [{ dueOn: today, amountCents: 23000 }], idempotencyKey: randomUUID() } });
  const cookie = api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; ');
  const files: { id: string; name: string }[] = [];
  for (let index = 0; index < 51; index += 3) await Promise.all(Array.from({ length: Math.min(3, 51 - index) }, async (_, offset) => {
    const name = `Arquivo de verificação ${index + offset + 1}.txt`;
    const response = await fetch(new URL('/api/vault/documents', app.baseUrl!), { method: 'POST', body: new File(['Texto local de verificação.'], name), headers: { origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': encodeURIComponent(name), 'x-k5-upload-scope': 'case', 'x-k5-upload-caseid': record.id } });
    expect(response.status).toBe(201); files.push((await response.json()).document);
  }));
  await signInWithSession({ app, screen, browser }, api);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/app/command-center');
  await expect(screen.getByRole('heading', 'Hoje', { exact: true })).toBeVisible();
  const daily = screen.getByRole('region', 'Trabalho de hoje');
  await expect(daily).toContainText('Conferir prazo compartilhado'); await expect(daily).toContainText('Conferir trabalho pessoal'); await expect(daily).toContainText('Honorário da composição');
  await expect(screen.getByRole('region', 'Atividade recente')).toContainText('Arquivo de verificação 51.txt');
  await app.screenshot('inicio-real-desktop');
  const composer = screen.getByRole('textbox', 'Pergunte ao Lume'); await composer.fill('Rascunho pessoal preservado');
  await screen.getByRole('region', 'Casos recentes').getByRole('link', /Caso da composição/).tap();
  await expect(browser).toHaveURL(href, { timeout: 60_000 });
  await expect(screen.getByRole('button', 'Tudo', { exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  const contents = screen.getByLabel('Páginas e arquivos');
  await expect(contents).toContainText('Texto real salvo na página');
  const pager = screen.getByRole('navigation', 'Páginas de arquivos');
  await expect(pager).toContainText('1–50 de 51 arquivos');
  await pager.getByRole('button', 'Próxima').tap(); await expect(pager).toContainText('51–51 de 51 arquivos');
  const oldFile = contents.getByRole('link', /Arquivo de verificação/); await expect(oldFile).toHaveCount(1);
  const oldName = (await oldFile.textContent())!; const selected = files.find(file => oldName.includes(file.name))!;
  await screen.getByRole('button', 'Arquivos', { exact: true }).tap(); await expect(pager).toContainText('51–51 de 51 arquivos');
  await screen.getByRole('button', 'Tudo', { exact: true }).tap(); await expect(pager).toContainText('51–51 de 51 arquivos');
  await contents.getByRole('link', new RegExp(selected.name)).tap(); await expect(browser).toHaveURL(`/app/vault/files/${selected.id}`, { timeout: 60_000 });
  await browser.back(); await expect(browser).toHaveURL(href, { timeout: 60_000 }); await contents.getByRole('link', /Sobre o caso/).tap();
  const editor = screen.getByRole('textbox', 'Texto do documento'); await expect(editor).toContainText('Texto real salvo', { timeout: 60_000 });
  await editor.fill('Texto humano que deve permanecer salvo.');
  await expect.poll(async () => (await api.json<{ page: { content: string } }>(`/api/cases/${record.id}/pages/${page.id}`)).page.content).toContain('Texto humano');
  await browser.back(); await expect(browser).toHaveURL(href, { timeout: 60_000 }); await expect(screen.getByLabel('Contexto da próxima mensagem')).toContainText('Caso da composição', { timeout: 60_000 }); await screen.getByRole('button', 'Pedir ao Lume', { exact: true }).tap();
  await expect(composer).toBeFocused(); await expect(composer).toHaveValue('Rascunho pessoal preservado');
  await expect(screen.getByLabel('Contexto da próxima mensagem')).toContainText('Caso da composição');
  await screen.getByRole('button', 'Compartilhar', { exact: true }).tap();
  const sharing = screen.getByRole('dialog', 'Compartilhar caso');
  await expect(sharing).toContainText(peerAccount.name); await expect(sharing).toContainText('memória de cada pessoa continuam pessoais');
  await expect(sharing.getByRole('link', 'Gerenciar portal de Cliente da composição')).toBeVisible();
  await sharing.getByRole('checkbox', 'O Lume pode trabalhar neste caso').tap();
  await expect.poll(async () => (await api.json<{ enabled: boolean }>(`/api/cases/${record.id}/policy`)).enabled).toBe(false);
  await expect(sharing.getByRole('checkbox', 'O Lume pode trabalhar neste caso')).not.toBeChecked();
  await app.screenshot('compartilhamento-real-desktop');
  await sharing.getByRole('button', 'Concluir', { exact: true }).tap();
  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByRole('button', 'Recolher o Lume').tap();
  await expect(contents.getByRole('link', /Sobre o caso/)).toBeVisible();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false); await app.screenshot('tudo-real-mobile');
  await screen.getByRole('button', 'Compartilhar', { exact: true }).tap();
  await expect(sharing.getByRole('checkbox', 'O Lume pode trabalhar neste caso')).not.toBeChecked();
  await app.screenshot('compartilhamento-real-mobile'); await browser.keyboard.press('Escape');
  const accountMenu = screen.getByRole('button', /^Mais opções(?:,|$)/); await accountMenu.tap();
  await screen.getByRole('button', 'Usar tema escuro').tap(); await browser.keyboard.press('Escape');
  await expect.poll(() => browser.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await app.screenshot('tudo-real-mobile-escuro');
  await screen.getByRole('button', 'Voltar ao Lume').tap(); await expect(composer).toHaveValue('Rascunho pessoal preservado');
  await screen.getByRole('button', 'Recolher o Lume').tap();
  await screen.getByRole('button', 'Pedir ao Lume', { exact: true }).focus(); await browser.keyboard.press('Enter'); await expect(composer).toBeFocused();
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false); await app.screenshot('conversa-contextual-mobile');
  expect((await sql('SELECT count(*)::integer AS n FROM vault_document WHERE case_id=$1', [record.id]))[0]?.n).toBe(51);
});

test('contrato de apresentação local usa uma linha por chamada e mantém a confirmação precisa', { tags: ['frontend-contract'] }, async ({ app, screen, browser }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Conversa observada'));
  await signInWithSession({ app, screen, browser }, api);
  await browser.route('**/api/chat', route => {
    const chunks = [
      { type: 'start', messageId: 'fixture-tool-observed' },
      { type: 'data-tool', id: 'observed-call', data: { callId: 'observed-call', name: 'k5_case_tasks_list', summary: 'Consultando as tarefas do caso…', state: 'running' } },
      { type: 'data-tool', id: 'observed-call', data: { callId: 'observed-call', name: 'k5_case_tasks_list', summary: 'Tarefas consultadas', state: 'completed' } },
      { type: 'data-tool', id: 'approval-call', data: { callId: 'approval-call', name: 'k5_vault_delete_folder', approvalId: 'local-approval', summary: 'Aguardando sua revisão. A ação ainda não foi executada.', state: 'awaiting_approval' } },
      { type: 'data-approval', id: 'local-approval', data: { approvalId: 'local-approval', capability: 'k5_vault_delete_folder', summary: 'Proposta local para revisão.', state: 'pending' } },
      { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Consultei as tarefas. O envio aguarda revisão.' }, { type: 'text-end', id: 'text' }, { type: 'finish' },
    ];
    return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await browser.route('**/api/chat/approvals/local-approval', route => route.fulfill({ json: { state: 'cancelled', result: 'Proposta cancelada na fixture local.' } }));
  await app.open('/app/command-center');
  await screen.getByRole('textbox', 'Pergunte ao Lume').fill('Pedido sintético local'); await screen.getByRole('button', 'Enviar mensagem').tap();
  await expect(screen.getByText('Tarefas consultadas', { exact: false })).toHaveCount(1);
  await expect(screen.getByText('Consultando as tarefas do caso…')).toHaveCount(0);
  await expect(screen.getByRole('group', 'Confirmação')).toBeVisible();
  await expect(screen.getByText('Precisa de você: confirme abaixo', { exact: false })).toBeVisible();
  await app.screenshot('ferramentas-observadas-fixture-local');
  await screen.getByRole('group', 'Confirmação').getByRole('button', 'Cancelar', { exact: true }).tap();
  await expect(screen.getByRole('group', 'Confirmação')).toContainText('Proposta cancelada na fixture local.');
  await expect(screen.getByText('Aguardando sua revisão. A ação ainda não foi executada.', { exact: false })).toHaveCount(0);
  await app.screenshot('confirmacao-cancelada-fixture-local');
});
