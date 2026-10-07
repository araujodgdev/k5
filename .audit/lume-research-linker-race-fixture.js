(() => {
 const originalFetch = window.fetch.bind(window);
 const caseA = '11111111-1111-4111-8111-111111111111';
 const caseB = '22222222-2222-4222-8222-222222222222';
 const profile = (id, label) => ({
  kind:'complete', caseId:id, version:1, legalQuestion:'Questão do caso '+label,
  objective:'Objetivo do caso '+label, thesis:null, documentedFacts:[],
  allegedFacts:['Fato exclusivo do caso '+label], gaps:[], documentIds:[],
  entryIds:{documentedFacts:[],allegedFacts:[label+'-fact'],gaps:[]},
  readToken:label+'-read', updatedAt:new Date().toISOString(),updatedBy:'fixture'
 });
 const state = window.__researchRace = {
  originalFetch, caseA, caseB,
  profiles:{[caseA]:profile(caseA,'A'),[caseB]:profile(caseB,'B')},pending:[],calls:[]
 };
 window.fetch = async(input,init) => {
  const url=new URL(typeof input==='string'?input:input.url,location.origin);
  const method=init?.method || input?.method || 'GET';
  if(url.pathname==='/api/vault/cases' && method==='GET')
    return Response.json({cases:[{id:caseA,name:'Caso A controlado'},{id:caseB,name:'Caso B controlado'}]});
  const match=url.pathname.match(/^\/api\/research\/cases\/([^/]+)\/(profile|references)$/);
  if(match && [caseA,caseB].includes(match[1])) {
    const [,id,kind]=match;
    if(method==='GET') return Response.json(kind==='profile'?{profile:state.profiles[id]}:{references:[]});
    if(kind==='profile' && method==='PUT') {
      const body=JSON.parse(init.body);
      state.calls.push({id,method,body});
      return new Promise(resolve=>state.pending.push({id,body,resolve}));
    }
  }
  if(url.pathname==='/api/vault/documents' && [caseA,caseB].includes(url.searchParams.get('caseId')))
    return Response.json({documents:[],total:0,limit:50,offset:0});
  return originalFetch(input,init);
 };
 state.release = () => {
  const call=state.pending.shift(); if(!call)return false;
  call.resolve(Response.json({profile:{...state.profiles[call.id],...call.body,kind:'complete',version:2}}));
  return {releasedCase:call.id};
 };
 return {cases:[caseA,caseB],productionComponent:true,heldEndpoint:'profile PUT'};
})()
