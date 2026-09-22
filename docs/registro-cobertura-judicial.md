# Registro nacional de investigação e cobertura judicial

Data: 18/09/2026. Prioridade confirmada: **cível estadual + STJ/STF**. Este é um backlog de descoberta, não uma lista de integrações prontas.

O [plano principal](plano-infra-judicial.md) define as receitas R1–R8, o modelo das fichas, a arquitetura e os gates. O [catálogo de fontes](fontes-infra-judicial.md) contém evidência oficial dos pontos já encontrados.

## Como usar cada linha

1. Localizar o portal pelo [diretório do CNJ](https://www.cnj.jus.br/poder-judiciario/) ou [lista estadual](https://www.cnj.jus.br/tribunais-de-justica-estaduais/) e confirmar o domínio atual no próprio órgão. O [mapa de aliases do DataJud](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/) ajuda a conferir siglas, sem conceder acesso ou cobertura em outra fonte.
2. Pesquisar no domínio confirmado: `API consulta processual`, `MNI WSDL`, `integração sistemas`, `dados abertos`, `jurisprudência` e `diário`. Usar o nome de cada sistema encontrado como filtro adicional.
3. Executar a receita indicada; abrir fichas filhas para cada grau, instalação/sistema, competência e período. Incluir turmas recursais, juizados, legados e migrações. Não assumir que a instância de segundo grau atende primeiro grau.
4. Registrar evidências, canais de contato, acesso/uso, contratos, amostra, responsável, data e próximo passo. Quando houver documentação, passar ao spike; se houver dúvida de acesso, preparar solicitação oficial.
5. Só marcar produção depois do gate da seção 12 do plano. A autorização/operabilidade de um tribunal não se estende aos demais que usam a mesma família de software.

Cada linha inicia com responsável a designar, endpoint a descobrir e produção desabilitada. A coluna “ponto de partida” registra apenas achados documentais. Priorização entre estados: quantidade de processos reais dos escritórios, demanda por documentos, acesso disponível e custo de manutenção. Não atribuir prioridade comercial somente porque um endpoint é fácil de encontrar.

## Fontes transversais

| ID | Fonte e receita | Uso | Próximo passo |
| --- | --- | --- | --- |
| CNJ-DJEN | R1 | Publicações e certidões | Confirmar OpenAPI de produção e fazer spike por tribunal/período |
| CNJ-TPU | R6 | Classes, movimentos e assuntos | Obter WSDL/dados, validar código conhecido e vigência |
| CNJ-DATAJUD | R7, opcional | Enriquecimento processual | Resolver condição de uso antes do consumo comercial |
| CNJ-DOMICILIO | R8, posterior | Comunicações da organização habilitada | Classificar efeitos, representação e acesso; não executar coleta de teor |
| DIARIOS-HISTORICOS | R5 por órgão | Publicações anteriores e lacunas | Descobrir início/fim de cada acervo e transição para DJEN |

## Justiça estadual — 27 tribunais

Receita padrão: R1 para publicações; R2/R3 para processo/documento; R4 para jurisprudência; R5 para histórico. Receita não significa que a respectiva API existe. As colunas abaixo apontam o próximo trabalho para cada órgão individual.

| ID | Tribunal/UF | Ponto de partida e trabalho individual |
| --- | --- | --- |
| TJAC | Acre | Documentação de SOAP para tabelas localizada; não prova consulta processual. R3 para processo. |
| TJAL | Alagoas | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJAP | Amapá | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJAM | Amazonas | Contratos públicos SAJ e Projudi localizados. Dois spikes separados R2/R3; operação não testada. |
| TJBA | Bahia | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJCE | Ceará | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJDFT | Distrito Federal e Territórios | API de jurisprudência localizada. R4 primeiro; investigar acesso processual separadamente por R2/R3. |
| TJES | Espírito Santo | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJGO | Goiás | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJMA | Maranhão | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJMT | Mato Grosso | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJMS | Mato Grosso do Sul | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJMG | Minas Gerais | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJPA | Pará | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJPB | Paraíba | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJPR | Paraná | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJPE | Pernambuco | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJPI | Piauí | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJRJ | Rio de Janeiro | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJRN | Rio Grande do Norte | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJRS | Rio Grande do Sul | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJRO | Rondônia | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJRR | Roraima | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJSC | Santa Catarina | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJSP | São Paulo | Documentação de integração fiscal institucional localizada; não prova acesso do Lume. Mapear e-SAJ/eproc por período. |
| TJSE | Sergipe | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |
| TJTO | Tocantins | Descobrir instalações e contratos R2/R3; verificar jurisprudência R4 e cobertura DJEN R1. |

## Justiça federal — 6 regiões

O acesso regional não prova cobertura das seções judiciárias. Desdobrar os estados indicados em instalações reais, considerando sistemas legados e eventuais bases centralizadas. Confirmar a organização vigente no órgão antes de provisionar.

| ID | Seções a inventariar | Trabalho individual |
| --- | --- | --- |
| TRF1 | AC, AM, AP, BA, DF, GO, MA, MT, PA, PI, RO, RR, TO | Mapear segundo grau e seções; R2/R3, R1 e R4; verificar separação de acervo migrado para TRF6 |
| TRF2 | ES, RJ | Mapear segundo grau e seções; R2/R3, R1 e R4 |
| TRF3 | MS, SP | Mapear segundo grau e seções; R2/R3, R1 e R4 |
| TRF4 | PR, RS, SC | Mapear segundo grau e seções; investigar integração eproc, R3; R1 e R4 |
| TRF5 | AL, CE, PB, PE, RN, SE | Mapear segundo grau e seções; R2/R3, R1 e R4 |
| TRF6 | MG | Mapear segundo grau, seção e acervo histórico; R2/R3, R1 e R4 |

Incluir TNU e turmas regionais de uniformização como fichas adicionais de pesquisa/precedentes quando a área federal entrar no produto; não presumir que pertençam ao endpoint de jurisprudência regional. Fonte institucional a localizar pelo CJF.

## Justiça do trabalho — 24 regiões

Receita por linha: descobrir instalações e versões PJe/legado, MNI e elegibilidade (R2/R3); publicações R1/R5 e jurisprudência R4. A hipótese de família comum serve para reutilizar código após validar o contrato individual.

| ID | Trabalho individual | Estado |
| --- | --- | --- |
| TRT1 | Inventariar 1º/2º grau, integração e acervo do TRT1; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT2 | Inventariar 1º/2º grau, integração e acervo do TRT2; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT3 | Inventariar 1º/2º grau, integração e acervo do TRT3; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT4 | Inventariar 1º/2º grau, integração e acervo do TRT4; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT5 | Inventariar 1º/2º grau, integração e acervo do TRT5; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT6 | Inventariar 1º/2º grau, integração e acervo do TRT6; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT7 | Inventariar 1º/2º grau, integração e acervo do TRT7; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT8 | Inventariar 1º/2º grau, integração e acervo do TRT8; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT9 | Inventariar 1º/2º grau, integração e acervo do TRT9; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT10 | Inventariar 1º/2º grau, integração e acervo do TRT10; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT11 | Inventariar 1º/2º grau, integração e acervo do TRT11; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT12 | Inventariar 1º/2º grau, integração e acervo do TRT12; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT13 | Inventariar 1º/2º grau, integração e acervo do TRT13; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT14 | Inventariar 1º/2º grau, integração e acervo do TRT14; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT15 | Inventariar 1º/2º grau, integração e acervo do TRT15; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT16 | Inventariar 1º/2º grau, integração e acervo do TRT16; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT17 | Inventariar 1º/2º grau, integração e acervo do TRT17; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT18 | Inventariar 1º/2º grau, integração e acervo do TRT18; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT19 | Inventariar 1º/2º grau, integração e acervo do TRT19; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT20 | Inventariar 1º/2º grau, integração e acervo do TRT20; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT21 | Inventariar 1º/2º grau, integração e acervo do TRT21; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT22 | Inventariar 1º/2º grau, integração e acervo do TRT22; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT23 | Inventariar 1º/2º grau, integração e acervo do TRT23; executar R2/R3, R1/R5 e R4 | A descobrir |
| TRT24 | Inventariar 1º/2º grau, integração e acervo do TRT24; executar R2/R3, R1/R5 e R4 | A descobrir |

## Justiça eleitoral — 27 tribunais regionais

A cobertura eleitoral entra depois do piloto cível. Por região, mapear competências e instâncias que o sistema regional realmente cobre; não inferir cobertura das zonas eleitorais por um resultado no portal do TRE. Receita R2/R3 para processos, R1/R5 para publicações e R4 para jurisprudência.

| ID | UF | Estado e trabalho individual |
| --- | --- | --- |
| TRE-AC | AC | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-AL | AL | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-AP | AP | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-AM | AM | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-BA | BA | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-CE | CE | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-DF | DF | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-ES | ES | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-GO | GO | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-MA | MA | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-MT | MT | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-MS | MS | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-MG | MG | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-PA | PA | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-PB | PB | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-PR | PR | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-PE | PE | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-PI | PI | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-RJ | RJ | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-RN | RN | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-RS | RS | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-RO | RO | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-RR | RR | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-SC | SC | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-SP | SP | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-SE | SE | A descobrir: portal, instalações e contratos; executar receitas por capacidade |
| TRE-TO | TO | A descobrir: portal, instalações e contratos; executar receitas por capacidade |

## Justiça militar estadual — 3 tribunais

| ID | Órgão | Estado e trabalho individual |
| --- | --- | --- |
| TJMMG | Justiça Militar de Minas Gerais | A descobrir: sistemas, graus, R2/R3, publicações R1/R5 e jurisprudência R4 |
| TJMSP | Justiça Militar de São Paulo | A descobrir: sistemas, graus, R2/R3, publicações R1/R5 e jurisprudência R4 |
| TJMRS | Justiça Militar do Rio Grande do Sul | A descobrir: sistemas, graus, R2/R3, publicações R1/R5 e jurisprudência R4 |

Nos demais estados, a competência militar estadual deve ser inventariada na estrutura correspondente do TJ, sem inventar um tribunal separado. Para a Justiça Militar da União, desdobrar o STM em instalações e auditorias cobertas conforme documentação própria.

## STF e tribunais superiores — 5 órgãos

| ID | Prioridade | Trabalho individual |
| --- | --- | --- |
| STF | Confirmada | R4: Corte Aberta, downloads e busca de fonte textual de decisões; separar estatística de jurisprudência. R2 institucional tem elegibilidade a esclarecer. |
| STJ | Confirmada | R4: enumerar todos os conjuntos/órgãos julgadores via CKAN; testar espelhos + íntegras; registrar licença por conjunto. R1/R5 para publicações. |
| TST | Expansão | R4 jurisprudência e precedentes, R1/R5 publicações e R2/R3 processos; acesso a descobrir. |
| TSE | Expansão | R4 jurisprudência e bases abertas, R1/R5 publicações e R2/R3 processos; acesso a descobrir. |
| STM | Expansão | R4 jurisprudência, R1/R5 publicações e R2/R3 processos; mapear instalações da Justiça Militar da União. |

## Ficha operacional a preencher por instalação

Copiar a estrutura abaixo para o registro de configuração/ficha da implementação, mantendo evidência em documentação ou storage administrativo autorizado. Os campos vazios são trabalho pendente, não configuração de runtime.

- Identificação: órgão, instalação, sistema/versão, grau/competência e período coberto.
- Finalidade: publicações, capa, movimentos, autos, jurisprudência ou taxonomia.
- Descoberta: portal oficial, documentação, canal de suporte, data de revisão e responsável.
- Conexão: ambiente, hosts, OpenAPI/WSDL, versão/hash, operações, paginação, limites e autenticação.
- Efeitos: consulta neutra comprovada, possível ciência, protocolo ou desconhecido, por operação.
- Permissões: titular/representação, acesso, armazenamento, uso comercial, IA, redistribuição e retenção; evidência de cada condição.
- Dados: IDs, datas/fusos, campos, lacunas, anexos, correções e códigos locais/TPU.
- Verificação: amostra, comparação com fonte, limitações, fixtures, resultados e aprovação do gate.
- Operação: frequência, orçamento, canário, alerta, runbook, suspensão, próxima revisão e responsável.

## Critério de conclusão do inventário

São **92 órgãos judiciais de partida**: 27 TJs, 6 TRFs, 24 TRTs, 27 TREs, 3 TJMs e STF/STJ/TST/TSE/STM. Essa contagem não representa quantidade de conectores, endpoints ou unidades judiciárias. A descoberta também deve incluir fontes transversais, instalações de primeiro grau e acervos históricos.

O inventário só está operacionalmente completo quando cada linha tiver suas instalações identificadas ou uma lacuna explícita, responsável e próximo passo. O registro entregue inicia esse trabalho; não afirma que 92 APIs foram pesquisadas ou testadas. Atualizações institucionais devem ser conferidas nos diretórios oficiais antes de cada nova onda.

