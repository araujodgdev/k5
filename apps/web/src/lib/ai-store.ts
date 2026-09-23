import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import type { UIMessage } from 'ai';

export type Owner = { officeId: string; userId: string };
export type RunRow = { id: string; office_id: string; user_id: string; kind: 'chronology' | 'draft'; input: string; status: string; progress: number; error: string | null; artifact_id: string | null; lease_token: string; attempts: number; model_provider: string | null; model_id: string | null; created_at: string };
export type ArtifactRow = { id: string; office_id: string; user_id: string; title: string; content: string; version: number; status: string; source_refs: string; validation_issues: string; template_id: string | null; run_id: string | null;
  kind: 'draft' | 'chronology' | 'document'; conversation_id: string | null; created_by_agent: boolean };

export async function createConversation(db: Database, owner: Owner) {
  const id = randomUUID();
  await db.prepare('INSERT INTO ai_conversation(id,office_id,user_id,title) VALUES(?,?,?,?)').run(id, owner.officeId, owner.userId, 'Nova conversa');
  return { id, title: 'Nova conversa', updatedAt: new Date().toISOString() };
}
export async function conversation(db: Database, owner: Owner, id: string) {
  const row = await db.prepare('SELECT id,title,updated_at AS updatedAt,messages FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as { id: string; title: string; updatedAt: string; messages: string } | undefined;
  return row ? { conversation: { id: row.id, title: row.title, updatedAt: row.updatedAt }, messages: JSON.parse(row.messages) as UIMessage[] } : null;
}

/** Read-only initial chat state. Both the list and a deep link are scoped to the session owner. */
export async function conversationBootstrap(db: Database, owner: Owner, preferredId = '') {
  const conversations = await db.prepare(
    'SELECT id,title,updated_at AS updatedAt FROM ai_conversation WHERE office_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 50'
  ).all(owner.officeId, owner.userId) as Array<{ id: string; title: string; updatedAt: string }>;
  const preferred = preferredId ? await conversation(db, owner, preferredId) : null;
  const selected = preferred ?? (conversations[0] ? await conversation(db, owner, conversations[0].id) : null);
  if (preferred && !conversations.some(item => item.id === preferred.conversation.id)) conversations.push(preferred.conversation);
  return { conversations, conversation: selected?.conversation ?? null, messages: selected?.messages ?? [] };
}

export type ChatBootstrap = Awaited<ReturnType<typeof conversationBootstrap>>;
/**
 * Merges an incoming user message into stored history.
 * - New message id: append.
 * - Known message id (regenerate, or editing an earlier message): replace that
 *   message in place and drop everything after it (e.g. the stale assistant reply),
 *   so retries never duplicate the user turn.
 */
export function mergeHistory(stored: UIMessage[], incoming: UIMessage): UIMessage[] {
  const index = stored.findIndex(m => m.id === incoming.id);
  if (index === -1) return [...stored, incoming];
  return [...stored.slice(0, index), incoming];
}
export async function saveMessages(db: Database, owner: Owner, id: string, messages: UIMessage[]) {
  const first = messages.find(m => m.role === 'user')?.parts.find(p => p.type === 'text');
  const title = first?.type === 'text' ? first.text.slice(0, 80) : 'Nova conversa';
  await db.prepare('UPDATE ai_conversation SET messages=?,title=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND user_id=?').run(JSON.stringify(messages), title, id, owner.officeId, owner.userId);
}
export async function claimRun(db: Database): Promise<RunRow | undefined> {
  const now = Date.now();
  const token = randomUUID();
  return await db.prepare(`UPDATE ai_run SET status='running',lease_until=?,lease_token=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM ai_run WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<5 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`).get(now + 300_000, token, now) as RunRow | undefined;
}
export async function ownedRun(db: Database, owner: Owner, id: string) {
  return await db.prepare('SELECT * FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as RunRow | undefined;
}
export function publicRun(row: RunRow) {
  return { id: row.id, kind: row.kind, status: row.status, progress: row.progress, error: row.error, artifactId: row.artifact_id, createdAt: row.created_at };
}
export async function ownedArtifact(db: Database, owner: Owner, id: string) {
  return await db.prepare('SELECT * FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as ArtifactRow | undefined;
}
export function publicArtifact(row: ArtifactRow) {
  return { id: row.id, title: row.title, content: row.content, version: row.version, status: row.status, references: JSON.parse(row.source_refs), validationIssues: JSON.parse(row.validation_issues),
    kind: row.kind, conversationId: row.conversation_id };
}
/**
 * Saves an edit, or returns null when someone else saved first.
 *
 * Lock the artifact before recording history and replacing it, in one PostgreSQL transaction.
 * A concurrent save loses with a version conflict; any failure rolls the entire batch back.
 */
export async function updateArtifact(db: Database, owner: Owner, id: string, title: string, content: string, version: number, options: { snapshot?: boolean } = {}) {
  const current = await db.prepare('SELECT * FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? AND version=?')
    .get(id, owner.officeId, owner.userId, version) as ArtifactRow | undefined;
  if (!current) return null;
  // Every save bumps the version, which is what detects concurrent edits. The history row is
  // written on explicit saves and agent edits, and for autosave at most once per five minutes, so
  // typing does not bury the versions someone would actually want back.
  const snapshot = options.snapshot ?? true;

  const [, , , updated] = await db.batch([
    db.prepare('SELECT id FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
      .bind(id, owner.officeId, owner.userId),
    // Autosaves may have advanced beyond the last history row. Preserve that text before an
    // explicit replacement (including restore and agent edits), so the user can undo it.
    db.prepare(`INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id)
      SELECT id,version,title,content,user_id FROM ai_artifact
      WHERE id=? AND office_id=? AND user_id=? AND version=? AND ?::boolean
      ON CONFLICT (artifact_id,version) DO NOTHING`)
      .bind(id, owner.officeId, owner.userId, version, snapshot),
    db.prepare(`INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id)
      SELECT id,version+1,?,?,? FROM ai_artifact
      WHERE id=? AND office_id=? AND user_id=? AND version=?
        AND (?::boolean OR NOT EXISTS (SELECT 1 FROM ai_artifact_version WHERE artifact_id=? AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'))`)
      .bind(title, content, owner.userId, id, owner.officeId, owner.userId, version, snapshot, id),
    db.prepare(`UPDATE ai_artifact SET title=?,content=?,version=version+1,status='needs_review',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND office_id=? AND user_id=? AND version=?`)
      .bind(title, content, id, owner.officeId, owner.userId, version),
  ]);
  if (updated.changes !== 1) return null;
  return { ...current, title, content, version: version + 1, status: 'needs_review' };
}
