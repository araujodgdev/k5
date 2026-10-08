import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, admin } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';

const project = () => promisify(execFile)(process.execPath,
  ['--conditions=react-server','--import','tsx','e2e/support/project-notifications.mts'],
  { timeout:120_000, windowsHide:true });

test('uma leitura anterior não repõe notificações excluídas e uma chegada posterior permanece', {timeout:180_000}, async ({app,screen,browser}) => {
  const api = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Notificações concorrentes'));
  const upload = async (name:string) => {
    const form = new FormData();
    form.set('file',new File(['Documento da prova de notificações.'],name,{type:'text/plain'}));
    form.set('scope','library');
    expect((await api.request('/api/vault/documents',{form})).status).toBe(201);
    await project();
  };
  await upload('notificação anterior.txt');
  await expect.poll(async () => {
    await project();
    return (await api.json<{notifications:unknown[]}>('/api/notifications?unreadOnly=true')).notifications.length;
  },{timeout:60_000}).toBeGreaterThan(0);
  const before = await api.json<{notifications:{id:string}[]}>('/api/notifications?unreadOnly=true');
  expect(before.notifications.length).toBeGreaterThan(0);
  await signInWithSession({app,screen,browser},api);
  await app.open('/app/vault');
  await browser.evaluate(() => {
    const original = window.fetch.bind(window);
    let release = () => {};
    const held = new Promise<void>(resolve => {release=resolve;});
    const proof = {read:false,release};
    Reflect.set(window,'notificationReadProof',proof);
    window.fetch = async (input,init) => {
      const url = new URL(input instanceof Request ? input.url : String(input),location.href);
      const response = await original(input,init);
      if (url.pathname==='/api/notifications' && (init?.method??'GET')==='GET' && !proof.read) {
        proof.read=true;
        await held;
      }
      return response;
    };
    return null;
  });
  await screen.getByRole('button',/^Notificações/).tap();
  await expect.poll(() => browser.evaluate(() => Reflect.get(window,'notificationReadProof').read as boolean)).toBe(true);
  await screen.getByRole('button','Excluir todas',{exact:true}).tap();
  await screen.getByRole('alertdialog').getByRole('button','Excluir todas',{exact:true}).tap();
  await expect(screen.getByText('Nada novo por aqui.',{exact:true})).toBeVisible();
  expect((await api.json<{notifications:unknown[]}>('/api/notifications?unreadOnly=true')).notifications).toEqual([]);
  await browser.evaluate(() => { Reflect.get(window,'notificationReadProof').release(); return null; });
  await expect(screen.getByRole('heading','Processamento concluído',{exact:true})).toHaveCount(0);
  await browser.keyboard.press('Escape');
  await upload('notificação posterior.txt');
  const after = await api.json<{notifications:{id:string}[]}>('/api/notifications?unreadOnly=true');
  expect(after.notifications.length).toBeGreaterThan(0);
  expect(after.notifications.some(item=>before.notifications.some(old=>old.id===item.id))).toBe(false);
  await screen.getByRole('button',/^Notificações/).tap();
  await expect(screen.getByRole('heading','Processamento concluído',{exact:true})).toBeVisible();
});

describe('notificações pessoais', { session:'admin' }, () => {
  test('excluir todas exige confirmação nas duas abas e mantém foco e geometria', async ({ app, screen, browser }) => {
    if (!app.baseUrl) throw new Error('Servidor isolado obrigatório.');
    const api = await new ApiSession(app.baseUrl).signIn(admin);
    expect((await api.request('/api/notifications', {method:'DELETE',origin:'https://foreign.test'})).status).toBe(403);
    await app.open('/app/vault');
    for (const width of [1440,390]) {
      await browser.setViewport({width,height:900});
      if (width < 768) await screen.getByRole('button',/^Mais opções(?:,|$)/).tap();
      await screen.getByRole('button',/^Notificações/).tap();
      const dialog = screen.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      if (width >= 768) { expect(box.y).toBe(56); expect(Math.abs(box.x+box.width-(width-12))).toBeLessThan(2); }
      else { expect(box.x).toBe(12); expect(box.y+box.height).toBeLessThanOrEqual(888); }
      for (const tab of ['Novas','Arquivadas']) {
        await screen.getByRole('button',tab,{exact:true}).tap();
        await screen.getByRole('button','Excluir todas',{exact:true}).tap();
        await expect(screen.getByRole('alertdialog')).toBeVisible();
        await screen.getByRole('button','Cancelar',{exact:true}).tap();
        await expect(screen.getByRole('alertdialog')).not.toBeVisible();
        await screen.getByRole('button','Excluir todas',{exact:true}).tap();
        await screen.getByRole('alertdialog').getByRole('button','Excluir todas',{exact:true}).tap();
        await expect(screen.getByRole('button','Excluir todas',{exact:true})).toBeEnabled();
      }
      expect(await api.json<{unread:number}>('/api/notifications/count')).toEqual({unread:0});
      expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
      await app.screenshot(`notificacoes-ancoradas-${width}`);
      await browser.keyboard.press('Escape');
      if (width >= 768) await expect(screen.getByRole('button', /^Notificações/)).toBeFocused();
      else await expect(screen.getByRole('button', /^Mais opções(?:,|$)/)).toBeFocused();
    }
  });
});
