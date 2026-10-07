import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from './google-fixture';
import { createConversation } from '../src/lib/ai-store';
import { runCapability } from '../src/lib/agent-tools';
import { sourcesFromTool, recordSources, conversationSources } from '../src/lib/citations/sources';
import { reviewCitations } from '../src/lib/citations/review';
import { reviewArtifactCitations } from '../src/lib/citations/artifact-review';
import { createPrivateDocument } from '../src/lib/documents/service';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionTransport } from '../src/lib/typesafe/client';
import { captureCapabilityReplay, replayCapabilityResult } from '../src/lib/application/capability-replay';
import { capabilities } from '../src/lib/capabilities/contracts';
import { ownedContentResult } from '../src/lib/content-result';
import { exposedPolicies } from '../src/lib/content-policy';

async function fixture() {
  const f = await googleFixture();
  const caseId = randomUUID(), installationId = randomUUID(), judgmentId = randomUUID(), materialId = randomUUID(), versionId = randomUUID(), chunkId = randomUUID(), referenceId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Catálogo', f.userId);
  await db.prepare(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,auth_kind,discovery_status,permission_query,permission_cache,permission_documents,permission_redistribution,permission_ai,enabled)
    VALUES(?,'jurisprudence_api',?,'STJ','second','proprietary','jurisprudence','none','pilot','permitido','permitido','permitido','permitido','permitido',1)`).run(installationId, installationId.slice(0, 8));
  await db.prepare(`INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at,status)
    VALUES(?,?,?,'STJ','REsp 1.234.567/SP','fixture',CURRENT_TIMESTAMP,'active')`).run(judgmentId, installationId, randomUUID());
  await db.prepare("INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'ementa','ready',?)").run(materialId, judgmentId, versionId);
  const text = 'REsp 1.234.567/SP do STJ: CATALOG_REVOKED_BYTES. O dano é presumido.';
  await db.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    VALUES(?,?,?,'text/plain',?,?,'fixture',?::jsonb,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(versionId, materialId, randomUUID().replaceAll('-', ''), text.length, text, JSON.stringify({ title: 'REsp 1.234.567/SP', tribunal: 'STJ', caseNumber: '1.234.567', sourceUrl: 'https://stj.example.test/material' }));
  await db.prepare('INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,?)').run(chunkId, versionId, text, 'ementa:1');
  await db.prepare('INSERT INTO research_fts(judgment_id,material_version_id,text_content) VALUES(?,?,?)').run(judgmentId, versionId, text);
  await db.prepare(`INSERT INTO research_case_reference(id,office_id,case_id,material_version_id,purpose,notes,bypass_evaluation,created_by,updated_by)
    VALUES(?,?,?,?,'foundation','',1,?,?)`).run(referenceId, f.officeId, caseId, versionId, f.userId, f.userId);
  const chat = await createConversation(db, f.context);
  await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(f.userId);
  await saveConnection(f.userId, connectionSettings.parse({ apiKey: 'synthetic-typesafe', enabled: true, documents: 'enabled', version: (await connectionView()).version }));
  return { ...f, caseId, installationId, materialId, versionId, chunkId, referenceId, conversationId: chat.id };
}

test('catalog knowledge -> source cache -> chat/artifact citation provider retains exact policy while public web remains admitted', async () => {
  const f = await fixture();
  const result = await runCapability({ ...f.context, allowedResearchCaseId: f.caseId }, 'k5_knowledge_search', { caseId: f.caseId, researchReferenceIds: [f.referenceId], query: 'dano', limit: 8 });
  const sources = sourcesFromTool('k5_knowledge_search', result);
  assert.ok(sources.length && sources.every(source => source.policy?.observed.some(pin => pin.kind === 'research' && pin.version === f.versionId)));
  await recordSources(f.context, f.conversationId, sources);
  await recordSources(f.context, f.conversationId, [{ kind: 'web_jurisprudence', ref: 'https://public.example.test/resp', title: 'REsp 1.234.567/SP', text: 'STJ REsp 1.234.567/SP PUBLIC_WEB_BYTES: dano presumido.' }]);
  await db.prepare(`INSERT INTO conversation_source(id,office_id,user_id,conversation_id,kind,ref,title,text)
    VALUES(?,?,?,?,'web_jurisprudence',?,'REsp 1.234.567/SP','LEGACY_CATALOG_BYTES')`).run(randomUUID(), f.officeId, f.userId, f.conversationId, `${f.versionId}:${f.chunkId}`);
  const requests: string[] = [];
  const send: DecisionTransport = async (_key, request) => {
    requests.push(JSON.stringify(request));
    return { model: request.model, usage: { input_tokens: 1, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, question.type === 'choice'
      ? { type: 'choice', choice: name.startsWith('kind') ? 'precedent' : 'supports', confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === (name.startsWith('kind') ? 'precedent' : 'supports') ? 1 : 0])) }
      : { type: 'noul', noul: 1 }])) };
  };
  const text = 'O dano é presumido, conforme REsp 1.234.567/SP do STJ.';
  await reviewCitations(f.context, text, await conversationSources(f.context, f.conversationId), { send });
  assert.match(requests[0], /CATALOG_REVOKED_BYTES/); assert.doesNotMatch(requests[0], /LEGACY_CATALOG_BYTES/);
  await db.prepare("UPDATE judicial_source_installation SET permission_ai='proibido' WHERE id=?").run(f.installationId);
  const snapshot = await conversationSources(f.context, f.conversationId);
  assert.equal(snapshot.length, 1);
  await reviewCitations(f.context, text, snapshot, { send });
  const artifact = await createPrivateDocument({ ...f.context, conversationId: f.conversationId }, { title: 'Resposta independente', content: text });
  await reviewArtifactCitations(f.context, artifact, { send });
  for (const request of requests.slice(1)) { assert.doesNotMatch(request, /CATALOG_REVOKED_BYTES|LEGACY_CATALOG_BYTES/); assert.match(request, /PUBLIC_WEB_BYTES/); }
  await db.prepare("UPDATE judicial_source_installation SET permission_ai='permitido' WHERE id=?").run(f.installationId);
  assert.equal((await conversationSources(f.context, f.conversationId)).length, 2);
  await db.prepare("UPDATE research_material SET status='restricted' WHERE id=?").run(f.materialId);
  assert.equal((await conversationSources(f.context, f.conversationId)).length, 1);
});

test('generic catalog search replay retains historical material versions and denies later catalog revocation', async () => {
  const f = await fixture();
  const input = { theme: 'REsp 1.234.567', includeSources: false, idempotencyKey: randomUUID() };
  const initial = await runCapability(f.context, 'k5_research_start_search', input);
  const retry = await runCapability(f.context, 'k5_research_start_search', input);
  assert.deepEqual(retry, initial);
  assert.ok(exposedPolicies(retry)?.some(policy => policy.observed.some(pin => pin.version === f.versionId)));
  await db.prepare("UPDATE research_material SET status='restricted' WHERE id=?").run(f.materialId);
  await assert.rejects(runCapability(f.context, 'k5_research_start_search', input), { code: 'NOT_FOUND' });
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM research_search WHERE office_id=?').get<{ n: number }>(f.officeId))?.n, 1);
});


test('metadata-only catalog result keeps source authority through replay and private derivation', async () => {
  const f = await fixture(), judgmentId = randomUUID();
  await db.prepare(`INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at,status)
    VALUES(?,?,?,'STJ','METADATA_ONLY_PROTECTED','metadata',CURRENT_TIMESTAMP,'active')`).run(judgmentId,f.installationId,randomUUID());
  const context = { ...f.context, invocation: 'agent' as const, conversationId: f.conversationId, contentSources: [] };
  const result = await runCapability(context,'k5_research_get_judgment',{ judgmentId });
  assert.match(JSON.stringify(result),/METADATA_ONLY_PROTECTED/);
  assert.ok(ownedContentResult(result), 'actual root DTO must preserve its domain owner');
  const policies = exposedPolicies(result)!;
  assert.ok(policies.some(policy => policy.guards.some(guard => guard.kind === 'research-judgment' && guard.id === judgmentId)));
  const capability = capabilities.k5_research_get_judgment;
  const binding = await captureCapabilityReplay(context,capability,result);
  const artifact = await createPrivateDocument({ ...context, contentSources: policies },{title:'Private derivation',content:'METADATA_ONLY_PROTECTED'});
  await db.prepare("UPDATE judicial_source_installation SET permission_ai='proibido' WHERE id=?").run(f.installationId);
  await assert.rejects(replayCapabilityResult(context,result,binding),{code:'NOT_FOUND'});
  await assert.rejects(runCapability(context,'k5_artifacts_get',{artifactId:artifact.id}),{code:'NOT_FOUND'});
  await db.prepare("UPDATE judicial_source_installation SET permission_ai='permitido' WHERE id=?").run(f.installationId);
  assert.deepEqual(await replayCapabilityResult(context,result,binding),result);
});


test('empty case reference result retains its case dependency in private derivation', async () => {
  const f=await fixture(), emptyCaseId=randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(emptyCaseId,f.officeId,'Empty references',f.userId);
  const context={...f.context,invocation:'agent' as const,conversationId:f.conversationId,contentSources:[]};
  const result=await runCapability(context,'k5_research_list_references',{caseId:emptyCaseId});
  assert.deepEqual(result,{references:[]});assert.ok(ownedContentResult(result));
  const policies=exposedPolicies(result)!;
  assert.ok(policies.some(policy=>policy.guards.some(guard=>guard.kind==='case'&&guard.id===emptyCaseId)));
  const artifact=await createPrivateDocument({...context,contentSources:policies},{title:'Empty case result',content:'No references were present.'});
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(emptyCaseId);
  await assert.rejects(runCapability(context,'k5_artifacts_get',{artifactId:artifact.id}),{code:'NOT_FOUND'});
});
