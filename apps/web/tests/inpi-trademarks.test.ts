import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import PizZip from 'pizzip';
import { authStore } from '../src/lib/database';
import { parseInpiXml } from '../src/lib/research/trademarks/inpi-xml';
import { inpiDetailUrl, situationGroup, viennaCode, type InpiRecord } from '../src/lib/research/trademarks/inpi-contracts';

import { importRpiPublication, discoverRpiPublications } from '../src/lib/research/trademarks/inpi-sync';
import { getTrademarkDetail, nextTrademarkPage, getTrademarkSearch } from '../src/lib/research/trademarks/service';
import { storedTrademarkSearchInput, type StoredTrademarkSearchInput } from '../src/lib/research/trademarks/contracts';
import { runInpiSearchPage } from '../src/lib/research/trademarks/inpi-search';
import { analyzeTrademarkLogo } from '../src/lib/research/trademarks/logo-analysis';
import type { WorkspaceContext } from '../src/lib/application/context';
import { sourcesFromTool } from '../src/lib/citations/sources';
import { createConversation } from '../src/lib/ai-store';
import { createChatAttachment, resolveChatAttachments, claimChatAttachments } from '../src/lib/chat-attachments';

const publication={edition:2908,publishedOn:'2026-09-29',sourceUrl:'https://revistas.inpi.gov.br/txt/RM2908.zip'};
const processXml=(number:string,name='LUME') => `<processo numero="${number}" data-deposito="19/07/2012"><despachos><despacho codigo="IPAS024" nome="Indeferimento do pedido"><texto-complementar>Colide com LUME &amp; DECOR.</texto-complementar></despacho></despachos><titulares><titular nome-razao-social="Titular" pais="BR"/></titulares><marca apresentacao="Mista"><nome>${name}</nome></marca><lista-classe-nice><classe-nice codigo="35"><especificacao>Publicidade</especificacao><status>Deferida</status></classe-nice></lista-classe-nice><classes-vienna><classe-vienna codigo="27.05.01"/></classes-vienna></processo>`;
const xml=(body:string,edition=2908) => `<?xml version="1.0" encoding="utf-8"?><revista numero="${edition}" data="29/09/2026">${body}</revista>`;
const zip=(value:string) => new PizZip().file('RM2908.xml',value).generate({type:'nodebuffer'});
async function actor():Promise<WorkspaceContext> {
  const officeId=randomUUID(),userId=randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Escritório');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@test.invalid`,'Pessoa');
  await testDb.prepare("INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)").run(randomUUID(),officeId,userId);
  return {officeId,userId};
}

async function legacySearch(context: WorkspaceContext, input: StoredTrademarkSearchInput) {
  const id = randomUUID();
  await testDb.prepare(`INSERT INTO research_trademark_search(id,office_id,user_id,input_json,title,idempotency_key,provider)
    VALUES(?,?,?,?,?,?,'inpi')`).run(id, context.officeId, context.userId, JSON.stringify(input), 'Pesquisa INPI anterior', randomUUID());
  await runInpiSearchPage(id, input, 0);
  return getTrademarkSearch(context, { searchId: id });
}

test('XML lê campos, entidades e Viena e não confunde status da classe Nice com situação da marca',async()=>{
  const records:InpiRecord[]=[];
  const bytes=Buffer.from(xml(processXml('905046595')));
  const chunks=Array.from({length:Math.ceil(bytes.length/13)},(_,i)=>bytes.subarray(i*13,i*13+13));
  assert.equal(await parseInpiXml(Readable.from(chunks),publication,async batch=>{records.push(...batch);}),1);
  assert.deepEqual(records[0].viennaCodes,['27.5.1']);
  assert.equal(viennaCode.parse('28.19'),'28.19');
  assert.equal(records[0].events[0].complement,'Colide com LUME & DECOR.');
  assert.equal(situationGroup(records[0].events[0].description),'ended');
  assert.equal(situationGroup('Deferimento da petição'),'unknown');
  assert.equal(inpiDetailUrl('905046595'),'https://servicos.busca.inpi.gov.br/marcas/905046595');
});

