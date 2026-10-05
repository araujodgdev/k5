# Cálculos jurídicos

The office saves a legal calculation, exports it, and turns a positive result into an OAB-PE or OAB-RS fee proposal with installments. The same signed-in flow covers the empty list, one consumer calculation with versions, the proposal, and a federal-tax calculation on a phone-width screen.

## Sub-features

- `calc-empty`: the list at `/app/calc` shows "Nenhum cálculo salvo para esta busca."
- `calc-kinds`: each of the seven starters opens its heading and "Voltar aos cálculos" returns to the list. The starters are "Correção de valores", "Trabalhista", "Revisional bancário", "Pensão alimentícia", "Aluguel", "Consumidor" and "Tributário".
- `calc-consumer`: keyboard opens "Consumidor"; a double restitution of R$ 100,00 plus a R$ 50,00 payment previews "150,00" in the total; saving persists `totalCents` 15000.
- `calc-export`: the saved version exports as JSON, CSV and a PDF (`%PDF-`).
- `calc-versions`: revising the parcel to R$ 200,00 and "Salvar nova versão" shows "350,00"; selecting version 1 shows "150,00" again, and the API keeps that historical total.
- `calc-proposal`: "Usar resultado como base de honorários" opens "Propostas e contratos" with base "150,00". The OAB 2026 activity links "Abrir OAB-PE" and, after UF RS, "Abrir OAB-RS". Saving, downloading the proposal PDF, and "Gerar parcelas deste componente" create dues on 2026-01-31, 2026-02-28 and 2026-03-31 with reference UF RS.
- `calc-tax-mobile`: at 390×844, "Tributário" saves a R$ 1.000,00 principal and the total shows "1.033,00", with no horizontal scroll.
- `calc-error`: a held list request shows "Carregando cálculos…", then an alert "Consulta de cálculos indisponível", and "Atualizar" restores the saved calculation.

## How to get to it (user POV)

- Sidebar "Cálculos jurídicos" (`/app/calc`). On a phone, "Mais" → "Cálculos jurídicos".
- From a saved calculation with a positive total, "Usar resultado como base de honorários" opens `/app/honorarios/propostas`.
- From the fee ledger, "Propostas e tabelas OAB" opens the same proposal screen.

## Driving it with e2e

Test: `apps/web/e2e/calc.e2e.ts`

Preconditions:

- `doctor` all OK. The test signs up its own account (`uniqueAccount('Calc')`) and creates "Cliente Calc" through the same API the UI calls.

- **Empty and kinds.** Open `/app/calc`, see the empty text, open each starter heading, and return.
- **Consumer.** Focus "Consumidor" and press Enter. Fill the title, base date, "Em dobro", the legal basis, one undue payment and one refund. "Conferir cálculo" shows 150,00. "Salvar cálculo" persists it. Exports answer 200.
- **Versions and proposal.** "Revisar parâmetros", change the parcel, "Salvar nova versão", then select version 1. Follow the honorários link, pick the client, choose an OAB-PE activity, switch the UF to RS, save, download, and generate three installments.
- **Mobile tax and error.** At 390×844 the proposal and the tax calculation do not scroll horizontally. The tax total is 1.033,00. A 503 on the list shows the loading text and the alert; "Atualizar" brings the saved calculation back.
- **Proof.** `drive calc` returns the single long test passed. Screenshots: `calc-desktop` on the empty list, `proposta-mobile`, `calc-tributario-mobile`.

## Gotchas

- The only mock is the 503 on `/api/calc/list`. Writes go through the UI and are read back from the API.
- The test checks the proposal and the tax calculator at 390px. It does not open "Mais", and it does not rebuild the consumer calculation or the proposal on the phone.
- Calc and the proposal page sit outside the office shell, so the sidebar and the tab bar are absent on those URLs. Reach them from another module, or open the URL directly as the test does.
- A cold `/app/calc` or `/app/honorarios/propostas` compile in `next dev` can outlast a short assertion. The test allows 360s overall and 60s for the proposal heading. Rerun the drive once before treating a timeout on the empty text as a product bug.
- Numeric engines and the OAB tables are locked in `tests/calc-engine.test.ts` and `tests/calc-service.test.ts`, not in this UI test.
