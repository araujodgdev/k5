import type { Database } from './database';
import { databaseFailure } from './research/trademarks/inpi-errors';
import { captureOperationalError } from './observability/report';

type Task = { name: string; run: () => Promise<unknown> };
export type IntegrationResult = { name: string; status: 'completed'; value: unknown }
  | { name: string; status: 'failed'; error: unknown }
  | { name: string; status: 'skipped'; reason: 'database_unavailable' | 'pass_reserved' };
export class IntegrationPassError extends AggregateError {
  constructor(readonly results: IntegrationResult[], readonly databaseUnavailable: boolean) {
    // Sentry follows AggregateError.errors. Keep provider/SQL payloads only in the
    // in-process results; each original error was already reported through the safe reporter.
    super(results.flatMap(result => result.status === 'failed' ? [new Error(`Falha na tarefa ${result.name}.`)] : []), 'A passagem de integrações não foi concluída.');
  }
}

let unavailableUntil = 0;
/** Keep task failures explicit; a cluster failure stops further writes and external dispatches. */
export async function runIntegrationTasks(tasks: Task[], probeDatabase?: () => Promise<void>) {
  const results: IntegrationResult[] = [];
  let unavailable = false;
  for (const task of tasks) {
    if (unavailable) { results.push({ name: task.name, status: 'skipped', reason: 'database_unavailable' }); continue; }
    try { results.push({ name: task.name, status: 'completed', value: await task.run() }); }
    catch (error) {
      const failure = databaseFailure(error);
      unavailable = failure !== null;
      // Socket closures may lack SQLSTATE or belong to storage/a provider. One
      // write probe decides whether independent tasks can reserve external effects.
      if (failure !== 'disk_full' && failure !== 'read_only' && probeDatabase) {
        try { await probeDatabase(); unavailable = false; }
        catch (probeError) { unavailable = true; captureOperationalError(probeError, 'integrations.database_probe'); }
      }
      results.push({ name: task.name, status: 'failed', error });
      captureOperationalError(error, 'integrations.task', { stage: task.name });
    }
  }
  if (results.some(result => result.status === 'failed')) throw new IntegrationPassError(results, unavailable);
  return results;
}

/** A committed reservation survives read-only transitions and isolate/container restarts. */
export async function runIntegrationPass(db: Database, tasks: Task[], scope: 'edge' | 'node' = 'edge') {
  if (Date.now() < unavailableUntil) throw new IntegrationPassError([], true);
  const id = scope === 'node' ? 2 : 1;
  let reserved = false;
  try {
    const due = await db.prepare('SELECT 1 FROM integration_circuit WHERE id=? AND probe_after<=CURRENT_TIMESTAMP').get(id);
    if (!due) throw new IntegrationPassError(tasks.map(task => ({ name: task.name, status: 'skipped', reason: 'pass_reserved' })), false);
    reserved = Boolean(await db.prepare(`UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP+INTERVAL '15 minutes'
      WHERE id=? AND probe_after<=CURRENT_TIMESTAMP RETURNING id`).get(id));
    if (!reserved) throw new IntegrationPassError(tasks.map(task => ({ name: task.name, status: 'skipped', reason: 'pass_reserved' })), false);
    const results = await runIntegrationTasks(tasks, async () => {
      await db.prepare('UPDATE integration_circuit SET probe_after=probe_after WHERE id=?').run(id);
    });
    await db.prepare('UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP WHERE id=?').run(id);
    return results;
  } catch (error) {
    // Task failures are always wrapped. Any other exception here came from a
    // circuit query, including pg socket closures with no code.
    const unavailable = !(error instanceof IntegrationPassError) || error.databaseUnavailable;
    if (unavailable) unavailableUntil = Date.now() + 15 * 60_000;
    else if (reserved) await db.prepare("UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP+INTERVAL '1 minute' WHERE id=?").run(id);
    throw error;
  }
}
