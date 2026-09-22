import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.BASE_URL ?? '';
const caseId = process.env.RESEARCH_QA_CASE_ID ?? '';
if (baseURL !== 'http://localhost:3001' || !/^[0-9a-f-]{36}$/.test(caseId)) {
  throw new Error('Este roteiro exige servidor local QA na porta 3001 e caseId explícito.');
}

const output = 'playwright-report/research-draft';
const expect = baseExpect.configure({ timeout: 30000 });
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL, viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce',
  recordVideo: { dir: output, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text().startsWith('A tree hydrated') ? 'React hydration mismatch' : message.text().split('\n')[0].slice(0, 160));
});
const report: Record<string, unknown> = { baseURL, mode: 'synthetic-draft', checks: [] as string[] };
const checks = report.checks as string[];
const snapshot = (name: string) => page.screenshot({ path: `${output}/${name}.png` });

try {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill('admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.PWA_TEST_PASSWORD ?? 'SenhaForte123!@#456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/app/**');

  const referencesResponse = await context.request.get(`/api/research/cases/${caseId}/references`);
  expect(referencesResponse.status()).toBe(200);
  const referencesPayload = await referencesResponse.json() as {
    references: Array<{ id: string; materialVersionId: string; material?: { title?: string } }>;
  };
  const pinned = referencesPayload.references.find(reference => reference.material?.title?.includes('AMOSTRA DE TESTE · Julgado 01'));
  expect(pinned?.materialVersionId).toBeTruthy();
  checks.push('caso e versão fixada sintéticos confirmados pelo serviço autenticado');

  await page.goto(`/app/vault/cases/${caseId}?section=references`);
  await expect(page.getByRole('region', { name: 'Referências do caso' })).toContainText('Julgado 01');
  await page.getByRole('button', { name: 'Preparar minuta' }).click();
  const draft = page.getByRole('dialog', { name: 'Preparar minuta' });
  await draft.getByRole('checkbox', { name: /Julgado 01/ }).check();
  await draft.getByLabel('Modelo de minuta').selectOption({ label: 'AMOSTRA_DE_TESTE_modelo_minuta.txt' });
  await draft.getByRole('textbox', { name: 'Pedido da minuta' }).fill('AMOSTRA DE TESTE: redija um resumo curto da questão jurídica fictícia.');
  await draft.getByRole('button', { name: 'Revisar citações' }).click();
  const citations = draft.getByRole('group', { name: 'Citações que você autoriza' });
  await expect(citations.getByText(/Inteiro teor · trecho 1/)).toBeVisible();
  await citations.getByRole('checkbox').first().check();
  await snapshot('01-citacao-aprovada');
  checks.push('citação individual aprovada e rótulo legível');

  await draft.getByRole('button', { name: 'Criar minuta' }).click();
  const queued = draft.getByRole('link', { name: 'Acompanhar minuta' });
  await queued.waitFor({ state: 'visible', timeout: 20000 });
  await queued.click();
  await page.waitForURL('**/app/research/drafts/**');
  report.runId = new URL(page.url()).pathname.split('/').at(-1);
  await snapshot('02-minuta-na-fila');
  await expect(page.getByText(/Minuta pronta para revisão\.|Não foi possível concluir\./)).toBeVisible({ timeout: 180000 });
  if (await page.getByText(/Não foi possível concluir\./).isVisible()) {
    await snapshot('03-minuta-falhou');
    throw new Error('Worker concluiu a tentativa com estado de falha; não há artefato validado.');
  }
  await snapshot('03-minuta-pronta');
  await page.getByRole('link', { name: 'Abrir minuta' }).click();
  await page.waitForURL('**/app/documents/**');
  const artifactId = new URL(page.url()).pathname.split('/').at(-1);
  await expect(page.getByRole('region', { name: 'Editor' })).toBeVisible();
  await snapshot('04-artefato');
  checks.push('worker concluiu run e abriu artefato no editor');

  const artifactResponse = await context.request.get(`/api/artifacts/${artifactId}`);
  expect(artifactResponse.status()).toBe(200);
  const artifactPayload = await artifactResponse.json() as {
    artifact?: { references?: Array<{ id: string; sourceType?: string; materialVersionId?: string; researchReferenceId?: string }> };
  };
  const sourceRef = artifactPayload.artifact?.references?.find(reference => reference.sourceType === 'research' && reference.researchReferenceId === pinned?.id);
  expect(sourceRef?.id).toBeTruthy();
  expect(sourceRef?.materialVersionId).toBe(pinned?.materialVersionId);
  const sourceResponse = await context.request.get(`/api/artifacts/${artifactId}/sources/${sourceRef?.id}`);
  expect(sourceResponse.status()).toBe(200);
  expect(sourceResponse.headers()['cache-control']).toContain('private, no-store');
  const sourcePayload = await sourceResponse.json() as { source?: { materialVersionId: string; text: string } };
  expect(sourcePayload.source?.materialVersionId).toBe(pinned?.materialVersionId);
  expect(sourcePayload.source?.text).toContain('AMOSTRA DE TESTE');
  report.artifactId = artifactId;
  report.pinnedVersionId = pinned?.materialVersionId;
  checks.push('fonte histórica resolvida por endpoint privado na versão aprovada');

  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/sign-in');
  checks.push('logout UI ao final');
  expect(pageErrors).toEqual([]);
} catch (error) {
  await snapshot('falha').catch(() => undefined);
  report.failure = error instanceof Error ? error.message.split('\n').slice(0, 4).join(' ') : String(error);
  throw error;
} finally {
  await context.close();
  report.video = await page.video()?.path();
  report.pageErrors = pageErrors;
  report.consoleErrors = consoleErrors;
  console.log(JSON.stringify(report));
  await browser.close();
}
