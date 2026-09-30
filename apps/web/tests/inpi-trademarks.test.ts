import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PizZip from 'pizzip';
import { authStore } from '../src/lib/database';
import { parseInpiXml } from '../src/lib/research/trademarks/inpi-xml';
import { inpiDetailUrl, situationGroup, viennaCode, type InpiRecord } from '../src/lib/research/trademarks/inpi-contracts';
import { importInpiBaseline } from '../src/lib/research/trademarks/inpi-baseline';
import { downloadInpiCsv } from '../src/lib/research/trademarks/inpi-download';
import { importRpiPublication, discoverRpiPublications } from '../src/lib/research/trademarks/inpi-sync';
import { getTrademarkDetail, startTrademarkSearch, nextTrademarkPage, getTrademarkSearch } from '../src/lib/research/trademarks/service';
import { trademarkSearchInput } from '../src/lib/research/trademarks/contracts';
import { analyzeTrademarkLogo } from '../src/lib/research/trademarks/logo-analysis';
import type { WorkspaceContext } from '../src/lib/application/context';
import { sourcesFromTool } from '../src/lib/citations/sources';

const publication={edition:2908,publishedOn:'2026-09-29',sourceUrl:'https://revistas.inpi.gov.br/txt/RM2908.zip'};
const processXml=(number:string,name='LUME') => `<processo numero="${number}" data-deposito="19/07/2012"><despachos><despacho codigo="IPAS024" nome="Indeferimento do pedido"><texto-complementar>Colide com LUME &amp; DECOR.</texto-complementar></despacho></despachos><titulares><titular nome-razao-social="Titular" pais="BR"/></titulares><marca apresentacao="Mista"><nome>${name}</nome></marca><lista-classe-nice><classe-nice codigo="35"><especificacao>Publicidade</especificacao><status>Deferida</status></classe-nice></lista-classe-nice><classes-vienna><classe-vienna codigo="27.05.01"/></classes-vienna></processo>`;
const xml=(body:string,edition=2908) => `<?xml version="1.0" encoding="utf-8"?><revista numero="${edition}" data="29/09/2026">${body}</revista>`;
const zip=(value:string) => new PizZip().file('RM2908.xml',value).generate({type:'nodebuffer'});
async function actor():Promise<WorkspaceContext> {
  const officeId=randomUUID(),userId=randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Escritório');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@test.invalid`,'Pessoa');
  await testDb.prepare("INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,'lawyer')").run(randomUUID(),officeId,userId);
  return {officeId,userId,role:'lawyer'};
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

test('carga CSV usa COPY, audita linhas inválidas e enriquece despachos mais recentes sem substituí-los',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'k5-inpi-baseline-'));
  const files:Record<string,string>={
    MARCAS_DADOS_BIBLIOGRAFICOS:'codigo_interno,numero_inpi,data_deposito,data_publicacao,data_concessao,data_vigencia,descricao_apresentacao,descricao_natureza,elemento_nominativo,traducao,apostila,codigo_situacao,descricao_situacao\n1,905046595,2012-07-19,,,,Mista,Produto,Lúme,,Nota,1,Registro de marca em vigor\n2,99       ,,,,,,,Inválida,,,,\n3,900000002,,,,,Nominativa,Serviço,LUME CAFÉ,,,2,Registro de marca extinto\n',
    MARCAS_CLASSIFICACOES_NICE:'codigo_interno,numero_inpi,edicao_nice,classe_nice,especificacao,especificacao_trad\n1,905046595,12,35,Publicidade,\n3,900000002,12,43,Cafeteria,\n',
    MARCAS_CLASSIFICACOES_VIENA:'codigo_interno,numero_inpi,simbolo,classificacao_viena,revisao_viena\n1,905046595,27.05.01,Letras apresentando grafismo especial,4\n1,905046595,28.19,Inscrições em outros caracteres,4\n',
    MARCAS_DEPOSITANTES:'codigo_interno,numero_inpi,nome,estado,pais,cpf_cnpj\n1,905046595,Titular,SP,BR,SEGREDO DESCARTADO\n3,900000002,Titular Café,SP,BR,SEGREDO DESCARTADO\n',
  };
  for(const [name,value] of Object.entries(files)) await writeFile(join(directory,name+'.csv'),value);
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
    const name=new URL(String(input)).pathname.split('/').at(-1)?.replace('.csv','') ?? '';
    assert.ok(files[name]);
    return new Response(null,{headers:{'content-length':String(Buffer.byteLength(files[name])),'last-modified':'Sat, 26 Sep 2026 10:37:15 GMT',etag:'"fixture"'}});
  });
  const client=await (await authStore()).connect();
  try {
    await client.query('DELETE FROM inpi_trademark_event');await client.query('DELETE FROM inpi_trademark');await client.query('DELETE FROM inpi_import');
    const id=randomUUID();
    await client.query("INSERT INTO inpi_import(id,kind,edition,published_on,source_url,state) VALUES($1,'rpi',2908,'2026-09-29','https://revistas.inpi.gov.br/txt/RM2908.zip','completed')",[id]);
    await client.query("INSERT INTO inpi_trademark(process_number,situation,situation_group,fields,latest_edition,published_on,import_id) VALUES('905046595','Último despacho: Indeferimento do pedido','ended','{\"Apostila\":\"Campo mais recente\"}',2908,'2026-09-29',$1)",[id]);
    await importInpiBaseline(client,{directory});
    const rows=(await client.query('SELECT * FROM inpi_trademark ORDER BY process_number')).rows;
    assert.equal(rows.length,2);assert.equal(rows[1].name,'Lúme');assert.equal(rows[1].normalized_name,'LUME');
    assert.equal(rows[1].situation_group,'ended');assert.equal(rows[1].latest_edition,2908);
    assert.equal(rows[1].fields.Apostila,'Campo mais recente');assert.deepEqual(rows[1].vienna_codes,['27.5.1','28.19']);
    assert.deepEqual(rows[1].owners,['Titular']);assert.deepEqual(rows[1].nice_classes,[35]);
    assert.ok(!JSON.stringify(rows).includes('SEGREDO DESCARTADO'));
    const run=(await client.query("SELECT * FROM inpi_import WHERE kind='baseline'")).rows[0];
    assert.equal(run.state,'completed');assert.equal(run.manifest_json[0].rejected,1);assert.equal(run.manifest_json.length,4);
    await writeFile(join(directory,'MARCAS_DADOS_BIBLIOGRAFICOS.csv'),'incompleto');
    await assert.rejects(importInpiBaseline(client,{directory}),/incompleto/);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n,2);
  } finally {client.release();await rm(directory,{recursive:true,force:true});}
});

