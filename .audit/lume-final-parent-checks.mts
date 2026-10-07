import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../apps/web/', import.meta.url));
const audit = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const e2e = ['agent-settings', 'annex-plan', 'app-shell', 'case-collaboration', 'case-pages',
  'client-portal', 'collaboration', 'document-saving', 'editor-repair', 'honorarios',
  'legal-acceptance', 'lume-composition', 'lume-shell', 'onboarding', 'private-chat-readiness',
  'profile', 'pwa', 'research-linker-race', 'research-source-round3', 'source-policy',
  'source-round3', 'vault-pagination', 'workspace'].map(name => `e2e/${name}.e2e.ts`);
for (const file of e2e) if (!existsSync(`${app}/${file}`)) throw new Error(`Missing ${file}`);
const steps = [
  ...['lint', 'typecheck', 'test', 'build'].map(name => ({ name: `root-${name}`, args: ['--import', 'tsx', audit('lume-round3-root-checks.mts'), name] })),
  { name: 'affected-e2e', args: ['--import', 'tsx', audit('lume-source-checks.mts'), 'e2e', ...e2e] },
];
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice('--from='.length);
const first = from ? steps.findIndex(step => step.name === from) : 0;
if (first < 0) throw new Error('Unknown starting check');
const selected = steps.slice(first);
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ steps: selected }, null, 2));
} else {
  if (existsSync(audit('lume-final-parent-checks-state.json'))) copyFileSync(audit('lume-final-parent-checks-state.json'), audit(`lume-final-parent-checks-prior-${Date.now()}.json`));
  writeFileSync(audit('lume-final-source-status.txt'), execFileSync('git', ['status', '--short'], { cwd: app }));
  const state: { pid: number; startedAt: string; active: string | null; childPid: number | null; results: Array<{ name: string; exitCode: number; finishedAt: string }> } = {
    pid: process.pid, startedAt: new Date().toISOString(), active: null, childPid: null, results: [],
  };
  const save = () => writeFileSync(audit('lume-final-parent-checks-state.json'), JSON.stringify(state, null, 2));
  for (const step of selected) {
    state.active = step.name;
    save();
    const child = spawn(process.execPath, step.args, { cwd: app, windowsHide: true, stdio: 'inherit' });
    state.childPid = child.pid ?? null;
    save();
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    state.results.push({ name: step.name, exitCode, finishedAt: new Date().toISOString() });
    state.active = null;
    state.childPid = null;
    save();
    if (exitCode !== 0) { process.exitCode = exitCode; break; }
  }
  console.log(JSON.stringify(state));
}
