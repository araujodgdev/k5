import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.BASE_URL || 'http://localhost:3106';
const output = 'playwright-report/public-site';
const publicPaths = ['/', '/termos-de-uso', '/politica-privacidade'];
const browser = await chromium.launch();
await mkdir(output, { recursive: true });

try {
  for (const userAgent of ['Mozilla/5.0', 'Googlebot']) {
    const context = await browser.newContext({ javaScriptEnabled: false, userAgent });
    const page = await context.newPage();
    for (const path of [...publicPaths, '/sign-in', '/sign-up']) {
      const response = await page.goto(`${baseURL}${path}`);
      expect(response?.status()).toBe(200);
      const directives = await page.locator('head meta[name="robots"]').getAttribute('content');
      if (publicPaths.includes(path)) {
        expect(directives).toBe('index, follow');
        expect(response?.headers()['x-robots-tag'] || '').not.toContain('noindex');
        await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', `https://lume.software${path}`);
      } else {
        expect(directives).toContain('noindex');
      }
      await expect(page.locator('h1')).toBeVisible();
    }
    await page.goto(baseURL);
    const structured = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    expect(structured).toMatchObject({ '@type': 'WebSite', name: 'Lume', url: 'https://lume.software/' });
    await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', 'https://lume.software/');
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', /documentos.*IA.*honorários/);

    const robots = await context.request.get(`${baseURL}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap: https://lume.software/sitemap.xml');
    expect(await robots.text()).toMatch(/^Allow: \/$/m);
    const sitemap = await context.request.get(`${baseURL}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    const urls = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
    expect(urls.sort()).toEqual(publicPaths.map(path => `https://lume.software${path}`).sort());
    const protectedResponse = await context.request.get(`${baseURL}/app`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(protectedResponse.status());
    expect(protectedResponse.headers().location).toContain('/sign-in');
    const missing = await context.request.get(`${baseURL}/pagina-inexistente-seo`);
    expect(missing.status()).toBe(404);
    console.log(JSON.stringify({ userAgent, serverRenderedSEO: 'passed', publicSitemap: 'passed', privateAccess: 'passed' }));
    await context.close();
  }

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const context = await browser.newContext({ viewport, reducedMotion });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseURL);
      await expect(page.locator('h1')).toHaveText('Lume');
      expect(await page.locator('h1 span').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
      await page.keyboard.press('Enter');
      expect(new URL(page.url()).hash).toBe('#conteudo');
      for (const theme of ['light', 'dark']) {
        const label = theme === 'light' ? 'Usar tema claro' : 'Usar tema escuro';
        await page.getByRole('button', { name: label }).click();
        for (const id of ['hero-title', 'modulos-title', 'escritorio-title', 'comecar-title']) {
          const section = page.locator(`#${id}`);
          await section.scrollIntoViewIfNeeded();
          await expect(section).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.locator('#modulos-title').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/${viewport.width}-${reducedMotion}-${theme}.png` });
      }
      if (reducedMotion === 'reduce') expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      await page.getByRole('link', { name: 'Entrar', exact: true }).first().click();
      await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      console.log(JSON.stringify({ viewport: viewport.width, reducedMotion, themes: 'passed', keyboard: 'passed', navigation: 'passed' }));
      await context.close();
    }
  }
} finally {
  await browser.close();
}
