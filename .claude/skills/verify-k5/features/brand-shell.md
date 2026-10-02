# brand-shell

Test: `apps/web/e2e/app-shell.e2e.ts`

The Lume identity across the signed-in shell: the ink mark tile ("Lume — início") and the mono "Lume" label in the sidebar, the Lume nav row, the chat page titled "Lume", the Plano page labelled "Plano Lume", and the mobile shell (mark tile in the header, tab bar with Lume).

- Entry points: `/app` (sidebar), `/app/agents`, `/app/billing`, `/app/messages`, `/app/whatsapp`, mobile `/app`.
- The instance has no AI connection, so the chat may show its unavailable state instead of the composer; check the title, not an answer.
- WhatsApp only shows in the nav when `isWhatsAppEnabled` is on for the office; the instance leaves it off.
- Mensagens keeps a request open, so `networkidle` never arrives; wait for `main` instead.
