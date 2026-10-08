import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, admin, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';

describe('busca do escritório', {session:'admin'}, () => {
  test('abre associado, caso, tarefa e os três tipos de documento pela busca', {timeout:240_000}, async ({app,screen,browser}) => {
    const api = await new ApiSession(app.baseUrl!).signIn(admin);
    const prefix = `Busca ${Date.now()}`;
    const associateAccount = {...uniqueAccount('Associado da busca'),name:prefix+' associado'};
    const associate = await new ApiSession(app.baseUrl!).signIn(associateAccount);
    const invitation = await api.json<{id:string}>('/api/collaboration',{json:{action:'invite',invitation:{email:associateAccount.email}}});
    await associate.json('/api/collaboration',{json:{action:'respond',id:invitation.id,accept:true}});
    const {case:record} = await api.json<{case:{id:string;name:string}}>('/api/vault/cases',{json:{name:prefix+' caso'}});
    const {activity} = await api.json<{activity:{id:string;title:string}}>('/api/agenda/activities/create',{json:{kind:'task',title:prefix+' tarefa',idempotencyKey:crypto.randomUUID()}});
    const {page} = await api.json<{page:{id:string;title:string}}>(`/api/cases/${record.id}/pages`,{json:{title:prefix+' página',content:'Conteúdo da página encontrado pela busca.'}});
    const {artifact} = await api.json<{artifact:{id:string;title:string}}>('/api/artifacts',{json:{title:prefix+' minuta',content:'Texto privado encontrado pela busca.'}});
    const form = new FormData();
    form.set('file',new File(['Texto do arquivo encontrado pela busca.'],prefix+' arquivo.txt',{type:'text/plain'}));
    form.set('scope','case'); form.set('caseId',record.id);
    const uploaded = await api.request('/api/vault/documents',{form});
    expect(uploaded.status).toBe(201);
    const {document:file} = await uploaded.json() as {document:{id:string;name:string}};
    const {hits} = await api.json<{hits:{kind:string;id:string;label:string;href:string}[]}>('/api/search?q='+encodeURIComponent(prefix));
    expect([...new Set(hits.map(hit=>hit.kind))].sort()).toEqual(['associate','case','document','task']);
    const associatedHits = await associate.json<{hits:{kind:string}[]}>('/api/search?q='+encodeURIComponent(prefix));
    expect(associatedHits.hits).toEqual([]);
    await browser.setViewport({width:1440,height:900});
    await app.open('/app/calc');
    for (const label of [associateAccount.name,record.name,activity.title,page.title,artifact.title,file.name]) {
      const hit = hits.find(hit=>hit.label===label)!;
      expect(hit).toBeDefined();
      expect((await api.request(hit.href)).status).toBe(200);
      await browser.keyboard.press('Control+k');
      await screen.getByRole('combobox','Buscar casos, módulos e abas').fill(label);
      await expect(screen.getByRole('group','Resultados do escritório').getByRole('option',label,{exact:true})).toBeVisible();
      await browser.keyboard.press('ArrowDown');
      await browser.keyboard.press('Enter');
      const destination = new URL(hit.href,app.baseUrl);
      destination.searchParams.sort();
      await expect(browser).toHaveURL(destination.pathname+destination.search);
      if (hit.kind==='associate') await expect(browser.locator('#associate-'+hit.id)).toBeFocused();
      else if (hit.id===page.id || hit.id===artifact.id) await expect(screen.getByRole('textbox','Texto do documento',{exact:true})).toBeVisible();
      else await expect(screen.getByRole('heading',label,{exact:true})).toBeVisible();
      await app.screenshot('busca-destino-'+hit.kind+'-'+hit.id);
    }
    let release!:()=>void, requested!:()=>void;
    const held = new Promise<void>(resolve=>{release=resolve;});
    const started = new Promise<void>(resolve=>{requested=resolve;});
    await browser.route('**/api/search?*',async route=>{
      if (new URL(route.request.url).searchParams.get('q')!==record.name) return route.continue();
      requested(); await held; return route.continue();
    });
    await browser.keyboard.press('Control+k');
    const input = screen.getByRole('combobox','Buscar casos, módulos e abas');
    await input.fill(record.name); await started;
    await input.fill(artifact.title);
    await expect(screen.getByRole('group','Resultados do escritório').getByRole('option',artifact.title,{exact:true})).toBeVisible();
    release();
    await expect(screen.getByRole('group','Resultados do escritório').getByRole('option',record.name,{exact:true})).toHaveCount(0);
    await browser.unroute('**/api/search?*');
    await input.fill(prefix+' inexistente');
    await expect(screen.getByRole('status').filter({hasText:'Nenhum resultado no escritório.'})).toBeVisible();
    await browser.route('**/api/search?*',route=>route.abort());
    await input.fill('Tarefas');
    await expect(screen.getByRole('status').filter({hasText:'Não foi possível buscar.'})).toBeVisible();
    await expect(screen.getByRole('group','Módulos e conta').getByRole('option','Tarefas',{exact:true})).toBeVisible();
    await browser.unroute('**/api/search?*');
  });
  test('encontra cliente real, abre sua ficha e não expõe outra conta', async ({app,screen,browser}) => {
    if (!app.baseUrl) throw new Error('Servidor isolado obrigatório.');
    const api = await new ApiSession(app.baseUrl).signIn(admin);
    const other = await new ApiSession(app.baseUrl).signIn(uniqueAccount('Busca externa'));
    const name = `Busca integrada ${Date.now()}`;
    const created = await api.json('/api/agenda/clients/create',{method:'POST',json:{name,idempotencyKey:crypto.randomUUID()}}) as {client:{id:string}};
    const hidden = await other.json('/api/search?q='+encodeURIComponent(name)) as {hits:unknown[]};
    expect(hidden.hits).toEqual([]);
    const result = await api.json('/api/search?q='+encodeURIComponent(name)) as {hits:{kind:string;id:string;href:string}[]};
    expect(result.hits).toEqual([{kind:'client',id:created.client.id,label:name,href:`/app/agenda/clients/${created.client.id}`}]);
    expect((await api.request(`/app/agenda/clients/${created.client.id}`)).status).toBe(200);
    for (const width of [1440,390]) {
      await browser.setViewport({width,height:900});
      await app.open('/app/calc');
      await expect(screen.getByRole('heading',/^Cálculos/)).toBeVisible({timeout:30_000});
      await browser.keyboard.press('Control+k');
      await screen.getByRole('combobox','Buscar casos, módulos e abas',{exact:true}).fill(name);
      await screen.getByRole('option',name,{exact:true}).tap();
      await expect(browser).toHaveURL(`/app/agenda/clients/${created.client.id}`, {timeout:30_000});
      await expect(screen.getByRole('heading',name,{exact:true})).toBeVisible({timeout:30_000});
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`busca-cliente-${width}`);
    }
  });
});
