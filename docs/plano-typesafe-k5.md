# TypeSafe no K5: Cofre/RAG, Documentos e Agenda

Status: plano de implementação, com decisões de conexão e Agenda confirmadas pelo usuário em 21/09/2026.
Este documento planeja as três frentes; não representa funcionalidades já entregues.

## 1. Resultado esperado e decisões

O K5 usará Jev para julgamentos delimitados sobre informações já autorizadas:
selecionar evidências relevantes, avaliar se fontes sustentam afirmações e interpretar
pedidos de agenda. O código continuará responsável por autorização, datas,
versionamento, persistência e execução. Os modelos atuais continuarão redigindo
respostas, extraindo acontecimentos e gerando minutas.

| Frente | Resultado para a pessoa | Papel do Jev |
| --- | --- | --- |
| Cofre/RAG | Respostas e seções de minutas recebem fontes mais relevantes | Pontuar candidatos recuperados pelo K5 |
| Documentos | Cronologias e minutas mostram afirmações que precisam de revisão, com suas fontes | Julgar sustentação, contradição ou insuficiência de evidência |
| Agenda | Um pedido em linguagem natural vira uma sugestão preenchida ou uma pergunta específica | Identificar intenção e escolher referências e valores entre candidatos |

Decisões confirmadas pelo usuário:

- Conexão TypeSafe por escritório, administrada em `/platform/clients`, com ativação
  independente para cada frente. É a opção coerente com o modelo atual de credenciais.
- Agenda assistida apresenta a proposta antes de salvar. Os formulários manuais
  continuam salvando diretamente quando a pessoa os envia.

Decisões técnicas propostas neste plano:

- A verificação semântica de documentos começa como apoio à revisão: não concede
  aprovação jurídica, não altera texto silenciosamente e não substitui as verificações atuais.
- Implantação gradual: infraestrutura comum → RAG → Documentos → Agenda.
  As três frentes pertencem ao mesmo plano, com entregas que podem ser verificadas separadamente.

O primeiro ciclo usa somente conexão por escritório e revisão das sugestões de Agenda
antes de salvar. A política da seção 6 vale para a interface, Mastra e WebMCP.

## 2. Base existente e pontos de integração

| Área | Evidência no código | Mudança planejada |
| --- | --- | --- |
| Recuperação no chat | [retrieval.ts](../apps/web/src/lib/knowledge/retrieval.ts): lexical + vetorial, fusão RRF, limite final e auditoria sem consulta em texto | Inserir reranking entre fusão e corte final |
| Busca usada pelas minutas | [document-workflows.ts](../apps/web/src/lib/document-workflows.ts): `selectedSources(..., section.search)` e até 24 trechos | Usar a recuperação comum, dentro dos documentos selecionados |
| Fontes para cobertura completa | [ai-sources.ts](../apps/web/src/lib/ai-sources.ts) e extração por trecho no workflow | Preservar a extração integral da cronologia; ranking não define cobertura |
| Validação documental | [ai-policy.ts](../apps/web/src/lib/ai-policy.ts) e [document-composition.ts](../apps/web/src/lib/document-composition.ts) verificam citações literais e proveniência jurídica | Acrescentar julgamento semântico após a validação determinística |
| Trabalho durável | [document-workflows.ts](../apps/web/src/lib/document-workflows.ts): checkpoints, lease e revalidação do papel | Retomar verificações por lote sem repetir etapas concluídas válidas |
| Documentos editáveis | [ai-store.ts](../apps/web/src/lib/ai-store.ts) e [artifacts-service.ts](../apps/web/src/lib/application/artifacts-service.ts): versão e proprietário | Associar verificação à versão exata e invalidá-la ao editar/restaurar |
| Agenda | [agenda-service.ts](../apps/web/src/lib/application/agenda-service.ts): vínculos, datas, versão e idempotência | Interpretar antes de chamar os serviços existentes |
| Execução comum | [agent-tools/index.ts](../apps/web/src/lib/agent-tools/index.ts): `runCapability` valida papel, entrada e saída | Publicar contratos específicos de interpretação e consulta de resultados |
| Conexões | [ai-connections-core.ts](../apps/web/src/lib/ai-connections-core.ts) assume provedores e tarefas generativas/embedding | Conexão TypeSafe própria, reutilizando criptografia e administração |

