import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { tutorialSteps } from '../src/lib/onboarding';
import { tutorialModules, tutorialMedia } from '@k5/tutorial-library';
import { admin, ApiSession } from './support/accounts';
import { signInWithSession } from './support/sign-in';

test.setup('leitor dos tutoriais entra com sessão autenticada', { sessions: ['tutorial-reader'] }, async ({ app, screen, browser, session }) => {
  const api = new ApiSession(app.baseUrl!);
  await api.signIn(admin);
  await signInWithSession({ app, screen, browser }, api);
  await session.save('tutorial-reader');
});

// The tour as a first visit sees it: every step on its page and inside the screen, a pause with
// Escape that survives a reload, resuming from the menu, keyboard focus and going back.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const mobile = viewport.width < 768;
  test(`o tutorial percorre todas as etapas, pausa e retoma em ${viewport.width}px`, { session: 'admin' }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewport);
    await app.open('/app/command-center');
    await browser.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('lume:tutorial:')) localStorage.removeItem(key); return null; });
    await browser.reload();
    await expect(screen.getByRole('dialog', 'Conheça o Lume')).toBeVisible();
    await screen.getByRole('button', 'Começar tutorial').tap();
    const steps = tutorialSteps({ whatsappEnabled: false, adsEnabled: false, platformAdmin: false });
    for (const [index, step] of steps.entries()) {
      const dialog = screen.getByRole('dialog', step.title);
      await expect(dialog).toBeVisible();
      await expect(browser).toHaveURL(step.href, { timeout: 60_000 });
      const next = dialog.getByRole('button', index === steps.length - 1 ? 'Concluir' : 'Próximo');
      await expect(next).toBeEnabled();
      const box = (await dialog.boundingBox())!;
      expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `etapa ${step.id} dentro da tela`).toBe(true);
      if (index === 1) {
        await browser.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await browser.reload();
        await expect(screen.getByRole('dialog')).toHaveCount(0);
        if (mobile) await screen.getByRole('button', 'Mais').tap();
        await screen.getByRole('button', 'Tutorial do Lume', { visible: true }).tap();
        await screen.getByRole('button', 'Continuar tutorial').tap();
        await expect(dialog).toBeVisible();
        await browser.keyboard.press('Tab');
        expect(await browser.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
        await dialog.getByRole('button', 'Voltar').tap();
        await expect(screen.getByRole('dialog', steps[0].title)).toBeVisible();
        await screen.getByRole('button', 'Próximo').tap();
      }
      await next.tap();
    }
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    await browser.reload();
    await expect(screen.getByRole('dialog')).toHaveCount(0);
  });
}

test('o tour leva à biblioteca de vídeos por módulo', { session: 'tutorial-reader' }, async ({ app, screen, browser }) => {
  await app.open('/app/command-center');
  await screen.getByRole('button', 'Tutorial do Lume', { visible: true }).tap();
  await screen.getByRole('link', 'Ver vídeos por módulo').tap();
  await expect(browser).toHaveURL(/\/app\/tutorial$/);
  await expect(screen.getByRole('heading', 'Tutoriais do Lume')).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a biblioteca filtra módulos e abre vídeos independentes em ${viewport.width}px`, { session: 'tutorial-reader' }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewport);
    await app.open('/app/tutorial');
    await screen.getByRole('navigation', 'Módulos dos tutoriais').getByRole('link', 'Escritório', { exact: true }).tap();
    await expect(browser).toHaveURL(/modulo=escritorio/);
    await expect(screen.getByRole('link', /^Assistir:/)).toHaveCount(3);
    await expect(screen.getByRole('link', 'Assistir: Organizar casos e documentos')).toHaveCount(0);
    await app.screenshot(`biblioteca-${viewport.width}`);
    const lesson = screen.getByRole('link', 'Assistir: Cadastrar e consultar clientes');
    await lesson.focus();
    await expect(lesson).toBeFocused();
    await browser.keyboard.press('Enter');
    await expect(browser).toHaveURL(/\/app\/tutorial\/clientes$/, { timeout: 60_000 });
    await expect(screen.getByLabel('Tutorial: Cadastrar e consultar clientes')).toBeVisible();
    await app.screenshot(`video-${viewport.width}`);
    await expect(screen.getByRole('link', 'Baixar legendas')).toHaveAttribute('href', /clientes\/legendas\.pt-BR\.vtt/);
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screen.getByRole('link', 'Organizar tarefas e agenda', { exact: true }).tap();
    await expect(screen.getByLabel('Tutorial: Organizar tarefas e agenda')).toHaveAttribute('src', /tarefas-e-agenda\/video\.mp4/);
    await screen.getByRole('link', 'Voltar aos tutoriais de Escritório').tap();
    await expect(screen.getByRole('link', /^Assistir:/)).toHaveCount(3);
    await app.open('/app/tutorial?modulo=inexistente');
    await expect(screen.getByText('Nenhum tutorial disponível neste módulo.')).toBeVisible();
    await screen.getByRole('link', 'Ver todos os módulos').tap();
    await expect(screen.getByRole('link', 'Assistir: Organizar casos e documentos')).toBeVisible();
  });
}

test('cada tutorial tem vídeo, legenda e capa publicados', async ({ app }) => {
  for (const video of tutorialModules.flatMap(module => module.videos)) {
    const media = tutorialMedia(video.id);
    for (const [path, type] of [[media.video, 'video/mp4'], [media.captions, 'text/vtt'], [media.poster, 'image/jpeg']]) {
      const response = await fetch(new URL(path, app.baseUrl), { method: 'HEAD' });
      expect({ path, status: response.status, type: response.headers.get('content-type')?.split(';')[0] }).toEqual({ path, status: 200, type });
    }
  }
});

test('falha de carregamento oferece tentar novamente e download', { session: 'tutorial-reader' }, async ({ app, screen, browser }) => {
  await browser.route('**/tutorial/videos/clientes/video.mp4*', route => route.abort());
  await app.open('/app/tutorial/clientes');
  await expect(screen.getByRole('alert', 'Falha no vídeo')).toContainText('Não foi possível carregar o vídeo.');
  await expect(screen.getByRole('link', 'Baixar vídeo')).toBeVisible();
  await browser.unroute('**/tutorial/videos/clientes/video.mp4*');
  const loaded = browser.waitForResponse('**/tutorial/videos/clientes/video.mp4*');
  await screen.getByRole('button', 'Tentar novamente').tap();
  expect([200, 206]).toContain((await loaded).status);
  await expect(screen.getByLabel('Tutorial: Cadastrar e consultar clientes')).toBeVisible();
});

test('um endereço de vídeo desconhecido retorna página não encontrada', { session: 'tutorial-reader' }, async ({ app, screen }) => {
  await app.open('/app/tutorial/inexistente');
  await expect(screen.getByRole('heading', 'Página não encontrada')).toBeVisible();
});
