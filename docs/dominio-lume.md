# Domínio lume.software

Configuração conferida em 29/09/2026.

| Domínio | Worker existente |
| --- | --- |
| `lume.software` | `lume` |
| `integrations.lume.software` | `lume-integrations` |
| `notifications.lume.software` | `lume-notifications` |

Os arquivos Wrangler usam esses nomes e domínios. Banco, filas, buckets, índices,
Containers e chaves criptográficas existentes foram preservados. A alteração remota
usou atualizações de secrets, sem republicar o código da aplicação.

## Configuração aplicada

- `BETTER_AUTH_URL=https://lume.software` no web e em integrações.
- `GOOGLE_OAUTH_REDIRECT_URI=https://lume.software/api/integrations/google/callback` no web.
- `GOOGLE_CALENDAR_WEBHOOK_URL=https://lume.software/api/integrations/google/notify` no web e em integrações.
- Cliente Google OAuth existente: origem e callback publicados substituídos pelo novo domínio; localhost preservado.
- Google Auth: domínio autorizado e homepage `https://lume.software` confirmados. O aplicativo permanece em Testing. A chave Picker existente não tinha restrições por hostname, portanto não precisava de substituição de referrer.
- Webhook Zernio existente: `https://lume.software/api/whatsapp/webhook`, preservando segredo, eventos e escopo.
- AbacatePay: webhook v2 **Lume sandbox**, `webh_dev_Drz5LPqkPBmZUCwKjmG5W2p4`, em `https://lume.software/api/billing/webhook`, usando o segredo existente. Eventos: `checkout.completed`, `checkout.refunded`, `subscription.completed`, `subscription.renewed`, `subscription.cancelled` e `subscription.payment_failed`.

Os dois webhooks antigos da AbacatePay continuam cadastrados no hostname antigo.
O painel só permite excluir, não editar, e seus registros históricos foram preservados.
O webhook do outro aplicativo, Plik, não foi alterado.

## AbacatePay em produção: pendente

A loja atual, **Plik**, informa que a produção exige aceite dos termos e verificação
documental da empresa, com análise de até sete dias úteis. O fluxo foi aberto para
o titular concluir. Nenhuma cobrança foi criada e a chave publicada continua em sandbox.

Após aprovação, configurar uma chave de produção para o Lume no secret
`ABACATEPAY_API_KEY` do Worker `lume` e cadastrar o webhook no ambiente de produção,
com o segredo correspondente em `ABACATEPAY_WEBHOOK_SECRET`. As permissões usadas
pelo módulo financeiro estão em [Administração financeira](administracao-financeira.md).
Não substituir a chave local de desenvolvimento por uma chave de produção.

## Validação

- `pnpm lint`: passou, com um aviso preexistente em `src/lib/judicial/connectors/transport.ts`.
- `pnpm typecheck`: passou.
- `pnpm test`: 646 testes passaram, nenhuma falha.
- `pnpm build` e `pnpm --filter @k5/web build:vinext`: passaram.
- Tipos Wrangler regenerados, sem alteração de conteúdo.
- Dry runs dos três Workers passaram. O web usou `--containers-rollout=none`, pois o Docker local não estava disponível; nenhuma imagem de Container foi alterada.
- `pnpm db:setup`: falhou na conexão/configuração do PostgreSQL local. Os testes usaram seu PostgreSQL temporário e os builds concluíram; nenhuma migração remota foi executada.
- HTTPS: homepage, sign-in e endpoint de sessão responderam 200. Os Workers de fundo responderam 404, conforme seus handlers.
- Webhooks sem assinatura foram recusados. O segredo existente da AbacatePay foi validado com corpo inválido assinado, recusado antes de processar eventos financeiros.

As verificações HTTP não substituem um login completo, consentimento Google ou
entrega real de evento do provedor. Cookies, instalação PWA e permissão de notificações
do hostname antigo não migram para o novo domínio.

Referência: [Custom Domains na Cloudflare](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
