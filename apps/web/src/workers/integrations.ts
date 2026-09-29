import { withSentry } from '@sentry/cloudflare';
import { createPostgresPool, postgresDatabase } from '@/lib/db/postgres';
import { withPostgres } from '@/lib/database';
import { serverOptions } from '@/lib/observability/options';
import { captureOperationalError, observeSchedule } from '@/lib/observability/report';
import { drainEdgeJobs, runEdgeMaintenance } from '@/lib/google/worker-edge';
import { withGoogleEnvironment } from '@/lib/google/environment';
import { withWhatsAppEnvironment, type WhatsAppEnvironment } from '@/lib/whatsapp/environment';
import { runWhatsAppPass } from '@/lib/whatsapp/worker';
import { withPersonalChatEnvironment, type PersonalChatEnvironment } from '@/lib/personal-chat/environment';
import { runPersonalEmailPass } from '@/lib/personal-chat/email-worker';

// Queue bodies carry only a job id hint; PostgreSQL rows hold state, checkpoints and leases.
type QueueMessage = { body: { jobId?: string }; ack(): void; retry(): void };
type QueueBatch = { messages: QueueMessage[] };
type Env = {
  INTEGRATIONS_QUEUE: { send(message: { jobId: string } | { kind: 'sweep' }): Promise<void> };
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_CALENDAR_WEBHOOK_URL?: string;
  K5_CREDENTIALS_KEY: string;
  K5_CREDENTIALS_PREVIOUS_KEYS?: string;
  K5_CREDENTIALS_NEXT_KEY?: string;
} & WhatsAppEnvironment & PersonalChatEnvironment & Pick<CloudflareEnv, 'HYPERDRIVE' | 'VAULT' | 'SENTRY_ENVIRONMENT' | 'SENTRY_TRACES_SAMPLE_RATE'>;

async function withDatabase<T>(env: Env, action: (db: ReturnType<typeof postgresDatabase>) => Promise<T>) {
  const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 2, idleTimeoutMillis: 0 });
  try { return await withGoogleEnvironment(env, () => withWhatsAppEnvironment(env, () => withPersonalChatEnvironment(env, () => withPostgres(pool, () => action(postgresDatabase(pool)))))); }
  finally { await pool.end(); }
}

const integrationsWorker = {
  async scheduled(_controller: unknown, env: Env) {
    return observeSchedule('lume-integrations-schedule', async () => {
    await withDatabase(env, async db => {
      await runWhatsAppPass({ max: 5 });
      await runPersonalEmailPass({ max: 5 });
      await runEdgeMaintenance(db);
      // Leave headroom under the Cron CPU budget; the next minute continues from PostgreSQL.
      await drainEdgeJobs(db, 20, Date.now() + 20_000);
    });
    await env.INTEGRATIONS_QUEUE.send({ kind: 'sweep' });
    });
  },

  async queue(batch: QueueBatch, env: Env) {
    await withDatabase(env, async db => {
      for (const message of batch.messages) {
        try { await runWhatsAppPass({ max: 5 }); await runPersonalEmailPass({ max: 5 }); await drainEdgeJobs(db, 10, Date.now() + 20_000); message.ack(); }
        catch (error) { captureOperationalError(error, 'integrations.queue'); message.retry(); }
      }
    });
  },

  async fetch() {
    // Google push notifications are received by the web app route; this Worker has no public surface.
    return new Response('Not found', { status: 404 });
  },
};

export default withSentry<Env>(env => serverOptions('integrations-worker', env), integrationsWorker);
