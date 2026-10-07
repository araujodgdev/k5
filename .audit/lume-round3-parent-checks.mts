import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../apps/web/', import.meta.url));
const audit = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const steps = [
  { name: 'freeze-before', args: [audit('lume-round3-parent-freeze.cjs')] },
  { name: 'root-test', args: ['--import', 'tsx', audit('lume-round3-root-checks.mts'), 'test'] },
  { name: 'root-build', args: ['--import', 'tsx', audit('lume-round3-root-checks.mts'), 'build'] },
  { name: 'affected-e2e', args: ['--import', 'tsx', audit('lume-source-checks.mts'), 'e2e',
    'e2e/annex-plan.e2e.ts', 'e2e/app-shell.e2e.ts', 'e2e/case-pages.e2e.ts',
    'e2e/client-portal.e2e.ts', 'e2e/document-saving.e2e.ts', 'e2e/editor-repair.e2e.ts',
    'e2e/lume-shell.e2e.ts', 'e2e/private-chat-readiness.e2e.ts', 'e2e/source-policy.e2e.ts',
    'e2e/vault-pagination.e2e.ts', 'e2e/workspace.e2e.ts', 'e2e/source-round3.e2e.ts',
    'e2e/research-source-round3.e2e.ts', 'e2e/agent-settings.e2e.ts'] },
  { name: 'freeze-after', args: [audit('lume-round3-parent-freeze.cjs')] },
];
const state: { pid: number; startedAt: string; active: string | null; results: Array<{ name: string; exitCode: number; finishedAt: string }> } = {
  pid: process.pid, startedAt: new Date().toISOString(), active: null, results: [],
};
const save = () => writeFileSync(audit('lume-round3-parent-checks-state.json'), JSON.stringify(state, null, 2));
for (const step of steps) {
  state.active = step.name;
  save();
  const child = spawn(process.execPath, step.args, { cwd: app, windowsHide: true, stdio: 'inherit' });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  state.results.push({ name: step.name, exitCode, finishedAt: new Date().toISOString() });
  state.active = null;
  save();
  if (exitCode !== 0) { process.exitCode = exitCode; break; }
}
console.log(JSON.stringify(state));
