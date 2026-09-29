import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const manifest = JSON.parse(readFileSync(new URL('../../apps/web/dist/client/.vite/manifest.json', import.meta.url), 'utf8'));
const error = manifest['src/app/global-error.tsx'];
const framework = Object.values(manifest).find(item => item.name === 'framework');
const browser = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
    page.on('pageerror', error => console.log(error.message));
    await page.goto('http://localhost:3107/');
    await expect(page.getByRole('button', { name: 'Usar tema claro' })).toBeEnabled();
    await page.evaluate(async ({ errorFile, frameworkFile, css }) => {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/' + css;
      document.head.append(stylesheet);
      const { default: ErrorPage } = await import('/' + errorFile);
      const { r: jsxRuntime, t: reactDom } = await import('/' + frameworkFile);
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach(element => { if (element !== stylesheet) element.remove(); });
      document.documentElement.removeAttribute('class');
      window.retryCount = 0;
      reactDom().createRoot(document).render(jsxRuntime().jsx(ErrorPage, { error: new Error('SEO verification'), retry: () => window.retryCount++ }));
    }, { errorFile: error.file, frameworkFile: framework.file, css: error.css[0] });
    await expect(page.getByRole('heading', { name: 'Não foi possível carregar esta página' })).toBeVisible();
    await page.keyboard.press('Tab');
    const button = page.getByRole('button', { name: 'Tentar novamente' });
    await expect(button).toBeFocused();
    const outline = await button.evaluate(element => ({ color: getComputedStyle(element).outlineColor, background: getComputedStyle(document.querySelector('main')).backgroundColor }));
    expect(outline.color).not.toBe(outline.background);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.retryCount)).toBe(1);
    await page.screenshot({ path: `output/seo-pagespeed/error-${colorScheme}.png` });
    console.log(JSON.stringify({ colorScheme, standaloneError: 'passed', keyboardRetry: 'passed' }));
    await page.close();
  }
} finally { await browser.close(); }
