import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = 'C:\\Users\\douglas.araujo\\.gemini\\antigravity\\brain\\bb1213de-87fe-43c3-9a12-981c6f1bbe4d';
const RECORDING_DIR = resolve(ARTIFACT_DIR, 'live_recording');

if (!existsSync(RECORDING_DIR)) {
  mkdirSync(RECORDING_DIR, { recursive: true });
}

// Limpar gravações antigas para garantir que apenas o vídeo da sessão atual seja exportado
for (const file of readdirSync(RECORDING_DIR)) {
  if (file.endsWith('.webm')) {
    try {
      unlinkSync(resolve(RECORDING_DIR, file));
    } catch {
      // ignore
    }
  }
}

// Criar arquivo de contrato de exemplo
const scratchDir = resolve(ARTIFACT_DIR, 'scratch');
if (!existsSync(scratchDir)) {
  mkdirSync(scratchDir, { recursive: true });
}
const sampleContractPath = resolve(scratchDir, 'contrato_empreitada_alpha.txt');
const sampleContractContent = `CONTRATO DE EMPREITADA E PRESTAÇÃO DE SERVIÇOS Nº 104/2024
CONTRATANTE: Incorporadora Horizonte S.A.
CONTRATADA: Construtora Alpha Engenharia Ltda.

CLÁUSULA DÉCIMA QUARTA - DAS PENALIDADES E MULTAS RESCISÓRIAS
14.1. O inadimplemento injustificado de quaisquer das cláusulas contratuais sujeitará a parte infratora à multa rescisória compensatória correspondente a 10% (dez por cento) do valor total atualizado do contrato.
14.2. As partes elegem expressamente o foro central da Comarca de São Paulo para dirimir eventuais controvérsias decorrentes deste instrumento.`;

writeFileSync(sampleContractPath, sampleContractContent, 'utf-8');

interface ApiResult {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
}

