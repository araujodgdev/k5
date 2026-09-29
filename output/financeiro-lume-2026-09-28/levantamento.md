# Lume: custos, capital, valuation e retorno do aporte

Data-base: 28/09/2026. Valores em reais nominais, salvo indicação em USD. Este é um orçamento por cenários, sem clientes pagantes e sem histórico representativo de consumo. Não é uma avaliação independente da empresa nem promessa de retorno.

## Resultado principal

No cenário central, o orçamento inicial é de R$4.657,50 mensais de custos fixos, mais aquisição de clientes e custos variáveis. A operação alcança resultado mensal positivo no mês 6. Um aporte isolado de R$10 mil não cobre o vale de caixa: a necessidade mínima calculada é de R$16.535, antes de uma reserva de segurança.

Uma referência exploratória de negociação é R$250 mil antes do aporte. R$10 mil comprariam 3,846% de uma empresa avaliada em R$260 mil após o aporte. Mantida essa participação, o recebimento acumulado de R$10 mil em distribuições ocorre no mês 36 no cenário central, mês 23 no mais favorável e não ocorre em 60 meses no menos favorável. Os prazos dependem de financiar o déficit inicial e de todas as premissas descritas abaixo.

## O que foi verificado

- O usuário informou dois sócios, nenhum cliente pagante e gasto de aproximadamente US$5/mês em TypeSafe. Apenas o sócio técnico recebe pró-labore no cenário menos favorável e no central. No mais favorável, há remuneração dos dois sócios operacionais. O investidor passivo não recebe pró-labore.
- `docs/processadores-cloudflare.md` e `apps/web/wrangler.jsonc` registram Workers, Containers, Durable Objects, R2, Vectorize, filas e Hyperdrive. São até dois Containers basic, com suspensão após ociosidade. O banco transacional documentado é PlanetScale PostgreSQL PS-5, São Paulo, com 10 GB e sem réplicas. Hyperdrive não substitui a cobrança do banco.
- `apps/web/README.md` registra provedores generativos configuráveis, Exa, TypeSafe, Sentry e WhatsApp/Zernio opcional. A configuração efetiva dos modelos está no banco; não foi presumida a partir de um benchmark ou de um nome no código.
- A API Cloudflare reconheceu a conta vinculada ao projeto. Os três endpoints de cobrança, consumo e assinaturas recusaram leitura com erro de autenticação 10000. O navegador apresentou timeout em duas tentativas de acessar a aba já aberta. Nenhuma fatura foi lida. Logo, não há despesa Cloudflare realizada comprovada neste relatório.
- Não foram lidos arquivos de segredos, dados de clientes, faturamento de outros produtos nem alteradas configurações na nuvem.

Os PDFs fornecidos sustentam o perfil de cliente e os preços de teste. As metas de aquisição e cancelamento do primeiro ano vêm da pesquisa Zima Jud. Custos, remuneração, financiamento, distribuições e valuation foram modelados nesta análise. As metas não são contratos nem receita atual.

## Preços públicos de referência

Conversão de orçamento: US$1 = R$5,50, usada como taxa efetiva com folga cambial. Não representa cotação verificada do dia nem alíquota de tributos de importação. Faturas e taxas efetivas podem exigir ajuste.

| Serviço | Referência consultada | Tratamento no modelo |
| --- | --- | --- |
| Workers Paid | US$5/mês, 10 milhões de requisições e 30 milhões de ms de CPU incluídos; excedentes cobrados | Incluído no orçamento Cloudflare, uma vez por conta |
| Containers basic | 0,25 vCPU, 1 GiB RAM, 4 GB disco; memória US$0,0000025/GiB-s, CPU US$0,000020/vCPU-s e disco US$0,00000007/GB-s, após franquias | OCR e processamento entram em Cloudflare; não cobrar OCR local outra vez por página |
| R2 Standard | US$0,015/GB-mês, além de operações; há franquia | Base em Cloudflare e crescimento na provisão variável de infraestrutura |
| Vectorize | US$0,01 por milhão de dimensões consultadas e US$0,05 por 100 milhões armazenadas, após franquias | Incluído na provisão Cloudflare; embeddings são custo separado |
| PlanetScale | PS-5 anunciado a partir de US$5/mês, single node | Reservas acima do preço de entrada; preço regional e fatura não confirmados |
| TypeSafe | US$5/mês informado pelo usuário | R$27,50 na base, além de provisão de crescimento nas chamadas auxiliares |
| Mercury 2.5 | Página mostra preço de referência US$0,20 entrada / US$0,75 saída por milhão; promoção de 80% mostra US$0,04 / US$0,15 | Usado o preço de referência, sem depender da promoção |
| Claude Sonnet 4.6 | US$3 entrada / US$15 saída por milhão, tarifa padrão | Referência de faixa mais cara; não implica modelo ativo na plataforma |
| Exa | US$7/1.000 buscas padrão e US$1/1.000 páginas por tipo de conteúdo; busca profunda custa mais | Consumo auxiliar por usuário; não incluído no preço dos tokens |

