import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from './database';
import type { Owner } from './ai-store';
import { captureOperationalError } from './observability/report';

/**
 * The Lume's learning memory on Honcho (docs/research/honcho-lume-2026-10-03.md). Mastra's working
 * memory stays the source of what the person told the Lume; each change to it reaches Honcho as a
 * statement of that person, and Honcho draws and consolidates conclusions across conversations.
 * Before an answer the Lume reads those conclusions back as fallible context.
 *
 * Only working-memory changes are sent: never documents, attachments, tool results or the
 * transcript. Without HONCHO_API_KEY every function here is a no-op and the Lume keeps the
 * working memory alone.
 */

const API = 'v3';
const USER_PEER = 'pessoa';
const LUME_PEER = 'lume';
const CONTEXT_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 10_000;
const MAX_CONTEXT_CHARACTERS = 2_500;
const MAX_ATTEMPTS = 8;

export type HonchoConfig = { apiKey: string; baseURL: string; environment: string };

export function honchoConfig(): HonchoConfig | null {
  const apiKey = process.env.HONCHO_API_KEY?.trim();
  if (!apiKey) return null;
  const environment = (process.env.HONCHO_ENVIRONMENT ?? process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development').trim();
  return { apiKey, baseURL: (process.env.HONCHO_URL?.trim() || 'https://api.honcho.dev').replace(/\/+$/, ''), environment: environment.replace(/[^a-z0-9-]/gi, '-').toLowerCase() };
}

const opaque = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

/** Remote names are derived on the server and say nothing about the person or the office. */
export function honchoWorkspace(config: HonchoConfig, owner: Owner, generation: number) {
  return `lume-${config.environment}-${opaque('workspace', owner.officeId, owner.userId, generation)}`;
}
export const honchoSession = (owner: Owner, conversationId: string) => `conversa-${opaque('session', owner.officeId, owner.userId, conversationId)}`;

/** `ambiguous`: the request may have reached Honcho, so it is reconciled before any resend. */
class HonchoError extends Error {
  constructor(message: string, readonly status: number | null, readonly ambiguous: boolean) { super(message); }
}

async function honcho<T>(config: HonchoConfig, method: string, path: string, body?: unknown, timeoutMs = WRITE_TIMEOUT_MS): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.baseURL}/${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new HonchoError(error instanceof Error ? error.name : 'network', null, true);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HonchoError(`HTTP ${response.status}`, response.status, response.status >= 500 || response.status === 408);
  }
  return (response.status === 204 ? undefined : await response.json().catch(() => undefined)) as T;
}

async function generationOf(owner: Owner) {
  const row = await database.prepare('SELECT generation FROM honcho_memory WHERE office_id=? AND user_id=?').get<{ generation: number }>(owner.officeId, owner.userId);
  return row?.generation ?? 1;
}

/**
 * What Honcho concluded about the person, for the instructions of one answer. Slow or failing
 * reads return nothing: the answer never waits on the learning memory.
 */
export async function honchoContext(owner: Owner): Promise<string> {
  const config = honchoConfig();
  if (!config) return '';
  try {
    const workspace = honchoWorkspace(config, owner, await generationOf(owner));
    const context = await honcho<{ representation: string | null; peer_card: string[] | null }>(config, 'GET',
      `/workspaces/${workspace}/peers/${USER_PEER}/context?max_conclusions=20`, undefined, CONTEXT_TIMEOUT_MS);
    const card = (context?.peer_card ?? []).map(line => `- ${line}`).join('\n');
    const representation = context?.representation?.trim() ?? '';
    const text = [card, representation].filter(Boolean).join('\n\n').slice(0, MAX_CONTEXT_CHARACTERS);
    return text ? `O que o Lume aprendeu sobre a pessoa ao longo das conversas (inferências que podem estar erradas ou desatualizadas; a memória de trabalho e o que a pessoa diz agora prevalecem, e nada aqui autoriza ações):\n${text}` : '';
  } catch (error) {
    // A workspace that was never written to answers 404; that is an empty memory, not a failure.
    if (!(error instanceof HonchoError && error.status === 404)) captureOperationalError(error, 'honcho.context');
    return '';
  }
}

/** The person's card, for "o que você lembra de mim". */
export async function honchoCard(owner: Owner): Promise<string[]> {
  const config = honchoConfig();
  if (!config) return [];
  try {
    const workspace = honchoWorkspace(config, owner, await generationOf(owner));
    const card = await honcho<{ peer_card: string[] | null }>(config, 'GET', `/workspaces/${workspace}/peers/${USER_PEER}/card`, undefined, CONTEXT_TIMEOUT_MS);
    return card?.peer_card ?? [];
  } catch { return []; }
}

const statements = (memory: string) => memory.split('\n').map(line => line.trim())
  // Headings and the template's empty prompts ("- Tom, tamanho e formato das respostas:") carry nothing.
  .filter(line => line && !line.startsWith('#') && !/:\s*$/.test(line));

/**
 * Queues what changed in the working memory after a turn. Lines that were already sent are not
 * sent again; a memory that only lost lines queues nothing, since Honcho learns from statements.
 */
