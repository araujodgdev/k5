import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { INPI_LIMITS } from './inpi-staging';
import { InpiImportError } from './inpi-errors';

// An operator records the measured envelope, not a guess derived from CSV size.
export const inpiCapacity = z.object({
  diskBytes: z.number().int().positive(), otherBytes: z.number().int().nonnegative(), appReserveBytes: z.number().int().min(1024 ** 3),
  databaseBytes: z.number().int().positive(), candidateBytes: z.number().int().positive(),
  walBytes: z.number().int().positive(), approvedUntil: z.string().datetime(),
  walMeasurement: z.enum(['generated','retained']).default('generated'),
}).refine(value => value.databaseBytes + value.walBytes + value.otherBytes + value.appReserveBytes + INPI_LIMITS.reserveBytes <= value.diskBytes,
  'Banco, WAL, outros arquivos, reserva do aplicativo e lote devem caber no disco.')
  .refine(value => new Date(value.approvedUntil).getTime() <= Date.now() + 24 * 60 * 60_000, 'A medição de capacidade vale no máximo 24 horas.');

export async function configureInpiSession(client: PoolClient) {
  const version = await client.query<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version.rows[0].version) < 170000) throw new InpiImportError('capacity', 'O importador exige PostgreSQL 17+ para limitar a duração das transações.');
  await client.query("SET statement_timeout='60s'; SET transaction_timeout='120s'; SET lock_timeout='3s'; SET idle_in_transaction_session_timeout='90s'; SET work_mem='4MB'; SET maintenance_work_mem='16MB'; SET max_parallel_workers_per_gather=0");
  const limit = await client.query<{ kb: string }>("SELECT setting AS kb FROM pg_settings WHERE name='temp_file_limit'");
  if (Number(limit.rows[0].kb) < 0 || Number(limit.rows[0].kb) > 64 * 1024) {
    try { await client.query("SET temp_file_limit='64MB'"); }
    catch { throw new InpiImportError('capacity', 'Configurar temp_file_limit de até 64 MiB para o papel importador antes de retomar.'); }
  }
}

export async function checkInpiCapacity(client: PoolClient, importId?: string) {
  const result = await client.query(`SELECT capacity,pg_database_size(current_database())::text AS database_bytes,
    coalesce(pg_total_relation_size(to_regclass('inpi_trademark_candidate')),0)::text AS candidate_bytes,
    (SELECT temp_bytes::text FROM pg_stat_database WHERE datname=current_database()) AS temp_bytes,
    CASE WHEN $1::text IS NULL THEN 0 ELSE coalesce((SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),wal_start) FROM inpi_import WHERE id=$1),0) END::text AS wal_bytes
    FROM inpi_sync WHERE id=1`, [importId ?? null]);
  const row = result.rows[0];
  const parsed = inpiCapacity.safeParse(row.capacity);
  if (!parsed.success || new Date(parsed.data.approvedUntil).getTime() <= Date.now()) {
    throw new InpiImportError('capacity', 'Medir o corpus completo, reservar espaço para corpus antigo/candidato, índices, WAL e aplicativo e registrar capacidade válida antes de retomar.');
  }
  const budget = parsed.data;
  const walGeneratedBytes = Number(row.wal_bytes);
  let walBytes = walGeneratedBytes;
  if (budget.walMeasurement === 'retained') {
    try {
      const retained = await client.query<{ bytes: string }>('SELECT coalesce(sum(size),0)::text AS bytes FROM pg_ls_waldir()');
      walBytes = Number(retained.rows[0].bytes);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') throw new InpiImportError('capacity', 'Sem permissão para medir WAL retido. Usar reserva de WAL gerado ou configurar acesso antes de retomar.');
      throw error;
    }
  }
  const metrics = { databaseBytes: Number(row.database_bytes), candidateBytes: Number(row.candidate_bytes), walBytes, walGeneratedBytes,
    walMeasurement: budget.walMeasurement, tempBytes: Number(row.temp_bytes) };
  if (metrics.databaseBytes + INPI_LIMITS.reserveBytes > budget.databaseBytes || metrics.candidateBytes + INPI_LIMITS.reserveBytes > budget.candidateBytes
    || metrics.walBytes + INPI_LIMITS.reserveBytes > budget.walBytes) {
    throw new InpiImportError('capacity', 'A reserva de 512 MiB para o próximo lote não cabe no orçamento aprovado. Rever espaço livre, WAL e capacidade antes de retomar.');
  }
  return metrics;
}

export async function withInpiLock<T>(client: PoolClient, action: () => Promise<T>) {
  const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('inpi-corpus-import')) AS acquired");
  if (!lock.rows[0].acquired) return undefined;
  let failed = false;
  try { return await action(); }
  catch (error) { failed = true; throw error; }
  finally {
    // A dead backend has already released the lock. Never hand a live locked connection back to a pool.
    try { await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))"); }
    catch (error) { if (!failed) throw error; }
  }
}
