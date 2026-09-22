# Consulta pública de documentos: candidato TJAM

**Prioridade esclarecida depois desta pesquisa:** o objetivo principal é formar um acervo de jurisprudência por tema. Ver a [primeira amostra sobre guarda à avó](acervo-jurisprudencia-guarda-avo.md). O TJAM permanece candidato complementar para consulta processual e peças.

Pesquisa registrada em 22/09/2026, data de referência do ambiente. Escopo: documentação e contratos públicos; nenhum processo real foi consultado, nenhum documento processual foi baixado e nenhuma fonte foi habilitada. Complementa [Fontes para infraestrutura judicial](fontes-infra-judicial.md).

O TJAM é um candidato para piloto, ainda sem tribunal escolhido pelo usuário. A documentação declara acesso público a processos e documentos, e os contratos foram obtidos. Isso não comprova que todas as peças sejam públicas nem que as operações funcionem sem credenciais.

## Declaração do tribunal

A página oficial, datada de 09/03/2026, declara consumo sem login, senha, token ou habilitação prévia. Descreve consulta de processos de primeiro e segundo graus por número e sistema de origem, pesquisas por partes e advogados e obtenção de documento individual por código, descrito como PDF em bytes. Publica os endereços PROJUDI e SAJ e indica o Balcão Virtual como suporte técnico. A página consultada não detalha quotas, cobertura dos documentos, codificação do retorno ou condições específicas de reutilização comercial. [Fonte: Dados Abertos do TJAM](https://www.tjam.jus.br/index.php/dados-abertos).

## Contratos efetivamente obtidos

O navegador de pesquisa não conseguiu interpretar os WSDLs. Requisições HTTP GET diretas, sem credenciais, retornaram HTTP 200 e XML nos dois endereços. Isso valida a disponibilidade dos contratos, não a execução das operações.

### PROJUDI

O [WSDL PROJUDI](https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService?wsdl) retornou 8.908 bytes. Expõe `consultarProcesso`, `consultarProcessosPorNumero`, `consultarDocumento`, consultas por advogado/nome/documento da parte, audiência e disponibilidade do serviço.

O [XSD de consulta](https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService?xsd=2), também obtido com HTTP 200, especifica:

| Operação | Entrada relevante | Retorno declarado |
| --- | --- | --- |
| `consultarProcesso` | `numeroUnicoProcesso`, `sistemaTribunal`, `systemPass`, todos com `minOccurs=0` | `xs:string` |
| `consultarDocumento` | `codigoDocumento` (`xs:long`), `sistemaTribunal`, `systemPass`, todos com `minOccurs=0` | `xs:string` |
| `consultarProcessosPorNumero` | `numeroUnico`, `numeroOriginal`, referências a sistema e senha | `consultaProcessual` estruturada |

O tipo estruturado `processoCP` contém número, link, partes, movimentações e `segredoJustica`; não expõe coleção tipada de documentos. `movimentacao` contém complemento, data, evento e responsável, sem código de documento tipado. Portanto, ainda falta descobrir como obter os códigos das peças a partir da consulta por número. [Fonte: XSD PROJUDI](https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService?xsd=2).

`systemPass` opcional no XML não prova acesso anônimo operacional. O retorno `xs:string` também não prova PDF direto ou base64: pode conter outra representação que só uma resposta controlada permitirá identificar. Essas duas diferenças em relação à descrição resumida da página precisam ser resolvidas antes do conector. [Fonte: XSD PROJUDI](https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService?xsd=2).

### SAJ

O [WSDL SAJ](https://consultasaj.tjam.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao?wsdl) retornou 16.624 bytes e é um contrato MNI 2.2.2. Não corresponde às mesmas operações nominais do PROJUDI. Inclui consulta processual e operações de comunicações, manifestação processual e confirmação de recebimento; estas últimas não integram o escopo de consulta pública proposto.

O [XSD de tipos SAJ](https://consultasaj.tjam.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao?xsd=../xsd/tipos-servico-intercomunicacao-2.2.2.xsd), obtido com HTTP 200, inclui `idConsultante` e `senhaConsultante` em `tipoConsultarProcesso`. Seu texto prevê dispensá-los quando houver autenticação por certificado cliente. Também define número processual, data de referência, movimentos e seleção de cabeçalho/documentos ou identificadores de documentos. Prevê documentos de comunicações pendentes possivelmente cifrados.

Essa descrição de autenticação precisa ser conciliada com a declaração pública da página. Não foi comprovado consumo anônimo nem acesso público às peças nessa instalação. Não se deve inferir uma política operacional apenas do contrato MNI genérico.

## Encaixe no K5

Inspeção local do projeto, fornecida pela análise principal:

- [Contrato judicial](../apps/web/src/lib/judicial/contracts.ts): `NormalizedDocument` representa metadados/URL, `fetchDocument` é opcional e não existe `listDocuments`.
- [Registro de conectores](../apps/web/src/lib/judicial/connectors/index.ts) contém apenas DJEN; o [coletor](../apps/web/src/lib/judicial/jobs/collector.ts) aceita apenas `listChanges`.
- [Transporte](../apps/web/src/lib/judicial/connectors/transport.ts) retorna corpo textual. SOAP exige interpretar XML e decodificar o conteúdo conforme a resposta real; downloads HTTP diretos de PDF precisam preservar bytes, sem convertê-los em UTF-8.
- A [migração judicial](../apps/web/db/migrations/0011_judicial.sql) já prevê `judicial_document`, origem, hash, armazenamento, vínculo com o Cofre, autor/data da importação e isolamento por escritório.

Fluxo proposto: número CNJ → selecionar fonte e processo → listar documentos públicos disponíveis → selecionar peças → importar ao Cofre com origem. A implementação deve reaproveitar a ingestão e o versionamento existentes do Cofre e tratar documento indisponível/restrito como resultado explícito.

Próximo passo técnico: esclarecer acesso anônimo e formato dos retornos, demonstrar a descoberta dos códigos de documentos e validar uma consulta controlada com processo público escolhido para o piloto. Nenhuma chamada SOAP operacional foi realizada nesta pesquisa. Não houve alteração de código da aplicação; testes de aplicação não se aplicam a esta nota.
