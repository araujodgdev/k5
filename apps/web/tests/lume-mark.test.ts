import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LUME_MARK } from '../src/components/lume-mark';

// These files are served without the app's code, so each carries a copy of the mark's halves.
for (const file of ['public/lume.svg', 'public/offline.html', 'src/app/icon.svg']) {
  test(`${file} draws the halves of the Lume mark`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const paths = [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(paths, [...LUME_MARK.halves]);
  });
}