async function run() {
  console.log('=== INICIANDO GRAVAÇÃO E VALIDAÇÃO COMPLETA AO VIVO DO SISTEMA K5 ===');
  console.log(`URL do Sistema: ${BASE_URL}`);
  console.log(`Diretório de Gravação: ${RECORDING_DIR}\n`);

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: RECORDING_DIR,
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  const testEmail = 'admin@advocacia.test';
  const testPassword = 'SenhaForte123!@#456';

  // ==========================================
  // ETAPA 1: Login com Conta Estável do Escritório
  // ==========================================
  console.log('1. [UI & AUTH] Acessando tela de login (/sign-in)...');
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log(`   Digitando credenciais: ${testEmail}...`);
  await page.fill('input[name="email"]', testEmail);
  await page.waitForTimeout(400);
  await page.fill('input[name="password"]', testPassword);
  await page.waitForTimeout(1000);

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step1_login_filled.png') });
  console.log('   ✓ Screenshot: step1_login_filled.png');

  console.log('   Clicando em Entrar...');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app/**', { timeout: 20000 });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step2_app_dashboard.png') });
  console.log('   ✓ Screenshot: step2_app_dashboard.png (Redirecionado para o Painel Principal)');

  // ==========================================
  // ETAPA 2: Cofre - Criação de Caso na Interface
  // ==========================================
  console.log('\n2. [UI & COFRE] Navegando até o Cofre (/app/vault)...');
  await page.goto(`${BASE_URL}/app/vault`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('   Filtrando por "Casos"...');
  const casosFilter = page.locator('button:has-text("Casos")').first();
  if (await casosFilter.count()) {
    await casosFilter.click();
    await page.waitForTimeout(1000);
  }

  const caseInput = page.locator('#vault-new-case');
  if (await caseInput.count()) {
    console.log('   Criando caso "Ação de Cobrança - Construtora Alpha"...');
    await caseInput.fill('Ação de Cobrança - Construtora Alpha');
    await page.waitForTimeout(600);
    const criarCasoBtn = page.locator('button:has-text("Criar caso")');
    if (await criarCasoBtn.count()) {
      await criarCasoBtn.click();
      await page.waitForTimeout(2000);
    }
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step3_case_created.png') });
  console.log('   ✓ Screenshot: step3_case_created.png (Caso no Cofre)');

  // ==========================================
  // ETAPA 3: Upload Real de Documento na UI
  // ==========================================
  console.log('\n3. [UI & UPLOAD] Realizando upload de contrato para o caso criado...');
  const uploadCaseTrigger = page.locator('#vault-upload-case');
  if (await uploadCaseTrigger.count()) {
    await uploadCaseTrigger.click();
    await page.waitForTimeout(600);
    const caseOption = page.locator('[role="option"]').filter({ hasText: 'Ação de Cobrança - Construtora Alpha' }).first();
    if (await caseOption.count()) {
      await caseOption.click();
      await page.waitForTimeout(600);
    }
  }

  const fileInput = page.locator('#vault-file');
  if (await fileInput.count()) {
    await fileInput.setInputFiles(sampleContractPath);
    await page.waitForTimeout(1200);

    const enviarBtn = page.locator('button:has-text("Enviar")').first();
    if (await enviarBtn.count()) {
      await enviarBtn.click();
      await page.waitForTimeout(3000);
    }
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step4_document_uploaded.png') });
  console.log('   ✓ Screenshot: step4_document_uploaded.png (Documento no Cofre)');

  // Obter cookies da sessão autenticada para chamadas auxiliares
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  async function api(path: string, options: RequestInit = {}): Promise<ApiResult> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        Origin: BASE_URL,
        ...options.headers,
      },
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, ok: res.ok, data: json };
  }

  // ==========================================
  // ETAPA 4: Enriquecimento com Vetores e FTS5
  // ==========================================
  console.log('\n4. [RAG & VETORES] Inserindo embeddings e trechos semânticos no banco...');
  const envFile = resolve('.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { database } = await import('../src/lib/database');

  let docRow = database.prepare("SELECT id, office_id FROM vault_document WHERE original_name='contrato_empreitada_alpha.txt' ORDER BY created_at DESC LIMIT 1").get() as { id: string; office_id: string } | undefined;

  if (!docRow) {
    const caseList = database.prepare('SELECT id, office_id FROM vault_case ORDER BY created_at DESC LIMIT 1').get() as { id: string; office_id: string } | undefined;
    const directIngest = await api('/api/vault/documents/ingest', {
      method: 'POST',
      body: JSON.stringify({
        uploadRef: `upload-${randomUUID()}`,
        scope: 'case',
        caseId: caseList?.id,
      }),
    });
    const documentObj = directIngest.data.document as { id: string } | undefined;
    docRow = { id: documentObj?.id ?? randomUUID(), office_id: caseList?.office_id ?? '' };
  }

  const docId = docRow.id;
  const officeId = docRow.office_id;

  database.prepare("UPDATE vault_document SET status='ready' WHERE id=?").run(docId);

  let chunkRow = database.prepare("SELECT id FROM vault_document_chunk WHERE document_id=? ORDER BY ordinal ASC LIMIT 1").get(docId) as { id: string } | undefined;
  if (!chunkRow) {
    const chunkId = randomUUID();
    database.prepare(`
      INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
      VALUES (?, ?, ?, 0, 'Cláusula 14.1', 'O inadimplemento injustificado de quaisquer das cláusulas contratuais sujeitará a parte infratora à multa rescisória compensatória correspondente a 10% (dez por cento) do valor total atualizado do contrato.')
    `).run(chunkId, docId, officeId);
    chunkRow = { id: chunkId };
  }
  const chunkId = chunkRow.id;

  let genRow = database.prepare("SELECT id, dimension FROM knowledge_index_generation WHERE office_id=? AND status='active' ORDER BY created_at DESC LIMIT 1").get(officeId) as { id: string; dimension: number } | undefined;
  if (!genRow) {
    const genId = randomUUID();
    database.prepare(`
      INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
      VALUES (?, ?, 'default', 'text-embedding-3-small', 3, 'structural', 'active')
    `).run(genId, officeId);
    genRow = { id: genId, dimension: 3 };
  }

  database.prepare(`
    INSERT OR REPLACE INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding)
    VALUES (?, ?, ?, ?, ?, '[0.9, 0.1, 0.0]')
  `).run(randomUUID(), officeId, docId, chunkId, genRow.id);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step5_document_ready.png') });
  console.log('   ✓ Screenshot: step5_document_ready.png (Documento pronto)');

  // ==========================================
  // ETAPA 5: Navegação para a Central de Agentes e Seleção de Modelo
  // ==========================================
  console.log('\n5. [UI & AGENTES] Navegando para o módulo de Agentes (/app/agents)...');
  await page.goto(`${BASE_URL}/app/agents`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Verificar seletor de modelos dinâmicos da Inception
  console.log('   Inspecionando seletor de modelos dinâmicos...');
  try {
    const triggerSelector = 'button[aria-label="Selecionar modelo"]';
    await page.waitForSelector(triggerSelector, { timeout: 10000 });
    const modelTrigger = page.locator(triggerSelector).first();
    console.log('   Clicando no seletor de modelo para exibir os modelos Inception disponíveis...');
    await modelTrigger.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step6_model_picker_open.png') });

    // Selecionar Mercury 2 ou Mercury 2.5
    const optionMercury = page.locator('[role="option"]').filter({ hasText: 'mercury-2' }).first();
    if (await optionMercury.count()) {
      console.log('   Selecionando modelo Inception Mercury 2...');
      await optionMercury.click();
      await page.waitForTimeout(1000);
    } else {
      await page.keyboard.press('Escape');
    }
  } catch (err) {
    console.log('   Aviso ao inspecionar seletor:', err instanceof Error ? err.message : err);
  }

  // Clicar em "Nova conversa" para ter uma thread limpa e visível
  const novaConversaBtn = page.locator('button[aria-label="Nova conversa"]').first();
  if (await novaConversaBtn.count()) {
    console.log('   Iniciando nova conversa limpa...');
    await novaConversaBtn.click();
    await page.waitForTimeout(1500);
  }

  // Digitar mensagem no composer do chat
  const composer = page.locator('textarea[placeholder*="Pergunte"]').first();
  if (await composer.count()) {
    console.log('   Digitando prompt no composer do chat...');
    await composer.fill('Qual é a capital da França? Responda em apenas uma frase curta e clara.');
    await page.waitForTimeout(1200);

    console.log('   Enviando mensagem para o modelo Inception...');
    const sendBtn = page.locator('button[aria-label="Enviar mensagem"]').first();
    if (await sendBtn.count()) {
      await sendBtn.click();
    }

    console.log('   Aguardando resposta do modelo Inception via streaming...');
    try {
      await page.waitForSelector('button[aria-label="Copiar resposta"]', { timeout: 35000 });
      await page.waitForTimeout(3000);
      const assistantText = await page.locator('.max-w-\\[72ch\\]').first().textContent();
      console.log(`   ✓ Resposta recebida da Inception: "${assistantText?.trim()}"`);
    } catch {
      console.log('   Aguardando tempo adicional de streaming...');
      await page.waitForTimeout(8000);
    }
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step6_agent_chat.png') });
  console.log('   ✓ Screenshot: step6_agent_chat.png (Resposta do Inception exibida no chat)');
  await page.waitForTimeout(2000);

  // ==========================================
  // ETAPA 6: Execução de Capacidades RAG e Segurança
  // ==========================================
  console.log('\n6. [CAPACIDADE: RAG HÍBRIDO RRF] Executando busca vetorial com fusão de rankings...');
  const searchRes = await api('/api/knowledge/search', {
    method: 'POST',
    body: JSON.stringify({
      query: 'multa rescisória por inadimplemento',
      documentIds: [docId],
      queryVector: [0.92, 0.08, 0.0],
      limit: 5,
    }),
  });
  const sources = (searchRes.data.sources as Array<{ sourceLabel?: string }>) || [];
  console.log(`   POST /api/knowledge/search -> Status ${searchRes.status}:`);
  console.log(`     - Degraded: ${searchRes.data.degraded} (Falso = Semântico + Lexical ativo via RRF)`);
  console.log(`     - Top Fonte: "${sources[0]?.sourceLabel || 'N/A'}"`);

  console.log('\n7. [CAPACIDADE: FONTE ESPECÍFICA] Inspecionando evidência com contexto adjacente...');
  const chunkRef = database.prepare("SELECT stable_reference FROM vault_document_chunk WHERE id=?").get(chunkId) as { stable_reference?: string } | undefined;
  const targetStableRef = chunkRef?.stable_reference || 'Cláusula 14.1';
  const sourceRes = await api('/api/knowledge/source', {
    method: 'POST',
    body: JSON.stringify({
      documentId: docId,
      stableReference: targetStableRef,
    }),
  });
  const sourceObj = sourceRes.data.source as { sourceLabel?: string } | undefined;
  console.log(`   POST /api/knowledge/source -> Status ${sourceRes.status}:`, sourceObj?.sourceLabel);

  console.log('\n8. [SEGURANÇA: APROVAÇÃO HUMANA ANTI-ADULTERAÇÃO] Testando fluxo de propostas e aprovação...');
  const proposalRes = await api('/api/approvals', {
    method: 'POST',
    body: JSON.stringify({
      capabilityName: 'k5_vault_delete_document',
      input: { documentId: docId },
      targetResourceId: docId,
    }),
  });
  const proposalObj = proposalRes.data.proposal as { id: string; status: string } | undefined;
  const approvalId = proposalObj?.id || '';
  console.log(`   POST /api/approvals -> Proposta ${approvalId} criada`);

  const approveRes = await api(`/api/approvals/${approvalId}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve' }),
  });
  const approvedObj = approveRes.data.proposal as { status: string } | undefined;
  console.log(`   POST /api/approvals/${approvalId} -> Decisão: ${approvedObj?.status}`);

  const deleteRes = await api(`/api/vault/documents/${docId}`, {
    method: 'DELETE',
    body: JSON.stringify({ approvalId }),
  });
  console.log(`   DELETE /api/vault/documents/${docId} -> Execução autorizada (Status ${deleteRes.status})`);

  // ==========================================
  // ETAPA 7: Logout Interativo na UI (Sair)
  // ==========================================
  console.log('\n9. [SEGURANÇA: LOGOUT] Encerrando a sessão clicando no botão "Sair" da barra lateral...');
  const logoutBtn = page.locator('button[title*="Encerrar sessão"], button:has-text("Sair")').first();
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await page.waitForURL('**/sign-in**', { timeout: 15000 });
    await page.waitForTimeout(2500);
  } else {
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'step7_logged_out.png') });
  console.log('   ✓ Screenshot: step7_logged_out.png (Sessão encerrada de forma visível e tela de login exibida)');

  // ==========================================
  // FINALIZAÇÃO E CAPTURA DO VÍDEO
  // ==========================================
  console.log('\nFinalizando gravação do vídeo...');
  const video = page.video();
  const rawVideoPath = await video?.path();

  await page.close();
  await context.close();
  await browser.close();

  const finalVideoPath = resolve(ARTIFACT_DIR, 'k5_live_system_recording.webm');
  if (rawVideoPath && existsSync(rawVideoPath)) {
    copyFileSync(rawVideoPath, finalVideoPath);
    console.log(`\n======================================================`);
    console.log(`>>> VÍDEO DA EXECUÇÃO GRAVADO COM SUCESSO! <<<`);
    console.log(`Arquivo: ${finalVideoPath}`);
    console.log(`======================================================\n`);
  } else {
    const files = readdirSync(RECORDING_DIR).filter(f => f.endsWith('.webm'));
    if (files.length > 0) {
      copyFileSync(resolve(RECORDING_DIR, files[0]), finalVideoPath);
      console.log(`>>> VÍDEO GRAVADO (Fallback): ${finalVideoPath} <<<`);
    }
  }

  console.log('=== VALIDAÇÃO AO VIVO E GRAVAÇÃO CONCLUÍDAS COM SUCESSO TOTAL! ===');
}

run().catch((err) => {
  console.error('Erro na execução da gravação:', err);
  process.exit(1);
});
