import type { Browser, BrowserContext, Page } from '@cloudflare/puppeteer';
import { z } from 'zod';
import { activityDto } from '../capabilities/agenda';

export const BROWSER_JOURNEY_TIMEOUT_MS = 330_000;
const ACTION_TIMEOUT_MS = 30_000;
const TASK_TITLE = 'Verificação automática do Lume';
const TASK_NOTE = 'Monitor sintético do Lume. Não contém dados de clientes.';
const FILE_PREFIX = 'lume-monitor-';

export type BrowserJourneyStage =
  | 'configuration' | 'browser_start' | 'sign_in' | 'office_guard' | 'command_center'
  | 'agenda_load' | 'agenda_save' | 'agenda_read' | 'vault_load' | 'vault_upload'
  | 'vault_ready' | 'vault_cleanup' | 'deadline';
export type BrowserJourneyResult = {
  status: 'ok' | 'error';
  stages: { stage: BrowserJourneyStage; status: 'ok' | 'error'; durationMs: number; code?: string }[];
  durationMs: number;
  failureScreenshot?: Uint8Array;
};

const credentialsSchema = z.object({
  baseUrl: z.url(), email: z.email(), password: z.string().min(8).max(128), officeId: z.string().min(1).max(200),
});
const sessionSchema = z.object({ user: z.object({ email: z.email() }) });
const activitySchema = activityDto.pick({ id: true, kind: true, title: true, notes: true, status: true });
const activityListSchema = z.object({ activities: z.array(activitySchema), total: z.number().int().nonnegative() });
const documentSchema = z.object({
  id: z.string().min(1), name: z.string(), scope: z.string(),
  status: z.enum(['queued', 'processing', 'ready', 'failed']), extractedCharacters: z.number(),
});
const documentsSchema = z.object({ documents: z.array(documentSchema), total: z.number().int().nonnegative() });
const failureCode = z.enum([
  'synthetic_request_failed', 'synthetic_navigation_failed', 'synthetic_origin_mismatch',
  'synthetic_identity_mismatch', 'synthetic_office_mismatch', 'synthetic_agenda_failed',
  'synthetic_library_failed', 'synthetic_task_date_missing', 'synthetic_deadline',
  'synthetic_configuration_invalid', 'synthetic_sign_in_failed', 'synthetic_overview_failed',
  'synthetic_task_collision', 'synthetic_agenda_save_failed', 'synthetic_agenda_save_mismatch',
  'synthetic_upload_residue', 'synthetic_upload_control_missing', 'synthetic_upload_failed',
  'synthetic_upload_mismatch', 'synthetic_extraction_failed', 'synthetic_cleanup_mismatch',
  'synthetic_cleanup_failed', 'synthetic_cleanup_not_persisted',
  'synthetic_sign_in_page_timeout', 'synthetic_sign_in_interactive_timeout',
  'synthetic_sign_in_submit_timeout', 'synthetic_sign_in_redirect_timeout',
  'synthetic_cleanup_identity_timeout', 'synthetic_cleanup_library_timeout',
  'synthetic_cleanup_dialog_timeout', 'synthetic_cleanup_submit_timeout', 'synthetic_cleanup_verify_timeout',
]);

async function browserJson(page: Page, path: string, body?: object): Promise<unknown> {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('synthetic_request_failed');
    return response.json();
  }, { path, body });
}

async function browserDocuments(page: Page) {
  const documents: z.infer<typeof documentSchema>[] = [];
  for (let offset = 0; ; offset += 50) {
    const result = documentsSchema.parse(await browserJson(page, `/api/vault/documents?scope=library&limit=50&offset=${offset}`));
    documents.push(...result.documents);
    if (offset + 50 >= result.total) return documents;
  }
}

async function go(page: Page, origin: string, path: string) {
  const response = await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
  const location = new URL(page.url());
  if (!response?.ok() || location.origin !== origin || location.pathname !== path.split('?')[0]) {
    throw new Error('synthetic_navigation_failed');
  }
}

async function clickButton(page: Page, name: string) {
  await page.locator(`aria/${name}[role="button"]`).setTimeout(ACTION_TIMEOUT_MS).click();
}

async function fill(page: Page, selector: string, value: string) {
  const input = await page.waitForSelector(selector, { visible: true });
  if (!input) throw new Error('synthetic_input_missing');
  await input.focus();
  await input.evaluate(element => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('synthetic_input_invalid');
    element.select();
  });
  // Paste through the browser input protocol; typing each character costs a remote round trip.
  await page.keyboard.sendCharacter(value);
  await page.waitForFunction(({ selector, value }) => {
    const input = document.querySelector(selector);
    return (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) && input.value === value;
  }, {}, { selector, value });
}

