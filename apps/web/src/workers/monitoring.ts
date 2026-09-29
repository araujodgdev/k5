import { timingSafeEqual } from 'node:crypto';
import type { R2Bucket, ScheduledController, Hyperdrive, WorkerVersionMetadata } from '@cloudflare/workers-types';
import type { BrowserWorker } from '@cloudflare/puppeteer';
import puppeteer from '@cloudflare/puppeteer';
import { withSentry } from '@sentry/cloudflare';
import { createPostgresPool, postgresDatabase } from '../lib/db/postgres';
import { serverOptions } from '../lib/observability/options';
import { captureOperationalError, observeSchedule } from '../lib/observability/report';
import { inspectQueueHealth } from '../lib/observability/queue-health';
import { runBrowserJourneys } from '../lib/observability/browser-journeys';
import { claimMonitoringRun, finishMonitoringRun, type MonitoringRunName } from '../lib/observability/monitoring-run';

type Env = Pick<MonitoringEnv, 'MONITOR_BASE_URL' | 'MONITOR_EMAIL' | 'MONITOR_PASSWORD' | 'MONITOR_OFFICE_ID' | 'MONITOR_RUN_TOKEN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_TRACES_SAMPLE_RATE'> & {
  BROWSER: BrowserWorker;
  HYPERDRIVE: Hyperdrive;
  EVIDENCE: R2Bucket;
  CF_VERSION_METADATA: WorkerVersionMetadata;
};

async function run(env: Env, name: MonitoringRunName) {
  const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
  const db = postgresDatabase(pool);
  const runId = crypto.randomUUID();
  let evidence: object = { runId, release: env.CF_VERSION_METADATA.id };
  try {
    const token = await claimMonitoringRun(db, name);
    if (!token) return { status: 'busy' };
    try {
      return await observeSchedule(`lume-monitor-${name}`, async () => {
        const result = await (async () => {
        if (name === 'queues') {
          const alerts = await inspectQueueHealth(db, Date.now());
          evidence = { runId, release: env.CF_VERSION_METADATA.id, alerts };
          if (alerts.length) {
            for (const alert of alerts) captureOperationalError(new Error('Queue health threshold exceeded'), `monitor.queue.${alert.queue}.${alert.reason}`, {
              queue: alert.queue, reason: alert.reason, count: String(alert.count), oldest_age_minutes: String(alert.oldestAgeMinutes),
            });
            throw new Error('Queue health thresholds exceeded.');
          }
          return { status: 'ok', ...evidence };
        }
        const browser = await puppeteer.launch(env.BROWSER);
        try {
          const { failureScreenshot, ...outcome } = await runBrowserJourneys(browser, {
            baseUrl: env.MONITOR_BASE_URL, email: env.MONITOR_EMAIL, password: env.MONITOR_PASSWORD, officeId: env.MONITOR_OFFICE_ID,
          });
          evidence = { ...outcome, runId, release: env.CF_VERSION_METADATA.id };
          const key = `journeys/${new Date().toISOString().slice(0, 10)}/${runId}`;
          await env.EVIDENCE.put(`${key}.json`, JSON.stringify(evidence), { httpMetadata: { contentType: 'application/json' } });
          if (failureScreenshot) await env.EVIDENCE.put(`${key}.png`, failureScreenshot, { httpMetadata: { contentType: 'image/png' } });
          if (outcome.status === 'error') {
            for (const stage of outcome.stages.filter(stage => stage.status === 'error')) {
              captureOperationalError(new Error('Synthetic journey failed'), 'monitor.journey', { stage: stage.stage, failure_code: stage.code ?? 'unknown', run_id: runId });
            }
            throw new Error('Synthetic journey failed.');
          }
          return evidence;
        } finally { await browser.close(); }
        })();
        const completed = await finishMonitoringRun(db, name, token, 'ok', result);
        if (completed.changes !== 1) throw new Error('Monitoring lease was replaced before completion.');
        return result;
      }, name === 'queues' ? '*/5 * * * *' : '2,17,32,47 * * * *', name === 'queues' ? 2 : 6);
    } catch (error) {
      captureOperationalError(error, `monitor.${name}`, { run_id: runId });
      await finishMonitoringRun(db, name, token, 'error', evidence);
      throw new Error(`Lume ${name} monitor failed; run ${runId}.`);
    }
  } finally { await pool.end(); }
}

const worker = {
  async scheduled(controller: ScheduledController, env: Env) {
    await run(env, controller.cron === '*/5 * * * *' ? 'queues' : 'journeys');
  },
  async fetch(request: Request, env: Env) {
    const authorization = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${env.MONITOR_RUN_TOKEN}`);
    if (!env.MONITOR_RUN_TOKEN || authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)) return new Response('Not found', { status: 404 });
    const name = new URL(request.url).pathname.slice(1);
    if (request.method === 'GET' && name === 'status') {
      const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
      try {
        const { rows } = await pool.query('SELECT name,status,started_at,finished_at,last_success_at,result_json FROM monitoring_run ORDER BY name');
        return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } });
      } finally { await pool.end(); }
    }
    if (request.method !== 'POST' || (name !== 'queues' && name !== 'journeys')) return new Response('Not found', { status: 404 });
    try { return Response.json(await run(env, name), { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ status: 'error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  },
};

export default withSentry<Env>(env => serverOptions('monitoring', env), worker);
