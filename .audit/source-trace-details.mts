import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const zip=new (require('pizzip'))(readFileSync(process.argv[2]));
for(const [name,entry] of Object.entries(zip.files) as [string,{asText():string}][]){
 if(!name.endsWith('.trace'))continue;
 for(const line of entry.asText().split('\n').filter(Boolean)){
  const e=JSON.parse(line);
  if(e.type==='console'||e.type==='after' && e.error||e.type==='before' && /fill|goto/.test(e.method))console.log(JSON.stringify(e));
 }
}
