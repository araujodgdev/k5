# Lume com a Anthropic: limites, busca, uso e custo

Diagnóstico iniciado em 09/10/2026, depois da troca do Lume para os modelos da Anthropic (Claude Sonnet 5.5 na conversa, extração e minutas; Claude Haiku 5.5 nos resumos). O diagnóstico usou os registros do próprio Lume em produção (`agent_trace`, `agent_trace_event`, `ai_usage`, `typesafe_evaluation`), lidos sem alterar dados. O token do Sentry disponível localmente é só de build e não lê issues.

Cada frente segue o mesmo formato:

- **Situação anterior** registra o diagnóstico antes da mudança, para comparação.
- **Feito** lista o que está no código, com o commit ou PR.
- **Pendente** lista o trabalho restante.
- **Decisões** registra as escolhas tomadas e as que continuam abertas.

## Estado geral

| Frente | Estado | Onde |
| --- | --- | --- |
| Limite de saída da conversa | Feito | `fix/lume-anthropic` |
| Reranqueamento que não derruba a busca | Feito | `fix/lume-anthropic` |
| Uso de turnos que falham | Feito | `fix/lume-anthropic` |
| Cache de prompt e esforço na Anthropic | Feito | `fix/lume-anthropic` |
| Preço do Claude Haiku 5.5 | Feito | `fix/lume-anthropic` |

## Fora do código

- **Limite de gasto da Anthropic.** O último turno de 09/10 falhou com `You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.` É o limite mensal da organização no Console da Anthropic. Até ele subir, toda chamada à Anthropic falha.
- **Embeddings.** A conexão OpenAI da plataforma foi excluída em 08/10. Anthropic e CLIProxyAPI não oferecem embeddings, então a busca semântica caiu para só lexical e `k5_knowledge_reindex` responde "Nenhum modelo de embedding está configurado". Uma conexão OpenAI, Google ou AI Gateway com `embedding_model` resolve.
- **Créditos da conversa de quem administra a plataforma.** A Anthropic devolve o uso e ele é gravado em `ai_usage`, com custo. O contador da conversa soma `credit_entry`, e administradores da plataforma não são cobrados (`isCreditExempt`), então para eles o contador fica em zero com qualquer provedor.

## Limite de saída da conversa

### Situação anterior

Cada passo da conversa tinha `maxOutputTokens: 6000`. Na Anthropic o raciocínio conta dentro desse limite. Em 09/10, às 13:44, o último passo de um turno terminou com `finishReason: "length"` e exatamente 6.000 tokens de saída (1.441 de raciocínio e 4.559 de texto), sem nenhum caractere visível: o modelo escrevia o documento nos argumentos de `k5_artifacts_create` e a chamada foi cortada. A ferramenta não rodou, e o turno ficou registrado como concluído, sem resposta e sem aviso. [Turno do chat](../apps/web/src/lib/chat-turn.ts).

### Feito

- O limite por passo passa a 16.000 tokens (`MAX_STEP_OUTPUT_TOKENS`).
- Quando o último passo termina por limite de tamanho, a pessoa vê um aviso para pedir a continuação ou dividir o pedido. O trace registra `halt` com `reason: output_limit`, e o turno fica como `halted`.

### Pendente

- Teste automatizado: o laço de streaming do chat não tem hoje um teste que rode sem um modelo real.

### Decisões

- 16.000 cabe no tempo do turno (180 s). Um limite maior só ajudaria com o turno mais longo, e o custo é o mesmo: só se paga o que o modelo escreve.

## Reranqueamento que não derruba a busca

### Situação anterior

Em 09/10, as 6 chamadas de `k5_knowledge_search` feitas com a Anthropic falharam com "The operation was aborted due to timeout", em cerca de 8 s cada. A busca lexical já tinha os trechos; quem estourou foi o reranqueamento do TypeSafe, que tem 2 s de prazo (`rerank.ts`). Os 6 registros `rag` com `unavailable`/`denied` em `typesafe_evaluation`, com média de 3,1 s, coincidem com essas falhas. Quando o prazo vence durante a admissão do conteúdo ou a chamada, `evaluate` relança o `TimeoutError` em vez de devolver um status, e `searchKnowledgeEngine` não o tratava, então a busca inteira falhava. Não é específico da Anthropic: o tempo da admissão e do banco passou dos 2 s na mesma época. [Reranqueamento](../apps/web/src/lib/typesafe/rerank.ts), [busca](../apps/web/src/lib/knowledge/retrieval.ts).

### Feito

- Passado o prazo do reranqueamento, a busca devolve os trechos na ordem RRF, com `reranking.status: unavailable` e `reason: timeout`.
- O cancelamento do turno e qualquer outro erro continuam propagando.
- Teste em `tests/typesafe.test.ts` com um envio mais lento que o prazo.

