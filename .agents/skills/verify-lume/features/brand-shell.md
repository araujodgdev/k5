# Brand shell

The signed-in shell carries the Lume identity on desktop and mobile: the ink mark tile ("Lume — início"), the main navigation (Lume, Cofre, Mensagens, Plano), the chat page titled "Lume", the Plano page labelled "Plano Lume", and on mobile the header mark plus a tab bar with "Mais". The old brand name "Tises" appears nowhere in the rendered HTML.

## Sub-features

- `shell-mark`: the "Lume — início" link in the sidebar (desktop) and header (mobile).
- `shell-nav`: links Lume, Cofre, Mensagens and Plano in the main navigation.
- `shell-chat-title`: `/app/agents` has `h1 "Lume"`.
- `shell-billing-label`: `/app/billing` shows "Plano Lume".
- `shell-mobile`: at 390px, `navigation "Navegação principal"` has `button "Mais"` and there is no horizontal scroll.
- `shell-no-old-brand`: no "Tises" in the HTML of `/app/command-center` and `/app/billing`.
- `shell-whatsapp`: the WhatsApp nav row (not driven: hidden while `isWhatsAppEnabled` is off, which the instance leaves off).

- `shell-collapse`: Recolhimento do menu persiste após recarregar.
- `shell-flags`: Anúncios e WhatsApp seguem flags; Administração segue permissão da plataforma.

## How to get to it (user POV)

- Sign in; `/app` redirects to Início (`/app/command-center`), which shows the sidebar.
- Sidebar "Lume" (`/app/agents`), "Plano" (`/app/billing`), "Mensagens" (`/app/messages`).
- On mobile: the header mark and the bottom tab bar; extra sections sit behind "Mais".

## Driving it with e2e

Test: `apps/web/e2e/app-shell.e2e.ts`

Preconditions:

- `doctor` all OK; `{ session: 'admin' }` signs in as the verification account.

- **Desktop shell.** `app.open('/app')`, wait for URL `/app/command-center`, then `link "Lume — início"` and links `Lume`, `Cofre`, `Mensagens`, `Plano` are visible (`.first()`: the mark and the nav both exist).
- **Chat title.** `app.open('/app/agents')`; `heading "Lume"` level 1 is attached.
- **Plano.** `app.open('/app/billing')`; text "Plano Lume" is visible.
- **Mobile.** `browser.setViewport({ width: 390, height: 844 })`, open `/app`; the mark is visible, `button "Mais"` sits in `navigation "Navegação principal"`, and `overflowsHorizontally` is false.
- **Proof.** `drive brand-shell` returns the test title as passed with its trace.

## Gotchas

- The instance has no AI connection, so `/app/agents` may show the unavailable state instead of the composer. Assert the title, not an answer.
- Mensagens keeps a request open, so `networkidle` never arrives; wait for `main` or a heading instead.
- `/app` redirects; wait for `/app/command-center` before the next `app.open`, or the redirect can land on top of it.

- **Revisão de fonte; sem execução nesta etapa:** Teste presente; execução e cobertura por subitem ainda precisam ser verificadas.
- Termos aceitos e aviso de IA dispensado são pré-requisitos. workspace.e2e.ts cobre Mais/foco/tema. Ausência da marca antiga foi verificada apenas nas páginas nomeadas.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