async function selectExpectedOffice(page: Page, origin: string, credentials: z.infer<typeof credentialsSchema>) {
  if (new URL(page.url()).origin !== origin) throw new Error('synthetic_origin_mismatch');
  const session = sessionSchema.parse(await browserJson(page, '/api/auth/get-session'));
  if (session.user.email.toLowerCase() !== credentials.email.toLowerCase()) throw new Error('synthetic_identity_mismatch');
  const selected = z.object({ success: z.literal(true) }).parse(await browserJson(page, '/api/offices/active', { officeId: credentials.officeId }));
  const cookie = (await page.cookies(origin)).find(cookie => cookie.name === 'k5-office');
  if (!selected.success || cookie?.value !== credentials.officeId || !cookie.httpOnly) throw new Error('synthetic_office_mismatch');
}

async function waitForAgenda(page: Page) {
  await page.waitForSelector('section[aria-label="Atividades"][aria-busy="false"]', { visible: true });
  if (await page.$('[role="alert"]')) throw new Error('synthetic_agenda_failed');
}

async function goToLibrary(page: Page, origin: string) {
  const [loaded] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/vault/documents' && url.searchParams.get('scope') === 'library' && response.request().method() === 'GET';
    }),
    go(page, origin, '/app/vault/library'),
  ]);
  if (!loaded.ok()) throw new Error('synthetic_library_failed');
  await page.waitForSelector('input[type="file"]');
}

