# Abas e controles do Lume

Canvas navigation preserves the mounted private conversation and its draft.

## Sub-features

- workspace-tabs-chat: module and tab navigation preserve the same composer and draft.
- workspace-canvas-titles: an authorized client view names its tab and chat context.
- workspace-task-links: delegated task links retain conversation intent without reloading the panel.
- workspace-tabs-controls: history, new conversation, expand and collapse share one header row.
- workspace-tabs-mobile: Canvas and Lume alternate without remounting or horizontal overflow.
- workspace-dialogs: notifications and feedback are rounded, centered and close with Escape.

## How to get to it (user POV)

Open Início, Cofre and E-mails from Casos e módulos, then switch their tabs. Notifications is in the canvas toolbar; Enviar feedback is in the account menu.

## Driving it with e2e

Test: `apps/web/e2e/workspace-tabs.e2e.ts`
Test: `apps/web/e2e/lume-shell.e2e.ts`
Test: `apps/web/e2e/lume-composition.e2e.ts`

Uses the isolated instance's authenticated session. Checks desktop and 390px, composer identity, draft, header controls and dialog geometry.

## Gotchas

The test does not send a message to the model. It proves interface continuity during navigation.

Canvas tabs are links. On mobile, use Buscar to choose an open tab or module, and Voltar ao Lume / Recolher o Lume to alternate surfaces. Cold dev route compilation can exceed the default sign-in redirect wait; the helper allows 60 seconds. Frontend-contract tests use a synthetic stream to check rendering and frozen scope; they do not prove live provider execution.

The task-link frontend contract supplies the delegated conversation response and association; it does not execute a worker or an AI provider. Its task and conversations are created through the real API.
