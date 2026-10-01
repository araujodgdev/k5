import 'server-only';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { beginInpiImport } from './inpi-ingest';
import { normalizeTrademarkName, situationGroup, viennaCode } from './inpi-contracts';
import { downloadInpiCsv, InpiDownloadError, isStrongInpiEtag } from './inpi-download';
import { captureOperationalError } from '@/lib/observability/report';
import { remoteObjectStorage } from '@/lib/storage';
import { INPI_BUCKETS, INPI_LIMITS, InpiStaging, type StageBatch } from './inpi-staging';
import { InpiImportError, inpiFailure } from './inpi-errors';
import { checkInpiCapacity, configureInpiSession, withInpiLock } from './inpi-capacity';
import { buildInpiBucket, carryInpiBatch, publishInpiCandidate, type BaselineSource } from './inpi-publish';
import { finishInpiAttempt, recordInpiFailure, reserveInpiAttempt } from './inpi-retry';

const base = 'https://dadosabertos.inpi.gov.br/download/marcas/';
const bib = ['numero_inpi','data_deposito','data_publicacao','data_concessao','data_vigencia','descricao_apresentacao','descricao_natureza','elemento_nominativo','traducao','apostila','codigo_situacao','descricao_situacao'];
const sources: BaselineSource[] = [
  { file: 'MARCAS_DADOS_BIBLIOGRAFICOS.csv', table: 'inpi_stage_bib', columns: ['codigo_interno', ...bib], staged: [...bib,'normalized_name','situation_group'] },
  { file: 'MARCAS_CLASSIFICACOES_NICE.csv', table: 'inpi_stage_nice', columns: ['codigo_interno','numero_inpi','edicao_nice','classe_nice','especificacao','especificacao_trad'], staged: ['numero_inpi','classe_nice','especificacao'] },
  { file: 'MARCAS_CLASSIFICACOES_VIENA.csv', table: 'inpi_stage_vienna', columns: ['codigo_interno','numero_inpi','simbolo','classificacao_viena','revisao_viena'], staged: ['numero_inpi','simbolo','classificacao_viena'] },
  { file: 'MARCAS_DEPOSITANTES.csv', table: 'inpi_stage_owner', columns: ['codigo_interno','numero_inpi','nome','estado','pais'], staged: ['numero_inpi','nome'] },
];
const fileIdentity = z.object({ url: z.string(), etag: z.string(), size: z.number().int().positive(), modified: z.string() });
const checkpointSchema = z.object({ byte_offset: z.coerce.number(), records: z.coerce.number(), rejected: z.coerce.number(), ordinal: z.number(), headers: z.array(z.string()).nullable(), complete: z.boolean() });
const parsedRecord = z.object({ record: z.record(z.string(), z.string()), info: z.object({ bytes: z.number() }) });
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
export type InpiProgress = { importId: string; stage: string; source?: string; bucket?: number; bytes?: number; records?: number; rejected?: number; durationMs?: number;
  batchBytes?: number; batchRows?: number; scratchBytes?: number; databaseBytes?: number; candidateBytes?: number; walBytes?: number;
  walGeneratedBytes?: number; walMeasurement?: 'generated' | 'retained'; tempBytes?: number };
type Options = { directory?: string; progress?: (stage: string, metrics: InpiProgress) => void | Promise<void> };

