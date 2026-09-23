import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { WorkspaceContext } from '../src/lib/application/context';
import { upsertInstallation } from '../src/lib/judicial/repositories/installations';
import { normalizeTjdftResponse, type SourceJudgment } from '../src/lib/research/sources/tjdft';
import { upsertSourceJudgment } from '../src/lib/research/catalog';
import { searchResearchCorpus, startResearchSearch, getResearchSearch, getResearchJudgment,
  requestResearchMaterial, requestResearchPage, getResearchOriginal as getResearchOriginalForUser } from '../src/lib/application/research-service';
import { fixtureTransport, fixtureKey } from '../src/lib/judicial/connectors/transport';
import { processNextResearchExternalJob } from '../src/lib/research/worker';
import { claimResearchJob, completeResearchJob, debitResearchRequest, renewResearchLease } from '../src/lib/research/jobs';
import { enqueueResearchJob } from '../src/lib/research/jobs';
import { stageResearchPdf, processNextResearchExtraction } from '../src/lib/research/pdf';
import { getResearchOriginal, putResearchOriginal, researchStorageKey, sweepResearchOrphans } from '../src/lib/research/storage';
import { createHash } from 'node:crypto';
import { ConnectorError } from '../src/lib/judicial/contracts';
import type { Transport } from '../src/lib/judicial/connectors/transport';
import { publishMaterialText } from '../src/lib/research/catalog';
import { searchCorpus } from '../src/lib/research/retrieval';
import { ResearchError } from '../src/lib/research/contracts';
import { testStorageRoot } from './test-setup';
import { utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resetObjectStorageForTests } from '../src/lib/storage';

test('originais públicos usam o binding R2 compartilhado e verificam integridade',async()=>{
  const objects=new Map<string,Buffer>();
  resetObjectStorageForTests(undefined,{
    async put(key,bytes){objects.set(key,Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength));},
    async get(key){const bytes=objects.get(key);return bytes?{async arrayBuffer(){return Uint8Array.from(bytes).buffer;}}:null;},
    async delete(key){objects.delete(key);},
  });
  try {
    const bytes=Buffer.from('Original público de teste');
    const key=await putResearchOriginal(bytes,'txt');
    assert.deepEqual(await getResearchOriginal(key),bytes);
    objects.set(key,Buffer.from('corrompido'));
    await assert.rejects(getResearchOriginal(key),/corrompido/);
    await assert.rejects(getResearchOriginal('../secrets'),/inválida/);
  }finally{resetObjectStorageForTests();}
});
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionTransport } from '../src/lib/typesafe/client';

