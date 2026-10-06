import { DurableObject } from 'cloudflare:workers';
import { instrumentDurableObjectWithSentry } from '@sentry/cloudflare';
import { serverOptions } from '../lib/observability/options';
import { withPostgres } from '../lib/database';
import { createPostgresPool } from '../lib/db/postgres';
import { captureOperationalError } from '../lib/observability/report';
import { executeChatRun, followable, nextRun, type ChatRun } from '../lib/chat-run';
import type { ChatTurn } from '../lib/chat-turn';
import { withWhatsAppEnvironment, type WhatsAppEnvironment } from '../lib/whatsapp/environment';
import { withTrademarkEnvironment } from '../lib/research/trademarks/environment';

type ChatRunEnv = CloudflareEnv & WhatsAppEnvironment & { HYPERDRIVE: { connectionString: string } };

/**
 * One Durable Object per conversation holds its turn in flight. A Worker request is cancelled when
 * the browser disconnects; a Durable Object stays active while its I/O is pending, so the agent
 * runs to the end and stores the answer after the page closes. The chat routes check ownership
 * before reaching this object, and address it by the conversation id.
 */
class ChatRunObject extends DurableObject<ChatRunEnv> {
  private run: ChatRun | undefined;

  async start(turn: ChatTurn) {
    const pool = createPostgresPool(this.env.HYPERDRIVE.connectionString, { max: 3, idleTimeoutMillis: 0 });
    const run = await withPostgres(pool, () => nextRun(() => this.run, run => { this.run = run; }, turn)).catch(async error => {
      await pool.end().catch(() => undefined);
      throw error;
    });
    if (!run) { await pool.end().catch(() => undefined); return; }
    void withPostgres(pool, () => withTrademarkEnvironment(this.env, () => withWhatsAppEnvironment(this.env, () => executeChatRun(run, turn))))
      .catch(error => captureOperationalError(error, 'chat.run'))
      .finally(() => pool.end().catch(() => undefined));
  }

  follow(lastMessageId?: string) {
    return followable(this.run, lastMessageId);
  }

  cancel() {
    if (!this.run || this.run.done) return false;
    this.run.controller.abort();
    return true;
  }
}

export const LumeChatRun = instrumentDurableObjectWithSentry(
  (env: ChatRunEnv) => serverOptions('web-chat', env),
  ChatRunObject as never,
) as unknown as typeof ChatRunObject;
