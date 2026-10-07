# Abas e controles do Lume

Canvas navigation preserves the mounted private conversation and its draft.

## Sub-features

- workspace-tabs-chat: module and tab navigation preserve the same composer and draft.
- workspace-tabs-controls: history, new conversation, expand and collapse share one header row.
- workspace-tabs-mobile: Canvas and Lume alternate without remounting or horizontal overflow.
- workspace-dialogs: notifications and feedback are rounded, centered and close with Escape.

## How to get to it (user POV)

Open Início, Cofre and E-mails from Abrir módulos, then switch their tabs. Notifications is in the canvas toolbar; Enviar feedback is in the account menu.

## Driving it with e2e

Test: `apps/web/e2e/workspace-tabs.e2e.ts`

Uses the isolated instance's authenticated session. Checks desktop and 390px, composer identity, draft, header controls and dialog geometry.

## Gotchas

The test does not send a message to the model. It proves interface continuity during navigation.
