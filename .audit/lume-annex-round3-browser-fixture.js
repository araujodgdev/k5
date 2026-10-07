(() => {
 const originalFetch = window.fetch.bind(window);
 const caseId = "041de192-96ac-4594-9d49-40e5c59a2ac8";
 const docs = ["A", "B"].map(letter=>({id:"annex-race-"+letter,name:"PDF "+letter+".pdf",scope:"case",caseId,caseName:"Contexto B",folderId:null,mimeType:"application/pdf",byteSize:100,status:"ready",progress:100,errorMessage:null,extractedCharacters:100,sourceCount:0,createdAt:new Date().toISOString()}));
 const state = window.__annexRace = {calls:[],pending:[],originalFetch};
 window.fetch = async (input,init) => {
   const url = new URL(typeof input==="string"?input:input.url,location.origin);
   const method = init?.method || input?.method || "GET";
   if(url.pathname==="/api/vault/documents" && url.searchParams.get("caseId")===caseId) return Response.json({documents:docs,total:2,limit:50,offset:0});
   if(url.pathname==="/api/vault/cases/"+caseId+"/annexes") {
     state.calls.push({method,url:url.pathname+url.search,body:init?.body??null});
     if(method==="GET") return Response.json({plan:null});
     const body=JSON.parse(init.body);
     return new Promise(resolve=>{state.pending.push({body,resolve});});
   }
   return originalFetch(input,init);
 };
 return {mockedDocuments:docs.map(x=>({id:x.id,name:x.name})),heldEndpoint:"annexes POST",productionComponent:true};
})()