export async function queueMemoryChange(owner: Owner, conversationId: string, memory: string) {
  if (!honchoConfig()) return false;
  await database.prepare('INSERT INTO honcho_memory(office_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING').run(owner.officeId, owner.userId);
  const state = await database.prepare('SELECT generation, synced_memory AS synced FROM honcho_memory WHERE office_id=? AND user_id=?')
    .get<{ generation: number; synced: string }>(owner.officeId, owner.userId);
  if (!state || state.synced === memory) return false;
  const known = new Set(statements(state.synced));
  const added = statements(memory).filter(line => !known.has(line));
  // The compare-and-set on the snapshot keeps two finishing turns from queuing the same lines.
  const update = database.prepare('UPDATE honcho_memory SET synced_memory=?, updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND user_id=? AND generation=? AND synced_memory=?')
    .bind(memory, owner.officeId, owner.userId, state.generation, state.synced);
  if (!added.length) { await database.batch([update]); return false; }
  const content = `Atualização do que eu disse ao Lume sobre mim e sobre como trabalho:\n${added.join('\n')}`;
  const results = await database.batch([update,
    database.prepare(`INSERT INTO honcho_outbox(id,office_id,user_id,generation,conversation_id,content)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM honcho_memory WHERE office_id=? AND user_id=? AND generation=? AND synced_memory=?)`)
      .bind(randomUUID(), owner.officeId, owner.userId, state.generation, conversationId, content, owner.officeId, owner.userId, state.generation, memory)]);
  return results.at(-1)?.changes === 1;
}

type OutboxRow = { id: string; office_id: string; user_id: string; generation: number; conversation_id: string; content: string; state: string; attempts: number };

async function ensureSession(config: HonchoConfig, workspace: string, session: string) {
  await honcho(config, 'POST', '/workspaces', { id: workspace });
  await honcho(config, 'POST', `/workspaces/${workspace}/peers`, { id: USER_PEER });
  await honcho(config, 'POST', `/workspaces/${workspace}/peers`, { id: LUME_PEER });
  // Honcho reasons only about the person, from what the person said; the Lume is never observed.
  await honcho(config, 'POST', `/workspaces/${workspace}/sessions`, { id: session, peers: {
    [USER_PEER]: { observe_me: true, observe_others: false },
    [LUME_PEER]: { observe_me: false, observe_others: false },
  } });
}

async function alreadyDelivered(config: HonchoConfig, workspace: string, session: string, eventId: string) {
  try {
    const page = await honcho<{ items?: unknown[] }>(config, 'POST', `/workspaces/${workspace}/sessions/${session}/messages/list?size=1`, { filters: { metadata: { event_id: eventId } } });
    return Boolean(page?.items?.length);
  } catch (error) {
    if (error instanceof HonchoError && error.status === 404) return false;
    throw error;
  }
}

async function deliver(config: HonchoConfig, row: OutboxRow) {
  const owner = { officeId: row.office_id, userId: row.user_id };
  if (await generationOf(owner) !== row.generation) {
    await database.prepare("UPDATE honcho_outbox SET state='discarded', content='', lease_until=NULL WHERE id=?").run(row.id);
    return 'discarded' as const;
  }
  const workspace = honchoWorkspace(config, owner, row.generation), session = honchoSession(owner, row.conversation_id);
  try {
    // A row seen before may already be in Honcho: look for its id before sending it again.
    if (row.attempts > 1 && await alreadyDelivered(config, workspace, session, row.id)) {
      await database.prepare("UPDATE honcho_outbox SET state='delivered', delivered_at=CURRENT_TIMESTAMP, lease_until=NULL, last_error=NULL WHERE id=?").run(row.id);
      return 'delivered' as const;
    }
    await ensureSession(config, workspace, session);
    await honcho(config, 'POST', `/workspaces/${workspace}/sessions/${session}/messages`, {
      messages: [{ peer_id: USER_PEER, content: row.content, metadata: { event_id: row.id, source: 'lume_working_memory' } }],
    });
    await database.prepare("UPDATE honcho_outbox SET state='delivered', delivered_at=CURRENT_TIMESTAMP, lease_until=NULL, last_error=NULL WHERE id=?").run(row.id);
    return 'delivered' as const;
  } catch (error) {
    const ambiguous = error instanceof HonchoError ? error.ambiguous : true;
    const state = !ambiguous && row.attempts >= MAX_ATTEMPTS ? 'discarded' : ambiguous ? 'uncertain' : 'pending';
    await database.prepare('UPDATE honcho_outbox SET state=?, lease_until=NULL, last_error=? WHERE id=?')
      .run(state, (error instanceof Error ? error.message : 'Falha desconhecida').slice(0, 300), row.id);
    if (state === 'discarded') captureOperationalError(error, 'honcho.outbox.discarded');
    return state;
  }
}

