import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728');
assert.equal(state.port, 62541);
assert.equal(state.pgPort, 62542);
assert.equal(state.status, 'ready');
const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const target = join(web, 'src/lib/google/gmail/service.ts');
const original = readFileSync(target, 'utf8');
const start = original.indexOf("  if (row.status === 'succeeded' && capability === 'k5_gmail_save_draft') {");
const end = original.indexOf("  if (row.status === 'succeeded' || row.status === 'unknown')", start);
assert.ok(start > 0 && end > start);
const output = join(state.evidenceDir, `source-gmail-negative-${Date.now()}`);
mkdirSync(output, { recursive: true });
const log = createWriteStream(join(output, 'output.log'));
let code: number | null = null;
try {
  // Reproduce the former cached-return behavior with the corrected real Google fixture.
  writeFileSync(target, original.slice(0, start) + original.slice(end));
  const child = spawn(process.execPath, ['--import', '../../.audit/lume-no-external-test-traffic.mjs', '--import', 'tsx', '--test', '--test-concurrency=1',
    '--test-name-pattern=Gmail keyed save replay', 'tests/source-functional-repair.test.ts'], {
    cwd: web, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TEST_DATABASE_URL: state.databaseUrl, DATABASE_URL: state.databaseUrl,
      K5_ENV_FILE: join(pointer.runDir, 'verify.env') },
  });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { log.write(data); process.stdout.write(data); });
  code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
} finally {
  writeFileSync(target, original);
  log.end();
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const restored = sha256(readFileSync(target, 'utf8')) === sha256(original);
  writeFileSync(join(output, 'restoration.json'), JSON.stringify({ code, restored, sha256: sha256(original) }, null, 2));
  assert.ok(restored);
}
console.log(JSON.stringify({ output, exitCode: code, restored: true }));
assert.equal(code, 1, 'The old cached-return behavior must fail the denial regression.');