test('XML truncado, DOCTYPE, processo inválido e edição trocada são recusados',async()=>{
  for(const invalid of [xml(processXml('905046595')).slice(0,-5),xml(processXml('x')),xml(processXml('905046595'),2907),'<!DOCTYPE revista [<!ENTITY test SYSTEM "file:///etc/passwd">]>'+xml(processXml('905046595'))]) {
    await assert.rejects(parseInpiXml(Readable.from([invalid]),publication,async()=>{}));
  }
});

test('XML entregue em um único chunk produz lotes limitados e recusa um atributo gigante', async () => {
  let total = 0, largest = 0;
  const large = xml(Array.from({ length: 2000 }, (_, index) => processXml(String(800000000 + index))).join(''));
  await parseInpiXml(Readable.from([large]), publication, async batch => { total += batch.length; largest = Math.max(largest, batch.length); });
  assert.equal(total, 2000);
  assert.ok(largest < 600);
  await assert.rejects(parseInpiXml(Readable.from([xml(`<processo numero="905046595" atributo="${'a'.repeat(3 * 1024 * 1024)}"/>`)]), publication, async () => {}), { code: 'capacity' });
});

test('descoberta usa os XMLs de marcas e ordena as edições',()=>{
  const html='<tr><td>2026-09-29</td><a href="https://revistas.inpi.gov.br/txt/RM2908.zip">XML</a></tr><tr><td>2026-09-22</td><a href="https://revistas.inpi.gov.br/txt/RM2907.zip">XML</a></tr>';
  assert.deepEqual(discoverRpiPublications(html).map(item=>item.edition),[2907,2908]);
  assert.equal(discoverRpiPublications(html.replace('2026-09-29','29/09/2026'))[1].publishedOn,'2026-09-29');
  assert.throws(()=>discoverRpiPublications('<a href="https://example.com/RM2908.zip">XML</a>'));
});

test('análise de anexo exige a pessoa, o escritório, a conversa atual e uma imagem publicada na mensagem',async()=>{
  const owner=await actor(),other=await actor();
  const one=await createConversation(testDb,owner),two=await createConversation(testDb,owner);
  const attachment=await createChatAttachment(owner,one.id,new File(['LUME'],'marca.txt',{type:'text/plain'}));
  const input={kind:'attachment' as const,attachmentId:attachment.id};
  await assert.rejects(analyzeTrademarkLogo({...owner,conversationId:one.id},input),{code:'NOT_FOUND'});
  const rows=await resolveChatAttachments(owner,one.id,'message-logo',[attachment.id]);
  await claimChatAttachments(owner,one.id,'message-logo',rows);
  await assert.rejects(analyzeTrademarkLogo({...other,conversationId:one.id},input),{code:'NOT_FOUND'});
  await assert.rejects(analyzeTrademarkLogo({...owner,conversationId:two.id},input),{code:'NOT_FOUND'});
  await assert.rejects(analyzeTrademarkLogo(owner,input),{code:'NOT_FOUND'});
  await assert.rejects(analyzeTrademarkLogo({...owner,conversationId:one.id},input),{code:'INVALID'});
});

