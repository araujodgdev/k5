# Migração transacional para PostgreSQL e Hyperdrive

## Escopo

Better Auth, escritórios, Cofre, conversas, agenda, notificações, filas e Pesquisa usam PostgreSQL. SQLite/D1 ficam somente como formatos de origem do importador. `db/migrations/0000–0020` é o histórico congelado; novas migrações são acrescentadas a `apps/web/db/postgres/` e nunca reescrevem arquivos já aplicados.

A busca textual usa `tsvector`, índices GIN e configuração portuguesa. Datas instantâneas usam `timestamptz`; datas civis mantêm seu significado. Revisões externas são preservadas como identidade textual. Filas usam `FOR UPDATE SKIP LOCKED` nas reservas. R2 e Vectorize continuam independentes do banco transacional.

## Preparação e ensaio

1. Reserve um PostgreSQL vazio para o ambiente. Em Neon, faça o ensaio em branch separado. Salve a URL **direta** em `apps/web/.env.postgres.local` como `DATABASE_URL_UNPOOLED`; não envie senhas pelo chat ou Git.
2. Preserve `BETTER_AUTH_SECRET`, `K5_CREDENTIALS_KEY` e o chaveiro anterior. A migração conserva hashes de senha, sessões e credenciais cifradas; trocar essas chaves durante o corte impediria recuperar credenciais ou validar sessões.
3. Exporte o D1 incluindo todas as tabelas lógicas, inclusive autenticação. FTS5 e suas tabelas internas não devem entrar: a busca será reconstruída. Uma exportação filtrada por tabela não contém índices; o importador restaura os índices legados em uma base temporária antes de conferir as relações.
4. Execute a importação contra o destino vazio:

```sh
pnpm --filter @k5/web db:import --source .data/backup-staging.sql --env-file .env.postgres.local
# Para uma cópia SQLite local:
pnpm --filter @k5/web db:import --source .data/k5.sqlite --env-file .env.postgres.local
```

O importador aplica o esquema, exige tabelas vazias, insere com constraints adiadas dentro de uma única transação, compara contagens e checksums por tabela, reconstrói o FTS, confere todas as chaves estrangeiras e só então faz commit. O relatório `*.postgres-report.json` contém contagens/checksums, sem conteúdo das linhas. Uma importação que falha não deixa dados parcialmente copiados. Arquivos de origem permanecem intactos.

## Corte do staging

1. Compile e valide antes da janela. Registre as versões atuais de web/notificações, bindings, variáveis, chaves e backups.
2. Coloque o web em manutenção e pause todos os produtores/consumidores que escrevem no D1, incluindo cron e filas. Aguarde requisições e leases em andamento. **Não use o snapshot do ensaio como cópia final se houve novas escritas.**
3. Tire a exportação final consistente. Importe em um destino vazio e confira o relatório. Se a cópia de ensaio já contém dados, use outro banco/branch vazio; o importador não sobrescreve o destino.
4. Crie o Hyperdrive contra o endpoint direto do mesmo PostgreSQL, com `caching.disabled=true`. Configure o mesmo ID em `apps/web/wrangler.jsonc` e `apps/web/wrangler.notifications.jsonc`. [Driver e binding oficiais](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/).
5. Configure os workers Node com o mesmo banco, bucket R2, índice Vectorize e chaveiro. Copie também quaisquer originais de Pesquisa que só existam em disco para as mesmas chaves no R2; mudar metadados SQL não transfere arquivos.
6. Publique web e notificações, inicie os workers Node e valide login existente, logout global, chat em streaming, upload/extração, busca do acervo, uma coleta externa habilitada e entrega de notificações. Confirme eventos controlados no Sentry sem dados de clientes.
7. Retire a manutenção somente após os checks. Preserve D1 e backups durante a janela de observação; não remova a origem automaticamente.

## Reversão

Antes de liberar novas escritas em PostgreSQL, é possível restaurar as versões e bindings antigos e reabrir o D1 consistente. Depois de novas escritas em PostgreSQL, uma simples troca de binding perderia essas alterações: mantenha manutenção, reconcilie os dados e valide uma cópia de retorno antes de reabrir. Não há dual-write nem conversão reversa automática.

## Operação

O staging usa PlanetScale em São Paulo e Containers Cloudflare para documentos e pesquisa. Configuração, credenciais e rotina de publicação estão em [processadores-cloudflare.md](processadores-cloudflare.md).

`db:setup` prepara desenvolvimento. `db:migrate` usa o endpoint direto, uma transação e lock de migração; checksums impedem alterações silenciosas em migrações já aplicadas. `deploy:vinext` exige Hyperdrive configurado e executa migrações antes de publicar. As migrações do Better Auth devem ser revisadas: `scripts/dump-auth-schema.ts` apenas gera `.data/auth-schema-review.sql`.

Não existe fallback silencioso para SQLite. `DATABASE_PATH` deixa de selecionar o banco do aplicativo. Os arquivos SQLite originais podem ser guardados como backup sem serem utilizados pelo runtime.
