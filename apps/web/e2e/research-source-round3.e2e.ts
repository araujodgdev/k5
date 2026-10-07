import {spawn} from 'node:child_process';
import {expect} from 'e2e';
import {test,overflowsHorizontally} from './support/fixtures';
import {ApiSession,uniqueAccount} from './support/accounts';
import {signInWithSession} from './support/sign-in';
import {setConversationMessages} from './support/seed';

async function fixture(mode:string,email:string,caseId:string,conversationId:string) {
 const output=await new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','e2e/support/research-profile-fixture.mts',mode,email,caseId,conversationId],{windowsHide:true,env:process.env});let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(Error(stderr)));});
 return JSON.parse(output.trim()) as {approvalId:string;providerEntries:number;judgmentId:string;referenceId:string};
}
test('perfil e anotação restritos preservam bytes; conteúdo preparado tem uma revisão exata',async({app,screen,browser,sql})=>{
 const account=uniqueAccount('Perfil admitido'),api=await new ApiSession(app.baseUrl!).signIn(account);
 const {case:record}=await api.json<{case:{id:string}}>('/api/vault/cases',{json:{name:'Perfil e notas restritos'}});
 const {conversation}=await api.json<{conversation:{id:string}}>('/api/conversations',{json:{}});
 const prepared=await fixture('prepare',account.email,record.id,conversation.id);expect(prepared.providerEntries).toBe(1);
 await setConversationMessages(account.email,conversation.id,[{id:'profile-review',role:'assistant',parts:[{type:'data-approval',data:{approvalId:prepared.approvalId,capability:'k5_research_save_profile',preparedContent:true,summary:'RAW_PLANNER_PREVIEW',state:'pending'}}]}]);
 await signInWithSession({app,screen,browser},api);await app.open('/app/command-center?lume=1');
 await expect(screen.getByText('Questão jurídica: Questão exata preparada para revisão.',{exact:false})).toBeVisible({timeout:60_000});
 await expect(screen.getByText('RAW_PLANNER_PREVIEW')).toHaveCount(0);
 await expect(screen.getByRole('group','Confirmação')).toHaveCount(1);
 await app.screenshot('perfil-proposta-desktop');await browser.setViewport({width:390,height:844});expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
 const confirm=screen.getByRole('button','Confirmar',{exact:true});await confirm.focus();await browser.keyboard.press('Enter');
 await expect(screen.getByText('Confirmado',{exact:false})).toBeVisible();
 expect(await sql('SELECT status FROM capability_approval WHERE id=$1',[prepared.approvalId])).toMatchObject([{status:'consumed'}]);
 expect(await sql('SELECT version::int,legal_question FROM research_case_profile WHERE case_id=$1',[record.id])).toMatchObject([{version:1,legal_question:'Questão exata preparada para revisão.'}]);
 const legacy=await fixture('legacy',account.email,record.id,conversation.id);
 await api.json(`/api/research/cases/${record.id}/profile`);
 await api.json(`/api/research/cases/${record.id}/references`);
 expect((await api.request(`/api/research/references/${legacy.referenceId}`,{method:'OPTIONS'})).status).toBe(204);
 await api.json(`/api/vault/documents?caseId=${record.id}&scope=case&limit=50`);
 await app.open(`/app/research/judgments/${legacy.judgmentId}`);await screen.getByRole('button','Adicionar ao caso',{exact:true}).tap();await screen.getByRole('button','Perfil e notas restritos',{exact:true}).tap();
 await expect(screen.getByText('Parte do perfil está restrita.',{exact:false})).toBeVisible();await expect(screen.getByLabel('Questão jurídica',{exact:true})).toBeDisabled();await expect(screen.getByLabel('Questão jurídica',{exact:true})).toHaveValue('');
 await expect(screen.getByText('Fato exato preparado.',{exact:true})).toHaveCount(0);
 await screen.getByRole('group','Fatos alegados').getByRole('button','Adicionar',{exact:true}).tap();await screen.getByLabel('Fatos alegados 1',{exact:true}).fill('Nova contribuição independente.');
 await screen.getByRole('button','Salvar e revisar perfil',{exact:true}).tap();await expect(screen.getByText('Perfil salvo.',{exact:false})).toBeVisible();
 const rows=await sql<{legal_question:string;alleged_facts_json:string}>('SELECT legal_question,alleged_facts_json FROM research_case_profile WHERE case_id=$1',[record.id]);
 expect(rows[0].legal_question).toBe('Questão exata preparada para revisão.');expect(JSON.parse(rows[0].alleged_facts_json).sort()).toEqual(['Fato exato preparado.','Nova contribuição independente.'].sort());
 await app.screenshot('perfil-restrito-mobile');await app.open(`/app/vault/cases/${record.id}?section=references`);
 await expect(screen.getByText('Anotação restrita.',{exact:false})).toBeVisible();await expect(screen.getByText('UNKNOWN_LEGACY_NOTES')).toHaveCount(0);
 await screen.getByRole('button','Editar anotação e finalidade').tap();await expect(screen.getByLabel('Anotação do caso',{exact:true})).toBeDisabled();await screen.getByLabel('Finalidade',{exact:true}).selectOption({value:'counterpoint'});
 await screen.getByRole('button','Salvar referência',{exact:true}).tap();await expect(screen.getByRole('button','Editar anotação e finalidade')).toBeVisible();
 expect(await sql('SELECT notes,purpose FROM research_case_reference WHERE id=$1',[legacy.referenceId])).toMatchObject([{notes:'UNKNOWN_LEGACY_NOTES',purpose:'counterpoint'}]);await app.screenshot('anotacao-restrita-mobile');
});