async function actor(): Promise<WorkspaceContext> {
  const officeId=randomUUID(),userId=randomUUID();
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@test.invalid`,'Pesquisador'));
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Escritório de teste'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(),officeId,userId,'lawyer'));
  return {officeId,userId,role:'lawyer'};
}
async function source() {
  return upsertInstallation({kind:'jurisprudence_api',courtCode:'TJDFT',courtName:'Tribunal de Justiça do Distrito Federal',
    degree:'second',system:'proprietary',purpose:'jurisprudence',baseUrl:'https://jurisdf.tjdft.jus.br/',
    authKind:'none',discoveryStatus:'pilot',permissions:{query:'permitido',cache:'permitido',
      documents:'permitido',redistribution:'permitido',ai:'nao_esclarecido'},
    allowedHosts:['jurisdf.tjdft.jus.br'],enabled:true,liveTransportEnabled:true,
    rateLimitPerMinute:600,dailyRequestBudget:1000});
}
function record(id:string,ementa='Guarda judicial concedida à avó materna'):SourceJudgment {
  return {sourceJudgmentId:id,tribunal:'TJDFT',courtUnit:'Turma Cível',caseNumber:`070${id}-00.2023.8.07.0001`,
    className:'Apelação',rapporteur:'Relatoria',title:`Julgado ${id}`,decisionDate:'2023-06-21',sourceUpdatedAt:null,
    sourceUrl:null,ementa,fullText:null,fullTextStatus:'unavailable'};
}

test('TJDFT normaliza hits.value, quarentena sem identidade e placeholder apesar da flag',()=>{
  const page=normalizeTjdftResponse({hits:{value:2},registros:[{identificador:'2171572',ementa:'Guarda à avó',
    possuiInteiroTeor:true,inteiroTeorHtml:'Inteiro Teor indisponível.'},{ementa:'sem identidade'}]},0,20);
  assert.equal(page.records[0].fullText,null);
  assert.equal(page.records[0].fullTextStatus,'unavailable');
  assert.equal(page.rejected,1);
  assert.equal(page.rejections[0].reason,'missing_identifier');
  assert.equal(page.rejections[0].payloadJson.includes('sem identidade'),true);
});

test('duas pessoas compartilham identidade pública e não histórico privado',async()=>{
  const installation=await source(),a=(await actor()),b=(await actor());
  const id=await upsertSourceJudgment(installation,record(`shared-${randomUUID()}`));
  const again=await upsertSourceJudgment(installation,record((await getResearchSearchAfterSourceId(id))));
  assert.equal(id,again);
  const corpusA=await searchResearchCorpus(a,{theme:'guarda avó'});
  const corpusB=await searchResearchCorpus(b,{theme:'guarda avó'});
  assert.ok(corpusA.results.some((item)=>item.id===id));
  assert.ok(corpusB.results.some((item)=>item.id===id));
  const searchA=await startResearchSearch(a,{theme:'guarda avó',includeSources:false,idempotencyKey:randomUUID()});
  const searchB=await startResearchSearch(b,{theme:'guarda avó',includeSources:false,idempotencyKey:randomUUID()});
  assert.notEqual(searchA.id,searchB.id);
  await assert.rejects(getResearchSearch(b,searchA.id),/não encontrada/);
});

test('revisões opacas do TJDFT sobrevivem à publicação e atualização no PostgreSQL', async () => {
  const installation = await source();
  const identifier = randomUUID();
  const normalized = normalizeTjdftResponse({ hits:1, registros:[{
    identificador:identifier, versao:'0001', ementa:'Ementa pública de teste',
    possuiInteiroTeor:true, inteiroTeor:'Inteiro teor público de teste',
  }] },0).records[0];
  const id = await upsertSourceJudgment(installation, normalized);
  assert.equal((await testDb.prepare('SELECT source_updated_at FROM research_judgment WHERE id=?').get(id))!.source_updated_at, '0001');
  const revisions = await testDb.prepare(`SELECT v.source_updated_at FROM research_material_version v
    JOIN research_material m ON m.id=v.material_id WHERE m.judgment_id=?`).all<{source_updated_at:string}>(id);
  assert.equal(revisions.length, 2);
  assert.ok(revisions.every(row => row.source_updated_at === '0001'));
  await upsertSourceJudgment(installation, {...normalized, sourceUpdatedAt:'revision-2'});
  assert.equal((await testDb.prepare('SELECT metadata_revision FROM research_judgment WHERE id=?').get(id))!.metadata_revision, 2);
});
async function getResearchSearchAfterSourceId(id:string):Promise<string> {
  return String((await testDb.prepare('SELECT source_judgment_id FROM research_judgment WHERE id=?').get(id))!.source_judgment_id);
}

test('FTS pesquisa além dos 400 mais recentes e pagina sem repetir IDs',async()=>{
  const installation=await source();
  const prefix=randomUUID().slice(0,8);
  const entries=[] as Array<[string,string,string,string,string,string,string,string]>;
  for (let n=0;n<421;n++) {
    const judgmentId=randomUUID(),materialId=randomUUID(),versionId=randomUUID();
    const text=n===0?'hipoteca raríssima avó':'assunto diverso guarda avó';
    entries.push([judgmentId,materialId,versionId,`${prefix}-${n}`,text,n===0?'2000-01-01':'2026-01-01',installation.id,prefix]);
  }
  const insertJudgment=testDb.prepare(`INSERT INTO research_judgment
    (id,installation_id,source_judgment_id,tribunal,title,decision_date,metadata_hash,collected_at)
    VALUES(?, ?, ?, 'TJDFT', ?, ?, ?, CURRENT_TIMESTAMP)`);
  const insertMaterial=testDb.prepare(`INSERT INTO research_material(id,judgment_id,kind,status,current_version_id)
    VALUES(?,?,'ementa','ready',?)`);
  const insertVersion=testDb.prepare(`INSERT INTO research_material_version
    (id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    VALUES(?,?,?,'text/plain',?,?,'test','{}',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  const insertFts=testDb.prepare('INSERT INTO research_fts(judgment_id,material_version_id,text_content) VALUES(?,?,?)');
  for (const [judgmentId,materialId,versionId,native,text,date,sourceId] of entries) {
    (await insertJudgment.run(judgmentId,sourceId,native,native,date,native));
    (await insertMaterial.run(materialId,judgmentId,versionId));
    (await insertVersion.run(versionId,materialId,versionId,text.length,text));
    (await insertFts.run(judgmentId,versionId,text));
  }
  const person=(await actor());
  const old=await searchResearchCorpus(person,{theme:'hipoteca raríssima'});
  assert.equal(old.results[0]?.id,entries[0][0]);
  const first=await searchResearchCorpus(person,{theme:'assunto diverso'});
  assert.equal(first.results.length,20);
  const second=await searchResearchCorpus(person,{theme:'assunto diverso',cursor:first.nextCursor!});
  assert.equal(second.results.length,20);
  assert.equal(new Set([...first.results,...second.results].map((item)=>item.id)).size,40);
});

test('página externa persiste antes de exibir e replay de cursor não dispara nova página',async()=>{
  const installation=await source(),person=(await actor()),unique=`lookup-${randomUUID()}`;
  const fixture=new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:unique,ementa:'Guarda avó com estudo psicossocial',
      possuiInteiroTeor:true,inteiroTeorHtml:'Inteiro Teor indisponível.'}]})}]]);
  const started=await startResearchSearch(person,{theme:`temaexclusivo${randomUUID().replaceAll('-','')}`,
    includeSources:true,idempotencyKey:randomUUID()});
  assert.equal(started.pages[0].status,'queued');
  const outcome=await processNextResearchExternalJob({transport:fixtureTransport(fixture)});
  assert.equal(outcome?.status,'completed');
  const done=await getResearchSearch(person,started.id);
  assert.equal(done.pages[0].results.some((item)=>item.sourceJudgmentId===unique),true);
  assert.equal(done.pages[0].results.find((item)=>item.sourceJudgmentId===unique)?.fullTextStatus,'unavailable');
  const cursor=done.pages[0].nextCursor;
  if (cursor) {
    const next=await requestResearchPage(person,started.id,cursor);
    const replay=await requestResearchPage(person,started.id,cursor);
    assert.equal(next.id,replay.id);
  }
});