Fontes primárias: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Containers](https://developers.cloudflare.com/containers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/), [PlanetScale](https://planetscale.com/blog/5-dollar-planetscale), [Mercury](https://www.inceptionlabs.ai/models), [Sonnet](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), [Exa](https://exa.ai/pricing).

Como referência de ordem de grandeza, dois Containers basic executando um total combinado de 100 horas/mês, com 0,10 vCPU média utilizada, custariam aproximadamente US$1 em memória, CPU e disco após as franquias. Se ambos operassem 24 horas por dia durante 30 dias, utilizando 0,25 vCPU cada, seriam aproximadamente US$39,61 nesses três medidores. Workers, Durable Objects, rede e logs são adicionais. Tempo ativo real e CPU não foram medidos; o orçamento de Cloudflare não é uma multiplicação cega desse exemplo.

## Custos fixos iniciais por mês

| Item | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Pró-labore bruto | 3.000,00 | 3.000,00 | 6.000,00 |
| Provisão adicional sobre pró-labore, 20% | 600,00 | 600,00 | 1.200,00 |
| Cloudflare, base e folga operacional | 300,00 | 150,00 | 250,00 |
| PostgreSQL externo | 120,00 | 80,00 | 180,00 |
| TypeSafe, consumo atual informado | 27,50 | 27,50 | 27,50 |
| Ferramentas de desenvolvimento, IA de programação e monitoramento | 350,00 | 250,00 | 400,00 |
| Contabilidade | 500,00 | 400,00 | 600,00 |
| Domínio, e-mail corporativo e despesas administrativas | 150,00 | 150,00 | 200,00 |
| **Total fixo inicial** | **5.047,50** | **4.657,50** | **8.857,50** |

O pró-labore é uma hipótese de retirada de caixa, não salário de mercado de um tech lead. Os 20% são uma reserva orçamentária, não determinação de incidência legal. Retenções do sócio já contidas no bruto não devem ser somadas novamente. O contador deve substituir a provisão pelos encargos efetivos e conciliar a parcela eventualmente recolhida dentro do regime tributário.

O orçamento Cloudflare é uma franquia interna de planejamento, não contratação de plano de US$150. A base central de R$150 equivale a cerca de US$27,27, incluindo Workers, consumo inicial dos demais serviços e folga. PlanetScale é separado. Não é possível afirmar que 90% da despesa total seja Cloudflare a partir da quantidade de componentes nela hospedados.

## Custo de inferência por usuário ativo

Um usuário ativo é uma pessoa que efetivamente utiliza a IA no mês; uma conta pagante é um escritório. Os preços propostos de R$199 e R$349 são por conta, não por cada pessoa.

| Premissa mensal por usuário ativo | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Tokens de entrada | 8 milhões | 5 milhões | 3 milhões |
| Tokens de saída, incluindo raciocínio cobrável | 500 mil | 300 mil | 200 mil |
| Fração de tokens no modelo mais caro | 30% | 20% | 10% |
| Preço médio de entrada, USD/milhão | 1,04 | 0,76 | 0,48 |
| Preço médio de saída, USD/milhão | 5,025 | 3,60 | 2,175 |
| **Inferência, com 20% de folga para repetições** | **R$71,49** | **R$32,21** | **R$12,38** |
| Pesquisa, embeddings e crescimento de avaliações auxiliares | R$10,00 | R$6,00 | R$4,00 |
| **IA e pesquisa por usuário ativo** | **R$81,49** | **R$38,21** | **R$16,38** |
| Usuários ativos médios por escritório | 1,0 | 1,4 | 1,8 |
| **IA e pesquisa por escritório** | **R$81,49** | **R$53,49** | **R$29,48** |

Fórmula central de inferência: `(5 × US$0,76 + 0,3 × US$3,60) × R$5,50 × 1,20 = R$32,208`.

A fração de modelo caro é aplicada igualmente a entrada e saída, por simplicidade. A política de seleção é uma hipótese comercial: não foi verificado que a plataforma já encaminha automaticamente chamadas nessa proporção. Não há desconto de cache, batch ou créditos gratuitos no cálculo. Entradas incluem documentos, instruções, histórico reenviado e ferramentas. O volume é uma média de planejamento, não uma franquia implementada.

Na reserva auxiliar central, 100 buscas padrão Exa e 200 páginas extras por pessoa custam US$0,90, ou R$4,95; restam R$1,05 para embeddings e crescimento de avaliações. É uma hipótese de uso, não garantia de suficiência. Busca profunda, muitas páginas, áudio, imagens ou verificação extensa exigem nova franquia.

Para o mesmo volume central, usar apenas o preço de referência Mercury custaria aproximadamente R$8,09 por pessoa, com a folga de 20%. Usar apenas a faixa Sonnet custaria R$128,70. Portanto, medir e controlar a escolha do modelo importa mais que pequenas economias de armazenamento.

## Despesas variáveis e capacidade operacional

- Reserva de 12% da receita: 10% para tributos da empresa e 2% para cobrança/perdas. São parâmetros de orçamento, não alíquotas legais nem tarifa contratada. A [AbacatePay publica Pix de R$0,80 por cobrança confirmada](https://www.abacatepay.com/blog/como-vender-servicos-e-produtos-online-no-brasil); mistura com cartão, inadimplência e regime tributário não foram informados.
- R$3 por conta ativa/mês de infraestrutura incremental, além da base fixa, para crescimento de arquivos, processamento, filas e logs. Não é cobrança publicada de um fornecedor.
- Aquisição desembolsada por novo cliente: R$400 / R$250 / R$180. Inclui divulgação, viagens e ferramentas comerciais incrementais. Não é CAC completo de mercado. O tempo comercial dos sócios não remunerados é contribuição de trabalho e não desembolso; não foi contado uma segunda vez onde há pró-labore.
- A cada bloco de até 100 contas acima das primeiras 100, acrescentam-se R$2.500 mensais de apoio operacional/suporte e R$150 de infraestrutura. Exemplo: 101 a 200 contas adicionam um bloco; 201 a 300 adicionam dois. São provisões para capacidade, sem produtividade comprovada.
- Custos fixos e os blocos de capacidade sobem 5% ao ano. Tickets e custos variáveis unitários ficam constantes em reais, uma simplificação. O custo de aquisição também fica constante; piora de canal deve ser testada depois.
- Gasto inicial único de R$2.000 para formalização, contratos e preparação comercial. É orçamento, não cotação. Desenvolvimento já realizado é custo passado e não sai novamente do aporte.
- Não há sede, funcionário CLT, segundo desenvolvedor, serviço jurídico recorrente, nem WhatsApp pago incluído. Zernio/Meta é piloto opcional e deve ser cobrado ou orçado à parte antes de virar oferta geral. A operação pressupõe que o fundador técnico mantenha desenvolvimento e suporte inicial com o pró-labore proposto.

## Cenários comerciais

| Premissa | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Mensalidade média por escritório | R$199 | R$249 | R$299 |
| Novas contas por mês no ano 1 | 3 | 8 | 15 |
| Novas contas por mês no ano 2 | 3 | 15 | 25 |
| Novas contas por mês nos anos 3 a 5 | 3 | 30 | 40 |
| Cancelamento mensal de contas | 5% | 3% | 2% |
| Contribuição por conta após variáveis | R$90,63 | R$162,63 | R$230,65 |
| Margem de contribuição | 45,5% | 65,3% | 77,1% |
| Equilíbrio com custos e aquisição do ano 1 | 69 contas | 41 contas | 51 contas |

O ticket médio de R$249 pode surgir de uma mistura de Solo R$199 e Equipe R$349. As médias de usuários ativos são hipóteses independentes de ocupação dos planos, não o número de assentos vendidos. O cenário favorável combina eficiência de consumo com mais equipes e melhor aquisição; não é mero aumento de volume.

As primeiras vendas entram no mês 1. Fórmula: `contas_mês = contas_anteriores × (1 − cancelamento) + novas_contas`. Novas contas pagam um mês integral. Contas fracionárias são valores esperados. Não há receita de migração, expansão de plano ou prestação de serviços. As projeções seguem por 60 meses para testar retorno, mesmo quando a situação exigiria interromper a operação e revisar a oferta.

## Resultado e necessidade de capital

| Resultado | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Contas ativas no mês 12 | 27,6 | 81,6 | 161,5 |
| Receita mensal no mês 12 | R$5.488 | R$20.329 | R$48.277 |
| Despesas totais no mês 12 | R$9.236 | R$13.709 | R$25.244 |
| Resultado operacional no mês 12 | −R$3.748 | R$6.620 | R$23.033 |
| Receita recebida no primeiro ano | R$39.006 | R$139.500 | R$325.414 |
| Resultado do ano, antes do gasto inicial | −R$57.206 | R$11.221 | R$99.080 |
| Primeiro mês com resultado positivo | Não ocorre em 60 meses | 6 | 4 |
| Recuperação dos prejuízos iniciais e gasto inicial | Não ocorre em 60 meses | 11 | 7 |
| Resultado acumulado de R$10 mil, após gasto inicial e antes de distribuições | Não ocorre em 60 meses | 13 | 7 |
| Capital mínimo para atravessar o primeiro ano, sem margem de segurança | R$59.206 | R$16.535 | R$16.190 |
| Complemento além do aporte de R$10 mil, no primeiro ano | R$49.206 | R$6.535 | R$6.190 |
| Primeiro mês com caixa insuficiente se houver apenas R$10 mil | 2 | 2 | 1 |

No cenário menos favorável a operação continua deficitária. Não faz sentido apresentar R$59 mil como recomendação de captação para sustentar um modelo que ainda precisa mudar. Com três aquisições/mês e cancelamento de 5%, a base converge a 60 contas, abaixo das 69 necessárias ao equilíbrio inicial.

Para uma reserva inicial equivalente a dois meses dos fixos iniciais, o orçamento central total seria aproximadamente R$25.850, arredondável para R$26 mil. No favorável, aproximadamente R$33.905, arredondável para R$34 mil. Essa reserva é liquidez e não despesa. A necessidade maior no favorável decorre de dois pró-labores desde o primeiro mês. Remunerar o sócio comercial só depois de haver caixa reduziria esse vale, mas não é a premissa da tabela.

Todos os resultados depois de o caixa acabar são condicionais: sem outra fonte de recursos ou redução de despesas, a empresa não consegue executar a trajetória. O cálculo não transforma saldo negativo em financiamento disponível.

## Valuation exploratório e equity

Não há receita atual para aplicar um múltiplo de ARR realizado. Utilizou-se uma sensibilidade de negociação: `valuation antes do aporte = receita mensal projetada no mês 12 × 12 × múltiplo × 50%`. Os múltiplos escolhidos são 1x, 2x e 3x; o fator 50% é um desconto discricionário pelo risco de execução. Nenhum deles foi estimado em transações comparáveis do Lume, nem representa probabilidade de sucesso medida. O valor considera caixa e dívida líquidos iniciais iguais a zero e não avalia preferências especiais de investidores.

| Cálculo | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Receita anualizada ao fim do ano 1, não receita recebida no ano | R$65.857 | R$243.946 | R$579.327 |
| Múltiplo antes do desconto | 1x | 2x | 3x |
| Desconto de execução | 50% | 50% | 50% |
| **Valuation indicativo antes do aporte** | **R$32.929** | **R$243.946** | **R$868.991** |
| Valuation após aporte de R$10 mil | R$42.929 | R$253.946 | R$878.991 |
| **Participação pelos R$10 mil** | **23,29%** | **3,94%** | **1,14%** |

No cenário deficitário, R$32.929 é apenas a saída aritmética da fórmula de receita e não tem sustentação em lucros. O valor realizável pode ser zero. A referência favorável tampouco é preço comprovado hoje. Sem financiamento suficiente, o valor calculado pelos cenários de continuidade perde fundamento. A literatura de [Damodaran sobre empresas jovens](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/littlebook/younggrowthvaluedrivers.htm) destaca execução e sobrevivência como determinantes; ela não fornece os múltiplos escolhidos aqui.

Para conversar sobre uma única oferta, R$250 mil pre-money é um arredondamento da referência central, ainda sujeito a negociação e à cobertura do déficit de caixa. Com R$10 mil entrando na empresa: `equity = 10.000 / (250.000 + 10.000) = 3,846%`. Se forem combinados exatamente 4%, o pre-money implícito é R$240 mil e o post-money R$250 mil. R$10 mil por 10% implicariam pre-money de R$90 mil. Essas contas supõem aporte primário na empresa, não compra de quotas pessoais dos fundadores.

## Quando o investidor recebe R$10 mil

Equity não cria um vencimento de devolução do principal. Aqui retorno significa atingir R$10 mil nominais de distribuições recebidas e continuar dono da participação. Não equivale a rentabilidade real após inflação, nem inclui venda futura das quotas, tributação pessoal ou valorização contábil.

Política hipotética: primeiro compensar perdas e gasto inicial; depois manter uma reserva interna de dois meses dos custos fixos vigentes; distribuir 50% do lucro acumulado que ultrapassar essa reserva. O saldo é reinvestido. Distribuições nunca repetem valores já pagos. O resultado projetado é uma aproximação de caixa operacional, não lucro contábil já apurado e autorizado para distribuição.

Para comparar execução, fixou-se o mesmo preço de entrada nos três cenários: R$250 mil pre-money e 3,846% para o investidor.

| Recebimento do investidor | Menos favorável | Central | Mais favorável |
| --- | ---: | ---: | ---: |
| Primeira distribuição | Não ocorre em 60 meses | Mês 13 | Mês 9 |
| Acumulado até mês 12 | R$0 | R$0 | R$1.424 |
| Acumulado até mês 24 | R$0 | R$2.898 | R$12.052 |
| Acumulado até mês 36 | R$0 | R$10.779 | R$35.394 |
| **Mês em que completa R$10 mil** | **Não ocorre em 60 meses** | **36** | **23** |

Se o preço de entrada fosse o valuation específico de cada coluna anterior, as participações seriam diferentes e o prazo seria: sem retorno em 60 meses / mês 35 / mês 36. O favorável gera mais lucro, mas compra uma fatia menor quando o valuation de entrada é maior. Não se deve misturar o retorno de 3,846% com o preço que concede apenas 1,14%.

O cálculo de retorno pressupõe que qualquer complemento de caixa seja coberto sem diluir essa participação e sem criar serviço de dívida ou preferência de reembolso. Essa é uma hipótese analítica, não um acordo existente. Se houver nova rodada, empréstimo, preferência ou recompra, é preciso recalcular. Com apenas os R$10 mil e nenhuma solução para o déficit, não há prazo de retorno financiável nos cenários modelados.

## Sensibilidades do cenário central

| Mudança isolada | Capital mínimo no vale de caixa | Primeiro mês positivo | Retorno do investidor |
| --- | ---: | ---: | ---: |
| Pró-labore técnico de R$2 mil | R$11.204 | 5 | 35 |
| Base, pró-labore de R$3 mil | R$16.535 | 6 | 36 |
| Pró-labore técnico de R$4 mil | R$23.149 | 7 | 37 |
| Manter oito novos clientes/mês em todos os anos | R$16.535 | 6 | 48 |
| Distribuir apenas 25%, mantidas as demais premissas | R$16.535 | 6 | 45 |

Reduzir a despesa de nuvem em R$100/mês ajuda, mas não resolve sozinho o déficit central. Pró-labore, crescimento pago e consumo de modelos caros são as variáveis prioritárias. A remuneração do sócio comercial no futuro também precisa ser pactuada: mantê-lo sem pró-labore durante cinco anos é uma hipótese da projeção central, não compromisso do sócio.

## Arquivos e verificação

- [calcular.py](calcular.py): parâmetros e fórmulas executáveis, sem dependências externas.
- [projecoes.json](projecoes.json): 60 meses por cenário, valores sem arredondamento, custos, caixa, distribuições e sensibilidades.

Executar `python output/financeiro-lume-2026-09-28/calcular.py` na raiz. O script valida a recorrência de clientes contra a fórmula fechada do ano 1, reconcilia receita menos despesas e caixa e verifica os dois meses que delimitam o retorno. Os valores exibidos neste relatório são arredondados; os cálculos usam precisão integral.

Não foram executados testes da aplicação, pois não houve alteração de código do produto. Para transformar a estimativa em orçamento, ainda faltam faturas Cloudflare/PlanetScale, modelos efetivamente selecionados, consumo medido por usuário, despesas administrativas contratadas, enquadramento tributário, acordo entre sócios e plano de cobertura do déficit inicial.
