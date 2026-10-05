# Honorários

The office's fee ledger in Honorários: register an agreement for a client (and optionally a case) split into monthly installments, record full and partial receipts, undo a receipt with a reason (history kept as a reversal), filter by A receber / Recebidas / Canceladas, cancel an agreement, and recover from a failed load. Works by keyboard and at 390px.

## Sub-features

- `fees-create`: "Novo honorário" dialog with pickers "Cliente (obrigatório)" and "Caso (opcional)", "Descrição", "Valor total (R$)", "Número de parcelas", "Primeiro vencimento"; due dates follow each month's last day.
- `fees-receive`: "Registrar recebimento da parcela N" → "Valor recebido (R$)" → "Salvar recebimento", full or partial.
- `fees-undo`: "Desfazer recebimento de R$ …" → "Motivo da correção" → "Desfazer registro"; "Registro desfeito por" appears and the receipt stays with its reversal.
- `fees-tabs`: "A receber", "Recebidas", "Canceladas".
- `fees-cancel`: "Cancelar honorário" → "Motivo do cancelamento" → "Confirmar cancelamento"; "Honorário cancelado. O histórico permanece disponível."
- `fees-states`: empty ("Nenhuma parcela a receber para estes filtros."), loading ("Carregando honorários…"), error alert and "Tentar novamente".
- `fees-mobile`: the list and the create form at 390px; "Mais" lists Honorários.
- `fees-asaas-charge`: charging an installment through Asaas (see `asaas`).

## How to get to it (user POV)

- Sidebar "Honorários" (`/app/honorarios`); on mobile, "Mais" → "Honorários".
- An agreement row is a button "Abrir <descrição>, …" that opens its detail dialog.

## Driving it with e2e

Test: `apps/web/e2e/honorarios.e2e.ts`

Preconditions:

- `doctor` all OK. The test signs up its own account (`uniqueAccount('Financeiro')`) and creates its client and case through the same API the UI calls, so it starts from an empty ledger.

- **Empty.** `app.open('/app/honorarios')`; the empty text is visible and `/api/honorarios/list` sums to zero.
- **Create.** Focus "Novo honorário" and press Enter; pick client and case (each picker is a button that opens a list of option buttons); fill R$ 3.000,00 in 3 parcels from 2026-01-31; parcel 2 and 3 due dates show 2026-02-28 and 2026-03-31; "Cadastrar honorário". The API detail has `totalCents: 300000` and the case.
- **Receive and undo.** Open the agreement; receive 1.000,00 on parcel 1 and 400,00 on parcel 2; undo the 400,00 with a reason; the API shows `receivedCents: 100000` and two receipts, one a reversal.
- **Tabs and cancel.** Recebidas shows 1 row, A receber 2; cancel a second agreement and find it under Canceladas.
- **Error.** The list request is held then answered 503 (`browser.route`); the loading text, then the alert, then "Tentar novamente" recovers.
- **Mobile.** At 390×844, no horizontal scroll; "Mais" lists Honorários; Escape returns focus to "Novo honorário"; create and cancel an agreement from the phone.
- **Proof.** `drive honorarios` returns the single long test passed; its trace shows every step.

## Gotchas

- The only mock is the 503 on `/api/honorarios/list` to reach the error state; every write goes through the UI and is read back from the API.
- Roles, cross-office privacy and concurrency are in `tests/honorarios.test.ts`, not in the UI test.
- A cold `/app/honorarios` compile in `next dev` can outlast the 10 s assertion and fail on the empty text with the shell already rendered. Rerun the drive once before treating it as a regression (seen on a fresh instance).
- Money fields take pt-BR format (`3.000,00`); the API returns cents.
