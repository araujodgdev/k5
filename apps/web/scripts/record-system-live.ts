/**
 * Live Proof Recording and End-to-End Functional Validation Script for K5.
 *
 * Requirements:
 * 1. Chromium 1280x720 HD video recording (minimum duration >= 20.0s).
 * 2. Step screenshots:
 *    - step1_login_filled.png
 *    - step2_app_dashboard.png
 *    - step3_case_created.png
 *    - step4_document_uploaded.png
 *    - step5_document_ready.png
 *    - step6_model_picker_open.png
 *    - step6_agent_chat.png
 *    - step7_logged_out.png
 * 3. Stable account admin@advocacia.test / SenhaForte123!@#456 in office Araújo & Associados Advocacia.
 * 4. Genuine execution of Vault, RAG hybrid search, dynamic model selection, live streaming response, and clean logout.
 * 5. Functional API validations for RAG RRF, Source Inspection, Approvals Anti-Tampering, and Untrusted Origin 403.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const USER_EMAIL = 'admin@advocacia.test';
const USER_PASSWORD = 'SenhaForte123!@#456';

const REPORT_DIR = path.resolve(__dirname, '../playwright-report');
const WORKER_DIR = path.resolve(__dirname, '../../../.agents/teamwork_preview_worker_m2_m3');
const WORKER_FIX_DIR = path.resolve(__dirname, '../../../.agents/teamwork_preview_worker_m2_m3_fix');
const ARTIFACTS_SCREENSHOTS = path.join(WORKER_DIR, 'screenshots');
const ARTIFACTS_SCREENSHOTS_FIX = path.join(WORKER_FIX_DIR, 'screenshots');
const VIDEO_FINAL_PATH = path.join(REPORT_DIR, 'k5_live_system_recording.webm');
const VIDEO_WORKER_COPY = path.join(WORKER_DIR, 'k5_live_system_recording.webm');
const VIDEO_WORKER_COPY_FIX = path.join(WORKER_FIX_DIR, 'k5_live_system_recording.webm');
const FIXTURE_PATH = path.resolve(__dirname, '../tests/fixtures/contrato_empreitada_alpha.txt');

interface ApiValidationResult {
  category: string;
  testCase: string;
  status: 'PASSED' | 'FAILED';
  details: string;
}

const validationResults: ApiValidationResult[] = [];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('===============================================================');
  console.log('K5 LIVE PROOF RECORDING & FUNCTIONAL VALIDATION');
  console.log('Target Base URL:', BASE_URL);
  console.log('Account:', USER_EMAIL);
  console.log('===============================================================');

  // Ensure directories exist
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS_SCREENSHOTS, { recursive: true });
  fs.mkdirSync(ARTIFACTS_SCREENSHOTS_FIX, { recursive: true });

  const tempVideoDir = path.join(REPORT_DIR, `tmp_rec_${Date.now()}`);
  fs.mkdirSync(tempVideoDir, { recursive: true });

  assert.ok(fs.existsSync(FIXTURE_PATH), `Fixture not found at ${FIXTURE_PATH}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  async function saveScreenshot(filename: string) {
    const p1 = path.join(REPORT_DIR, filename);
    const p2 = path.join(ARTIFACTS_SCREENSHOTS, filename);
    const p3 = path.join(ARTIFACTS_SCREENSHOTS_FIX, filename);
    await page.screenshot({ path: p1 });
    fs.copyFileSync(p1, p2);
    fs.copyFileSync(p1, p3);
    const size = fs.statSync(p1).size;
    console.log(`[Screenshot Captured] ${filename} (${size} bytes)`);
    assert.ok(size > 10000, `Screenshot ${filename} size is unexpectedly small (${size} bytes)`);
  }

  try {
    // -------------------------------------------------------------
    // STEP 1: Authentication
    // -------------------------------------------------------------
    console.log('\n>>> Step 1: Authentication at /sign-in');
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' });
    await sleep(1500);

    await page.fill('input[name="email"]', USER_EMAIL);
    await sleep(600);
    await page.fill('input[name="password"]', USER_PASSWORD);
    await sleep(1200);

    await saveScreenshot('step1_login_filled.png');

    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 20000 });
    await sleep(2500); // Allow dashboard animations and data hydration

    await saveScreenshot('step2_app_dashboard.png');

    // -------------------------------------------------------------
    // STEP 2: Vault Case Creation
    // -------------------------------------------------------------
    console.log('\n>>> Step 2: Vault Case Creation at /app/vault');
    await page.goto(`${BASE_URL}/app/vault`, { waitUntil: 'networkidle' });
    await sleep(2000);

    const newCaseBtn = page.locator('button:has-text("Novo caso")');
    await newCaseBtn.waitFor({ state: 'visible', timeout: 10000 });
    await newCaseBtn.click();
    await sleep(1000);

    const caseNameInput = page.locator('input#case-name');
    await caseNameInput.waitFor({ state: 'visible', timeout: 10000 });
    const caseTitle = `Ação de Cobrança - Construtora Alpha (${Date.now().toString().slice(-4)})`;
    await caseNameInput.fill(caseTitle);
    await sleep(1000);

    await page.click('button[type="submit"]:has-text("Criar caso")');
    await page.waitForSelector(`text=${caseTitle}`, { timeout: 15000 });
    await sleep(2000);

    await saveScreenshot('step3_case_created.png');

    // -------------------------------------------------------------
    // STEP 3: Document Upload in Case
    // -------------------------------------------------------------
    console.log('\n>>> Step 3: Vault Document Upload in Created Case');
    const caseLink = page.locator(`a[href*="/app/vault/cases/"]:has-text("${caseTitle}")`).first();
    await caseLink.click();
    await page.waitForURL((url) => url.pathname.includes('/app/vault/cases/'), { timeout: 15000 });
    await sleep(2000);

    // Locate file upload control inside the case view
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE_PATH);
    await sleep(200);

    // Snap immediately upon file selection / upload in progress before waiting for 'Pronto'
    await saveScreenshot('step4_document_uploaded.png');

    // Verify document row appears
    await page.waitForSelector('text=contrato_empreitada_alpha.txt', { timeout: 15000 });
    await sleep(1500);

    // -------------------------------------------------------------
    // STEP 4: Document Indexing & Ready State
    // -------------------------------------------------------------
    console.log('\n>>> Step 4: Awaiting Document Ingestion & Ready Status ("Pronto")');
    // The background worker processes ingestion and chunk extraction
    // Use visible filter because desktop table row is span.hidden.md:block while mobile is p.md:hidden
    const readyStatus = page.locator(':is(span, p):has-text("Pronto")').filter({ visible: true }).first();
    await readyStatus.waitFor({ state: 'visible', timeout: 45000 });
    await sleep(2500);

    await saveScreenshot('step5_document_ready.png');

    // -------------------------------------------------------------
    // STEP 5: Agent Central & Dynamic Model Switcher
    // -------------------------------------------------------------
    console.log('\n>>> Step 5: Agent Central & Dynamic Model Selection at /app/agents');
    await page.goto(`${BASE_URL}/app/agents`, { waitUntil: 'networkidle' });
    await sleep(2500);

    // Ensure clean conversation if desired
    const newConvBtn = page.locator('button[aria-label="Nova conversa"]');
    if (await newConvBtn.isVisible()) {
      await newConvBtn.click();
      await sleep(1500);
    }

    // Open model switcher Popover
    const modelTrigger = page.locator('button[aria-label="Selecionar modelo"]');
    await modelTrigger.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1000);
    await modelTrigger.click();
    await sleep(1500);

    await saveScreenshot('step6_model_picker_open.png');

    // Select mercury-2 or keep model
    const mercuryOption = page.locator('[cmdk-item]:has-text("mercury-2")').first();
    if (await mercuryOption.isVisible()) {
      await mercuryOption.click();
      console.log('Selected model: mercury-2');
    } else {
      await page.keyboard.press('Escape');
      console.log('Kept active model.');
    }
    await sleep(1500);

    // Type prompt into chat composer
    const composerInput = page.locator('textarea[placeholder="Pergunte ao K5"], textarea[aria-label="Pergunte ao K5"]');
    await composerInput.waitFor({ state: 'visible', timeout: 10000 });
    await composerInput.fill('Qual é a multa rescisória estipulada no contrato?');
    await sleep(1500);

    // Click send
    const sendBtn = page.locator('button[aria-label="Enviar mensagem"]');
    await sendBtn.click();
    console.log('Prompt submitted. Awaiting real streaming AI response...');

    // Await send button reappearance (indicates stream completed) and copy button attached
    await page.locator('button[aria-label="Enviar mensagem"]').waitFor({ state: 'visible', timeout: 60000 });
    const copyAction = page.locator('button[aria-label="Copiar resposta"]').last();
    await copyAction.waitFor({ state: 'attached', timeout: 10000 });

    // Hover over message so copy action bar is visible on screenshot
    await page.locator('.group').last().hover();
    await sleep(3500); // Allow reading time for video capture

    await saveScreenshot('step6_agent_chat.png');

    // -------------------------------------------------------------
    // STEP 6: Clean Logout
    // -------------------------------------------------------------
    console.log('\n>>> Step 6: Controlled Clean Logout via Sidebar');
    const logoutBtn = page.locator('button[title*="Encerrar sessão"], button:has-text("Sair")').filter({ visible: true }).first();
    await logoutBtn.waitFor({ state: 'visible', timeout: 10000 });
    await sleep(1000);
    await logoutBtn.click();

    await page.waitForURL((url) => url.pathname.includes('/sign-in'), { timeout: 15000 });
    await sleep(2500);

    await saveScreenshot('step7_logged_out.png');
    await sleep(1500);

  } finally {
    const video = page.video();
    await page.close();
    await context.close();
    await browser.close();

    if (video) {
      const tempPath = await video.path();
      if (tempPath && fs.existsSync(tempPath)) {
        fs.copyFileSync(tempPath, VIDEO_FINAL_PATH);
        fs.copyFileSync(tempPath, VIDEO_WORKER_COPY);
        fs.copyFileSync(tempPath, VIDEO_WORKER_COPY_FIX);
        console.log(`\n[Live Video Saved] ${VIDEO_FINAL_PATH} (${fs.statSync(VIDEO_FINAL_PATH).size} bytes)`);
        console.log(`[Worker Video Copy] ${VIDEO_WORKER_COPY}`);
        console.log(`[Worker Fix Video Copy] ${VIDEO_WORKER_COPY_FIX}`);

        // Remove temp dir
        try { fs.rmSync(tempVideoDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  // -------------------------------------------------------------
  // VIDEO DURATION INSPECTION VIA FFPROBE
  // -------------------------------------------------------------
  console.log('\n>>> Inspecting Live Video Duration via ffprobe...');
  try {
    const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${VIDEO_FINAL_PATH}"`;
    const probeOut = execSync(probeCmd, { encoding: 'utf8' }).trim();
    const duration = parseFloat(probeOut);
    console.log(`Video Duration: ${duration.toFixed(2)} seconds`);

    assert.ok(!isNaN(duration), 'Could not parse video duration from ffprobe.');
    assert.ok(duration >= 20.0, `Video duration (${duration.toFixed(2)}s) is below required 20.0s threshold!`);
    console.log('✅ Video duration requirement satisfied (>= 20.0s).');

    validationResults.push({
      category: 'R3. Visual Proofs',
      testCase: 'HD Video Recording (1280x720, >= 20.0s)',
      status: 'PASSED',
      details: `Duration: ${duration.toFixed(2)}s, Size: ${(fs.statSync(VIDEO_FINAL_PATH).size / (1024 * 1024)).toFixed(2)} MB`,
    });
  } catch (err) {
    console.error('ffprobe inspection error:', err);
    validationResults.push({
      category: 'R3. Visual Proofs',
      testCase: 'HD Video Recording (1280x720, >= 20.0s)',
      status: 'FAILED',
      details: String(err),
    });
  }

  // Verify all 8 screenshot files
  const mandatoryScreenshots = [
    'step1_login_filled.png',
    'step2_app_dashboard.png',
    'step3_case_created.png',
    'step4_document_uploaded.png',
    'step5_document_ready.png',
    'step6_model_picker_open.png',
    'step6_agent_chat.png',
    'step7_logged_out.png',
  ];

  for (const shot of mandatoryScreenshots) {
    const p = path.join(REPORT_DIR, shot);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    const ok = exists && size > 10000;
    validationResults.push({
      category: 'R3. Visual Proofs',
      testCase: `Screenshot ${shot}`,
      status: ok ? 'PASSED' : 'FAILED',
      details: exists ? `${size} bytes` : 'FILE MISSING',
    });
  }

  // Verify distinct hashes for step4 and step5
  const crypto = await import('node:crypto');
  const path4 = path.join(REPORT_DIR, 'step4_document_uploaded.png');
  const path5 = path.join(REPORT_DIR, 'step5_document_ready.png');
  const hash4 = crypto.createHash('sha256').update(fs.readFileSync(path4)).digest('hex');
  const hash5 = crypto.createHash('sha256').update(fs.readFileSync(path5)).digest('hex');
  console.log(`\n[Screenshot Hash Verification]`);
  console.log(`  step4_document_uploaded.png: ${hash4} (${fs.statSync(path4).size} bytes)`);
  console.log(`  step5_document_ready.png:    ${hash5} (${fs.statSync(path5).size} bytes)`);
  assert.notEqual(hash4, hash5, `step4 and step5 must have distinct SHA-256 hashes (${hash4})!`);
  console.log('✅ step4 and step5 have distinct cryptographic hashes.');

  validationResults.push({
    category: 'R3. Visual Proofs',
    testCase: 'Distinct Screenshots step4 and step5',
    status: hash4 !== hash5 ? 'PASSED' : 'FAILED',
    details: `step4: ${hash4.slice(0, 16)}... (${fs.statSync(path4).size}b), step5: ${hash5.slice(0, 16)}... (${fs.statSync(path5).size}b)`,
  });

  // -------------------------------------------------------------
  // FUNCTIONAL API ASSERTIONS (R2 SUBSYSTEMS)
  // -------------------------------------------------------------
  console.log('\n>>> Executing Authenticated Functional API Assertions (R2)...');

  // Authenticate session via Better Auth to get fresh session cookie
  const authRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });
  assert.equal(authRes.status, 200, 'Authentication failed for API test session');
  const sessionCookie = authRes.headers.get('set-cookie')?.split(';')[0] ?? '';

  // 1. RAG Hybrid Search with RRF
  console.log('\n--- Test 1: RAG Hybrid Search with Reciprocal Rank Fusion (RRF) ---');
  try {
    const searchRes = await fetch(`${BASE_URL}/api/knowledge/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: BASE_URL,
      },
      body: JSON.stringify({ query: 'multa rescisória', limit: 5 }),
    });

    const searchData = (await searchRes.json()) as { sources?: Array<{ sourceId: string; documentId: string; documentName: string; sourceLabel: string; text: string; score?: number }>; degraded?: boolean };
    console.log('Search HTTP Status:', searchRes.status);
    console.log('Sources returned:', searchData.sources?.length);

    assert.equal(searchRes.status, 200);
    assert.ok(Array.isArray(searchData.sources) && searchData.sources.length > 0, 'Expected at least 1 source hit for "multa rescisória"');
    const firstHit = searchData.sources[0];
    assert.ok(firstHit.text.includes('multa') || firstHit.text.includes('10%'), 'Source content missing expected contract terms');

    validationResults.push({
      category: 'R2. RAG & Knowledge',
      testCase: 'POST /api/knowledge/search (RRF Hybrid Search)',
      status: 'PASSED',
      details: `Returned ${searchData.sources.length} sources. Top hit: "${firstHit.sourceLabel}" (degraded: ${searchData.degraded})`,
    });

    // 2. Source Inspection with Adjacent Context (+-1 ordinal)
    console.log('\n--- Test 2: Source Inspection with Adjacent Structural Context ---');
    // Extract stableReference from top hit
    const docId = firstHit.documentId;
    const refMatch = firstHit.sourceLabel.match(/—\s*(.+)$/);
    const stableRef = refMatch ? refMatch[1].trim() : 'seção:1';

    const sourceRes = await fetch(`${BASE_URL}/api/knowledge/source`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: BASE_URL,
      },
      body: JSON.stringify({ documentId: docId, stableReference: stableRef }),
    });

    const sourceData = (await sourceRes.json()) as { source?: { sourceId: string; documentId: string; text: string; adjacentContext?: string } };
    console.log('Source HTTP Status:', sourceRes.status);
    assert.equal(sourceRes.status, 200);
    assert.ok(sourceData.source, 'Expected source object in response');
    assert.equal(sourceData.source.documentId, docId);

    validationResults.push({
      category: 'R2. RAG & Knowledge',
      testCase: 'POST /api/knowledge/source (Adjacent Chunk Inspection)',
      status: 'PASSED',
      details: `Source inspection returned documentId ${docId} with ${sourceData.source.adjacentContext ? 'adjacent structural context' : 'single chunk'}`,
    });
  } catch (err) {
    console.error('Search / Source error:', err);
    validationResults.push({
      category: 'R2. RAG & Knowledge',
      testCase: 'Hybrid Search & Source Inspection',
      status: 'FAILED',
      details: String(err),
    });
  }

  // 3. Approvals Anti-Tampering & Canonical Hashing
  console.log('\n--- Test 3: Approvals Proposal Creation and Canonical Hashing ---');
  try {
    const proposalRes = await fetch(`${BASE_URL}/api/approvals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: BASE_URL,
      },
      body: JSON.stringify({
        capabilityName: 'k5_context_set_scope',
        input: { caseId: 'case-test-alpha', nested: { b: 2, a: 1 } },
        ttlMs: 600000,
      }),
    });

    const proposalData = (await proposalRes.json()) as { proposal?: { id: string; normalized_input: string; status: string } };
    console.log('Approvals HTTP Status:', proposalRes.status);
    assert.equal(proposalRes.status, 201);
    assert.ok(proposalData.proposal?.id);
    assert.equal(proposalData.proposal.status, 'pending');

    // Check canonicalization: nested keys {"b":2,"a":1} must be canonicalized to {"a":1,"b":2}
    const norm = proposalData.proposal.normalized_input;
    assert.ok(norm.indexOf('"a":1') < norm.indexOf('"b":2'), 'Canonical sorting failed for nested keys');

    validationResults.push({
      category: 'R2. Platform & Security',
      testCase: 'POST /api/approvals (Canonical Input Anti-Tampering)',
      status: 'PASSED',
      details: `Proposal ${proposalData.proposal.id} created with canonicalized input: ${norm}`,
    });
  } catch (err) {
    console.error('Approvals error:', err);
    validationResults.push({
      category: 'R2. Platform & Security',
      testCase: 'POST /api/approvals',
      status: 'FAILED',
      details: String(err),
    });
  }

  // 4. Security & Untrusted Origin CSRF Protection
  console.log('\n--- Test 4: Untrusted Origin 403 CSRF Protection ---');
  try {
    const evilOrigin = 'https://malicious.attacker.com';
    const csrfRes = await fetch(`${BASE_URL}/api/vault/documents`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        origin: evilOrigin,
      },
      body: new FormData(), // POST write request with untrusted origin
    });

    console.log('Untrusted Origin HTTP Status:', csrfRes.status);
    assert.equal(csrfRes.status, 403, `Expected 403 for untrusted origin, received ${csrfRes.status}`);
    const csrfData = (await csrfRes.json()) as { error?: string };
    assert.match(csrfData.error ?? '', /Origem.*n[ãa]o autorizada/i, 'Expected error message mentioning unauthorized origin');

    validationResults.push({
      category: 'R2. Platform & Security',
      testCase: 'POST /api/vault/documents with untrusted origin (CSRF 403)',
      status: 'PASSED',
      details: `Rejected with HTTP 403 "${csrfData.error}" from origin ${evilOrigin}`,
    });
  } catch (err) {
    console.error('CSRF protection error:', err);
    validationResults.push({
      category: 'R2. Platform & Security',
      testCase: 'CSRF Protection (Untrusted Origin 403)',
      status: 'FAILED',
      details: String(err),
    });
  }

  // -------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('EXECUTION SUMMARY MATRIX');
  console.log('===============================================================');
  console.table(validationResults);

  const allPassed = validationResults.every((r) => r.status === 'PASSED');
  if (!allPassed) {
    console.error('❌ Some validation checks failed.');
    process.exitCode = 1;
  } else {
    console.log('🎉 ALL VALIDATIONS AND PROOFS PASSED SUCCESSFULLY!');
  }
}

main().catch((error) => {
  console.error('FATAL EXECUTION ERROR:', error);
  process.exitCode = 1;
});
