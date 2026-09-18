import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { UIMessage } from 'ai';

export type Owner = { officeId: string; userId: string };
export type RunRow = { id: string; office_id: string; user_id: string; kind: 'chronology' | 'draft'; input: string; status: string; progress: number; error: string | null; artifact_id: string | null; lease_token: string; attempts: number; created_at: string };
export type ArtifactRow = { id: string; office_id: string; user_id: string; title: string; content: string; version: number; status: string; source_refs: string; validation_issues: string; template_id: string | null; run_id: string };

export function createConversation(db: DatabaseSync, owner: Owner) {
  const id = randomUUID();
  db.prepare('INSERT INTO ai_conversation(id,office_id,user_id,title) VALUES(?,?,?,?)').run(id, owner.officeId, owner.userId, 'Nova conversa');
  return { id, title: 'Nova conversa', updatedAt: new Date().toISOString() };
}
export function conversation(db: DatabaseSync, owner: Owner, id: string) {
  const row = db.prepare('SELECT id,title,updated_at AS updatedAt,messages FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as { id: string; title: string; updatedAt: string; messages: string } | undefined;
  return row ? { conversation: { id: row.id, title: row.title, updatedAt: row.updatedAt }, messages: JSON.parse(row.messages) as UIMessage[] } : null;
}
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
export function saveMessages(db: DatabaseSync, owner: Owner, id: string, messages: UIMessage[]) {
  const first = messages.find(m => m.role === 'user')?.parts.find(p => p.type === 'text');
  const title = first?.type === 'text' ? first.text.slice(0, 80) : 'Nova conversa';
  db.prepare('UPDATE ai_conversation SET messages=?,title=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND user_id=?').run(JSON.stringify(messages), title, id, owner.officeId, owner.userId);
}
export function claimRun(db: DatabaseSync): RunRow | undefined {
  const now = Date.now();
  const token = randomUUID();
  return db.prepare(`UPDATE ai_run SET status='running',lease_until=?,lease_token=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM ai_run WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<5 ORDER BY created_at LIMIT 1)
    RETURNING *`).get(now + 300_000, token, now) as RunRow | undefined;
}
export function ownedRun(db: DatabaseSync, owner: Owner, id: string) {
  return db.prepare('SELECT * FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as RunRow | undefined;
}
export function publicRun(row: RunRow) {
  return { id: row.id, kind: row.kind, status: row.status, progress: row.progress, error: row.error, artifactId: row.artifact_id, createdAt: row.created_at };
}
export function ownedArtifact(db: DatabaseSync, owner: Owner, id: string) {
  return db.prepare('SELECT * FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?').get(id, owner.officeId, owner.userId) as ArtifactRow | undefined;
}
export function publicArtifact(row: ArtifactRow) {
  return { id: row.id, title: row.title, content: row.content, version: row.version, status: row.status, references: JSON.parse(row.source_refs), validationIssues: JSON.parse(row.validation_issues) };
}
export function updateArtifact(db: DatabaseSync, owner: Owner, id: string, title: string, content: string, version: number) {
  db.exec('SAVEPOINT artifact_edit');
  try {
    const row = db.prepare(`UPDATE ai_artifact SET title=?,content=?,version=version+1,status='needs_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND user_id=? AND version=? RETURNING *`).get(title, content, id, owner.officeId, owner.userId, version) as ArtifactRow | undefined;
    if (!row) { db.exec('RELEASE artifact_edit'); return null; }
    db.prepare('INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id) VALUES(?,?,?,?,?)').run(id, row.version, title, content, owner.userId);
    db.exec('RELEASE artifact_edit');
    return row;
  } catch (error) { db.exec('ROLLBACK TO artifact_edit; RELEASE artifact_edit'); throw error; }
}
