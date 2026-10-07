const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'lume-provenance-round3-freeze-complete.json'), 'utf8'));
const paths = [...new Set([...original.files.map(item => item.path), 'apps/web/src/lib/chat-status.ts'])].sort();
const files = paths.map(relative => ({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex') }));
const output = path.join(__dirname, 'lume-provenance-round3-parent-freeze.json');
if (process.argv.includes('--write')) fs.writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), basis: 'Writer111 plus parent chat-status, parsed comment cleanup, local names, annex callbacks and real input/provider APIs. No lint rule changes.', files }, null, 2));
else {
  const expected = JSON.parse(fs.readFileSync(output, 'utf8'));
  const mismatches = files.filter(file => expected.files.find(item => item.path === file.path)?.sha256 !== file.sha256);
  if (mismatches.length) throw new Error(`Freeze mismatch: ${mismatches.map(item => item.path).join(', ')}`);
}
console.log(JSON.stringify({ written: process.argv.includes('--write'), files: files.length, match: true }));