test('repetir coleta mantém versão e IDs de trechos; alteração cria versão sem apagar a antiga',async()=>{
  const installation=await source();
  const value=record(`version-${randomUUID()}`,'Guarda e proteção especial da avó');
  const judgmentId=await upsertSourceJudgment(installation,value);
  const first=(await testDb.prepare(`SELECT v.id,m.id AS material_id FROM research_material m
    JOIN research_material_version v ON v.id=m.current_version_id WHERE m.judgment_id=? AND m.kind='ementa'`)
    .get(judgmentId))!;
  const firstChunk=(await testDb.prepare('SELECT id FROM research_chunk WHERE material_version_id=?').get(first.id))!.id;
  await upsertSourceJudgment(installation,value);
  assert.equal((await testDb.prepare('SELECT id FROM research_chunk WHERE material_version_id=?').get(first.id))!.id,firstChunk);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_material_version WHERE material_id=?').get(first.material_id))!.n,1);
  await upsertSourceJudgment(installation,{...value,ementa:'Guarda e proteção especial revista'});
  const later=(await testDb.prepare('SELECT current_version_id FROM research_material WHERE id=?').get(first.material_id))!;
  assert.notEqual(later.current_version_id,first.id);
  assert.equal((await testDb.prepare('SELECT id FROM research_chunk WHERE id=?').get(firstChunk))!.id,firstChunk);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_material_version WHERE material_id=?').get(first.material_id))!.n,2);
});

test('obtenção automática alcança só o material da página visitada e publica texto válido',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor()),id=`fetch-${randomUUID()}`;
  const judgmentId=await upsertSourceJudgment(installation,{...record(id,'quesitoúnico avó'),fullTextStatus:'pending'});
  const started=await startResearchSearch(person,{theme:'quesitoúnico',includeSources:false,idempotencyKey:randomUUID()});
  assert.equal(started.pages[0].results.some((item)=>item.id===judgmentId),true);
  const material=(await testDb.prepare("SELECT id FROM research_material WHERE judgment_id=? AND kind='full_text'").get(judgmentId))!;
  assert.equal((await testDb.prepare("SELECT count(*) AS n FROM research_job WHERE material_id=? AND status='queued'").get(material.id))!.n,1);
  const fixture=new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:id,ementa:'quesitoúnico avó',
      possuiInteiroTeor:true,inteiroTeorHtml:'Inteiro teor completo com análise da guarda.'}]})}]]);
  const outcome=await processNextResearchExternalJob({transport:fixtureTransport(fixture)});
  assert.equal(outcome?.status,'completed');
  const version=(await testDb.prepare(`SELECT v.text_content FROM research_material m
    JOIN research_material_version v ON v.id=m.current_version_id WHERE m.id=?`).get(material.id))!;
  assert.match(String(version.text_content),/Inteiro teor completo/);
  assert.equal((await getResearchSearch(person,started.id)).pages[0].progress.ready>=1,true);
});

