import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'apps/web');
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728');
assert.equal(state.port, 62541);
assert.equal(state.pgPort, 62542);
assert.equal(state.status, 'ready');
const output = join(state.evidenceDir, `source-handoff-${Date.now()}`);
mkdirSync(output);
const inventory = JSON.parse(readFileSync(join(root, '.audit/lume-provenance-files.json'), 'utf8'));
const files = Object.values(inventory.groups).flat() as string[];
assert.equal(new Set(files).size, files.length);
for (const file of files) assert.ok(existsSync(join(web, file)), file);
const reportPath = join(root, '.audit/lume-provenance-implementation.md');
const links = [...readFileSync(reportPath, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
for (const link of links.filter(link => !/^https?:/.test(link))) assert.ok(existsSync(resolve(dirname(reportPath), link)), link);
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const frozenReport = createHash('sha256').update(readFileSync(join(root, '.audit/lume-provenance-implementation-astra-interrupted.md'))).digest('hex');
assert.equal(frozenReport, '6df4e89a7363ffe480f27b2fab34f2d4253e6a8aae9d6cb09bf3f23e4f9c14ac');
const tests = ['1791342654716', '1791342887598', '1791342987807', '1791343107922', '1791343771814', '1791343831521', '1791343987620', '1791344067674', '1791344311665'].map(id => {
  const log = readFileSync(join(state.evidenceDir, `source-test-${id}/output.log`), 'utf8');
  const count = (key: string) => Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1]);
  return { directory: `source-test-${id}`, tests: count('tests'), passed: count('pass'), failed: count('fail') };
});
assert.deepEqual(tests.at(-1), { directory: 'source-test-1791344311665', tests: 10, passed: 10, failed: 0 });
const browser = ['1791341594721', '1791342994695', '1791343553245', '1791343760462', '1791343884288', '1791343977727'].map(id => {
  const report = JSON.parse(readFileSync(join(state.evidenceDir, `source-e2e-${id}/report.json`), 'utf8'));
  return { directory: `source-e2e-${id}`, status: report.run.status, exitCode: report.run.exitCode,
    results: report.run.results.map((result: { testId: string; status: string; kind: string }) => ({ testId: result.testId, status: result.status, kind: result.kind })) };
});
const manifest = JSON.parse(readFileSync(join(state.evidenceDir, 'source-browser/manifest.json'), 'utf8'));
for (const file of manifest.files) assert.equal(statSync(join(state.evidenceDir, 'source-browser', file.name)).size, file.bytes);
const require = createRequire(join(web, 'package.json'));
const { Client } = require('pg');
const client = new Client({ connectionString: state.databaseUrl });
await client.connect();
let database;
try {
  await client.query('BEGIN READ ONLY');
  const migrations = (await client.query("SELECT name,checksum FROM postgres_migration WHERE name IN ('0076_content_policy.sql','0077_content_policy_validation.sql') ORDER BY name")).rows;
  assert.equal(migrations.length, 2);
  for (const migration of migrations) assert.equal(migration.checksum, digest(readFileSync(join(web, 'db/postgres', migration.name), 'utf8')), migration.name);
  const publication = (await client.query('SELECT p.version,p.content=a.content AS original_matches,a.version AS original_version FROM case_page p JOIN ai_artifact a ON a.id=$1 WHERE p.id=$2', ['c1237288-6ddc-4921-9545-c3dc854bd4c0', '233042d9-62ad-45c2-a17c-df5954aa20c1'])).rows;
  assert.equal(publication[0]?.original_matches, true);
  const archive = (await client.query(`SELECT d.scope,d.case_id,v.content_policy->>'origin' AS origin,v.content_policy->>'eligible' AS eligible,
    v.content_policy->'owners' @> jsonb_build_array(o.user_id) AS owner_retained FROM vault_agent_origin o JOIN vault_document d ON d.id=o.document_id
    JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1 WHERE o.source_id=$1`, ['3ce4bb10-a5f7-4ec2-be0d-d4980bbafc20'])).rows;
  assert.deepEqual(archive, [{ scope: 'library', case_id: null, origin: 'uncertain', eligible: 'false', owner_retained: true }]);
  const review = (await client.query(`SELECT a.status,p.result_version,c.content FROM capability_approval a JOIN case_page_approval p ON p.approval_id=a.id
    JOIN case_page c ON c.id=p.result_page_id WHERE a.id=$1`, ['3a093d2e-3680-4615-8b4a-13424dde3eb7'])).rows;
  assert.deepEqual(review, [{ status: 'consumed', result_version: 1, content: 'Texto da proposta autenticada, revisado no chat antes de publicar no caso.' }]);
  const gates = (await client.query("SELECT tgname FROM pg_trigger WHERE tgname LIKE 'content_acl_%' AND NOT tgisinternal ORDER BY tgname")).rows;
  await client.query('COMMIT');
  database = { migrations, publication, archive, review, gates };
} finally { await client.end(); }
const census: Record<string, string[]> = { artifact: [], page: [] };
function scan(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.tsx?$/.test(entry.name)) {
      const text = readFileSync(path, 'utf8');
      if (/INSERT INTO ai_artifact(?:\s|\()/i.test(text) || /UPDATE ai_artifact SET[^`]*\bcontent\s*=/i.test(text)) census.artifact.push(path.slice(web.length + 1).replaceAll('\\', '/'));
      if (/INSERT INTO case_page(?:\s|\()/i.test(text) || /UPDATE case_page SET[^`]*\bcontent\s*=/i.test(text)) census.page.push(path.slice(web.length + 1).replaceAll('\\', '/'));
    }
  }
}
scan(join(web, 'src'));
assert.deepEqual(census.artifact, ['src/lib/documents/service.ts']);
assert.deepEqual(census.page, ['src/lib/case-pages/service.ts']);
writeFileSync(join(output, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), runId: state.runId, files, links, frozenReport, tests, browser, database, census, inheritedBrowserAssets: manifest.files.length }, null, 2));
console.log(JSON.stringify({ output, inventoryFiles: files.length, tests, census, migrationChecksumsMatch: true, persistenceMatches: true }));
