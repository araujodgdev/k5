# PostgreSQL e Hyperdrive

## Escopo

Better Auth, escritórios, Cofre, conversas, agenda, notificações, filas e Pesquisa usam PostgreSQL em todos os runtimes. As migrações ficam em `apps/web/db/postgres/`; novas migrações são acrescentadas e nunca reescrevem arquivos já aplicados.

A busca textual usa `tsvector`, índices GIN e configuração portuguesa. Datas instantâneas usam `timestamptz`; datas civis mantêm seu significado. Revisões externas são preservadas como identidade textual. Filas usam `FOR UPDATE SKIP LOCKED` nas reservas. R2 e Vectorize continuam independentes do banco transacional.

## Hyperdrive

O Hyperdrive aponta para o endpoint direto do PostgreSQL, com `caching.disabled=true`, e o mesmo ID fica em todos os `apps/web/wrangler*.jsonc`. [Driver e binding oficiais](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/).

Preserve `BETTER_AUTH_SECRET`, `K5_CREDENTIALS_KEY` e o chaveiro anterior: trocá-los impede recuperar credenciais cifradas ou validar sessões existentes.

## Operação

O staging usa PlanetScale em São Paulo e Containers Cloudflare para documentos e pesquisa. Configuração, credenciais e rotina de publicação estão em [processadores-cloudflare.md](processadores-cloudflare.md).

`db:setup` prepara desenvolvimento. `db:migrate` usa o endpoint direto (`DATABASE_URL_UNPOOLED` em `apps/web/.env.postgres.local`), uma transação e lock de migração; checksums impedem alterações silenciosas em migrações já aplicadas. `deploy:vinext` exige Hyperdrive configurado e executa migrações antes de publicar. As migrações do Better Auth devem ser revisadas: `scripts/dump-auth-schema.ts` apenas gera `.data/auth-schema-review.sql`.

O Durable Object `LumeProcessor` usa o armazenamento SQLite interno que a Cloudflare exige para Containers; ele guarda só metadados de orquestração, nunca dados de negócio.
