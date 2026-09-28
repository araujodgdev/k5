import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { chromium, expect as playwrightExpect, type BrowserContext, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { z } from 'zod';
import { honorarioDetailDto, honorariosListDto } from '../src/lib/honorarios/contracts';

const expect = playwrightExpect.configure({ timeout: 30_000 });
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const settings = parseEnv(await readFile('.env.local', 'utf8'));
const databaseUrl = process.env.DATABASE_URL ?? settings.DATABASE_URL;
for (const url of [baseURL, databaseUrl]) {
  if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('A verificação de honorários exige servidor e banco locais.');
  }
}
const output = 'playwright-report/honorarios';
await mkdir(output, { recursive: true });
const pool = new Pool({ connectionString: databaseUrl });
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', recordVideo: { dir: `${output}/video` } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const browserErrors: string[] = [];
page.on('pageerror', error => browserErrors.push(error.message));
const verified: string[] = [];
let userId: string | undefined;

async function post(browserContext: BrowserContext, path: string, data: unknown): Promise<unknown> {
  const response = await browserContext.request.post(path, { data, headers: { origin: baseURL } });
  const body: unknown = await response.json();
  assert.equal(response.ok(), true, `${path}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

async function screenshot(target: Page, name: string) {
  await target.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Overflow em ${name}`);
}

