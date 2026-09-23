import { chromium, expect } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Optional live smoke check: uses the office's configured model, real persistence and DOCX export.
const output = resolve('playwright-report/pr11-live');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
  recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
try {
  await page.goto(`${baseURL}/sign-in`);
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL ?? 'admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
  await page.goto(`${baseURL}/app/agents`);
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  const conversation = await (await created).json();
  await page.goto(`${baseURL}/app/agents?conversationId=${conversation.conversation?.id ?? conversation.id}`);
  await page.getByRole('textbox', { name: 'Pergunte ao Lume' }).fill('Crie um documento chamado Validação do editor: um comunicado fictício e breve sobre organização do escritório, sem citar leis ou processos, com dois parágrafos e uma tabela de duas tarefas. É apenas um teste de edição e exportação.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const editor = page.getByRole('textbox', { name: 'Texto do documento' });
  await expect(editor).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('button', { name: 'Parar resposta' })).toHaveCount(0, { timeout: 180_000 });
  console.log('PASS: live model created a document beside the conversation.');
  await page.screenshot({ path: resolve(output, 'desktop.png') });

  await editor.press('ControlOrMeta+Home');
  await editor.press('Enter');
  await editor.press('ControlOrMeta+Home');
  await editor.pressSequentially('Trecho de validação do salvamento.');
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await editor.press('ControlOrMeta+s');
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  const artifactId = new URL(page.url()).searchParams.get('doc');
  const stored = await context.request.get(`${baseURL}/api/artifacts/${artifactId}`);
  expect(stored.ok()).toBe(true);
  expect((await stored.json()).artifact.content).toContain('Trecho de validação do salvamento.');
  console.log('PASS: editor text persisted through the real API.');

  const divider = page.getByRole('separator', { name: 'Largura da conversa' });
  await divider.focus();
  await divider.press('ArrowRight');
  await divider.press('Home');
  await divider.press('End');
  await divider.dblclick();
  await page.getByRole('tab', { name: 'Página', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
  await page.screenshot({ path: resolve(output, 'page-preview.png') });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar DOCX', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(resolve(output, 'documento.docx'));
  console.log('PASS: page preview and DOCX export.');

  await page.getByRole('tab', { name: 'Editar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toContainText('Trecho de validação do salvamento.');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#document-panel'))).toBe(true);
  await page.screenshot({ path: resolve(output, 'mobile.png') });
  await page.getByRole('button', { name: 'Voltar à conversa', exact: true }).click();
  await expect(page.locator('#document-panel')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  console.log('PASS: mobile focus, safe close and final UI logout.');
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally {
  await context.close();
  const video = await page.video()?.path();
  if (video) console.log(`Video: ${video} (${(await stat(video)).size} bytes)`);
  await browser.close();
}
