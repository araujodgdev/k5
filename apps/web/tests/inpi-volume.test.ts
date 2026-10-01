import './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat, writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { authStore } from '../src/lib/database';
import { importInpiBaseline } from '../src/lib/research/trademarks/inpi-baseline';
import { localObjectStorage, resetObjectStorageForTests, assertStorageKey } from '../src/lib/storage';
import { testStorageRoot } from './test-setup';
import { INPI_LIMITS } from '../src/lib/research/trademarks/inpi-staging';

async function directoryBytes(path: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(name);
    else bytes += (await stat(name).catch(() => ({ size: 0 }))).size;
  }
  return bytes;
}

test('volume real dos quatro CSVs oficiais em PostgreSQL descartável, com medição física', { skip: process.env.K5_INPI_VOLUME !== '1', timeout: 14_400_000 }, async () => {
  const pool = await authStore(), client = await pool.connect();
  const directory = String((await client.query('SHOW data_directory')).rows[0].data_directory);
  assert.match(directory.replaceAll('\\','/'), /\/k5-pg-tests-[\w-]+\/data$/i, 'O ensaio só pode usar a instância descartável do runner.');
  const postmaster = Number((await readFile(join(directory,'postmaster.pid'),'utf8')).split('\n')[0]);
  assert.ok(Number.isSafeInteger(postmaster) && postmaster > 0);
  // Model the remote store using a bounded directory on the development machine. No R2 writes.
  const objectRoot = join(testStorageRoot, 'volume'), storage = localObjectStorage(objectRoot);
  let objectBytes = 0;
  resetObjectStorageForTests({
    async put(key, bytes, options) { await storage.put(key, bytes, options); objectBytes += bytes.length; report.peakObjectBytes = Math.max(report.peakObjectBytes, objectBytes); },
    get: (key, options) => storage.get(key, options),
    async delete(key, options) {
      const bytes = (await stat(join(objectRoot, assertStorageKey(key))).catch(() => ({ size: 0 }))).size;
      await storage.delete(key, options); objectBytes -= bytes;
    },
  }, { async put() { throw new Error('Unexpected remote PUT'); }, async get() { return null; }, async delete() {} });
  const capacity = { diskBytes: 40*1024**3, otherBytes: 1024**3, appReserveBytes: 2*1024**3,
    databaseBytes: 12*1024**3, candidateBytes: 12*1024**3, walBytes: 24*1024**3, walMeasurement: 'retained', approvedUntil: new Date(Date.now()+14_400_000).toISOString() };
  await pool.query('UPDATE inpi_sync SET capacity=$1', [JSON.stringify(capacity)]);
  const started = Date.now();
  const report = { source: 'official-full-corpus', complete: false, elapsedMs: 0, peakRssBytes: 0, peakHeapBytes: 0,
    initialClusterBytes: await directoryBytes(directory), peakClusterBytes: 0, peakObjectBytes: 0, peakScratchBytes: 0,
    peakDatabaseBytes: 0, peakCandidateBytes: 0, peakPostgresRssBytes: 0, walGeneratedBytes: 0, peakWalRetainedBytes: 0,
    finalCorpusBytes: 0, finalDatabaseBytes: 0, capacity, tempBytes: 0, records: 0,
    manifest: [] as unknown[], checkpoints: [] as unknown[], failure: null as string | null };
  let sampling = Promise.resolve(), sampleError: unknown;
  let busy = false;
  let processSampledAt = 0;
  const sample = async () => {
    const memory = process.memoryUsage();
    report.peakRssBytes = Math.max(report.peakRssBytes, memory.rss); report.peakHeapBytes = Math.max(report.peakHeapBytes, memory.heapUsed);
    if (busy) return;
    busy = true;
    try {
      report.peakClusterBytes = Math.max(report.peakClusterBytes, await directoryBytes(directory));
      const wal = await pool.query<{ bytes: string }>('SELECT coalesce(sum(size),0)::text AS bytes FROM pg_ls_waldir()');
      report.peakWalRetainedBytes = Math.max(report.peakWalRetainedBytes, Number(wal.rows[0].bytes));
      if (Date.now()-processSampledAt > 10_000) {
        const memory = process.platform === 'win32'
          ? await promisify(execFile)('powershell.exe', ['-NoProfile','-Command', `(Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.ProcessId -eq ${postmaster} -or $_.ParentProcessId -eq ${postmaster} } | Measure-Object -Property WorkingSetSize -Sum).Sum`], { windowsHide: true })
          : await promisify(execFile)('ps', ['-o','rss=','-p',String(postmaster),'--ppid',String(postmaster)]);
        const bytes = memory.stdout.trim().split(/\s+/).reduce((sum, value) => sum + Number(value), 0) * (process.platform === 'win32' ? 1 : 1024);
        report.peakPostgresRssBytes = Math.max(report.peakPostgresRssBytes, bytes);
        processSampledAt = Date.now();
      }
      if (report.peakObjectBytes > INPI_LIMITS.stagingBytes) throw new Error('Object storage quota exceeded');
    } finally { busy = false; }
  };
  const timer = setInterval(() => {
    if (!busy) sampling = sample().catch(error => { sampleError = error; });
  }, 2000);
  try {
    for (let slice = 0; slice < 24; slice++) {
      const completed = await importInpiBaseline(client, { async progress(_label, metrics) {
        if (sampleError) throw sampleError;
        report.peakScratchBytes = Math.max(report.peakScratchBytes, metrics.scratchBytes ?? 0);
        report.peakDatabaseBytes = Math.max(report.peakDatabaseBytes, metrics.databaseBytes ?? 0);
        report.peakCandidateBytes = Math.max(report.peakCandidateBytes, metrics.candidateBytes ?? 0);
        report.walGeneratedBytes = Math.max(report.walGeneratedBytes, metrics.walGeneratedBytes ?? metrics.walBytes ?? 0); report.tempBytes = Math.max(report.tempBytes, metrics.tempBytes ?? 0);
      } });
      if (completed) { report.complete = true; break; }
    }
    const run = (await pool.query("SELECT manifest_json,record_count FROM inpi_import WHERE kind='baseline' ORDER BY started_at DESC LIMIT 1")).rows[0];
    report.manifest = run?.manifest_json ?? []; report.records = run?.record_count ?? 0;
    assert.equal(report.complete, true);
  } catch (error) {
    report.failure = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'unknown';
    throw new Error(`Ensaio INPI interrompido: ${report.failure}`);
  } finally {
    clearInterval(timer); await sampling; await sample();
    report.peakObjectBytes = Math.max(report.peakObjectBytes, await directoryBytes(testStorageRoot));
    report.peakRssBytes = Math.max(report.peakRssBytes, process.resourceUsage().maxRSS * 1024);
    const run = (await pool.query("SELECT id,manifest_json,record_count FROM inpi_import WHERE kind='baseline' ORDER BY started_at DESC LIMIT 1")).rows[0];
    report.manifest = run?.manifest_json ?? []; report.records = run?.record_count ?? 0;
    report.checkpoints = (await pool.query('SELECT source,byte_offset,records,rejected,complete FROM inpi_file_checkpoint WHERE import_id=$1', [run?.id ?? null])).rows;
    const final = (await pool.query(`SELECT pg_total_relation_size('inpi_trademark')::text AS corpus,
      pg_database_size(current_database())::text AS database,pg_wal_lsn_diff(pg_current_wal_lsn(),wal_start)::text AS wal
      FROM inpi_import WHERE id=$1`, [run?.id ?? null])).rows[0];
    report.finalCorpusBytes = Number(final?.corpus ?? 0); report.finalDatabaseBytes = Number(final?.database ?? 0);
    report.walGeneratedBytes = Math.max(report.walGeneratedBytes, Number(final?.wal ?? 0));
    report.elapsedMs = Date.now()-started;
    const output = resolve('.data/inpi-validation'); await mkdir(output, { recursive: true });
    await writeFile(join(output,'volume.json'), JSON.stringify(report,null,2));
    console.info(JSON.stringify({ event: 'inpi_volume_result', ...report }));
    client.release(true); resetObjectStorageForTests();
  }
});