### Pendente

- Nada nesta frente.

### Decisões

- O prazo de 2 s continua. O reranqueamento melhora a ordem, mas não pode custar a busca; um prazo maior só atrasaria toda consulta quando o TypeSafe estiver lento.

## Uso de turnos que falham

### Situação anterior

Um turno que falhava ou era cancelado gravava `ai_usage` sem tokens nem custo, mesmo depois de vários passos concluídos. O turno das 14:25 de 09/10 rodou 5 passos (cerca de 190 mil tokens de entrada e 7 mil de saída, com duas buscas web) antes do erro da Anthropic, e nada disso ficou registrado. O trace do turno também fechava sem tokens. [Turno do chat](../apps/web/src/lib/chat-turn.ts), [registro de uso](../apps/web/src/lib/ai-runtime.ts).

### Feito

- O turno guarda o uso de cada passo fora do streaming. Em falha ou cancelamento, `recordUsage` recebe esses passos e as buscas web.
- `recordUsage` grava tokens e `cost_usd` de chamadas que não são cobradas. `credits` continua vazio e o saldo não muda.
- O trace do turno fecha com o total dos passos concluídos.
- Teste em `tests/credits.test.ts`.

### Pendente

- Nada nesta frente.

### Decisões

- Turno que falha ou é cancelado continua sem cobrança de créditos, como antes. O custo fica registrado para a plataforma acompanhar o que absorve. Cobrar esses passos é uma decisão de produto em aberto: um turno pode falhar depois de criar um documento.

## Cache de prompt e esforço na Anthropic

### Situação anterior

- **Sem cache.** Todos os passos com a Anthropic registraram `cachedInputTokens: 0`. Cada passo reenviava de 16 mil a 80 mil tokens a preço cheio; o turno das 13:44 somou 299 mil tokens de entrada em 8 passos. A OpenAI faz cache sozinha; a Anthropic só faz quando o pedido marca `cache_control`.
- **Esforço ignorado.** `supportsReasoningEffort` só aceitava OpenAI e CLIProxyAPI, e `modelProviderOptions` só montava opções para a OpenAI. O esforço escolhido no admin não chegava à Anthropic, e o painel nem deixava escolher. [Provedores](../apps/web/src/lib/ai-providers.ts), [tarefas](../apps/web/src/lib/ai-tasks.ts).

### Feito

- Os passos da conversa pedem cache automático à Anthropic (`cacheControl: ephemeral` no pedido). Cada passo lê do cache o prefixo do passo anterior.
- A Anthropic passa a aceitar esforço. O admin pode escolhê-lo, e o pedido leva `output_config.effort`:
  - "Mínimo" vira `low`, porque a Anthropic não tem esse nível;
  - `xhigh` vira `high` nos modelos anteriores ao Opus 4.7;
  - Sonnet 4.5, Haiku 4.5 e modelos mais antigos não recebem esforço, porque recusam o parâmetro.
- A guarda contra injeção também manda o modelo, para o esforço respeitar essas regras.
- Testes em `tests/source-provider-round3.test.ts` (corpo do pedido) e `tests/ai-assignments.test.ts` (resolução do esforço).

### Pendente

- Medir a taxa de acerto do cache em produção, por `cached_input_tokens` em `ai_usage`, depois do deploy.

### Decisões

- O cache vale só para a conversa. Uma chamada única (extração, resumo, guarda) não reaproveita o prefixo e pagaria a gravação do cache, que custa 25% a mais na entrada.
- A troca de ferramentas ativas depois de `k5_tools_select_modules` invalida o cache uma vez por turno, porque as ferramentas vêm antes de tudo no prefixo. Os passos seguintes voltam a acertar.
- Os esforços que a migração 0030 gravou (`xhigh` em agente, minutas e extração) passam a chegar à Anthropic onde ainda estiverem salvos. Em produção, em 09/10, só a classificação tinha esforço explícito (`low`); os demais grupos herdam o padrão do provedor.

## Preço do Claude Haiku 5.5

### Situação anterior

O Claude Haiku 5.5 foi atribuído aos resumos em 09/10, mas `ai_model_price` não tinha linha para ele. O custo caía na linha `*` (US$ 2 de entrada e 10 de saída por milhão de tokens), vinte vezes o preço de tabela, e era cobrado em créditos assim.

### Feito

- Migration `0096_claude_haiku_price.sql`: US$ 0,10 de entrada e 0,50 de saída por milhão; cache lido a 0,01 e gravado a 0,125; acima de 100 mil tokens de entrada, as duas taxas multiplicam por 5. Preços de tabela da Anthropic lidos em 10/10/2026.

### Pendente

- Nada nesta frente.

### Decisões

- `ON CONFLICT DO NOTHING`: um preço que alguém já tenha cadastrado à mão para o modelo continua valendo.