test('reserva de quota é atômica e lease expirado após cinco tentativas termina',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  (await testDb.exec('DELETE FROM research_source_budget'));
  const installation=await source(),person=(await actor());
  (await testDb.prepare('UPDATE judicial_source_installation SET rate_limit_per_minute=1 WHERE id=?').run(installation.id));
  const limited={...installation,rateLimitPerMinute:1};
  await debitResearchRequest(limited,person.officeId);
  await assert.rejects(debitResearchRequest(limited,person.officeId),/Limite/);
  const search=await startResearchSearch(person,{theme:`isolado${randomUUID().replaceAll('-','')}`,
    includeSources:true,idempotencyKey:randomUUID()});
  const job=(await testDb.prepare("SELECT id FROM research_job WHERE search_id=? AND kind='search_page'").get(search.id))!;
  (await testDb.prepare("UPDATE research_job SET status='running',attempts=5,lease_owner='dead',lease_until=1 WHERE id=?").run(job.id));
  await claimResearchJob('new-worker',['search_page']);
  assert.equal((await testDb.prepare('SELECT status FROM research_job WHERE id=?').get(job.id))!.status,'failed');
  assert.equal((await getResearchSearch(person,search.id)).pages[0].status,'partial');
});

test('lease roubado durante transporte impede publicação e não sobrescreve outro worker',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor()),theme=`lease${randomUUID().replaceAll('-','')}`;
  const search=await startResearchSearch(person,{theme,includeSources:true,idempotencyKey:randomUUID()});
  const job=(await testDb.prepare("SELECT id FROM research_job WHERE search_id=? AND kind='search_page'").get(search.id))!;
  const native=`stolen-${randomUUID()}`;
  const fixture=new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:native,ementa:'julgado válido'}]})}]]);
  const transport=fixtureTransport(fixture,async ()=>{
    (await testDb.prepare("UPDATE research_job SET lease_owner='other',lease_until=? WHERE id=?").run(Date.now()+90_000,job.id));
  });
  const outcome=await processNextResearchExternalJob({transport,workerId:'first'});
  assert.equal(outcome?.status,'stale');
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_judgment WHERE source_judgment_id=?').get(native))!.n,0);
  assert.equal((await testDb.prepare('SELECT lease_owner FROM research_job WHERE id=?').get(job.id))!.lease_owner,'other');
});

