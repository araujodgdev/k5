# Deploy na Cloudflare: o que existe e o que falta

Data: 20/09/2026. Acompanha [ambientes.md](ambientes.md), que descreve os três modos de execução, e
registra a migração para Cloudflare Workers via [vinext](https://vinext.dev).

O alvo escolhido é **Workers**, não Containers. A decisão tem consequências que este documento
registra antes de qualquer instrução, porque elas definem o tamanho do trabalho.

## Por que Containers não era opção

A conta está no plano **Workers Free**. A própria API recusa:

```
Unauthorized: You do not have access to Cloudflare Containers.
Deploying containers requires the Workers Paid plan.
```

E mesmo com o plano pago, [o disco de um Container é
efêmero](https://developers.cloudflare.com/containers/faq/): quando a instância hiberna, a próxima
parte de um disco novo, igual à imagem. O `Dockerfile` deste repositório grava
`DATABASE_PATH=/data/k5.sqlite`. Em Containers, esse arquivo desapareceria a cada hibernação —
usuários, escritórios, sessões, Cofre e base judicial junto.

## O que foi provisionado

Recursos criados na conta `bf552f67bcf46921dbe4137ee0ff8980`:

| Recurso | Nome | Identificador |
| --- | --- | --- |
| D1 (banco transacional) | `k5-staging` | `18fcfe5d-05f3-4750-bae2-85731c80884b` |
| R2 (originais do Cofre) | `k5-vault-staging` | região WNAM |
| Vectorize (vetores) | `k5-knowledge-staging` | 1536 dimensões, cosseno (já existia) |

Ligados por binding em [`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc), não por URL e
chave. Um binding carrega a própria autorização, então nenhuma credencial de staging precisa
existir em arquivo de ambiente para a aplicação alcançar o próprio armazenamento.

Não há binding de cache, de propósito. O K5 serve dados autenticados por escritório, e um cache de
borda na frente de resposta dinâmica multi-inquilino é como um escritório passa a ler o do outro.

## O que foi verificado

**O esquema inteiro roda em D1.** As 12 migrações aplicam sem erro: 139 queries, 56 tabelas, 54
índices, 3 triggers. D1 é SQLite, então `db/migrations/*.sql` valem sem tradução de dialeto.

Dois pontos foram testados contra o banco remoto porque eram os que podiam quebrar em silêncio:

- **FTS5 com dobra de diacríticos.** Uma busca por `peticao` encontra o registro gravado como
  `petição`. É a metade lexical da busca híbrida, e é o comportamento de que texto jurídico em
  português depende.
- **Cascade e triggers.** Apagar um `office` limpa documento, chunk e o índice FTS derivado, sem
  sobra. As chaves estrangeiras são aplicadas e a cadeia de triggers dispara.

**O esquema do Better Auth virou migração.** Antes ele era gerado em runtime pelo migrador Kysely,
que exige um handle Node sobre um arquivo SQLite — coisa que D1 não oferece no deploy. Agora está
em [`0000_auth.sql`](../apps/web/db/migrations/0000_auth.sql), gerado por
[`dump-auth-schema.ts`](../apps/web/scripts/dump-auth-schema.ts) e versionado, o que também torna
uma mudança de esquema de autenticação revisável em diff.

**A superfície Next.js é compatível.** `vinext check` reporta 87%, com Better Auth aprovado. Os
dois problemas apontados eram `"type": "module"` ausente e um `__dirname` em `record-system-live.ts`.

**O bundle compila.** `vinext build` percorre as cinco etapas e emite `dist/client` e
`dist/server`, com as 48 rotas de API e as 13 páginas no manifesto. O `wrangler.json` gerado
carrega os três bindings.

### O barrel `radix-ui` derrubava o build

Vale registrar, porque o sintoma não apontava para a causa. O build morria em um módulo Rust
nativo com `memory allocation failed` e saída `0xC0000409`, sem nome de arquivo — e não era falta
de memória: falhava ao alocar 200 KB com 7 GB livres.

O gatilho era `import { Slot } from "radix-ui"` dentro de `src/app/not-found.tsx`. Nem o arquivo
nem o componente sozinhos: a combinação do barrel unificado do Radix com um arquivo especial do
Next. O mesmo import direto de `@radix-ui/react-slot` compila. `ui/button.tsx` passou a usar o
pacote primitivo, que agora é dependência explícita.

Isso também explica por que remover `(auth)`, `app`, `platform` ou `api` não adiantava: o
`not-found.tsx` estava presente em todas essas tentativas.

## O que ainda bloqueia

| Bloqueio | Natureza |
| --- | --- |
| Camada de dados síncrona | 264 statements preparados em 36 arquivos usam `node:sqlite` `DatabaseSync`. D1 é assíncrono: cada chamada vira `await`. **É o bloqueio principal: o bundle compila, mas ainda fala com `node:sqlite`.** |
| Transações interativas | `BEGIN IMMEDIATE`/`COMMIT` e SAVEPOINTs em 5 arquivos. D1 não tem transação interativa, só `batch()`. Reivindicar job na fila, gravar uma corrida de coleta e remover documento com tombstone precisam virar CAS com `RETURNING` ou lote atômico — é redesenho, não `await` mecânico. |
| OCR e extração | `@napi-rs/canvas` é nativo e não roda em workerd; `pdfjs-dist` e `tesseract.js` vão junto. Essas etapas continuam no worker Node. |
| Laço do worker | `scripts/worker.ts` e `judicial-worker.ts` são processos longos. Em Workers viram Cron Triggers e Queues. |
| Credenciais de deploy | O canal autenticado disponível não tem permissão para emitir tokens (`9109`). `wrangler deploy` precisa de `wrangler login` ou de um token criado no painel. |

## Ordem do trabalho restante

1. Abrir uma costura de banco assíncrona, no mesmo padrão de adaptador que `ObjectStorage` e
   `VectorIndex` já usam, com dois backends: `node:sqlite` para testes e worker, D1 para Workers.
2. Converter os 264 statements, redesenhando as cinco fronteiras transacionais.
3. Backend de `ObjectStorage` sobre binding R2, ao lado do backend S3 que já existe.
4. Worker: Cron e Queues para o que roda em Workers; o que precisa de OCR fica em Node.
5. `wrangler secret put` para `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `K5_CREDENTIALS_KEY`,
   seguido de `wrangler deploy`.

Até o passo 2 estar feito, publicar não adianta: o Worker compila, sobe e falha na primeira
consulta, porque `node:sqlite` não existe em workerd. Um deploy antes disso produziria uma URL que
responde erro em toda rota autenticada.

## Notas de configuração

`"type": "module"` em `apps/web/package.json` é exigência do Vite. Sob ESM, o Node 26 quebra ao
traduzir algumas dependências CommonJS (`ERR_INTERNAL_ASSERTION` em `loadCJSModuleWithModuleLoad`),
o que derrubava 4 arquivos de teste. Como o formato de módulo é decidido pelo `package.json` mais
próximo, [`tests/package.json`](../apps/web/tests/package.json) marca a pasta como `commonjs` e a
suíte volta ao carregador em que já passava.

`empty-stub.js` substitui `@napi-rs/canvas` no bundle. Ele lança em vez de devolver um canvas
vazio: uma página em branco vinda de rasterização silenciosa pareceria uma página sem texto.
