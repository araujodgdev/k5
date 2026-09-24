# Worker Previews do Lume

O preview inicial é **refactor**:
<https://refactor-k5-staging.k5-web.workers.dev>.
Ele pertence ao Worker `k5-staging`, mas tem deploy, secrets e recursos próprios.
O comando abaixo publica somente esse preview:

```sh
pnpm preview:deploy --name refactor
```

O fluxo confere o destino do Hyperdrive e as conexões PostgreSQL, verifica/aplica
as migrações no banco do preview, gera o service worker, compila com vinext e
executa `wrangler preview --ignore-base-config --secrets-file ...`.
Não chama o script de publicação de staging. Execute na raiz do repositório.

Para conferir o banco sem migrar, compilar ou publicar:

```sh
pnpm preview:deploy --name refactor --check
```

## Recursos e isolamento

O perfil público fica em `apps/web/previews/refactor.json`:

| Recurso | Destino |
| --- | --- |
| PostgreSQL | PlanetScale `araujodgdev/lume`, branch `k5-preview-refactor`, São Paulo |
| Hyperdrive | `k5-preview-refactor`, cache de consultas desligado |
| R2 | `k5-preview-refactor-vault` |
| Vectorize | `k5-preview-refactor-knowledge`, 1536 dimensões, cosseno |
| Observabilidade | Workers Logs/Traces do preview e ambiente Sentry `preview-refactor` |

A branch PostgreSQL começou vazia; as migrações criam seu esquema.
Contas, sessões, documentos, arquivos e configurações de IA são independentes.
Use **Criar conta** no preview. Uma conta do staging não dá acesso ao preview.
Os buckets permanecem privados; o aplicativo continua autorizando acesso por sessão/escritório.
O Hyperdrive usa a integração gerenciada existente entre Cloudflare e PlanetScale.

Arquivos privados ficam em `apps/web/.data/previews/refactor/`, ignorados pelo Git:

- `database.env`: `DATABASE_URL` de leitura/escrita e `DATABASE_URL_UNPOOLED`
  administrativa, ambas diretas para a branch de preview e com `sslmode=verify-full`.
- `secrets.json`: `BETTER_AUTH_SECRET` e `K5_CREDENTIALS_KEY`, gerados uma vez e
  preservados nos próximos deploys. Guarde uma cópia segura; não apague para republicar.
- `wrangler.json`: configuração de build gerada exclusivamente a partir do perfil.

A credencial administrativa inicial tem validade de 24 horas. Um deploy sem novas
migrações usa apenas a credencial de leitura/escrita. Para novas migrações após o
vencimento, emita outro papel `postgres` **na branch do preview** e atualize somente
`DATABASE_URL_UNPOOLED` no arquivo privado. Nunca copie a URL administrativa de staging.

O script rejeita conexões com papel de outra branch, TLS inadequado ou parâmetros
extras, recursos com nomes de staging e Hyperdrive com destino divergente/cache ativo.
Os secrets da configuração base remota são ignorados. Só as duas chaves próprias
do preview são enviadas; OAuth, VAPID e credenciais de processadores não são enviados.

## Escopo desta primeira etapa

`src/workers/web-preview.ts` expõe somente HTTP, usando o mesmo aplicativo vinext.
Não exporta classes de Containers nem handlers de Cron/Queue. A configuração não
contém service bindings, Workflows, Containers ou filas.

Login, páginas autenticadas, agenda, clientes e operações HTTP com banco/arquivos
podem ser validados. Uploads podem guardar originais, mas extração, OCR, embeddings,
coleta judicial e geração assíncrona ficam pendentes. Notificações externas e
sincronização Google não executam. O chat depende de uma conexão de IA configurada
no próprio banco do preview; as chaves existentes não são copiadas.

Use a URL estável acima para autenticação: `BETTER_AUTH_URL` corresponde exatamente
a ela. URLs de deployments individuais não foram incluídas nas origens de login.

## Outros previews

Esta entrega não cria recursos automaticamente em cada push nem configura CI.
Para cada novo preview, provisione recursos separados antes de publicar:

1. Escolha um nome de 2–32 caracteres, com letras minúsculas, números e hífens.
2. Crie a branch PostgreSQL `k5-preview-<nome>` na região `aws-sa-east-1`, sem seed
   de dados, e aguarde ficar pronta. Emita papéis de migração (`postgres`) e runtime
   (`pg_read_all_data,pg_write_all_data`) nessa branch.
3. Crie um Hyperdrive para essa branch, com cache desligado, além do bucket privado
   `k5-preview-<nome>-vault` e índice `k5-preview-<nome>-knowledge` (1536/cosseno).
4. Crie `apps/web/previews/<nome>.json` seguindo o perfil existente, com os IDs reais.
   Informe o ID da **nova branch**, não o de `main`.
5. Salve as URLs em `apps/web/.data/previews/<nome>/database.env` e execute
   `pnpm preview:deploy --name <nome>`.

Sem `--name`, o comando deriva um nome estável da branch Git com hash para evitar
colisões, e exige que exista o perfil correspondente. Em `main`, `master` ou
detached HEAD, exige `--name`. O build usa `apps/web/dist` e gera tipos em `.next/types`;
não rode deploys, `pnpm build` ou `pnpm typecheck` simultaneamente no mesmo checkout.
Next.js e vinext geram formatos diferentes nesse diretório. Os próximos deploys
preservam os dados e os secrets do preview.

Os tipos de bindings do preview foram gerados por:

```sh
pnpm --filter @k5/web exec wrangler types --config .data/previews/refactor/wrangler.json --include-runtime=false --env-interface=PreviewEnv --strict-vars=false preview-configuration.d.ts
```

## Encerramento

Excluir o Worker Preview não remove PostgreSQL, Hyperdrive, R2 ou Vectorize.
Quando o ambiente não for mais necessário, remova explicitamente o preview e
os recursos exclusivos listados no perfil, após preservar quaisquer dados úteis.
Não remova `k5-staging`, a branch `main` ou os recursos com sufixo `staging`.
Os recursos provisionados seguem a cobrança dos respectivos serviços enquanto existirem.

Referências: [Worker Previews](https://developers.cloudflare.com/workers/previews/),
[configuração](https://developers.cloudflare.com/workers/previews/configuration/) e
[isolamento e limitações](https://developers.cloudflare.com/workers/previews/resources/).
