# Ambientes do Lume

O banco transacional é PostgreSQL. O código usa `pg` diretamente nos processos Node e pelo binding `HYPERDRIVE` no Worker web e no Worker de notificações. Conexões de Workers pertencem à requisição e ficam abertas até terminar o streaming. As migrações ficam em `apps/web/db/postgres/`.

| Recurso | Node local / Docker | Cloudflare web | Workers Node do staging |
| --- | --- | --- | --- |
| Banco transacional | `DATABASE_URL` | `HYPERDRIVE` | `DATABASE_URL` para o mesmo banco |
| Migrações e importação | `DATABASE_URL_UNPOOLED` | Executadas antes do deploy | Endpoint direto |
| Originais do Cofre e da Pesquisa | Diretórios locais compartilhados | R2 `VAULT` | Mesmo R2 via credenciais S3 |
| Índice vetorial | PostgreSQL exato ou pgvector | `KNOWLEDGE` (Vectorize) | Mesmo Vectorize via REST |

O filtro de escritório, geração e documentos autorizados continua dentro das consultas. O Hyperdrive deve ter **cache de consultas desativado**: revogação de sessão e permissões precisam consultar o estado atual. [Documentação do cache](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

## Desenvolvimento local

Com PostgreSQL já disponível, configure `DATABASE_URL` e `DATABASE_URL_UNPOOLED` em `apps/web/.env.local`, depois rode na raiz:

```sh
pnpm install
pnpm db:setup
pnpm dev
pnpm worker
pnpm judicial:worker
```

Os dois últimos comandos rodam em terminais separados. OCR e coleta judicial continuam em Node. `K5_ENV_FILE` seleciona o arquivo privado de ambiente dos workers; todos precisam das mesmas chaves de criptografia e do mesmo banco/armazenamento.

Sem servidor PostgreSQL instalado, `pnpm --filter @k5/web db:local` mantém uma instância em loopback na porta 55432. A conexão fica no arquivo privado `apps/web/.data/postgres-migration/dev.env`; copie suas duas variáveis para `.env.local`. O processo deve permanecer ativo enquanto usa o aplicativo. Dados locais anteriores só entram com importação explícita.

`pnpm test` inicia outro PostgreSQL temporário e cria um esquema isolado por fixture. `TEST_DATABASE_URL` é opcional e deve apontar para um servidor de testes onde o usuário possa criar esquemas. Testes não usam o banco do aplicativo.

## Docker

```sh
cp .env.example .env
# Configure BETTER_AUTH_SECRET e K5_CREDENTIALS_KEY.
docker compose up
```

`postgres` guarda os dados transacionais em volume próprio. `vectors` mantém o pgvector opcional. `setup` aplica migrações antes de iniciar `web`, `worker`, `judicial-worker` e `notifications`. O volume `appdata` conserva os originais. `docker compose down` preserva esses volumes.

## Cloudflare

Web: <https://k5-staging.k5-web.workers.dev>. Os recursos de arquivo/vetores existentes continuam sendo `k5-vault-staging` e `k5-knowledge-staging` (1536 dimensões, cosseno). O PostgreSQL é o PlanetScale acessado pelo Hyperdrive; o ID configurado precisa ser o mesmo em todos os `wrangler*.jsonc`. Os scripts de deploy recusam um ID nulo. Veja [PostgreSQL e Hyperdrive](migracao-postgres.md).

```sh
pnpm --filter @k5/web db:migrate
pnpm --filter @k5/web deploy:vinext
pnpm --filter @k5/web notifications:deploy
```

Web usa os bindings `VAULT` e `KNOWLEDGE`. Os processos Node usam `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e, para Vectorize, `CF_ACCOUNT_ID`, `VECTORIZE_INDEX`, `CF_API_TOKEN`. Não coloque credenciais em arquivos versionados.

O deploy web não inicia os workers Node. Sem eles, extração/OCR, embeddings e coleta externa permanecem pendentes. A pesquisa no acervo usa PostgreSQL e não depende de um filesystem dentro do Worker. A ausência de fonte temática habilitada continua sendo apresentada como cobertura parcial.

Originais públicos usam chaves por SHA-256 em `research/sha256/`; leitura confere integridade. A limpeza de órfãos em R2 ainda requer uma rotina de inventário própria; o coletor local não enumera nem apaga objetos remotos. O Vectorize pode demorar para disponibilizar novos vetores, enquanto a busca lexical continua disponível.
