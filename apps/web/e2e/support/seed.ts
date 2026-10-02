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
