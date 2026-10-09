import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';
import { overflowsHorizontally } from './support/fixtures';

test('créditos da conversa usam leitura autenticada e cabem junto ao microfone', {timeout:180_000}, async ({app,screen,browser}) => {
  const api = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Créditos pessoais'));
  const other = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Outra cobrança'));
  const {conversation} = await api.json<{conversation:{id:string;title:string}}>('/api/conversations',{json:{title:'Conversa selecionada'}});
  const response = await api.request(`/api/conversation-credits?conversationId=${conversation.id}`);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('set-cookie')).toBe(null);
  const credits = await response.json() as {used:number;balance:number;trackingStartedAt:string};
  expect(credits.used).toBe(0); expect(credits.balance).toBe(500000);
  expect((await other.request(`/api/conversation-credits?conversationId=${conversation.id}`)).status).toBe(404);
  await signInWithSession({app,screen,browser},api);
  await app.open(`/app/command-center?conversationId=${conversation.id}`);
  for (const width of [1440,390,320]) {
    await browser.setViewport({width,height:900});
    await expect(browser.locator('[aria-label="Créditos usados nesta conversa: 0"]')).toBeVisible({timeout:30_000});
    await expect(browser.locator('[aria-label="Saldo de créditos: 500"]')).toBeVisible();
    const used = (await browser.locator('[aria-label="Créditos usados nesta conversa: 0"]').boundingBox())!;
    const mic = (await screen.getByRole('button','Gravar áudio',{exact:true}).boundingBox())!;
    expect(used.x+used.width).toBeLessThanOrEqual(mic.x);
    if (width < 768) { expect(mic.width).toBeGreaterThanOrEqual(44); expect(mic.height).toBeGreaterThanOrEqual(44); }
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot(`creditos-conversa-${width}`);
  }
  await browser.route('**/api/conversation-credits?**', route => route.abort());
  await browser.evaluate(() => { window.dispatchEvent(new Event('lume:credits-changed')); return null; });
  await expect(browser.locator('[aria-label="Créditos usados nesta conversa: indisponíveis"]')).toBeVisible();
  await browser.unroute('**/api/conversation-credits?**');
  await browser.evaluate(() => { window.dispatchEvent(new Event('lume:credits-changed')); return null; });
  await expect(browser.locator('[aria-label="Saldo de créditos: 500"]')).toBeVisible();
  await api.json('/api/auth/sign-out',{json:{}});
  const expired = await api.request(`/api/conversation-credits?conversationId=${conversation.id}`);
  expect(expired.status).toBe(401); expect(expired.headers.get('cache-control')).toContain('no-store');
});
