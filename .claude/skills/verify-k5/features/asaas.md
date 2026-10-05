# Asaas

An office connects its own Asaas account in Integrações with an API key, then issues an honorário installment's charge from the charge screen. Asaas confirmations arrive through a webhook and record the receipt. The verification instance has no Asaas account and no public URL, so the drive covers the screens and the refusals that never reach Asaas. Connection, charges and the webhook are proven against a simulated Asaas in `tests/asaas.test.ts`.

## Sub-features

- `asaas-connection`: the "Asaas" section in Integrações shows "Nenhuma conta do Asaas conectada." and a "Chave de API do Asaas" field. A key without the `$aact_` prefix is refused with an alert.
- `asaas-charge`: the installment's charge screen has a "Cobrança pelo Asaas" section. Without a connection, it links to Integrações ("conecte a conta do Asaas em Integrações"), and the PIX and boleto instructions stay available.

## How to get to it (user POV)

- Sidebar "Integrações" (`/app/integrations`), section "Asaas".
- Sidebar "Honorários", then a honorário, then the button "Cobrança" (accessible name "Preparar cobrança da parcela N").

## Driving it with e2e

Test: `apps/web/e2e/asaas.e2e.ts`
Test: `apps/web/e2e/honorario-charge.e2e.ts`

Preconditions:

- `doctor` all OK. The test signs up its own account, client and honorário.

- **Integrações.** `heading "Asaas"` and the empty state are visible. Filling `label "Chave de API do Asaas"` with a key without `$aact_` and pressing `button "Verificar e conectar"` shows `role alert` containing `$aact_`. At 390px the field fits without horizontal scroll.
- **Charge.** In the installment's charge screen, `heading "Cobrança pelo Asaas"` shows the link to `/app/integrations`, and `label "Chave PIX"` is still there.

## Gotchas

- A real connection needs an Asaas key (`$aact_hmlg_` for sandbox). The automatic receipt also needs a public HTTPS URL (`ASAAS_WEBHOOK_BASE_URL`), which the instance does not have: there, the panel reports the automatic receipt as unavailable.
- `honorario-charge.e2e.ts` is tagged `pdf` and needs LibreOffice (`soffice`, or `LIBREOFFICE_PATH`) on the machine running `next dev`. Without it, "Baixar PDF" stays disabled and the page shows "Não foi possível gerar o PDF. Tente novamente ou exporte o DOCX."; the test then times out. `asaas.e2e.ts` does not need the converter.
