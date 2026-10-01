import 'server-only';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { objectStorage, storageKey, StorageError } from '@/lib/storage';
import { ContainerBindingError } from '@/lib/container-bindings';
import { InpiImportError } from './inpi-errors';

export const INPI_BUCKETS = 512;
export const INPI_LIMITS = { batchBytes: 8 * 1024 * 1024, batchRows: 50_000, objectBytes: 1024 * 1024,
  recordBytes: 2 * 1024 * 1024, bucketBytes: 32 * 1024 * 1024, bucketRows: 100_000, stagingBytes: 16 * 1024 ** 3,
  localBytes: 128 * 1024 * 1024, sliceMs: 10 * 60_000, totalMs: 24 * 60 * 60_000, reserveBytes: 512 * 1024 * 1024 };
export type InpiStageSource = 'inpi_stage_bib' | 'inpi_stage_nice' | 'inpi_stage_vienna' | 'inpi_stage_owner';
export type StageBatch = Map<number, { rows: string[]; bytes: number }>;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export class InvalidInpiStagingError extends InpiImportError {
  constructor(readonly source: InpiStageSource) { super('staging_corrupt', 'Arquivo intermediário ausente ou corrompido. Invalidar a carga antes de retomar.'); }
}

export class InpiStaging {
  constructor(private readonly client: PoolClient, private readonly importId: string, private readonly maximumBytes = INPI_LIMITS.stagingBytes, private readonly signal?: AbortSignal) {}

