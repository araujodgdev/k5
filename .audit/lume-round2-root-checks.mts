import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728'); assert.equal(state.port, 62541); assert.equal(state.pgPort, 62542); assert.equal(state.status, 'ready');
const command = process.argv[2]; assert.equal(command, 'typecheck');
const pnpm = 'C:/nvm4w/nodejs/node_modules/pnpm/pnpm.exe'; assert.ok(existsSync(pnpm));
const output = join(state.evidenceDir, `source-checks-${Date.now()}`); mkdirSync(output);
const log = createWriteStream(join(output, 'output.log'));
const child = spawn(pnpm, [command], { cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
  env: { ...process.env, K5_ENV_FILE: join(pointer.runDir, 'verify.env'), DATABASE_URL: state.databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', bytes => { process.stdout.write(bytes); log.write(bytes); });
child.stderr.on('data', bytes => { process.stderr.write(bytes); log.write(bytes); });
const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); log.end();
console.log(JSON.stringify({ output, command, exitCode: code })); process.exitCode = code ?? 1;
