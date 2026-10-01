import 'server-only';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { from as copyFrom } from 'pg-copy-streams';
import type { PoolClient } from 'pg';
import { INPI_BUCKETS, INPI_LIMITS, InpiStaging, type InpiStageSource } from './inpi-staging';
import { checkInpiCapacity } from './inpi-capacity';
import { InpiImportError } from './inpi-errors';

export type BaselineSource = { file: string; table: InpiStageSource; columns: string[]; staged: string[] };
export async function buildInpiBucket(client: PoolClient, run: { id: string; publishedOn: string }, staging: InpiStaging, sources: BaselineSource[], bucket: number) {
  const batch = await staging.bucketSize(bucket);
  if (!batch.rows) {
    await client.query('UPDATE inpi_import SET next_bucket=$2 WHERE id=$1', [run.id, bucket + 1]);
    return { batchBytes: 0, batchRows: 0, scratchBytes: 0 };
  }
  const metrics = await checkInpiCapacity(client, run.id);
  await client.query('BEGIN');
  try {
    for (const source of sources) {
      await client.query(`CREATE TEMP TABLE ${source.table} (${source.staged.map(column => `${column} text`).join(',')}) ON COMMIT DROP`);
      await pipeline(Readable.from(await staging.read(source.table, bucket)), client.query(copyFrom(`COPY ${source.table} FROM STDIN WITH(FORMAT csv)`)));
      await client.query(`CREATE ${source.table === 'inpi_stage_bib' ? 'UNIQUE ' : ''}INDEX ON ${source.table}(numero_inpi)`);
      await client.query(`ANALYZE ${source.table}`);
    }
    const previous = await client.query<{ bytes: string }>(`SELECT coalesce(sum(octet_length(t::text)),0)::text AS bytes
      FROM inpi_stage_bib b JOIN inpi_trademark t ON t.process_number=b.numero_inpi`);
    if (Number(previous.rows[0].bytes) > INPI_LIMITS.bucketBytes) throw new InpiImportError('capacity', 'Dados anteriores do lote excedem 32 MiB. Reparticionar antes de retomar.');
    await client.query(`CREATE TEMP TABLE inpi_stage_records ON COMMIT DROP AS SELECT b.numero_inpi AS process_number,b.elemento_nominativo AS name,
      b.descricao_situacao AS situation,b.normalized_name,b.situation_group,coalesce(o.owners,'{}'::text[]) AS owners,coalesce(n.nice_classes,'{}'::int[]) AS nice_classes,coalesce(v.vienna_codes,'{}'::text[]) AS vienna_codes,
      jsonb_strip_nulls(jsonb_build_object('Data do depósito',nullif(b.data_deposito,''),'Data da publicação',nullif(b.data_publicacao,''),'Data da concessão',nullif(b.data_concessao,''),'Vigência',nullif(b.data_vigencia,''),
      'Apresentação',nullif(b.descricao_apresentacao,''),'Natureza',nullif(b.descricao_natureza,''),'Tradução',nullif(b.traducao,''),'Apostila',nullif(b.apostila,''),'Código de situação',nullif(b.codigo_situacao,''),'Situação nos dados abertos',nullif(b.descricao_situacao,''),'Produtos e serviços',n.specifications)) AS fields
      FROM inpi_stage_bib b
      LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT nome ORDER BY nome) AS owners FROM inpi_stage_owner GROUP BY numero_inpi) o USING(numero_inpi)
      LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT classe_nice::int ORDER BY classe_nice::int) AS nice_classes,string_agg(DISTINCT concat(classe_nice,': ',especificacao),E'\n' ORDER BY concat(classe_nice,': ',especificacao)) AS specifications FROM inpi_stage_nice GROUP BY numero_inpi) n USING(numero_inpi)
      LEFT JOIN (SELECT numero_inpi,array_agg(DISTINCT simbolo ORDER BY simbolo) AS vienna_codes FROM inpi_stage_vienna GROUP BY numero_inpi) v USING(numero_inpi)`);
    const oversized = await client.query('SELECT 1 FROM inpi_stage_records r WHERE octet_length(r::text)>$1 LIMIT 1', [INPI_LIMITS.recordBytes * 4]);
    if (oversized.rowCount) throw new InpiImportError('capacity', 'Registro agregado excede 8 MiB. Rever a fonte antes de retomar.');
    const inserted = await client.query(`INSERT INTO inpi_trademark_candidate(process_number,name,normalized_name,owners,nice_classes,vienna_codes,situation,situation_group,fields,published_on,latest_edition,import_id)
      SELECT s.process_number,CASE WHEN t.published_on>$1 THEN coalesce(t.name,nullif(s.name,'')) ELSE nullif(s.name,'') END,
      CASE WHEN t.published_on>$1 AND t.name IS NOT NULL THEN t.normalized_name ELSE s.normalized_name END,
      CASE WHEN t.published_on>$1 AND cardinality(t.owners)>0 THEN t.owners ELSE s.owners END,
      CASE WHEN t.published_on>$1 AND cardinality(t.nice_classes)>0 THEN t.nice_classes ELSE s.nice_classes END,
      CASE WHEN t.published_on>$1 AND cardinality(t.vienna_codes)>0 THEN t.vienna_codes ELSE s.vienna_codes END,
      CASE WHEN t.published_on>$1 THEN t.situation ELSE nullif(s.situation,'') END,
      CASE WHEN t.published_on>$1 THEN t.situation_group ELSE s.situation_group END,
      CASE WHEN t.published_on>$1 THEN s.fields || t.fields ELSE s.fields END,
      CASE WHEN t.published_on>$1 THEN t.published_on ELSE $1::date END,
      CASE WHEN t.published_on>$1 THEN t.latest_edition ELSE NULL END,
      CASE WHEN t.published_on>$1 THEN t.import_id ELSE $2 END
      FROM inpi_stage_records s LEFT JOIN inpi_trademark t USING(process_number)`, [run.publishedOn, run.id]);
    await client.query(`INSERT INTO inpi_vienna_candidate(code,description) SELECT simbolo,min(classificacao_viena) FROM inpi_stage_vienna GROUP BY simbolo
      ON CONFLICT(code) DO UPDATE SET description=least(inpi_vienna_candidate.description,excluded.description)`);
    await client.query('UPDATE inpi_import SET next_bucket=$2,record_count=record_count+$3 WHERE id=$1', [run.id, bucket + 1, inserted.rowCount]);
    const scratch = await client.query<{ bytes: string }>(`SELECT sum(pg_total_relation_size(c.oid))::text AS bytes FROM pg_class c WHERE c.relnamespace=pg_my_temp_schema() AND c.relkind='r'`);
    await client.query('COMMIT');
    return { ...metrics, batchBytes: batch.bytes, batchRows: batch.rows, scratchBytes: Number(scratch.rows[0].bytes) };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}

export async function carryInpiBatch(client: PoolClient, id: string, after: string) {
  const metrics = await checkInpiCapacity(client, id);
  const size = await client.query<{ bytes: string; rows: number; last: string | null }>(`SELECT coalesce(sum(octet_length(r::text)),0)::text AS bytes,count(*)::int AS rows,max(process_number) AS last
    FROM (SELECT * FROM inpi_trademark WHERE process_number>$1 ORDER BY process_number LIMIT 1000) r`, [after]);
  if (Number(size.rows[0].bytes) > INPI_LIMITS.batchBytes) throw new InpiImportError('capacity', 'Lote do corpus anterior excede 8 MiB. Rever tamanho dos registros.');
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TEMP TABLE inpi_carry ON COMMIT DROP AS SELECT * FROM inpi_trademark WHERE process_number>$1 ORDER BY process_number LIMIT 1000`, [after]);
    const result = await client.query('INSERT INTO inpi_trademark_candidate SELECT * FROM inpi_carry ON CONFLICT(process_number) DO NOTHING');
    const last = size.rows[0].last;
    await client.query(`UPDATE inpi_import SET carry_after=coalesce($2,carry_after),record_count=record_count+$3,phase=CASE WHEN $2::text IS NULL THEN 'publish' ELSE 'carry' END WHERE id=$1`, [id, last, result.rowCount]);
    await client.query('COMMIT');
    return { last, ...metrics, batchBytes: Number(size.rows[0].bytes), batchRows: size.rows[0].rows };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}

export async function publishInpiCandidate(client: PoolClient, id: string) {
  await checkInpiCapacity(client, id);
  await client.query('BEGIN');
  try {
    const complete = await client.query(`SELECT 1 FROM inpi_import WHERE id=$1 AND phase='publish' AND next_bucket=$2 AND record_count>0
      AND record_count>=(SELECT records FROM inpi_file_checkpoint WHERE import_id=$1 AND source='inpi_stage_bib')
      AND (SELECT count(*) FROM inpi_file_checkpoint WHERE import_id=$1 AND complete)=4`, [id, INPI_BUCKETS]);
    if (!complete.rowCount) throw new InpiImportError('invalid_source', 'A validação do candidato não terminou.');
    // Readers acquire the shared advisory lock before any corpus reads. No table name/OID
    // can change between their count, metadata and page queries.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('inpi-corpus-publication'))");
    await client.query('ALTER TABLE inpi_trademark RENAME TO inpi_trademark_previous');
    await client.query('ALTER TABLE inpi_trademark_candidate RENAME TO inpi_trademark');
    await client.query('ALTER TABLE inpi_vienna_term RENAME TO inpi_vienna_previous');
    await client.query('ALTER TABLE inpi_vienna_candidate RENAME TO inpi_vienna_term');
    await client.query("UPDATE inpi_import SET phase='done',state='completed',completed_at=CURRENT_TIMESTAMP,error=NULL WHERE id=$1", [id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}
