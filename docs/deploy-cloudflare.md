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

## A camada de dados agora é assíncrona

A costura está em [`src/lib/db/types.ts`](../apps/web/src/lib/db/types.ts), no mesmo padrão de
adaptador que `ObjectStorage` e `VectorIndex` já usam, com dois backends:
[`d1.ts`](../apps/web/src/lib/db/d1.ts) em Workers e
[`node-sqlite.ts`](../apps/web/src/lib/db/node-sqlite.ts) para testes, desenvolvimento e o worker
Node. [`database.ts`](../apps/web/src/lib/database.ts) escolhe um na primeira consulta, e o ponto
de chamada não muda: `await database.prepare(...)` lê igual nos dois.

As interfaces mantêm de propósito a forma de argumentos do `node:sqlite` — `get(...params)`,
`all(...params)`, `run(...params)` — e o SQL não muda: os dois backends usam `?`. Isso importa
mais do que parece, porque esses statements carregam o escopo por `office_id` que impede um
escritório de ler o do outro, e reescrevê-los à mão é como isso se quebra.

**As fronteiras transacionais foram redesenhadas, não adaptadas.** D1 não tem transação
interativa, então nenhuma delas continua sendo um bloco entre `BEGIN` e `COMMIT`:

| Fronteira | Substituição |
| --- | --- |
| Reivindicar documento, job de indexação ou job de coleta | `UPDATE ... RETURNING` condicional: um sub-select escolhe a linha e o `WHERE` externo reconfere a mesma condição, num único statement. Dois workers não saem os dois com a concessão. |
| Reservar orçamento de requisições | Upsert com `WHERE` no `DO UPDATE`: o limite diário e o espaçamento são conferidos dentro do próprio incremento. Recusa não escreve nada e não devolve linha. |
| Escritas que precisam cair juntas (documento + versão, pasta + filhos, tombstone + índice, corrida + citações, geração + aposentadoria da anterior) | `batch()`, que é atômico. |
| Recriptografar segredos com a chave nova | A recriptografia acontece em memória antes do `batch`: um segredo ilegível estoura antes de qualquer linha ser escrita, que era a garantia do SAVEPOINT. |
| Gravar uma coleta (`ingestPublications`) | Ordem mais idempotência, porque a rotina lê entre as escritas. Snapshot antes da publicação, publicação antes do alerta, e todo write é idempotente — a janela de refresh se sobrepõe justamente para que a passagem seguinte termine o que uma interrompida começou. |

**O lint passou a cobrir o que o TypeScript não vê.** Com o banco assíncrono, um `await` esquecido
numa escrita é uma escrita que pode nunca acontecer, e o compilador fica calado quando o resultado
é descartado. `no-floating-promises`, `await-thenable` e `no-misused-promises` estão ligados com
verificação de tipos em [`eslint.config.mjs`](../apps/web/eslint.config.mjs). Eles encontraram
autorizações que nunca bloqueavam (`assertPlatformAdmin` sem `await`), rotas que serializavam uma
promessa pendente como `{}`, e `assert.throws` sobre chamadas assíncronas, que passa aconteça o
que acontecer.

**Better Auth recebe o handle que reconhece.** `createAuth(store, db, ...)` separa as duas coisas:
`store` é o que Better Auth fala diretamente — o handle `node:sqlite` no Node, o binding D1 em
Workers, ambos aceitos pela versão 1.7 — e `db` é a costura assíncrona do K5, usada pelo hook que
provisiona o escritório. `authStore()` resolve o primeiro a partir do mesmo backend do segundo.

## O que ainda bloqueia

| Bloqueio | Natureza |
| --- | --- |
| OCR e extração | `@napi-rs/canvas` é nativo e não roda em workerd; `pdfjs-dist` e `tesseract.js` vão junto. Essas etapas continuam no worker Node. |
| Laço do worker | `scripts/worker.ts` e `judicial-worker.ts` são processos longos. Em Workers viram Cron Triggers e Queues. |
| Credenciais de deploy | O canal autenticado disponível não tem permissão para emitir tokens (`9109`). `wrangler deploy` precisa de `wrangler login` ou de um token criado no painel. |

## Ordem do trabalho restante

1. Backend de `ObjectStorage` sobre binding R2, ao lado do backend S3 que já existe.
2. Worker: Cron e Queues para o que roda em Workers; o que precisa de OCR fica em Node.
3. `wrangler secret put` para `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `K5_CREDENTIALS_KEY`,
   seguido de `wrangler deploy`.

O Cofre ainda grava no backend de sistema de arquivos, então um deploy agora serve as rotas
autenticadas, mas perde os originais enviados quando o isolate morre. O passo 1 é o que falta
antes de staging valer como staging.

## Notas de configuração

`"type": "module"` em `apps/web/package.json` é exigência do Vite. Sob ESM, o Node 26 quebra ao
traduzir algumas dependências CommonJS (`ERR_INTERNAL_ASSERTION` em `loadCJSModuleWithModuleLoad`),
o que derrubava 4 arquivos de teste. Como o formato de módulo é decidido pelo `package.json` mais
próximo, [`tests/package.json`](../apps/web/tests/package.json) marca a pasta como `commonjs` e a
suíte volta ao carregador em que já passava.

`empty-stub.js` substitui `@napi-rs/canvas` no bundle. Ele lança em vez de devolver um canvas
vazio: uma página em branco vinda de rasterização silenciosa pareceria uma página sem texto.
