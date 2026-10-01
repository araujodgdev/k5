import type { PoolClient } from 'pg';
import { InpiImportError, inpiFailure } from './inpi-errors';
import { captureOperationalError } from '@/lib/observability/report';

let unavailableUntil = 0;
export function inpiLocallyUnavailable() { return Date.now() < unavailableUntil; }

export async function reserveInpiAttempt(client: PoolClient) {
  const result = await client.query(`UPDATE inpi_sync SET attempts=attempts+1,checked_at=CURRENT_TIMESTAMP,
    next_check_at=CURRENT_TIMESTAMP+make_interval(secs=>least(21600,900*power(2,attempts))::int),
    failure_code='attempt_in_progress',resume_condition='Execução reservada. Após crash, aguardar o prazo; após cinco tentativas, investigar e executar inpi:admin resume.'
    WHERE id=1 AND NOT suspended AND attempts<5 RETURNING attempts`);
  if (!result.rowCount) throw new InpiImportError('suspended', 'Cinco tentativas ou suspensão registrada. Corrigir a condição e executar inpi:admin resume.');
  return Number(result.rows[0].attempts);
}

export async function recordInpiFailure(client: PoolClient, error: unknown) {
  const failure = inpiFailure(error);
  if (failure.suspend) unavailableUntil = Date.now() + 15 * 60_000;
  try {
    await client.query(`UPDATE inpi_sync SET suspended=$1 OR attempts>=5,failure_code=$2,error=$3,resume_condition=$3,
      next_check_at=greatest(next_check_at,CURRENT_TIMESTAMP+INTERVAL '15 minutes') WHERE id=1`, [failure.suspend, failure.code, failure.condition]);
  } catch (recordError) {
    unavailableUntil = Date.now() + 15 * 60_000;
    captureOperationalError(recordError, 'research.inpi.failure_checkpoint', { inpi_failure: failure.code });
  }
}

export async function finishInpiAttempt(client: PoolClient, complete: boolean) {
  await client.query(`UPDATE inpi_sync SET attempts=0,suspended=false,failure_code=NULL,error=NULL,resume_condition=NULL,
    next_check_at=CURRENT_TIMESTAMP+make_interval(secs=>$1) WHERE id=1`, [complete ? 300 : 60]);
}
