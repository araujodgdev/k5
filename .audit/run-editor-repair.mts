import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
if (state.runId !== '20261006T234247-d88728' || state.port !== 62541 || state.pgPort !== 62542 || state.status !== 'ready') throw new Error('Owned isolated instance does not match the repair contract.');
const web = fileURLToPath(new URL('../apps/web', import.meta.url));
const pkg = JSON.parse(readFileSync(join(web, 'node_modules/e2e/package.json'), 'utf8'));
const [label = 'editor-repair', ...files] = process.argv.slice(2);
const output = join(state.evidenceDir, `${label}-${Date.now()}`);
mkdirSync(output, { recursive: true });
const result = spawnSync(process.execPath, [join(web, 'node_modules/e2e', pkg.bin.e2e), 'run', ...(files.length ? files : ['e2e/editor-repair.e2e.ts']), '--output', output, '--video', 'on', '--workers', '1'], {
  cwd: web, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, K5_E2E_URL: state.baseURL, DATABASE_URL: state.databaseUrl, E2E_EMAIL: state.account.email, E2E_PASSWORD: state.account.password, E2E_OFFICE_NAME: state.account.officeName },
});
console.log(JSON.stringify({ output, exitCode: result.status }));
process.exitCode = result.status ?? 1;