test('importação atômica, repetível e esparsa mantém acervo; pesquisa INPI fornece detalhes e fontes sem navegador',async()=>{
  const client=await (await authStore()).connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
    await client.query('UPDATE inpi_sync SET capacity=$1', [JSON.stringify({ diskBytes: 32*1024**3, otherBytes: 1024**3, appReserveBytes: 2*1024**3,
      databaseBytes: 12*1024**3, candidateBytes: 4*1024**3, walBytes: 8*1024**3, approvedUntil: new Date(Date.now()+3600_000).toISOString() })]);
    await client.query('DELETE FROM inpi_trademark_event');
    await client.query('DELETE FROM inpi_trademark');
    await client.query('DELETE FROM inpi_import');
    // Windows retains dropped relation files until a checkpoint; capacity scans include them.
    await client.query('CHECKPOINT');
    const base=randomUUID();
    await client.query("INSERT INTO inpi_import(id,kind,published_on,source_url,state) VALUES($1,'baseline','2026-09-26','https://dadosabertos.inpi.gov.br/','completed')",[base]);
    await client.query("INSERT INTO inpi_trademark(process_number,name,normalized_name,owners,nice_classes,vienna_codes,fields,published_on,import_id) VALUES('905046595','LUME','LUME',ARRAY['Titular anterior'],ARRAY[35],ARRAY['27.5.1'],'{\"Apostila\":\"Campo preservado\"}','2026-09-26',$1)",[base]);
    const bad=xml(processXml('905046595')+processXml('900000001')).slice(0,-5);
    await assert.rejects(importRpiPublication(client,publication,{bytes:zip(bad),archive:async()=>randomUUID()}));
    assert.equal((await client.query("SELECT fields->>'Apostila' AS value FROM inpi_trademark WHERE process_number='905046595'")).rows[0].value,'Campo preservado');
    const sparse='<processo numero="905046595"><despachos><despacho codigo="IPAS304" nome="Extinção de registro pela caducidade"/></despachos></processo>';
    const body=processXml('900000001')+sparse+processXml('900000001','LUME NOVA');
    assert.equal(await importRpiPublication(client,publication,{bytes:zip(xml(body)),archive:async()=>randomUUID()}),true);
    assert.equal(await importRpiPublication(client,publication,{bytes:zip(xml(body)),archive:async()=>{throw new Error('must not archive twice');}}),false);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM inpi_trademark_event')).rows[0].n,3);
    const owner=await actor(),other=await actor();
    const {search}=await legacySearch(owner,storedTrademarkSearchInput.parse({query:{kind:'name',name:'Lume'},situation:'ended',niceClass:35}));
    assert.equal(search.state,'completed');assert.equal(search.results.length,2);assert.equal(search.corpus?.latestEdition,2908);
    const old=search.results.find(result=>result.nativeId==='905046595');assert.ok(old);assert.equal(old.detailState,'ready');
    const {trademark}=await getTrademarkDetail(owner,{resultId:old.id});assert.ok(trademark.fields.some(field=>field.value==='Campo preservado'));
    assert.equal(sourcesFromTool('k5_research_start_trademark_search',{search})[0].url,search.results[0].source.url);
    await assert.rejects(getTrademarkDetail(other,{resultId:old.id}),{code:'NOT_FOUND'});
    const figurative=await legacySearch(owner,storedTrademarkSearchInput.parse({query:{kind:'vienna',codes:['27.05.01'],match:'all'}}));assert.equal(figurative.search.results.length,2);
    await assert.rejects(analyzeTrademarkLogo(other,{kind:'upload',uploadId:randomUUID()}),{code:'NOT_FOUND'});
    const before=await getTrademarkSearch(owner,{searchId:search.id});await nextTrademarkPage(owner,{searchId:search.id});assert.deepEqual((await getTrademarkSearch(owner,{searchId:search.id})).search,before.search);
    const extra = Array.from({ length: 40 }, (_, index) => processXml(String(810000000 + index), 'LUME PAGE')).join('');
    await importRpiPublication(client,{ ...publication,edition:2909,sourceUrl:'https://revistas.inpi.gov.br/txt/RM2909.zip' },
      { bytes:new PizZip().file('RM2909.xml',xml(extra,2909)).generate({type:'nodebuffer'}),archive:async()=>randomUUID() });
    const paged = await legacySearch(owner,storedTrademarkSearchInput.parse({query:{kind:'name',name:'Lume'}}));
    assert.equal(paged.search.results.length,30); assert.equal(paged.search.hasMore,true);
    await importRpiPublication(client,{ ...publication,edition:2910,sourceUrl:'https://revistas.inpi.gov.br/txt/RM2910.zip' },
      { bytes:new PizZip().file('RM2910.xml',xml(processXml('810000000','OUTRO NOME'),2910)).generate({type:'nodebuffer'}),archive:async()=>randomUUID() });
    const changed = await nextTrademarkPage(owner,{searchId:paged.search.id});
    assert.equal(changed.search.state,'partial'); assert.equal(changed.search.pagesLoaded,1);
    assert.match(changed.search.error ?? '',/acervo do INPI foi atualizado/);
    assert.deepEqual(changed.search.results,paged.search.results);
  } finally {client.release(true);}
});
