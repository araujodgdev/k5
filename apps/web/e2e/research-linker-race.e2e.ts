import { spawn } from 'node:child_process';
import { expect } from 'e2e';
import { test, overflowsHorizontally } from './support/fixtures';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';

type HeldProfileResponse = { ready: boolean; release: () => void; path: string; method: string; fail: boolean; delivered: boolean };
declare global { interface Window { __profileResponse: HeldProfileResponse } }

test('resposta de perfil do caso anterior não substitui o caso selecionado', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Troca de caso');
  const api = await new ApiSession(app.baseUrl!).signIn(account);
  const cases: { id: string; name: string }[] = [];
  for (const label of ['A', 'B', 'Material']) {
    const { case: record } = await api.json<{ case: { id: string; name: string } }>('/api/vault/cases', { json: { name: `Caso ${label} controlado` } });
    await api.json(`/api/research/cases/${record.id}/profile`, { method: 'PUT', json: {
      caseId: record.id, expectedVersion: 0, legalQuestion: `Questão do caso ${label}`,
      objective: `Objetivo do caso ${label}`, thesis: null, documentedFacts: [],
      allegedFacts: [`Fato exclusivo do caso ${label}`], gaps: [], documentIds: [],
    } });
    cases.push(record);
  }
  const fixture = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'e2e/support/research-profile-fixture.mts', 'legacy', account.email, cases[2].id, ''], { windowsHide: true, env: process.env });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(error)));
  });
  const { judgmentId } = JSON.parse(fixture) as { judgmentId: string };
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','e2e/support/research-material-fixture.mts',account.email,cases[2].id,judgmentId],{windowsHide:true,env:process.env});
    let error='';child.stderr.on('data',chunk=>{error+=chunk;});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(error)));
  });
  await signInWithSession({ app, screen, browser }, api);
  await app.open(`/app/research/judgments/${judgmentId}`);
  await browser.evaluate((caseId: string) => {
    const original = window.fetch.bind(window);
    const state: HeldProfileResponse = { ready: false, release: () => {}, path: `/api/research/cases/${caseId}/profile`, method:'PUT', fail:false, delivered:false };
    window.__profileResponse = state;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
      if (url.pathname === state.path && init?.method === state.method) {
        state.ready = true;
        await new Promise<void>(resolve => { state.release = resolve; });
        state.delivered=true;
        if(state.fail) throw new Error('Resposta tardia controlada');
      }
      return response;
    };
    return null;
  }, cases[0].id);
  await screen.getByRole('button', 'Adicionar ao caso', { exact: true }).tap();
  await screen.getByRole('button', 'Caso A controlado', { exact: true }).tap();
  const question = screen.getByLabel('Questão jurídica', { exact: true });
  await expect(question).toHaveValue('Questão do caso A');
  await question.fill('Questão revisada do caso A');
  await screen.getByRole('button', 'Salvar e revisar perfil', { exact: true }).tap();
  await expect.poll(() => browser.evaluate(() => window.__profileResponse.ready)).toBe(true);
  await screen.getByRole('button', 'Caso B controlado', { exact: true }).tap();
  await expect(question).toHaveValue('Questão do caso B');
  await app.screenshot('caso-b-antes-da-resposta-a');
  await browser.evaluate(async () => {
    window.__profileResponse.release();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return null;
  });
  await expect(screen.getByRole('button', 'Salvar e revisar perfil', { exact: true })).toBeEnabled();
  await app.screenshot('caso-b-apos-resposta-a');
  expect(await sql('SELECT legal_question FROM research_case_profile WHERE case_id=$1', [cases[0].id])).toMatchObject([{ legal_question: 'Questão revisada do caso A' }]);
  expect(await sql('SELECT legal_question FROM research_case_profile WHERE case_id=$1', [cases[1].id])).toMatchObject([{ legal_question: 'Questão do caso B' }]);
  await expect(question).toHaveValue('Questão do caso B');
  await expect(screen.getByRole('button', 'Avaliar pertinência', { exact: true })).toBeDisabled();

  const hold = async (caseId:string,suffix:string,method:string,fail=false)=>browser.evaluate(({caseId,suffix,method,fail}:{caseId:string;suffix:string;method:string;fail:boolean})=>{
    const state=window.__profileResponse;state.path=`/api/research/cases/${caseId}/${suffix}`;state.method=method;state.fail=fail;state.ready=false;state.delivered=false;
    return null;
  },{caseId,suffix,method,fail});
  const release = async()=>{
    await browser.evaluate(()=>{window.__profileResponse.release();return null;});
    await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.delivered)).toBe(true);
    await browser.evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));return null;});
  };
  await hold(cases[0].id,'profile','PUT',true);
  await screen.getByRole('button','Caso A controlado',{exact:true}).tap();
  await expect(question).toHaveValue('Questão revisada do caso A');
  await question.fill('Questão salva com erro tardio A');
  await screen.getByRole('button','Salvar e revisar perfil',{exact:true}).tap();
  await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.ready)).toBe(true);
  await screen.getByRole('button','Caso B controlado',{exact:true}).tap();await expect(question).toHaveValue('Questão do caso B');
  await release();await expect(screen.getByRole('alert')).toHaveCount(0);
  await expect(question).toHaveValue('Questão do caso B');

  await screen.getByRole('button','Caso A controlado',{exact:true}).tap();await expect(question).toHaveValue('Questão salva com erro tardio A');
  await screen.getByRole('button','Salvar e revisar perfil',{exact:true}).tap();
  await hold(cases[0].id,'assessments','POST');
  await screen.getByRole('button','Avaliar pertinência',{exact:true}).tap();
  await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.ready)).toBe(true);
  await screen.getByRole('radio','Ementa',{exact:true}).tap();
  await expect(screen.getByRole('button','Salvar e revisar perfil',{exact:true})).toBeEnabled();
  await release();await expect(screen.getByText('A avaliação está desligada para este escritório.',{exact:true})).toHaveCount(0);
  await expect(screen.getByRole('button','Adicionar sem avaliação',{exact:true})).toHaveCount(0);

  await hold(cases[0].id,'assessments','POST');
  await screen.getByRole('button','Salvar e revisar perfil',{exact:true}).tap();
  await screen.getByRole('button','Avaliar pertinência',{exact:true}).tap();
  await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.ready)).toBe(true);
  await screen.getByRole('button','Caso B controlado',{exact:true}).tap();await expect(question).toHaveValue('Questão do caso B');
  await release();await expect(screen.getByRole('button','Adicionar sem avaliação',{exact:true})).toHaveCount(0);

  await browser.setViewport({width:390,height:844});expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button','Caso A controlado',{exact:true}).focus();await browser.keyboard.press('Enter');
  await expect(question).toHaveValue('Questão salva com erro tardio A');
  await hold(cases[1].id,'profile','PUT');
  await screen.getByRole('button','Salvar e revisar perfil',{exact:true}).focus();await browser.keyboard.press('Enter');
  await screen.getByRole('button','Avaliar pertinência',{exact:true}).tap();
  await expect(screen.getByRole('button','Adicionar sem avaliação',{exact:true})).toBeVisible();
  await hold(cases[0].id,'references','POST');
  await screen.getByRole('button','Adicionar sem avaliação',{exact:true}).tap();
  await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.ready)).toBe(true);
  await screen.getByRole('button','Caso B controlado',{exact:true}).tap();await expect(question).toHaveValue('Questão do caso B');
  await release();await expect(screen.getByText('Esta versão já está vinculada.',{exact:false})).toHaveCount(0);
  expect(await sql('SELECT case_id FROM research_case_reference WHERE case_id=ANY($1::text[])',[cases.slice(0,2).map(record=>record.id)])).toEqual([{case_id:cases[0].id}]);
  await app.screenshot('linker-mobile-referencia-anterior-ignorada');
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await question.fill('Rascunho particular do caso B');
  await hold(cases[0].id,'profile','GET',true);
  await screen.getByRole('button','Caso A controlado',{exact:true}).tap();
  await expect.poll(()=>browser.evaluate(()=>window.__profileResponse.ready)).toBe(true);
  await release();
  await expect(screen.getByRole('alert')).toBeVisible();
  await expect(question).toHaveValue('');
  await screen.getByRole('button','Caso B controlado',{exact:true}).tap();
  await expect(question).toHaveValue('Rascunho particular do caso B');
  await app.screenshot('linker-perfil-falhou-sem-rascunho-anterior');
});
