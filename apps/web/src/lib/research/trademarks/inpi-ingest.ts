import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inpiRecord, normalizeTrademarkName, situationGroup, type InpiRecord } from './inpi-contracts';

/** Sparse RPI movements merge published fields; repeated processes retain every dispatch. */
export async function ingestInpiRecords(client: PoolClient, records: InpiRecord[], publication: { id: string; edition: number; publishedOn: string }) {
  const merged = new Map<string, InpiRecord>();
  for (const raw of records) {
    const item = inpiRecord.parse(raw), previous = merged.get(item.processNumber);
    merged.set(item.processNumber, previous ? { ...item, name: item.name ?? previous.name, owners: item.owners ?? previous.owners,
      niceClasses: item.niceClasses ?? previous.niceClasses, viennaCodes: item.viennaCodes ?? previous.viennaCodes, fields: { ...previous.fields,...item.fields } } : item);
  }
  const rows = [...merged.values()].map(item => {
    const latest = item.events.at(-1); if (!latest) throw new Error('Processo sem despacho.');
    return { ...item, normalizedName: normalizeTrademarkName(item.name ?? ''), situation: `Último despacho: ${latest.description}`, situationGroup: situationGroup(latest.description) };
  });
  await client.query(`INSERT INTO inpi_trademark(process_number,name,normalized_name,owners,nice_classes,vienna_codes,situation,situation_group,fields,latest_edition,published_on,import_id)
    SELECT r."processNumber",r.name,r."normalizedName",coalesce(r.owners,'{}'),coalesce(r."niceClasses",'{}'),coalesce(r."viennaCodes",'{}'),r.situation,r."situationGroup",r.fields,$2,$3,$4
    FROM jsonb_to_recordset($1::jsonb) AS r("processNumber" text,name text,"normalizedName" text,owners text[],"niceClasses" int[],"viennaCodes" text[],situation text,"situationGroup" text,fields jsonb)
    ON CONFLICT(process_number) DO UPDATE SET name=coalesce(excluded.name,inpi_trademark.name),
    normalized_name=CASE WHEN excluded.name IS NULL THEN inpi_trademark.normalized_name ELSE excluded.normalized_name END,
    situation=excluded.situation,situation_group=excluded.situation_group,fields=inpi_trademark.fields || excluded.fields,
    latest_edition=excluded.latest_edition,published_on=excluded.published_on,import_id=excluded.import_id,updated_at=CURRENT_TIMESTAMP
    WHERE excluded.published_on>=inpi_trademark.published_on`,[JSON.stringify(rows),publication.edition,publication.publishedOn,publication.id]);
  // Arrays use a separate typed update so absent XML elements do not erase the baseline.
  await client.query(`UPDATE inpi_trademark t SET owners=coalesce(r.owners,t.owners),nice_classes=coalesce(r."niceClasses",t.nice_classes),vienna_codes=coalesce(r."viennaCodes",t.vienna_codes)
    FROM jsonb_to_recordset($1::jsonb) AS r("processNumber" text,owners text[],"niceClasses" int[],"viennaCodes" text[])
    WHERE t.process_number=r."processNumber" AND t.published_on<=$2`,[JSON.stringify(rows),publication.publishedOn]);
  const events = records.flatMap(item => item.events.map(event => ({ ...event,processNumber: item.processNumber })));
  await client.query(`INSERT INTO inpi_trademark_event(process_number,edition,ordinal,code,description,complement)
    SELECT e.value->>'processNumber',$2,(coalesce((SELECT max(ordinal)+1 FROM inpi_trademark_event WHERE edition=$2),0)+e.ordinality-1)::int,e.value->>'code',e.value->>'description',e.value->>'complement'
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY e(value,ordinality)`,[JSON.stringify(events),publication.edition]);
}

export async function beginInpiImport(client: PoolClient, publication: { kind: 'baseline' | 'rpi'; edition: number | null; publishedOn: string; sourceUrl: string }) {
  const id = randomUUID();
  const result = await client.query<{ id: string; state: string }>(`INSERT INTO inpi_import(id,kind,edition,published_on,source_url,state) VALUES($1,$2,$3,$4,$5,'running')
    ON CONFLICT(edition) WHERE edition IS NOT NULL DO UPDATE SET state=CASE WHEN inpi_import.state='completed' THEN 'completed' ELSE 'running' END,error=NULL RETURNING id,state`,
  [id,publication.kind,publication.edition,publication.publishedOn,publication.sourceUrl]);
  return result.rows[0];
}
