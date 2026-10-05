# Regras de cálculo tributário e consumerista

Pesquisa de fontes primárias em 4 de outubro de 2026. Destina-se à especificação e aos casos de referência do Calc. Os exemplos foram calculados independentemente da implementação do aplicativo.

## Débitos tributários federais em atraso

O art. 61 da Lei 9.430/1996 cobre débitos de tributos e contribuições administrados pela Receita Federal, com fatos geradores desde 01/01/1997. Prevê multa de 0,33% por dia de atraso, limitada a 20%, e SELIC do mês seguinte ao vencimento até o anterior ao pagamento, acrescida de 1% no mês de pagamento. O § 1º fala em primeiro dia subsequente ao vencimento. [Lei 9.430, art. 61](https://www.planalto.gov.br/ccivil_03/leis/l9430.htm#art61).

A orientação operacional da Receita especifica que a contagem começa no primeiro dia **útil** após o vencimento e termina no pagamento. Depois do marco inicial contam-se os dias transcorridos, incluindo fins de semana. Essa distinção deve aparecer no cálculo e nos testes. Não se deve simplesmente contar apenas dias úteis nem presumir que todo vencimento em feriado se prorroga: o vencimento legal depende do tributo. [Receita, multa de mora](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/pagamento-em-atraso/como-calcular-multa-de-mora-acrescimos-legais).

A Receita manda **somar** as taxas SELIC mensais aplicáveis. Não há juros quando o pagamento ocorre no próprio mês do vencimento. No mês seguinte aplica-se somente 1%; nos posteriores, a soma das competências intermediárias mais 1%. Juros e multa incidem sobre o principal. [Receita, juros de mora](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/pagamento-em-atraso/como-calcular-juros-de-mora-acrescimos-legais).

Fórmulas para principal `P`, dias de atraso `d` e taxas mensais em percentual:

```text
multa = P × min(0,0033 × d, 0,20)
juros = 0, se pagamento e vencimento estiverem no mesmo mês
juros = P × (soma(SELIC das competências intermediárias) + 1) / 100, nos demais meses
total = P + multa + juros
```

Definição de produto recomendada: atualização de débito federal informado pelo advogado, com principal, vencimento legal, início da mora conferível e pagamento. Não é apuração do tributo nem emissão de DARF. Não reutilizar automaticamente para ICMS, ISS, IPVA, IPTU, multas de ofício, dívida ativa, parcelamentos ou obrigações acessórias. Essas situações precisam de regras próprias. Para homologação operacional, comparar com [Sicalc, multa](https://sicalc.receita.fazenda.gov.br/sicalc/multa/consulta) e [Sicalc, SELIC](https://sicalc.receita.fazenda.gov.br/sicalc/selic/consulta).

## Restituição ou compensação de pagamento federal indevido

A Lei 9.250/1995, art. 39, § 4º, prevê juros SELIC acumulados mensalmente até o mês anterior à restituição/compensação, mais 1% no mês em que ocorre. A fórmula não comprova a existência nem a compensabilidade do crédito. [Lei 9.250, art. 39](https://www.planalto.gov.br/ccivil_03/leis/l9250.htm#art39).

A IN RFB 2.055/2021, arts. 148 e 149, define os marcos. Pagamento indevido comum começa no mês seguinte ao recolhimento; saldo negativo de IRPJ/CSLL, no mês seguinte ao encerramento da apuração. Restituição da declaração de IRPF e créditos previdenciários têm marcos específicos. Pagamentos anteriores a 1998 também exigem tratamento histórico. Créditos judiciais demandam trânsito em julgado, e sua compensação pode sofrer limites mensais. A compilação encontrada registra alterações até a IN 2.314/2026. [IN RFB 2.055/2021](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=122002).

Para o primeiro lançamento, recomenda-se restringir o preset a pagamento indevido ou a maior, com data de recolhimento desde 01/01/1998. Competências: mês seguinte ao pagamento original até mês anterior à restituição ou entrega da declaração de compensação, mais 1% no mês final. No mesmo mês da origem do crédito, não aplicar atualização. O manual oficial exemplifica essa exclusão e também diferencia GPS paga de contribuição descontada do segurado. [Receita, manual PER/DCOMP de contribuição previdenciária](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/restituicao-ressarcimento-reembolso-e-compensacao/per_dcomp-web_-contribuicao-previdenciaria-indevida-ou-a-maior-pessoa-fisica-segurado-da-previdencia-social.pdf).

É necessário separar o cálculo da elegibilidade para PER/DCOMP. A Receita lista procedimentos e impedimentos para receitas não administradas por ela, dívida ativa, comércio exterior, AFRMM/TUM, Refis e saldo da declaração anual de IRPF, entre outros. A tela deve dizer que calcula a atualização do crédito informado; não afirmar que todo resultado pode ser compensado. [Receita, como solicitar ou compensar DARF](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/restituicao-ressarcimento-reembolso-e-compensacao/creditos/pagamento/darf/como-solicitar-ou-compensar-o-credito).

## Repetição de indébito do consumidor

O art. 42, parágrafo único, do CDC prevê devolução em dobro do **valor pago em excesso**, com correção monetária e juros legais, salvo engano justificável. O valor total da fatura não é necessariamente a base. Cobrança sem pagamento não gera, por si, quantia a restituir por esse dispositivo. [CDC, art. 42](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm#art. 42).

No EAREsp 676.608/RS, a Corte Especial do STJ dispensou a demonstração de dolo ou má-fé subjetiva: importa a conduta contrária à boa-fé objetiva. A modulação alcança apenas contratos de consumo que não envolvam serviços públicos prestados pelo Estado ou concessionárias, para pagamentos após a publicação do acórdão em 30/03/2021. Portanto, não é correto dobrar tudo após essa data, nem limitar automaticamente a devolução simples antes dela. O enquadramento e o engano justificável continuam sujeitos à análise jurídica. O acórdão trata também de prescrição da telefonia, que não deve ser generalizada para todo consumidor. [STJ, acórdão EAREsp 676.608/RS, especialmente item 13](https://www.stj.jus.br/websecstj/cgi/revista/REJ.cgi/ATC?dt=20210330&formato=PDF&nreg=201500497769&salvar=false&seq=58120459&tipo=5).

Recomendação de implementação: registrar cada pagamento indevido e seu valor em excesso, natureza do serviço, modalidade simples ou dobro escolhida pelo advogado e justificativa. Mostrar a referência de 30/03/2021 como ajuda contextual. Não usar essa data como regra automática universal. Para o próprio dia 30/03/2021, exigir o enquadramento informado, pois o texto do precedente usa pagamentos após a publicação.

O cálculo pode aplicar `base = excesso × multiplicador`, em que o multiplicador é 1 ou 2, e atualizar essa base. A dedução de restituições parciais exige datas e método de imputação; não multiplicar por dois uma devolução já recebida nem somar o principal uma terceira vez. Juros, índice de correção e seus termos iniciais devem ser identificados pelo título ou critério jurídico selecionado. Não presumir dano moral, multa de 2% ou honorários automaticamente.

## Séries oficiais e acesso

Os códigos foram confirmados nas páginas oficiais SGS. A unidade é percentual mensal, não fração decimal.

| Série | Conteúdo | Valores de referência confirmados | Consulta oficial |
| --- | --- | --- | --- |
| 4390 | SELIC acumulada no mês | jan/2025 1,01%; fev/2025 0,99%; mar/2025 0,96% | [SGS 4390](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=4390) |
| 433 | IPCA mensal | jan/2025 0,16%; fev/2025 1,31%; mar/2025 0,56% | [SGS 433](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=433) |
| 188 | INPC mensal | jan/2025 0,00%; fev/2025 1,48%; mar/2025 0,51% | [SGS 188](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=188) |
| 29543 | Taxa Legal mensal | jan/2025 0,589427%; fev/2025 0,902209%; mar/2025 0,000000% | [SGS 29543](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=29543) |

O BCB publica a SELIC em [recurso JSON do catálogo](https://dadosabertos.bcb.gov.br/dataset/4390-taxa-de-juros---selic-acumulada-no-mes/resource/449efbb5-366b-4907-820f-8143a63733e1). O padrão BCData/SGS, também documentado no [catálogo federal de dados abertos](https://dados.gov.br/dados/conjuntos-dados/7541-fatores-condicionantes-da-base-monetaria-ampliada-variacao-da-base-ampliada-saldo-em-final-d), recebe código, formato e datas `dd/MM/aaaa`.

Links JSON com intervalo de exemplo:

- [SELIC 4390](https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados?formato=json&dataInicial=01/01/2025&dataFinal=31/03/2025)
- [IPCA 433](https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/01/2025&dataFinal=31/03/2025)
- [INPC 188](https://api.bcb.gov.br/dados/serie/bcdata.sgs.188/dados?formato=json&dataInicial=01/01/2025&dataFinal=31/03/2025)
- [Taxa Legal 29543](https://api.bcb.gov.br/dados/serie/bcdata.sgs.29543/dados?formato=json&dataInicial=01/01/2025&dataFinal=31/03/2025)

Trocar `formato=json` por `formato=csv` solicita o formato tabular. As chamadas diretas à API falharam neste ambiente, com erro de DNS no cliente local. Os valores acima foram conferidos pelo SGS, não por uma resposta JSON bem-sucedida. A integração de produção ainda precisa verificar resposta, formato, cobertura e indisponibilidade.

Há duas diferenças operacionais relevantes. Em 04/10/2026, a série 4390 já expunha outubro com 0,10%, um mês ainda em andamento; esse valor não deve substituir o adicional tributário de 1% nem ser tratado como mês encerrado. A Taxa Legal de outubro já estava publicada em 0,379020%, pois é determinada no início do mês de referência. Dados ausentes não devem virar zero. [SELIC no SGS](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=4390), [Taxa Legal no SGS](https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=29543).

## Taxa Legal e correção

A Resolução CMN 5.171/2024 usa juros simples, inclusive para acumular meses e calcular frações. Para uma parte do mês, usa taxa mensal dividida pelos dias corridos daquele mês, multiplicada pelos dias apropriados. Quando há correção monetária, os juros incidem sobre o valor corrigido. A série tem seis casas decimais e aplicação inicial nos dias 30 e 31/08/2024. A fórmula oficial usa fatores SELIC e IPCA-15 do mês anterior, com piso zero; não subtrair manualmente IPCA 433 de SELIC 4390 para reproduzi-la. [Resolução CMN 5.171](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=5171&tipo=resolu%C3%A7%C3%A3o+cmn).

## Casos independentes para validação

Os cenários abaixo isolam a aritmética; vencimentos e início da mora são pressupostos explícitos, não apuração de calendário de um tributo específico. Valores monetários finais arredondados a centavos.

| Caso | Premissas e conta | Resultado |
| --- | --- | --- |
| Débito, mesmo mês | P = R$ 1.000, vencimento 10/03/2025, início 11/03, pagamento 20/03. 10 dias × 0,33% = 3,30%; juros zero. | Multa R$ 33,00; total R$ 1.033,00. |
| Débito, mês seguinte | P = R$ 1.000, vencimento 20/02/2025, início 21/02, pagamento 10/03. 18 dias × 0,33% = 5,94%; juros 1%. | Multa R$ 59,40; juros R$ 10,00; total R$ 1.069,40. |
| Débito, dois meses intermediários | P = R$ 1.000, vencimento 20/12/2024, início 23/12, pagamento 20/03/2025. 88 dias, multa limitada a 20%. SELIC jan 1,01 + fev 0,99 + março 1 = 3%. | Multa R$ 200,00; juros R$ 30,00; total R$ 1.230,00. |
| Limite de multa | P = R$ 1.000. Comparar 60 e 61 dias contados de mora. | 60 dias = 19,80%, R$ 198,00; 61 dias = teto de 20%, R$ 200,00. |
| Crédito federal | Pagamento indevido de R$ 1.000 em dezembro/2024, compensação em março/2025. Soma jan 1,01 + fev 0,99 + março 1 = 3%. | Crédito atualizado R$ 1.030,00. |
| Crédito no mês seguinte | Indébito R$ 1.000 pago em fevereiro/2025, compensação em março/2025. Não há competência intermediária; adicional de 1%. | R$ 1.010,00. |
| Crédito no próprio mês | Indébito R$ 1.000 pago e compensado no mesmo mês, hipótese elegível. | R$ 1.000,00, sem adicional de 1%. |
| Consumidor, base correta | Fatura de R$ 300 paga integralmente, obrigação legítima R$ 220. Excesso R$ 80, sem atualização neste exemplo. | Simples R$ 80; dobro R$ 160, e não R$ 600 nem R$ 240. |
| Consumidor, sem desembolso | Cobrança indevida R$ 300 não paga. | Principal restituível pelo art. 42 = zero. Outras pretensões não integram a conta. |
| Taxa Legal, dois meses inteiros | P = R$ 1.000, sem correção monetária. Janeiro/2025 0,589427% + fevereiro 0,902209% = 1,491636%. | Juros R$ 14,92; total R$ 1.014,92. Sem capitalização mensal. |
| IPCA, dois meses inteiros | P = R$ 1.000. Janeiro/2025 e fevereiro/2025 incluídos por convenção explícita. Fator 1,0016 × 1,0131 = 1,01472096. | R$ 1.014,72. A composição de inflação difere da soma de juros tributários. |

## Verificação e limites

Fontes consultadas: Planalto, Receita Federal, STJ, BCB e catálogo oficial dados.gov.br. A íntegra do acórdão de consumidor foi lida. O portal normativo da Receita retornou páginas vazias na abertura direta, mas a busca forneceu os artigos e o histórico de alterações da IN. Não houve validação de uma guia Sicalc emitida nem resposta bem-sucedida da API JSON. Esses dois pontos permanecem requisitos de homologação, sem impedir os testes unitários dos exemplos documentados.

Só este documento foi criado nesta pesquisa; nenhuma alteração no aplicativo.
