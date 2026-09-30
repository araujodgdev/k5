import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { portalManageDto } from '../src/lib/client-portal/contracts';
import type { SignatureTransport } from '../src/lib/signatures/zapsign';
import type { WorkspaceContext } from '../src/lib/application/context';

const settings = parseEnv(await readFile(process.env.K5_ENV_FILE ?? '.env.local', 'utf8'));
const baseURL = process.env.BASE_URL ?? settings.BETTER_AUTH_URL, databaseURL = process.env.DATABASE_URL ?? settings.DATABASE_URL;
if (!baseURL || !databaseURL || [baseURL, databaseURL].some(url => !['localhost','127.0.0.1'].includes(new URL(url).hostname))) throw new Error('Use servidor e banco locais.');
for (const key of ['DATABASE_URL','K5_CREDENTIALS_KEY','VAULT_STORAGE_PATH']) if (settings[key]) process.env[key] = settings[key];
const { database } = await import('../src/lib/database');
const service = await import('../src/lib/signatures/service');
const browser = await chromium.launch();
const office = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const client = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const officePage = await office.newPage(), clientPage = await client.newPage();
for (const page of [officePage, clientPage]) page.setDefaultTimeout(90_000);
const expect = playwrightExpect.configure({ timeout: 90_000 });
const output = 'playwright-report/signatures'; await mkdir(output, { recursive: true });
const errors: string[] = []; for (const page of [officePage, clientPage]) page.on('pageerror', error => errors.push(error.message));
try {
  const signup = await office.request.post('/api/auth/sign-up/email', { headers: { origin: baseURL }, data: { name: 'Ana Assinaturas', email: `${randomUUID()}@office.test`, password: `Validação!${randomUUID()}`, officeName: 'Escritório Assinaturas' } });
  assert.equal(signup.ok(), true);
  const session = z.object({ user: z.object({ id: z.string() }), session: z.object({ id: z.string() }) }).parse(await (await office.request.get('/api/auth/get-session')).json());
  const membership = await database.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(session.user.id); assert.ok(membership);
  const context: WorkspaceContext = { officeId: membership.office_id, userId: session.user.id, sessionId: session.session.id, role: 'administrator' };
  const clientId = randomUUID(), email = `${randomUUID()}@client.test`;
  await database.prepare("INSERT INTO crm_client(id,office_id,name,email,stage,created_at,updated_at) VALUES(?,?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, context.officeId, 'Maria Assinaturas', email);
  const invited = portalManageDto.extend({ invitationPath: z.string() }).parse(await (await office.request.post('/api/client-portal/manage', { headers: { origin: baseURL }, data: { operation: 'invite', data: { clientId, email, version: 0 } } })).json());
  assert.ok(invited.access);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const publication = await office.request.post(`/api/client-portal/manage/${clientId}/files`, { headers: { origin: baseURL }, multipart: { idempotencyKey: randomUUID(), file: { name: 'Contrato de assinatura.pdf', mimeType: 'application/pdf', buffer: bytes } } });
  assert.equal(publication.status(), 201);
  const { id: fileId } = z.object({ id: z.string() }).parse(await publication.json());
  await clientPage.goto(invited.invitationPath);
  const password = `Cliente!${randomUUID()}`;
  await clientPage.getByLabel('Nova senha', { exact: true }).fill(password); await clientPage.getByLabel('Confirmar nova senha', { exact: true }).fill(password);
  await clientPage.getByRole('button', { name: 'Criar acesso ao portal', exact: true }).click();
  await expect(clientPage.getByRole('heading', { name: 'Portal do cliente', exact: true })).toBeVisible();
  await officePage.goto('/app/integrations'); await officePage.getByRole('button', { name: 'Agora não', exact: true }).click();
  await officePage.getByLabel('Chave de API ZapSign', { exact: true }).fill('synthetic-signature-api-key');
  await officePage.getByRole('button', { name: 'Salvar conexão', exact: true }).click();
  await expect(officePage.getByText('Conexão de assinatura salva.', { exact: true })).toBeVisible();
  await officePage.screenshot({ path: `${output}/conexao-desktop.png`, fullPage: true });
  let remote: Record<string, unknown> | null = null, posts = 0;
  const signerToken = randomUUID(), providerToken = randomUUID();
  const transport: SignatureTransport = { fetch: async (url, options) => {
    if (String(url).startsWith('https://zapsign.s3.amazonaws.com/')) return new Response(new Uint8Array(bytes));
    assert.match(String(url), /^https:\/\/sandbox.zapsign.com.br\/api\/v1\/docs\//);
    if (options?.method === 'POST') {
      posts++; const body = JSON.parse(String(options.body)); assert.equal(body.base64_pdf, bytes.toString('base64'));
      remote = { token: providerToken, external_id: body.external_id, sandbox: true, status: 'pending', deleted: false, original_file: 'https://zapsign.s3.amazonaws.com/original.pdf', signed_file: null,
        signers: [{ token: signerToken, name: 'Maria Assinaturas', email, auth_mode: 'assinaturaTela-tokenEmail', status: 'new', signed_at: null, sign_url: `https://sandbox.app.zapsign.com.br/verificar/${signerToken}` }] };
    }
    assert.ok(remote); return Response.json(remote);
  } };
  // Only the external provider is simulated. UI actions run the production service against the QA database and storage.
  await officePage.route(`**/api/signatures/manage/${clientId}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = z.object({ operation: z.literal('request'), fileId: z.string().uuid(), method: z.enum(['email','certificate']), idempotencyKey: z.string().uuid() }).parse(route.request().postDataJSON());
    const result = await service.requestSignature(context, { ...input, clientId }, transport);
    await route.fulfill({ json: result });
  });
  await officePage.goto(`/app/agenda/clients/${clientId}`);
  await officePage.getByLabel('PDF publicado para assinatura (até 10 MB)', { exact: true }).selectOption(fileId);
  await officePage.getByRole('button', { name: 'Enviar PDF para assinatura', exact: true }).click();
  await expect(officePage.getByText('Aguardando assinatura · Código por e-mail · Ambiente de teste', { exact: true })).toBeVisible(); assert.equal(posts, 1);
  assert.equal((await office.request.post(`/api/signatures/manage/${clientId}`, { headers: { origin: 'https://other.test' }, data: { operation: 'request', fileId, method: 'email', idempotencyKey: randomUUID() } })).status(), 403);
  await clientPage.reload(); await expect(clientPage.getByRole('link', { name: 'Assinar na ZapSign', exact: true })).toBeVisible();
  assert.equal(await clientPage.getByRole('link', { name: 'Assinar na ZapSign', exact: true }).getAttribute('href'), `https://sandbox.app.zapsign.com.br/verificar/${signerToken}`);
  const clientSession = z.object({ user: z.object({ id: z.string() }), session: z.object({ id: z.string() }) }).parse(await (await client.request.get('/api/auth/get-session')).json());
  const clientContext = { userId: clientSession.user.id, sessionId: clientSession.session.id }, accessId = invited.access.id;
  await clientPage.route(`**/api/signatures/client/${accessId}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = z.object({ id: z.string().uuid() }).parse(route.request().postDataJSON());
    const result = await service.refreshClientSignature(clientContext, accessId, input.id, transport); await route.fulfill({ json: result });
  });
  remote = { ...z.record(z.string(), z.unknown()).parse(remote), status: 'signed', signed_file: 'https://zapsign.s3.amazonaws.com/signed.pdf', signers: [{ token: signerToken, name: 'Maria Assinaturas', email, auth_mode: 'assinaturaTela-tokenEmail', status: 'signed', signed_at: '2026-09-29T18:00:00Z' }] };
  await clientPage.getByRole('button', { name: 'Atualizar assinatura', exact: true }).focus(); await clientPage.keyboard.press('Enter');
  await expect(clientPage.getByRole('link', { name: 'Baixar PDF assinado', exact: true })).toBeVisible();
  const signedURL = await clientPage.getByRole('link', { name: 'Baixar PDF assinado', exact: true }).getAttribute('href'); assert.ok(signedURL);
  const downloaded = await client.request.get(signedURL); assert.equal(downloaded.status(), 200); assert.deepEqual(await downloaded.body(), bytes); assert.match(downloaded.headers()['cache-control'], /no-store/);
  const evidenceURL = await clientPage.getByRole('link', { name: 'Baixar evidências', exact: true }).getAttribute('href'); assert.ok(evidenceURL);
  assert.equal((await client.request.get(evidenceURL)).status(), 200);
  await expect(clientPage.getByRole('link', { name: 'assine no gov.br', exact: true })).toHaveAttribute('href', 'https://assinador.iti.br/');
  await clientPage.screenshot({ path: `${output}/cliente-desktop.png`, fullPage: true });
  await clientPage.setViewportSize({ width: 390, height: 844 }); await clientPage.screenshot({ path: `${output}/cliente-mobile.png`, fullPage: true });
  assert.equal(await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await officePage.getByRole('button', { name: 'Atualizar lista de assinaturas', exact: true }).click();
  await expect(officePage.getByRole('link', { name: 'Baixar PDF assinado', exact: true })).toBeVisible();
  await officePage.screenshot({ path: `${output}/escritorio-desktop.png`, fullPage: true });
  await officePage.setViewportSize({ width: 390, height: 844 }); await officePage.getByRole('heading', { name: 'Assinaturas', exact: true }).scrollIntoViewIfNeeded();
  await officePage.screenshot({ path: `${output}/escritorio-mobile.png`, fullPage: true }); assert.equal(await officePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await officePage.getByRole('button', { name: 'Revogar acesso ao portal', exact: true }).click();
  await expect(officePage.getByText('Acesso e convite revogados.', { exact: true })).toBeVisible(); assert.equal((await client.request.get(signedURL)).status(), 404);
  assert.deepEqual(errors, []);
  console.log('Assinaturas verificadas: configuração, solicitação sem duplicidade, portal, confirmação, PDF e evidências privados, gov.br manual, teclado, desktop e celular. Transporte ZapSign simulado.');
} catch (error) { await clientPage.screenshot({ path: `${output}/falha-cliente.png`, fullPage: true }); await officePage.screenshot({ path: `${output}/falha-escritorio.png`, fullPage: true }); throw error; }
finally { await office.close(); await client.close(); await browser.close(); await database.close(); }
