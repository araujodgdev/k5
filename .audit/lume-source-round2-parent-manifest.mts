import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const inventoryUrl = new URL('./lume-provenance-files.json', import.meta.url);
const inventory = JSON.parse(readFileSync(inventoryUrl,'utf8'));
const paths = [...new Set([...inventory.round2.frozenFiles.map((file: {path:string})=>file.path), 'apps/web/src/lib/annexes-contract.ts'])].sort();
const files = paths.map((path:string)=>({path,sha256:createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex')}));
const target = new URL('./lume-source-round2-parent-freeze.json',import.meta.url);
if (process.argv[2]==='freeze') {
  writeFileSync(target,JSON.stringify({at:new Date().toISOString(),files},null,2)+'\n');
  inventory.round2.parentReview = { notes: '.audit/lume-provenance-round2-parent.md', commentReport: '.audit/lume-provenance-round2-comments.md',
    changedProduction: ['apps/web/src/lib/annexes.ts','apps/web/src/lib/annexes-contract.ts'], commentsAndMechanicalNames:true,
    freeze: '.audit/lume-source-round2-parent-freeze.json', files: files.length, status:'independent acceptance and current checks pending',
    proof: {negative:'source-test-1791356158582', positive:'source-test-1791356417604', positiveTests:18} };
  writeFileSync(inventoryUrl,JSON.stringify(inventory,null,2)+'\n');
} else assert.deepEqual(files,JSON.parse(readFileSync(target,'utf8')).files,'Parent-frozen application and helper files changed');
console.log(JSON.stringify({files:files.length,mode:process.argv[2]==='freeze'?'frozen':'verified'}));