function onePagePdf():Buffer {
  const stream='BT /F1 24 Tf 72 720 Td (Guarda a avo materna) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content='%PDF-1.4\n';
  const offsets=[0];
  for (const [index,object] of objects.entries()) { offsets.push(Buffer.byteLength(content)); content+=`${index+1} 0 obj\n${object}\nendobj\n`; }
  const xref=Buffer.byteLength(content);
  content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  content+=`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content,'ascii');
}

test('PDF binário preserva bytes/hash e o worker publica texto extraído por página',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const person=(await actor());
  const installation=await upsertInstallation({kind:'ckan',courtCode:'STJ',courtName:'Superior Tribunal de Justiça',
    degree:'superior',system:'not_applicable',purpose:'jurisprudence',baseUrl:'https://dadosabertos.web.stj.jus.br/',
    authKind:'none',discoveryStatus:'pilot',permissions:{query:'permitido',cache:'permitido',documents:'permitido',
      redistribution:'permitido',ai:'nao_esclarecido'},allowedHosts:['dadosabertos.web.stj.jus.br'],enabled:true,
    liveTransportEnabled:true,rateLimitPerMinute:600,dailyRequestBudget:1000});
  const judgmentId=await upsertSourceJudgment(installation,{...record(`stj-${randomUUID()}`),tribunal:'STJ',
    ementa:'Guarda à avó',fullTextStatus:'pending'});
  const bytes=onePagePdf();
  const transport=fixtureTransport(new Map([[fixtureKey(installation.id,'GET','/sample.pdf'),
    {contentType:'application/pdf',body:bytes}]]));
  const downloaded=await transport.requestBinary!(installation,'/sample.pdf',{maxBytes:50*1024*1024});
  assert.deepEqual(downloaded.bytes,bytes);
  const versionId=await stageResearchPdf(installation,judgmentId,downloaded.bytes,'https://dadosabertos.web.stj.jus.br/sample.pdf');
  const material=(await testDb.prepare("SELECT id FROM research_material WHERE judgment_id=? AND kind='full_text'").get(judgmentId))!;
  await enqueueResearchJob({officeId:person.officeId,userId:person.userId,installationId:installation.id,
    materialId:String(material.id),kind:'extract_material',request:{versionId},idempotencyKey:`extract:${versionId}`});
  assert.equal(await processNextResearchExtraction(),true);
  const version=(await testDb.prepare('SELECT sha256,storage_key,text_content,published_at FROM research_material_version WHERE id=?').get(versionId))!;
  assert.equal(version.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await getResearchOriginal(String(version.storage_key)),bytes);
  assert.match(String(version.text_content),/Guarda a avo materna/);
  assert.ok(version.published_at);
  assert.equal((await testDb.prepare('SELECT reference FROM research_chunk WHERE material_version_id=?').get(versionId))!.reference,'página:1');
});

test('Worker sem bindings compartilhados recusa original antes do filesystem',async()=>{
  const installation=await source();
  const judgmentId=await upsertSourceJudgment(installation,{
    ...record(`runtime-${randomUUID()}`),fullText:'AMOSTRA DE TESTE: inteiro teor local.',fullTextStatus:'ready',
  });
  const row=(await testDb.prepare("SELECT current_version_id FROM research_material WHERE judgment_id=? AND kind='full_text'")
    .get(judgmentId)) as {current_version_id:string}|undefined;
  assert.ok(row?.current_version_id);
  const person=(await actor());
  assert.match(Buffer.from((await getResearchOriginalForUser(person,row.current_version_id)).bytes).toString('utf8'),/AMOSTRA DE TESTE/);
  const storageKey=(await testDb.prepare('SELECT storage_key FROM research_material_version WHERE id=?')
    .get(row.current_version_id)) as {storage_key:string}|undefined;
  assert.ok(storageKey?.storage_key);
  const previous=process.env.K5_RUNTIME;
  const unsupported=(error: unknown) => error instanceof ResearchError && error.code==='unsupported' &&
    /pesquisa está temporariamente indisponível/.test(error.message);
  try {
    process.env.K5_RUNTIME='cloudflare';
    await assert.rejects(getResearchOriginalForUser(person,row.current_version_id),unsupported);
    await assert.rejects(getResearchOriginal(storageKey.storage_key),unsupported);
    await assert.rejects(putResearchOriginal(Buffer.from('outro original'),'txt'),unsupported);
  } finally {
    if (previous===undefined) delete process.env.K5_RUNTIME;
    else process.env.K5_RUNTIME=previous;
  }
});

test('21 materiais locais pendentes enfileiram só os 20 exibidos; próxima ação obtém o 21º',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor()),token=`tema${randomUUID().replaceAll('-','')}`;
  for (let n=0;n<21;n++) await upsertSourceJudgment(installation,{...record(`${token}-${n}`,`${token} guarda`),
    fullTextStatus:'pending'});
  const started=await startResearchSearch(person,{theme:token,includeSources:false,idempotencyKey:randomUUID()});
  assert.equal(started.pages[0].results.length,20);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_job WHERE search_id=? AND kind='fetch_material'
    AND status='queued'`).get(started.id))!.n,20);
  const next=await requestResearchPage(person,started.id,started.pages[0].nextCursor!);
  assert.equal(next.results.length,1);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_job WHERE search_id=? AND kind='fetch_material'
    AND status='queued'`).get(started.id))!.n,21);
});

test('dois escritórios compartilham um download; parar um interesse não cancela o outro',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),a=(await actor()),b=(await actor()),token=`dedup${randomUUID().replaceAll('-','')}`;
  const judgmentId=await upsertSourceJudgment(installation,{...record(token,`${token} guarda`),fullTextStatus:'pending'});
  const first=await startResearchSearch(a,{theme:token,includeSources:false,idempotencyKey:randomUUID()});
  const second=await startResearchSearch(b,{theme:token,includeSources:false,idempotencyKey:randomUUID()});
  assert.equal(first.pages[0].results[0]?.id,judgmentId);
  assert.equal(second.pages[0].results[0]?.id,judgmentId);
  let requests=0;
  const fixtures=new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:token,ementa:`${token} guarda`,
      possuiInteiroTeor:true,inteiroTeorHtml:'Decisão integral publicada sobre guarda.'}]})}]]);
  const transport:Transport=fixtureTransport(fixtures,async()=>{
    requests++;
    if (requests===1) {
      const competing=await processNextResearchExternalJob({transport,workerId:'other-download'});
      assert.equal(competing?.status,'deferred');
    }
  });
  assert.equal((await processNextResearchExternalJob({transport,workerId:'first-download'}))?.status,'completed');
  (await testDb.exec("UPDATE research_job SET run_after=0 WHERE status='queued' AND error_code='material_claimed'"));
  assert.equal((await processNextResearchExternalJob({transport,workerId:'other-download'}))?.status,'completed');
  assert.equal(requests,1);

  const secondToken=`cancel${randomUUID().replaceAll('-','')}`;
  await upsertSourceJudgment(installation,{...record(secondToken,`${secondToken} guarda`),fullTextStatus:'pending'});
  const one=await startResearchSearch(a,{theme:secondToken,includeSources:false,idempotencyKey:randomUUID()});
  const two=await startResearchSearch(b,{theme:secondToken,includeSources:false,idempotencyKey:randomUUID()});
  const {cancelResearchDownloads}=await import('../src/lib/application/research-service');
  assert.equal((await cancelResearchDownloads(a,one.id)).cancelled,1);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_job WHERE search_id=? AND status='queued'`).get(two.id))!.n,1);
});