async function identities(signal: AbortSignal) {
  const manifest: Array<z.infer<typeof fileIdentity>> = [];
  for (const source of sources) {
    const response = await fetch(base + source.file, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      .catch(error => { throw new InpiDownloadError('INPI_NETWORK', { cause: error }); });
    if (!response.ok) throw new InpiDownloadError([408,429,500,502,503,504].includes(response.status) ? 'INPI_NETWORK' : 'INPI_HTTP_INVALID');
    const size = Number(response.headers.get('content-length')), etag = response.headers.get('etag'), date = new Date(response.headers.get('last-modified') ?? '');
    if (!Number.isSafeInteger(size) || size < 1 || !isStrongInpiEtag(etag) || !Number.isFinite(date.getTime())) throw new InpiDownloadError('INPI_HTTP_INVALID');
    manifest.push(fileIdentity.parse({ url: base + source.file, size, etag, modified: date.toISOString() }));
  }
  if (new Set(manifest.map(file => file.modified.slice(0, 10))).size !== 1) throw new InpiImportError('source_changed', 'Arquivos do INPI pertencem a cargas diferentes. Conferir a fonte antes de invalidar a carga.');
  if (manifest.reduce((sum, file) => sum + file.size, 0) > INPI_LIMITS.stagingBytes) throw new InpiImportError('capacity', 'Os arquivos excedem o limite de entrada de 16 GiB. Rever a capacidade.');
  return manifest;
}

async function stageFile(client: PoolClient, staging: InpiStaging, id: string, source: BaselineSource, file: z.infer<typeof fileIdentity>, options: Options,
  signal: AbortSignal, checkpoint: () => Promise<boolean>) {
  const saved = checkpointSchema.parse((await client.query('SELECT * FROM inpi_file_checkpoint WHERE import_id=$1 AND source=$2', [id, source.table])).rows[0]);
  if (saved.complete) return true;
  let headers = saved.headers, offset = saved.byte_offset, records = saved.records, rejected = saved.rejected, ordinal = saved.ordinal;
  const path = options.directory ? `${options.directory}/${source.file}` : undefined;
  if (path && (!existsSync(path) || (await stat(path)).size !== file.size)) throw new InpiImportError('invalid_source', 'Arquivo local do INPI incompleto.');
  // Local files are checked by SHA256 before a run is identified, and may only be used in development.
  const streamController = new AbortController();
  const body = path ? createReadStream(path, { start: offset }) : downloadInpiCsv(file.url, file, { offset, signal: AbortSignal.any([signal, streamController.signal]) });
  const parser = parse({ bom: offset === 0, columns: headers ?? ((columns: string[]) => {
    if (!source.columns.every(column => columns.includes(column)) || new Set(columns).size !== columns.length) throw new InpiImportError('invalid_source', 'Layout dos dados abertos mudou.');
    headers = columns; return columns;
  }), skip_empty_lines: true, max_record_size: INPI_LIMITS.recordBytes, info: true });
  // csv-parse can emit every record in one input chunk before readable backpressure
  // applies. Rechunk validated HTTP ranges so an 8 MiB response cannot queue 70k objects.
  let consumedBytes = 0;
  const chunks = (async function* () {
    for await (const bytes of body) {
      consumedBytes += bytes.length;
      for (let start = 0; start < bytes.length; start += 32 * 1024) yield bytes.subarray(start, start + 32 * 1024);
    }
  })();
  const input = Readable.from(chunks, { objectMode: false, highWaterMark: 32 * 1024 });
  // Observe pipeline completion immediately: aborting a partially consumed input
  // must not leave an unhandled source error after the checkpoint has committed.
  const pumping = pipeline(input, parser).then(() => null, (error: unknown) => error);
  let batch: StageBatch = new Map(), batchBytes = 0, batchRows = 0, checkpointOffset = offset;
  const flush = async () => {
    if (!headers) throw new InpiImportError('invalid_source', 'Cabeçalho CSV ausente.');
    await staging.save(source.table, batch, { offset, records, rejected, ordinal, headers });
    ordinal++; batch = new Map(); batchBytes = 0; batchRows = 0; checkpointOffset = offset;
    console.info(JSON.stringify({ event: 'inpi_progress', importId: id, stage: 'download', source: source.table, bytes: offset, records, rejected }));
    await options.progress?.(source.file, { importId: id, stage: 'download', source: source.table, bytes: offset, records, rejected });
    return checkpoint();
  };
  try {
    for await (const raw of parser) {
      signal.throwIfAborted();
      const parsed = parsedRecord.parse(raw), row = parsed.record;
      offset = saved.byte_offset + parsed.info.bytes;
      row.numero_inpi = row.numero_inpi.trim();
      let valid = /^\d{9}$/.test(row.numero_inpi);
      if (source.table === 'inpi_stage_vienna') {
        const code = viennaCode.safeParse(row.simbolo); if (code.success) row.simbolo = code.data; else valid = false;
      }
      if (source.table === 'inpi_stage_nice' && (!Number.isInteger(Number(row.classe_nice)) || Number(row.classe_nice) < 1 || Number(row.classe_nice) > 45)) valid = false;
      let fullPart = false;
      batchRows++;
      if (!valid) rejected++;
      else {
        if (source.table === 'inpi_stage_bib') { row.normalized_name = normalizeTrademarkName(row.elemento_nominativo); row.situation_group = situationGroup(row.descricao_situacao); }
        const encoded = source.staged.map(column => csvCell(row[column].trim())).join(',') + '\n';
        const bytes = Buffer.byteLength(encoded);
        if (bytes > INPI_LIMITS.recordBytes) throw new InpiImportError('capacity', 'Registro CSV normalizado excede 2 MiB.');
        const bucket = Number(row.numero_inpi) % INPI_BUCKETS;
        const part = batch.get(bucket) ?? { rows: [], bytes: 0 };
        part.rows.push(encoded); part.bytes += bytes; batch.set(bucket, part); batchBytes += bytes; records++;
        fullPart = part.bytes >= INPI_LIMITS.objectBytes;
      }
      if (batchBytes >= INPI_LIMITS.batchBytes || offset - checkpointOffset >= INPI_LIMITS.batchBytes || batchRows >= INPI_LIMITS.batchRows || fullPart) {
        if (!await flush()) return false;
      }
    }
    const streamError = await pumping;
    if (streamError) throw streamError;
    // The parser counter can omit trailing empty lines. Only after validated EOF
    // and parser completion may the checkpoint include those remaining bytes.
    offset = saved.byte_offset + consumedBytes;
    if (offset !== file.size || !headers || !records) throw new InpiImportError('invalid_source', 'Carga do INPI incompleta.');
    await flush();
    await client.query('UPDATE inpi_file_checkpoint SET complete=true WHERE import_id=$1 AND source=$2', [id, source.table]);
    return true;
  } finally {
    streamController.abort(); input.destroy(); parser.destroy();
    if (body instanceof Readable) body.destroy();
    await pumping;
  }
}

/** Every committed CSV boundary and candidate batch can survive process/connection loss. */
export async function importInpiBaseline(client: PoolClient, options: Options = {}) {
  return withInpiLock(client, async () => {
    const started = Date.now(), deadline = started + INPI_LIMITS.sliceMs;
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(new InpiImportError('duration',
      'A fatia excedeu doze minutos. Investigar latência do banco/armazenamento antes de retomar o checkpoint.')), INPI_LIMITS.sliceMs + 2 * 60_000);
    const disconnected = () => controller.abort(new Error('Conexão do importador encerrada.'));
    client.on('error', disconnected);
    let id: string | undefined, stage = 'metadata';
    try {
      const control = (await client.query('SELECT suspended FROM inpi_sync WHERE id=1')).rows[0];
      if (control.suspended) throw new InpiImportError('suspended', 'Importação suspensa. Corrigir a condição registrada e executar inpi:admin resume.');
      const attempt = await reserveInpiAttempt(client);
      await configureInpiSession(client);
      await checkInpiCapacity(client);
      const manifest = await identities(controller.signal);
      const remote = await remoteObjectStorage();
      if (!remote && process.env.NODE_ENV === 'production') throw new InpiImportError('capacity', 'A carga exige armazenamento de objetos remoto em produção.');
      if (options.directory && process.env.NODE_ENV === 'production') throw new InpiImportError('invalid_source', 'Importação de arquivos locais permitida somente em desenvolvimento.');
      const localHashes: string[] = [];
      if (options.directory) for (const source of sources) {
        const path = `${options.directory}/${source.file}`, hash = createHash('sha256');
        if (!existsSync(path) || (await stat(path)).size !== manifest[sources.indexOf(source)].size) throw new InpiImportError('invalid_source', 'Arquivo local do INPI incompleto.');
        for await (const bytes of createReadStream(path)) hash.update(bytes);
        localHashes.push(hash.digest('hex'));
      }
      const identity = createHash('sha256').update(JSON.stringify({ version: 2, buckets: INPI_BUCKETS, manifest, localHashes })).digest('hex');
      const pending = await client.query<{ id: string; identity: string }>("SELECT id,identity FROM inpi_import WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated') LIMIT 1");
      if (pending.rowCount && pending.rows[0].identity !== identity) throw new InpiImportError('source_changed', 'A identidade da carga mudou. Invalidar explicitamente o candidato antes de iniciar outra versão.');
      let run = (await client.query<{ id: string; phase: string; next_bucket: number; carry_after: string; elapsed_ms: string }>('SELECT id,phase,next_bucket,carry_after,elapsed_ms FROM inpi_import WHERE identity=$1', [identity])).rows[0];
      if (run?.phase === 'done') {
        await new InpiStaging(client, run.id).clean();
        await finishInpiAttempt(client, true); return true;
      }
      if (run?.phase === 'invalidated') throw new InpiImportError('source_changed', 'Esta identidade foi invalidada. Conferir os arquivos antes de autorizar uma nova carga.');
      if (!run) {
        const retired = await client.query<{ id: string }>(`SELECT DISTINCT import_id AS id FROM inpi_staging_object s JOIN inpi_import i ON i.id=s.import_id
          WHERE i.state='completed' OR i.phase='invalidated' LIMIT 10`);
        for (const prior of retired.rows) {
          if (!await new InpiStaging(client, prior.id).clean()) { await finishInpiAttempt(client, false); return false; }
        }
        if ((await client.query(`SELECT 1 FROM inpi_staging_object s JOIN inpi_import i ON i.id=s.import_id
          WHERE i.state='completed' OR i.phase='invalidated' LIMIT 1`)).rowCount) { await finishInpiAttempt(client, false); return false; }
        await client.query('BEGIN');
        try {
          const fresh = await beginInpiImport(client, { kind: 'baseline', edition: null, publishedOn: manifest[0].modified.slice(0,10), sourceUrl: 'https://dadosabertos.inpi.gov.br/index/marcas/' });
          id = fresh.id;
          await client.query('UPDATE inpi_import SET identity=$2,manifest_json=$3,wal_start=pg_current_wal_lsn() WHERE id=$1', [id, identity, JSON.stringify(manifest)]);
          for (const source of sources) await client.query('INSERT INTO inpi_file_checkpoint(import_id,source) VALUES($1,$2)', [id, source.table]);
          // Only the retired rollback copy is removed; the published corpus stays readable.
          await client.query('DROP TABLE IF EXISTS inpi_trademark_previous, inpi_vienna_previous');
          await client.query('CREATE TABLE inpi_trademark_candidate (LIKE inpi_trademark INCLUDING ALL)');
          await client.query('ALTER TABLE inpi_trademark_candidate ADD FOREIGN KEY(import_id) REFERENCES inpi_import(id)');
          await client.query('CREATE TABLE inpi_vienna_candidate (LIKE inpi_vienna_term INCLUDING ALL)');
          await client.query(`DO $copy_grants$ DECLARE permission RECORD; BEGIN
            FOR permission IN SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.role_table_grants
              WHERE table_schema=current_schema() AND table_name IN ('inpi_trademark','inpi_vienna_term') LOOP
              EXECUTE format('GRANT %s ON TABLE %I TO %s%s', permission.privilege_type,
                CASE permission.table_name WHEN 'inpi_trademark' THEN 'inpi_trademark_candidate' ELSE 'inpi_vienna_candidate' END,
                CASE permission.grantee WHEN 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(permission.grantee) END,
                CASE permission.is_grantable WHEN 'YES' THEN ' WITH GRANT OPTION' ELSE '' END);
            END LOOP; END $copy_grants$`);
          await client.query('COMMIT');
          run = { id, phase: 'download', next_bucket: 0, carry_after: '', elapsed_ms: '0' };
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
      }
      id = run.id;
      console.info(JSON.stringify({ event: 'inpi_attempt', importId: id, stage: run.phase, attempt }));
      await client.query("UPDATE inpi_import SET state='running',error=NULL WHERE id=$1", [id]);
      const staging = new InpiStaging(client, id, remote ? INPI_LIMITS.stagingBytes : INPI_LIMITS.localBytes, controller.signal);
      if (!await staging.clean(true)) return false;
      let sampledAt = started;
      const checkpoint = async (capacity = true) => {
        controller.signal.throwIfAborted();
        const elapsed = Number(run.elapsed_ms) + Date.now() - started;
        if (elapsed > INPI_LIMITS.totalMs) throw new InpiImportError('duration', 'Carga excedeu 24 horas de execução. Investigar duração antes de retomar.');
        // Download only grows the bounded object catalog. Avoid repeatedly scanning every
        // relation in a shared database; candidate writes still check before every batch.
        if (capacity && Date.now() - sampledAt >= 30_000) { await checkInpiCapacity(client, run.id); sampledAt = Date.now(); }
        return Date.now() < deadline;
      };
      if (run.phase === 'download') {
        for (let i = 0; i < sources.length; i++) {
          stage = 'download';
          if (!await checkpoint() || !await stageFile(client, staging, id, sources[i], manifest[i], options, controller.signal, checkpoint)) { await finishInpiAttempt(client, false); return false; }
        }
        await client.query("UPDATE inpi_import SET phase='build' WHERE id=$1", [id]); run.phase = 'build';
      }
      if (run.phase === 'build') {
        stage = 'build';
        for (let bucket = run.next_bucket; bucket < INPI_BUCKETS; bucket++) {
          if (!await checkpoint(false)) { await finishInpiAttempt(client, false); return false; }
          const batchStarted = Date.now();
          const metrics = await buildInpiBucket(client, { id, publishedOn: manifest[0].modified.slice(0,10) }, staging, sources, bucket);
          const progress: InpiProgress = { importId: id, stage, bucket, durationMs: Date.now() - batchStarted, ...metrics };
          if (metrics.batchRows || bucket % 32 === 0) console.info(JSON.stringify({ event: 'inpi_progress', ...progress }));
          await options.progress?.(`Preparando lote ${bucket + 1}/${INPI_BUCKETS}`, progress);
        }
        await client.query("UPDATE inpi_import SET phase='carry' WHERE id=$1", [id]); run.phase = 'carry';
      }
      if (run.phase === 'carry') {
        stage = 'carry'; let after = run.carry_after, batches = 0;
        for (;;) {
          if (!await checkpoint(false)) { await finishInpiAttempt(client, false); return false; }
          const batchStarted = Date.now();
          const { last, ...metrics } = await carryInpiBatch(client, id, after);
          const progress: InpiProgress = { importId: id, stage, durationMs: Date.now() - batchStarted, ...metrics };
          if (batches++ % 32 === 0 || !last) console.info(JSON.stringify({ event: 'inpi_progress', ...progress, batches }));
          await options.progress?.('Preservando processos anteriores', progress);
          if (!last) break;
          after = last;
        }
      }
      stage = 'publish';
      const terms = await client.query<{ count: number; bytes: string }>(`SELECT count(*)::int AS count,coalesce(sum(octet_length(v.code)+octet_length(v.description)),0)::text AS bytes
        FROM (SELECT * FROM inpi_vienna_term LIMIT 10001) v`);
      if (terms.rows[0].count > 10000 || Number(terms.rows[0].bytes) > INPI_LIMITS.batchBytes) throw new InpiImportError('capacity', 'Catálogo anterior de Viena excede 10 mil termos ou 8 MiB.');
      await checkInpiCapacity(client, id);
      await client.query('INSERT INTO inpi_vienna_candidate SELECT * FROM inpi_vienna_term ON CONFLICT(code) DO NOTHING');
      // Verify all four identities again immediately before the atomic publication.
      if (JSON.stringify(await identities(controller.signal)) !== JSON.stringify(manifest)) throw new InpiDownloadError('INPI_SOURCE_CHANGED');
      if (options.directory) for (let i = 0; i < sources.length; i++) {
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(`${options.directory}/${sources[i].file}`)) hash.update(bytes);
        if (hash.digest('hex') !== localHashes[i]) throw new InpiDownloadError('INPI_SOURCE_CHANGED');
      }
      await options.progress?.('Publicando acervo', { importId: id, stage });
      await publishInpiCandidate(client, id);
      await finishInpiAttempt(client, true);
      await staging.clean().catch(error => captureOperationalError(error, 'research.inpi.staging.cleanup', { import_id: run.id }));
      return true;
    } catch (error) {
      const interruption = controller.signal.reason instanceof InpiImportError ? controller.signal.reason : error;
      const failure = inpiFailure(interruption);
      console.warn(JSON.stringify({ event: 'inpi_interrupted', importId: id ?? null, stage, reason: failure.code, durationMs: Date.now() - started }));
      captureOperationalError(interruption, 'research.inpi.baseline', { stage, import_id: id ?? 'unassigned', inpi_failure: failure.code });
      if (id) await client.query("UPDATE inpi_import SET state='failed',error=$2 WHERE id=$1 AND state<>'completed'", [id, failure.condition]).catch(() => undefined);
      if (!(interruption instanceof InpiImportError && interruption.code === 'suspended')) await recordInpiFailure(client, interruption);
      throw interruption;
    } finally {
      clearTimeout(watchdog);
      controller.abort(); client.off('error', disconnected);
      if (id) await client.query('UPDATE inpi_import SET elapsed_ms=elapsed_ms+$2 WHERE id=$1', [id, Date.now() - started]).catch(() => undefined);
      await client.query('RESET ALL').catch(() => undefined);
    }
  });
}
