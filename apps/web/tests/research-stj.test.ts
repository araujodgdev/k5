import './test-setup';
import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { upsertInstallation } from '../src/lib/judicial/repositories/installations';
import { fixtureKey, fixtureTransport } from '../src/lib/judicial/connectors/transport';
import { claimResearchJob } from '../src/lib/research/jobs';
import { discoverStjResources, enqueueStjResource, linkStjDocument,
  processNextStjResource } from '../src/lib/research/stj-ingest';
import { getResearchOriginal } from '../src/lib/research/storage';
import { normalizeStjFullTextMetadata, normalizeStjMirror, stjCkanResources,
  STJ_FULL_TEXT_DATASET, STJ_MIRROR_DATASET } from '../src/lib/research/sources/stj';

const portal = 'https://dadosabertos.web.stj.jus.br';
function actor() {
  const userId = randomUUID(), officeId = randomUUID(), email = `${userId}@example.test`;
  testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,email,'Operadora');
  testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Escritório de teste');
  testDb.prepare("INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,'administrator')")
    .run(randomUUID(),officeId,userId);
  testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId);
  return { userId, officeId, email };
}
async function source(documents = true) {
  return upsertInstallation({ kind:'ckan', courtCode:'STJ', courtName:'Superior Tribunal de Justiça',
    degree:'superior', system:'not_applicable', purpose:'jurisprudence', baseUrl:`${portal}/`,
    authKind:'none', discoveryStatus:'pilot', permissions:{ query:'permitido', cache:'permitido',
      documents: documents ? 'permitido' : 'nao_esclarecido', redistribution:'permitido', ai:'nao_esclarecido' },
    allowedHosts:['dadosabertos.web.stj.jus.br'], enabled:true, liveTransportEnabled:true,
    rateLimitPerMinute:600, dailyRequestBudget:100_000 });
}
function ckan(slug: string, items: Array<{ id: string; name: string; format: 'JSON' | 'ZIP';
  url: string; last_modified?: string; size?: number }>) {
  return { success:true, result:{ name:slug, license_id:'cc-by', resources:items.map(item =>
    ({...item,state:'active',last_modified:item.last_modified ?? '2026-09-22T00:00:00'})) } };
}
function resource(name: string, format: 'JSON' | 'ZIP' = 'JSON') {
  return { id:randomUUID(), name, format, url:`${portal}/dataset/${randomUUID()}/resource/${randomUUID()}/download/${name}` };
}
function mirror(id: string, documentId: string, registrationNumber = '202600001234') {
  return { id, numeroDocumento:documentId, numeroRegistro:registrationNumber, numeroProcesso:'1234567',
    siglaClasse:'REsp', descricaoClasse:'Recurso Especial', nomeOrgaoJulgador:'SEGUNDA TURMA',
    ministroRelator:'MINISTRA TESTE', dataDecisao:'20260920',
    ementa:'A proteção da criança prevaleceu diante dos cuidados prestados pela avó.' };
}
async function runStj(transport: ReturnType<typeof fixtureTransport>) {
  const job = await claimResearchJob('stj-test-worker',['stj_resource']);
  assert.ok(job);
  await processNextStjResource(job,transport,'stj-test-worker');
  return testDb.prepare('SELECT status,error_code FROM research_job WHERE id=?').get(job.id)!;
}

test('parser separa ID do espelho, SeqDocumento e só aceita recursos CKAN com licença esperada', () => {
  const parsed = normalizeStjMirror(mirror('000782366','4567'),0);
  assert.equal('judgment' in parsed && parsed.judgment.sourceJudgmentId,'000782366');
  assert.equal('documentId' in parsed && parsed.documentId,'4567');
  assert.equal('judgment' in parsed && parsed.judgment.decisionDate,'2026-09-20');
  const meta = normalizeStjFullTextMetadata({SeqDocumento:4567,numeroRegistro:'202600001234',
    tipoDocumento:'ACÓRDÃO',dataPublicacao:1790035200000},0);
  assert.equal('documentId' in meta && meta.documentId,'4567');
  const r = resource('20260920.json');
  assert.equal(stjCkanResources(ckan(STJ_MIRROR_DATASET,[r]),STJ_MIRROR_DATASET)[0].id,r.id);
  assert.throws(() => stjCkanResources({...ckan(STJ_MIRROR_DATASET,[r]),result:{
    ...ckan(STJ_MIRROR_DATASET,[r]).result,license_id:'unknown'}},STJ_MIRROR_DATASET));
  assert.equal(stjCkanResources(ckan(STJ_MIRROR_DATASET,[{...r,size:51*1024*1024}]),
    STJ_MIRROR_DATASET).length,0);
});

