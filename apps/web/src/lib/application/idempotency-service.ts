import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from './context';
import { assertWorkspaceSession } from './context';
import type { ReplayBinding } from './capability-replay';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => item !== undefined && key !== 'idempotencyKey')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function inputHash(capabilityName: string, input: unknown) {
  return createHash('sha256').update(`${capabilityName}\u0000${JSON.stringify(canonicalize(input))}`).digest('hex');
}

/**
 * Replays the stored response only for the same person, the same capability and the same
 * arguments. Scoping the lookup to the office alone would let one member replay another's key
 * and read their response body, and ignoring the hash would return a stale result for a
 * genuinely different request.
 */
export async function withIdempotency<T>(
  context: WorkspaceContext,
  capabilityName: string,
  idempotencyKey: string | undefined,
  input: unknown,
  execute: () => Promise<T>,
  capture: (result: T) => Promise<ReplayBinding>,
  replay: (result: T, binding: unknown) => Promise<T>,
): Promise<T> {
  if (!idempotencyKey) return execute();

  const hash = inputHash(capabilityName, input);
  const scopedKey = `${context.userId}:${idempotencyKey}`;

  const id = randomUUID();
  const claimed = await database.prepare(`INSERT INTO capability_idempotency
    (id,office_id,user_id,idempotency_key,capability_name,input_hash,state,response_payload)
    VALUES(?,?,?,?,?,?,'pending',NULL) ON CONFLICT(office_id,idempotency_key) DO NOTHING`).run(id, context.officeId, context.userId, scopedKey, capabilityName, hash);
  if (!claimed.changes) {
    for (let check = 0; check < 600; check++) {
      await assertWorkspaceSession(context);
      const existing = await database.prepare(`SELECT capability_name,input_hash,state,response_payload,replay_binding
        FROM capability_idempotency WHERE office_id=? AND user_id=? AND idempotency_key=?`)
        .get<{ capability_name: string; input_hash: string; state: string; response_payload: string | null; replay_binding: unknown }>(context.officeId, context.userId, scopedKey);
      if (!existing) throw new CapabilityError('CONFLICT', 'A operação foi interrompida antes de concluir.');
      if (existing.capability_name !== capabilityName || existing.input_hash !== hash)
        throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada com outros argumentos.');
      if (existing.state === 'completed' && existing.response_payload !== null) return replay(JSON.parse(existing.response_payload) as T, existing.replay_binding);
      if (existing.state !== 'pending') throw new CapabilityError('CONFLICT', 'O resultado desta operação precisa ser conferido antes de repetir a alteração.');
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    throw new CapabilityError('CONFLICT', 'A operação ainda está em andamento. Tente recuperar o resultado em instantes.');
  }
  try {
    const result = await execute();
    const binding = await capture(result);
    await assertWorkspaceSession(context);
    await database.prepare(`UPDATE capability_idempotency SET state='completed',response_payload=?,replay_binding=?::jsonb WHERE id=? AND state='pending'`)
      .run(JSON.stringify(result), JSON.stringify(binding), id);
    return replay(result, binding);
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'APPROVAL_REQUIRED') await database.prepare('DELETE FROM capability_idempotency WHERE id=? AND state=\'pending\'').run(id);
    else await database.prepare("UPDATE capability_idempotency SET state='unknown' WHERE id=? AND state='pending'").run(id);
    throw error;
  }
}
