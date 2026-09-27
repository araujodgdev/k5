/** Browser integration checks against a local app. Reuses stable test accounts and a stable case. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use apenas um servidor local de validação.');
const output = resolve('.data/collaboration-qa');
await mkdir(output, { recursive: true });
const password = 'SenhaForte123!@#456';
const ownerEmail = 'admin@advocacia.test';
const guestEmail = 'parceiro.colaboracao@advocacia.test';
const browser = await chromium.launch({ headless: true });
const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: 'reduce' });
const failures: string[] = [];
async function request(context: BrowserContext, path: string, data?: unknown, method = 'POST') {
  const response = data === undefined ? await context.request.get(`${base}${path}`)
    : await context.request.fetch(`${base}${path}`, { method, data, headers: { origin: base } });
  const result = await response.json().catch(() => ({}));
  assert.ok(response.ok(), `${path}: ${response.status()} ${JSON.stringify(result)}`);
  return result;
}
async function login(context: BrowserContext, email: string, name: string) {
  // Only the stable partner fixture may be provisioned; never alter the existing administrator.
  if (email === guestEmail) {
    const signIn = await context.request.post(`${base}/api/auth/sign-in/email`, { data: { email, password }, headers: { origin: base } });
    if (!signIn.ok()) await request(context, '/api/auth/sign-up/email', { name, email, password, officeName: 'Escritório parceiro — validação', confirmPassword: password });
    await context.clearCookies();
  }
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(`${base}/sign-in`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/\/app\//);
  return page;
}
async function noOverflow(page: Page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Página com overflow horizontal');
}
try {
  const ownerPage = await login(owner, ownerEmail, 'Admin');
  const guestPage = await login(guest, guestEmail, 'Parceira de colaboração');
  const guestUser = (await request(guest, '/api/auth/get-session')).user;
  const ownUser = (await request(owner, '/api/auth/get-session')).user;
  assert.notEqual(ownUser.id, guestUser.id);
  const name = 'Validação de colaboração entre escritórios';
  const cases = await request(owner, '/api/vault/cases');
  const record = cases.cases.find((item: { name: string }) => item.name === name)
    ?? (await request(owner, '/api/vault/cases', { name })).case;
  const casePath = `/app/vault/cases/${record.id}`;
  const previous = await request(owner, `/api/collaboration?caseId=${record.id}`);
  if (previous.participants.some((p: { id: string }) => p.id === guestUser.id))
    await request(owner, '/api/collaboration', { action: 'participant', caseId: record.id, userId: guestUser.id, role: null });
  for (const pending of previous.outgoing.filter((i: { email: string }) => i.email === guestEmail)) await request(owner, '/api/collaboration', { action: 'cancel', id: pending.id });
  const team = await request(owner, '/api/collaboration');
  if (team.associates.some((p: { id: string }) => p.id === guestUser.id)) await request(owner, '/api/collaboration', { action: 'associate', userId: guestUser.id });
  if (team.members.some((p: { id: string }) => p.id === guestUser.id)) await request(owner, '/api/collaboration', { action: 'member', userId: guestUser.id, role: null });
  for (const pending of team.outgoing.filter((i: { email: string }) => i.email === guestEmail)) await request(owner, '/api/collaboration', { action: 'cancel', id: pending.id });
  await ownerPage.goto(`${base}${casePath}`);
  await ownerPage.getByRole('button', { name: 'Participantes', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Convidar participante', exact: true }).click();
  await ownerPage.getByLabel('E-mail da pessoa', { exact: true }).fill(guestEmail);
  await ownerPage.getByLabel('Permissão', { exact: true }).selectOption('viewer');
  await ownerPage.getByRole('button', { name: 'Criar convite', exact: true }).click();
  await ownerPage.getByLabel('Link do convite', { exact: true }).waitFor();
  const invitationUrl = await ownerPage.getByLabel('Link do convite', { exact: true }).inputValue();
  await ownerPage.screenshot({ path: resolve(output, 'participantes-desktop.png'), fullPage: true });
  await ownerPage.keyboard.press('Tab');
  assert.ok(await ownerPage.evaluate(() => document.activeElement !== document.body));
  await guestPage.goto(`${base}/app/agenda?view=invites`);
  await guestPage.getByRole('button', { name: 'Aceitar convite', exact: true }).waitFor();
  await noOverflow(guestPage);
  await guestPage.screenshot({ path: resolve(output, 'convite-mobile.png'), fullPage: true });
  await guestPage.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
  await guestPage.waitForURL(`**${casePath}`);
  assert.equal(await guestPage.getByRole('button', { name: 'Enviar arquivos', exact: true }).count(), 0);
  const rejected = await guest.request.post(`${base}/api/vault/folders`, { data: { caseId: record.id, name: 'Proibida' }, headers: { origin: base } });
  assert.equal(rejected.status(), 403);
  await request(owner, '/api/collaboration', { action: 'participant', caseId: record.id, userId: guestUser.id, role: 'editor', canInvite: false });
  await guestPage.reload();
  await guestPage.getByRole('button', { name: 'Enviar arquivos', exact: true }).waitFor();
  const [uploadResponse] = await Promise.all([
    guestPage.waitForResponse(response => new URL(response.url()).pathname === '/api/vault/documents' && response.request().method() === 'POST'),
    guestPage.locator('input[type=file]').first().setInputFiles({ name: 'colaboracao-validacao.txt', mimeType: 'text/plain', buffer: Buffer.from('Conhecimento compartilhado: a reunião do caso será realizada em Recife. Documento de teste.') }),
  ]);
  assert.ok(uploadResponse.ok(), 'Upload recusado para o colaborador');
  const uploadedId = (await uploadResponse.json()).document.id;
  await guestPage.getByText('colaboracao-validacao.txt', { exact: true }).first().waitFor();
  await noOverflow(guestPage);
  await guestPage.screenshot({ path: resolve(output, 'caso-mobile.png'), fullPage: true });
  const documents = await request(guest, `/api/vault/documents?caseId=${record.id}`);
  const uploadedDocument = documents.documents.find((d: { id: string }) => d.id === uploadedId);
  assert.ok(uploadedDocument);
  const downloaded = await guest.request.get(`${base}/api/vault/documents/${uploadedDocument.id}/download`);
  assert.equal(downloaded.status(), 200); assert.match(await downloaded.text(), /Recife/);
  await guestPage.getByRole('link', { name: 'Conversar sobre o caso', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Fontes', exact: true }).click();
  await guestPage.getByRole('heading', { name: 'Fontes desta conversa', exact: true }).last().waitFor();
  await guestPage.getByText('colaboracao-validacao.txt', { exact: true }).first().waitFor();
  assert.match(await guestPage.locator('#sources-case').innerText(), /Validação de colaboração/);
  await noOverflow(guestPage);
  await guestPage.screenshot({ path: resolve(output, 'fontes-mobile.png'), fullPage: true });
  const tampered = await guest.request.patch(`${base}/api/vault/documents/${uploadedDocument.id}`, { data: { caseId: null }, headers: { origin: base } });
  assert.equal(tampered.status(), 403);
  const csrf = await guest.request.post(`${base}/api/collaboration`, { data: { action: 'invite', invitation: { kind: 'team', email: ownerEmail, role: 'lawyer' } }, headers: { origin: 'https://outra-origem.example' } });
  assert.equal(csrf.status(), 403);
  await request(owner, '/api/collaboration', { action: 'participant', caseId: record.id, userId: guestUser.id, role: null });
  assert.equal((await guest.request.get(`${base}/api/vault/documents/${uploadedDocument.id}/download`)).status(), 404);
  assert.equal((await guest.request.get(`${base}/api/vault/documents?caseId=${record.id}`)).status(), 404);
  await guestPage.goto(invitationUrl);
  await guestPage.getByText('Este convite já foi respondido, cancelado ou expirou.', { exact: true }).waitFor();
  await ownerPage.goto(`${base}/app/agenda?view=associates`);
  await ownerPage.getByRole('button', { name: 'Convidar associado', exact: true }).click();
  await ownerPage.getByLabel('E-mail da pessoa', { exact: true }).fill(guestEmail);
  await ownerPage.getByRole('button', { name: 'Criar convite', exact: true }).click();
  await ownerPage.getByLabel('Link do convite', { exact: true }).waitFor();
  await guestPage.goto(`${base}/app/agenda?view=invites`);
  await guestPage.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
  await guestPage.getByRole('status').filter({ hasText: 'Convite aceito' }).waitFor();
  assert.equal((await guest.request.get(`${base}/api/vault/documents?caseId=${record.id}`)).status(), 404);
  await ownerPage.reload();
  await ownerPage.getByText(guestEmail, { exact: true }).waitFor();
  await ownerPage.screenshot({ path: resolve(output, 'associados-desktop.png'), fullPage: true });
  await ownerPage.getByRole('button', { name: 'Remover', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Remover acesso', exact: true }).click();
  await ownerPage.getByText('Nenhum associado ainda. Convide um parceiro pelo e-mail.', { exact: true }).waitFor();
  await ownerPage.goto(`${base}/app/agenda?view=team`);
  await ownerPage.getByRole('button', { name: 'Convidar para equipe', exact: true }).click();
  await ownerPage.getByLabel('E-mail da pessoa', { exact: true }).fill(guestEmail);
  await ownerPage.getByRole('button', { name: 'Criar convite', exact: true }).click();
  await ownerPage.getByLabel('Link do convite', { exact: true }).waitFor();
  await guestPage.goto(`${base}/app/agenda?view=invites`);
  await guestPage.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
  await guestPage.getByRole('status').filter({ hasText: 'Convite aceito' }).waitFor();
  await guestPage.getByLabel('Escritório ativo', { exact: true }).waitFor();
  await noOverflow(guestPage);
  const officeSelect = guestPage.getByLabel('Escritório ativo', { exact: true });
  const originalOfficeId = await officeSelect.inputValue();
  const choices = await officeSelect.locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value));
  const joinedOfficeId = choices.find(id => id !== originalOfficeId)!;
  await officeSelect.selectOption(joinedOfficeId);
  await guestPage.waitForURL('**/app/agenda?view=team');
  await guestPage.getByText(ownerEmail, { exact: true }).waitFor();
  assert.ok((await request(guest, '/api/vault/cases')).cases.some((item: { id: string }) => item.id === record.id));
  const foreignSwitch = await guest.request.post(`${base}/api/offices/active`, { data: { officeId: 'not-a-membership' }, headers: { origin: base } });
  assert.equal(foreignSwitch.status(), 403);
  await noOverflow(guestPage);
  await guestPage.screenshot({ path: resolve(output, 'equipe-mobile.png'), fullPage: true });
  await ownerPage.reload();
  await ownerPage.getByText(guestEmail, { exact: true }).waitFor();
  await ownerPage.screenshot({ path: resolve(output, 'equipe-desktop.png'), fullPage: true });
  await request(owner, '/api/collaboration', { action: 'member', userId: guestUser.id, role: null });
  assert.equal((await request(guest, '/api/vault/cases')).cases.some((item: { id: string }) => item.id === record.id), false);
  await guestPage.route('**/api/collaboration', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falha temporária de validação.' }) }));
  await guestPage.goto(`${base}/app/agenda?view=invites`);
  await guestPage.getByRole('alert').filter({ hasText: 'Falha temporária' }).waitFor();
  await guestPage.unroute('**/api/collaboration');
  await guestPage.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await guestPage.getByText('Nenhum convite pendente para sua conta.', { exact: true }).waitFor();
  await noOverflow(guestPage);
  await guestPage.screenshot({ path: resolve(output, 'convites-vazio-mobile.png'), fullPage: true });
  assert.deepEqual(failures, [], 'Erros JavaScript no navegador');
  console.log('PASS: convites, consulta/colaboração, arquivos, revogação, CSRF, associados, equipe, troca de escritório, desktop/mobile, teclado, convite respondido e recuperação de erro.');
  console.log(`Capturas: ${output}`);
} finally {
  await owner.close(); await guest.close(); await browser.close();
}
