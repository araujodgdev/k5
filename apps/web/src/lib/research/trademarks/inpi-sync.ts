import 'server-only';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { open, type Entry, type ZipFile } from 'yauzl';
import type { PoolClient } from 'pg';
import { authStore } from '@/lib/database';
import { objectStorage, storageKey } from '@/lib/storage';
import { parseInpiXml } from './inpi-xml';
import { beginInpiImport, ingestInpiRecords } from './inpi-ingest';
import { downloadInpiCsv } from './inpi-download';
import { captureOperationalError } from '@/lib/observability/report';
import { checkInpiCapacity, configureInpiSession, withInpiLock } from './inpi-capacity';
import { finishInpiAttempt, inpiLocallyUnavailable, recordInpiFailure, reserveInpiAttempt } from './inpi-retry';
import { InpiImportError } from './inpi-errors';
import { InpiStaging } from './inpi-staging';

const reportConnectionError = (error: Error) => captureOperationalError(error,'research.inpi.connection');

export type RpiPublication = { edition: number; publishedOn: string; sourceUrl: string };
export function discoverRpiPublications(html: string): RpiPublication[] {
  const result: RpiPublication[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const localized = row[1].match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
    const date = row[1].match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
      ?? (localized ? `${localized[3]}-${localized[2]}-${localized[1]}` : undefined);
    const link = row[1].match(/href=['"](https:\/\/revistas\.inpi\.gov\.br\/txt\/RM(\d{4,5})\.zip)['"]/i);
    if (date && link) result.push({ edition: Number(link[2]),publishedOn: date,sourceUrl: link[1] });
  }
  if (!result.length) throw new Error('O índice da RPI mudou ou não contém XML de marcas.');
  return result.sort((a,b) => a.edition-b.edition);
}

async function boundedResponse(response: Response, maximum: number) {
  if (!response.ok || !response.body) throw new Error('A fonte do INPI está indisponível.');
  const chunks: Buffer[] = []; let size = 0;
  const reader=response.body.getReader();
  try { for (;;) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>maximum) {await reader.cancel();throw new Error('Publicação acima do limite de leitura.');} chunks.push(Buffer.from(value)); } }
  finally {reader.releaseLock();}
  return Buffer.concat(chunks);
}
async function downloadRpi(url:string) {
  const metadata=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30_000)});
  const size=Number(metadata.headers.get('content-length')),etag=metadata.headers.get('etag');
  if (!metadata.ok || !Number.isSafeInteger(size) || size<1 || size>64*1024*1024 || !etag) throw new Error('Metadados da RPI ausentes ou inválidos.');
  const chunks:Buffer[]=[];
  for await(const bytes of downloadInpiCsv(url,{size,etag})) chunks.push(Buffer.from(bytes));
  return Buffer.concat(chunks);
}
async function xmlStream(path: string, edition: number): Promise<{ zip: ZipFile; stream: Readable }> {
  const zip = await new Promise<ZipFile>((resolve,reject) => open(path,{ lazyEntries: true },(error,value) => error || !value ? reject(error ?? new Error('ZIP inválido.')) : resolve(value)));
  return new Promise((resolve,reject) => {
    zip.on('error',reject);
    zip.on('end',() => reject(new Error('XML ausente no ZIP da RPI.')));
    zip.on('entry',(entry: Entry) => {
      if (entry.fileName !== `RM${edition}.xml`) { zip.close(); reject(new Error('Arquivo inesperado no ZIP da RPI.')); return; }
      if (entry.uncompressedSize > 256*1024*1024 || zip.entryCount !== 1) { zip.close(); reject(new Error('ZIP da RPI excede o limite de leitura.')); return; }
      zip.openReadStream(entry,(error,stream) => error || !stream ? reject(error ?? new Error('XML inválido.')) : resolve({zip,stream}));
    }); zip.readEntry();
  });
}

