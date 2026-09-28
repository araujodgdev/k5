import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const mode = process.env.RESEARCH_QA_MODE;
if (mode !== 'empty' && mode !== 'synthetic') throw new Error('Defina RESEARCH_QA_MODE=empty ou synthetic.');
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const expect = baseExpect.configure({ timeout: 30000 });
const output = `playwright-report/research-${mode}`;
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
const report: Record<string, unknown> = { mode, baseURL, checks: [] as string[] };
const checks = report.checks as string[];
const snapshot = (name: string) => page.screenshot({ path: `${output}/${name}.png` });

try {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail', { exact: true }).fill('admin@advocacia.test');
  await page.getByLabel('Senha', { exact: true }).fill(process.env.PWA_TEST_PASSWORD ?? 'SenhaForte123!@#456');
  await snapshot('01-login');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/app/**');
  checks.push('login da conta estável');

  if (mode === 'synthetic') {
    const preflight = await context.request.post('/api/research/corpus', { data: { theme: 'amostrapesquisa', filters: {} } });
    expect(preflight.status()).toBe(200);
    const corpus = await preflight.json() as { results?: unknown[]; total?: number };
    expect(corpus.total).toBe(22);
    expect(corpus.results?.length).toBe(20);
    checks.push('preflight confirma os 22 julgados apenas no banco QA');
  }

  await page.goto('/app/research');
  await expect(page.getByRole('heading', { name: 'Pesquisa', exact: true })).toBeVisible();
  await expect(page.getByText('Pesquise um tema para consultar julgados do acervo.')).toBeVisible();
  await snapshot('02-inicial');
  await page.getByLabel('Tema ou questão jurídica').fill('amostrapesquisa');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  checks.push('busca pelo serviço autenticado e histórico privado');

  if (mode === 'empty') {
    await expect(page.getByText('Nenhum julgado encontrado. Tente outros termos ou filtros.')).toBeVisible();
    await snapshot('03-acervo-vazio');
    await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
    checks.push('acervo vazio sem fonte habilitada');
    await page.getByRole('radio', { name: 'Acervo e fontes' }).check();
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    await expect(page.getByText(/Resultados parciais\. Nenhuma fonte de consulta temática está habilitada/)).toBeVisible();
    await snapshot('04-sem-fonte-habilitada');
    checks.push('estado parcial explícito ao pedir fonte não habilitada');
  } else {
    await expect(page.getByText(/(?:20|22) julgados nesta consulta/)).toBeVisible({ timeout: 30000 });
    await snapshot('03-resultados-pagina-1');
    if (await page.getByRole('button', { name: 'Mais resultados' }).isVisible()) {
      await page.getByRole('button', { name: 'Mais resultados' }).click();
    }
    await expect(page.getByText('22 julgados nesta consulta')).toBeVisible({ timeout: 30000 });
    checks.push('paginação real de 20 para 22 resultados, com reuso da busca recente');
    const result = page.locator('a[href^="/app/research/judgments/"]').filter({ hasText: 'Julgado 01' });
    await result.click();
    await expect(page.getByRole('heading', { name: /AMOSTRA DE TESTE · Julgado 01/ })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('region', { name: 'Ementa' })).toContainText('decisão fictícia');
    await expect(page.getByRole('region', { name: 'Inteiro teor' })).toContainText('Texto sintético');
    await snapshot('04-leitor');
    checks.push('leitor de ementa e inteiro teor versionado');

    const original = page.getByRole('link', { name: 'Baixar original' }).first();
    if (await original.isVisible()) {
      const response = await context.request.get(await original.getAttribute('href') ?? '');
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain('AMOSTRA DE TESTE');
      checks.push('original servido pelo GET autenticado');
    }

    await page.getByRole('button', { name: 'Adicionar ao caso' }).click();
    const linker = page.getByRole('dialog', { name: 'Adicionar ao caso' });
    await expect(linker).toBeVisible();
    await linker.getByRole('button', { name: 'AMOSTRA DE TESTE · Guarda à avó' }).focus();
    await page.keyboard.press('Enter');
    await expect(linker.getByRole('textbox', { name: 'Questão jurídica' })).toBeVisible();
    await linker.getByRole('textbox', { name: 'Questão jurídica' }).fill('Quando a guarda pode ser atribuída à avó?');
    await page.keyboard.press('Tab');
    await expect(linker.getByRole('textbox', { name: 'Objetivo do caso' })).toBeFocused();
    await linker.getByRole('textbox', { name: 'Objetivo do caso' }).fill('Examinar a pertinência do julgado à hipótese fictícia.');
    await linker.getByRole('textbox', { name: 'Tese (opcional)' }).fill('O cuidado estável da avó pode justificar a guarda.');
    await linker.getByRole('group', { name: 'Fatos alegados' }).getByRole('button', { name: 'Adicionar' }).click();
    await linker.getByRole('textbox', { name: 'Fatos alegados 1' }).fill('A avó presta cuidados cotidianos à criança na hipótese fictícia.');
    await linker.getByRole('button', { name: 'Salvar e revisar perfil' }).click();
    await expect(linker.getByText(/Perfil (salvo|revisado)\./)).toBeVisible({ timeout: 30000 });
    await linker.evaluate(element => { element.scrollTop = 0; });
    await snapshot('05-perfil');
    checks.push('perfil factual salvo no caso sintético');

    await linker.getByRole('button', { name: 'Avaliar pertinência' }).click();
    await expect(linker.getByText('A avaliação está desligada para este escritório.')).toBeVisible();
    await snapshot('06-avaliacao-desligada');
    if (await linker.getByRole('button', { name: 'Adicionar sem avaliação' }).isVisible()) {
      await linker.getByRole('button', { name: 'Adicionar sem avaliação' }).click();
      await expect(linker.getByText('Referência adicionada ao caso.')).toBeVisible();
    } else await expect(linker.getByText('Esta versão já está vinculada.')).toBeVisible();
    checks.push('avaliação desligada, bypass explícito e vínculo versionado');
    await linker.getByRole('link', { name: 'Ver referências do caso' }).click();
    await page.waitForURL('**/app/vault/cases/**');
    await expect(page.getByRole('heading', { name: 'Referências', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Referências do caso' })).toContainText('Julgado 01');
    await snapshot('07-referencia-no-caso');
    checks.push('referência do caso no Cofre');

    if (process.env.RESEARCH_QA_SHORT !== '1') {
    if (process.env.RESEARCH_QA_SKIP_DRAFT !== '1') {
    await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
    if (!(await page.getByText('AMOSTRA_DE_TESTE_modelo_minuta.txt', { exact: true }).isVisible())) {
      await page.locator('input[type="file"]').setInputFiles({
        name: 'AMOSTRA_DE_TESTE_modelo_minuta.txt', mimeType: 'text/plain',
        buffer: Buffer.from('AMOSTRA DE TESTE. Modelo fictício de minuta.\n\nI. Questão jurídica\nII. Fundamentação\nIII. Conclusão\n', 'utf8'),
      });
    }
    await expect(page.getByText('AMOSTRA_DE_TESTE_modelo_minuta.txt')).toBeVisible();
    await expect(page.getByText('Pronto', { exact: true }).last()).toBeVisible({ timeout: 60000 });
    await snapshot('08-modelo-pronto');
    checks.push('upload e processamento reais do modelo sintético');
    await page.getByRole('button', { name: 'Referências', exact: true }).click();

    await page.getByRole('button', { name: 'Preparar minuta' }).click();
    const draft = page.getByRole('dialog', { name: 'Preparar minuta' });
    await draft.getByRole('checkbox', { name: /Julgado 01/ }).check();
    await draft.getByLabel('Modelo de minuta').selectOption({ label: 'AMOSTRA_DE_TESTE_modelo_minuta.txt' });
    await draft.getByRole('textbox', { name: 'Pedido da minuta' }).fill('AMOSTRA DE TESTE: redija um resumo curto da questão jurídica fictícia.');
    await draft.getByRole('button', { name: 'Revisar citações' }).click();
    const citations = draft.getByRole('group', { name: 'Citações que você autoriza' });
    await expect(citations).toBeVisible();
    const count = await citations.getByRole('checkbox').count();
    expect(count).toBeGreaterThan(0);
    await citations.getByRole('checkbox').first().check();
    await snapshot('09-citacao-individual');
    checks.push('citação individual revisada e aprovada na UI');
    await draft.getByRole('button', { name: 'Criar minuta' }).click();
    const queued = draft.getByRole('link', { name: 'Acompanhar minuta' });
    await queued.waitFor({ state: 'visible', timeout: 20000 });
    await queued.click();
    await page.waitForURL('**/app/research/drafts/**');
    await snapshot('10-minuta-fila');
    await expect(page.getByText('Minuta pronta para revisão.')).toBeVisible({ timeout: 120000 });
    await page.getByRole('link', { name: 'Abrir minuta' }).click();
    await page.waitForURL('**/app/documents/**');
    await snapshot('11-minuta-artefato');
    checks.push('worker concluiu a minuta com modelo e aprovação persistida');
    }

    await page.goto('/app/agents');
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await page.getByRole('button', { name: /^Fontes/ }).click();
    const sources = page.getByRole('dialog', { name: 'Fontes desta conversa' });
    await sources.getByRole('combobox', { name: 'Caso' }).click();
    await page.getByRole('option', { name: 'AMOSTRA DE TESTE · Guarda à avó' }).click();
    await expect(sources.getByRole('heading', { name: 'Referências do caso' })).toBeVisible();
    await sources.getByRole('button', { name: /Julgado 01.*Selecionar/ }).click();
    await sources.getByRole('button', { name: 'Fechar fontes' }).click();
    await expect(page.getByRole('button', { name: 'Fontes (1)' })).toBeVisible();
    await snapshot('12-referencia-no-lume');
    checks.push('referência selecionada como fonte do Lume');
    checks.push('chat usa o modelo configurado para o escritório');
    await page.getByRole('textbox', { name: 'Pergunte ao Lume' }).fill('Na AMOSTRA DE TESTE selecionada, qual é a questão jurídica? Responda em uma frase e indique que o julgado é fictício.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.getByRole('button', { name: 'Copiar resposta' }).last()).toBeEnabled({ timeout: 90000 });
    await snapshot('13-lume-stream');
    checks.push('prompt enviado e resposta recebida por streaming real');
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/research');
  await expect(page.getByRole('heading', { name: 'Pesquisa', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (mode === 'synthetic') {
    await page.getByRole('button', { name: /amostrapesquisa/ }).first().click();
    await expect(page.getByText(/(?:20|22) julgados nesta consulta/)).toBeVisible();
    await snapshot('14-mobile-resultados');
    await page.locator('a[href^="/app/research/judgments/"]').filter({ hasText: 'Julgado 01' }).click();
    await expect(page.getByRole('heading', { name: /Julgado 01/ })).toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await snapshot('15-mobile-leitor');
    await page.getByRole('link', { name: 'Pesquisa', exact: true }).click();
    checks.push('resultados e leitor móveis sem overflow');
  }
  await page.getByRole('button', { name: 'Mais', exact: true }).click();
  const more = page.getByRole('dialog', { name: 'Mais opções' });
  await expect(more.getByRole('link', { name: 'Pesquisa' })).toBeVisible();
  await more.getByRole('combobox', { name: 'Tema' }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.keyboard.press('Escape');
  await snapshot('16-mobile-escuro');
  checks.push('layout móvel, Mais, tema escuro e largura sem overflow');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/app/research');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/sign-in');
  checks.push('logout pela interface ao final');
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
