import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { Pool } from 'pg';
import { z } from 'zod';
import { honorarioDetailDto } from '../src/lib/honorarios/contracts';

const expect = playwrightExpect.configure({ timeout: 30_000 });
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const settings = parseEnv(await readFile('.env.local', 'utf8'));
const databaseUrl = process.env.DATABASE_URL ?? settings.DATABASE_URL;
for (const url of [baseURL, databaseUrl]) {
  if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Use servidor e banco locais.');
}
const output = 'playwright-report/agent-modules';
await mkdir(output, { recursive: true });
const pool = new Pool({ connectionString: databaseUrl });
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
async function post(path: string, data: unknown) {
  const response = await context.request.post(path, { data, headers: { origin: baseURL } });
  const body: unknown = await response.json();
  assert.equal(response.ok(), true, `${path}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}
async function propose(name: string, input: unknown) {
  const response = await context.request.post(`/api/capabilities/${name}`, { data: input, headers: { origin: baseURL } });
  const body = z.object({ code: z.literal('APPROVAL_REQUIRED'), error: z.string() }).parse(await response.json());
  assert.equal(response.ok(), false);
  const id = body.error.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  assert.ok(id); return id;
}
try {
  const account = z.object({ user: z.object({ id: z.string() }) }).parse(await post('/api/auth/sign-up/email', {
    name: 'Validação do agente', email: `agent-modules-${randomUUID()}@example.test`, password: `Agente!${randomUUID()}`, officeName: 'Validação local do agente',
  }));
  const client = z.object({ client: z.object({ id: z.string() }) }).parse(await post('/api/agenda/clients/create', { name: 'Simons de teste', stage: 'active' })).client;
  const created = honorarioDetailDto.parse(await post('/api/capabilities/k5_honorarios_create', {
    clientId: client.id, title: 'Contrato sintético', installments: [{ amountCents: 5000, dueOn: '2024-01-10' }, { amountCents: 5000, dueOn: '2024-02-10' }], idempotencyKey: randomUUID(),
  }));
  const paid = honorarioDetailDto.parse(await post('/api/capabilities/k5_honorarios_receive', {
    installmentId: created.installments[1].id, amountCents: 5000, receivedOn: '2024-03-01', method: 'pix', idempotencyKey: randomUUID(),
  }));
  assert.equal(paid.installments[0].status, 'pending'); assert.equal(paid.installments[1].status, 'received');
  const approvalId = await propose('k5_honorarios_reverse', { receiptId: paid.receipts[0].id, reason: 'Lançamento de teste duplicado', idempotencyKey: randomUUID() });
  const { conversation } = z.object({ conversation: z.object({ id: z.string() }) }).parse(await post('/api/conversations', { title: 'Confirmações de validação' }));
  async function showProposal(id: string, capability: string, summary: string) {
    const messages = [{ id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: 'Confira a ação solicitada.' }, { type: 'data-approval', id, data: { approvalId: id, capability, summary, state: 'pending' } }] }];
    await pool.query('UPDATE ai_conversation SET messages=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify(messages), conversation.id, account.user.id]);
    await page.goto('/app/agents');
    await expect(page.getByRole('group', { name: 'Confirmação', exact: true })).toBeVisible();
  }
  await showProposal(approvalId, 'k5_honorarios_reverse', 'Estornar R$ 50,00 da parcela 2 de Simons de teste “Contrato sintético”. Motivo: Lançamento de teste duplicado');
  const confirm = page.getByRole('button', { name: 'Confirmar', exact: true });
  await expect(confirm).toBeEnabled(); await confirm.focus();
  await page.screenshot({ path: `${output}/desktop-pendente.png`, fullPage: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Confirmação', exact: true })).toContainText('Confirmado');
  assert.equal(honorarioDetailDto.parse(await post('/api/honorarios/get', { agreementId: created.agreement.id })).agreement.receivedCents, 0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${output}/desktop-confirmado.png`, fullPage: true });

  const cancelled = await propose('k5_honorarios_cancel', { agreementId: created.agreement.id, reason: 'Teste de cancelamento', idempotencyKey: randomUUID() });
  await page.setViewportSize({ width: 390, height: 844 });
  await showProposal(cancelled, 'k5_honorarios_cancel', 'Cancelar o honorário “Contrato sintético” de Simons de teste e suas parcelas.\nMotivo: Teste de cancelamento');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: `${output}/mobile-pendente.png`, fullPage: true });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Confirmação', exact: true })).toContainText('Cancelado');
  assert.equal(honorarioDetailDto.parse(await post('/api/honorarios/get', { agreementId: created.agreement.id })).agreement.status, 'active');
  const help = z.object({ sources: z.array(z.object({ title: z.string() })) }).parse(await post('/api/capabilities/k5_help_search', { query: 'registrar recebimento honorários' }));
  assert.ok(help.sources.some(source => /recebimento/.test(source.title)));
  const forbidden = await context.request.post('/api/capabilities/k5_google_save_policy', { data: {}, headers: { origin: baseURL } });
  assert.equal(forbidden.status(), 403);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ checks: ['segunda parcela recebida sem alterar primeira', 'confirmação via teclado e persistência após reload', 'cancelamento mobile sem efeito financeiro', 'manual consultado pela API autenticada', 'administração de integração bloqueada'], errors }, null, 2));
  console.log('PASS: operações, confirmações desktop/mobile, ajuda e bloqueio de Integrações.');
} catch (error) {
  await page.screenshot({ path: `${output}/falha.png`, fullPage: true }).catch(() => undefined); throw error;
} finally {
  await context.request.post('/api/auth/sign-out', { data: {}, headers: { origin: baseURL } }).catch(() => undefined);
  await context.close(); await browser.close(); await pool.end();
}
