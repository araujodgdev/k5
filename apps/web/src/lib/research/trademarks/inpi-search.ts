import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { trademarkCorpus, trademarkLogoAnalysis, trademarkSummary, type TrademarkSearchInput } from './contracts';
import { inpiDetailUrl, normalizeTrademarkName } from './inpi-contracts';

export async function inpiCorpusStatus() {
  const row = await database.prepare(`SELECT
    (SELECT max(published_on)::text FROM inpi_import WHERE kind='baseline' AND state='completed') AS baseline,
    (SELECT max(edition) FROM inpi_import WHERE state='completed') AS edition,
    (SELECT max(published_on)::text FROM inpi_import WHERE state='completed') AS published,
    checked_at,error FROM inpi_sync WHERE id=1`).get<{ baseline: string|null; edition: number|null; published: string|null; checked_at: string|null; error: string|null }>();
  return trademarkCorpus.parse({baselineDate:row?.baseline ?? null,latestEdition:row?.edition ?? null,publishedOn:row?.published ?? null,checkedAt:row?.checked_at ?? null,
    note:row?.error ?? (row?.baseline ? 'Acervo dos dados abertos do INPI, atualizado pelas publicações da RPI.' : 'Carga inicial em andamento. A busca cobre apenas os processos já importados da RPI.')});
}
const recordSchema = z.object({
  process_number:z.string(),name:z.string().nullable(),owners:z.array(z.string()),nice_classes:z.array(z.number()),vienna_codes:z.array(z.string()),
  situation:z.string().nullable(),fields:z.record(z.string(),z.string()),latest_edition:z.number().nullable(),published_on:z.string(),updated_at:z.string(),
  event_fields:z.array(z.object({label:z.string(),value:z.string()})),
});

export async function runInpiSearchPage(searchId: string, input: TrademarkSearchInput, pageNumber: number, analysis: z.infer<typeof trademarkLogoAnalysis> | null = null, lease?: {id:string;owner:string}) {
  const corpus = await inpiCorpusStatus();
  if (!corpus.publishedOn) throw new CapabilityError('NOT_READY','A base de marcas do INPI ainda não está disponível. Tente novamente após a carga inicial.');
  const conditions: string[] = [], params: unknown[] = [];
  let order = 't.process_number', query = input.query;
  if (query.kind==='logo') {
    if (!analysis?.codes.length) throw new CapabilityError('INVALID','Não foi possível identificar elementos de Viena. Informe os códigos na pesquisa figurativa.');
    query = {kind:'vienna',codes:analysis.codes.map(value => value.code),match:'any'};
  }
  if (query.kind==='name') {
    const name = normalizeTrademarkName(query.name);
    if (!name) throw new CapabilityError('INVALID','Informe um nome com letras ou números.');
    if (query.strategy==='exact') { conditions.push('t.normalized_name=?'); params.push(name); }
    else if (query.strategy==='fuzzy') {
      conditions.push('t.normalized_name % ?'); params.push(name);
      order = 'similarity(t.normalized_name,?) DESC,t.process_number';
    } else if (query.strategy==='phonetic') throw new CapabilityError('INVALID','A base do INPI oferece nome exato, contém e nomes semelhantes. A semelhança fonética está disponível na pesquisa internacional.');
    else { conditions.push('t.normalized_name LIKE ?'); params.push(`%${name}%`); }
  } else {
    conditions.push(query.match==='all' ? 't.vienna_codes @> ?::text[]' : 't.vienna_codes && ?::text[]'); params.push(query.codes);
  }
  if (input.situation!=='all') { conditions.push('t.situation_group=?'); params.push(input.situation); }
  if (input.niceClass!==null) { conditions.push('t.nice_classes @> ?::int[]'); params.push([input.niceClass]); }
  const where=conditions.join(' AND '), orderParams=input.query.kind==='name' && input.query.strategy==='fuzzy' ? [normalizeTrademarkName(input.query.name)] : [];
  const total = await database.prepare(`SELECT count(*)::int AS total FROM inpi_trademark t WHERE ${where}`).get<{total:number}>(...params);
  const raw = await database.prepare(`SELECT t.*,coalesce((SELECT jsonb_agg(jsonb_build_object('label','RPI ' || e.edition || ' · ' || e.code,'value',e.description || coalesce(E'\n' || e.complement,'')) ORDER BY e.edition,e.ordinal)
    FROM inpi_trademark_event e WHERE e.process_number=t.process_number),'[]'::jsonb) AS event_fields
    FROM inpi_trademark t WHERE ${where} ORDER BY ${order} LIMIT 30 OFFSET ?`).all(...params,...orderParams,pageNumber*30);
  const records=raw.map(value => recordSchema.parse(value));
  await withTransaction(async tx => {
    if (lease && !await tx.prepare(`SELECT 1 FROM research_trademark_task WHERE id=? AND state='running' AND lease_owner=? AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`).get(lease.id,lease.owner)) throw new CapabilityError('FORBIDDEN','A execução foi interrompida.');
    const live=await tx.prepare(`SELECT 1 FROM research_trademark_search s JOIN office_member m ON m.office_id=s.office_id AND m.user_id=s.user_id
      WHERE s.id=? AND s.state<>'cancelled' AND (s.session_id IS NULL OR EXISTS(SELECT 1 FROM session WHERE id=s.session_id AND userId=s.user_id AND expiresAt>CURRENT_TIMESTAMP)) FOR UPDATE OF s`).get(searchId);
    if (!live) throw new CapabilityError('FORBIDDEN','A pesquisa foi cancelada ou seu acesso foi encerrado.');
    for (const [index,row] of records.entries()) {
      const id=randomUUID(),fields=[...Object.entries(row.fields).map(([label,value]) => ({label,value})),{label:'Classificação de Viena',value:row.vienna_codes.join(', ')},...row.event_fields].filter(value => value.value);
      const summary=trademarkSummary.parse({id,nativeId:row.process_number,name:row.name ?? 'Marca figurativa sem nome publicado',representationUrl:null,
        owner:row.owners.join('; ') || null,office:'INPI',territory:'Brasil',recordType:row.fields['Apresentação'] ?? null,situation:row.situation,niceClasses:row.nice_classes,viennaCodes:row.vienna_codes,
        applicationNumber:row.process_number,source:{provider:'inpi',url:inpiDetailUrl(row.process_number),originUrl:null,capturedAt:row.updated_at,
          publicationUrl:row.latest_edition ? `https://revistas.inpi.gov.br/txt/RM${row.latest_edition}.zip` : 'https://dadosabertos.inpi.gov.br/index/marcas/',edition:row.latest_edition,publishedOn:row.published_on},detailState:'ready'});
      await tx.prepare(`INSERT INTO research_trademark_result(id,search_id,native_id,position,summary_json,fields_json,version,detail_state) VALUES(?,?,?,?,?,?,?,'ready') ON CONFLICT(search_id,native_id) DO NOTHING`)
        .run(id,searchId,row.process_number,pageNumber*30+index,JSON.stringify(summary),JSON.stringify(fields),createHash('sha256').update(JSON.stringify({summary,fields})).digest('hex'));
    }
    await tx.prepare(`UPDATE research_trademark_search SET state='completed',step='Consulta ao INPI concluída',error=NULL,pages_loaded=?,total_reported=?,has_more=?,source_url='https://dadosabertos.inpi.gov.br/index/marcas/',corpus_json=?,analysis_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(pageNumber+1,total?.total ?? 0,(total?.total ?? 0)>(pageNumber+1)*30,JSON.stringify(corpus),analysis ? JSON.stringify(analysis) : null,searchId);
  });
}
