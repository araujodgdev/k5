# Credits

Each office has a balance of credits that pays for the Lume's AI and for pages read by OCR. A newly provisioned office opens with 500 credits under the current migrated settings (existing balances are preserved), every paid month of the plan adds 850 more, and unused credits carry over. The Plano page shows the balance, what was used this month, the packages to buy (500, 1.000 and 2.500 credits at R$ 0,10 each) and the latest entries. A platform administrator adds credits by hand on a client's page and uses the AI without spending credits.

## Sub-features

- `credits-balance`: Plano → "Créditos" shows "<n> créditos" and "Usados neste mês".
- `credits-statement`: the table "Últimas movimentações de créditos" lists "Créditos iniciais" (+500), plan months, purchases, grants and AI or OCR use.
- `credits-packages`: one outline button per package opens the AbacatePay checkout; only listed packages are accepted.
- `credits-blocked`: with no credits left, the chat, background runs, voice notes and OCR are refused with "Seus créditos acabaram…".
- `credits-admin-grant`: Administração → Clientes → a client → "Créditos": amount, "Motivo" and "Adicionar créditos".
- `credits-mobile`: the Plano page fits 390px.

## How to get to it (user POV)

- Desktop: sidebar "Plano" → `/app/billing`, section "Créditos".
- Mobile: tab "Mais" → "Plano".
- Admin: `/app/admin/clients/<officeId>`, section "Créditos".

## Driving it with e2e

Test: `apps/web/e2e/credits.e2e.ts`

Preconditions: none from the instance. The test signs up its own account over HTTP (`ApiSession`), so its balance starts at the initial 500 credits.

- The balance line is the text "500 créditos" (exact) inside the region "Créditos"; the plan sentence also mentions 850, so match exactly.
- The packages render only when AbacatePay is configured; the instance blanks it, so the test proves package validation through `POST /api/billing/credits` (400 for an unlisted package) instead of the buttons.

## Gotchas

- Buying a package, AI use, the blocked state and the admin grant cannot be driven here: the instance has no AbacatePay key, no AI connection and no platform administrator. They are covered by `apps/web/tests/credits.test.ts` and `apps/web/tests/billing.test.ts`.
- Entries below 0,1 credit show "< 0,1".

- **Revisão de fonte; sem execução nesta etapa:** Teste cobre saldo inicial/extrato/interface. Checkout, webhook, esgotamento e concessão administrativa precisam de provas próprias.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
