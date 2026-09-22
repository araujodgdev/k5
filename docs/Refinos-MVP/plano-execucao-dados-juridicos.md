# Plano de execução: dados de tribunais e jurisprudência

Data: 22/09/2026. Status: plano de execução. Este documento não contata tribunais, não solicita
credenciais e não liga nenhuma fonte. Ele organiza em ondas o trabalho que transforma a fundação
já existente em duas capacidades vendáveis: **consultar as APIs dos tribunais** e **pesquisar
jurisprudência**, inclusive onde só existe portal e não existe API.

Acompanha o [plano de infraestrutura judicial](plano-infra-judicial.md) e a
[nota do que existe no código](infra-judicial-implementacao.md). O que muda aqui é a granularidade:
cada item abaixo tem entregável, critério de aceite verificável e o teste que o acompanha.

## Documentos desta entrega

| Documento | Trilha | O que resolve |
| --- | --- | --- |
| [Conectores de tribunais](plano-conectores-tribunais.md) | A | DJEN confrontado com produção, conector MNI/SOAP, esteira de processo e movimentos, vocabulário TPU |
| [Jurisprudência](plano-jurisprudencia.md) | B | Acervo STJ e TJDFT por API, esquema compartilhado, busca, citação verificável e avaliação |
| [Automação de navegador](plano-automacao-navegador.md) | C | Serviço de coleta por navegador para portais sem API, com as guardas que o tornam admissível |
| [Testes e gate](plano-testes-dados-juridicos.md) | — | Suíte determinística, suíte de conformidade contra fonte real, canários e o checklist de liberação |
| [Runbook de habilitação](runbook-habilitacao-fonte.md) | — | O caminho operacional de uma ficha até `--live`, que é o que hoje bloqueia tudo |

## 1. Onde estamos, sem otimismo

A fundação está pronta e é boa: esquema com proveniência de seis momentos, fila durável com lease
e orçamento no banco, transporte com allowlist por instalação e recusa de rede interna, contratos
de conector tipados, taxonomia de erros, 11 capacidades publicadas e duas telas. 130 testes passam.

E nada disso já leu um tribunal. Três fatos definem o trabalho:

1. **Nenhum conector fala com um tribunal hoje.** `connectorFor` só resolve `djen`; `mni`, `ckan`,
   `jurisprudence_api`, `vocabulary` e `court_portal` existem como tipo e recusam com `unsupported`
   ([`connectors/index.ts`](../apps/web/src/lib/judicial/connectors/index.ts)).
2. **O contrato do DJEN nunca foi confrontado com uma resposta de produção.** Está escrito a partir
   da documentação, com `parserVersion` fixado exatamente por isso.
3. **As cinco permissões de toda ficha estão `nao_esclarecido`**, então `enable --live` é recusado
   por projeto. Isso não é um bug a contornar: é o portão. Ele só abre com trabalho humano, não com
   código, e está descrito no [runbook](runbook-habilitacao-fonte.md).

A consequência prática: **a maior parte do código das trilhas A, B e C pode ser escrita e testada
hoje, sem acesso a tribunal nenhum**, porque toda a arquitetura já separa `normalize` puro do
transporte. O que depende de terceiros é a confirmação do contrato, não a construção do conector.

Três lacunas menores, todas reais, entram no plano porque custam pouco e doem depois:

- `judicial_movement` e `judicial_vocabulary_term` existem no esquema **sem nenhum produtor**.
- O worker judicial não está no [`docker-compose.yml`](../docker-compose.yml): `web`, `worker` e
  `notifications` sobem; a coleta judicial, não.
- `fetchDocument` está declarado com efeito `unknown` e fora do worker genérico, o que é correto e
  também significa que nenhuma peça é importada hoje.

## 2. As duas capacidades e por que exigem trilhas diferentes

**Consultar processo em tribunal** é integração transacional: um número, uma instalação, uma
credencial, movimentos que mudam, efeito jurídico possível em algumas operações. Erra por
autorização e por contrato divergente.

**Pesquisar jurisprudência** é acervo: volume grande, atualização em lote, licença por conjunto,
relevância como métrica de qualidade. Erra por cobertura, por licença e por confundir ementa com
inteiro teor.

Misturar as duas em um só conector é o erro clássico. O esquema já as separa — `target_kind` de
assinatura aceita `case`, `publications_by_case` e `jurisprudence_collection` — e este plano
mantém a separação até a superfície de busca.

A automação de navegador não é uma terceira fonte: é **um transporte alternativo** para as duas,
usado somente onde a instalação não oferece interface. Ela entra no mesmo contrato
`JudicialConnector`, na mesma fila, com a mesma proveniência. Se ela exigisse um pipeline próprio,
estaria errada.

## 3. Ondas

Estimativas em semanas de calendário para dois engenheiros, sem contar espera por habilitação.
A Onda 0 é humana e roda em paralelo a tudo; ela é o caminho crítico do negócio, não do código.

