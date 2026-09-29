import {writeFile} from 'node:fs/promises';
const base='https://juliapesquisa.trf5.jus.br/julia-pesquisa/';
const p=new URLSearchParams({pesquisaLivre:'',numeroProcesso:'',orgaoJulgador:'',relator:'',dataIni:'01/09/2026',dataFim:'28/09/2026',draw:'1',start:'0',length:'10'});
const url=base+'api/v1/documento:dt/G2?'+p;
try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const t=await r.text();await writeFile('output/jurisprudencia/trf5/search-response.json',t);console.log(JSON.stringify({url,status:r.status,contentType:r.headers.get('content-type'),body:t.slice(0,1800)}));}catch(e){console.log(JSON.stringify({error:e.message}));}
