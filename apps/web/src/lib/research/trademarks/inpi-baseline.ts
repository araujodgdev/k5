import 'server-only';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { from as copyFrom } from 'pg-copy-streams';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { beginInpiImport } from './inpi-ingest';
import { normalizeTrademarkName, situationGroup, viennaCode } from './inpi-contracts';
import { downloadInpiCsv } from './inpi-download';

const base = 'https://dadosabertos.inpi.gov.br/download/marcas/';
const sources = [
  { file: 'MARCAS_DADOS_BIBLIOGRAFICOS.csv', table: 'inpi_stage_bib', columns: ['codigo_interno','numero_inpi','data_deposito','data_publicacao','data_concessao','data_vigencia','descricao_apresentacao','descricao_natureza','elemento_nominativo','traducao','apostila','codigo_situacao','descricao_situacao'] },
  { file: 'MARCAS_CLASSIFICACOES_NICE.csv', table: 'inpi_stage_nice', columns: ['codigo_interno','numero_inpi','edicao_nice','classe_nice','especificacao','especificacao_trad'] },
  { file: 'MARCAS_CLASSIFICACOES_VIENA.csv', table: 'inpi_stage_vienna', columns: ['codigo_interno','numero_inpi','simbolo','classificacao_viena','revisao_viena'] },
  { file: 'MARCAS_DEPOSITANTES.csv', table: 'inpi_stage_owner', columns: ['codigo_interno','numero_inpi','nome','estado','pais'] },
];
const csvCell = (value: string) => `"${value.replace(/"/g,'""')}"`;

