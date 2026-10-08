import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, admin, uniqueAccount } from './support/accounts';
import { overflowsHorizontally } from './support/fixtures';

function renderedContrast() {
  const probe = document.createElement('span');
  probe.style.display = 'none'; document.body.append(probe);
  const luminance = (token:string) => {
    probe.style.color = `var(${token})`;
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=> {
      const channel=value/255; return channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4;
    });
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const contrast = (foreground:string,background:string) => {
    const values=[luminance(foreground),luminance(background)].sort((a,b)=>a-b);
    return (values[1]+.05)/(values[0]+.05);
  };
  const result = {brand:contrast('--brand-foreground','--brand'),ink:contrast('--brand-ink','--background')};
  probe.remove(); return result;
}

describe('cor pessoal do escritório', { session: 'admin' }, () => {
  test('salva nas duas superfícies, mantém a cor neutra e isola outra conta', async ({ app, browser, screen }) => {
    if (!app.baseUrl) throw new Error('A prova exige o servidor isolado.');
    const api = await new ApiSession(app.baseUrl).signIn(admin);
    const other = await new ApiSession(app.baseUrl).signIn(uniqueAccount('Outra aparência'));
    await api.json('/api/profile/appearance', { method: 'PATCH', json: { accent: 'orange' } });
    await browser.setViewport({ width: 1440, height: 900 });
    await app.open('/app/calc');
    const neutral = await browser.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'));
    await screen.getByRole('button', /^Conta de /).tap();
    await screen.getByRole('menuitemradio', 'Azul', { exact: true }).tap();
    await expect(screen.getByRole('menuitemradio', 'Azul', { exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(screen.getByRole('menuitemradio', 'Azul', { exact: true })).toBeEnabled();
    expect(await api.json<{accent:string}>('/api/profile/appearance')).toEqual({ accent: 'blue' });
    expect(await other.json<{accent:string}>('/api/profile/appearance')).toEqual({ accent: 'orange' });
    await browser.route('**/api/profile/appearance', route => route.request.method === 'PATCH' ? route.abort() : route.continue());
    await screen.getByRole('menuitemradio','Verde',{exact:true}).tap();
    await expect(screen.getByRole('alert').filter({hasText:'Não foi possível salvar sua cor'})).toBeVisible();
    await expect(screen.getByRole('menuitemradio','Azul',{exact:true})).toHaveAttribute('aria-checked','true');
    await browser.unroute('**/api/profile/appearance');
    expect((await api.request('/api/profile/appearance', { method: 'PATCH', json: { accent: 'red' } })).status).toBe(400);
    expect((await api.request('/api/profile/appearance', { method: 'PATCH', json: { accent: 'green' }, origin: 'https://untrusted.test' })).status).toBe(403);
    await browser.keyboard.press('Escape');
    await browser.reload();
    expect(await browser.evaluate(() => document.querySelector('[data-office-accent]')?.getAttribute('data-office-accent') ?? null)).toBe('blue');
    expect(await browser.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'))).toBe(neutral);
    await app.screenshot('cor-azul-desktop');
    await browser.setViewport({ width: 390, height: 900 });
    await screen.getByRole('button', /^Mais opções(?:,|$)/).tap();
    await screen.getByRole('radio', 'Verde', { exact: true }).tap();
    await expect(screen.getByRole('radio', 'Verde', { exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(screen.getByRole('radio', 'Verde', { exact: true })).toHaveAttribute('aria-disabled', 'false');
    await browser.keyboard.press('ArrowRight');
    await expect(screen.getByRole('radio', 'Violeta', { exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(screen.getByRole('radio', 'Violeta', { exact: true })).toHaveAttribute('aria-disabled', 'false');
    await expect(screen.getByRole('radio', 'Violeta', { exact: true })).toBeFocused();
    expect(await api.json<{accent:string}>('/api/profile/appearance')).toEqual({ accent: 'violet' });
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot('cor-violeta-celular');
    for (const label of ['Laranja','Azul','Verde','Violeta']) {
      await screen.getByRole('radio',label,{exact:true}).tap();
      await expect(screen.getByRole('radio',label,{exact:true})).toHaveAttribute('aria-disabled','false');
      const light = await browser.evaluate(renderedContrast);
      expect(light.brand).toBeGreaterThanOrEqual(4.5); expect(light.ink).toBeGreaterThanOrEqual(4.5);
      await screen.getByRole('button','Usar tema escuro',{exact:true}).tap();
      const dark = await browser.evaluate(renderedContrast);
      expect(dark.brand).toBeGreaterThanOrEqual(4.5); expect(dark.ink).toBeGreaterThanOrEqual(4.5);
      await app.screenshot('cor-'+label+'-escura');
      await screen.getByRole('button','Usar tema claro',{exact:true}).tap();
    }
    await browser.keyboard.press('Escape');
    await browser.setViewport({ width: 320, height: 900 });
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  });
});
