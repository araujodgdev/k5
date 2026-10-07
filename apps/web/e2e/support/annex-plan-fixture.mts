import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
assert.ok(process.env.DATABASE_URL, 'E2E fixtures require DATABASE_URL from the test runner.');
const require = createRequire(new URL('../../package.json', import.meta.url));
const serverOnly = require.resolve('server-only');
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
const { authStore, database: db } = await import('../../src/lib/database');
const { createAiConnection, deleteAiConnection } = await import('../../src/lib/ai-connections-core');
const { updateModelAssignment } = await import('../../src/lib/ai-assignments-core');
const { analyzeAnnexes } = await import('../../src/lib/annexes');
const [email, caseId, scanDocumentId, petitionDocumentId] = process.argv.slice(2);
const actor = await db.prepare(`SELECT m.user_id,m.office_id,s.id AS session_id FROM office_member m JOIN "user" u ON u.id=m.user_id
  JOIN session s ON s."userId"=u.id WHERE u.email=? AND s."expiresAt">clock_timestamp() ORDER BY s."createdAt" DESC LIMIT 1`)
  .get<{ user_id: string; office_id: string; session_id: string }>(email);
assert.ok(actor); assert.ok(await db.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=?').get(caseId, actor.office_id));
const previous = await db.prepare("SELECT * FROM ai_model_assignment WHERE scope='task' AND target='extraction.annex_plan'").get<Record<string, unknown>>();
const connection = await createAiConnection(db, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), actor.user_id,
  { name: `Round2 browser boundary ${randomUUID()}`, provider: 'cliproxyapi', apiKey: 'synthetic-boundary-key' });
const originalFetch = globalThis.fetch;
let providerAdmissions = 0;
try {
  await updateModelAssignment(db, actor.user_id, { scope: 'task', target: 'extraction.annex_plan', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.lume.software/v1/responses'); providerAdmissions++;
    return Response.json({ id: 'annex-fixture', object: 'response', created_at: 1, model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', id: 'annex-msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ documents: [{ label: 'Identificação revisada', startPage: 1, endPage: 1, mention: 'documento de identificação' }] }), annotations: [] }] }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } });
  };
  const plan = await analyzeAnnexes({ officeId: actor.office_id, userId: actor.user_id, sessionId: actor.session_id }, { caseId, scanDocumentId, petitionDocumentId });
  console.log(JSON.stringify({ planId: plan.planId, scanDocumentId, caseId, providerAdmissions, boundary: 'External provider only; actual analyze owner and PostgreSQL plan' }));
} finally {
  globalThis.fetch = originalFetch;
  await db.prepare("DELETE FROM ai_model_assignment WHERE scope='task' AND target='extraction.annex_plan'").run();
  if (previous) await db.prepare(`INSERT INTO ai_model_assignment(scope,target,model_mode,connection_id,model_id,effort_mode,reasoning_effort,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(...['scope','target','model_mode','connection_id','model_id','effort_mode','reasoning_effort','updated_at','updated_by'].map(key => previous[key]));
  await deleteAiConnection(db, actor.user_id, connection.id);
  await (await authStore()).end();
}
