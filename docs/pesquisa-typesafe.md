# TypeSafe/Jev no Lume: pesquisa para Cofre, Documentos e Agenda

Consulta: 21/09/2026. Escopo: contratos públicos e padrões de integração; nenhuma chamada de inferência foi executada e nenhuma credencial foi consultada. Fatos do fornecedor estão acompanhados de fontes primárias. As decisões para o Lume abaixo são propostas, ainda sujeitas à avaliação com dados do projeto.

## Contrato verificado

O SDK JavaScript/TypeScript é `@typesafe-ai/sdk`, suporta Node.js 20+ e oferece `TypeSafeClient.systemOne({ state, questions, model })`. A documentação consultada referencia o código do SDK v0.6.0. O HTTP correspondente é `POST https://api.typesafe.ai/v1/systemone`, autenticado por Bearer token. O retorno contém `model`, `answers` indexadas pelos IDs enviados e `usage.input_tokens`/`output_tokens`. Os IDs das perguntas não entram na inferência; o significado completo precisa estar nas instruções. [SDK JavaScript](https://docs.typesafe.ai/sdk/javascript), [API](https://docs.typesafe.ai/api)

| Primitiva | Resposta | Consequência para o desenho |
| --- | --- | --- |
| `Choice` | `choice`, `probabilities`, `confidence` | Uma opção entre alternativas fornecidas; máximo de 255 opções. Incluir ausência/ambiguidade quando aplicável. |
| `Noul` | `noul`, entre 0 e 1 | Probabilidade de uma condição ser verdadeira, sem campo separado de confiança. Não representa intensidade. |
| `Score` | `score`, `legend`, `probabilities`, `confidence` | Posição esperada entre níveis ordenados; usar de 2 a 10 níveis. Não extrai números exatos. |

Esses formatos são documentados na [API](https://docs.typesafe.ai/api). Confiança de `Choice` e `Score` resume a distribuição das respostas; não equivale à probabilidade de sucesso de todo o fluxo. Limiares dependem do domínio, das consequências e dos exemplos avaliados. [Confiança](https://docs.typesafe.ai/confidence)

Perguntas independentes sobre um mesmo estado podem compartilhar uma requisição. Cada pergunta é avaliada sem acesso às respostas das demais; resultados especulativos só devem ser consumidos no ramo pertinente. Quando uma resposta determina quais evidências buscar ou quais candidatos oferecer, é necessária outra etapa. Não há garantia de latência constante ou custo gratuito para perguntas adicionais. [Fan-out](https://docs.typesafe.ai/patterns/fan-out), [guia de construção](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)

## Modelos e limites observados

Na consulta, `jev-latest` e `jev-preview` apontam para `jev-1.13.0`. A documentação permite fixar o ID versionado, recomenda isso para limiares calibrados e retorna a versão efetiva na resposta. O modelo recebe apenas texto/JSON textual; OCR, leitura de PDF e extração de outros formatos continuam externos. [Modelos](https://docs.typesafe.ai/models)

Os limites publicados são 64 mil tokens para estado mais todas as perguntas e 32 mil para estado mais a maior pergunta. A página publica 250 mil tokens/segundo e 1.200 requisições/minuto, explicitamente sujeitos a ajustes. O preço observado é US$ 0,042 por milhão de tokens de entrada; saída gratuita. Revalidar disponibilidade, preço e limites ao implementar. [Modelos](https://docs.typesafe.ai/models)

Inglês é a principal língua de treinamento; a documentação pede avaliação própria para outras línguas. A página de limitações de Jev 1.13, revisada em 17/09/2026, registra fragilidade com cálculos, comparação de datas, estados grandes com detalhes irrelevantes, indireções e conteúdo adversarial. O modelo não gera texto livre e não deve assumir invariantes entre perguntas independentes. [Modelos](https://docs.typesafe.ai/models), [limitações](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

## Transporte, falhas e registros

O SDK usa por padrão timeout de 10 segundos **por tentativa**, duas novas tentativas e backoff; o timeout não limita o tempo total. Repete falhas de conexão, timeout, HTTP 408, 429 e 500–599. Pode respeitar `Retry-After` até 60 segundos. `RequestOptions.signal` permite cancelar a requisição e as tentativas pendentes. [Configuração](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig), [retentativas](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy), [opções por chamada](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions)

A API diferencia chave inválida (`401`), requisição inválida (`422`), limite (`429`) e sobrecarga (`529`). Esses eventos não são respostas semânticas negativas nem baixa confiança. [API](https://docs.typesafe.ai/api)

**Proposta Lume:** uma camada exclusivamente de servidor deve aplicar orçamento total de tempo, limite de concorrência e de payload, cancelamento e classificação explícita de falhas. Separar `disabled`, `unavailable`, `invalid_response` e `evaluated`; guardar o julgamento semântico dentro de `evaluated`. Uma indisponibilidade jamais produz artificialmente um parecer favorável.

**Proposta Lume:** registrar finalidade, escritório, versão de perguntas, modelo solicitado/efetivo, hashes/versões das evidências, duração, consumo, política aplicada e resultado operacional. Evitar texto integral e dados pessoais nos logs. O SDK informa que nível `debug` inclui headers e corpos; credenciais conhecidas são ocultadas, mas os corpos não. Chave somente no servidor; `dangerouslyAllowBrowser` deve permanecer desativado. [Configuração](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig)

## Cofre/RAG

**Fato:** o cookbook recupera uma lista curta com BM25 e avalia cada par consulta–trecho usando um `Noul`, ordenando pela probabilidade de responder à consulta. Os resultados publicados são de um experimento específico com CLERC, não uma garantia para português ou para o acervo do Lume. Reranking não recupera trechos que ficaram fora da lista inicial. [Reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe)

**Proposta Lume:** preservar recuperação híbrida, escopo do escritório e identificadores originais; aplicar Jev somente à lista de candidatos já autorizados. Comparar o ranking atual com uma rubrica `Score` por trecho — sem relação, contexto geral, evidência parcial, evidência direta — em um conjunto rotulado pt-BR. O `Noul` do cookbook é uma alternativa de experimento; não misturar suas probabilidades com a escala de `Score` ou reaproveitar limiares entre as duas primitivas.

**Proposta Lume:** agrupar candidatos em lotes limitados de estado, com instrução completa apontando para cada trecho. Medir lote versus par individual porque contexto adicional pode alterar precisão. Inicialmente apenas reordenar, sem descarte irreversível por limiar. Em falha, excedente de orçamento ou configuração ausente, manter o ranking híbrido original e registrar o fallback. Preservar evidências conflitantes pertinentes: relevância não significa concordância com a pergunta.

## Documentos e verificação de citações

**Fato:** o cookbook primeiro procura a citação textual por correspondência normalizada e depois usa `Choice` para verificar suporte, contradição ou falta de suporte à afirmação no contexto da fonte. Os exemplos têm limiar 0,8 e resultados de `jev-1.12`; ambos são demonstrações. A própria página observa que correspondência exata falha com truncamentos/paráfrases. [Verificação de citações](https://docs.typesafe.ai/cookbooks/citation_check)

**Proposta Lume:** separar três dimensões: referência válida e acessível (código); localização da citação na evidência (código, com tolerâncias explícitas); relação entre afirmação e contexto (`Choice`). Para texto não localizado, usar `quote_not_found`/revisão em vez de concluir automaticamente “citação fabricada”, especialmente com OCR. Fonte ausente, processamento incompleto e indisponibilidade do serviço também ficam distintos de `unsupported`.

**Proposta Lume:** o gerador existente produz conteúdo e unidades verificáveis, cada qual com afirmação, trecho e IDs da fonte. Jev não redige minutas nem justificativas. O resultado vincula versão do documento, hash do conteúdo, versão da extração e evidências; uma edição posterior torna o resultado anterior desatualizado. Em revisão humana, preservar o parecer original e registrar a decisão humana separadamente. Um relatório de citações não certifica a correção jurídica integral do documento.

## Agenda e interpretação de pedidos

**Fato:** o cookbook de function calling seleciona funções e argumentos de conjuntos fechados, deixando execução em código. Argumentos opcionais usam uma pergunta separada de presença; sem isso, um `Choice` pode selecionar uma opção mesmo quando o usuário nada disse. Texto livre, números e datas não são extraídos magicamente por esse padrão. [Function calling](https://docs.typesafe.ai/cookbooks/function_calling)

**Fato:** o cookbook de datas faz perguntas fechadas sobre tipo, dia, mês, ano e referências relativas; o código valida e monta a data. Usa relógio fixado, semântica explícita para “próxima quinta”, escapes para ano ausente/fora dos candidatos e apenas a confiança dos componentes consumidos. As convenções e o limiar 0,60 são exemplos, não requisitos. [Extração de datas](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook)

**Proposta Lume:** Jev seleciona intenção e candidatos de cliente/caso/tarefa/reunião fornecidos por buscas autorizadas. Oferecer `none`/`ambiguous` e não criar entidades para preencher lacunas. Títulos, descrições e trechos livres vêm do texto do usuário, de um parser ou do gerador já existente, com validação própria. Cada campo deve manter origem explícita, inferida ou ausente.

**Proposta Lume:** preservar horário de referência, fuso e locale no pedido; computar datas, duração, conflitos e regras de calendário em código. “Sexta”, data sem ano, hora ausente e pedidos envolvendo várias ações precisam de política explícita. A primeira entrega produz proposta editável, acrescenta confirmação ao fluxo assistido e reutiliza a autorização existente antes de mutações; confiança não substitui aprovação nem RBAC. Extrair um prazo escrito em documento não autoriza calcular ou cadastrar um prazo processual automaticamente.

## Dados e pontos ainda não comprovados

O fornecedor declara não treinar modelos com requisições/respostas de clientes. Sua política informa hospedagem nos EUA e retenção pelo tempo necessário às finalidades declaradas; o DPA também usa critérios, sem um número fixo de dias. ZDR é oferecido para clientes enterprise, portanto não pode ser presumido para uma conta comum. [Modelos](https://docs.typesafe.ai/models), [política de privacidade](https://typesafe.ai/legal/privacy-policy), [DPA](https://typesafe.ai/legal/data-processing), [documentos legais](https://docs.typesafe.ai/legal)

Permanecem desconhecidos: condição contratual e limites efetivos da conta do Lume; precisão e calibração em pt-BR jurídico; latência p50/p95 com os tamanhos reais; custo por fluxo; melhor tamanho de lote; tratamento adequado de OCR e paráfrases. **Proposta:** começar com material sintético ou anonimizado, guardar métricas por finalidade e habilitar escritórios conforme configuração explícita. A pesquisa não estabelece adequação jurídica nem substitui a avaliação contratual do uso de dados reais.

## Critérios propostos para validar a implementação

- **RAG:** comparar Recall@k da recuperação e nDCG@k/MRR do ranking antes/depois; medir custo, latência e frequência de fallback. Usar consultas sem resposta e evidências contraditórias.
- **Documentos:** medir falsos pareceres favoráveis, detecção de contradição e cobertura de revisão; testar citação ausente, OCR ruim, fonte removida e mudança de versão durante a avaliação.
- **Agenda:** medir intenção, entidade e componentes temporais separadamente; testar homônimos, candidato omitido, ambiguidade, campos ausentes, pedidos múltiplos e horário de referência fixo.
- **Comum:** testes determinísticos de isolamento por escritório, autorização, esquema, cancelamento, limite de payload e falhas do serviço. Avaliações reais do modelo separadas da suíte unitária; nenhum teste deve exigir internet ou credencial por padrão.

Não fixar limiares finais antes de avaliar exemplos representativos. Versionar o conjunto de avaliação e reservar exemplos de validação independentes dos usados para ajustar perguntas e políticas.