async function importRpiPublicationLocked(client: PoolClient, publication: RpiPublication, options: { bytes?: Buffer; archive?: (id: string, bytes: Buffer) => Promise<string> } = {}) {
  const pending = await client.query("SELECT 1 FROM inpi_import WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated')" );
  if (pending.rowCount) throw new InpiImportError('suspended', 'Concluir ou invalidar o candidato antes de importar RPI.');
  const run = await beginInpiImport(client,{ ...publication,kind: 'rpi' });
  if (run.state === 'completed') return false;
  await client.query('UPDATE inpi_import SET wal_start=coalesce(wal_start,pg_current_wal_lsn()) WHERE id=$1', [run.id]);
  await checkInpiCapacity(client, run.id);
  const directory = await mkdtemp(join(tmpdir(),'lume-rpi-'));
  let archiveKey: string | undefined;
  try {
    const bytes = options.bytes ?? await downloadRpi(publication.sourceUrl);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = join(directory,`RM${publication.edition}.zip`); await writeFile(path,bytes);
    const {zip,stream} = await xmlStream(path,publication.edition);
    await client.query('BEGIN');
    let count: number;
    try {
      await client.query('DELETE FROM inpi_trademark_event WHERE edition=$1',[publication.edition]);
      count = await parseInpiXml(stream,publication,async batch => {
        await checkInpiCapacity(client, run.id);
        const previous = await client.query<{ bytes: string }>('SELECT coalesce(sum(octet_length(t::text)),0)::text AS bytes FROM inpi_trademark t WHERE process_number=ANY($1::text[])', [batch.map(record => record.processNumber)]);
        if (Number(previous.rows[0].bytes) > 32 * 1024 * 1024) throw new InpiImportError('capacity', 'Dados anteriores do lote RPI excedem 32 MiB.');
        await ingestInpiRecords(client,batch,{ ...publication,id: run.id });
      });
      archiveKey = options.archive ? await options.archive(run.id,bytes) : storageKey('00000000-0000-0000-0000-000000000000',run.id,'zip');
      if (!options.archive) await (await objectStorage()).put(archiveKey,bytes,{signal:AbortSignal.timeout(60_000)});
      await client.query("SELECT pg_advisory_xact_lock(hashtext('inpi-corpus-publication'))");
      await client.query(`UPDATE inpi_import SET state='completed',record_count=$2,sha256=$3,archive_key=$4,completed_at=CURRENT_TIMESTAMP,error=NULL WHERE id=$1`,[run.id,count,sha256,archiveKey]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { stream.destroy(); zip.close(); }
    return true;
  } catch (error) {
    if (archiveKey && !options.archive) await (await objectStorage()).delete(archiveKey,{signal:AbortSignal.timeout(60_000)}).catch(() => undefined);
    await client.query(`UPDATE inpi_import SET state='failed',error='Não foi possível validar ou importar esta RPI. A base anterior foi preservada.' WHERE id=$1`,[run.id]);
    throw error;
  } finally { await rm(directory,{recursive:true,force:true}); }
}

export async function importRpiPublication(client: PoolClient, publication: RpiPublication, options: Parameters<typeof importRpiPublicationLocked>[2] = {}) {
  return await withInpiLock(client, async () => {
    await configureInpiSession(client);
    try { return await importRpiPublicationLocked(client, publication, options); }
    finally { await client.query('RESET ALL').catch(() => undefined); }
  }) ?? false;
}

export async function syncInpiRpi(options: { force?: boolean; client?: PoolClient } = {}) {
  const pool=await authStore(),client=options.client ?? await pool.connect();
  client.on('error',reportConnectionError);
  try {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('inpi-corpus-import')) AS acquired");
    if (!lock.rows[0].acquired) return false;
    try {
      const pending = await client.query("SELECT 1 FROM inpi_import WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated')" );
      if (pending.rowCount) return false;
      const due = await client.query('SELECT 1 FROM inpi_sync WHERE id=1 AND NOT suspended AND attempts<5 AND next_check_at<=CURRENT_TIMESTAMP');
      if (!options.force && !due.rowCount) return false;
      await reserveInpiAttempt(client);
      await configureInpiSession(client);
      const html = (await boundedResponse(await fetch('https://revistas.inpi.gov.br/rpi/',{signal:AbortSignal.timeout(30_000)}),2*1024*1024)).toString('utf8');
      const publications = discoverRpiPublications(html);
      const latest = await client.query<{ edition: number | null; baseline: string | null }>(`SELECT (SELECT max(edition) FROM inpi_import WHERE state='completed') AS edition,
        (SELECT max(published_on)::text FROM inpi_import WHERE kind='baseline' AND state='completed') AS baseline`);
      const {edition,baseline} = latest.rows[0];
      // Backfill every numbered gap, including editions no longer present on the eight-row index.
      const newest = publications.at(-1); if (!newest) return false;
      if (edition !== null && newest.edition-edition>500) throw new Error('Acervo muito defasado; execute a reconciliação inicial.');
      let changed = false, last=edition, imported=0;
      for (const publication of publications.filter(p => edition !== null ? p.edition>edition : baseline ? p.publishedOn>=baseline : p.edition===newest.edition)) {
        if (last !== null && publication.edition>last+1) {
          for (let missing=last+1;missing<publication.edition;missing++) {
            if (publications.some(p => p.edition===missing)) continue;
            const sourceUrl=`https://revistas.inpi.gov.br/txt/RM${missing}.zip`;
            const bytes=await downloadRpi(sourceUrl);
            const directory=await mkdtemp(join(tmpdir(),'lume-rpi-header-'));
            try {
              const path=join(directory,'edition.zip');await writeFile(path,bytes);
              const {zip,stream}=await xmlStream(path,missing);
              let header='';
              try { for await(const chunk of stream){ header+=chunk.toString('utf8');if(header.includes('<processo'))break;if(header.length>16_000)throw new Error('Cabeçalho XML inválido.');} }
              finally {stream.destroy();zip.close();}
              const root=header.match(/<revista\b[^>]*\bnumero="(\d+)"[^>]*\bdata="(\d{2})\/(\d{2})\/(\d{4})"/);
              if(!root || Number(root[1])!==missing) throw new Error('Edição intermediária inválida.');
              changed=await importRpiPublication(client,{edition:missing,publishedOn:`${root[4]}-${root[3]}-${root[2]}`,sourceUrl},{bytes}) || changed;
              if (++imported === 2) { await finishInpiAttempt(client, false); return changed; }
            } finally {await rm(directory,{recursive:true,force:true});}
          }
        }
        changed = await importRpiPublication(client,publication) || changed;
        if (++imported === 2) { await finishInpiAttempt(client, false); return changed; }
        last=publication.edition;
      }
      await finishInpiAttempt(client, true); return changed;
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))").catch(() => undefined); }
  } catch (error) {
    await recordInpiFailure(client, error);
    throw error;
  } finally {
    await client.query('RESET ALL').catch(() => undefined);
    client.off('error',reportConnectionError);if (!options.client) client.release(true);
  }
}

