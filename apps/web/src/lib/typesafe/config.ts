import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { encryptCredential, credentialHint, parseCredentialKeyring } from '@/lib/platform-crypto';
import { AiConnectionError } from '@/lib/ai-connections-core';
import { assertPlatformAdmin } from '@/lib/platform-core';
import { connectionSettings, type ConnectionSettings, type ConnectionView, type DecisionMode } from './contracts';
export type ConnectionRow = {
  encrypted_api_key: string | null; key_hint: string; model: string; enabled: number;
  rag_mode: DecisionMode; documents_mode: DecisionMode; agenda_mode: DecisionMode; research_mode: DecisionMode; feedback_mode: DecisionMode; email_mode: DecisionMode;
  daily_tokens: number; concurrency: number; version: number; failures: number; circuit_until: number;
};
/**
 * The single platform connection. Until one is saved, the most recently updated office connection
 * that holds a key is adopted as-is, so an existing key keeps working without being typed again.
 */
export async function getConnection(db: Database = database) {
  const row = await db.prepare('SELECT * FROM typesafe_platform_connection WHERE id=1').get<ConnectionRow>();
  if (row) return row;
  await db.prepare(`INSERT INTO typesafe_platform_connection(id,encrypted_api_key,key_hint,model,enabled,rag_mode,documents_mode,agenda_mode,research_mode,concurrency,adopted_from_office_id)
    SELECT 1,encrypted_api_key,key_hint,model,enabled,rag_mode,documents_mode,agenda_mode,research_mode,concurrency,office_id FROM typesafe_connection
    WHERE encrypted_api_key IS NOT NULL ORDER BY enabled DESC, updated_at DESC LIMIT 1
    ON CONFLICT(id) DO NOTHING`).run();
  return db.prepare('SELECT * FROM typesafe_platform_connection WHERE id=1').get<ConnectionRow>();
}
export async function connectionView(db: Database = database): Promise<ConnectionView> {
  const row = await getConnection(db);
  return row ? { model: row.model, enabled: Boolean(row.enabled), rag: row.rag_mode, documents: row.documents_mode,
    agenda: row.agenda_mode, research: row.research_mode, feedback: row.feedback_mode, email: row.email_mode, dailyTokens: row.daily_tokens, concurrency: row.concurrency, version: row.version,
    keyHint: row.key_hint, hasKey: Boolean(row.encrypted_api_key) }
    : { ...connectionSettings.parse({ version: 0 }), keyHint: '', hasKey: false };
}
export async function saveConnection(actor: string, raw: ConnectionSettings, db: Database = database) {
  await assertPlatformAdmin(db, actor);
  const input = connectionSettings.parse(raw);
  const previous = await getConnection(db);
  if ((previous?.version ?? 0) !== input.version) throw new AiConnectionError('conflict', 'A conexão mudou. Atualize antes de salvar.');
  if (!previous?.encrypted_api_key && !input.apiKey) throw new AiConnectionError('invalid', 'Informe a chave da API.');
  const secret = input.apiKey ? encryptCredential(input.apiKey, parseCredentialKeyring()) : previous!.encrypted_api_key;
  const hint = input.apiKey ? credentialHint(input.apiKey) : previous!.key_hint;
  const result = await db.prepare(`INSERT INTO typesafe_platform_connection(id,encrypted_api_key,key_hint,model,enabled,rag_mode,documents_mode,agenda_mode,research_mode,feedback_mode,email_mode,daily_tokens,concurrency)
    VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key,key_hint=excluded.key_hint,
    model=excluded.model,enabled=excluded.enabled,rag_mode=excluded.rag_mode,documents_mode=excluded.documents_mode,agenda_mode=excluded.agenda_mode,research_mode=excluded.research_mode,
    feedback_mode=excluded.feedback_mode,email_mode=excluded.email_mode,daily_tokens=excluded.daily_tokens,concurrency=excluded.concurrency,version=typesafe_platform_connection.version+1,failures=0,circuit_until=0,updated_at=CURRENT_TIMESTAMP
    WHERE typesafe_platform_connection.version=?`).run(secret, hint, input.model, Number(input.enabled), input.rag, input.documents, input.agenda, input.research, input.feedback, input.email, input.dailyTokens, input.concurrency, input.version);
  if (!result.changes) throw new AiConnectionError('conflict', 'A conexão mudou. Atualize antes de salvar.');
  await db.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)')
    .run(randomUUID(), actor, null, 'typesafe.configured', JSON.stringify({ model: input.model, enabled: input.enabled, rag: input.rag, documents: input.documents, agenda: input.agenda, research: input.research, feedback: input.feedback, email: input.email }));
  return connectionView(db);
}
export async function removeConnection(actor: string, db: Database = database) {
  await assertPlatformAdmin(db, actor);
  // Materialize first: removing must not let a later read adopt an office key again.
  await getConnection(db);
  await db.batch([
    db.prepare(`INSERT INTO typesafe_platform_connection(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET encrypted_api_key=NULL,key_hint='',enabled=0,
      version=typesafe_platform_connection.version+1,updated_at=CURRENT_TIMESTAMP`).bind(),
    db.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action) VALUES(?,?,?,?)').bind(randomUUID(), actor, null, 'typesafe.removed'),
  ]);
}
