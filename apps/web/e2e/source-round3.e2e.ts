import {expect} from 'e2e';
import {test,overflowsHorizontally} from './support/fixtures';
import {ApiSession,uniqueAccount} from './support/accounts';
import {signInWithSession} from './support/sign-in';

type Held = {method:string;body:Record<string,unknown>|null;resolve:(response:Response)=>void};
type RaceWindow = Window & {__round3Annex:{pending:Held[];restore:()=>void}};
export function installAnnexRace(caseId:string) {
  const target=window as unknown as RaceWindow,original=window.fetch.bind(window),pending:Held[]=[];
  target.__round3Annex={pending,restore:()=>{window.fetch=original;}};
  window.fetch=async (input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
    const method=init?.method ?? (input instanceof Request?input.method:'GET');
    if(url.pathname==='/api/vault/documents' && url.searchParams.get('caseId')===caseId) return Response.json({documents:['A','B'].map(letter=>({id:`race-${letter}`,name:`PDF ${letter}.pdf`,scope:'case',caseId,caseName:'Teste de seleção',folderId:null,mimeType:'application/pdf',byteSize:100,status:'ready',progress:100,errorMessage:null,extractedCharacters:100,sourceCount:0,createdAt:new Date().toISOString()})),total:2,limit:50,offset:0});
    if(url.pathname.startsWith(`/api/vault/cases/${caseId}/annexes`))return new Promise(resolve=>{pending.push({method,body:init?.body?JSON.parse(String(init.body)):null,resolve});});
    return original(input,init);
  };
  return true;
}
const plan=(scan:string,label:string)=>({planId:`plan-${label}`,scanDocumentId:`race-${scan}`,pageCount:1,items:[{label,startPage:1,endPage:1,include:true,cited:true,mention:null,fileName:'01_documento.pdf'}],uncoveredPages:[]});
export function settleAnnexRace(value:unknown) {
  const input=value as {index:number;body:unknown;status?:number};
  (window as unknown as RaceWindow).__round3Annex.pending[input.index].resolve(Response.json(input.body,{status:input.status??200}));
  return true;
}

test('anexos: A/B/A mantém a resposta, erro, busy e geração da seleção atual',async ({app,screen,browser})=>{
  const api=await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Época dos anexos'));
  const {case:record}=await api.json<{case:{id:string}}>('/api/vault/cases',{json:{name:'Anexos concorrentes'}});
  await signInWithSession({app,screen,browser},api);
  await app.open(`/app/vault/cases/${record.id}`);
  await browser.evaluate(installAnnexRace,record.id);
  await screen.getByRole('button','Mais seções do caso',{exact:true}).tap();
  await screen.getByRole('menuitem','Anexos',{exact:true}).tap();
  const select=screen.getByLabel('PDF digitalizado com os documentos');
  const count=()=>browser.evaluate(()=> (window as unknown as RaceWindow).__round3Annex.pending.length);
  const settle=(index:number,body:unknown,status=200)=>browser.evaluate(settleAnnexRace,{index,body:body as never,status});
  await select.selectOption({value:'race-A'});await expect.poll(count).toBe(1);
  await select.selectOption({value:'race-B'});await expect.poll(count).toBe(2);
  await select.selectOption({value:'race-A'});await expect.poll(count).toBe(3);
  await settle(0,{plan:plan('A','A antiga')});
  await expect(screen.getByRole('heading','Revise antes de gerar')).toHaveCount(0);
  await expect(screen.getByRole('button','Lendo as páginas…')).toBeDisabled();
  await settle(2,{plan:plan('A','A atual')});
  await settle(1,{error:'ERRO_B_OBSOLETO'},503);
  await expect(screen.getByLabel('Documento',{exact:true})).toHaveValue('A atual');
  await expect(screen.getByText('ERRO_B_OBSOLETO')).toHaveCount(0);
  await expect(screen.getByRole('button','Gerar 1 anexo')).toBeEnabled();
  await screen.getByLabel('Ou cole o texto da petição').fill('Pedido controlado com mais de cinquenta caracteres para análise dos documentos.');
  await screen.getByRole('button','Propor anexos').tap();await expect.poll(count).toBe(4);
  await select.selectOption({value:'race-B'});await expect.poll(count).toBe(5);
  await settle(3,plan('A','Análise antiga A'));
  await expect(screen.getByRole('heading','Revise antes de gerar')).toHaveCount(0);
  await settle(4,{plan:null});
  await screen.getByRole('button','Propor anexos').tap();await expect.poll(count).toBe(6);
  await settle(5,plan('B','B atual'));
  await screen.getByRole('button','Gerar 1 anexo').tap();await expect.poll(count).toBe(7);
  await select.selectOption({value:'race-A'});await expect.poll(count).toBe(8);
  await settle(6,{folderId:'obsolete',documents:[{id:'obsolete',name:'OBSOLETE_BYTES.pdf'}]});
  await expect(screen.getByRole('heading','Anexos gerados')).toHaveCount(0);
  await settle(7,{plan:plan('A','A final')});
  await screen.getByRole('button','Gerar 1 anexo').tap();await expect.poll(count).toBe(9);
  await screen.getByLabel('Pasta de destino').fill('Destino novo');
  await settle(8,{error:'ERRO_GERACAO_OBSOLETO'},503);
  await expect(screen.getByText('ERRO_GERACAO_OBSOLETO')).toHaveCount(0);
  await expect(screen.getByRole('button','Gerar 1 anexo')).toBeEnabled();
  await app.screenshot('anexos-epoca-desktop');
  await browser.setViewport({width:390,height:844});expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button','Gerar 1 anexo').focus();await browser.keyboard.press('Enter');await expect.poll(count).toBe(10);
  await settle(9,{error:'Falha atual controlada.'},503);
  await expect(screen.getByRole('alert').filter({hasText:'Falha atual controlada.'})).toContainText('Falha atual controlada.');
  await expect(screen.getByRole('button','Gerar 1 anexo')).toBeEnabled();
  await screen.getByRole('button','Gerar 1 anexo').tap();await expect.poll(count).toBe(11);
  await settle(10,{folderId:'current',documents:[{id:'current',name:'01_atual.pdf'}]});
  await expect(screen.getByRole('heading','Anexos gerados')).toBeVisible();await app.screenshot('anexos-epoca-mobile');
  await screen.getByRole('button','Separar outro PDF').tap();await expect(select).toHaveValue('');
  await expect(screen.getByRole('heading','Anexos gerados')).toHaveCount(0);
  await browser.evaluate(()=>{(window as unknown as RaceWindow).__round3Annex.restore();return true;});
});
