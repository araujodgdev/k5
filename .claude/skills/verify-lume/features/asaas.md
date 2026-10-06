# Asaas

An office connects its own Asaas account in Integrações with an API key, then issues an honorário installment's charge from the charge screen. Asaas confirmations arrive through a webhook and record the receipt. The verification instance has no Asaas account and no public URL, so the drive covers the screens and the refusals that never reach Asaas. Connection, charges and the webhook are proven against a simulated Asaas in `tests/asaas.test.ts`.

## Sub-features

- `asaas-connection`: the "Asaas" section in Integrações shows "Nenhuma conta do Asaas conectada." and a "Chave de API do Asaas" field. A key without the `$aact_` prefix is refused with an alert.
- `asaas-charge`: the installment's charge screen has a "Cobrança pelo Asaas" section. Without a connection, it links to Integrações ("conecte a conta do Asaas em Integrações"), and the PIX and boleto instructions stay available.

- `asaas-valid-connection`: Conectar, revalidar, trocar chave e desconectar conta sandbox, sem expor a chave.
- `asaas-issue-cancel`: Emitir cobrança pelo saldo, recuperar envio incerto sem duplicação e cancelar.
- `asaas-webhook`: Webhook autenticado registra recebimento uma vez; duplicação não duplica baixa; estorno reverte.

## How to get to it (user POV)

- Sidebar "Integrações" (`/app/integrations`), section "Asaas".
- Sidebar "Honorários", then a honorário, then "Preparar cobrança da parcela N".

## Driving it with e2e

Test: `apps/web/e2e/asaas.e2e.ts`
Test: `apps/web/e2e/honorario-charge.e2e.ts`

Preconditions:

- `doctor` all OK. The test signs up its own account, client and honorário.

- **Integrações.** `heading "Asaas"` and the empty state are visible. Filling `label "Chave de API do Asaas"` with a key without `$aact_` and pressing `button "Verificar e conectar"` shows `role alert` containing `$aact_`. At 390px the field fits without horizontal scroll.
- **Charge.** In the installment's charge screen, `heading "Cobrança pelo Asaas"` shows the link to `/app/integrations`, and `label "Chave PIX"` is still there.

## Gotchas

- A real connection needs an Asaas key (`$aact_hmlg_` for sandbox). The automatic receipt also needs a public HTTPS URL (`ASAAS_WEBHOOK_BASE_URL`), which the instance does not have: there, the panel reports the automatic receipt as unavailable.

- **Revisão de fonte; sem execução nesta etapa:** Sem credenciais, os e2e provam telas, rejeições e cobrança manual. Emissão/conciliação reais exigem sandbox e webhook.
- O webhook aceita ASAAS_WEBHOOK_BASE_URL ou BETTER_AUTH_URL como base pública HTTPS. A receita padrão não comprova conexão válida, emissão, cancelamento, conciliação nem estorno no provedor.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
