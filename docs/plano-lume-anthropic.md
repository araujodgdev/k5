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
| Reranqueamento que não derruba a busca | Pendente | — |
| Uso de turnos que falham | Pendente | — |
| Cache de prompt e esforço na Anthropic | Pendente | — |
| Preço do Claude Haiku 5.5 | Pendente | — |

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