test('revogar documentos durante transporte impede publicação e retira inteiro teor do FTS',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor()),token=`revoga${randomUUID().replaceAll('-','')}`;
  const id=await upsertSourceJudgment(installation,{...record(token,`${token} ementa`),fullTextStatus:'pending'});
  await publishMaterialText(installation,id,'full_text','termoexclusivofulltext revogado','text/plain');
  assert.equal((await searchResearchCorpus(person,{theme:'termoexclusivofulltext'})).results.some((item)=>item.id===id),true);
  (await testDb.prepare("UPDATE judicial_source_installation SET permission_documents='proibido' WHERE id=?").run(installation.id));
  assert.equal((await searchResearchCorpus(person,{theme:'termoexclusivofulltext'})).results.some((item)=>item.id===id),false);
  await assert.rejects(publishMaterialText(installation,id,'full_text','versão publicada após revogação','text/plain'),
    /deixou de permitir/);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_material_version v
    JOIN research_material m ON m.id=v.material_id WHERE m.judgment_id=? AND m.kind='full_text'`).get(id))!.n,1);
  (await testDb.prepare("UPDATE judicial_source_installation SET permission_documents='permitido' WHERE id=?").run(installation.id));

  const pending=`pending${randomUUID().replaceAll('-','')}`;
  const pendingId=await upsertSourceJudgment(installation,{...record(pending,`${pending} ementa`),fullTextStatus:'pending'});
  const search=await startResearchSearch(person,{theme:pending,includeSources:false,idempotencyKey:randomUUID()});
  const fixture=fixtureTransport(new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:pending,ementa:`${pending} ementa`,
      possuiInteiroTeor:true,inteiroTeorHtml:'Conteúdo que não pode ser publicado'}]})}]]),async ()=>{
    (await testDb.prepare("UPDATE judicial_source_installation SET permission_documents='proibido' WHERE id=?").run(installation.id));
  });
  assert.equal((await processNextResearchExternalJob({transport:fixture}))?.status,'failed');
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_material_version v JOIN research_material m ON m.id=v.material_id
    WHERE m.judgment_id=? AND m.kind='full_text'`).get(pendingId))!.n,0);
  assert.equal((await getResearchSearch(person,search.id)).pages[0].progress.unavailable>=1,true);
});

test('Retry-After não é encurtado e quota adia job sem gastar tentativas',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  (await testDb.exec('DELETE FROM research_source_budget'));
  const installation=await source(),person=(await actor()),theme=`retry${randomUUID().replaceAll('-','')}`;
  const search=await startResearchSearch(person,{theme,includeSources:true,idempotencyKey:randomUUID()});
  const transport:Transport={mode:'fixture',request:async()=>{throw new ConnectorError('rate_limited','Aguarde',1800);}};
  const before=Date.now();
  assert.equal((await processNextResearchExternalJob({transport}))?.status,'queued');
  const job=(await testDb.prepare("SELECT id,attempts,run_after FROM research_job WHERE search_id=? AND kind='search_page'").get(search.id))!;
  assert.equal(job.attempts,1);
  assert.ok(Number(job.run_after)>=before+1_800_000);
  (await testDb.prepare("UPDATE research_job SET run_after=0 WHERE id=?").run(job.id));
  (await testDb.prepare("UPDATE judicial_source_installation SET rate_limit_per_minute=1 WHERE id=?").run(installation.id));
  assert.equal((await processNextResearchExternalJob({transport}))?.status,'deferred');
  const after=(await testDb.prepare('SELECT attempts,status,run_after,error_code FROM research_job WHERE id=?').get(job.id))!;
  assert.equal(after.attempts,1);
  assert.equal(after.status,'queued');
  assert.equal(after.error_code,'budget_exceeded');
});

test('falha entre armazenamento e banco deixa órfão removível sem tocar versões válidas',async()=>{
  const installation=await source();
  const id=await upsertSourceJudgment(installation,{...record(`storage-${randomUUID()}`),fullTextStatus:'pending'});
  const bytes=Buffer.concat([onePagePdf(),Buffer.from(`\n% ${randomUUID()}\n`)]);
  const key=researchStorageKey(bytes,'pdf');
  (await testDb.exec(`CREATE FUNCTION research_fail_version_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_failure'; END $$;
CREATE TRIGGER research_fail_version BEFORE INSERT ON research_material_version FOR EACH ROW EXECUTE FUNCTION research_fail_version_fn();`));
  try { await assert.rejects(stageResearchPdf(installation,id,bytes,'https://jurisdf.tjdft.jus.br/official.pdf'),/injected_failure/); }
  finally { (await testDb.exec('DROP TRIGGER research_fail_version ON research_material_version')); }
  assert.deepEqual(await getResearchOriginal(key),bytes);
  assert.ok(await sweepResearchOrphans(0)>=1);
  await assert.rejects(getResearchOriginal(key));
});

