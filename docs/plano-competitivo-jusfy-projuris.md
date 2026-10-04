# O que falta ao Lume diante de Jusfy e Projuris

03/10/2026. Proposta de Codex (gpt-6.1-sol, esforço high), revisada por Claude (Opus 5.5). A base é a [auditoria de lançamento](auditoria-lancamento-mvp-2026-10-03.md) e o código atual. As ofertas dos concorrentes vêm das páginas oficiais ([Jusfy](https://www.jusfy.com.br/), [Projuris ADV](https://www.projuris.com.br/adv/)); a qualidade de uso delas não foi testada. Esforço: **P** = até 1 pessoa-semana; **M** = 2 a 4; **G** = 5 a 10 ou mais, sem contar espera por credenciamento ou contratos.

## Tese

O Lume já é forte em documento → minuta → entrega ao cliente. A lacuna que faz o advogado de contencioso manter outro sistema é a continuidade do caso: publicações confiáveis, prazos revisados e o próximo passo visível. O ciclo a fechar é **publicação → revisão → tarefa/prazo → documento → cliente**. Calculadoras, acervo de jurisprudência e financeiro vêm depois dessa base.

Restrições do responsável que valem para tudo: um advogado por escritório, com associados por caso; posicionamento "assistente para os documentos e a rotina dos seus casos"; público inicial de autônomos e pequenos escritórios.

## Lacunas, em ordem de prioridade

| # | Lacuna | O que já existe | Mínimo viável | Esforço | Aceite |
|---|---|---|---|---|---|
| 1 | **Publicações (DJEN)** | Conector `judicial/connectors/djen.ts`, nunca confrontado com produção; contratos com datas de disponibilização e publicação; caixa judicial (`components/judicial-inbox.tsx`) | Homologar contrato, paginação, certidões e republicações. Capturar **pelo número da OAB/UF do advogado** e também pelos processos vinculados. Preservar original, hash e datas. Estados "Recebida / Revisada / Gerou tarefa / Descartada" mostrando cobertura e última coleta. O agente resume e propõe a tarefa; o advogado confirma | M | 10 dias sem omissão nem duplicação inexplicada na amostra conciliada; atraso p95 < 2 h |
| 2 | **Prazos processuais** | Agenda, propostas revisáveis e lembretes (`capabilities/agenda.ts`, `notifications/worker.ts`) | Motor determinístico para prazos cíveis em dias: CPC 219 (dias úteis), 220 (20/12 a 20/01), 224 (início e prorrogação), 231. Calendário versionado por tribunal e comarca, com memória de cálculo dia a dia. Bloqueia sem calendário. O advogado confirma antes de entrar na Agenda | G | Concordância total com um conjunto de casos revisado por advogado; todo prazo ligado à versão da regra usada |
| 3 | **Andamentos** | Tabelas de vínculo, snapshot e movimento; o coletor só tem `listChanges` | Um tribunal piloto, escolhido pela carteira dos primeiros usuários, via MNI/API oficial ou fornecedor com direitos comprovados. Cronologia com lacunas explícitas | G | ≥ 30 processos com cobertura e ausências contadas |
| 4 | **Modelos curados** | Minutas com fontes, exportação no modelo Word, anexos para o PJe, revisão humana por versão | 10 a 20 modelos do segmento piloto, com autoria, variáveis e data de revisão. O agente preenche, gera o pacote de anexos e o checklist | M | Metade do tempo até o documento revisado |
| 5 | **Calculadoras** | Nada jurídico; valores em centavos e datas civis em Honorários | Primeiro: atualização monetária com juros e multa, com aritmética decimal, séries do IBGE/BCB congeladas e memória exportável. Depois: aluguel e alimentos. Trabalhista só com demanda comprovada; previdenciária, revisional e FGTS por último | M (1ª), G (especialidade) | Reproduz o conjunto validado; diferenças de centavos explicadas |
| 6 | **Jurisprudência** | STJ, TJDFT, web, referências congeladas por caso; o score mede aderência, não autenticidade | Busca federada nas fontes oficiais mais acervo seletivo (súmulas, repetitivos, repercussão geral). O trecho é verificado antes de citar | M (consolidar), G (expandir) | 100% das citações com identidade e trecho verificáveis; ≥ 80% de consultas úteis no top 5 |
| 7 | **Portal, assinatura e retorno ao cliente** | Portal publica e recebe arquivos; esquema de assinaturas mantido após a remoção do ZapSign (`15e029d`) | Checklist documental por caso, pedidos ao cliente, assinatura manual (gov.br) ligada à versão exata do PDF e conferida no VALIDAR/ITI | P/M | Primeiro documento útil em ≤ 15 min; 60% dos ativados repetindo o fluxo na 4ª semana |
| 8 | **Financeiro leve** | Parcelas, recebimentos, estornos e cobrança manual com PIX | Despesas por caso, horas manuais, relatórios de recebidos/vencidos/previsão, CSV. Cobrança bancária integrada é uma etapa separada | M | Totais conciliados; fechamento do mês em ≤ 10 min |
| 9 | **Captação/CRM leve** | CRM com `prospect/active/archived`, áreas e casos | Origem do contato, próxima ação, proposta e motivo de encerramento, respeitando o Provimento OAB 205/2021 | M | 90% dos prospects com próxima ação |
| — | **Equipe tradicional** | Associados por caso | P2 de mercado, fora do escopo atual por decisão do responsável | — | — |

## Sequência

| Onda | Entregas | Por quê |
|---|---|---|
| **0–30 dias** | Fechar os P0 pendentes: [restauração ensaiada](plano-p0-lancamento-mvp.md), contrato com a Honcho, AbacatePay real. Turnstile e MFA para administradores. Início mais rápido no celular. Medir a ativação. Modelos curados. Começar a homologação do DJEN e o calendário do tribunal piloto | Prova o valor documental antes de assumir responsabilidade judicial |
| **30–90 dias** | DJEN em piloto, conciliado. Prazos cíveis em escopo restrito, com confirmação. Calculadora de atualização. Portal com pendências e assinatura manual. Relatórios básicos | Fecha o ciclo publicação → tarefa → documento → cliente com a infraestrutura que já existe |
| **90–180 dias** | Primeiro conector de andamentos. Expansão seletiva de jurisprudência. Despesas e horas, CRM leve conforme o uso. Calculadora especializada, assinatura integrada ou Domicílio só com demanda | Expande o que mostrou retenção |

No máximo duas frentes grandes ao mesmo tempo, para não lançar integrações pela metade.

## Onde a revisão do Claude mudou a proposta

- **Captura pela OAB primeiro.** Codex começava pelos processos vinculados e deixava a busca por OAB/UF para depois. O que o advogado espera do Jusfy e do Projuris é "minhas publicações de hoje", sem cadastrar processo por processo. Hoje o conector consulta só pelo número do processo (`djen.ts`). O filtro por OAB está listado como item a verificar na descoberta ([fontes-infra-judicial.md](fontes-infra-judicial.md)) e precisa ser confirmado contra a resposta real antes de entrar no escopo.
- **Proteções antes da abertura pública.** Codex não listava, nos 0–30 dias, reserva de créditos antes da chamada de IA, Turnstile e MFA, que vieram da auditoria (P1/P0). Sem eles, o cadastro aberto com créditos grátis é um custo sem teto.
- **Preço.** R$ 199/mês fica acima do Jusfy Ultimate (R$ 117), que inclui monitoramento e calculadoras. Enquanto as lacunas 1 e 2 não existirem, a decisão de preço é do responsável. Duas saídas possíveis: um plano de entrada mais barato, focado em documentos, ou manter o preço e mostrar a economia de tempo já no onboarding.

## O que não fazer

- Usar o DataJud no produto comercial. Os termos v1.2 vedam finalidade comercial ([termos](https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf)). Codex também aponta a Portaria CNJ 374/2026 ([ato](https://atos.cnj.jus.br/atos/detalhar/6972)), que não foi lida nesta revisão.
- Prometer "não perca prazos", cobertura nacional ou tempo real antes de medir.
- Contar prazo com LLM ou com um calendário genérico de feriados.
- Abrir teor no Domicílio Judicial, registrar ciência ou protocolar por decisão do agente.
- Buscar paridade numérica (50 milhões de julgados, milhares de modelos, todas as calculadoras).
- Reintroduzir o ZapSign sem entender por que saiu.
- Tratar funcionalidade nova como substituta dos P0 de segurança, dados, restauração e cobrança.