/** COPY streams each file; the previous corpus remains visible until the import commits. */
export async function importInpiBaseline(client: PoolClient, options: { directory?: string; progress?: (stage: string) => void } = {}) {
  const head = await fetch(`${base}${sources[0].file}`,{method:'HEAD',signal:AbortSignal.timeout(30_000)});
  if (!head.ok) throw new Error('Dados abertos do INPI indisponíveis.');
  const modified = new Date(head.headers.get('last-modified') ?? '');
  if (!Number.isFinite(modified.getTime())) throw new Error('Data da carga do INPI ausente.');
  const publishedOn = modified.toISOString().slice(0,10);
  const run = await beginInpiImport(client,{kind:'baseline',edition:null,publishedOn,sourceUrl:'https://dadosabertos.inpi.gov.br/index/marcas/'});
  const manifest: Array<{ url: string; sha256: string; records: number; rejected: number; issues: Array<{row:number;reason:string}> }> = [];
  try {
    for (const source of sources) {
      options.progress?.(source.file);
      const metadata=await fetch(`${base}${source.file}`,{method:'HEAD',signal:AbortSignal.timeout(30_000)});
      const expectedBytes=Number(metadata.headers.get('content-length'));
      if(!metadata.ok || !Number.isSafeInteger(expectedBytes) || expectedBytes<1) throw new Error('Tamanho da carga do INPI ausente.');
      if(new Date(metadata.headers.get('last-modified') ?? '').toISOString().slice(0,10)!==publishedOn) throw new Error('Arquivos do INPI pertencem a cargas diferentes.');
      const stagedColumns = source.table==='inpi_stage_bib' ? [...source.columns,'normalized_name','situation_group'] : source.columns;
      await client.query(`CREATE TEMP TABLE ${source.table} (${stagedColumns.map(column => `${column} text`).join(',')})`);
      const path = options.directory ? `${options.directory}/${source.file}` : null;
      if(path && existsSync(path) && (await stat(path)).size!==expectedBytes) throw new Error('Arquivo local do INPI incompleto.');
      const etag=metadata.headers.get('etag');if(!etag)throw new Error('Versão da carga do INPI ausente.');
      const body = path && existsSync(path) ? createReadStream(path) : downloadInpiCsv(`${base}${source.file}`,{size:expectedBytes,etag});
      const hash = createHash('sha256');
      let records = 0, headers = false,readBytes=0,rejected=0,rowNumber=0;
      const issues:Array<{row:number;reason:string}>=[];
      const rows = Readable.from((async function* () { for await (const bytes of body) { hash.update(bytes);readBytes+=bytes.length; yield bytes; } })())
        .compose(parse({bom:true,columns:(columns: string[]) => { headers=true; if (!source.columns.every(column => columns.includes(column))) throw new Error('Layout dos dados abertos mudou.'); return columns; },skip_empty_lines:true,max_record_size:2_000_000}));
      const cells = async function* () {
        for await (const raw of rows) {
          const row = z.record(z.string(),z.string()).parse(raw);
          rowNumber++;row.numero_inpi=row.numero_inpi.trim();
          let reason:string|null=null;
          if (!/^\d{9}$/.test(row.numero_inpi)) reason='Número de processo inválido';
          if(source.table==='inpi_stage_vienna') {
            const code=viennaCode.safeParse(row.simbolo);if(code.success)row.simbolo=code.data;else reason='Código de Viena inválido';
          }
          if (source.table==='inpi_stage_nice' && (!Number.isInteger(Number(row.classe_nice)) || Number(row.classe_nice)<1 || Number(row.classe_nice)>45)) reason='Classe Nice inválida';
          if(reason){rejected++;if(issues.length<50)issues.push({row:rowNumber,reason});continue;}
          if (source.table==='inpi_stage_bib') { row.normalized_name=normalizeTrademarkName(row.elemento_nominativo); row.situation_group=situationGroup(row.descricao_situacao); }
          records++; yield stagedColumns.map(column => csvCell(row[column].trim())).join(',')+'\n';
        }
      };
      await pipeline(Readable.from(cells()),client.query(copyFrom(`COPY ${source.table} FROM STDIN WITH(FORMAT csv)`)));
      if (!headers || !records || readBytes!==expectedBytes) throw new Error('Carga do INPI incompleta.');
      manifest.push({url:`${base}${source.file}`,sha256:hash.digest('hex'),records,rejected,issues});
      await client.query('UPDATE inpi_import SET manifest_json=$2 WHERE id=$1',[run.id,JSON.stringify(manifest)]);
      await client.query(`CREATE INDEX ON ${source.table}(numero_inpi)`);
    }
    options.progress?.('Publicando acervo');
    await client.query('BEGIN');
    try {
      await client.query(`CREATE TEMP TABLE inpi_stage_records AS SELECT b.numero_inpi AS process_number,b.elemento_nominativo AS name,
        b.descricao_situacao AS situation,b.normalized_name,b.situation_group,coalesce(o.owners,'{}'::text[]) AS owners,coalesce(n.nice_classes,'{}'::int[]) AS nice_classes,coalesce(v.vienna_codes,'{}'::text[]) AS vienna_codes,
        jsonb_strip_nulls(jsonb_build_object('Data do depósito',nullif(b.data_deposito,''),'Data da publicação',nullif(b.data_publicacao,''),'Data da concessão',nullif(b.data_concessao,''),'Vigência',nullif(b.data_vigencia,''),
        'Apresentação',nullif(b.descricao_apresentacao,''),'Natureza',nullif(b.descricao_natureza,''),'Tradução',nullif(b.traducao,''),'Apostila',nullif(b.apostila,''),'Código de situação',nullif(b.codigo_situacao,''),'Situação nos dados abertos',nullif(b.descricao_situacao,''),'Produtos e serviços',n.specifications)) AS fields
        FROM inpi_stage_bib b
        LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT nome) AS owners FROM inpi_stage_owner GROUP BY numero_inpi) o USING(numero_inpi)
        LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT classe_nice::int) AS nice_classes,string_agg(DISTINCT concat(classe_nice,': ',especificacao),E'\n') AS specifications FROM inpi_stage_nice GROUP BY numero_inpi) n USING(numero_inpi)
        LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT simbolo) AS vienna_codes FROM inpi_stage_vienna GROUP BY numero_inpi) v USING(numero_inpi)`);
      const result = await client.query(`INSERT INTO inpi_trademark(process_number,name,normalized_name,owners,nice_classes,vienna_codes,situation,situation_group,fields,published_on,import_id)
        SELECT process_number,nullif(name,''),normalized_name,owners,nice_classes,vienna_codes,nullif(situation,''),situation_group,fields,$1,$2 FROM inpi_stage_records
        ON CONFLICT(process_number) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,owners=excluded.owners,nice_classes=excluded.nice_classes,vienna_codes=excluded.vienna_codes,
        situation=excluded.situation,situation_group=excluded.situation_group,fields=excluded.fields,published_on=excluded.published_on,latest_edition=NULL,import_id=excluded.import_id,updated_at=CURRENT_TIMESTAMP
        WHERE inpi_trademark.published_on<=excluded.published_on`,[publishedOn,run.id]);
      await client.query(`UPDATE inpi_trademark t SET name=coalesce(t.name,nullif(s.name,'')),normalized_name=CASE WHEN t.name IS NULL THEN s.normalized_name ELSE t.normalized_name END,
        owners=CASE WHEN cardinality(t.owners)=0 THEN s.owners ELSE t.owners END,nice_classes=CASE WHEN cardinality(t.nice_classes)=0 THEN s.nice_classes ELSE t.nice_classes END,
        vienna_codes=CASE WHEN cardinality(t.vienna_codes)=0 THEN s.vienna_codes ELSE t.vienna_codes END,fields=s.fields || t.fields
        FROM inpi_stage_records s WHERE s.process_number=t.process_number AND t.published_on>$1`,[publishedOn]);
      await client.query(`INSERT INTO inpi_vienna_term(code,description) SELECT simbolo,min(classificacao_viena) FROM inpi_stage_vienna GROUP BY simbolo ON CONFLICT(code) DO UPDATE SET description=excluded.description`);
      const sha = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      await client.query(`UPDATE inpi_import SET state='completed',record_count=$2,sha256=$3,manifest_json=$4,completed_at=CURRENT_TIMESTAMP WHERE id=$1`,[run.id,result.rowCount,sha,JSON.stringify(manifest)]);
      await client.query('COMMIT');
      options.progress?.(`${result.rowCount} processos importados`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } catch (error) {
    await client.query(`UPDATE inpi_import SET state='failed',error='Falha na carga inicial do INPI; os dados anteriores foram preservados.' WHERE id=$1`,[run.id]); throw error;
  } finally { for (const source of sources) await client.query(`DROP TABLE IF EXISTS ${source.table}`).catch(() => undefined); await client.query('DROP TABLE IF EXISTS inpi_stage_records').catch(() => undefined); }
}