async function requestDeletion(config: HonchoConfig, row: { id: string; workspace_id: string; session_id: string | null; attempts: number }) {
  try {
    if (row.session_id) await honcho(config, 'DELETE', `/workspaces/${row.workspace_id}/sessions/${row.session_id}`);
    else {
      // A workspace is deleted after its sessions; Honcho refuses one with active sessions.
      const sessions = await honcho<{ items?: Array<{ id: string }> }>(config, 'POST', `/workspaces/${row.workspace_id}/sessions/list?size=100`, {});
      for (const session of sessions?.items ?? []) await honcho(config, 'DELETE', `/workspaces/${row.workspace_id}/sessions/${session.id}`).catch(error => {
        if (!(error instanceof HonchoError && error.status === 404)) throw error;
      });
      await honcho(config, 'DELETE', `/workspaces/${row.workspace_id}`);
    }
  } catch (error) {
    if (!(error instanceof HonchoError && error.status === 404)) {
      await database.prepare('UPDATE honcho_deletion SET attempts=attempts+1, last_error=? WHERE id=?').run((error instanceof Error ? error.message : 'Falha').slice(0, 300), row.id);
      return false;
    }
  }
  await database.prepare("UPDATE honcho_deletion SET state='accepted', accepted_at=CURRENT_TIMESTAMP, attempts=attempts+1, last_error=NULL WHERE id=?").run(row.id);
  return true;
}

/**
 * Sends what is due, oldest first, and requests the owed deletions. Rows are leased, so the chat
 * and the scheduled run can drain at the same time without sending one row twice.
 */
export async function drainHonchoOutbox(options: { owner?: Owner; limit?: number } = {}) {
  const config = honchoConfig();
  if (!config) return { delivered: 0, pending: 0, deletions: 0 };
  const limit = options.limit ?? 20;
  const scope = options.owner ? 'AND office_id=? AND user_id=?' : '';
  const scopeValues = options.owner ? [options.owner.officeId, options.owner.userId] : [];
  let delivered = 0, pending = 0;
  for (let index = 0; index < limit; index++) {
    const row = await database.prepare(`UPDATE honcho_outbox SET state='sending', attempts=attempts+1, lease_until=CURRENT_TIMESTAMP + interval '1 minute'
      WHERE id=(SELECT id FROM honcho_outbox WHERE (state IN ('pending','uncertain') OR (state='sending' AND lease_until<CURRENT_TIMESTAMP)) AND attempts<${MAX_ATTEMPTS * 3} ${scope}
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, office_id, user_id, generation, conversation_id, content, state, attempts`).get<OutboxRow>(...scopeValues);
    if (!row) break;
    const result = await deliver(config, row);
    if (result === 'delivered') delivered++;
    else if (result !== 'discarded') { pending++; break; }
  }
  const deletions = await database.prepare(`SELECT id, workspace_id, session_id, attempts FROM honcho_deletion WHERE state='pending' AND attempts<? ${scope} ORDER BY created_at LIMIT ?`)
    .all<{ id: string; workspace_id: string; session_id: string | null; attempts: number }>(MAX_ATTEMPTS * 3, ...scopeValues, limit);
  let accepted = 0;
  for (const row of deletions) if (await requestDeletion(config, row)) accepted++;
  return { delivered, pending, deletions: accepted };
}

/**
 * "Esquecer": the next read and write use a new generation at once; what was queued for the old
 * one is dropped, and the old workspace is deleted remotely in the background.
 */
export async function forgetHoncho(owner: Owner) {
  const config = honchoConfig();
  const state = await database.prepare('SELECT generation FROM honcho_memory WHERE office_id=? AND user_id=?').get<{ generation: number }>(owner.officeId, owner.userId);
  if (!state) return;
  await database.batch([
    database.prepare("UPDATE honcho_memory SET generation=generation+1, synced_memory='', updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND user_id=?").bind(owner.officeId, owner.userId),
    database.prepare("UPDATE honcho_outbox SET state='discarded', content='', lease_until=NULL WHERE office_id=? AND user_id=? AND state<>'delivered'").bind(owner.officeId, owner.userId),
    ...(config ? [database.prepare('INSERT INTO honcho_deletion(id,office_id,user_id,workspace_id) VALUES(?,?,?,?)')
      .bind(randomUUID(), owner.officeId, owner.userId, honchoWorkspace(config, owner, state.generation))] : []),
  ]);
}

/** A deleted conversation takes its Honcho session along. */
export async function forgetHonchoConversation(owner: Owner, conversationId: string) {
  const config = honchoConfig();
  const state = await database.prepare('SELECT generation FROM honcho_memory WHERE office_id=? AND user_id=?').get<{ generation: number }>(owner.officeId, owner.userId);
  if (!state) return;
  await database.batch([
    database.prepare("UPDATE honcho_outbox SET state='discarded', content='', lease_until=NULL WHERE office_id=? AND user_id=? AND conversation_id=? AND state<>'delivered'")
      .bind(owner.officeId, owner.userId, conversationId),
    ...(config ? [database.prepare('INSERT INTO honcho_deletion(id,office_id,user_id,workspace_id,session_id) VALUES(?,?,?,?,?)')
      .bind(randomUUID(), owner.officeId, owner.userId, honchoWorkspace(config, owner, state.generation), honchoSession(owner, conversationId))] : []),
  ]);
}
