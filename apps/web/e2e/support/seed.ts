import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Writes for state the product only creates through an AI run (documents, approval cards). Anything
// with an HTTP endpoint is created through it instead, so the test exercises the real path.
async function withClient<T>(work: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

async function owner(client: pg.Client, email: string) {
  const { rows } = await client.query<{ user_id: string; office_id: string }>(
    'SELECT m.user_id, m.office_id FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE lower(u.email)=lower($1)', [email]);
  if (rows.length !== 1) throw new Error(`Esperava um escritório para ${email}, encontrei ${rows.length}.`);
  return rows[0];
}

/** Restores even migrated assignments whose inherited model has no configured connection. */
export async function preserveModelAssignment(scope: 'group' | 'task', target: string) {
  const saved = await withClient(async client => (await client.query<{ row: Record<string, unknown> }>(
    'SELECT row_to_json(a) AS row FROM ai_model_assignment a WHERE scope=$1 AND target=$2', [scope, target],
  )).rows[0]?.row);
  return () => withClient(async client => {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM ai_model_assignment WHERE scope=$1 AND target=$2', [scope, target]);
      if (saved) await client.query(`INSERT INTO ai_model_assignment
        (scope,target,model_mode,connection_id,model_id,effort_mode,reasoning_effort,updated_at,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ['scope', 'target', 'model_mode', 'connection_id', 'model_id', 'effort_mode', 'reasoning_effort', 'updated_at', 'updated_by'].map(key => saved[key]));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** A Lume document owned by the account, as a finished draft run leaves it. */
export function seedArtifact(email: string, title: string, content: string) {
  return withClient(async client => {
    const { user_id, office_id } = await owner(client, email);
    const runId = randomUUID(), artifactId = randomUUID();
    await client.query("INSERT INTO ai_run(id,office_id,user_id,kind,input,status) VALUES($1,$2,$3,'draft','{}','completed')", [runId, office_id, user_id]);
    await client.query('INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content) VALUES($1,$2,$3,$4,$5,$6)', [artifactId, office_id, user_id, runId, title, content]);
    return artifactId;
  });
}

/** Replaces a conversation's stored messages, as the chat stream would after the agent replied. */
export function setConversationMessages(email: string, conversationId: string, messages: unknown[]) {
  return withClient(async client => {
    const { user_id } = await owner(client, email);
    const { rowCount } = await client.query('UPDATE ai_conversation SET messages=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify(messages), conversationId, user_id]);
    if (rowCount !== 1) throw new Error(`Conversa ${conversationId} não encontrada para ${email}.`);
  });
}

/** A document the Lume wrote in a conversation, as k5_artifacts_create leaves it. */
export function seedConversationDocument(email: string, conversationId: string, title: string, content: string) {
  return withClient(async client => {
    const { user_id, office_id } = await owner(client, email);
    const artifactId = randomUUID();
    await client.query(`INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content,kind,conversation_id,created_by_agent)
      VALUES($1,$2,$3,NULL,$4,$5,'document',$6,true)`, [artifactId, office_id, user_id, title, content, conversationId]);
    await client.query('INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id) VALUES($1,1,$2,$3,$4)', [artifactId, title, content, user_id]);
    return artifactId;
  });
}

/** Ties an uploaded chat file to a sent message, as sending the message does. */
export function claimChatAttachment(email: string, attachmentId: string) {
  return withClient(async client => {
    const { user_id } = await owner(client, email);
    const { rowCount } = await client.query("UPDATE ai_chat_attachment SET message_id='e2e-message' WHERE id=$1 AND user_id=$2", [attachmentId, user_id]);
    if (rowCount !== 1) throw new Error(`Anexo ${attachmentId} não encontrado para ${email}.`);
  });
}
