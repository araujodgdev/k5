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

export async function importRpiPublication(client: PoolClient, publication: RpiPublication, options: { bytes?: Buffer; archive?: (id: string, bytes: Buffer) => Promise<string> } = {}) {
  const run = await beginInpiImport(client,{ ...publication,kind: 'rpi' });
  if (run.state === 'completed') return false;
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
      count = await parseInpiXml(stream,publication,batch => ingestInpiRecords(client,batch,{ ...publication,id: run.id }));
      archiveKey = options.archive ? await options.archive(run.id,bytes) : storageKey('00000000-0000-0000-0000-000000000000',run.id,'zip');
      if (!options.archive) await (await objectStorage()).put(archiveKey,bytes);
      await client.query(`UPDATE inpi_import SET state='completed',record_count=$2,sha256=$3,archive_key=$4,completed_at=CURRENT_TIMESTAMP,error=NULL WHERE id=$1`,[run.id,count,sha256,archiveKey]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { stream.destroy(); zip.close(); }
    return true;
  } catch (error) {
    if (archiveKey && !options.archive) await (await objectStorage()).delete(archiveKey).catch(() => undefined);
    await client.query(`UPDATE inpi_import SET state='failed',error='Não foi possível validar ou importar esta RPI. A base anterior foi preservada.' WHERE id=$1`,[run.id]);
    throw error;
  } finally { await rm(directory,{recursive:true,force:true}); }
}

export async function syncInpiRpi(options: { force?: boolean } = {}) {
  const client = await (await authStore()).connect();
  try {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('inpi-corpus-import')) AS acquired");
    if (!lock.rows[0].acquired) return false;
    try {
      await client.query(`UPDATE inpi_import SET state='failed',error='Execução interrompida; a atualização será retomada.' WHERE state='running'`);
      const due = await client.query('SELECT 1 FROM inpi_sync WHERE id=1 AND next_check_at<=CURRENT_TIMESTAMP');
      if (!options.force && !due.rowCount) return false;
      await client.query(`UPDATE inpi_sync SET checked_at=CURRENT_TIMESTAMP,next_check_at=CURRENT_TIMESTAMP+INTERVAL '5 minutes' WHERE id=1`);
      const html = (await boundedResponse(await fetch('https://revistas.inpi.gov.br/rpi/',{signal:AbortSignal.timeout(30_000)}),2*1024*1024)).toString('utf8');
      const publications = discoverRpiPublications(html);
      const latest = await client.query<{ edition: number | null; baseline: string | null }>(`SELECT (SELECT max(edition) FROM inpi_import WHERE state='completed') AS edition,
        (SELECT max(published_on)::text FROM inpi_import WHERE kind='baseline' AND state='completed') AS baseline`);
      const {edition,baseline} = latest.rows[0];
      // Backfill every numbered gap, including editions no longer present on the eight-row index.
      const newest = publications.at(-1); if (!newest) return false;
      if (edition !== null && newest.edition-edition>500) throw new Error('Acervo muito defasado; execute a reconciliação inicial.');
      let changed = false, last=edition;
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
            } finally {await rm(directory,{recursive:true,force:true});}
          }
        }
        changed = await importRpiPublication(client,publication) || changed;
        last=publication.edition;
      }
      await client.query('UPDATE inpi_sync SET error=NULL WHERE id=1'); return changed;
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))"); }
  } catch (error) {
    await client.query(`UPDATE inpi_sync SET error='A atualização do INPI falhou. Nova tentativa será feita automaticamente.',next_check_at=CURRENT_TIMESTAMP+INTERVAL '15 minutes' WHERE id=1`).catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function runInpiMaintenance() {
  const changed=await syncInpiRpi();
  const pool=await authStore(),client=await pool.connect();
  try {
    const lock=await client.query<{acquired:boolean}>("SELECT pg_try_advisory_lock(hashtext('inpi-corpus-import')) AS acquired");
    if (!lock.rows[0].acquired) return changed;
    try {
      const baseline=await client.query<{completed_at:string}>("SELECT max(completed_at)::text AS completed_at FROM inpi_import WHERE kind='baseline' AND state='completed'");
      const previous=baseline.rows[0]?.completed_at;
      // Monthly reconciliation repairs fields omitted by weekly RPI movements.
      if (!previous || Date.now()-new Date(previous).getTime()>30*86_400_000) {
        const {importInpiBaseline}=await import('./inpi-baseline');
        await importInpiBaseline(client); return true;
      }
      return changed;
    } catch(error) {
      await client.query(`UPDATE inpi_sync SET error='Falha na carga de dados abertos do INPI. A base anterior continua disponível.',next_check_at=CURRENT_TIMESTAMP+INTERVAL '15 minutes' WHERE id=1`);
      throw error;
    } finally {await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))");}
  } finally {client.release();}
}

export async function importLocalRpi(path: string, publication: RpiPublication) {
  const client = await (await authStore()).connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
    return await importRpiPublication(client,publication,{bytes:await readFile(path)});
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))"); client.release(); }
}