test('descoberta e ingestão de espelho são idempotentes e um recurso antigo não sobrescreve o novo', async () => {
  const installation = await source(), person = actor(), native = randomUUID();
  const older = resource('20260920.json'), newer = resource('20260921.json');
  const metadata = ckan(STJ_MIRROR_DATASET,[older,newer]);
  const endpoint = `${portal}/api/3/action/package_show?id=${STJ_MIRROR_DATASET}`;
  const transport = fixtureTransport(new Map([
    [fixtureKey(installation.id,'GET',endpoint),{body:JSON.stringify(metadata)}],
    [fixtureKey(installation.id,'GET',older.url),{body:JSON.stringify([mirror(native,'17')])}],
    [fixtureKey(installation.id,'GET',newer.url),{body:JSON.stringify([{...mirror(native,'17'),
      ementa:'Versão posterior: cuidados da avó comprovados.'}])}],
  ]));
  const found = await discoverStjResources({installationId:installation.id,datasetSlug:STJ_MIRROR_DATASET,
    actorEmail:person.email,transport});
  assert.deepEqual(found.map(item => item.id),[older.id,newer.id]);
  const latest = await enqueueStjResource({installationId:installation.id,datasetSlug:STJ_MIRROR_DATASET,
    resource:found[1],actorEmail:person.email});
  assert.equal((await runStj(transport)).status,'completed');
  const first = testDb.prepare(`SELECT j.id,j.source_url,m.current_version_id FROM research_judgment j
    JOIN research_material m ON m.judgment_id=j.id AND m.kind='ementa'
    WHERE j.installation_id=? AND j.source_judgment_id=?`).get(installation.id,native)!;
  assert.equal(first.source_url,newer.url);
  const replay = await enqueueStjResource({installationId:installation.id,datasetSlug:STJ_MIRROR_DATASET,
    resource:found[1],actorEmail:person.email});
  assert.equal(replay.jobId,latest.jobId);
  const old = await enqueueStjResource({installationId:installation.id,datasetSlug:STJ_MIRROR_DATASET,
    resource:found[0],actorEmail:person.email});
  assert.notEqual(old.jobId,latest.jobId);
  assert.equal((await runStj(transport)).status,'completed');
  const after = testDb.prepare("SELECT current_version_id FROM research_material WHERE judgment_id=? AND kind='ementa'")
    .get(first.id)!;
  assert.equal(after.current_version_id,first.current_version_id);
  assert.equal(testDb.prepare('SELECT count(*) AS n FROM research_judgment WHERE source_judgment_id=?')
    .get(native)!.n,1);
});

