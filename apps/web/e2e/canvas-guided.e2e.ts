import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { signInWithSession } from './support/sign-in';

// The model choosing k5_ui_open_resource and the server turning its result into a data-canvas part
// are covered in tests/canvas-protocol.test.ts and tests/ui-open-resource.test.ts. Here the panel
// hears the stream the server sends, and the canvas follows it.
const stream = (chunks: object[]) => chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';

for (const width of [1280, 390]) {
  test(`pedir ao Lume para abrir um caso abre a aba do caso no canvas em ${width}px`, async ({ app, screen, browser }) => {
    await browser.setViewport({ width, height: 844 });
    const name = 'Silva vs. Construtora Horizonte';
    const api = await new ApiSession(app.baseUrl!).signIn(uniqueAccount('Canvas'));
    const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name, idempotencyKey: randomUUID() } });
    const href = `/app/vault/cases/${record.id}`;
    const sent: { canvas?: { subject: { kind: string }; tabs: { href: string }[] } }[] = [];
    await browser.route('**/api/chat', route => {
      sent.push(JSON.parse(route.request.postData ?? '{}'));
      return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: stream([
        { type: 'start', messageId: 'open-case' },
        { type: 'data-tool', id: 'open-call', data: { callId: 'open-call', name: 'k5_ui_open_resource', state: 'completed', summary: 'Abriu recurso na interface', href } },
        { type: 'data-canvas', data: { action: 'open', href, title: name }, transient: true },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'Abri o caso no canvas.' },
        { type: 'text-end', id: 'text' },
        { type: 'finish' },
      ]) });
    });
    await signInWithSession({ app, screen, browser }, api);

    await screen.getByRole('textbox', 'Peça algo ao Lume').fill('Abra o caso Silva');
    await screen.getByRole('button', 'Enviar mensagem').tap();
    await expect(screen.getByText('Abri o caso no canvas.')).toBeVisible();
    await expect(browser).toHaveURL(new RegExp(`${href}$`));
    // The message told the Lume what the canvas showed when it was sent.
    expect(sent[0].canvas?.subject.kind).toBe('office');
    expect(sent[0].canvas?.tabs.map(tab => tab.href)).toContain('/app/command-center');

    if (width >= 768) {
      const tab = screen.getByRole('navigation', 'Abas do canvas').getByRole('link', name);
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(screen.getByRole('heading', name)).toBeVisible();
      return;
    }
    // On a phone the conversation keeps the screen; the case waits behind it in the canvas.
    await expect(screen.getByRole('textbox', 'Peça algo ao Lume')).toBeVisible();
    await screen.getByRole('button', 'Abrir o canvas do escritório').tap();
    await expect(screen.getByRole('heading', name)).toBeVisible();
  });
}