export async function runInpiMaintenance() {
  if (inpiLocallyUnavailable()) return false;
  const pool = await authStore(), client = await pool.connect();
  client.on('error', reportConnectionError);
  let broken = false;
  try {
    return await withInpiLock(client, async () => {
      const due = await client.query('SELECT 1 FROM inpi_sync WHERE id=1 AND NOT suspended AND attempts<5 AND next_check_at<=CURRENT_TIMESTAMP');
      if (!due.rowCount) return false;
      const retired = await client.query<{ id: string }>(`SELECT DISTINCT import_id AS id FROM inpi_staging_object s JOIN inpi_import i ON i.id=s.import_id
        WHERE i.state='completed' OR i.phase='invalidated' LIMIT 1`);
      if (retired.rowCount) {
        await reserveInpiAttempt(client);
        try { await new InpiStaging(client, retired.rows[0].id).clean(); await finishInpiAttempt(client, false); }
        catch (error) { await recordInpiFailure(client, error); throw error; }
      }
      const baseline = await client.query<{ needed: boolean }>(`SELECT
        EXISTS(SELECT 1 FROM inpi_import WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated'))
        OR NOT EXISTS(SELECT 1 FROM inpi_import WHERE kind='baseline' AND state='completed' AND completed_at>CURRENT_TIMESTAMP-INTERVAL '30 days') AS needed`);
      if (baseline.rows[0].needed) {
        const startedAt = Date.now();
        const { importInpiBaseline } = await import('./inpi-baseline');
        const completed = await importInpiBaseline(client);
        if (!completed) return false;
        // A long baseline slice must leave RPI for the next scheduled invocation.
        if (Date.now() - startedAt >= 60_000) return true;
        // An unchanged monthly snapshot must not starve the weekly RPI stream.
        await syncInpiRpi({ force: true, client });
        return true;
      }
      return syncInpiRpi({ force: true, client });
    }) ?? false;
  } catch (error) { broken = true; throw error; }
  finally { client.off('error', reportConnectionError); client.release(broken); }
}
export async function importLocalRpi(path: string, publication: RpiPublication) {
  const client = await (await authStore()).connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
    return await importRpiPublication(client,publication,{bytes:await readFile(path)});
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))"); client.release(); }
}
