import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { encryptCredential, credentialHint, parseCredentialKeyring } from '@/lib/platform-crypto';
import { AiConnectionError } from '@/lib/ai-connections-core';
import { assertPlatformAdmin } from '@/lib/platform-core';
import { connectionSettings, type ConnectionSettings, type ConnectionView, type DecisionMode } from './contracts';

export type ConnectionRow = {
  office_id: string; encrypted_api_key: string | null; key_hint: string; model: string; enabled: number;
  rag_mode: DecisionMode; documents_mode: DecisionMode; agenda_mode: DecisionMode; research_mode: DecisionMode;
  daily_tokens: number; concurrency: number; version: number; failures: number; circuit_until: number;
};
export function getConnection(officeId: string, db = database) {
  return db.prepare('SELECT * FROM typesafe_connection WHERE office_id=?').get<ConnectionRow>(officeId);
}
export async function connectionView(officeId: string, db = database): Promise<ConnectionView> {
  const row = await getConnection(officeId, db);
  return row ? { model: row.model, enabled: Boolean(row.enabled), rag: row.rag_mode, documents: row.documents_mode,
    agenda: row.agenda_mode, research: row.research_mode, dailyTokens: row.daily_tokens, concurrency: row.concurrency, version: row.version,
    keyHint: row.key_hint, hasKey: Boolean(row.encrypted_api_key) }
    : { ...connectionSettings.parse({ version: 0 }), keyHint: '', hasKey: false };
}
export async function saveConnection(officeId: string, actor: string, raw: ConnectionSettings, db: Database = database) {
  await assertPlatformAdmin(db, actor);
  if (!await db.prepare('SELECT 1 FROM office WHERE id=?').get(officeId)) throw new AiConnectionError('not_found', 'Escritório não encontrado.');
  const input = connectionSettings.parse(raw);
  const previous = await getConnection(officeId, db);
  if ((previous?.version ?? 0) !== input.version) throw new AiConnectionError('conflict', 'A conexão mudou. Atualize antes de salvar.');
  if (!previous?.encrypted_api_key && !input.apiKey) throw new AiConnectionError('invalid', 'Informe a chave da API.');
  const secret = input.apiKey ? encryptCredential(input.apiKey, parseCredentialKeyring()) : previous!.encrypted_api_key;
  const hint = input.apiKey ? credentialHint(input.apiKey) : previous!.key_hint;
  const result = await db.prepare(`INSERT INTO typesafe_connection(office_id,encrypted_api_key,key_hint,model,enabled,rag_mode,documents_mode,agenda_mode,research_mode,daily_tokens,concurrency)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key,key_hint=excluded.key_hint,
    model=excluded.model,enabled=excluded.enabled,rag_mode=excluded.rag_mode,documents_mode=excluded.documents_mode,agenda_mode=excluded.agenda_mode,research_mode=excluded.research_mode,
    daily_tokens=excluded.daily_tokens,concurrency=excluded.concurrency,version=typesafe_connection.version+1,failures=0,circuit_until=0,updated_at=CURRENT_TIMESTAMP
    WHERE typesafe_connection.version=?`).run(officeId, secret, hint, input.model, Number(input.enabled), input.rag, input.documents, input.agenda, input.research, input.dailyTokens, input.concurrency, input.version);
  if (!result.changes) throw new AiConnectionError('conflict', 'A conexão mudou. Atualize antes de salvar.');
  await db.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)')
    .run(randomUUID(), actor, officeId, 'typesafe.configured', JSON.stringify({ model: input.model, enabled: input.enabled, rag: input.rag, documents: input.documents, agenda: input.agenda, research: input.research }));
  return connectionView(officeId, db);
}
export async function removeConnection(officeId: string, actor: string, db = database) {
  await assertPlatformAdmin(db, actor);
  await db.batch([
    db.prepare("UPDATE typesafe_connection SET encrypted_api_key=NULL,key_hint='',enabled=0,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE office_id=?").bind(officeId),
    db.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action) VALUES(?,?,?,?)').bind(randomUUID(), actor, officeId, 'typesafe.removed'),
  ]);
}