  private async withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const signal = this.signal ? AbortSignal.any([this.signal, controller.signal]) : controller.signal;
    try { return await operation(signal); }
    finally { clearTimeout(timer); }
  }

  async save(source: InpiStageSource, batch: StageBatch, checkpoint: { offset: number; records: number; rejected: number; ordinal: number; headers: string[] }) {
    const storage = await objectStorage();
    const usage = await this.client.query<{ bytes: string }>('SELECT coalesce(sum(byte_size),0)::text AS bytes FROM inpi_staging_object');
    const bytes = [...batch.values()].reduce((sum, part) => sum + part.bytes, 0);
    if (Number(usage.rows[0].bytes) + bytes > this.maximumBytes) throw new InpiImportError('capacity', 'Limite de armazenamento intermediário atingido. Rever capacidade antes de retomar.');
    const parts = [...batch].map(([bucket, part]) => {
      const compressed = gzipSync(part.rows.join(''), { level: 1 });
      return { bucket, compressed, key: storageKey('00000000-0000-0000-0000-000000000000', this.importId, 'gz'),
        sha256: digest(compressed), bytes: part.bytes, rows: part.rows.length };
    });
    // Journal before PUT: a crash never leaves an object outside the cleanup catalog.
    await this.client.query(`INSERT INTO inpi_staging_object(storage_key,import_id,source,bucket,ordinal,sha256,byte_size,row_count)
      SELECT p.key,$2,$3,p.bucket,$4,p.sha256,p.bytes,p.rows FROM jsonb_to_recordset($1::jsonb) p(key text,bucket int,sha256 text,bytes bigint,rows int)`,
    [JSON.stringify(parts.map(part => ({ key: part.key, bucket: part.bucket, sha256: part.sha256, bytes: part.bytes, rows: part.rows }))), this.importId, source, checkpoint.ordinal]);
    for (let i = 0; i < parts.length; i += 4) {
      this.signal?.throwIfAborted();
      const group = parts.slice(i, i + 4);
      // A disconnected owner cannot start another group after PostgreSQL releases its lock.
      await this.client.query('UPDATE inpi_staging_object SET put_started_at=CURRENT_TIMESTAMP WHERE storage_key=ANY($1::text[])', [group.map(part => part.key)]);
      const results = await this.withDeadline(signal => Promise.allSettled(group.map(part => storage.put(part.key, part.compressed, { signal }))));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    await this.client.query('BEGIN');
    try {
      await this.client.query('UPDATE inpi_staging_object SET ready=true WHERE import_id=$1 AND source=$2 AND ordinal=$3', [this.importId, source, checkpoint.ordinal]);
      await this.client.query(`UPDATE inpi_file_checkpoint SET byte_offset=$3,records=$4,rejected=$5,ordinal=$6,headers=$7 WHERE import_id=$1 AND source=$2`,
        [this.importId, source, checkpoint.offset, checkpoint.records, checkpoint.rejected, checkpoint.ordinal + 1, JSON.stringify(checkpoint.headers)]);
      await this.client.query('COMMIT');
    } catch (error) { await this.client.query('ROLLBACK').catch(() => undefined); throw error; }
  }

  async bucketSize(bucket: number) {
    const result = await this.client.query<{ bytes: string; rows: string }>(`SELECT coalesce(sum(byte_size),0)::text AS bytes,coalesce(sum(row_count),0)::text AS rows
      FROM inpi_staging_object WHERE import_id=$1 AND bucket=$2 AND ready`, [this.importId, bucket]);
    const bytes = Number(result.rows[0].bytes), rows = Number(result.rows[0].rows);
    if (bytes > INPI_LIMITS.bucketBytes || rows > INPI_LIMITS.bucketRows) throw new InpiImportError('capacity', 'Partição do INPI excedeu 32 MiB ou 100 mil linhas. Reparticionar em desenvolvimento antes de retomar.');
    return { bytes, rows };
  }

  async read(source: InpiStageSource, bucket: number) {
    const storage = await objectStorage();
    // Resolve the bounded catalog before COPY takes over this connection.
    const parts = await this.client.query<{ storage_key: string; sha256: string; byte_size: string }>(
      `SELECT storage_key,sha256,byte_size FROM inpi_staging_object WHERE import_id=$1 AND source=$2 AND bucket=$3 AND ready ORDER BY ordinal LIMIT 4097`,
      [this.importId, source, bucket]);
    if (parts.rows.length > 4096) throw new InpiImportError('capacity', 'Partição excedeu 4096 objetos. Reparticionar antes de retomar.');
    const get = (key: string) => this.withDeadline(signal => storage.get(key, { signal }));
    return (async function* () {
      for (const part of parts.rows) {
        const compressed = await get(part.storage_key).catch(error => {
          if ((error instanceof StorageError && error.code === 'not_found') || (error instanceof ContainerBindingError && error.status === 404)) throw new InvalidInpiStagingError(source);
          throw error;
        });
        if (digest(compressed) !== part.sha256) throw new InvalidInpiStagingError(source);
        const bytes = gunzipSync(compressed, { maxOutputLength: INPI_LIMITS.objectBytes + INPI_LIMITS.recordBytes });
        if (bytes.length !== Number(part.byte_size)) throw new InvalidInpiStagingError(source);
        yield bytes;
      }
    })();
  }
  async clean(incompleteOnly = false, maximum = 4096) {
    const storage = await objectStorage();
    const deadline = Date.now() + 30_000;
    let removed = 0;
    for (;;) {
      const parts = await this.client.query<{ storage_key: string }>(
        `SELECT storage_key FROM inpi_staging_object WHERE import_id=$1 ${incompleteOnly ? 'AND NOT ready' : ''}
          AND (ready OR put_started_at<CURRENT_TIMESTAMP-INTERVAL '2 minutes') LIMIT 100`, [this.importId]);
      if (!parts.rowCount) return !(await this.client.query(`SELECT 1 FROM inpi_staging_object WHERE import_id=$1 ${incompleteOnly ? 'AND NOT ready' : ''} LIMIT 1`, [this.importId])).rowCount;
      for (const part of parts.rows) {
        if (removed >= maximum || Date.now() >= deadline) return false;
        await this.withDeadline(signal => storage.delete(part.storage_key, { signal }));
        await this.client.query('DELETE FROM inpi_staging_object WHERE storage_key=$1', [part.storage_key]);
        removed++;
      }
    }
  }
}
