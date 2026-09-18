import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { WorkspaceContext } from './context';

export function withIdempotency<T>(
  context: WorkspaceContext,
  capabilityName: string,
  idempotencyKey: string | undefined,
  input: unknown,
  execute: () => T,
): T;
export function withIdempotency<T>(
  context: WorkspaceContext,
  capabilityName: string,
  idempotencyKey: string | undefined,
  input: unknown,
  execute: () => Promise<T>,
): Promise<T>;
export function withIdempotency<T>(
  context: WorkspaceContext,
  capabilityName: string,
  idempotencyKey: string | undefined,
  input: unknown,
  execute: () => Promise<T> | T,
): Promise<T> | T {
  if (!idempotencyKey) return execute();

  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const existing = database.prepare(
    'SELECT response_payload FROM capability_idempotency WHERE office_id=? AND idempotency_key=?'
  ).get(context.officeId, idempotencyKey) as { response_payload: string } | undefined;

  if (existing) {
    return JSON.parse(existing.response_payload) as T;
  }

  const savePayload = (result: T): T => {
    try {
      database.prepare(`
        INSERT INTO capability_idempotency (id, office_id, user_id, idempotency_key, capability_name, input_hash, response_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        context.officeId,
        context.userId,
        idempotencyKey,
        capabilityName,
        inputHash,
        JSON.stringify(result)
      );
    } catch {
      const concurrent = database.prepare(
        'SELECT response_payload FROM capability_idempotency WHERE office_id=? AND idempotency_key=?'
      ).get(context.officeId, idempotencyKey) as { response_payload: string } | undefined;
      if (concurrent) return JSON.parse(concurrent.response_payload) as T;
    }
    return result;
  };

  const raw = execute();
  if (raw instanceof Promise) {
    return raw.then(savePayload);
  }
  return savePayload(raw);
}
