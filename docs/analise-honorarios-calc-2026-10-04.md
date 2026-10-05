# Honorários e Calc para PE e RS

Análise e implementação em 04/10/2026. Público prioritário informado: Pernambuco e Rio Grande do Sul. O escopo generalista foi ampliado, a pedido do usuário, para incluir tributário e consumidor nesta entrega. O documento preserva o diagnóstico inicial e registra abaixo o plano revisado, a implementação e seus limites.

## Diagnóstico inicial, anterior à implementação

O módulo já tem uma base financeira que deve ser preservada. A lacuna principal está na formação do preço e na representação das diferentes modalidades de honorários.

| Área | Evidência no repositório | Avaliação |
| --- | --- | --- |
| Cadastro | [create-dialog.tsx](../apps/web/src/components/honorarios/create-dialog.tsx), [contracts.ts](../apps/web/src/lib/honorarios/contracts.ts) | Cliente, caso opcional, descrição, observações e até 120 parcelas. O advogado informa um total já decidido. |
| Parcelamento | [editor.ts](../apps/web/src/components/honorarios/editor.ts) | Valores em centavos, resto na última parcela, tratamento de fim de mês e ano bissexto. |
| Recebimentos | [service.ts](../apps/web/src/lib/honorarios/service.ts) | Baixas parciais, estorno com motivo, saldos derivados e cancelamento apenas sem recebimentos válidos. |
| Concorrência | Mesmo serviço e [migração 0037](../apps/web/db/postgres/0037_honorarios.sql) | Transações, bloqueio do honorário e idempotência protegem contra duplicidade e recebimento acima do saldo. |
| Permissões | Mesmo serviço | Escrita pelo titular autorizado; participantes do caso podem consultar, inclusive de outro escritório. Não existe acesso irrestrito do administrador a todos os honorários. |
| Cobrança | [charges.ts](../apps/web/src/lib/honorarios/charges.ts), [charge-form.tsx](../apps/web/src/components/honorarios/charge-form.tsx) | Chave PIX, instruções, boleto previamente emitido, PDF, histórico de envio manual e publicação explícita no portal. Não é emissão bancária nem conciliação automática. |
| Lembretes | [reminders.ts](../apps/web/src/lib/honorarios/reminders.ts) | Notificações ao responsável antes do vencimento, no vencimento e semanalmente no atraso. Não equivalem a cobrança automática enviada ao cliente. |
| Assistente | [capabilities/honorarios.ts](../apps/web/src/lib/capabilities/honorarios.ts) | Dez operações publicadas, incluindo três de cobrança. Estorno e cancelamento pelo agente exigem confirmação dos argumentos. |
| Cobertura existente | [honorarios.test.ts](../apps/web/tests/honorarios.test.ts), [honorarios-editor.test.ts](../apps/web/tests/honorarios-editor.test.ts), [honorario-charges.test.ts](../apps/web/tests/honorario-charges.test.ts) | Há cenários de isolamento, concorrência, idempotência, datas, valores, cobrança e lembretes. Os testes foram inspecionados, não executados nesta análise. |

O modelo não guarda UF, edição da tabela, código do serviço, base de cálculo, percentual, evento de êxito, fase contratada ou regra de sucumbência. Não há mecanismo próprio de proposta, aditivo, repactuação de saldo, rateio ou prestação de contas ao cliente. Escrever essas informações em observações não permite calcular nem acompanhar obrigações.

Os totais atuais usam filtros de vencimento, não um fluxo de caixa por data de recebimento. Valores de casos compartilhados podem entrar na visão pessoal. Antes de acrescentar relatórios financeiros ou rateios, definir explicitamente se cada visão representa valores próprios, compartilhados, do escritório ou de terceiros.

A documentação inicial descrevia apenas as operações financeiras originais. [honorarios.md](honorarios.md) foi atualizada nesta entrega para incluir propostas, Calc, cobrança e lembretes. A distinção entre preparar cobrança e emitir boleto bancário continua válida.

## Regras brasileiras que afetam o produto

