# Trilha B — Jurisprudência

Data: 22/09/2026. Parte do [plano de execução](plano-execucao-dados-juridicos.md). Entrega a
capacidade de **pesquisar jurisprudência** a partir das fontes que já têm interface documentada,
com citação verificável e licença registrada por conjunto.

A coleta por navegador, necessária para os tribunais que só expõem portal, está na
[trilha C](plano-automacao-navegador.md) e grava no **mesmo acervo** definido aqui. Este documento
define o acervo; a trilha C define mais uma forma de enchê-lo.

## Índice

| Item | Entrega | Precisa de acesso externo? |
| --- | --- | --- |
| [B1](#b1--conector-ckan-acervo-do-stj) | Conector CKAN, acervo do STJ | Para concluir; o CKAN público já respondeu na pesquisa |
| [B2](#b2--conector-de-api-de-jurisprudência-tjdft) | Conector de API de jurisprudência, TJDFT | Para concluir |
| [B3](#b3--esquema-do-acervo-e-escopo-do-índice) | Esquema do acervo compartilhado e escopo do índice vetorial | Não |
| [B4](#b4--busca-capacidades-e-citação-verificável) | Busca híbrida, capacidades e citação resolvível | Não |
| [B5](#b5--avaliação-de-relevância) | Avaliação de relevância com conjunto rotulado | Revisão de advogado |

## Duas distinções que decidem o desenho

**Ementa não é inteiro teor.** Um espelho de acórdão é uma representação estruturada; a íntegra é
o documento. Um produto que responde com ementa e apresenta como decisão está errando de um jeito
que o advogado descobre no pior momento. `content_kind` é coluna obrigatória, aparece em toda
saída de capacidade e em toda citação.

**Licença é por recurso, não por catálogo.** Os dois conjuntos do STJ verificados em 18/09/2026
declararam `Creative Commons Atribuição`, cada um no seu `package_show`. Isso não estende licença a
nenhum outro conjunto. Um recurso sem licença declarada entra como `nao_esclarecido` e o efeito
disso é código, não aviso: ele **não é indexado para IA** e **não é exportável**, mesmo estando
armazenado.

---

## B1 — Conector CKAN, acervo do STJ

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/judicial/contracts.ts` | `normalizedPrecedentSchema`; `connectorOperations` ganha `listPrecedents` e `fetchPrecedent`, ambos `neutral_query` |
| `apps/web/src/lib/judicial/connectors/ckan.ts` | `createCkanConnector(transport)`, `CKAN_PARSER_VERSION`, `normalizePackage` e `normalizeResource` puros |
| `apps/web/src/lib/judicial/connectors/index.ts` | `factories.ckan = createCkanConnector` |
| `apps/web/db/sources/stj-dadosabertos.json` | Ficha da instalação, `purpose: 'jurisprudence'`, `kind: 'ckan'` |

`NormalizedPrecedent` carrega, no mínimo: `sourceDocumentId`, `court`, `organ`, `contentKind`,
`caseIdentity` quando existir, `title`, `rapporteur`, `judgedOn`, `publishedOn`, `headnote`,
`fullTextRef`, `citationLabel`, `license` (`title`, `url`, `attribution`), `sourceUpdatedAt` e
`checksum`.

**Sincronização por recurso.** Cada recurso do CKAN vira uma linha em `jurisprudence_resource` com
seu checksum. Um recurso cujo checksum mudou é rebaixado e recoletado; a versão anterior
permanece, porque um arquivo substituído a montante é informação, não ruído. Um recurso não é um
julgamento: um único ZIP pode conter milhares. A contagem de recursos nunca é apresentada como
contagem de decisões.

### Aceite

1. `package_show` de um conjunto conhecido produz a lista de recursos com licença lida **do próprio
   recurso**; um recurso sem licença declarada resulta em `license: null` e `content_kind` mantido.
2. Recurso com licença ausente é armazenado e **não** indexado: o teste verifica que nenhum vetor
   foi gravado para ele e que a exportação o recusa.
3. Recurso com checksum inalterado não é rebaixado de novo; a segunda sincronização faz zero
   downloads.
4. Recurso com checksum alterado cria uma nova versão; a anterior continua legível e citável, com
   a data de coleta original.
5. ZIP com N documentos produz N linhas em `jurisprudence_document` e **uma** linha de recurso; o
   relatório distingue os dois números.
6. Espelho e íntegra do mesmo julgamento, quando a fonte relaciona, ficam ligados por
   `related_document_id`; quando ela não relaciona, permanecem separados e nada é inferido por
   semelhança de ementa.
7. Resposta truncada por limite de páginas devolve `coverage.truncated = true`; a sincronização
   retoma do cursor e não recomeça do início.
8. `normalize` é puro: transporte que lança se chamado, e a normalização passa.

### Teste que acompanha

`apps/web/tests/jurisprudence-ckan.test.ts`

```ts
test("licença é lida por recurso, não por catálogo", …)
test("recurso sem licença é armazenado e não indexado", …)
test("checksum inalterado não gera novo download", …)
test("checksum alterado cria versão e preserva a anterior", …)
test("um recurso com N documentos conta N documentos e um recurso", …)
test("espelho e íntegra só se ligam quando a fonte liga", …)
test("varredura truncada retoma pelo cursor", …)
test("normalize é puro", …)
```

Fixtures: `ckan-package-show.json`, `ckan-resource-sem-licenca.json`,
`ckan-resource-v1.json` / `ckan-resource-v2.json` (mesmo id, checksum diferente),
`ckan-pacote-truncado.json`.

---

## B2 — Conector de API de jurisprudência, TJDFT

### Entregáveis

`apps/web/src/lib/judicial/connectors/jurisprudence-api.ts`, com adaptador por instalação para o
contrato documentado do TJDFT: `POST /api/v1/pesquisa`, corpo JSON com `query`, `pagina` iniciando
em **zero** e `tamanho`, filtros em `termosAcessorios`.

### Aceite

1. `pagina` começa em zero. Um teste fixa isso porque é exatamente o tipo de detalhe que quebra em
   silêncio e devolve a primeira página duas vezes.
2. Duas páginas consecutivas não repetem documento; o teste usa uma fixture com sobreposição
   deliberada e verifica a deduplicação por `sourceDocumentId`.
3. Termo sem resultado devolve sucesso com zero itens e `coverage.totalReported = 0` — não um erro.
4. Um filtro não declarado pela instalação é **recusado antes da requisição**, com `unsupported`;
   filtros livres não chegam ao tribunal.
5. Resultado que traz só ementa é gravado com `content_kind = 'ementa'` e `fullTextRef = null`. A
   saída nunca apresenta esse documento como inteiro teor.
6. O conector não é usado para consultar processo em andamento: `lookupCase` é declarado
   `supported: false` e recusado.

### Teste que acompanha

`apps/web/tests/jurisprudence-api.test.ts`

```ts
test("paginação começa em zero", …)
test("páginas sobrepostas não duplicam documento", …)
test("termo sem resultado é sucesso vazio, não erro", …)
test("filtro não declarado é recusado antes da requisição", …)
test("resultado só com ementa nunca vira inteiro teor", …)
test("consulta processual é recusada neste conector", …)
```

---

## B3 — Esquema do acervo e escopo do índice

### Decisão: o acervo não tem `office_id`

Jurisprudência é material público licenciado. Copiá-lo por escritório multiplicaria armazenamento
e custo de embedding sem melhorar isolamento nenhum — o conteúdo é o mesmo para todos. A
consequência é que o isolamento deixa de ser uma coluna e passa a ser **o escopo da busca**, e é
por isso que ele vira tipo e vira teste.

Isso também significa que o acervo **não pode** reaproveitar `vault_document_chunk_vector`: aquela
tabela tem chave estrangeira para `office(id)` e para `vault_document(id)`. O acervo recebe tabelas
próprias.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/db/migrations/0019_jurisprudence.sql` | `jurisprudence_resource`, `jurisprudence_document`, `jurisprudence_chunk`, `jurisprudence_index_generation`, `jurisprudence_chunk_vector` |
| `apps/web/src/lib/knowledge/vector-index.ts` | `VectorScope = { kind: 'office'; officeId } \| { kind: 'corpus'; corpusId }` substitui o primeiro parâmetro nos três backends |
| `apps/web/src/lib/jurisprudence/indexing.ts` | Geração de índice do corpus, versionada como a do Cofre |

`jurisprudence_document` carrega no mínimo: `installation_id`, `source_document_id`, `court`,
`organ`, `content_kind` (`ementa`, `espelho`, `inteiro_teor`, `sumula`, `tema`,
`decisao_monocratica`), `cnj_number`, `native_number`, `title`, `rapporteur`, `judged_on`,
`published_on`, `headnote`, `storage_key`, `checksum`, `version`, `supersedes_id`,
`license_title`, `license_url`, `attribution`, `permissions` (as cinco dimensões herdadas da
instalação no momento da coleta), `snapshot_id`, `collected_at`.

**Namespace no Vectorize.** O escopo de corpus usa `corpus:<id>`; o de escritório continua sendo o
UUID do escritório, exatamente como hoje. Os dois espaços não colidem e **nenhum vetor existente
precisa ser reindexado**.

### Aceite

1. Uma consulta de escopo `office` nunca devolve um chunk do corpus, e uma consulta de escopo
   `corpus` nunca devolve um chunk de escritório. O teste roda nos três backends disponíveis no
   ambiente de teste.
2. O filtro de escopo é empurrado para dentro da consulta do índice, não aplicado depois do
   `topK` — a mesma regra que [ambientes.md](ambientes.md) já fixa para escritório e geração.
3. Nenhum vetor de escritório é alterado pela migração: o teste grava vetores antes, aplica a
   nova geração de corpus e confere que os anteriores respondem idênticos.
4. Um documento com `permissions.ai != 'permitido'` não gera chunk nem vetor. O teste confere as
   duas tabelas.
5. Um documento com `permissions.redistribution != 'permitido'` é recusado pela exportação, com
   mensagem que nomeia a condição, e continua disponível para leitura interna.
6. Reindexar o corpus cria uma geração nova; a anterior continua respondendo até a troca, e a troca
   é atômica.
7. Com `VECTOR_INDEX_BACKEND` ausente (SQLite, força bruta), uma busca no corpus acima do limite
   configurado é **recusada com mensagem explícita**, em vez de devolver um resultado pior sem
   avisar. Buscar jurisprudência em produção exige pgvector ou Vectorize.

### Teste que acompanha

`apps/web/tests/jurisprudence-scope.test.ts`

```ts
test("escopo de escritório não alcança o corpus", …)
test("escopo de corpus não alcança documento de escritório", …)
test("o filtro de escopo entra na consulta, não depois do topK", …)
test("vetores de escritório existentes continuam idênticos", …)
test("documento sem permissão de IA não gera chunk nem vetor", …)
test("documento sem permissão de redistribuição é recusado na exportação", …)
test("troca de geração do corpus é atômica", …)
test("backend SQLite recusa corpus grande em vez de degradar em silêncio", …)
```

---

## B4 — Busca, capacidades e citação verificável

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/jurisprudence/retrieval.ts` | Busca híbrida sobre o corpus, no padrão de [`knowledge/retrieval.ts`](../../apps/web/src/lib/knowledge/retrieval.ts) |
| `apps/web/src/lib/capabilities/contracts.ts` | `k5_jurisprudence_search` e `k5_jurisprudence_get`, saída com `untrustedContent: true` |
| `apps/web/src/lib/application/jurisprudence-service.ts` | Serviço autenticado; escopo derivado da sessão |
| `apps/web/src/app/api/jurisprudence/` | Rotas de capacidade, sem acesso próprio ao banco |
| `apps/web/src/app/app/research/page.tsx` | Tela de pesquisa, hoje um redirecionamento para Tarefas e Agenda |

Toda saída de busca carrega: `content_kind`, tribunal, órgão, relator, data de julgamento, data de
publicação, `citationLabel`, licença com atribuição, versão do documento e data de coleta. Uma
citação sem esses campos não é renderizável — isso é validação de esquema, não convenção.

### Aceite

1. Todo resultado traz `content_kind`; a interface e a saída da capacidade rotulam ementa, espelho e
   inteiro teor com palavras diferentes.
2. Uma citação devolvida resolve: o identificador aponta para o documento armazenado, na versão
   citada, e a resolução não depende de nova consulta ao tribunal.
3. Um documento substituído por versão nova continua resolvendo pela versão antiga quando a
   citação foi feita naquela versão.
4. A busca mistura corpus e Cofre **somente com rótulo de origem por resultado**; nenhuma chamada
   ao índice cruza os dois escopos.
5. O agente recebe a busca com `untrustedContent: true`. Uma fixture contém ementa com texto em
   formato de injeção e nada age sobre ele.
6. A capacidade respeita papel e sessão; sessão revogada durante a chamada resulta em recusa.
7. Consulta vazia, consulta só com stopwords e consulta sem resultado produzem três estados
   distintos na interface, com teclado e mobile verificados contra [DESIGN.md](../../apps/web/DESIGN.md).
8. Uma afirmação do assistente que cite jurisprudência só cita documentos que estavam no escopo
   selecionado daquela conversa.

### Teste que acompanha

`apps/web/tests/jurisprudence-search.test.ts`

```ts
test("todo resultado declara content_kind", …)
test("citação resolve para a versão citada", …)
test("versão nova não quebra citação antiga", …)
test("corpus e Cofre não se misturam dentro de uma consulta ao índice", …)
test("resultado do corpus chega ao agente como conteúdo não confiável", …)
test("sessão revogada durante a chamada é recusada", …)
test("consulta vazia, só stopwords e sem resultado são três estados", …)
test("citação fora do escopo selecionado é recusada", …)
```

---

## B5 — Avaliação de relevância

### Problema

Busca jurídica sem métrica é opinião. O critério do plano de infraestrutura para F6 é explícito:
"busca avaliada por advogado". Isso precisa de um conjunto rotulado, congelado, e de um número que
possa piorar visivelmente.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/tests/fixtures/jurisprudence/eval.json` | 30 consultas reais rotuladas por advogado, com documentos relevantes marcados, sobre um recorte congelado do corpus |
| `apps/web/scripts/jurisprudence-eval.ts` | `pnpm jurisprudence:eval` → recall@10, MRR e a lista de consultas que pioraram desde a última execução |
| `docs/avaliacao-jurisprudencia.md` | Relatório de cada execução, com data, versão do índice e do modelo de embedding |

A avaliação real usa o provedor de embedding configurado e **não** roda em CI. O que roda em
`pnpm test` é o teste determinístico de ordenação, com vetores fixos: ele não mede relevância
jurídica, mede que a fusão de resultados, os filtros e os desempates fazem o que dizem.

### Aceite

1. A avaliação roda sobre um recorte congelado: rodar duas vezes sem mudar código produz o mesmo
   número.
2. O relatório nomeia cada consulta que piorou, com a posição anterior e a atual. Um número médio
   que melhora escondendo três regressões não passa.
3. Nenhuma consulta do conjunto contém dado de cliente; o conjunto é revisável e versionado.
4. A ordenação determinística é testada sem provedor de embedding: vetores fixos, resultado fixo.
5. Empate de score é desempatado por critério declarado e estável, nunca pela ordem de chegada do
   backend.

### Teste que acompanha

`apps/web/tests/jurisprudence-ranking.test.ts`

```ts
test("fusão de resultados com vetores fixos é determinística", …)
test("empate é desempatado por critério declarado", …)
test("filtro por tribunal, órgão e período entra na consulta", …)
test("conjunto de avaliação não contém dado de cliente", …)
```

---

## Dependência de infraestrutura

O acervo é o primeiro consumidor que torna o SQLite síncrono insuficiente: volume de documentos,
chunks e vetores, e escrita em lote durante a sincronização. Isso **não bloqueia** B1–B4, que são
construídos e testados com um recorte pequeno, e **bloqueia** colocar busca de jurisprudência em
produção. A migração para PostgreSQL é a fase F5 do [plano de infraestrutura](plano-infra-judicial.md)
e precisa terminar antes de ampliar o piloto — o item B3.7 existe para que essa dependência falhe
em voz alta, e não em silêncio, se alguém tentar antes.
