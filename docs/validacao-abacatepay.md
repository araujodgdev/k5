# Validação AbacatePay — 27/09/2026

Integração v2 validada em Dev mode, sem cobrança real, no ambiente local e em
<https://k5-staging.k5-web.workers.dev/app/billing>.

## Configuração

- Produto: `tises-plano-mensal-19900`, R$ 199,00 por pagamento, um mês por escritório.
- Checkout avulso (`ONE_TIME`), com PIX e cartão; não é uma assinatura de renovação automática.
- Webhook: `https://k5-staging.k5-web.workers.dev/api/billing/webhook`.
- Cadastro: `webh_dev_40B2fZXFuuBQGT5MBdEL2drH`, nome `Tises staging`.
- Eventos: `checkout.completed` e `checkout.refunded`.
- `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET` configurados como secrets no Worker.
  Valores não são versionados. A cópia privada operacional está em
  `apps/web/.data/billing/staging-secrets.json` (ignorada pelo Git).
- Implantação das correções: `2dca0eef-518b-4f95-90f6-4c3009c7474f`.

## Evidências

- PIX local: checkout `bill_c6SBPZPRhQB2uwzbcdjQj5Ag`; QR gerado, pagamento simulado,
  retorno para Plano, situação Pago, prazo até 27/10/2026 e comprovante.
- Cartão no staging: checkout `bill_RjuuAt3YPcUrys6fCMKMBr1C`; cartão de teste oficial
  aprovado, retorno HTTPS correto e plano ativo por um mês.
- O webhook público recebeu os eventos reais do sandbox. Requisição sem assinatura foi
  recusada com 401; entrega assinada válida recebeu 204.
- O estorno do cartão foi simulado pela API e o webhook atualizou o checkout para
  REFUNDED, retirando o mês creditado, sem reabrir a página Plano.
- Desktop e viewport de 390 × 844 conferidos; sem rolagem horizontal. Botão de pagamento
  acionado pelo teclado. Recarregar a página não duplicou o período.
- `?pagamento=concluido` sem cobrança paga mostrou “Nenhum novo pagamento confirmado”.
- Primeira tentativa com CPF fictício sequencial foi rejeitada pela AbacatePay com
  `Invalid taxId`; a simulação prosseguiu com um CPF de exemplo válido.

Capturas locais: `apps/web/playwright-report/abacatepay/` (não versionadas).

## Correções e verificações

Corrigidos pedidos simultâneos que criavam cobranças duplicadas, tentativa indevida de criar
produto após indisponibilidade do provedor, respostas vazias/malsucedidas aceitas pelo cliente,
estorno que retirava dias a mais em meses iniciados no dia 31, confirmação visual sem pagamento
e corpo JSON não objeto no webhook.

As quatro regressões de backend foram reproduzidas antes das correções. A suíte passou com
456 testes, incluindo 11 de cobrança: autenticação e repetição concorrente do webhook,
isolamento entre escritórios, confirmação, renovação, estorno e falhas da API.

Passaram `pnpm lint` (um aviso preexistente no transporte judicial), `pnpm typecheck`,
`pnpm test`, `pnpm db:setup`, `pnpm build`, `pnpm --filter @k5/web build:vinext`,
verificação das migrações remotas e dry-run do Wrangler. Builds apresentam avisos existentes
de tracing, tamanho de chunks e source maps. Deploy web preservou os Containers existentes.

## Referências

- [Criar checkout v2](https://docs.abacatepay.com/pages/payment/create)
- [Eventos de checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout)
- [Segurança dos webhooks](https://docs.abacatepay.com/pages/webhooks/security)
- [Dev mode e cartões de teste](https://docs.abacatepay.com/pages/devmode)
- [Secrets no Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/)
