import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';

export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A database lease prevents duplicate analysis handled by different web processes.
export async function withInsightCache<T extends z.ZodType, R>(connectionId: string, key: string, schema: T,
  run: (previous: z.output<T> | null, save: (value: z.output<T>) => Promise<void>) => Promise<R>): Promise<R> {
  const token = randomUUID();
  await database.prepare(`INSERT INTO google_email_insight_cache(connection_id,cache_key) VALUES(?,?) ON CONFLICT DO NOTHING`).run(connectionId, key);
  const row = await database.prepare(`UPDATE google_email_insight_cache SET lease_token=?,lease_until=?
    WHERE connection_id=? AND cache_key=? AND lease_until<? RETURNING payload`).get<{ payload: unknown }>(token, Date.now() + 360_000, connectionId, key, Date.now());
  if (!row) throw new CapabilityError('CONFLICT', 'O Lume já está preparando este resumo. Aguarde e tente novamente.');
  const parsed = schema.safeParse(row.payload);
  try {
    return await run(parsed.success ? parsed.data : null, async value => {
      await database.prepare(`UPDATE google_email_insight_cache SET payload=?::jsonb WHERE connection_id=? AND cache_key=? AND lease_token=?`)
        .run(JSON.stringify(schema.parse(value)), connectionId, key, token);
    });
  } finally {
    await database.prepare(`UPDATE google_email_insight_cache SET lease_token=NULL,lease_until=0 WHERE connection_id=? AND cache_key=? AND lease_token=?`).run(connectionId, key, token);
  }
}