test('ZIP de íntegras só publica após vínculo explícito, inclusive ao reprocessar SHA igual', async () => {
  const installation = await source(), person = actor(), native = randomUUID();
  const mirrorFile = resource('20260920.json');
  const metadataFile = resource('metadados20260921.json');
  const zipFile = resource('20260921.zip','ZIP');
  const zip = new PizZip();
  zip.file('20260921/70001.txt','Relatório e voto completos sobre a proteção da criança pela avó.');
  const zipBytes = zip.generate({type:'nodebuffer'}) as Buffer;
  const transport = fixtureTransport(new Map([
    [fixtureKey(installation.id,'GET',mirrorFile.url),{body:JSON.stringify([mirror(native,'70001')])}],
    [fixtureKey(installation.id,'GET',metadataFile.url),{body:JSON.stringify([{
      SeqDocumento:'70001',numeroRegistro:'202600001234',tipoDocumento:'ACÓRDÃO',dataPublicacao:'2026-09-21'}])}],
    [fixtureKey(installation.id,'GET',zipFile.url),{body:zipBytes,contentType:'application/octet-stream'}],
  ]));
  const mirrorCandidate = stjCkanResources(ckan(STJ_MIRROR_DATASET,[mirrorFile]),STJ_MIRROR_DATASET)[0];
  const fullCandidates = stjCkanResources(ckan(STJ_FULL_TEXT_DATASET,[metadataFile,zipFile]),STJ_FULL_TEXT_DATASET);
  const metadataCandidate = fullCandidates.find(item => item.kind === 'full_text_json')!;
  const zipCandidate = fullCandidates.find(item => item.kind === 'full_text_zip')!;
  for (const [datasetSlug,item] of [[STJ_MIRROR_DATASET,mirrorCandidate],
    [STJ_FULL_TEXT_DATASET,metadataCandidate],[STJ_FULL_TEXT_DATASET,zipCandidate]] as const) {
    await enqueueStjResource({installationId:installation.id,datasetSlug,resource:item,actorEmail:person.email});
    assert.equal((await runStj(transport)).status,'completed');
  }
  const judgment = testDb.prepare('SELECT id FROM research_judgment WHERE installation_id=? AND source_judgment_id=?')
    .get(installation.id,native)!;
  assert.equal(testDb.prepare("SELECT count(*) AS n FROM research_material_version v JOIN research_material m ON m.id=v.material_id WHERE m.judgment_id=? AND m.kind='full_text'")
    .get(judgment.id)!.n,0);
  assert.equal(testDb.prepare("SELECT reason FROM research_quarantine WHERE reason='link_missing' ORDER BY created_at DESC LIMIT 1")
    .get()!.reason,'link_missing');
  await linkStjDocument({installationId:installation.id,mirrorId:native,documentId:'70001',
    evidenceUrl:metadataFile.url,evidenceNote:'Operadora conferiu SeqDocumento e número de registro nas duas fontes.',
    actorEmail:person.email});
  await enqueueStjResource({installationId:installation.id,datasetSlug:STJ_FULL_TEXT_DATASET,
    resource:zipCandidate,actorEmail:person.email,force:true});
  assert.equal((await runStj(transport)).status,'completed');
  const version = testDb.prepare(`SELECT v.text_content FROM research_material_version v
    JOIN research_material m ON m.current_version_id=v.id WHERE m.judgment_id=? AND m.kind='full_text'`)
    .get(judgment.id)!;
  assert.match(String(version.text_content),/Relatório e voto completos/);
  const saved = testDb.prepare('SELECT content_sha256,original_storage_key FROM research_source_resource WHERE source_resource_id=?')
    .get(zipFile.id)!;
  assert.equal(saved.content_sha256,createHash('sha256').update(zipBytes).digest('hex'));
  assert.deepEqual(await getResearchOriginal(String(saved.original_storage_key)),zipBytes);
  await assert.rejects(linkStjDocument({installationId:installation.id,mirrorId:native,
    documentId:'70002',evidenceUrl:metadataFile.url,evidenceNote:'Tentativa sem metadado existente.',
    actorEmail:person.email}), { code:'not_found' });
});

test('checkpoint retoma lote de espelhos após adiamento sem duplicar versões', async () => {
  const installation = await source(), person = actor(), file = resource('20260922.json');
  const rows = Array.from({length:251},(_,index) => mirror(`${randomUUID()}-${index}`,String(80000+index)));
  const transport = fixtureTransport(new Map([[fixtureKey(installation.id,'GET',file.url),
    {body:JSON.stringify(rows)}]]));
  const item = stjCkanResources(ckan(STJ_MIRROR_DATASET,[file]),STJ_MIRROR_DATASET)[0];
  await enqueueStjResource({installationId:installation.id,datasetSlug:STJ_MIRROR_DATASET,
    resource:item,actorEmail:person.email});
  assert.equal((await runStj(transport)).status,'queued');
  const resourceRow = testDb.prepare('SELECT checkpoint FROM research_source_resource WHERE source_resource_id=?')
    .get(file.id)!;
  assert.equal(JSON.parse(String(resourceRow.checkpoint)).nextIndex,250);
  testDb.prepare("UPDATE research_job SET run_after=0 WHERE kind='stj_resource' AND status='queued'").run();
  assert.equal((await runStj(transport)).status,'completed');
  assert.equal(testDb.prepare('SELECT count(*) AS n FROM research_stj_mirror_identity WHERE source_resource_id=(SELECT id FROM research_source_resource WHERE source_resource_id=?)')
    .get(file.id)!.n,251);
});
