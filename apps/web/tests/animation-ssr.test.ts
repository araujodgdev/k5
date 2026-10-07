import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const component of ['app-sidebar']) {
  test(`${component} can be imported for SSR without starting animation timers`, () => {
    // Workers reject timers during module initialization. A fresh process makes the import cold, so
    // a timer the module starts on load is never masked by one an earlier import already started.
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
      globalThis.setTimeout = () => { throw new Error('Animation timer started during SSR import'); };
      await import('./src/components/${component}.tsx');
    `], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
