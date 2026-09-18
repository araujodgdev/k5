# Ambientes do K5

Três formas de rodar o K5: local direto, local em Docker e staging na Cloudflare. As três usam o
mesmo código de aplicação; o que muda é para onde apontam os dois adaptadores de infraestrutura.

## Os dois adaptadores

A aplicação não conhece R2, pgvector nem Vectorize. Ela conhece duas interfaces:

| Adaptador | Interface | Responsabilidade |
| --- | --- | --- |
| `src/lib/storage` | `ObjectStorage` | Originais do Cofre. Backends: sistema de arquivos local e R2. |
| `src/lib/knowledge/vector-index` | `VectorIndex` | Vetores das gerações de índice. Backends: SQLite, pgvector e Vectorize. |

Trocar de backend é variável de ambiente, não alteração de código. É também o que permite adiar a
migração para Workers sem bloquear o staging.

O filtro escritório/geração/documento faz parte do contrato de `VectorIndex.query`, e não um corte
aplicado depois do `topK`. Um backend que não conseguisse empurrar os três para dentro da consulta
devolveria menos resultados do que o pedido, ou resultados de outro escritório.

## Variáveis por ambiente

| Variável | Local | Docker | Staging |
| --- | --- | --- | --- |
| `DATABASE_PATH` | `.data/k5.sqlite` | `/data/k5.sqlite` | `/data/k5.sqlite` |
| `VAULT_STORAGE_PATH` | `.data/uploads` | `/data/uploads` | — (usa R2) |
| `VECTOR_INDEX_BACKEND` | ausente (SQLite) | `pgvector` | `vectorize` |
| `VECTOR_DATABASE_URL` | — | container `vectors` | Neon |
| `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — | — | obrigatórias |
| `CF_ACCOUNT_ID`, `VECTORIZE_INDEX`, `CF_API_TOKEN` | — | — | obrigatórias |
| `NEXT_PUBLIC_WEBMCP_ENABLED` | opcional | opcional | opcional |

Sem `VECTOR_INDEX_BACKEND` o índice é o SQLite local: força bruta exata sobre o escopo
selecionado, correta e suficiente para desenvolvimento, inadequada para um acervo real.

## 1. Local, sem Docker

```bash
pnpm install
pnpm db:setup     # cria .env.local com segredos aleatórios e aplica as migrações
pnpm dev          # executa db:setup automaticamente
pnpm worker       # em outro terminal: extração, OCR, embeddings e limpeza
```

O worker é um processo separado de propósito. Ele faz OCR e embeddings, que não podem rodar dentro
de uma requisição de chat.

## 2. Local, com Docker

```bash
cp .env.example .env     # preencha BETTER_AUTH_SECRET e K5_CREDENTIALS_KEY
docker compose up
```

Sobem quatro serviços: `vectors` (pgvector), `setup` (migrações, roda uma vez e sai), `web` e
`worker`. `web` e `worker` só iniciam depois que `setup` termina com sucesso, então nenhum deles
encontra um esquema pela metade.

`docker compose --profile tools up -d adminer` adiciona um console em <http://localhost:8080>.

SQLite e os originais do Cofre dividem o volume `appdata`; `docker compose down` preserva os dois.
`docker compose down -v` apaga ambos.

## 3. Staging na Cloudflare

Recursos já provisionados na conta `bf552f67bcf46921dbe4137ee0ff8980`:

- Índice Vectorize `k5-knowledge-staging`, 1536 dimensões, métrica cosseno, com índices de
  metadados em `generationId` e `documentId`.

O restante exige passos que só uma pessoa pode dar (habilitar o R2 no painel, criar conta na Neon,
gerar tokens). O assistente cobre todos eles:

```bash
bash scripts/staging-setup.sh
```

Ele escreve em `.env.staging` e define os secrets no GitHub. Depois:

```bash
pnpm --filter @k5/web exec tsx scripts/verify-staging.ts
```

A verificação grava, lê e apaga um objeto no R2, um vetor no Vectorize e consulta a Neon. Ela
falha quando o bucket está errado, quando falta permissão no token ou quando a dimensão do índice
não corresponde ao modelo de embedding — situações que, sem ela, só apareceriam durante uma
ingestão real.

### Por que Neon e não "Postgres da Cloudflare"

A Cloudflare não hospeda Postgres. As opções são Hyperdrive na frente de um Postgres externo, o
Postgres da PlanetScale provisionado pelo painel da Cloudflare, ou D1 — que é SQLite e não tem
pgvector. A escolha foi Neon: plano gratuito real, pgvector de primeira classe e bancos por branch,
que depois viram bancos de preview por pull request.

### Latência de indexação do Vectorize

O Vectorize aceita o upsert e só torna o vetor consultável alguns segundos depois — medimos cerca
de 22 segundos numa verificação de ponta a ponta. Duas consequências:

- A publicação de uma geração conta o **livro-razão** em `vault_document_chunk_vector`, escrito
  pelo worker em toda ingestão, e não uma resposta do índice. "O índice aceitou" não é sinal de
  que a consulta já enxerga o vetor. Uma tarefa em `failed` impede a publicação: promover uma
  geração incompleta aposentaria um índice completo em troca de um que omite documentos sem
  dizer. Reenfileirar o documento é o caminho de recuperação.
- Uma busca feita na janela entre o upsert e a indexação não encontra o vetor. Ela degrada para
  lexical e diz por quê, em vez de afirmar que não há evidência.

## O que ainda não está feito

- **A aplicação não roda em Workers.** `node:sqlite`, uploads em disco e o laço do worker são de
  Node. Os adaptadores existem para que essa migração seja mecânica, mas ela não foi feita.
- **Não há workflow de deploy.** O CI roda lint, typecheck, test e build em cada pull request, e
  recusa alterações em migrações já aplicadas. Publicar em staging ainda é manual.
- **Hyperdrive é opcional hoje.** Enquanto a aplicação for Node, o adaptador pgvector fala direto
  com a Neon. Hyperdrive passa a importar quando houver Workers.