Não adicionar Jev ao seletor de modelos de conversa nem encaminhá-lo a `modelFor`.
Ele terá um adaptador próprio no servidor. O modelo escolhido pela pessoa no chat
continuará sendo usado pelo Mastra e pelas execuções de documentos.

## 3. Contrato comum de decisões

Criar `apps/web/src/lib/typesafe/` com cliente, configuração, contratos e conjuntos
versionados de perguntas. Os nomes abaixo são propostas de arquivos, não caminhos existentes:

- `client.ts`: SDK, cancelamento, deadline total, validação da resposta e erros sanitizados.
- `config.ts`: conexão do escritório, modelo fixado, modos e orçamento por frente.
- `contracts.ts`: respostas internas e metadados comuns.
- `questions/`: perguntas de relevância, sustentação e interpretação, com versão própria.
- `policy.ts`: composição dos sinais em regras explícitas e testáveis.

Usar o SDK JavaScript oficial, com versão fixada no lockfile após conferir a compatibilidade
com Node e o runtime de implantação. Os contratos do K5 serão independentes dos DTOs do SDK.
Referências: [SDK](https://docs.typesafe.ai/sdk/javascript),
[API](https://docs.typesafe.ai/api), [primitivas](https://docs.typesafe.ai/primitives).

Cada avaliação interna terá `status` (`evaluated`, `disabled`, `unavailable` ou
`budget_exceeded`), finalidade, modelo, versão das perguntas, fingerprint dos dados,
duração, uso reportado e respostas. Uma resposta de baixa confiança continua sendo
`evaluated`; indisponibilidade nunca será convertida em um julgamento negativo.

Choice/Score preservam a distribuição e a confiança; Noul preserva sua probabilidade
de sim. Não criar um campo de confiança fictício para Noul nem uma média geral que
esconda um campo crítico ambíguo. Limiares serão calibrados por finalidade com exemplos
pt-BR; não adotar um `0,8` universal. Ver [confiança](https://docs.typesafe.ai/confidence).

Perguntas independentes sobre o mesmo estado serão agrupadas. Uma segunda chamada
será usada quando a primeira determinar quais registros buscar ou quais opções oferecer.
Não enviar todo o Cofre ou o histórico completo quando bastam candidatos delimitados.

### Configuração, dados e operação

- Migração aditiva, pela interface compartilhada SQLite/D1; numerar conforme o estado
  das migrações no momento da implementação, preservando dados e segredos locais.
- Tabela proposta `typesafe_connection`: escritório, chave cifrada e indicação mascarada,
  modelo, versão da configuração, ativo e políticas por frente. Uma conexão vigente por escritório.
- Reutilizar a criptografia de credenciais e ampliar o comando de rotação para incluir
  os novos segredos, mantendo o comportamento atômico e a auditoria existentes.
- Administração exige papel de plataforma. Teste de conexão usa conteúdo sintético,
  distingue autenticação de inferência e não envolve documentos de clientes.
- Tabela proposta `typesafe_evaluation`: metadados de execução, finalidade, correlação,
  uso, resultado operacional e versão de configuração. Sem prompts, documentos ou chaves
  nos logs de aplicação; desativar logs de corpos do SDK.
- Resultados que a pessoa precisa consultar pertencem aos registros de negócio abaixo,
  com o mesmo escopo e política de acesso; não transformar telemetria em cópia dos documentos.
- Nenhum cache global de conteúdo. No primeiro ciclo, reutilizar apenas checkpoints
  dentro da execução e com fingerprint idêntico. Cache adicional fica para uma medição posterior.
- Reservar orçamento por escritório antes das chamadas concorrentes; contabilizar tentativas,
  não somente respostas bem-sucedidas. Não tratar uso desconhecido após timeout como custo zero.
- Modos por frente: `off`, `shadow` e `enabled`. `shadow` realiza chamadas e consome orçamento,
  mas não altera ordenação nem comportamento. Não ativá-lo implicitamente.
- Deadlines iniciais propostos: 2 s adicionais por busca, 5 s totais por interpretação
  de agenda e 10 s por lote documental. São metas configuráveis a medir, não promessas do serviço.
  Interação sem retry automático; worker com no máximo uma repetição transitória dentro do deadline.
- Cancelamento do usuário ou perda do lease interrompe novas chamadas. Circuit breaker
  e controle de concorrência evitam repetição de falhas. 401/403 suspendem a conexão;
  429 e erros transitórios seguem orçamento e política de recuperação.
- Validar modelo e limites de contexto na documentação/catálogo antes de fixá-los;
  dividir lotes e registrar cobertura em vez de truncar silenciosamente a evidência.

## 4. Cofre/RAG

Fluxo: escopo autorizado → candidatos lexicais/vetoriais → RRF → lote de julgamentos
Jev → ordenação pelo K5 → fontes para a resposta ou seção da minuta.

1. Separar construção dos candidatos e seleção final dentro da camada de recuperação.
   Revalidar escritório, documento, versão e exclusão antes de enviar texto ao Jev.
   Filtro por caso e documentos explícitos deve representar a interseção autorizada.
2. Começar com até 24 candidatos da fusão, limitado também pelo tamanho do estado;
   retornar a quantidade pedida pelo chamador. Empates usam a ordem RRF para estabilidade.
3. Usar um Score por candidato, com a mesma escala concreta: irrelevante, contexto
   relacionado, evidência parcial e evidência diretamente útil à pergunta. Um trecho
   que contradiz uma premissa pode ser diretamente útil; discordância não é irrelevância.
4. Inicialmente apenas reordenar. Não excluir candidatos por um corte de confiança
   arbitrário. Se houver lote incompleto ou resposta inválida, preservar a ordem RRF
   de toda a busca para evitar comparar candidatos avaliados com outros não avaliados.
5. Preservar `sourceId`, documento, referência e texto; o modelo não cria fontes.
   Registrar a ordem original e a proposta no conjunto de avaliação, sem duplicar o texto
   em logs. Metadados de retorno distinguem degradação da recuperação e do reranking.
6. Fazer o workflow de minutas usar essa mesma recuperação por seção com o escopo
   explícito do run. Preservar a leitura completa para validar fontes, templates e
   cronologias; não substituir a extração integral por um top-k.
7. Contratos de busca continuam serializáveis e utilizáveis por UI, Mastra e WebMCP.
   O acesso ao trecho original permanece disponível para conferência.

Se Jev estiver desligado ou indisponível, usar a busca atual. Se embeddings falharem,
a busca lexical ainda pode receber reranking quando configurado, com os dois estados
registrados separadamente. Não atribuir ao Jev documentos que a recuperação não encontrou.
Referência de padrão: [reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe).

## 5. Documentos: sustentação de fatos e citações

Fluxo: extração/redação atual → validações literais e de autorização → avaliação
semântica → composição e relatório de revisão → documento `needs_review`.

- A unidade inicial é um acontecimento da cronologia ou um parágrafo factual da minuta,
  identificado por ID estável e hash do conteúdo. O julgamento responde se **todas**
  as afirmações factuais daquela unidade são sustentadas pelo conjunto de evidências.
  Parágrafos extensos ou compostos podem exigir revisão; não inferir validação de frases
  não avaliadas a partir de uma citação correta em outra parte do parágrafo.
- O estado contém texto da unidade, citações literais e contexto adjacente autorizado.
  Choice entre `supported`, `unsupported`, `contradicted` e `insufficient_context`.
  Contexto truncado, OCR ruim e ausência do trecho completo devem permitir abstenção.
- Verificar primeiro existência dos IDs, pertencimento, versão e presença literal da
  citação. Jev não pode aprovar uma fonte que falhou nessa etapa.
- Um resultado não sustentado ou incerto gera uma pendência vinculada à unidade e à
  fonte; não reescreve o documento silenciosamente. Resultado favorável não muda o
  estado do artefato para aprovado nem autoriza jurisprudência nova.
- Manter a seleção explícita de autoridades jurídicas e o aviso de ausência de
  verificação externa. Verificar sustentação no material fornecido não verifica
  vigência, autenticidade ou correção jurídica da autoridade.
- No primeiro ciclo, preservar a revisão atual de divergências da cronologia;
  não adicionar uma comparação Jev de todos os pares de eventos. A nova etapa verifica
  sustentação de cada evento, sem inventar datas ou fundir pessoas por nome.
- Executar em lotes no worker com checkpoints identificados por hashes de conteúdo,
  versões de documentos, modelo e perguntas. Persistir resultados e cobertura antes
  de avançar; respeitar lease, cancelamento e revogação de papel.
- Tabela proposta `artifact_verification` e itens: escritório, proprietário, run,
  versão/hash do artefato, versões das fontes, unidades verificadas, julgamentos,
  pendências e cobertura. A autorização acompanha a do artefato, hoje por usuário
  e escritório, e não abre o documento a todos os integrantes.
- Editar ou restaurar um artefato torna a verificação anterior desatualizada. Uma
  nova versão de fonte também invalida os resultados dependentes. Mostrar isso no
  editor e permitir uma nova verificação durável; resultados antigos são históricos.
- Para texto editado sem evidência estruturada por parágrafo, reconstruir unidades
  e vínculos verificáveis ou marcar evidência ausente. Não reaplicar cegamente os
  vínculos agregados do artefato original ao novo conteúdo.
- Exibir contagem verificada/total, pendências e acesso às fontes no editor existente,
  em pt-BR e conforme o DESIGN. Não apresentar porcentagem de confiança como selo de validade.

Timeout ou orçamento insuficiente preserva o rascunho e as validações atuais, com
“Verificação semântica incompleta” e cobertura explícita. O fluxo de exportação
continua disponível sob as regras existentes; a interface não pode apresentá-lo como
documento aprovado. Não adicionar bloqueio de exportação no primeiro ciclo.
Referência: [verificação de citações](https://docs.typesafe.ai/cookbooks/citation_check).

## 6. Agenda: interpretação, esclarecimento e gravação

Entrada pela Agenda (“Descrever atividade”) e por uma ferramenta específica do agente.
O serviço recebe a mensagem original e um contexto temporal explícito: instante de
recebimento, fuso IANA informado pela interface e data civil nesse fuso. O servidor
valida esses dados; o relógio não será inventado pelo modelo nem recalculado a cada retry.

1. Buscar candidatos do escritório por nomes e referências da mensagem, com paginação
   e limite declarado. Havendo mais candidatos ou nomes semelhantes, pedir seleção;
   “nenhum destes” não significa que o registro inexiste no escritório.
2. Julgar intenção (`create_task`, `create_meeting`, `reschedule`, `complete`, `cancel`,
   `query`, `other`) e selecionar cliente, caso, integrante e atividade entre candidatos
   autorizados. As opções incluem nenhum vínculo e precisa esclarecer.
3. Construir candidatos de datas, horários e intervalos em código; usar Jev para
   selecionar a interpretação indicada na mensagem. Títulos e notas livres vêm da
   mensagem, de extração por spans ou do LLM existente e permanecem editáveis.
4. Perguntas cujos candidatos já existem compartilham uma chamada. Se a intenção
   exigir buscar atividades específicas, fazer uma segunda chamada com esses dados.
   Limitar o fluxo automático a duas rodadas; depois solicitar informação ou edição.
5. Validar datas civis, timezone, offsets, horário inexistente/duplicado por mudança
   de fuso e fim posterior ao início. “Amanhã às 9” sem duração de reunião exige
   esclarecimento; não inventar fim. Tarefa sem data continua válida.
6. Retornar uma proposta tipada: operação, valores, evidência de origem dos campos,
   referências selecionadas, versão esperada, dúvidas e validade temporal. Não executar
   uma mutação apenas porque Choice retornou uma intenção de escrita.
7. Abrir o formulário existente para criação/edição; conclusão/cancelamento mostram
   a atividade e a mudança proposta. Confirmar salva pelos serviços atuais, revalidando
   sessão, papel, referências, versão e idempotência. Alterar os campos muda o payload
   confirmado; repetir a mesma confirmação não cria outra atividade.

### Política de confirmação escolhida

Conforme a escolha do usuário, a interpretação é consultiva e o fluxo assistido exige
revisão antes da gravação. Isso também vale para pedidos feitos ao agente e exige
aplicar a regra no servidor e no catálogo: oferecer proposta ao agente/WebMCP em lugar
da escrita direta, e reservar a aplicação ao fluxo de confirmação do usuário. Apenas
alterar instruções do modelo não implementa essa política. Não confiar em `confirmed`
ou `origin` enviados pelo modelo como prova de confirmação.

Persistência proposta: `agenda_proposal`, vinculada a usuário e escritório,
com payload, versão, prazo de validade, estado e resultado da aplicação. A confirmação
fica vinculada ao conteúdo exato, e a mutação usa chave idempotente estável para suportar
queda entre salvar a atividade e marcar a proposta como aplicada. Revalidar permissões
antes de retomar; concorrência retorna conflito e pede atualização.

Essa mudança se aplica à criação/edição de atividades assistidas, inclusive conclusão,
cancelamento e reagendamento. Consultas continuam diretas. Cadastros e edições de CRM
permanecem no escopo atual; o interpretador não cria clientes ou casos para completar
um pedido. Pedidos com várias mutações são desmembrados em propostas revisáveis, sem
execução parcial silenciosa. Na primeira entrega, priorizar uma atividade por proposta.

Se Jev falhar ou ficar sem orçamento, oferecer preenchimento manual e preservar
qualquer proposta já revisável. A indisponibilidade não pode acionar automaticamente
o caminho antigo de escrita direta do agente. A regra de confirmação permanece
independente da disponibilidade do fornecedor depois de habilitado o fluxo assistido.

O texto de um documento recuperado nunca equivale a um pedido do usuário para agendar.
Atividade originada de documento exige ação explícita da pessoa e mantém a referência
de origem. Sem cálculo automático de prazo processual, sincronização externa ou criação
automática a partir de publicações judiciais neste ciclo.
Referências: [function calling](https://docs.typesafe.ai/cookbooks/function_calling),
[datas](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook).

## 7. Avaliação, implantação gradual e critérios de aceite

Antes de ativar comportamento novo, congelar exemplos pt-BR com rótulos revisados,
separando desenvolvimento de avaliação. Usar exemplos sintéticos ou material autorizado
para o fornecedor. A política de retenção/tratamento do TypeSafe precisa ser conhecida
antes de usar documentos reais; não presumir retenção zero.

Tamanho inicial proposto para diagnosticar erros, sem alegação de validade estatística:
60 consultas RAG com relevância por trecho, 120 unidades documentais rotuladas e
80 pedidos de agenda. Separar escritórios/casos entre os conjuntos quando possível;
incluir exemplos adversos e ampliar a amostra onde houver falhas.

| Frente | Comparação | Critério para ativar |
| --- | --- | --- |
| RAG | RRF versus RRF + Jev, mesmos candidatos; avaliar também recuperação dos candidatos | Melhora de nDCG@8 sem queda de Recall@8 no conjunto congelado; orçamento e latência respeitados |
| Documentos | Avaliação semântica versus rótulos humanos e verificações atuais | Medir falso suporte, detecção de contradição, abstenção e cobertura; todo erro de falso suporte da amostra deve ser analisado antes do piloto |
| Agenda | Payload proposto versus pedido rotulado | Nenhum alvo externo, gravação duplicada, horário inventado ou execução não autorizada; ambiguidades críticas pedem esclarecimento |
| Operação | Integração desligada, disponível, lenta, com resposta inválida e indisponível | Nenhuma perda de trabalho ou falsa indicação de avaliação concluída; falhas seguem as regras por frente |

Os limites aceitáveis de qualidade documental e latência serão registrados após a
linha de base, antes de habilitar `enabled`; não ajustar limiares olhando o conjunto
final de avaliação. Resultado fraco mantém a frente desligada ou apenas em avaliação.

Testes necessários:

- Isolamento entre escritórios e proprietários de artefatos, revogação durante execução,
  permissões de revisor, rotação de chaves, resposta/log sem segredos.
- Timeout total, retries, cancelamento, limites de contexto, orçamento concorrente,
  circuito aberto, modelo inválido e resposta com opções/IDs desconhecidos.
- RAG: interseção de filtros, documento excluído/alterado, empate, lote incompleto,
  indisponibilidade independente de embeddings e Jev, referências preservadas.
- Documentos: citação literal que não sustenta a afirmação, negação, fonte contraditória,
  evidência parcial, datas/valores errados, OCR incompleto, conteúdo editado e fonte nova,
  checkpoint retomado, perda de lease, cobertura parcial e nenhuma aprovação automática.
- Agenda: homônimos, candidatos fora da primeira página, negação de pedido, datas relativas,
  virada do dia, fuso ausente, horário ambíguo, reunião sem fim, tarefa sem data, retries,
  confirmação concorrente e atividade alterada depois da proposta.
- UI desktop/mobile, teclado, foco e estados de carregamento, indisponibilidade,
  revisão desatualizada e conflito, conforme [DESIGN.md](../apps/web/DESIGN.md).
- Contratos publicados no Mastra/WebMCP e execução pelo caminho comum. Testes simulados
  validam integração; avaliações reais validam o modelo e têm orçamento separado.

Na implementação: `pnpm db:setup`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` e `git diff --check`. Validar o adaptador e migrações no runtime de
implantação antes de publicar. Rollback operacional por frente via configuração,
sem apagar propostas, avaliações ou artefatos.

## 8. Entregas e ordem de trabalho

| Etapa | Entrega verificável | Dependência |
| --- | --- | --- |
| 0 | Decisões confirmadas incorporadas aos contratos, corpus pt-BR, linha de base e rubricas | Este plano |
| 1 | Conexão, administração, cliente, orçamento, testes e auditoria; tudo desligado | 0 |
| 2 | Recuperação comum, reranking em shadow, relatório comparativo; ativação por escritório | 1 |
| 3 | Verificação de cronologias/minutas, checkpoints, relatório no editor e invalidação por versão | 1 e recuperação comum de 2 |
| 4 | Interpretação da Agenda, esclarecimentos e política de gravação escolhida | 1; usa contratos existentes de Agenda |
| 5 | Avaliação integrada, teste real controlado e documentação de operação | 2–4 |

Fora do primeiro ciclo: substituir a geração por Jev, reconstruir OCR/embeddings,
refazer a UI do Cofre, automatizar decisões jurídicas, comparar todos os pares de
eventos, aprovar documentos automaticamente, sincronizar Google/Outlook, recorrência
e notificações. Nenhuma implantação ou chamada com dados reais está incluída no planejamento.

## 9. Referências

- [Pesquisa técnica TypeSafe](pesquisa-typesafe.md): contratos atuais, limitações e fontes primárias.
- [Plano de IA](plano-ia-mvp.md), [capacidades e RAG](plano-agente-ferramentas-rag-webmcp.md)
  e [Tarefas e Agenda](plano-tarefas-agenda.md).
- [Skill instalada](../.agents/skills/typesafe-ai/SKILL.md).
- [Guia de construção TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
  e [índice oficial](https://docs.typesafe.ai/llms.txt).
