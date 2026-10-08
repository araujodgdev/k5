import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { overflowsHorizontally } from './support/fixtures';

const site = 'https://lume.software';
const publicPaths = ['/', '/termos-de-uso', '/politica-privacidade'];
const meta = (html: string, pattern: RegExp) => pattern.exec(html)?.[1];

// What a crawler gets: server-rendered HTML, no JavaScript, so plain HTTP is the faithful client.
test('o site público entrega SEO no HTML do servidor e mantém as áreas privadas fora do índice', async ({ app }) => {
  const get = (path: string, userAgent = 'Mozilla/5.0') => fetch(new URL(path, app.baseUrl), { headers: { 'user-agent': userAgent }, redirect: 'manual' });
  for (const userAgent of ['Mozilla/5.0', 'Googlebot']) {
    for (const path of [...publicPaths, '/sign-in', '/sign-up']) {
      const response = await get(path, userAgent);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      const robots = meta(html, /<meta name="robots" content="([^"]+)"/);
      expect(html, path).toMatch(/<h1[\s>]/);
      if (publicPaths.includes(path)) {
        expect(robots, path).toBe('index, follow');
        expect(response.headers.get('x-robots-tag') ?? '', path).not.toContain('noindex');
        expect(meta(html, /<link rel="canonical" href="([^"]+)"/), path).toBe(`${site}${path}`);
      } else {
        expect(robots, path).toContain('noindex');
      }
    }
  }
  const home = await (await get('/')).text();
  const structured = JSON.parse(meta(home, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? 'null');
  expect(structured).toMatchObject({ '@type': 'WebSite', name: 'Lume', url: `${site}/` });
  expect(meta(home, /<meta property="og:url" content="([^"]+)"/)).toBe(`${site}/`);
  expect(meta(home, /<meta name="description" content="([^"]+)"/)).toMatch(/documentos.*IA.*honorários/);

  const robots = await (await get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${site}/sitemap.xml`);
  expect(robots).toMatch(/^Allow: \/$/m);
  const sitemap = await (await get('/sitemap.xml')).text();
  expect([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]).sort()).toEqual(publicPaths.map(path => `${site}${path}`).sort());
  const privateArea = await get('/app');
  expect([302, 303, 307, 308]).toContain(privateArea.status);
  expect(privateArea.headers.get('location')).toContain('/sign-in');
  expect((await get('/pagina-inexistente-seo')).status).toBe(404);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`a página inicial funciona pelo teclado e nos dois temas em ${viewport.width}px`, async ({ app, screen, browser }) => {
    await browser.setViewport(viewport);
    await app.open('/');
    await expect(screen.getByRole('heading', { level: 1 })).toHaveText('Lume');
    await browser.keyboard.press('Tab');
    await expect(screen.getByRole('link', 'Ir para o conteúdo')).toBeFocused();
    await browser.keyboard.press('Enter');
    expect(new URL(await browser.url()).hash).toBe('#conteudo');
    for (const label of ['Usar tema escuro', 'Usar tema claro']) {
      await screen.getByRole('button', label).tap();
      for (const id of ['hero-title', 'modulos-title', 'escritorio-title', 'comecar-title']) {
        const section = browser.locator(`#${id}`);
        await section.scrollIntoView();
        await expect(section).toBeVisible();
        expect(await browser.evaluate(overflowsHorizontally), `${label} #${id}`).toBe(false);
      }
    }
    await app.open('/');
    const portal = screen.getByRole('banner').getByRole('link', 'Portal do cliente');
    await expect(portal).toBeVisible();
    await expect(portal).toHaveAttribute('href', '/client');
    expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
    await app.screenshot('acesso-portal-' + viewport.width);
    await portal.tap();
    await expect(browser).toHaveURL('/client/sign-in');
    await expect(screen.getByRole('heading', 'Entre no portal')).toBeVisible();
    await app.open('/');
    await screen.getByRole('link', 'Entrar').first().tap();
    await expect(screen.getByRole('button', 'Entrar')).toBeVisible();
  });
}