test('lease vencido não pode ser renovado nem concluído pelo antigo dono',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  await source();
  const person=(await actor());
  await startResearchSearch(person,{theme:`lease${randomUUID().replaceAll('-','')}`,
    includeSources:true,idempotencyKey:randomUUID()});
  const claimed=await claimResearchJob('antigo',['search_page']);
  assert.ok(claimed);
  (await testDb.prepare('UPDATE research_job SET lease_until=1 WHERE id=?').run(claimed.id));
  assert.equal(await renewResearchLease(claimed,'antigo'),false);
  await completeResearchJob(claimed,'antigo');
  assert.equal((await testDb.prepare('SELECT status FROM research_job WHERE id=?').get(claimed.id))!.status,'running');
  const replacement=await claimResearchJob('novo',['search_page']);
  assert.equal(replacement?.id,claimed.id);
  await completeResearchJob(claimed,'antigo');
  assert.equal((await testDb.prepare('SELECT lease_owner FROM research_job WHERE id=?').get(claimed.id))!.lease_owner,'novo');
});

test('limpeza conserva original STJ enquanto checkpoint de ingestão o utiliza',async()=>{
  const installation=await source();
  const key=await putResearchOriginal(Buffer.from(`{ "sentinela": "${randomUUID()}" }`),'json');
  const originalKey=await putResearchOriginal(Buffer.from(`PK\u0003\u0004${randomUUID()}`),'zip');
  await utimes(resolve(testStorageRoot,'research',key),new Date(0),new Date(0));
  await utimes(resolve(testStorageRoot,'research',originalKey),new Date(0),new Date(0));
  const resourceId=randomUUID();
  (await testDb.prepare(`INSERT INTO research_source_resource
    (id,installation_id,source_resource_id,source_url,resource_kind,checkpoint,original_storage_key,status)
    VALUES(?,?,?,'https://dadosabertos.web.stj.jus.br/recurso.zip','mirror_zip',?,?,'running')`)
    .run(resourceId,installation.id,randomUUID(),JSON.stringify({jobId:randomUUID(),storageKey:key,nextIndex:0}),originalKey));
  await sweepResearchOrphans(0);
  assert.match((await getResearchOriginal(key)).toString('utf8'),/sentinela/);
  assert.match((await getResearchOriginal(originalKey)).toString('binary'),/^PK/);
  (await testDb.prepare("UPDATE research_source_resource SET checkpoint=NULL,status='completed' WHERE id=?").run(resourceId));
  assert.ok(await sweepResearchOrphans(0)>=1);
  await assert.rejects(getResearchOriginal(key));
  assert.match((await getResearchOriginal(originalKey)).toString('binary'),/^PK/);
  (await testDb.prepare('UPDATE research_source_resource SET original_storage_key=NULL WHERE id=?').run(resourceId));
  assert.ok(await sweepResearchOrphans(0)>=1);
  await assert.rejects(getResearchOriginal(originalKey));
});

