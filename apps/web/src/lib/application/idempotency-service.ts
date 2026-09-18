import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from './context';

/** Stable hash at every depth: reordered keys are the same request, a changed value is not. */
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
/**
 * Replays the stored response only for the same person, the same capability and the same
 * arguments. Scoping the lookup to the office alone would let one member replay another's key
 * and read their response body, and ignoring the hash would return a stale result for a
 * genuinely different request.
 */
export function withIdempotency<T>(
  context: WorkspaceContext,
  capabilityName: string,
  idempotencyKey: string | undefined,
  input: unknown,
  execute: () => Promise<T> | T,
): Promise<T> | T {
  if (!idempotencyKey) return execute();

  const hash = inputHash(capabilityName, input);
  const scopedKey = `${context.userId}:${idempotencyKey}`;

  const existing = database.prepare(
    'SELECT capability_name, input_hash, response_payload FROM capability_idempotency WHERE office_id=? AND idempotency_key=?',
  ).get(context.officeId, scopedKey) as { capability_name: string; input_hash: string; response_payload: string } | undefined;

  if (existing) {
    if (existing.capability_name !== capabilityName || existing.input_hash !== hash) {
      throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada com outros argumentos.');
    }
    return JSON.parse(existing.response_payload) as T;
  }

  const save = (result: T): T => {
    try {
      database.prepare(`
        INSERT INTO capability_idempotency (id, office_id, user_id, idempotency_key, capability_name, input_hash, response_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), context.officeId, context.userId, scopedKey, capabilityName, hash, JSON.stringify(result));
    } catch {
      // Lost the insert race: the winner's response is the answer, provided it is the same request.
      const concurrent = database.prepare(
        'SELECT capability_name, input_hash, response_payload FROM capability_idempotency WHERE office_id=? AND idempotency_key=?',
      ).get(context.officeId, scopedKey) as { capability_name: string; input_hash: string; response_payload: string } | undefined;
      if (concurrent) {
        if (concurrent.capability_name !== capabilityName || concurrent.input_hash !== hash) {
          throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada com outros argumentos.');
        }
        return JSON.parse(concurrent.response_payload) as T;
      }
    }
    return result;
  };

  const raw = execute();
  return raw instanceof Promise ? raw.then(save) : save(raw);
}