test('download por intervalos repete trechos truncados e recusa uma versão alterada',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{
    assert.equal((options.headers as Record<string,string>).Range,'bytes=0-2');calls++;
    return new Response(calls===1?new Uint8Array([1]):new Uint8Array([1,2,3]),{status:206,headers:{'content-range':'bytes 0-2/3',etag:'"version"'}});
  });
  const chunks=[];for await(const bytes of downloadInpiCsv('https://dadosabertos.inpi.gov.br/test',{size:3,etag:'"version"'}))chunks.push(...bytes);
  assert.deepEqual(chunks,[1,2,3]);assert.equal(calls,2);
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1,2,3]),{status:206,headers:{'content-range':'bytes 0-2/3',etag:'"changed"'}}));
  await assert.rejects(async()=>{for await(const bytes of downloadInpiCsv('https://dadosabertos.inpi.gov.br/test',{size:3,etag:'"version"'})){assert.fail(`must not publish ${bytes.length} unchecked bytes`);}},/mudou/);
});

test('XML truncado, DOCTYPE, processo inválido e edição trocada são recusados',async()=>{
  for(const invalid of [xml(processXml('905046595')).slice(0,-5),xml(processXml('x')),xml(processXml('905046595'),2907),'<!DOCTYPE revista [<!ENTITY test SYSTEM "file:///etc/passwd">]>'+xml(processXml('905046595'))]) {
    await assert.rejects(parseInpiXml(Readable.from([invalid]),publication,async()=>{}));
  }
});

test('descoberta usa os XMLs de marcas e ordena as edições',()=>{
  const html='<tr><td>2026-09-29</td><a href="https://revistas.inpi.gov.br/txt/RM2908.zip">XML</a></tr><tr><td>2026-09-22</td><a href="https://revistas.inpi.gov.br/txt/RM2907.zip">XML</a></tr>';
  assert.deepEqual(discoverRpiPublications(html).map(item=>item.edition),[2907,2908]);
  assert.equal(discoverRpiPublications(html.replace('2026-09-29','29/09/2026'))[1].publishedOn,'2026-09-29');
  assert.throws(()=>discoverRpiPublications('<a href="https://example.com/RM2908.zip">XML</a>'));
});

test('importação atômica, repetível e esparsa mantém acervo; pesquisa INPI fornece detalhes e fontes sem navegador',async()=>{
  const client=await (await authStore()).connect();
  try {
    await client.query('DELETE FROM inpi_trademark_event');
    await client.query('DELETE FROM inpi_trademark');
    await client.query('DELETE FROM inpi_import');
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
    const {search}=await startTrademarkSearch(owner,trademarkSearchInput.parse({query:{kind:'name',name:'Lume'},situation:'ended',niceClass:35}));
    assert.equal(search.state,'completed');assert.equal(search.results.length,2);assert.equal(search.corpus?.latestEdition,2908);
    const old=search.results.find(result=>result.nativeId==='905046595');assert.ok(old);assert.equal(old.detailState,'ready');
    const {trademark}=await getTrademarkDetail(owner,{resultId:old.id});assert.ok(trademark.fields.some(field=>field.value==='Campo preservado'));
    assert.equal(sourcesFromTool('k5_research_start_trademark_search',{search})[0].url,search.results[0].source.url);
    await assert.rejects(getTrademarkDetail(other,{resultId:old.id}),{code:'NOT_FOUND'});
    const figurative=await startTrademarkSearch(owner,trademarkSearchInput.parse({query:{kind:'vienna',codes:['27.05.01'],match:'all'}}));assert.equal(figurative.search.results.length,2);
    await assert.rejects(analyzeTrademarkLogo(other,{kind:'upload',uploadId:randomUUID()}),{code:'NOT_FOUND'});
    const before=await getTrademarkSearch(owner,{searchId:search.id});await nextTrademarkPage(owner,{searchId:search.id});assert.deepEqual((await getTrademarkSearch(owner,{searchId:search.id})).search,before.search);
  } finally {client.release();}
});