test('a página aplica rerank somente aos 20 exibidos e preserva os demais no acervo',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor());
  (await testDb.prepare("UPDATE judicial_source_installation SET permission_ai='permitido' WHERE id=?").run(installation.id));
  (await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(person.userId));
  await saveConnection(person.userId,connectionSettings.parse({
    apiKey:'chave-sintetica-teste',enabled:true,research:'enabled',
    version:(await connectionView()).version,
  }));
  const theme=`tema${randomUUID().replaceAll('-','')}`;
  for (let n=0;n<25;n++) await upsertSourceJudgment(installation,{
    ...record(`${theme}-${n}`,`${theme} análise da guarda número ${n}`),fullTextStatus:'pending',
  });
  const baseline=await searchCorpus({theme,candidateLimit:30});
  assert.equal(baseline.results.length,25);
  const promoted=baseline.results[24];
  const send:DecisionTransport=async (_key,request)=>{
    const state=request.state as {judgments:Array<{id:string}>};
    return {model:request.model,usage:{input_tokens:40,output_tokens:20},
      answers:Object.fromEntries(Object.entries(request.questions).map(([name,question])=>{
        const index=Number(name.slice('judgment_'.length));
        const score=state.judgments[index].id===promoted.id?4:0;
        return [name,{type:'score',score,confidence:1,probabilities:Object.fromEntries(
          (question.type==='score'?question.criteria:[]).map((_,i)=>[String(i),Number(i===score)]))}];
      }))};
  };
  const search=await startResearchSearch(person,{theme,includeSources:false,idempotencyKey:randomUUID()},
    {rerankSend:send});
  assert.equal(search.pages[0].results.length,20);
  assert.equal(search.pages[0].results[0].id,promoted.id);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_job WHERE search_id=? AND kind='fetch_material'`)
    .get(search.id))!.n,20);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_rerank_cache WHERE office_id=? AND user_id=?')
    .get(person.officeId,person.userId))!.n,1);
});

test('consulta externa sem fonte temática apta mantém acervo local e sinaliza cobertura parcial',async()=>{
  const installation=await source(),person=(await actor()),theme=`semfonte${randomUUID().replaceAll('-','')}`;
  const judgmentId=await upsertSourceJudgment(installation,record(theme,`${theme} guarda da avó`));
  (await testDb.exec('UPDATE judicial_source_installation SET live_transport_enabled=0'));
  const search=await startResearchSearch(person,{theme,includeSources:true,idempotencyKey:randomUUID()});
  assert.equal(search.pages[0].status,'partial');
  assert.equal(search.pages[0].sourceError,'no_source_enabled');
  assert.equal(search.pages[0].results[0]?.id,judgmentId);
  assert.equal(search.pages[0].nextCursor,null);
  assert.equal((await testDb.prepare("SELECT count(*) AS n FROM research_job WHERE search_id=? AND kind='search_page'")
    .get(search.id))!.n,0);
});

test('replay reconstitui job de material após queda entre resultado e fila',async()=>{
  (await testDb.exec("UPDATE research_job SET status='cancelled' WHERE status IN ('queued','running')"));
  const installation=await source(),person=(await actor()),native=`replay-${randomUUID()}`;
  const theme=`replay${randomUUID().replaceAll('-','')}`;
  const search=await startResearchSearch(person,{theme,includeSources:true,idempotencyKey:randomUUID()});
  const page=search.pages[0];
  const judgmentId=await upsertSourceJudgment(installation,{
    ...record(native,`${theme} guarda`),fullTextStatus:'pending',
  });
  // The result was committed, but the old worker died before enqueueing its full text.
  (await testDb.prepare(`INSERT INTO research_search_result
    (id,search_id,page_id,judgment_id,position,origin) VALUES(?,?,?,?,0,'source')`)
    .run(randomUUID(),search.id,page.id,judgmentId));
  const fixture=fixtureTransport(new Map([[fixtureKey(installation.id,'POST','/api/v1/pesquisa'),{
    body:JSON.stringify({hits:{value:1},registros:[{identificador:native,ementa:`${theme} guarda`,possuiInteiroTeor:true}]})
  }]]));
  assert.equal((await processNextResearchExternalJob({transport:fixture}))?.status,'completed');
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_search_result WHERE search_id=? AND judgment_id=?')
    .get(search.id,judgmentId))!.n,1);
  assert.equal((await testDb.prepare(`SELECT count(*) AS n FROM research_job WHERE search_id=? AND page_id=?
    AND kind='fetch_material' AND status='queued'`).get(search.id,page.id))!.n,1);
});

test('espelho STJ fica pesquisável sem agendar download individual impossível',async()=>{
  const person=(await actor()),theme=`espelho${randomUUID().replaceAll('-','')}`;
  const installation=await upsertInstallation({kind:'ckan',courtCode:'STJ',courtName:'Superior Tribunal de Justiça',
    degree:'superior',system:'not_applicable',purpose:'jurisprudence',baseUrl:'https://dadosabertos.web.stj.jus.br/',
    authKind:'none',discoveryStatus:'pilot',permissions:{query:'permitido',cache:'permitido',documents:'permitido',
      redistribution:'permitido',ai:'nao_esclarecido'},allowedHosts:['dadosabertos.web.stj.jus.br'],enabled:true,
    liveTransportEnabled:true,rateLimitPerMinute:600,dailyRequestBudget:1000});
  const judgmentId=await upsertSourceJudgment(installation,{
    ...record(theme,`${theme} guarda`),tribunal:'STJ',fullTextStatus:'pending',
  });
  const search=await startResearchSearch(person,{theme,includeSources:false,idempotencyKey:randomUUID()});
  assert.equal(search.pages[0].results[0]?.id,judgmentId);
  assert.equal(search.pages[0].results[0]?.fullTextStatus,'unavailable');
  const detail=await getResearchJudgment(person,judgmentId);
  const material=detail.materials.find(item=>item.kind==='full_text');
  assert.equal(material?.status,'unavailable');
  assert.equal(material?.unavailableReason,'source_import_required');
  assert.deepEqual(await requestResearchMaterial(person,{judgmentId,kind:'full_text'}),
    {jobId:null,status:'unavailable'});
  assert.equal((await testDb.prepare("SELECT count(*) AS n FROM research_job WHERE material_id=? AND kind='fetch_material'")
    .get(material?.id))!.n,0);
});
