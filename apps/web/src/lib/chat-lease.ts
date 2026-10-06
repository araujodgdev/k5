import 'server-only';
import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import { database, type Transaction } from './database';
import { conversationTitle, type Owner } from './ai-store';
import { CapabilityError } from './capabilities/errors';

export const MAX_RUNNING_TURNS_PER_USER = 3;
export const TURN_LEASE_MS = 300_000;
export const TURN_ABORT_MARGIN_MS = 60_000;

export type TurnLease = { token: string; expiresAt: number };

const CLOCK = 'WITH clock AS (SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now)';

export class TurnRefused extends CapabilityError {
  constructor(readonly reason: 'busy' | 'limit') {
    super(reason === 'busy' ? 'CONFLICT' : 'RATE_LIMITED', reason === 'busy'
      ? 'Aguarde a resposta atual.'
      : `Você já tem ${MAX_RUNNING_TURNS_PER_USER} respostas do Lume em andamento. Aguarde uma terminar ou use Parar em outra conversa.`);
  }
}

export class TurnFenced extends CapabilityError {
  constructor() { super('CONFLICT', 'Esta resposta foi substituída por outra. Reabra a conversa.'); }
}

/**
 * Takes the lease of one of the person's conversations inside the caller's transaction, so what the
 * caller wrote there is undone with a refusal. The advisory lock serializes one person's
 * admissions until the caller commits: under READ COMMITTED, two counts running side by side would
 * both see room for one more turn.
 */
export async function admitTurn(tx: Transaction, owner: Owner, conversationId: string): Promise<TurnLease> {
  await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`lume:chat-turns:${owner.userId}`);
  const row = await tx.prepare(`${CLOCK}
    SELECT clock.now, c.busy_until > clock.now AS busy,
      (SELECT count(*) FROM ai_conversation r WHERE r.user_id = ? AND r.busy_until > 0 AND r.busy_until > clock.now AND r.id <> c.id) AS running
    FROM clock, ai_conversation c WHERE c.id = ? AND c.office_id = ? AND c.user_id = ?`)
    .get<{ now: number; busy: boolean; running: number }>(owner.userId, conversationId, owner.officeId, owner.userId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
  if (row.busy) throw new TurnRefused('busy');
  if (row.running >= MAX_RUNNING_TURNS_PER_USER) throw new TurnRefused('limit');
  const lease = { token: randomUUID(), expiresAt: row.now + TURN_LEASE_MS };
  const claimed = await tx.prepare('UPDATE ai_conversation SET busy_until = ?, run_token = ? WHERE id = ? AND office_id = ? AND user_id = ? AND busy_until <= ?')
    .run(lease.expiresAt, lease.token, conversationId, owner.officeId, owner.userId, row.now);
  if (!claimed.changes) throw new TurnRefused('busy');
  return lease;
}

/** Whether the turn still holds an unexpired lease: a start that does not is refused. */
export async function holdsTurn(owner: Owner, conversationId: string, lease: TurnLease) {
  return Boolean(await database.prepare(`${CLOCK}
    SELECT 1 AS held FROM clock, ai_conversation WHERE id = ? AND office_id = ? AND user_id = ? AND run_token = ? AND busy_until > clock.now`)
    .get(conversationId, owner.officeId, owner.userId, lease.token));
}

/** Stores the history while the turn keeps its lease. False: another turn holds it, and nothing was written. */
export async function writeTurnHistory(owner: Owner, conversationId: string, lease: TurnLease, messages: UIMessage[]) {
  const result = await database.prepare('UPDATE ai_conversation SET messages = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND user_id = ? AND run_token = ?')
    .run(JSON.stringify(messages), conversationTitle(messages), conversationId, owner.officeId, owner.userId, lease.token);
  return result.changes === 1;
}

/**
 * Frees the lease, storing the final history in the same write when given. False: another turn
 * holds the conversation now, and neither its lease nor its history changed.
 */
export async function releaseTurn(owner: Owner, conversationId: string, lease: TurnLease, messages?: UIMessage[]) {
  const result = messages
    ? await database.prepare(`UPDATE ai_conversation SET busy_until = 0, run_token = NULL, messages = ?, title = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND office_id = ? AND user_id = ? AND run_token = ?`)
      .run(JSON.stringify(messages), conversationTitle(messages), conversationId, owner.officeId, owner.userId, lease.token)
    : await database.prepare('UPDATE ai_conversation SET busy_until = 0, run_token = NULL WHERE id = ? AND office_id = ? AND user_id = ? AND run_token = ?')
      .run(conversationId, owner.officeId, owner.userId, lease.token);
  return result.changes === 1;
}
