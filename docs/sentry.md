# Sentry no Lume

Projeto: [lume-wr/lume](https://lume-wr.sentry.io/settings/projects/lume/).
O DSN público está em `apps/web/src/lib/observability/settings.ts`:

```text
https://15cd1d8f7f94c876898fb0a083bcc691@o4512130022834176.ingest.us.sentry.io/4512130123169792
```

Esse endereço permite enviar eventos; não permite ler dados, administrar o projeto ou publicar
source maps. O token `SENTRY_AUTH_TOKEN` é secreto e separado.

## Cobertura

| Runtime | Inicialização e captura |
| --- | --- |
| Navegador, Next.js e vinext | `src/instrumentation-client.ts`: erros globais, rejeições, carregamento e navegação; os `error.tsx` existentes e `global-error.tsx` reportam falhas de renderização |
| Next.js Node/Edge | `src/instrumentation.ts`, `sentry.server.config.ts` e `sentry.edge.config.ts`: requisições, Server Components e erros de ações/rotas via `onRequestError` |
| Web Cloudflare | `src/workers/web.ts`: `withSentry` isola cada requisição e aguarda o envio com o contexto do Worker; erros capturados pelo vinext usam `onRequestError` |
| Documentos, judicial e notificações em Node | `scripts/sentry-worker.ts`: inicialização antes dos módulos da aplicação, spans das tarefas, falhas capturadas e envio antes do encerramento |
| Notificações Cloudflare | `src/workers/notifications.ts`: captura de Cron/Queue e falhas antes de pedir nova tentativa |

Falhas operacionais tratadas em APIs, documentos, indexação, verificação, coleta e entrega final
de push usam `captureOperationalError`. Essa função preserva classe e localização da falha,
substituindo mensagens externas por uma mensagem técnica estável. Não passe prompts, documentos,
credenciais, corpos HTTP ou dados de clientes como tags, extras ou mensagens de erro.

## Ambientes e privacidade

Erros são coletados integralmente quando o SDK está ativo. Traces usam amostragem de 10%.
Desenvolvimento e testes não enviam eventos por padrão; Docker local também começa desativado.
Cloudflare usa `staging`. Para ligar ou desligar explicitamente, use `SENTRY_ENABLED` e,
no build do navegador, `NEXT_PUBLIC_SENTRY_ENABLED` (`true` ou `false`).

As variáveis de ambiente, release e amostragem possuem as mesmas versões `SENTRY_*` e
`NEXT_PUBLIC_SENTRY_*`; veja `apps/web/.env.example`. Valores públicos são fixados no build:
alterá-los exige recompilar. `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` substituem o destino;
uma string vazia desativa o envio desse runtime.

`src/lib/observability/privacy.ts` desativa identidade, cookies, cabeçalhos, corpos HTTP,
parâmetros de URL, variáveis locais, dados de consultas e entradas/saídas de IA. Também remove
extras, breadcrumbs de console/DOM e contextos de negócio. URLs são reduzidas ao caminho e
UUIDs são substituídos; os eventos pedem ao Sentry para não inferir o IP. O Sentry ainda pode
enriquecer eventos com localização aproximada. Revisão das regras de scrubbing no painel
continua necessária se a política do escritório exigir eliminar também esse enriquecimento.

Replay, logs centralizados, métricas customizadas e conteúdo de IA ficam desativados.
O contexto de rastreamento do navegador só segue para a mesma origem; servidores não repassam
`sentry-trace`/`baggage` a providers de IA ou tribunais.

## Source maps e releases

Salve o token de organização em `apps/web/.env.sentry-build.local`:

```dotenv
SENTRY_AUTH_TOKEN=<token de organização>
```

O arquivo é ignorado pelo Git e excluído do contexto Docker. O build lê esse arquivo somente
na configuração de build. Nunca use `NEXT_PUBLIC_SENTRY_AUTH_TOKEN`, argumentos Docker ou
variáveis de runtime para o token.

`pnpm build` envia os mapas do Next.js e remove os mapas públicos após upload.
`pnpm --filter @k5/web build:vinext` envia mapas dos ambientes RSC, SSR e navegador, removendo
os mapas de `dist/client`. Os mapas do servidor ficam disponíveis para o upload da Cloudflare.
Sem token, esses builds locais continuam, mas não enviam mapas. Use
`SENTRY_REQUIRE_SOURCEMAPS=true` para exigir o upload. Falhas de upload interrompem o build.

O CI recebe o secret `SENTRY_AUTH_TOKEN` do repositório `araujodgdev/k5` somente em pushes para
`main`; builds de pull requests não recebem o token. O SHA do commit identifica a release.
Os comandos de publicação exigem o token. Publique o artefato do mesmo build que enviou os mapas.

Para notificações, `pnpm --filter @k5/web notifications:build` gera
`build/notifications/notifications.js` e seu mapa, injeta debug IDs e envia os dois arquivos.
`notifications:deploy` faz isso e publica exatamente o bundle instrumentado, sem novo bundling.
Os Workers também possuem `CF_VERSION_METADATA` e enviam a versão da Cloudflare como release.
Workers Node fora do build devem receber `SENTRY_RELEASE` com o identificador implantado.

No Docker, forneça o token por BuildKit:

```sh
docker build -f apps/web/Dockerfile --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
  --build-arg SENTRY_RELEASE=<sha> -t lume .
```

## Verificação

Na raiz do monorepo:

```sh
pnpm --filter @k5/web sentry:verify
pnpm build
pnpm --filter @k5/web start --port 3105
# Outro terminal; BASE_URL permite apontar para o staging.
pnpm --filter @k5/web sentry:verify:browser
```

O primeiro comando envia um erro e um trace sintéticos no ambiente `verification`, sem
acessar o banco. O segundo teste usa a tela de entrada em desktop/mobile, verifica teclado,
ausência de overflow, continuidade do trace servidor/navegador e que query/formulário não
apareçam no envelope enviado. Suas capturas
ficam em `apps/web/playwright-report/sentry/` (ignorado).

Para verificar o transporte real do runtime Cloudflare, sem executar filas de negócio:

```sh
pnpm --filter @k5/web exec wrangler dev scripts/verify-sentry-cloudflare.ts \
  --config wrangler.notifications.jsonc --port 8798 --local
curl http://127.0.0.1:8798/
```

Esse Worker de teste é independente e não é referenciado pelas configurações de publicação.
Confirme os IDs retornados em [Issues](https://lume-wr.sentry.io/issues/?project=4512130123169792)
e os traces em [Explore](https://lume-wr.sentry.io/explore/traces/?project=4512130123169792).
Um `flush` bem-sucedido significa que a fila foi processada; a confirmação definitiva é
encontrar o evento no Sentry. Os testes sintéticos não representam incidentes do produto.

## Validação inicial — 22/09/2026

- Web publicado em [staging](https://k5-staging.k5-web.workers.dev), versão Cloudflare
  `20c9c62b-26ea-4444-8d42-7fe57755e8dd`; notificações em
  `ba075025-a433-401a-854b-17220e8b5f54`, preservando os secrets e as variáveis existentes.
- Source maps enviados nos builds Next.js, vinext (RSC/SSR/client) e notificações. O secret
  `SENTRY_AUTH_TOKEN` foi configurado no GitHub; o workflow atualizado rodará após o push.
- `pnpm lint`, `pnpm typecheck`, 218 testes, `pnpm build`, `build:vinext` e
  `notifications:build` concluídos. Há avisos de lint no script de auditoria em `.data/`,
  tracing de filesystem no Next.js e mapas de módulos virtuais do vinext; nenhum impediu o build.
- Testes reais do navegador em 1440px/390px passaram no Next.js e no staging, incluindo
  privacidade e continuidade de trace. Requisição pública retornou 200; API protegida sem
  sessão retornou 401. Eventos e traces de web/queue foram confirmados no Sentry.
- Varredura dos artefatos não encontrou o token de autenticação. A imagem Docker não foi
  compilada nesta validação; o runtime Cloudflare foi publicado e verificado.

Referências: [Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/),
[Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/),
[scrubbing](https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/sensitive-data/).