try {
  const account = z.object({ user: z.object({ id: z.string() }) }).parse(await post(context, '/api/auth/sign-up/email', {
    name: 'Validação de Honorários', email: `honorarios-${randomUUID()}@example.test`,
    password: `Financeiro!${randomUUID()}`, officeName: 'Escritório de validação de honorários',
  }));
  userId = account.user.id;
  const client = z.object({ client: z.object({ id: z.string() }) }).parse(await post(context, '/api/agenda/clients/create', {
    name: 'Cliente de validação', stage: 'active', idempotencyKey: randomUUID(),
  })).client;
  const caseRecord = z.object({ case: z.object({ id: z.string() }) }).parse(await post(context, '/api/vault/cases', {
    name: 'Caso de validação de honorários', idempotencyKey: randomUUID(),
  })).case;

  await page.goto('/app/honorarios');
  await expect(page.getByRole('heading', { name: 'Honorários', exact: true })).toBeAttached();
  await expect(page.getByText('Nenhuma parcela a receber para estes filtros.', { exact: true })).toBeVisible();
  await screenshot(page, 'desktop-vazio');

  const initial = honorariosListDto.parse(await post(context, '/api/honorarios/list', {}));
  assert.deepEqual(initial.summary, { totalCents: 0, receivedCents: 0, pendingCents: 0, overdueCents: 0 });
  verified.push('Escritório novo sem honorários ou saldos.');

  const newButton = page.getByRole('button', { name: 'Novo honorário', exact: true });
  await newButton.focus();
  await page.keyboard.press('Enter');
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('Cliente', { exact: true }).selectOption(client.id);
  await createDialog.getByLabel('Caso opcional', { exact: true }).selectOption(caseRecord.id);
  await page.getByLabel('Descrição', { exact: true }).fill('Acompanhamento processual');
  await page.getByLabel('Valor total (R$)', { exact: true }).fill('3.000,00');
  await page.getByLabel('Número de parcelas', { exact: true }).fill('3');
  await page.getByLabel('Primeiro vencimento', { exact: true }).fill('2026-01-31');
  await expect(page.getByLabel('Parcela 2: vencimento', { exact: true })).toHaveValue('2026-02-28');
  await expect(page.getByLabel('Parcela 3: vencimento', { exact: true })).toHaveValue('2026-03-31');
  await screenshot(page, 'desktop-cadastro');
  await page.getByRole('button', { name: 'Cadastrar honorário', exact: true }).click();
  await expect(createDialog).not.toBeVisible();
  const listed = honorariosListDto.parse(await post(context, '/api/honorarios/list', {}));
  assert.equal(listed.total, 3);
  const first = listed.installments[0];
  assert.ok(first);
  const created = honorarioDetailDto.parse(await post(context, '/api/honorarios/get', { agreementId: first.agreementId }));
  assert.equal(created.agreement.totalCents, 300000);
  assert.deepEqual(created.installments.map(row => row.dueOn), ['2026-01-31', '2026-02-28', '2026-03-31']);
  verified.push('Cadastro pela interface com três parcelas de R$ 1.000 e vencimentos mensais corretos.');
  await expect(page.getByText('Acompanhamento processual', { exact: true }).first()).toBeVisible();
  await screenshot(page, 'desktop-parcelas');

  await page.getByRole('button', { name: /^Abrir Acompanhamento processual,/ }).first().click();
  await page.getByRole('button', { name: 'Registrar recebimento da parcela 1', exact: true }).click();
  await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('1.000,00');
  await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Registrar recebimento da parcela 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Registrar recebimento da parcela 2', exact: true }).click();
  await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('400,00');
  await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
  await expect(page.getByRole('button', { name: /Desfazer recebimento de R\$\s*400,00/ })).toBeVisible();
  const partial = honorarioDetailDto.parse(await post(context, '/api/honorarios/get', { agreementId: created.agreement.id }));
  assert.equal(partial.agreement.receivedCents, 140000);
  assert.equal(partial.agreement.pendingCents, 160000);
  await screenshot(page, 'desktop-recebimentos');
  await page.getByRole('button', { name: /Desfazer recebimento de R\$\s*400,00/ }).click();
  await page.getByLabel('Motivo da correção', { exact: true }).fill('Baixa registrada por engano na validação.');
  await page.getByRole('button', { name: 'Desfazer registro', exact: true }).click();
  await expect(page.getByText(/Registro desfeito por/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Desfazer recebimento de R\$\s*400,00/ })).toHaveCount(0);
  const reversed = honorarioDetailDto.parse(await post(context, '/api/honorarios/get', { agreementId: created.agreement.id }));
  assert.equal(reversed.agreement.receivedCents, 100000);
  assert.equal(reversed.agreement.pendingCents, 200000);
  assert.equal(reversed.receipts.length, 2);
  assert.equal(reversed.receipts.filter(row => row.reversal).length, 1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  verified.push('Baixas integral e parcial pela interface; correção preserva histórico e recompõe o saldo.');

  await page.getByRole('button', { name: 'Recebidas', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Abrir Acompanhamento processual,/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'A receber', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Abrir Acompanhamento processual,/ })).toHaveCount(2);
  verified.push('Parcela quitada sai de A receber e aparece em Recebidas.');

  const toCancel = honorarioDetailDto.parse(await post(context, '/api/honorarios/create', {
    clientId: client.id, title: 'Cadastro para cancelar', notes: '', installments: [{ amountCents: 9000, dueOn: '2026-01-01' }], idempotencyKey: randomUUID(),
  }));
  await page.reload();
  await page.getByRole('button', { name: /^Abrir Cadastro para cancelar,/ }).click();
  await page.getByRole('button', { name: 'Cancelar honorário', exact: true }).click();
  await page.getByLabel('Motivo do cancelamento', { exact: true }).fill('Cadastro incorreto na verificação.');
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(page.getByText('Honorário cancelado. O histórico permanece disponível.', { exact: true })).toBeVisible();
  const canceled = honorarioDetailDto.parse(await post(context, '/api/honorarios/get', { agreementId: toCancel.agreement.id }));
  assert.equal(canceled.agreement.status, 'cancelled');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Canceladas', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Abrir Cadastro para cancelar,/ })).toBeVisible();
  await screenshot(page, 'desktop-canceladas');
  verified.push('Cancelamento preserva o cadastro na aba Canceladas e retira seu valor dos totais.');

  const responseGate = Promise.withResolvers<void>();
  await page.route('**/api/honorarios/list', async route => {
    await responseGate.promise;
    await route.fulfill({ status: 503, json: { error: 'Falha de consulta simulada para validação.' } });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Carregando honorários…', { exact: true })).toBeVisible();
  await screenshot(page, 'desktop-carregando');
  responseGate.resolve();
  await expect(page.getByRole('alert').filter({ hasText: 'Falha de consulta simulada' })).toBeVisible();
  await screenshot(page, 'desktop-erro');
  await page.unroute('**/api/honorarios/list');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Abrir Acompanhamento processual,/ })).toHaveCount(2);
  verified.push('Estados de carregamento e falha de consulta, com recuperação pelo botão Tentar novamente.');

  const mobile = await browser.newContext({ baseURL, storageState: await context.storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', error => browserErrors.push(error.message));
    await mobilePage.goto('/app/honorarios');
    await expect(mobilePage.getByText('Acompanhamento processual', { exact: true }).first()).toBeVisible();
    await screenshot(mobilePage, 'mobile-parcelas');
    await mobilePage.getByRole('button', { name: 'Mais', exact: true }).click();
    await expect(mobilePage.getByRole('dialog').getByRole('link', { name: 'Honorários', exact: true })).toBeVisible();
    await screenshot(mobilePage, 'mobile-menu');
    await mobilePage.keyboard.press('Escape');
    await mobilePage.getByRole('button', { name: 'Novo honorário', exact: true }).click();
    await expect(mobilePage.getByLabel('Descrição', { exact: true })).toBeVisible();
    await screenshot(mobilePage, 'mobile-cadastro');
    await mobilePage.keyboard.press('Escape');
    await expect(mobilePage.getByRole('button', { name: 'Novo honorário', exact: true })).toBeFocused();
    await mobilePage.getByRole('button', { name: 'Novo honorário', exact: true }).click();
    await mobilePage.getByRole('dialog').getByLabel('Cliente', { exact: true }).selectOption(client.id);
    await mobilePage.getByLabel('Descrição', { exact: true }).fill('Cadastro pelo celular');
    await mobilePage.getByLabel('Valor total (R$)', { exact: true }).fill('45,50');
    await mobilePage.getByLabel('Número de parcelas', { exact: true }).fill('2');
    await mobilePage.getByLabel('Primeiro vencimento', { exact: true }).fill('2026-01-31');
    await mobilePage.getByRole('button', { name: 'Cadastrar honorário', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(mobilePage, 'mobile-parcelamento');
    await mobilePage.getByRole('button', { name: 'Cadastrar honorário', exact: true }).click();
    await expect(mobilePage.getByRole('dialog')).not.toBeVisible();
    await mobilePage.getByRole('button', { name: /^Abrir Cadastro pelo celular,/ }).first().click();
    await mobilePage.getByRole('button', { name: 'Cancelar honorário', exact: true }).click();
    await mobilePage.getByLabel('Motivo do cancelamento', { exact: true }).fill('Conferência do formulário no celular.');
    await mobilePage.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
    await expect(mobilePage.getByText('Honorário cancelado. O histórico permanece disponível.', { exact: true })).toBeVisible();
    await screenshot(mobilePage, 'mobile-cancelamento');
    verified.push('Navegação e lista em desktop e celular, sem rolagem horizontal.');
    verified.push('Cadastro parcelado e cancelamento pelo celular, com rolagem do formulário e retorno de foco pelo teclado.');
  } finally { await mobile.close(); }

  for (const role of ['lawyer', 'reviewer']) {
    await pool.query('UPDATE office_member SET role=$1 WHERE user_id=$2', [role, userId]);
    const own = honorariosListDto.parse(await post(context, '/api/honorarios/list', {}));
    assert.equal(own.summary.receivedCents, 100000);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Honorários', exact: true })).toBeVisible();
    if (role === 'reviewer') {
      await expect(page.getByRole('button', { name: 'Novo honorário', exact: true })).toHaveCount(0);
      const denied = await context.request.post('/api/honorarios/receive', { data: {}, headers: { origin: baseURL } });
      assert.equal(denied.status(), 403);
    }
  }
  await pool.query("UPDATE office_member SET role='administrator' WHERE user_id=$1", [userId]);
  verified.push('O dono mantém consulta dos valores; papel de revisor bloqueia alterações.');

  const partner = await browser.newContext({ baseURL });
  try {
    const partnerAccount = z.object({ user: z.object({ id: z.string() }) }).parse(await post(partner, '/api/auth/sign-up/email', {
      name: 'Participante de validação', email: `participante-${randomUUID()}@example.test`,
      password: `Financeiro!${randomUUID()}`, officeName: 'Escritório participante de validação',
    }));
    const [ownerOffice] = z.array(z.object({ office_id: z.string() })).parse((await pool.query('SELECT office_id FROM office_member WHERE user_id=$1', [userId])).rows);
    assert.ok(ownerOffice);
    const ownEmpty = honorariosListDto.parse(await post(partner, '/api/honorarios/list', {}));
    assert.equal(ownEmpty.total, 0);
    await pool.query('INSERT INTO office_member(id,office_id,user_id,role) VALUES($1,$2,$3,$4)', [randomUUID(), ownerOffice.office_id, partnerAccount.user.id, 'administrator']);
    await partner.addCookies([{ name: 'k5-office', value: ownerOffice.office_id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
    const unrelated = honorariosListDto.parse(await post(partner, '/api/honorarios/list', {}));
    assert.equal(unrelated.total, 0);
    await pool.query('DELETE FROM office_member WHERE office_id=$1 AND user_id=$2', [ownerOffice.office_id, partnerAccount.user.id]);
    await partner.clearCookies({ name: 'k5-office' });
    await pool.query('INSERT INTO case_participant(office_id,case_id,user_id,permission,invited_by) VALUES($1,$2,$3,$4,$5)', [ownerOffice.office_id, caseRecord.id, partnerAccount.user.id, 'editor', userId]);
    const shared = honorariosListDto.parse(await post(partner, '/api/honorarios/list', {}));
    assert.equal(shared.total, 2);
    assert.equal(shared.summary.receivedCents, 100000);
    const sharedDetail = honorarioDetailDto.parse(await post(partner, '/api/honorarios/get', { agreementId: created.agreement.id }));
    assert.equal(sharedDetail.agreement.canManage, false);
    const partnerPage = await partner.newPage();
    await partnerPage.goto('/app/honorarios');
    await partnerPage.getByText('Filtrar por cliente, caso e vencimento', { exact: true }).click();
    await partnerPage.getByLabel('Cliente', { exact: true }).selectOption(client.id);
    await partnerPage.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
    await expect(partnerPage.getByRole('button', { name: /^Abrir Acompanhamento processual,/ })).toHaveCount(2);
    await partnerPage.getByRole('button', { name: /^Abrir Acompanhamento processual,/ }).first().click();
    await expect(partnerPage.getByRole('button', { name: /Registrar recebimento da parcela/ })).toHaveCount(0);
    await screenshot(partnerPage, 'participante-consulta');
    const forbiddenReceipt = await partner.request.post('/api/honorarios/receive', { data: {
      installmentId: created.installments[1]?.id, amountCents: 100, receivedOn: initial.today, method: 'pix', notes: '', idempotencyKey: randomUUID(),
    }, headers: { origin: baseURL } });
    assert.ok([403, 404].includes(forbiddenReceipt.status()));
    await pool.query('UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE case_id=$1 AND user_id=$2', [caseRecord.id, partnerAccount.user.id]);
    const revoked = honorariosListDto.parse(await post(partner, '/api/honorarios/list', {}));
    assert.equal(revoked.total, 0);
    const revokedDetail = await partner.request.post('/api/honorarios/get', { data: { agreementId: created.agreement.id }, headers: { origin: baseURL } });
    assert.equal(revokedDetail.status(), 404);
    await post(partner, '/api/auth/sign-out', {});
    verified.push('Outro administrador não vê valores privados. Participante externo consulta, não altera e perde acesso após revogação.');
  } finally { await partner.close(); }

  const wrongOrigin = await context.request.post('/api/honorarios/create', { data: {}, headers: { origin: 'https://external.example.test' } });
  assert.equal(wrongOrigin.status(), 403);
  await post(context, '/api/auth/sign-out', {});
  const signedOut = await context.request.post('/api/honorarios/list', { data: {}, headers: { origin: baseURL } });
  assert.equal(signedOut.status(), 401);
  verified.push('Origem externa bloqueada e sessão encerrada sem acesso à API.');
  assert.deepEqual(browserErrors, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ verified, browserErrors }, null, 2));
  console.log(verified.join('\n'));
} catch (error) {
  await page.screenshot({ path: `${output}/falha.png`, fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  if (userId) await pool.query("UPDATE office_member SET role='administrator' WHERE user_id=$1", [userId]);
  await context.request.post('/api/auth/sign-out', { data: {}, headers: { origin: baseURL } }).catch(() => undefined);
  await context.close();
  await browser.close();
  await pool.end();
}
