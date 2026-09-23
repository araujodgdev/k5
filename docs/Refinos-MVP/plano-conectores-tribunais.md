# Trilha A — Conectores de tribunais

Data: 22/09/2026. Parte do [plano de execução](plano-execucao-dados-juridicos.md). Entrega a
capacidade de **consultar as APIs dos tribunais**: confrontar o DJEN com uma resposta real,
implementar MNI/SOAP, fazer movimentos processuais existirem no produto e normalizar a taxonomia.

Regra que atravessa a trilha inteira: **nenhum item aqui liga uma fonte.** Concluir todos os itens
deixa o Lume pronto para, no dia em que uma habilitação chegar, precisar apenas de
`pnpm judicial:admin enable <id> --live`. O caminho dessa habilitação está no
[runbook](runbook-habilitacao-fonte.md).

## Índice

| Item | Entrega | Precisa de acesso externo? |
| --- | --- | --- |
| [A1](#a1--arnês-de-conformidade-e-gravador-de-amostras) | Arnês de conformidade e gravador de amostras | Não para construir; sim para usar |
| [A2](#a2--djen-do-contrato-documentado-ao-contrato-confrontado) | DJEN: contrato fixado, certidão, caderno e cobertura | Sim, para concluir |
| [A3](#a3--conector-mnisoap) | Conector MNI/SOAP com XML endurecido | Não |
| [A4](#a4--esteira-de-processo-movimentos-com-proveniência) | Esteira de processo: movimentos, alertas e capacidade | Não |
| [A5](#a5--vocabulário-tpusgt) | Vocabulário TPU/SGT | Não para construir |
| [A6](#a6--segunda-instalação) | Segunda instalação, mesma esteira | Sim, para concluir |
| [A7](#a7--operação-canário-painel-e-compose) | Canário, painel por instalação e worker no compose | Não |

---

## A1 — Arnês de conformidade e gravador de amostras

### Problema

Hoje as fixtures são sintéticas: foram escritas a partir da documentação, por quem escreveu o
parser. Elas provam que o parser é consistente consigo mesmo, não que ele entende o tribunal. O
primeiro contato com uma fonte real precisa produzir, em uma única requisição, três coisas:
a amostra gravada, o relatório do que o parser reconheceu e a prova de que nada foi descartado
em silêncio.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/judicial/connectors/conformance.ts` | `describeExpectedFields(connector, operation)` e `compareToParser(connector, operation, payload)` devolvendo `ConformanceReport` |
| `apps/web/src/lib/judicial/connectors/sanitize.ts` | `sanitizeForFixture(payload, contentType)`: CPF, CNPJ, OAB, e-mail, telefone e elementos de credencial saem; estrutura e nomes de campo ficam |
| `apps/web/scripts/judicial-probe.ts` | `pnpm judicial:probe <installationId> --operation <op> --office <id> [--from --to] [--record <nome>] [--max-requests 1]` |
| `apps/web/db/sources/contracts/` | Cópia fixada de cada OpenAPI/WSDL, com `.sha256` ao lado |

`ConformanceReport` carrega, no mínimo: `installationId`, `operation`, `parserVersion`,
`payloadSha256`, `knownFields`, `unknownFields`, `missingExpected`, `items`, `rejected` e o
`requestSummary` da chamada.

O probe passa pelo transporte existente — allowlist, HTTPS, redirect manual, recusa de rede
interna, teto de bytes e MIME — e pelo `reserveRequestBudget`. Ele não é um atalho para fora das
guardas; é a única forma autorizada de gastar uma requisição fora do worker.

### Aceite

1. Com `enabled = 0` **ou** `live_transport_enabled = 0`, o probe recusa, sai com código diferente
   de zero e o contador de `judicial_rate_budget` fica inalterado.
2. Uma execução consome exatamente **uma** unidade de orçamento, independentemente de quantas
   páginas a resposta tenha; `--max-requests` acima de 1 é explícito no comando, nunca implícito.
3. Um campo presente na resposta e ausente do parser aparece em `unknownFields`. O relatório
   **nunca** silencia: se `unknownFields` não estiver vazio, o comando sai com código 2.
4. Um campo que o parser exige e a resposta não traz aparece em `missingExpected` e o comando sai
   com código 2.
5. `--record` grava a fixture já sanitizada em `tests/fixtures/judicial/`. Nenhum CPF, CNPJ, OAB,
   e-mail ou telefone da resposta sobrevive à sanitização.
6. A fixture gravada é carregável pela suíte determinística sem edição manual: reprocessá-la
   produz exatamente os mesmos itens que a execução original relatou.
7. Toda execução grava uma linha em `judicial_access_audit` com `actor='worker'`, a instalação, a
   operação e o desfecho — inclusive quando recusada.

### Teste que acompanha

`apps/web/tests/judicial-conformance.test.ts`

```ts
test("probe: recusa sem os dois interruptores e não gasta orçamento", …)
test("probe: uma execução consome exatamente uma unidade de orçamento", …)
test("conformidade: campo novo na resposta aparece em unknownFields, nunca some", …)
test("conformidade: campo exigido e ausente aparece em missingExpected", …)
test("sanitização: CPF, CNPJ, OAB, e-mail e telefone não sobrevivem à fixture", …)
test("sanitização: a estrutura e os nomes de campo sobrevivem", …)
test("fixture gravada: reprocessar produz o mesmo relatório", …)
test("probe recusado também grava auditoria", …)
```

Fixtures: `conformance-extra-field.json`, `conformance-missing-field.json`,
`conformance-pii.json` (com um CPF, um CNPJ, uma OAB, um e-mail e um telefone sintéticos).

### Bloqueio

Nenhum para construir. Usar contra uma fonte real depende da Onda 0.

---

## A2 — DJEN: do contrato documentado ao contrato confrontado

### Problema

O conector DJEN existe, normaliza, pagina, trata errata e republicação — e nunca viu uma resposta
de produção. Faltam também duas operações que a documentação descreve e que mudam o valor do
produto: a **certidão** (evidência da comunicação) e o **caderno** (a única forma de medir se a
coleta está completa).

### Entregáveis

| Arquivo | Mudança |
| --- | --- |
| `apps/web/db/sources/contracts/djen-1.0.4.json` + `.sha256` | OpenAPI fixado; `judicial:admin register` recusa ficha cujo `contractVersion` não tenha contrato fixado |
| `apps/web/src/lib/judicial/contracts.ts` | `connectorOperations` ganha `reconcileWindow`, efeito `neutral_query`, usado só pelo relatório de cobertura e nunca por assinatura |
| `apps/web/src/lib/judicial/connectors/djen.ts` | `fetchPublication` passa a buscar a certidão (`GET /comunicacao/{hash}/certidao`); `reconcileWindow` lê `GET /caderno/{sigla}/{data}/{meio}` |
| `apps/web/db/migrations/0018_judicial_coverage.sql` | `judicial_coverage_probe` com `office_id`, tribunal, janela, três contagens e o motivo da divergência |
| `apps/web/db/sources/djen-homologacao.json`, `djen-producao.json` | Duas fichas, dois allowlists, dois `enable --live` |

A certidão é gravada como **snapshot próprio ligado à publicação**, com seu `content_type` e seu
sha256. Ela não substitui o corpo da publicação: são duas evidências diferentes do mesmo fato.

`judicial_coverage_probe` guarda três números por janela e tribunal — o que a fonte declarou
existir, o que o Lume ingeriu e o que o caderno oficial contém — mais um campo de motivo. Uma
divergência é um número e uma explicação, nunca um booleano de "cobertura ok".

### Aceite

1. Registrar uma ficha com `contractVersion` sem contrato fixado em `db/sources/contracts/` é
   recusado pelo `judicial:admin register`, com a mensagem apontando o arquivo esperado.
2. Um contrato fixado cujo sha256 não confere é recusado na carga, com `schema_changed`.
3. `normalize` relê a amostra de produção gravada por A1 com `unknownFields` vazio. Enquanto não
   houver amostra de produção, o teste roda sobre a amostra de homologação e o item permanece
   **não concluído** — não se marca A2 como pronto com fixture sintética.
4. A certidão de uma publicação gera um segundo snapshot ligado ao mesmo `judicial_publication`;
   o corpo da publicação permanece byte-idêntico ao que a coleta original gravou.
5. Reconciliação de uma janela de um dia para um tribunal grava uma linha com os três números.
   Quando divergem, a linha traz `divergence_reason` preenchido e é gerado um alerta
   `coverage_gap`; quando coincidem, nenhum alerta.
6. Homologação e produção são duas instalações. Habilitar uma não habilita a outra, e o
   `allowedHosts` de uma **recusa** o host da outra com `TransportBlockedError`.
7. `reconcileWindow` nunca é agendada por assinatura: criar uma assinatura com essa operação é
   recusado na aplicação.

### Teste que acompanha

`apps/web/tests/judicial-djen-contract.test.ts`

```ts
test("ficha sem contrato fixado é recusada no register", …)
test("contrato fixado com sha256 divergente é recusado com schema_changed", …)
test("normalize relê a amostra gravada sem campos desconhecidos", …)
test("certidão: segundo snapshot, mesmo corpo de publicação", …)
test("reconciliação: três contagens e motivo quando divergem", …)
test("reconciliação sem divergência não gera alerta", …)
test("homologação e produção: allowlist de uma bloqueia o host da outra", …)
test("assinatura com reconcileWindow é recusada", …)
```

Fixtures: `djen-producao-amostra.json` (gravada por A1; até existir, `djen-homologacao-amostra.json`),
`djen-certidao.json`, `djen-caderno-dia.json`, `djen-caderno-divergente.json`.

### Bloqueio

Itens 3 a 6 exigem acesso ao ambiente correspondente. Os itens 1, 2 e 7 são construíveis hoje.

---

## A3 — Conector MNI/SOAP

### Problema

MNI é o protocolo que dá capa, movimentos e documentos de um processo. É o que falta para o
produto dizer algo sobre um processo além de "houve uma publicação". `connectorFor` recusa `mni`
com `unsupported` hoje, o que é honesto e insuficiente.

### Decisão: envelope à mão, não cliente SOAP genérico

O transporte já resolve HTTPS, allowlist por instalação, redirect manual, teto de bytes, MIME
permitido e recusa de rede interna, e já aceita `POST` com `application/soap+xml`. Um cliente SOAP
genérico traria seu próprio HTTP e ignoraria essas guardas. O que falta é pequeno: montar um
envelope e ler XML com segurança.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/judicial/connectors/soap.ts` | `buildEnvelope(operation, body, namespaces)`, `readEnvelope(xml)` e `faultToConnectorError(xml)` |
| `apps/web/src/lib/judicial/connectors/mni.ts` | `createMniConnector(transport)`, `MNI_PARSER_VERSION`, `normalizeConsultarProcesso` puro |
| `apps/web/src/lib/judicial/connectors/index.ts` | `factories.mni = createMniConnector` |
| `apps/web/db/sources/contracts/mni-<tribunal>-2.2.2.wsdl` + `.sha256` | WSDL fixado por instalação, não por sistema |

**Leitura de XML.** `readEnvelope` recusa o payload **antes de qualquer parse** se ele contiver
`<!DOCTYPE` ou `<!ENTITY`, devolvendo `schema_changed`. O parser é configurado sem processamento
de entidades, com teto de profundidade, de número de nós e de tamanho de atributo. Não existe
caminho em que uma entidade externa seja resolvida.

**Operações e efeitos**, declarados por instalação em `describeCapabilities`:

| Operação MNI | Mapeamento | Efeito | Nesta entrega |
| --- | --- | --- | --- |
| `consultarProcesso` | `lookupCase` | `neutral_query` | Implementada |
| `consultarAlteracao` | `lookupCase` incremental | `neutral_query` | Implementada quando a instalação declarar |
| `consultarAvisosPendentes` | — | `possible_notice` | **Recusada por nome**, com guarda e teste |
| `consultarTeorComunicacao` | — | `possible_notice` | **Recusada por nome** |
| `entregarManifestacaoProcessual` | — | `filing` | **Recusada por nome** |
| documentos do processo | `fetchDocument` | `unknown` | Declarada `supported: false` enquanto a permissão `documents` não for `permitido` |

**Credencial.** Vem de `judicial_connection.secret_ref`, é decifrada no ponto de chamada, entra no
envelope como `idConsultante`/`senhaConsultante` e é **removida pelo sanitizador antes do
snapshot**. Ela não aparece em log, em mensagem de erro nem em payload persistido.

### Aceite

1. O envelope gerado para `consultarProcesso` é byte-idêntico à fixture de requisição, ignorando
   apenas a quebra de linha final.
2. Payload com `<!DOCTYPE` ou `<!ENTITY` é recusado antes do parse, com `schema_changed`. O teste
   usa uma bomba de entidades e falha se a execução passar de um segundo ou se o texto expandido
   aparecer em qualquer lugar.
3. A senha da fixture não aparece no snapshot gravado, na mensagem de erro nem na saída de log. O
   teste procura a string literal nos três.
4. SOAP Fault de autorização vira `unauthorized`, **encerra** o job e suspende a assinatura, em vez
   de repetir a recusa a cada intervalo.
5. Número inexistente devolve `not_found_in_source`, não um sucesso com zero itens.
6. Processo sigiloso devolve `forbidden` com o motivo declarado pela fonte e **nenhuma** linha de
   movimento é gravada.
7. A mesma numeração em dois graus produz dois `judicial_source_record` distintos; nenhum registro
   mistura movimentos de graus diferentes.
8. `normalize` é puro: o teste injeta um transporte que lança se for chamado, e a normalização
   passa. Duas execuções sobre o mesmo XML produzem estruturas idênticas.
9. Uma operação de possível ciência é recusada dentro do worker: o job devolve `skipped` com o
   motivo e não gasta requisição.
10. WSDL com sha256 divergente do fixado faz `health` devolver `schema_changed`, e a instalação não
    é usada até alguém revisar.

### Teste que acompanha

`apps/web/tests/judicial-mni.test.ts`

```ts
test("envelope de consultarProcesso é byte-idêntico à fixture", …)
test("XXE: DOCTYPE e ENTITY são recusados antes do parse", …)
test("bomba de entidades não expande e não demora", …)
test("credencial não aparece em snapshot, erro nem log", …)
test("fault de autorização encerra o job e suspende a assinatura", …)
test("número inexistente devolve not_found_in_source", …)
test("processo sigiloso devolve forbidden e não grava movimento", …)
test("mesma numeração em dois graus produz dois registros", …)
test("normalize é puro e não toca no transporte", …)
test("operação de possível ciência é recusada no worker", …)
test("WSDL com hash divergente reprova no health", …)
```

Fixtures: `mni-consultarProcesso-request.xml`, `mni-consultarProcesso-ok.xml`,
`mni-fault-unauthorized.xml`, `mni-nao-encontrado.xml`, `mni-sigiloso.xml`,
`mni-dois-graus.xml`, `mni-xxe.xml`, `mni-entity-bomb.xml`.

### Bloqueio

Nenhum. Todo o item é construível e testável hoje contra fixtures. Validar contra um tribunal é A6.

---

## A4 — Esteira de processo: movimentos com proveniência

### Problema

`judicial_movement` existe no esquema desde a migração 0011 e **nunca recebeu uma linha**: não há
produtor. O coletor só sabe executar `listChanges` de publicações. Sem esta esteira, o conector MNI
de A3 não chega ao produto.

### Decisão: a primeira coleta é linha de base, não notícia

Quando um vínculo é consultado pela primeira vez, o Lume vê uma vida inteira de movimentos de uma
vez. Emitir um alerta por movimento transformaria o vínculo em uma avalanche. A primeira coleta de
um `judicial_source_record` grava os movimentos e **zero alertas**; alertas `new_movement` passam a
ser emitidos a partir da segunda coleta, apenas para o que apareceu depois da linha de base. É a
mesma distinção que o esquema já faz entre `new_publication` e `historical_publication`, aplicada
com o recurso que o esquema oferece, sem inventar um `event_kind` novo.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/judicial/repositories/cases.ts` | `ingestCase(input)`: snapshot, `judicial_source_record`, movimentos deduplicados por `movementFingerprint` e outbox, tudo na mesma transação |
| `apps/web/src/lib/judicial/jobs/collector.ts` | Ramo `operation === 'lookupCase'`, sem nenhum `if` por `installation.kind` |
| `apps/web/src/lib/judicial/jobs/scheduler.ts` | Assinatura com `target_kind = 'case'` agenda `lookupCase` |
| `apps/web/src/lib/capabilities/contracts.ts` | `k5_judicial_list_movements`, com `untrustedContent: true` na saída |
| `apps/web/src/lib/application/judicial-service.ts` | `listJudicialMovements(context, input)`, escritório derivado da sessão |
| `apps/web/src/components/judicial-case-links.tsx` | Lista de movimentos do processo, com os estados de [DESIGN.md](../../apps/web/DESIGN.md) |

### Aceite

1. Primeira coleta de um vínculo grava N movimentos e **zero** alertas.
2. Reexecutar o mesmo job é inerte: 0 movimentos novos, 0 alertas.
3. Coleta seguinte com um movimento novo grava 1 linha e 1 alerta `new_movement`; reexecutar esse
   job não produz um segundo alerta.
4. Dois movimentos com o mesmo código, no mesmo dia, com textos diferentes são duas linhas — o
   `movementFingerprint` já cobre isso e o teste fixa o comportamento.
5. Movimento cujo código a fonte não declarou grava `tpu_code IS NULL`. Nenhum código é atribuído
   por semelhança de texto.
6. Interrupção entre o download e o commit não deixa movimento sem snapshot: o teste aborta após
   `persistSnapshot` e verifica que `judicial_movement` não tem órfão.
7. Escritório B não alcança movimento de A por nenhuma rota, capacidade ou ferramenta de agente.
8. Texto de movimento chega ao agente com `untrustedContent: true`; uma fixture contém texto em
   formato de injeção e nada age sobre ele.
9. O corpo de `runJob` não contém ramo por `installation.kind`: a operação decide, o tipo de fonte
   não.

### Teste que acompanha

`apps/web/tests/judicial-case-pipeline.test.ts`

```ts
test("primeira coleta grava linha de base sem alertas", …)
test("reexecutar o job é inerte", …)
test("movimento novo gera um alerta e só um", …)
test("mesmo código e mesmo dia com textos diferentes são dois movimentos", …)
test("sem código declarado, tpu_code fica nulo", …)
test("queda antes do commit não deixa movimento órfão", …)
test("isolamento entre escritórios em rota, capacidade e ferramenta", …)
test("texto de movimento é marcado como não confiável", …)
test("o coletor não ramifica por tipo de fonte", …)
```

### Bloqueio

Nenhum. A3 fornece o conector; enquanto ele não existir, o teste usa um conector de fixture que
implementa `lookupCase`.

---

## A5 — Vocabulário TPU/SGT

### Problema

`judicial_vocabulary_term` também não tem produtor. Sem ele, movimentos de tribunais diferentes não
agrupam, e a tentação de mapear por semelhança de rótulo — que o contrato proíbe — cresce a cada
tribunal novo.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/scripts/judicial-vocab.ts` | `pnpm judicial:vocab import --file <dump> --version <v>` e `describe --kind movement --code <c>` |
| `apps/web/src/lib/judicial/normalization/vocabulary.ts` | `resolveTpu(kind, code, version)` devolvendo `null` ou `{ code, label, source: 'catalog_exact' }` |

### Aceite

1. Reimportar a mesma versão é inerte: zero linhas novas, zero alterações.
2. Importar uma versão nova **não altera nenhuma linha de `judicial_movement` já gravada**. O
   histórico fica como foi ingerido; só coletas futuras usam o catálogo novo.
3. Código ausente do catálogo mantém `source_code` e `source_text` e deixa `tpu_code` nulo.
4. Dois códigos diferentes com rótulos parecidos não são unificados, em nenhuma direção.
5. Termo com `valid_to` no passado não é oferecido como filtro corrente, mas continua resolvendo o
   rótulo de eventos históricos.
6. `resolveTpu` só devolve `catalog_exact`; nenhuma outra estratégia existe no código.

### Teste que acompanha

`apps/web/tests/judicial-vocabulary.test.ts`

```ts
test("reimportar a mesma versão é inerte", …)
test("nova versão não reescreve movimento já gravado", …)
test("código desconhecido preserva o original e não inventa TPU", …)
test("rótulos parecidos com códigos diferentes não se unificam", …)
test("termo vencido não vira filtro corrente mas resolve histórico", …)
```

Fixtures: `tpu-v1.json`, `tpu-v2.json` (com um código renomeado e um desativado).

### Bloqueio

Construir, não. Concluir exige o dump oficial do SGT, que é público — item de Onda 0 curto.

---

## A6 — Segunda instalação

### Problema

Um adaptador que funciona em um tribunal pode ser um molde daquele tribunal. A prova de que a
arquitetura aguenta expansão é a segunda instalação de **contrato diferente** passando pela mesma
esteira sem alterá-la.

### Entregáveis

Fichas e contratos fixados para TJAM SAJ (MNI 2.2.2) e TJAM Projudi (webservice próprio), mais o
adaptador Projudi se o contrato divergir do MNI — o que é a expectativa, não a exceção.

### Aceite

1. A mesma amostra de aceite (mínimo 30 processos autorizados, cobrindo classes, graus, ativos,
   baixados e legados) roda nas duas instalações e produz relatório de cobertura por instalação.
2. Adicionar a segunda instalação **não altera** `collector.ts`, `queue.ts`, `scheduler.ts` nem
   `evidence.ts`. Uma alteração em qualquer um deles é sinal de que a abstração vazou e o item não
   está concluído.
3. Processo presente em um tribunal e ausente no outro é registrado como limitação de cobertura,
   com denominador, e não omitido da amostra.
4. As duas instalações têm orçamento e limite próprios; esgotar o de uma não afeta a outra.

### Teste que acompanha

`apps/web/tests/judicial-mni.test.ts`, parametrizado:

```ts
for (const inst of [tjamSaj, tjamProjudi]) {
  test(`${inst.courtCode}: mesma esteira, contrato próprio`, …)
  test(`${inst.courtCode}: orçamento é por instalação`, …)
}
```

### Bloqueio

Exige os dois serviços respondendo e a Onda 0 concluída para o TJAM.

---

## A7 — Operação: canário, painel e compose

### Problema

`pnpm judicial:worker` existe e **não está no [`docker-compose.yml`](../../docker-compose.yml)**: em
Docker, `web`, `worker` e `notifications` sobem e a coleta judicial não. Além disso, uma mudança de
schema em um tribunal é descoberta hoje por um usuário, não pelo sistema.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `docker-compose.yml` | Serviço `judicial` com `command: ["pnpm", "judicial:worker"]`, mesmo `app_env`, dependendo de `setup` |
| `apps/web/scripts/judicial-canary.ts` | Uma requisição por instalação habilitada, sobre um alvo público estável, com relatório de conformidade |
| `apps/web/src/app/platform/judicial/page.tsx` | Painel por instalação: última coleta, watermark, atraso da fila, 429/403, schema rejeitado, cobertura, custo e versão do conector |

### Aceite

1. `docker compose up` sobe a coleta judicial; `docker compose logs judicial` mostra o ciclo.
2. O canário de uma instalação com resposta divergente marca a instalação como `degraded`, pausa as
   assinaturas **dela** e gera um alerta — sem tocar em nenhuma outra instalação.
3. O canário respeita o orçamento: nunca gasta mais de uma requisição por instalação por execução.
4. O painel distingue "nenhum resultado" de "fonte fora do ar" e de "coleta atrasada"; as três
   aparecem com texto diferente.
5. O painel exige papel de administrador da plataforma; um advogado autenticado recebe recusa.

### Teste que acompanha

`apps/web/tests/judicial-operations.test.ts`

```ts
test("canário degrada apenas a instalação divergente", …)
test("canário gasta no máximo uma requisição por instalação", …)
test("painel exige administrador de plataforma", …)
test("painel separa sem resultado, fonte fora do ar e coleta atrasada", …)
```

Compose é verificado manualmente e registrado na nota de implementação, como as demais mudanças de
infraestrutura do repositório.

### Bloqueio

Nenhum.