| Onda | Conteúdo | Depende de | Pode começar hoje | Estimativa |
| --- | --- | --- | --- | --- |
| **0 — Destravar** | Fichas de DJEN homologação, TJAM SAJ, TJAM Projudi, STJ, TJDFT; as cinco permissões respondidas com evidência; contatos oficiais enviados | Decisão de produto e jurídico | Sim | 1–3 semanas de calendário, com espera não estimável |
| **1 — Conectar sem rede** | A1 arnês de conformidade · A3 conector MNI · A4 esteira de processo · A5 TPU · B1 CKAN · B2 TJDFT · B3 esquema do acervo · C1–C3 fundação e guardas do navegador | Onda 0 **não** é pré-requisito | Sim | 3–4 semanas |
| **2 — Confrontar o contrato real** | A2 DJEN homologação e produção · probe gravando fixtures reais · relatório de cobertura por tribunal | Onda 0 para a fonte correspondente | Não | 1–2 semanas por fonte |
| **3 — Pesquisar e navegar de verdade** | B4 busca e capacidades · B5 avaliação · C4 portão de automação · C5 primeira receita de portal real | Onda 1; Onda 2 para a fonte correspondente | Parcial | 3–4 semanas |
| **4 — Operar e expandir** | A6 segunda instalação · A7 canário, painel e compose | Onda 2 aprovada | Não | contínua |

Sequência crítica: Onda 0 corre em paralelo desde o dia 1. Se ela atrasar, a Onda 1 entrega mesmo
assim — conectores completos, testados contra amostras gravadas, atrás dos dois interruptores. O
que **não** se faz na ausência de habilitação é substituir a API por raspagem em silêncio; essa
regra já está no plano de infraestrutura e a trilha C existe para que a alternativa seja explícita,
auditável e decidida por uma pessoa.

## 4. O que significa "pronto" em cada trilha

Cada item das trilhas tem um bloco `Aceite`. A regra de leitura é a mesma em todos:

- **Aceite é observável.** "O parser entende a resposta" não é aceite; "reprocessar a amostra
  gravada de 2026-09-18 produz 47 publicações, 0 rejeitadas e 0 campos desconhecidos silenciados"
  é aceite.
- **Todo aceite tem um teste nomeado.** O bloco `Teste` diz o arquivo, o nome do teste e a fixture.
  Um item sem teste não é entregue; um teste que não falha se o código for removido também não
  conta.
- **HTTP 200 não é aceite**, em nenhuma trilha. É o que a seção 12 do plano de infraestrutura já
  determina e o que o arnês de conformidade (A1) existe para medir.
- **Nenhum item liga uma fonte.** Concluir um item leva a instalação a `spike_approved` no máximo;
  `pilot` e `production` são decisões do runbook, com evidência anexada.

## 5. Decisões que este plano toma

| Decisão | Alternativa recusada | Motivo |
| --- | --- | --- |
| O navegador é um transporte sob o contrato `JudicialConnector` | Um coletor paralelo com seu próprio armazenamento | Proveniência, deduplicação, orçamento e alertas já existem e não podem divergir por origem |
| O navegador executa **receitas versionadas em código**, nunca um agente navegando livre | Dar ao modelo controle do navegador | Uma receita é revisável, testável e determinística; um agente clicando em um portal judicial não é nenhuma das três |
| O acervo de jurisprudência **não tem `office_id`** | Copiar o acervo por escritório | É material público licenciado; duplicar por escritório multiplica custo e não melhora isolamento. O isolamento passa a ser do *escopo de busca*, e isso vira teste |
| O conector MNI é escrito à mão sobre o transporte existente, com XML endurecido | Adicionar uma biblioteca SOAP genérica | O transporte já resolve allowlist, redirect, teto de bytes e MIME; o que falta é envelope e um leitor XML sem DTD, que é menos código do que integrar um cliente que ignora essas guardas |
| DJEN homologação e DJEN produção são **duas instalações**, com fichas e allowlists distintas | Uma instalação com um flag de ambiente | Um flag erra para produção em uma linha; duas fichas exigem dois `enable --live` |
| Documento de tribunal continua fora do worker genérico nesta entrega | Importar peças junto com movimentos | `fetchDocument` tem efeito `unknown` e volume imprevisível; entra depois, com permissão `documents` resolvida por instalação |

## 6. Fora de escopo, explicitamente

Peticionamento, ciência processual, cálculo de prazo, Domicílio Judicial Eletrônico e DataJud
comercial continuam fora, pelos motivos já registrados no plano de infraestrutura. A migração para
PostgreSQL (F5) não bloqueia nenhuma onda aqui, mas bloqueia ampliar o piloto — o acervo de
jurisprudência é o primeiro consumidor que torna o SQLite síncrono insuficiente, e a
[trilha B](plano-jurisprudencia.md) registra onde isso aparece.

Nenhuma onda promete cobertura nacional. O [registro de cobertura](registro-cobertura-judicial.md)
continua sendo a única fonte sobre o que está coberto, instalação por instalação.
