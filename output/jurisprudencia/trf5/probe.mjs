import {writeFile} from 'node:fs/promises';
const url='https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa';
try { const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const t=await r.text();await writeFile('output/jurisprudencia/trf5/portal.html',t);console.log(JSON.stringify({status:r.status,bytes:t.length,scripts:[...t.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(x=>x[1]),forms:[...t.matchAll(/<form[^>]*>/g)].map(x=>x[0])})); }catch(e){console.log(JSON.stringify({error:e.message,cause:e.cause?.code}));}