Honorários contratuais, arbitrados e sucumbenciais têm origens diferentes. O cadastro deve distinguir a origem da obrigação e quem deve pagá-la. Sucumbência não deve virar automaticamente uma parcela cobrada do cliente. Fonte: [Estatuto da Advocacia, arts. 22 e 23](https://www.planalto.gov.br/ccivil_03/leis/l8906.htm).

O Código de Ética determina a observância dos mínimos da seccional onde o serviço é realizado. Também exige clareza sobre escopo e pagamento, considera fatores como complexidade e tempo e disciplina a cláusula quota litis. Portanto, a UF do escritório pode preencher uma sugestão inicial, mas a UF aplicável ao serviço precisa ser explícita. O sistema não deve impor um percentual nacional de 20% ou 30%. Fonte: [Código de Ética, arts. 48 a 50](https://www.oab.org.br/leisnormas/legislacao/resolucoes/02-2015).

Para sucumbência cível, o CPC traz uma regra geral de 10% a 20% e regimes específicos, inclusive Fazenda Pública. Não basta uma única operação percentual aplicável a qualquer processo. Fonte: [CPC, art. 85](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm). Na esfera trabalhista, a faixa legal é diferente, de 5% a 15%, conforme [CLT, art. 791-A](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm).

### Primeiras tabelas

| Referência publicada em 2026 | PE | RS |
| --- | --- | --- |
| Consulta geral | R$ 500,00, item 1.1 | R$ 600,00, item 1.1 |
| Hora intelectual geral | R$ 500,00, item 1.2 | R$ 1.200,00, item 1.3 |

Fontes: [tabela OAB-PE 2026](https://www.oabpe.org.br/files/institutional/17677231591848-tabeladehonorariosadvocatcios2026.pdf), página 1, e [tabela OAB-RS 2026](https://admsite.oabrs.org.br/arquivos/honorarios-versao-2026.pdf), página 1. Os valores são exemplos de itens gerais, não substituem itens específicos por matéria.

As tabelas contêm percentuais, bases diferentes e observações por serviço. Por exemplo, há acréscimos específicos em família no RS. Cada item deve registrar se a regra é valor fixo, percentual, piso, soma ou outra composição expressamente prevista. A presença de duas colunas não autoriza inferir automaticamente soma nem o maior dos valores.

A OAB-PE também anunciou uma calculadora oficial em agosto de 2026, útil como referência para futura conferência. Sua interface não foi validada nesta análise porque a abertura pela ferramenta de pesquisa falhou. Fonte: [anúncio oficial](https://www.oabpe.org.br/noticias/oab-pernambuco-lanca-calculadora-de-honorarios-durante-o-mes-da-advocacia).

Antes de publicar o catálogo, conferir a vigência exata de cada edição e os atos que a acompanham. O [portal OAB-RS](https://site.oabrs.org.br/honorarios/) aponta a Resolução 02/2026; o seu texto completo não foi validado nesta pesquisa. Não presumir vigência desde janeiro só porque a edição é de 2026. Não misturar tabelas contratuais com tabelas de dativos ou convênios.

## Evolução proposta para Honorários

1. **Formação do valor.** Selecionar UF do serviço, data de referência, área e serviço. Mostrar o item oficial, sua fonte e a composição aplicável. Preservar valor proposto e valor contratado separadamente. Valores abaixo da referência precisam aparecer de forma explícita; registrar motivo não equivale a declarar conformidade ética.
2. **Modalidades de contratação.** Valor fixo, por hora, por fase ou ato, mensalidade, êxito e composição entre modalidades. Cada componente tem base, valor ou percentual e condição de exigibilidade próprios.
3. **Proposta e contrato.** Gerar proposta revisável, identificar atos e instâncias incluídos, despesas e efeito de acordo, e vincular o documento aprovado no Cofre. A edição da tabela consultada fica congelada no histórico.
4. **Êxito e sucumbência.** Separar estimativa de obrigação exigível. A confirmação de um evento de êxito deve registrar benefício apurado e evidência. A sucumbência registra devedor, decisão, base e valor fixado próprios.
5. **Gestão depois da contratação.** Aditivos e renegociação preservam parcelas liquidadas e substituem apenas o saldo explicitamente negociado, com histórico. Acrescentar despesas reembolsáveis, rateio entre profissionais e prestação de contas sem misturar dinheiro do cliente com receita do advogado.

O fluxo desejado é selecionar serviço, conferir referência, definir contratação, revisar proposta e programar recebimentos. Um cálculo salvo no Calc poderá alimentar a base do êxito, mas converter essa base em obrigação financeira deve ser uma ação explícita.

## Escopo revisado e implementado do Calc

Revisão aprovada pelo usuário: manter os cinco cálculos iniciais e incluir **consumidor e tributário nesta entrega**, totalizando sete ferramentas. PE e RS permanecem as UFs iniciais das referências de honorários. Os limites abaixo descrevem a implementação, sem presumir cobertura integral de cada área do Direito.

O [levantamento da Jusfy](pesquisa-calc-jusfy-2026-10-04.md) examina os 13 itens da imagem e suas fontes públicas. Não foi encontrado ranking público de uso por ferramenta. A lista abaixo é uma recomendação de produto para o público informado, não a afirmação de quais são os cinco mais usados na Jusfy.

| Prioridade | Cálculo | Primeira entrega útil proposta |
| --- | --- | --- |
| 1 | Correção de valores | Principal ou série de parcelas, marcos temporais, índice, juros, multa e abatimentos; memória discriminada por período. |
| 2 | Trabalhista | Rescisão assistida de mensalista: remuneração, dias, avos conferidos, férias simples, 13º, aviso indenizado e multa sobre base rescisória do FGTS. Dispensa, pedido de demissão e acordo. Não apura automaticamente tributos, histórico salarial, horas extras ou férias em dobro. |
| 3 | Revisional bancário | Comparar taxas e cronogramas mensais Price/SAC, com prestações, saldos e diferenças. Não inclui tarifas, seguros, carência ou atraso. A diferença matemática não é conclusão automática de abusividade. |
| 4 | Pensão alimentícia | Apurar obrigações segundo acordo ou decisão informados, pagamentos, reajustes e atrasados. Não presumir que toda pensão equivale a 30% da renda. |
| 5 | Aluguel | Reajuste anual percentual fixo e débitos vencidos, com correção, encargos e pagamentos. Para reajuste por índice variável, informar parcelas previamente reajustadas. Distinguir reajuste periódico de mora. |
| 6 | Consumidor | Restituição simples ou em dobro do excesso efetivamente pago, com fundamento escolhido pelo advogado, juros, correção e abatimento das restituições recebidas nas respectivas datas. Não presume dano moral, engano injustificável ou dobra automática por data. |
| 7 | Tributário | Atualização de débito federal desde 1997: multa diária de 0,33%, limitada a 20%, SELIC intermediária somada e 1% no mês final; pagamento indevido federal comum desde 1998, sem multa. Não apura tributos, elegibilidade de compensação, DARF, tributos estaduais/municipais ou regimes especiais. |

Os [fundamentos tributários e de consumidor](pesquisa-tributario-consumidor-2026-10-04.md) documentam legislação, precedentes e exemplos de conferência. O início útil da mora tributária é informado pelo advogado: o sistema não presume calendários fiscais ou feriados. SELIC não é capitalizada nem cumulada com outro índice nesse regime. No mesmo mês de origem não há juros tributários.

### Entrega de Honorários

O financeiro existente continua recebendo e estornando parcelas. A nova tela `/app/honorarios/propostas` acrescenta composição fixa, por hora, percentual, mensal e por fase/ato; separa contratação de êxito estimado; guarda versões da proposta e da referência consultada. O [catálogo inicial conferido](catalogo-oab-pe-rs-2026.md) contém 30 itens, 15 de cada UF, e links para as tabelas integrais. A edição 2026 não equivale a vigência retroativa desde janeiro; a tela exige conferência do enquadramento.

PDF de proposta, planejamento de rateio e importação de uma versão salva no Calc estão disponíveis. Gerar recebimentos é uma ação explícita, com evidência da contratação ou êxito. Êxito percentual exige a base efetivamente obtida. Repetir a mesma tentativa não duplica parcelas; o componente já faturado não pode ser faturado outra vez. A edição é bloqueada após gerar parcelas, preservando o documento original. Aditivos podem ser cadastrados como novas propostas, sem renegociação automática do saldo.

O fluxo ainda não automatiza assinatura, despesas reembolsáveis, repasse de valores, sucumbência fixada judicialmente ou renegociação. Esses itens da visão de evolução permanecem etapas posteriores.

### Persistência e memória

`/app/calc` oferece cadastro privado por usuário/escritório, vínculo opcional com cliente/caso próprio, revisões imutáveis, duplicação de cenário, consulta de versão anterior e exportação PDF/CSV/JSON. O servidor recalcula e preserva entradas, fontes, índices, data de consulta e versão do motor. O resultado salvo não muda com futuras consultas de índices.

IPCA, INPC, SELIC e Taxa Legal usam séries oficiais do BCB; ausência de competência ou indisponibilidade impede o cálculo que depende dela, sem estimativas silenciosas. Nesta máquina, a consulta à API BCB retornou erro de DNS; a homologação de conectividade em produção permanece necessária. Correção usa meses completos após a origem até o mês anterior à data-base. Juros simples podem ter marco inicial próprio; períodos anteriores a 30/08/2024 não usam a Taxa Legal neste motor.

Aluguel e pensão reaproveitam parte do motor de atualização, mas precisam de entradas e regras próprias. Trabalhista exige validação independente por verba. Não apresentar uma primeira entrega rescisória como liquidação trabalhista completa ou exportação compatível com PJe-Calc sem implementar e verificar essas capacidades.

O item INSS da Jusfy trata de descontos indevidos em benefícios. Não corresponde a planejamento previdenciário, RMI ou concessão de aposentadoria. O FGTS anunciado trata de revisão da atualização histórica. Não corresponde apenas ao cálculo rescisório. Essas diferenças afetam a escolha dos cinco, conforme as fontes detalhadas no levantamento.

## O que torna um cálculo utilizável pelo advogado

- Registrar entradas, anexos de origem, versão do motor, regra selecionada, versão dos índices e data-base.
- Mostrar principal, correção, juros, multa, abatimentos e total separadamente, quando aplicáveis.
- Oferecer memória por competência ou evento, fórmulas e arredondamentos identificáveis, PDF e planilha para conferência.
- Permitir duplicar e comparar cenários. Recalcular cria uma nova versão, preservando o resultado utilizado anteriormente.
- Guardar as séries oficiais localmente com origem e data de obtenção. Ausência de índice deve impedir conclusão com aquele período ou ser indicada como hipótese manual, nunca ser substituída silenciosamente por zero.
- Permitir regras por período e por título judicial ou contrato. PE e RS não determinam sozinhos qual índice se aplica a um caso.
- Usar aritmética decimal de precisão definida para fatores e taxas; conservar centavos nas obrigações financeiras e arredondar nos pontos definidos pela metodologia.
- Usar o Lume para coletar informações e explicar resultados. A operação matemática deve ser determinística e reproduzível.

A Taxa Legal é um exemplo de por que não usar uma taxa fixa genérica: a metodologia do CMN especifica publicação mensal, juros simples e proporcionalidade diária. Fonte: [Resolução CMN 5.171/2024](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=5171&tipo=resolu%C3%A7%C3%A3o+cmn). Não aplicar a mesma regra automaticamente a todos os regimes judiciais nem acumular correção e juros já abrangidos por uma taxa única.

## Organização no repositório e evolução posterior

`src/lib/honorarios` continua responsável pelas obrigações e recebimentos e agora inclui propostas e precificação. As migrações 0071 e 0072 são aditivas. Registros existentes mantêm seus valores e parcelas; a formação de preço permanece nula quando não foi registrada, sem atribuir origem OAB ou percentual retroativo.

`src/lib/calc` reúne os motores determinísticos, séries, versões e relatórios. A rota `/app/calc` está na navegação definida em [navigation.ts](../apps/web/src/lib/navigation.ts), inclusive no menu mobile. Componentes seguem [DESIGN.md](../apps/web/DESIGN.md), com resumo, memória detalhada e estados de dados ausentes ou inválidos. PDF usa fontes padrão e paginação local; CSV mantém as colunas numéricas para conferência.

Entidades propostas: edição de tabela OAB, item e regra de precificação; proposta de honorários e seus componentes; contrato e aditivos; cálculo, versões, entradas, memória e fontes; séries econômicas e observações versionadas. Isso não exige um motor universal de regras: cada família de cálculo deve ter contrato de entrada e implementação próprios, compartilhando apenas operações matemáticas e séries realmente comuns.

O servidor deve continuar derivando identidade e escritório da sessão e checando permissões em cada operação. A visibilidade do cálculo, da proposta financeira e do documento publicado ao cliente precisa ser independente. Participar de um caso não deve passar a revelar propostas, rateios ou dados bancários por acidente.

Sequência de engenharia do plano revisado:

1. Catálogo OAB PE/RS, memória da formação do valor e contratação fixa/percentual/êxito.
2. Infraestrutura de cálculos e Correção de valores, com persistência, comparação e exportação.
3. Consumidor, Pensão e Aluguel, aproveitando a atualização já verificada e respeitando as entradas próprias de cada modalidade.
4. Tributário federal, Trabalhista e Revisional, com casos de referência específicos e limites de cobertura publicados.
5. Em etapa posterior: aditivos com renegociação, repasses e prestação de contas, conectados às obrigações existentes. A entrega atual já permite planejar percentuais de rateio na proposta.

Essa ordem de engenharia difere da prioridade comercial porque permite validar primeiro a matemática compartilhada.

## Critérios de aceite e validação

Para catálogo OAB: dupla conferência dos itens e observações com os PDFs e atos oficiais, casos de valor fixo e composições, seleção histórica da edição e prevenção de troca retroativa da referência.

Para Calc: comparar resultados com fontes e ferramentas oficiais aplicáveis; datas limite, anos bissextos, pagamentos parciais, índice ausente, mudança de regra, precisão e reprodução de versão antiga. Planilhas esperadas devem ser calculadas independentemente da implementação. Exemplos oficiais não substituem validação dos regimes não cobertos por eles.

Para persistência: PostgreSQL real, isolamento entre escritórios, revogação de acesso, concorrência, idempotência e conversão única de um cálculo em obrigação. Para interface: fluxo completo em desktop e celular, teclado, formulários longos, erros, carregamento e exportação.

A implementação exige `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e afetados, `pnpm db:setup` e `pnpm build`. Casos automatizados foram adicionados em `apps/web/tests/calc-engine.test.ts`, `apps/web/tests/calc-service.test.ts` e `apps/web/e2e/calc.e2e.ts`. O funcionamento autenticado dos cálculos da Jusfy não foi testado; o levantamento compara seu catálogo público.

### Verificação da entrega

- `pnpm db:setup`: migrações 0071 e 0072 aplicadas no PostgreSQL local.
- `pnpm typecheck`: aprovado após os ajustes do relatório PDF.
- `pnpm lint`: aprovado, com um aviso preexistente em `src/lib/judicial/connectors/transport.ts`. A checagem final dos arquivos TypeScript alterados e adicionados também passou, sem diagnósticos.
- Fórmulas e serviços Calc/propostas: 12 testes aprovados, incluindo versões, índices ausentes, idempotência, base efetiva de êxito e privacidade diante de participantes do caso.
- Seleção de módulos e operações do agente: 7 testes aprovados.
- Regressões de capabilities, Honorários, cobrança, exclusão e exportação: 43 casos aprovados considerando as repetições isoladas. A primeira execução encontrou exemplos ausentes para as novas ferramentas e um timeout de conexão do PostgreSQL; os exemplos foram corrigidos e os três casos afetados passaram na repetição.
- `e2e/calc.e2e.ts` e `e2e/honorarios.e2e.ts`: aprovados em navegador, com teclado, desktop, celular, carregamento e erro. O fluxo novo confere PDF/CSV/JSON, versões, OAB PE/RS e geração das parcelas. A memória PDF foi renderizada e inspecionada visualmente.
- `pnpm build`: aprovado, incluindo TypeScript e geração de 134 páginas. Foram emitidos três avisos de rastreamento amplo de arquivos em módulos de armazenamento existentes, além do aviso experimental de `localStorage` do Node; nenhum desses arquivos foi alterado nesta entrega.

A execução integral de `pnpm test` foi interrompida por contenção de recursos com outra suíte no mesmo computador. A aprovação acima se refere às suítes afetadas, não a todo o repositório. A API BCB retornou `ENOTFOUND` na tentativa real; os testes de transporte verificam respostas controladas, cache e falhas, e não substituem a homologação de conectividade.
