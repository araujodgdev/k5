# Ambientes do Lume

Três formas de rodar o Lume: local direto, local em Docker e staging na Cloudflare. As três usam o
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
| `DATABASE_PATH` | `.data/k5.sqlite` | `/data/k5.sqlite` | — (usa binding D1 `DB`) |
| `VAULT_STORAGE_PATH` | `.data/uploads` | `/data/uploads` | — (usa R2) |
| `VAULT_STORAGE_BACKEND` | ausente (arquivos) | ausente (arquivos) | `r2` |
| `VECTOR_INDEX_BACKEND` | ausente (SQLite) | `pgvector` | `vectorize` |
| `VECTOR_DATABASE_URL` | — | container `vectors` | — |
| `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — | — | somente worker Node/diagnóstico; o Worker web usa `VAULT` |
| `CF_ACCOUNT_ID`, `VECTORIZE_INDEX`, `CF_API_TOKEN` | — | — | somente worker Node/diagnóstico; o Worker web usa `KNOWLEDGE` |
| `NEXT_PUBLIC_WEBMCP_ENABLED` | opcional | opcional | opcional |

Sem `VECTOR_INDEX_BACKEND` o índice é o SQLite local: força bruta exata sobre o escopo
selecionado, correta e suficiente para desenvolvimento, inadequada para um acervo real.
No Worker, `VECTOR_INDEX_BACKEND=vectorize` usa diretamente o binding `KNOWLEDGE`; as credenciais
REST acima existem apenas para processos Node e para `verify-staging.ts`.

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

Staging web: <https://k5-staging.k5-web.workers.dev>. Recursos provisionados na conta
`bf552f67bcf46921dbe4137ee0ff8980`:

- Worker `k5-staging`;
- D1 `k5-staging`;
- R2 `k5-vault-staging`;
- Vectorize `k5-knowledge-staging`, 1536 dimensões, métrica cosseno.

Os bindings web dispensam chaves REST. `verify-staging.ts` continua disponível para diagnosticar
acesso S3/REST dos processos Node quando essas credenciais forem configuradas:

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

## O que ainda roda fora do Worker web

- **OCR, extração e trabalhos de IA.** `scripts/worker.ts` continua Node porque a pilha de OCR
  inclui módulo nativo. Sem esse processo, os uploads ficam enfileirados, embora seus originais
  permaneçam duráveis no R2.
- **Coleta judicial.** `scripts/judicial-worker.ts` continua sendo um processo Node separado.
- **Automação dos workers de fundo.** Levar esses laços para Cloudflare requer Queues/Workflows,
  Cron Triggers e, para OCR, um serviço compatível ou externo. O deploy do Worker web já é
  executável por `pnpm --filter @k5/web deploy:vinext`.
