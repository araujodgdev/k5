# Auditoria Sentry — 24/09/2026

Projeto [lume-wr/lume](https://lume-wr.sentry.io/issues/?project=4512130123169792), janela de 90 dias.
Foram examinados 23 grupos. O evento mais antigo é de 22/09/2026. Fontes usadas: eventos do
Sentry; logs de Workers da Cloudflare; metadados do Vectorize; consultas SQL `BEGIN READ ONLY` no
staging, feitas pelo Codex só com leitura; e reproduções locais com PostgreSQL real e fixtures
sintéticas. Durante a auditoria não houve deploy, reindexação, alteração de provedor, de recurso
Cloudflare ou do Sentry. Depois dela, a pedido do usuário, os 7 jobs falhados foram excluídos do
staging, sem reindexação (ver LUME-P).

Classificações usadas:

- **Defeito**: falha do produto, com causa comprovada.
- **Real, causa não confirmada**: incidente de produção sem prova suficiente da causa. Quando o
  evento sugere origem externa ou de infraestrutura, isso é hipótese e não descarta causa interna.
- **Esperado**: condição prevista, reportada como erro.
- **Deploy**: interrupção comprovada por um deploy.
- **Ruído**: verificação sintética ou execução local.

"Corrigido localmente" significa que a correção está só no código deste checkout: nada foi
publicado e o staging continua com o comportamento antigo até um deploy.

## Resumo

| Grupo | Classificação | Causa | Ação |
| --- | --- | --- | --- |
| [LUME-P](https://lume-wr.sentry.io/issues/LUME-P) | Defeito | Comprovada: ID Vectorize de 101 bytes (máx. 64) | Corrigido localmente, sem deploy |
| [LUME-Q](https://lume-wr.sentry.io/issues/LUME-Q) | Deploy (1ª ocorrência) | 1ª comprovada: reset do Durable Object no deploy; 2ª não confirmada | Nenhuma |
| [LUME-N](https://lume-wr.sentry.io/issues/LUME-N) | Esperado | Comprovada: PDF sem texto no Worker, sem OCR | Corrigido localmente, sem deploy: não reporta mais e mostra a mensagem correta |
| [LUME-M](https://lume-wr.sentry.io/issues/LUME-M) | Real, causa não confirmada | Conexão encerrada no Cron; origem de rede é hipótese | Nenhuma |
| [LUME-K](https://lume-wr.sentry.io/issues/LUME-K) | Real, causa não confirmada | Mecanismo reproduzido; evento histórico não vinculado | Investigar o ciclo de vida antes de escolher correção |
| [LUME-B](https://lume-wr.sentry.io/issues/LUME-B) | Real, causa não confirmada | Better Auth falhou ao obter sessão; causa subjacente sanitizada | Lacuna registrada |
| [LUME-J](https://lume-wr.sentry.io/issues/LUME-J) | Real, causa não confirmada | Rejeição do provedor no teste de conexão confirmada; motivo não confirmado | Nenhuma |
| [LUME-H](https://lume-wr.sentry.io/issues/LUME-H) | Real, causa não confirmada | Despacho ao Container rejeitado | Nenhuma |
| [LUME-F](https://lume-wr.sentry.io/issues/LUME-F) | Real, causa não confirmada | Erro de socket TLS com fonte judicial; origem externa é hipótese | Nenhuma |
| [LUME-G](https://lume-wr.sentry.io/issues/LUME-G) | Real, causa não confirmada | Erro PostgreSQL em `upsertSourceJudgment` | Nenhuma |
| [LUME-D](https://lume-wr.sentry.io/issues/LUME-D) | Real, causa provável (não comprovada) | Provável: conflito de worker PDF.js | Sem eventos após `f696c40` |
| [LUME-C](https://lume-wr.sentry.io/issues/LUME-C) | Real, provável consequência de LUME-D | Mesmo intervalo e mesmo processador | Nenhuma |
| [LUME-E](https://lume-wr.sentry.io/issues/LUME-E) | Real, causa não confirmada | Status HTTP de erro da fonte do STJ; origem externa é hipótese | Nenhuma |
| [LUME-A](https://lume-wr.sentry.io/issues/LUME-A) | Ruído | `next start` local, cliente fechou o stream | Nenhuma |
| [LUME-9](https://lume-wr.sentry.io/issues/LUME-9) | Real, causa não confirmada | Corpo de `/api/chat` rejeitado pelo schema | Nenhuma |
| [LUME-8](https://lume-wr.sentry.io/issues/LUME-8) | Defeito (ambiente local) | Páginas do Cofre usavam o guard de API (401) | Corrigido localmente, sem deploy |
| [LUME-7](https://lume-wr.sentry.io/issues/LUME-7) | Defeito (ambiente local) | Igual a LUME-8, em `generateMetadata` | Corrigido localmente, sem deploy |
| [LUME-6](https://lume-wr.sentry.io/issues/LUME-6) | Real, causa não confirmada | `Network connection lost` do runtime; infraestrutura é hipótese | Nenhuma |
| [LUME-5](https://lume-wr.sentry.io/issues/LUME-5) | Defeito (resolvido antes) | GSAP criava timer no escopo global do Worker | Corrigido em `13f42ae` |
| [LUME-4](https://lume-wr.sentry.io/issues/LUME-4) | Ruído | Verificação sintética do navegador | Nenhuma |
| [LUME-3](https://lume-wr.sentry.io/issues/LUME-3) | Ruído | Verificação sintética do navegador | Nenhuma |
| [LUME-2](https://lume-wr.sentry.io/issues/LUME-2) | Ruído | `verify-sentry-cloudflare` local | Nenhuma |
| [LUME-1](https://lume-wr.sentry.io/issues/LUME-1) | Ruído | `sentry:verify` local | Nenhuma |

## Detalhes

### LUME-P — `knowledge.index failed` (35 eventos, 23/09 23:20–23:40 UTC)

**Evidência.** Os logs do Worker `k5-staging` (release `cd87b2eb…`) registram, em
23:40:35, 23:40:39 e 23:40:42.850Z, este erro em `ContainerProxy POST /vectors/upsert`:
`VECTOR_UPSERT_ERROR (code = 40008): id too long; max is 64 bytes, got 101 bytes`. O último
evento de LUME-P é de 23:40:42.817Z. No staging há:

- Vectorize `k5-knowledge-staging`: 1536 dimensões, cosseno, `vectorCount = 0`; índices de
  metadados só em `generationId` e `documentId`;
- 7 jobs `failed`, todos com `error = 'fetch failed'`, `attempts = 5` e `chunks_done = 0`;
- 2 gerações `building` com `text-embedding-3-small`, dimensão 1536;
- nenhuma linha no ledger `vault_document_chunk_vector`.

**Causa comprovada.** O adaptador montava o ID do vetor como `${generationId}:${chunkId}`. São
36 bytes do UUID, 1 do separador e 64 do hash SHA-256 que `vault.ts` gera para o chunk, total de
101 bytes. O [limite do Vectorize](https://developers.cloudflare.com/vectorize/platform/limits/) é
64 bytes. O embedding funcionava: a falha ocorre no upsert. O binding lançava exceção dentro do
proxy do Container, o Container só via `fetch failed` e `captureOperationalError` trocava a
mensagem. Por isso o evento chegava sem causa útil. Um segundo defeito teria aparecido depois de
corrigido o ID: a consulta pedia `returnMetadata: 'indexed'` e lia `metadata.chunkId`, mas
`chunkId` não tem índice de metadados. Toda consulta voltaria sem hits utilizáveis e a busca
cairia em silêncio para a lexical.

**Correção** (`src/lib/knowledge/vector-index.ts`):

- **ID do vetor.** Passa a ser `base64url(UUID da geração em 16 bytes + chunk em bytes)`. Um
  hash SHA-256 ocupa 32 bytes e um UUID 16, então o ID fica com 64 ou 43 bytes. O formato é
  reversível: a consulta lê o chunk do próprio ID, com `returnMetadata: 'none'`, e aceita
  `topK` até 100. Pelo
  [contrato](https://developers.cloudflare.com/vectorize/reference/client-api/), `'all'` limita
  `topK` a 50, e a recuperação pede até 72. Hits de outra geração são descartados. Um chunk com
  formato que não cabe no limite gera `VectorContractError`, terminal, sem gastar cinco rodadas
  de embedding.
- **Exclusões.** `removeDocument` e `removeGeneration` derivam os mesmos IDs a partir do ledger.
- **Proxy do Container.** `processorBindingRequest` agora responde `502 {code: "vectorize_40008"}`
  em vez de derrubar a conexão. `containerBindingFetch` lança `ContainerBindingError` com status e
  código. O log do Worker registra só a operação fixa (`upsert`, `query`, `delete`) e o código
  numérico. O texto da exceção não vai para log, resposta nem Sentry, porque uma mensagem externa
  pode repetir valores de vetor, metadados ou conteúdo de documento.
- **Observabilidade.** `captureOperationalError` aceita tags próprias da aplicação.
  `knowledge.index` passa a enviar `knowledge.stage` (`setup`, `embedding`, `vector_upsert`,
  `ledger`, `checkpoint`, `publish`) e `knowledge.error_code`. A mensagem do provedor continua
  fora do Sentry.
- **Progresso.** Ao reenfileirar um job `failed`, `completed` ou `cancelled`, `chunks_done` volta
  a 0, junto com o cursor. Antes, a contagem somava a execução anterior.

O provedor e o modelo escolhidos pelo administrador não mudam. As 1536 dimensões de
`text-embedding-3-small` coincidem com as do índice.

**Regressão** (`tests/vectorize-contract.test.ts`). Uma fixture segue o contrato documentado e a
configuração real do índice: 1536 dimensões, IDs e namespace de até 64 bytes, `topK` de até
100 (50 com `'all'`), filtros só em campos indexados e o texto do erro 40008. O teste passa pelo
caminho real: `processNextIndexJob`, o proxy do Container em `processorBindingRequest` e o
binding. O embedding vem de uma fixture local compatível com a OpenAI. Antes da correção, os
três testes de fluxo falharam com o job `failed` e `error = 'fetch failed'`, o mesmo estado do
staging. Depois da correção, os testes cobrem:

- publicação e consulta pelo ID do chunk real;
- isolamento: outro escritório não lê os vetores, mesmo nomeando a mesma geração e documento;
- exclusão exata dos vetores de um documento;
- recuperação de um job no estado do staging;
- código seguro no proxy;
- tags de etapa e código sem o texto do provedor;
- um marcador confidencial na mensagem da exceção do binding não aparece no `console.error`, na
  resposta do proxy, no evento do Sentry nem no erro gravado no job;
- limites e reversibilidade do ID.

A mudança em `chunks_done` foi validada assim: sem a linha nova o teste de recuperação falha
(`done: 1`) e com ela passa. Os testes existentes em `tests/indexing.test.ts` passaram a usar o
ID novo.

**Limitações.** A fixture reproduz o contrato, mas não comprova que o staging está corrigido.
Isso só se confirma depois do deploy, quando uma indexação nova for observada. O teste de consulta
pelo metadado `chunkId` não indexado não ficou vermelho em separado, porque o upsert falhava
antes. Esse defeito se apoia no contrato de `'indexed'` e nos índices remotos listados acima.

**Jobs falhados: decisão do usuário.** Não houve reindexação. O usuário decidiu excluir do
staging os 7 registros `failed` de `knowledge_index_job`. O Codex fez a exclusão de forma restrita
e a verificou em 24/09/2026 01:02:04 UTC:

- 7 excluídos, nenhum remanescente;
- 12 documentos, 2865 chunks e 0 linhas no ledger, iguais antes e depois.

Os documentos originais e seus chunks foram mantidos. Nenhum reindex foi feito.

**Publicação.** O usuário autorizou um PR isolado com esta correção, a revisão do CodeRabbit, o
tratamento dos achados, o merge e o deploy da `main` na Cloudflare. Esses passos estão em
andamento e ainda não aconteceram.

**Observação de produto, sem alteração.** No staging, o documento aparece como "Pronto" com a
indexação semântica falhada. "Pronto" reflete a extração, e a busca lexical funciona. A falha
semântica gera a notificação `vault.index.failed`. Não há indicador de índice na lista.

### LUME-Q — `processors.dispatch failed` (2 eventos, 23/09 23:32 UTC)

Nos logs, o `LumeProcessor` registra "Durable Object reset because its code was updated" às
23:32:09.361Z, logo antes do evento de 23:32:09.476Z. A primeira ocorrência é a interrupção de um
`run()` durante o deploy. A segunda, às 23:32:37, não apareceu na consulta de logs: é provável que
tenha a mesma causa, mas isso não está provado. O Cron do minuto seguinte despacha de novo. Nenhuma
ação.

### LUME-N — `chat.attachment.extract failed` (1 evento, 23/09 23:11 UTC)

**Causa comprovada** pelo quadro da pilha: `document-extraction.ts` lança "Este PDF precisa de
OCR" quando o PDF não tem camada de texto no Worker e `VAULT_OCR_URL` não existe. É uma limitação
conhecida. Mesmo assim, `chat-attachments.ts` a reportava ao Sentry e trocava a orientação por
"Não foi possível ler este arquivo".

**Correção.** Nova classe `OcrRequiredError`. O anexo de chat devolve `INVALID` com a mensagem
de OCR e a rota do Cofre, sem enviar evento. Falhas de leitura de verdade, como um PDF
corrompido, continuam reportadas. Regressão em `tests/chat-attachments.test.ts`: um PDF gerado
sem texto, com `K5_RUNTIME=cloudflare`, falhava antes da correção (mensagem genérica) e agora
passa. O mesmo teste confirma que o PDF corrompido ainda gera um evento.

### LUME-M — `Connection terminated unexpectedly` (1 evento, 23/09 22:27 UTC)

O Cron de notificações falhou em `reconcileNotificationReminders`, com a conexão Hyperdrive
encerrada. É uma falha real. O log remoto confirma a mensagem, mas não o motivo do encerramento:
rede ou Hyperdrive é hipótese, e uma causa interna (por exemplo, o ciclo de vida do pool ou a
duração da consulta) não está descartada. O próximo Cron repete a varredura, e o pool é criado e
encerrado a cada invocação. Nenhuma ação sem nova evidência.

### LUME-K — `Cannot use a pool after calling end on the pool` (1 evento, 23/09 14:32 UTC)

**Mecanismo reproduzido localmente, sem vínculo com o evento.** O teste descartável em
`apps/web/.data/sentry-audit-20260924/lume-k.test.ts` (não versionado) usa PostgreSQL real.
Uma renderização em stream cancelada pelo cliente leva `closePoolWithResponse` a encerrar o pool
da requisição. A próxima consulta da mesma renderização falha com exatamente essa mensagem, como
rejeição não tratada. Os logs de 14:32–14:41 mostram falha do Better Auth ao adquirir o pool,
mas a mensagem subjacente está sanitizada. Não está provado que o evento histórico seja esse
cancelamento.

**Sem correção nesta auditoria.** Manter o pool vivo com tempo de tolerância ou repetir a
consulta foram descartados. Antes de escolher uma correção, é preciso investigar o ciclo de vida
da requisição: se o vinext/React interrompe a renderização quando o stream é cancelado, que
trabalho continua depois de `closePoolWithResponse` e se o evento histórico foi mesmo esse
cancelamento. A reprodução mostra o mecanismo. Ela não prova que a solução precise de redesenho.
**Dado necessário:** log do Worker do evento de 14:32:55 com `outcome` (`canceled` ou `ok`) e a
classe do erro na falha de pool.

### LUME-B — `APIError: Failed to get session` (19 eventos, 23/09 01:49–14:40 UTC)

O Better Auth 1.7.5 lança essa mensagem em dois casos (`api/routes/session.mjs`):

1. `UNAUTHORIZED`, quando `updateSession` não encontra a sessão. Com `updateAge: 0`, toda leitura
   renova a sessão. Isso ocorre se a sessão foi apagada entre a leitura e a atualização, por
   exemplo por logout ou revogação global.
2. `INTERNAL_SERVER_ERROR`, que embrulha qualquer erro do banco, sem pilha nem causa.

Nos logs de 14:32–14:41 há falhas ao adquirir o pool no Better Auth, o que aponta para o caso 2
e talvez para o mesmo mecanismo de LUME-K. A mensagem subjacente, porém, está sanitizada. A causa
não está confirmada. **Dados necessários:** linhas `INTERNAL_SERVER_ERROR` do logger do Better
Auth com a classe do erro para os eventos de 01:49 a 14:40.

### LUME-J — `platform.ai.provider failed` (3 eventos em 41 s, 23/09 11:46 UTC)

É o teste de conexão de IA na plataforma (`ai-connections-core.ts:265`). A rejeição da chamada
de teste pelo provedor está confirmada. O motivo não está: o código descarta de propósito a
resposta do provedor, e pode ter sido credencial, modelo, cota ou indisponibilidade.
`platformErrorResponse` reporta `provider` de propósito. A consulta de logs de 11:46–11:48 não
trouxe linhas. Nenhuma ação.

### LUME-H — `processors.dispatch failed` (1 evento, 23/09 02:40 UTC)

É a mesma chamada de LUME-Q, sem pilha útil. O horário coincide com LUME-F e com as mudanças da
madrugada de 23/09. Não há log que prove um deploy nesse minuto. Nenhuma ação. Grupo resolvido.

### LUME-F — `research.external failed` (6 eventos, 23/09 02:16–02:40 UTC)

Erro de socket TLS (`socketErrorListener`) em `judicial/connectors/transport.ts:274`, no acesso a
uma fonte judicial. É uma falha real. Uma falha de rede do terceiro é hipótese: o evento não
distingue isso de uma causa do nosso lado, como configuração TLS, tempo limite ou saída do
Container. O job segue a política de novas tentativas do conector. Grupo resolvido.

### LUME-G — `research.external failed` (1 evento, 23/09 02:16 UTC)

Erro do PostgreSQL (classe `error` do `pg`) em `research/catalog.ts:33`
(`upsertSourceJudgment`). O código SQL do erro não está no evento. A causa não está confirmada.
Grupo resolvido e sem recorrência. **Dado necessário:** `code` do PostgreSQL nos logs do
Container.

### LUME-D — `documents.container failed` (2 eventos, 23/09 01:54–02:05 UTC) e LUME-C

LUME-D: `UnknownErrorException` do PDF.js ao carregar `pdf.mjs` em `extractPdfLocally`, no
Container. O commit `f696c40` (23/09 03:09 UTC) passou a separar o unpdf do PDF.js no processo
de OCR. O comentário desse commit descreve o erro de versão entre API e worker que o conflito
causa. Não houve eventos depois dele. É uma causa provável, não comprovada: não houve reprodução
e o evento não traz a mensagem do PDF.js. LUME-C (`vault.ingest.dispatch failed`,
`vault.ts:528`) ocorreu nos mesmos minutos. É provável que o botão "tentar novamente" tenha
acordado o Container e que ele tenha falhado por LUME-D, mas isso também não está provado. Os dois
grupos estão resolvidos no Sentry.

### LUME-E — `research.stj.ingest failed` (1 evento, 23/09 02:04 UTC)

`statusToError` em `transport.ts:214`: a fonte de recursos do STJ respondeu com status de erro. É
uma falha real. O status não está no evento, então não se sabe se a origem é o STJ ou a
requisição feita por nós (URL, cabeçalhos, limite de taxa). O recurso volta à fila conforme a
política do ingestor. Nenhuma ação.

### LUME-A — `The destination stream closed early` (1 evento, 23/09 00:12 UTC)

Pilha de `next start` local (caminho `C:\Users\…`, `app-page-turbo.runtime.prod.js`): o
navegador abandonou o stream de `/app/command-center`. É ruído local, embora seja a contraparte em
Node do cancelamento discutido em LUME-K.

### LUME-9 — `chat.request.invalid failed` (1 evento, 22/09 23:45 UTC)

O `chatRequestSchema` rejeitou o corpo de `/api/chat`. A resposta foi 400. O evento é reportado de
propósito, porque indica divergência de contrato entre cliente e servidor. Houve um único caso,
sem detalhe do campo, e é provável que coincida com uma troca de versão, o que não está provado.
Nenhuma ação sem recorrência.

### LUME-8 e LUME-7 — `Sua sessão expirou.` (2 + 2 eventos, 22/09 19:20–19:25 UTC)

Aconteceram em `localhost:3100`, mas o código é o mesmo do staging. `/app/vault/cases/[id]` e o
seu `generateMetadata` chamavam `requireVaultWorkspace`, o guard das APIs, que lança
`VaultHttpError(401)`. Com a sessão expirada, a página lançava erro em vez de redirecionar. Em
navegação suave, o layout não é renderizado de novo e não redireciona.

**Correção.** As páginas `/app/vault`, `/app/vault/library` e `/app/vault/cases/[id]`, incluindo
`generateMetadata`, passam a usar `requireWorkspace`, que redireciona para `/sign-in`, do mesmo
modo que `app/app/layout.tsx`. As APIs continuam com 401.

**Verificação.** O Codex testou no Chrome, com `next start` do build desta correção:

- Sem cookie, as três páginas (`/app/vault`, `/app/vault/library` e um caso) levaram a
  `/sign-in` e mostraram o formulário "Entrar".
- Com um cookie existente, as três abriram normalmente.

A expiração de uma sessão ativa não foi simulada no navegador. A expiração no servidor está
coberta por `tests/auth.test.ts`. Não há teste automatizado da página.

### LUME-6 — `Network connection lost.` (10 eventos, 22/09 18:48 – 23/09 17:54 UTC)

Mensagem do runtime da Cloudflare quando um socket ou subrequest cai, sem pilha. É uma falha
real. Infraestrutura transitória é hipótese: sem pilha nem operação, o evento não descarta uma
causa interna. O grupo está arquivado até escalar. Nenhuma ação.

### LUME-5 — `Disallowed operation called within global scope` (5 eventos, 22/09 13:36–14:41 UTC)

O `gsap.registerPlugin` rodava no escopo global do módulo e criava um `setTimeout` no Worker. O
commit `13f42ae` (22/09 14:44 UTC) passou a registrá-lo só com `window`
(`reveal.tsx` e `app-sidebar.tsx`). O último evento é de 14:41, antes do commit. Resolvido.

### LUME-4, LUME-3, LUME-2 e LUME-1 — verificações sintéticas (22/09 13:08–13:31 UTC)

As mensagens "Lume browser Sentry verification", "Lume Cloudflare Sentry setup verification" e
"Lume Sentry setup verification" vêm de `sentry:verify`, `sentry:verify:browser` e
`verify-sentry-cloudflare`, descritos em [sentry.md](sentry.md). É ruído esperado. Grupos
resolvidos.

## Verificação

Os resultados abaixo foram obtidos na árvore de trabalho original, que também continha outras
alterações do usuário. O PR isolado, com apenas o diff desta auditoria, será revalidado pelo Codex
e pelo CI.

- Red: antes da correção, `pnpm --filter @k5/web test tests/vectorize-contract.test.ts` falhou
  com o job `failed` e `fetch failed`, e o teste de LUME-N falhou com a mensagem genérica.
- Green: `vectorize-contract`, `indexing`, `processors` e `chat-attachments` passam, 21 testes.
- `pnpm lint`: sem erros. Há um aviso anterior a esta auditoria em
  `judicial/connectors/transport.ts`.
- `pnpm typecheck`: passa depois que o Codex moveu os tipos obsoletos de `.next-research-qa` para
  o diretório de artefatos.
- `pnpm test` completo (Codex): 419/419, nenhuma falha, exit 0.
- `pnpm db:setup` (Codex): exit 0.
- `pnpm build --env-mode=loose` (Codex): exit 0. A saída foi isolada em `.next-research-qa` para
  preservar o `.next` original, e os source maps não foram enviados. Houve um aviso do Turbo sobre
  cache e links longos no Windows, sem falha de compilação.
- Navegador (Codex): a validação das páginas do Cofre está descrita em LUME-7/8. O fluxo de chat
  com Fontes carregou, mas a resposta da IA não pôde ser validada porque o banco local não tem
  nenhuma `ai_connection`. O RAG de ponta a ponta continua coberto só pelos testes contratuais.
- Nada foi publicado e nenhum job foi reindexado. No staging, só os 7 jobs falhados foram
  excluídos, por decisão do usuário. As correções continuam locais até o deploy autorizado, que
  ainda não ocorreu. O que o relatório afirma sobre os eventos históricos continua sendo o que as
  evidências provam, e as hipóteses seguem marcadas como tal.