async function clearTaskDate(page: Page) {
  await page.$eval('#dueOn', input => {
    if (!(input instanceof HTMLInputElement)) throw new Error('synthetic_task_date_missing');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('synthetic_deadline')), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs only with a dedicated synthetic account and office supplied by the operator. */
export async function runBrowserJourneys(browser: Browser, credentials: {
  baseUrl: string; email: string; password: string; officeId: string;
}): Promise<BrowserJourneyResult> {
  const startedAt = Date.now();
  const stages: BrowserJourneyResult['stages'] = [];
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let expired = false;
  let officeVerified = false;
  let failureScreenshot: Uint8Array | undefined;
  let uploadedDocument: z.infer<typeof documentSchema> | undefined;
  let uploadAttempted = false;
  const fileName = `${FILE_PREFIX}${crypto.randomUUID()}.txt`;
  const taskNotes = `${TASK_NOTE}\nExecução ${crypto.randomUUID()}`;
  let origin = '';

  async function stage<T>(name: BrowserJourneyStage, action: () => Promise<T>): Promise<T> {
    if (expired) throw new Error('synthetic_deadline');
    const start = Date.now();
    try {
      const value = await action();
      if (!expired) stages.push({ stage: name, status: 'ok', durationMs: Date.now() - start });
      return value;
    } catch (error) {
      const parsed = failureCode.safeParse(error instanceof Error ? error.message : undefined);
      const code = parsed.success ? parsed.data : error instanceof Error && error.name === 'TimeoutError'
        ? 'browser_timeout' : error instanceof z.ZodError ? 'unexpected_response' : 'browser_error';
      if (!expired) stages.push({ stage: name, status: 'error', durationMs: Date.now() - start, code });
      throw new Error(name);
    }
  }

  async function captureFailure(currentPage: Page) {
    if (!officeVerified || expired || failureScreenshot) return;
    const location = new URL(currentPage.url());
    if (location.origin !== origin || !location.pathname.startsWith('/app/') || await currentPage.$('input[type="password"]')) return;
    failureScreenshot = await within(currentPage.screenshot({ type: 'png', fullPage: false }), 5_000).catch(() => undefined);
  }

  async function journey() {
    try {
      await stage('configuration', async () => {
        credentialsSchema.parse(credentials);
        const url = new URL(credentials.baseUrl);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
          throw new Error('synthetic_configuration_invalid');
        }
        origin = url.origin;
      });
      const currentPage = await stage('browser_start', async () => {
        context = await browser.createBrowserContext();
        if (expired) { await context.close(); throw new Error('synthetic_deadline'); }
        const newPage = await context.newPage();
        page = newPage;
        newPage.setDefaultTimeout(ACTION_TIMEOUT_MS);
        newPage.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
        await newPage.setViewport({ width: 1365, height: 900 });
        return newPage;
      });
      await stage('sign_in', async () => {
        let step: 'page' | 'interactive' | 'submit' | 'redirect' = 'page';
        try {
        await go(currentPage, origin, '/sign-in');
        await currentPage.waitForNetworkIdle({ idleTime: 500, timeout: ACTION_TIMEOUT_MS });
        step = 'interactive';
        // Wait for a real React interaction before entering credentials in a server-rendered form.
        await clickButton(currentPage, 'Mostrar senha');
        await currentPage.waitForSelector('#password[type="text"]');
        await clickButton(currentPage, 'Ocultar senha');
        await currentPage.waitForSelector('#password[type="password"]');
        await fill(currentPage, '#email', credentials.email);
        await fill(currentPage, '#password', credentials.password);
        step = 'submit';
        const [response] = await Promise.all([
          currentPage.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST'),
          currentPage.click('form button[type="submit"]'),
        ]);
        if (!response.ok()) throw new Error('synthetic_sign_in_failed');
        step = 'redirect';
        await currentPage.waitForFunction(() => window.location.pathname === '/app/command-center');
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`synthetic_sign_in_${step}_timeout`);
          throw error;
        }
      });
      await stage('office_guard', async () => {
        await selectExpectedOffice(currentPage, origin, credentials);
        officeVerified = true;
      });
      await stage('command_center', async () => {
        await go(currentPage, origin, '/app/command-center');
        await currentPage.waitForFunction(() => {
          return ['Tarefas até hoje', 'Próximas reuniões', 'Casos no Cofre', 'Clientes ativos', 'Conversas com Lume'].every(title => {
            const section = document.querySelector(`section[aria-label="${title}"]`);
            return section && !section.querySelector('[role="status"], [role="alert"]');
          });
        });
        if (!(await currentPage.$('h1')) || await currentPage.$('[role="alert"]')) throw new Error('synthetic_overview_failed');
        if (await currentPage.$('aria/Agora não[role="button"]')) await clickButton(currentPage, 'Agora não');
        await currentPage.waitForSelector('[role="dialog"]', { hidden: true });
      });
      const activity = await stage('agenda_load', async () => {
        await go(currentPage, origin, '/app/agenda?view=tasks');
        await waitForAgenda(currentPage);
        const existing = activityListSchema.parse(await browserJson(currentPage, '/api/agenda/activities/list', { query: TASK_TITLE, kind: 'task', limit: 2 }));
        if (existing.total > 1 || existing.activities.some(item => item.title !== TASK_TITLE || !item.notes.startsWith(TASK_NOTE))) {
          throw new Error('synthetic_task_collision');
        }
        return existing.activities[0];
      });
      const savedActivity = await stage('agenda_save', async () => {
        if (activity) {
          await go(currentPage, origin, `/app/agenda?view=tasks&activityId=${encodeURIComponent(activity.id)}`);
          await currentPage.waitForSelector('section[aria-label="Detalhes"]', { visible: true });
          await clickButton(currentPage, 'Editar');
        } else {
          await clickButton(currentPage, 'Nova atividade');
        }
        await currentPage.waitForSelector('[role="dialog"] #title', { visible: true });
        await fill(currentPage, '#title', TASK_TITLE);
        await fill(currentPage, '#notes', taskNotes);
        await currentPage.select('#status', 'pending');
        await clearTaskDate(currentPage);
        await selectExpectedOffice(currentPage, origin, credentials);
        const [response] = await Promise.all([
          currentPage.waitForResponse(response => new URL(response.url()).pathname === `/api/agenda/activities/${activity ? 'update' : 'create'}` && response.request().method() === 'POST'),
          currentPage.click('[role="dialog"] button[type="submit"]'),
        ]);
        if (!response.ok()) throw new Error('synthetic_agenda_save_failed');
        const saved = z.object({ activity: activitySchema }).parse(await response.json()).activity;
        if (saved.title !== TASK_TITLE || saved.notes !== taskNotes || saved.kind !== 'task' || saved.status !== 'pending' || (activity && saved.id !== activity.id)) {
          throw new Error('synthetic_agenda_save_mismatch');
        }
        await currentPage.waitForSelector('[role="dialog"]', { hidden: true });
        return saved;
      });
      await stage('agenda_read', async () => {
        await go(currentPage, origin, `/app/agenda?view=tasks&activityId=${encodeURIComponent(savedActivity.id)}`);
        await currentPage.waitForFunction(({ title, notes }) => {
          const detail = document.querySelector('section[aria-label="Detalhes"]');
          return detail?.querySelector('h2')?.textContent === title && detail.textContent?.includes(notes);
        }, {}, { title: TASK_TITLE, notes: taskNotes });
      });
      await stage('vault_load', async () => {
        await go(currentPage, origin, '/app/vault');
        await currentPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Cofre');
        await goToLibrary(currentPage, origin);
        const existing = await browserDocuments(currentPage);
        if (existing.some(document => document.name.startsWith(FILE_PREFIX))) throw new Error('synthetic_upload_residue');
      });
      await stage('vault_upload', async () => {
        await selectExpectedOffice(currentPage, origin, credentials);
        uploadAttempted = true;
        const [response] = await Promise.all([
          currentPage.waitForResponse(response => new URL(response.url()).pathname === '/api/vault/documents' && response.request().method() === 'POST'),
          currentPage.$eval('input[type="file"]', (input, name) => {
            if (!(input instanceof HTMLInputElement)) throw new Error('synthetic_upload_control_missing');
            const transfer = new DataTransfer();
            transfer.items.add(new File(['Documento sintético do monitor Lume. Verifica envio, extração e leitura. Sem dados de clientes.'], name, { type: 'text/plain' }));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }, fileName),
        ]);
        if (!response.ok()) throw new Error('synthetic_upload_failed');
        uploadedDocument = z.object({ document: documentSchema }).parse(await response.json()).document;
        if (uploadedDocument.name !== fileName || uploadedDocument.scope !== 'library') throw new Error('synthetic_upload_mismatch');
      });
      await stage('vault_ready', async () => {
        await currentPage.waitForFunction(name => {
          const download = Array.from(document.querySelectorAll('a[aria-label]')).find(item => item.getAttribute('aria-label') === `Baixar ${name}`);
          const row = download?.parentElement?.parentElement;
          return row?.textContent?.includes('Pronto') || row?.textContent?.includes('Falhou');
        }, { timeout: 60_000, polling: 1_000 }, fileName);
        const documents = await browserDocuments(currentPage);
        const ready = documents.find(document => document.id === uploadedDocument?.id && document.name === fileName);
        if (ready?.status !== 'ready' || ready.extractedCharacters < 1) throw new Error('synthetic_extraction_failed');
      });
    } catch {
      if (page) await captureFailure(page).catch(() => undefined);
    } finally {
      if (page && uploadAttempted && !expired) {
        const currentPage = page;
        await stage('vault_cleanup', async () => {
          let step: 'identity' | 'library' | 'dialog' | 'submit' | 'verify' = 'identity';
          try {
          await selectExpectedOffice(currentPage, origin, credentials);
          // A lost upload response is recovered by this run's unguessable filename, never by prefix.
          const documents = await browserDocuments(currentPage);
          const created = documents.filter(document => document.name === fileName && document.scope === 'library');
          if (created.length === 0 && !uploadedDocument) return;
          if (created.length !== 1 || (uploadedDocument && created[0].id !== uploadedDocument.id)) throw new Error('synthetic_cleanup_mismatch');
          step = 'library';
          await goToLibrary(currentPage, origin);
          step = 'dialog';
          await clickButton(currentPage, `Excluir ${fileName}`);
          step = 'submit';
          const [response] = await Promise.all([
            currentPage.waitForResponse(response => new URL(response.url()).pathname === `/api/vault/documents/${created[0].id}` && response.request().method() === 'DELETE'),
            currentPage.click('aria/Excluir documento[role="button"]'),
          ]);
          if (!response.ok()) throw new Error('synthetic_cleanup_failed');
          step = 'verify';
          const after = await browserDocuments(currentPage);
          if (after.some(document => document.id === created[0].id)) throw new Error('synthetic_cleanup_not_persisted');
          } catch (error) {
            if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`synthetic_cleanup_${step}_timeout`);
            throw error;
          }
        }).catch(async () => { await captureFailure(currentPage).catch(() => undefined); });
      }
    }
  }

  try {
    await within(journey(), BROWSER_JOURNEY_TIMEOUT_MS - 5_000);
  } catch {
    expired = true;
    stages.push({ stage: 'deadline', status: 'error', durationMs: Date.now() - startedAt });
  } finally {
    expired = true;
    if (context) await within(context.close(), 5_000).catch(() => undefined);
  }
  return {
    status: stages.some(result => result.status === 'error') ? 'error' : 'ok',
    stages: [...stages], durationMs: Date.now() - startedAt,
    ...(failureScreenshot ? { failureScreenshot } : {}),
  };
}
