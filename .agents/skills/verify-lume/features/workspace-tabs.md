# Abas e controles do Lume

Canvas navigation preserves the mounted private conversation and its draft.

## Sub-features

- workspace-tabs-chat: module and tab navigation preserve the same composer and draft.
- workspace-module-tabs: one tab per module; a mounted tab switches without a server render and keeps its canvas, and the open tab leads back to its module's start.
- workspace-panel-fold: the office bar's Lume button folds the panel into it and opens it again, with focus on the canvas and then the composer.
- workspace-canvas-titles: an authorized client view names its module tab's tooltip and the chat context.
- workspace-task-links: delegated task links retain conversation intent without reloading the panel.
- workspace-tabs-controls: history, new conversation, expand and collapse share one header row.
- workspace-tabs-mobile: Canvas and Lume alternate without remounting or horizontal overflow.
- workspace-dialogs: notifications and feedback are rounded, centered and close with Escape.

## How to get to it (user POV)

Open Início, Casos and E-mails from Casos e módulos or the module tabs on the office bar, then switch between them. The bar's left side, over the panel, holds the Lume's button, Casos e módulos, search, Notificações, the theme and the account menu with Enviar feedback.

## Driving it with e2e

Test: `apps/web/e2e/workspace-tabs.e2e.ts`
Test: `apps/web/e2e/lume-shell.e2e.ts`
Test: `apps/web/e2e/lume-composition.e2e.ts`

Uses the isolated instance's authenticated session. Checks desktop and 390px, composer identity, draft, header controls and dialog geometry.

## Gotchas

The test does not send a message to the model. It proves interface continuity during navigation.

Canvas tabs are links named after their module; the place a tab holds is in its `title` ("Casos: <case>"). To return to a mounted case or document, use search's "Abas abertas" (`openPlace` in `e2e/support/shell.ts`). On mobile, use Buscar to choose an open tab or module, and Voltar ao Lume / Recolher o Lume to alternate surfaces. Cold dev route compilation can exceed the default sign-in redirect wait; the helper allows 60 seconds. Frontend-contract tests use a synthetic stream to check rendering and frozen scope; they do not prove live provider execution.

The task-link frontend contract supplies the delegated conversation response and association; it does not execute a worker or an AI provider. Its task and conversations are created through the real API.
