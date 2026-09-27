# Administração financeira — 27/09/2026

Implementação publicada em [Tises staging](https://k5-staging.k5-web.workers.dev/app/admin/finance?environment=sandbox), com a AbacatePay em sandbox. Nenhuma cobrança real foi realizada.

## Fluxos disponíveis

- **Administração → Financeiro:** recebimentos, reembolsos, saldo após reembolsos (antes de taxas), valores pendentes, assinaturas ativas e histórico paginado. Filtros por período, cliente, situação e ambiente. Os totais incluem apenas cobranças associadas a escritórios do Tises, sem incorporar pagamentos de outros aplicativos da loja.
- **Administração → Clientes → escritório:** prazo pago, histórico, assinaturas e últimas ações com o administrador responsável.
- Gerar e copiar link de um mês avulso por R$ 199,00 (PIX/cartão) ou de assinatura mensal por R$ 199,00 (cartão). O cliente conclui a adesão na AbacatePay.
- Reembolsar integralmente um pagamento avulso e retirar o período correspondente após confirmação. A API da AbacatePay não permite reembolso de cobranças de assinatura.
- Cancelar renovação automática preservando o período pago. Para retomar, gerar uma nova adesão; para acrescentar um mês avulso, gerar uma nova cobrança.

As mutações exigem administrador da plataforma, sessão válida, origem autorizada e vínculo do pagamento ao escritório selecionado. Ações são auditadas e protegidas contra repetição concorrente. Uma resposta incerta permanece em confirmação, sem repetir o pedido financeiro. Webhooks e a ação **Atualizar pagamentos** reconciliam o resultado.

## Configuração implantada

- Migrações `0027_platform_billing.sql` e `0028_subscription_payments.sql` aplicadas localmente e no staging.
- Produto mensal: `tises-assinatura-mensal-19900`; produto avulso preservado.
- Chave **Tises financeiro sandbox**, criada com autorização e 2FA do usuário, configurada localmente e como secret do Worker. Permissões: `CHECKOUT:CREATE`, `CHECKOUT:READ`, `SUBSCRIPTION:CREATE`, `SUBSCRIPTION:READ`, `SUBSCRIPTION:DELETE`, `REFUND:CREATE`, `CUSTOMER:CREATE`, `PRODUCT:CREATE`, `PRODUCT:READ`. Valores secretos não são versionados.
- Webhook avulso existente preservado. Novo webhook **Tises staging assinaturas**, `webh_dev_xgYE1mqY0d4kA6WzrHnCAEWz`, recebe `subscription.completed`, `subscription.renewed`, `subscription.cancelled` e `subscription.payment_failed` no endpoint `/api/billing/webhook` do staging, com o mesmo segredo de autenticação.
- Versão final do Worker: `3ac8005a-f895-4ba6-b0cd-ae8038cd835f`. Deploy preservou os Containers existentes.

## Evidências de execução

| Fluxo | Resultado |
| --- | --- |
| Assinatura no site público | Checkout `bill_WsrWRLxKYwfGfFAxTASWsLU5` pago com cartão fictício; assinatura `subs_rLMb6PdA6xPBYRh6214TeFXf` ativada. |
| Webhooks reais do sandbox | Banco do staging recebeu `subscription.completed` e `subscription.cancelled`, uma vez cada. |
| Cancelamento pelo Tises | Assinatura pública terminou `CANCELLED`, ação `SUCCEEDED`, prazo pago preservado até 27/10/2026. |
| Link para o cliente | Geração e cópia pelo navegador verificadas; nenhum envio de mensagem foi implementado. |
| Reembolso de cartão pelo Tises | Checkout local `bill_0sKuxGLrSazaWnxeXxknMNQ2` terminou `REFUNDED`; atualização confirmou a ação e restaurou o prazo de 27/12/2026 para 27/11/2026. |
| Recusa do provedor | Reembolso do PIX local `bill_c6SBPZPRhQB2uwzbcdjQj5Ag` recusado por saldo insuficiente no sandbox. Pagamento e prazo preservados; erro traduzido na interface. |
| Proteção da rota pública | POST sem sessão retornou 401; POST de origem externa retornou 403. |
| Interface | Desktop e viewport de 390 × 844, sem rolagem horizontal; filtros, estado vazio, carregamento, erro e confirmação por diálogo conferidos. |

A renovação de um ciclo futuro e a falha de pagamento foram verificadas por testes com eventos simulados; não foi aguardado um mês para observar uma cobrança recorrente real. O checkout avulso que já estava pendente no escritório público foi preservado.

## Verificações

- `pnpm test`: 463 testes passaram na execução completa. Após os ajustes finais de reembolso, a suíte específica de cobrança passou com 19 testes, incluindo o novo caso de recusa por saldo insuficiente e a corrida entre webhook e consulta desatualizada.
- `pnpm typecheck` e `pnpm lint`: passaram após os ajustes finais; lint mantém um aviso preexistente de `_bytes` no transporte judicial.
- `pnpm build`, `pnpm --filter @k5/web build:vinext`, setup do banco, verificação das migrações e dry-run do Wrangler: passaram. Build vinext final inclui todos os ajustes implantados.
- Cobertura inclui autorização, revogação, isolamento por escritório, idempotência, duplicidade concorrente, reconciliação de resultado incerto, cancelamento que não é revertido por evento antigo e múltiplas assinaturas criadas a partir do mesmo checkout.

Capturas locais não versionadas em `apps/web/playwright-report/abacatepay/`: `finance-desktop.png`, `finance-mobile.png`, `client-mobile.png`, `client-staging.png`, `finance-staging.png` e `client-card-refunded.png`.

## Referências

- [Reembolso e limitações](https://docs.abacatepay.com/pages/payment/refund)
- [Consulta de assinatura](https://docs.abacatepay.com/pages/subscriptions/get)
- [Eventos de assinatura](https://docs.abacatepay.com/pages/webhooks/events/subscriptions)
- [Validação inicial da integração avulsa](validacao-abacatepay.md)
