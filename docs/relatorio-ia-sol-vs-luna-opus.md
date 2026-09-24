# Uso de IA no Lume: onde usar GPT-6 Sol, GPT-6 Luna ou outra solução

Revisão de 24/09/2026 sobre a árvore local do repositório (`main`). Checklist de cobertura em [relatorio-ia-sol-vs-luna-opus-tarefas.md](relatorio-ia-sol-vs-luna-opus-tarefas.md).

Escopo e limites desta revisão:

- Nenhum código, configuração, dado ou segredo foi alterado. Nenhuma chamada paga a modelo foi feita.
- O modelo efetivamente ativo em staging ou produção não foi verificado. O banco local recusou a conexão de leitura, e não consultei ambientes remotos.
- Não há métricas reais de volume, custo ou latência. Os números da seção 7 são cenários com premissas explícitas, não medições.
- Caminhos de arquivo são relativos a `apps/web/`, salvo quando começam com `docs/`.

## 1. Resumo executivo

A hipótese da equipe é que "Sol é usado amplamente" e "Luna serve para resumo e classificação". O código mostra um quadro diferente em quatro pontos.

1. **Sol não é o padrão do código.** Nenhum lugar do código fixa `gpt-6-sol`. Se o administrador não atribuir um modelo, a conexão OpenAI usa `gpt-5` (`src/lib/ai-defaults.ts:13`). Sol só é usado se o administrador o escolher em "Modelo do Lume", e essa tela grava o mesmo modelo para chat, extração e redação de uma vez (`src/components/lume-model-settings.tsx:41-43`). Um teste usa Sol como exemplo (`tests/platform.test.ts:131-136`), mas isso não prova a configuração ativa.
2. **A classificação já não usa LLM.** Triagem do Gmail, triagem de feedback, interpretação da Agenda, reordenação de buscas, pertinência de julgados, conferência de citações e verificação de suporte usam TypeSafe/Jev (`src/lib/typesafe/client.ts:21`), com respostas probabilísticas e limiares no código. Não há classificação feita por Sol para substituir por Luna.
3. **Todo pedido OpenAI roda com `reasoningEffort: 'xhigh'`** (`src/lib/ai-providers.ts:7-9`), inclusive extração estruturada e o teste de credencial. A OpenAI cobra tokens de raciocínio como saída e os conta em `max_output_tokens`. Luna aceita `xhigh`, então trocar só o modelo e manter `xhigh` testa um Luna lento e caro. A hipótese "Luna é mais rápido" precisa ser avaliada com o esforço escolhido para cada tarefa.
4. **Não há onde medir o ganho.** `ai_usage` registra modelo, tarefa, status e tokens de entrada e saída, mas não latência, tokens de raciocínio, tokens em cache, execução ou tentativa (`db/postgres/0001_initial.sql:162-174`). Embeddings e a transcrição OpenAI não gravam uso. Nenhuma tela ou script lê `ai_usage`.

### Decisões prioritárias

| # | Decisão | Por quê | Esforço |
|---|---|---|---|
| D1 | Separar perfis de modelo e esforço por etapa, com Sol como padrão em todos | Hoje não dá para rodar Luna só na extração de cronologia ou só na pesquisa web; a pesquisa web usa o perfil `chat` (`research/web-jurisprudence.ts:77`) | Médio |
| D2 | Tornar o esforço de raciocínio configurável por perfil, em vez de `xhigh` fixo | Custo e latência de raciocínio dominam os cenários da seção 7; há risco de resposta incompleta com `maxOutputTokens` 12.000 (`ai-runtime.ts:82`) e 6.000 (`api/chat/route.ts:221`) | Baixo |
| D3 | Completar a telemetria de `ai_usage` antes de qualquer troca | Sem latência, raciocínio e resultado da validação, não há como aprovar nem reverter uma troca com base em dados | Baixo a médio |
| D4 | Primeiro piloto de Luna: extração de cronologia por trecho, com escalonamento para Sol decidido por validadores determinísticos | Maior volume (uma chamada por trecho de 1.800 caracteres), saída verificável por citação literal (`document-workflows.ts:88`), artefato sempre marcado para revisão | Médio |
| D5 | Segundo piloto de Luna: busca de candidatos na pesquisa web | Links são filtrados pelo que a busca retornou (`web-jurisprudence.ts:65-74`) e o Jev filtra pertinência; o resumo gerado ainda não é conferido | Baixo, depois de D1 |
| D6 | Manter Sol no chat com ferramentas, na redação de minutas e no plano de anexos | O chat executa escritas sem confirmação (`api/chat/route.ts:38`); a redação é o produto final; o plano de anexos pode virar arquivos sem revisão quando pedido pelo chat (`api/chat/route.ts:41`) | Nenhum |
| D7 | Manter Jev em todas as classificações atuais e corrigir o modo sombra onde ele é ignorado | Feedback aplica resultados em modo sombra (`feedback-triage.ts:127`); pesquisa web também (`web-jurisprudence.ts:122-134`) | Baixo |

Oportunidades novas com melhor relação valor/risco, detalhadas na seção 4: resumo sob demanda de conversas do Gmail (Luna), proposta de fatos documentados para o perfil do caso (Luna, com citações verificadas), ficha de documento no Cofre (Jev para tipo, Luna para resumo) e síntese periódica de feedback para a equipe (Luna).

## 2. Inventário dos usos atuais

### 2.1 Como o modelo é escolhido

| Aspecto | Fato no código | Evidência |
|---|---|---|
| Perfis de tarefa | `chat`, `extraction`, `drafting`, `embedding` | `src/lib/ai-connections-core.ts:14` |
| Provedores | openai, anthropic, google, deepseek, inception, openrouter, vercel | `ai-connections-core.ts:11` |
| Escopo | Uma configuração para a plataforma; linhas por escritório ficam guardadas e não são lidas | `ai-connections-core.ts:41-45`, migração `0022_platform_ai_connections.sql` |
| Resolução | Conexão ativa com `<tarefa>_model` preenchido; senão, a primeira conexão ativa com o modelo padrão do provedor | `ai-connections-core.ts:214-233` |
| Exclusividade | Atribuir uma tarefa a uma conexão a remove das demais | `ai-connections-core.ts:104-108` |
| Modelo padrão OpenAI (chat, extração, redação) | `gpt-5` | `ai-defaults.ts:13` |
| Modelo padrão de embedding OpenAI | `text-embedding-3-small` | `ai-defaults.ts:24` |
| Catálogo | `gpt-6-sol` e `gpt-6-luna` adicionados manualmente à lista do Mastra | `ai-providers.ts:20` |
| Esforço de raciocínio | `xhigh` em toda chamada OpenAI; outros provedores sem opção | `ai-providers.ts:7-9`, `ai-runtime.ts:23-25` |
| API usada pelo Mastra para OpenAI | Responses API por padrão | `node_modules/@mastra/core/dist/llm-Oy59omd7.js:9545` (biblioteca instalada, 1.67.0) |
| Escolha pelo usuário | Nenhuma; o corpo do chat não tem campo de modelo | `lib/chat-contract.ts:6-21`, README `apps/web/README.md:151-152` |
| Modelo fixado por execução | Cronologia e minuta gravam provedor e modelo ao enfileirar; o worker usa esses valores | `application/runs-service.ts:68`, `:76-79`; `document-workflows.ts:19` |

### 2.2 O que o administrador pode configurar

| Item | Pela interface | Só pela API | Evidência |
|---|---|---|---|
| Conexões (provedor, chave cifrada, ativa) | Sim | | `components/platform-connections.tsx` |
| Modelo de chat, extração e redação | Sim, **um único modelo para os três** | Separado por tarefa via `PATCH /api/platform/ai/connections/[id]` | `lume-model-settings.tsx:41-43`; `connectionPatchSchema` em `ai-connections-core.ts:36-38` |
| Modelo de embedding | Não | Sim | mesmo esquema; a tela não envia `embedding` |
| Esforço de raciocínio | Não | Não | fixo em `ai-providers.ts:8` |
| Limite de tokens de saída, tempo limite | Não | Não | constantes no código |
| TypeSafe: chave, versão do Jev, ativo, modo por finalidade (`off`, `shadow`, `enabled`), orçamento diário, concorrência | Sim | | `components/typesafe-settings.tsx`, `typesafe/contracts.ts:5-14` |
| Política Google por ação (`blocked`, `confirmation`, `automatic`) | Sim (escritório) | | `google/policy.ts:27-48` |

Padrões TypeSafe no código: modelo `jev-1.13.0`; `feedback` começa `enabled`, as demais finalidades `off`; 2.000.000 tokens por dia; concorrência 4 (`typesafe/contracts.ts:7-12`).

### 2.3 Inventário

"Perfil" é o perfil de modelo lido por `resolveModelConfig`. "Modelo atual" separa o padrão do código do que depende do administrador. Frequência é o que o código permite deduzir; não há volume medido.

| ID | Fluxo e ponto de entrada | Entrada | Saída | Perfil / serviço | Modelo atual | Frequência deduzida | Efeito posterior | Controles |
|---|---|---|---|---|---|---|---|---|
| U1 | Chat do Lume. `POST /api/chat` (`app/api/chat/route.ts:72`) | Mensagem de até 20 mil caracteres, 24 últimas mensagens (`chat-prompt.ts:17`), regras e conhecimento do escritório (até 40 mil caracteres), escopo do Cofre, anexos, imagens | Texto em streaming e chamadas de ferramentas | `chat` + ferramentas do escritório + `web_search` do provedor para OpenAI e Anthropic (`route.ts:124`) | Admin. Padrão OpenAI `gpt-5`, `xhigh` | Por mensagem; até 8 passos e 16 chamadas de ferramenta (`route.ts:32-34`) | **Escreve sem confirmação**: tarefas, reuniões, casos, clientes, pastas, documentos, anexos, execuções (`route.ts:38`). Pede confirmação para exclusões, tribunais e edição de documento que não criou (`route.ts:39`). Google conforme política, padrão confirmação | Instruções contra injeção (`route.ts:52`, `:60`); aprovação com entrada canônica e validade de 10 min (`application/approvals-service.ts:112-162`); limite de repetição; conferência de citações por Jev depois da resposta (`route.ts:284`) |
| U2 | Pesquisa de jurisprudência na web. Ferramenta `k5_research_web_jurisprudence` (`capabilities/research.ts:52`), `POST /api/research/web` | Questão de 5 a 500 caracteres | Até 12 candidatos com título, tribunal, número, data, URL, resumo | `chat` + `web_search`; uso gravado como `research-web` (`web-jurisprudence.ts:77`, `:99`) | Admin (mesmo modelo do chat) | Por chamada da ferramenta; até 6 passos, 6.000 tokens | Lista mostrada à pessoa; URLs viram fonte para conferir citações (`citations/sources.ts`) | Só URLs devolvidas pela busca sobrevivem (`web-jurisprudence.ts:65-74`); Jev pontua pertinência e se é decisão (`:109-135`). **O resumo não é conferido com a página** |
| U3 | Cronologia, extração por trecho. Worker (`document-workflows.ts:79-97`) | Trecho de até 1.800 caracteres (`vault.ts:501-507`) | Até 80 eventos com data, descrição, citação; lacunas | `extraction`, modelo fixado na execução | Admin (mesmo modelo do chat pela interface) | **Uma chamada por trecho**, em sequência; até 100 documentos | Artefato `needs_review` e verificação Jev enfileirada (`:194-200`) | Evento sem citação literal de 12+ caracteres é descartado e contado (`:88-90`); cobertura completa exigida (`:180-181`); menções jurídicas sem origem removidas (`document-composition.ts:122-128`) |
| U4 | Cronologia, revisão de divergências (`document-workflows.ts:100-116`) | Até 400 eventos numerados | Pares ou grupos de índices com tipo | `extraction`, modelo da execução | Admin | Uma por cronologia | Seção "Divergências" do artefato | Só índices válidos (`document-composition.ts:93-106`); falha vira nota e não interrompe; regra determinística de datas roda sempre (`document-composition.ts:72-90`) |
| U5 | Minuta, estrutura (`document-workflows.ts:121-128`) | Pedido, regras, modelo de documento (40 mil caracteres) | Título e até 12 seções com termo de busca | `drafting`, modelo da execução | Admin | Uma por minuta | Define a busca e as seções | Esquema; título ou cabeçalho com menção jurídica é trocado (`document-composition.ts:186`, `:204`) |
| U6 | Minuta, redação por seção (`document-workflows.ts:129-151`) | Até 65 mil caracteres de fatos recuperados, 18 mil de julgados, 12 mil de estilo | Parágrafos com evidência por fonte e citação | `drafting` + embedding da consulta + rerank Jev | Admin | Uma por seção, até 12 | Texto da minuta | Parágrafo sem evidência verificável vira pendência; texto jurídico só entra se aprovado por humano (`document-composition.ts:183-214`; `ai_citation_approval`) |
| U7 | Plano de anexos. `k5_vault_plan_annexes`, `POST /api/vault/cases/[id]/annexes` (`annexes.ts:95-125`) | Texto por página do PDF digitalizado (até 300 páginas, 1.200 caracteres cada) e petição (até 60 mil) | Documentos com páginas e trecho da petição que os cita | `extraction`, sem modelo fixado | Admin | Uma por pedido, síncrona | Proposta revisável na aba Anexos; **o chat é instruído a gerar logo após planejar** (`api/chat/route.ts:41`; `capabilities/annexes.ts:19`) | O código ordena pela menção encontrada na petição e desmarca o não citado (`annexes.ts:44-64`); páginas limitadas ao PDF |
| U8 | Transcrição por modelo com áudio nativo (Gemini). `POST /api/chat/transcribe` (`audio-transcription.ts:39-62`) | Áudio de até 20 MB | Texto de até 8.000 caracteres | `chat` | Só se o provedor de chat for Google | Por nota de voz | Texto aparece no compositor antes do envio | Pessoa vê o texto antes de enviar |
| U9 | Teste de credencial (`ai-runtime.ts:50-63`) | "Teste de conexão." | "OK" | modelo testado | Admin | Por clique | Registro de auditoria | Limite de 32 tokens de saída, **com `xhigh`** |
| U10 | Transcrição OpenAI (`audio-transcription.ts:11-27`) | Áudio | Texto | `gpt-4o-mini-transcribe`, fixo no código, chave da conexão de chat | Fixo | Por nota de voz | Igual a U8 | **Uso não gravado em `ai_usage`** |
| U11 | Embeddings de indexação e de consulta (`knowledge/indexing.ts:10`, `knowledge/retrieval.ts:129`) | Lotes de 32 trechos; consulta | Vetores | `embedding`; endpoints OpenAI, AI Gateway ou Google (`embedding-provider.ts:13-17`, `:70-86`) | Padrão OpenAI `text-embedding-3-small`; tela não permite trocar | Por trecho indexado; por busca | Busca semântica, fusão com busca lexical (RRF, `retrieval.ts:19`) | Filtro por escritório em todos os backends (`vector-index.ts:75-80`, `:154-160`, `:237-242`); degrada para lexical. **Uso não gravado** |
| U12 | TypeSafe/Jev em 10 pontos (tabela 2.4) | Estado curto e perguntas tipadas | Escolha, nota ou probabilidade | `https://api.typesafe.ai` (`typesafe/client.ts:13`) | `jev-1.13.0` padrão | Por evento | Ordenação, filtros, marcas, propostas | Modos por finalidade, orçamento diário reservado em transação, circuito após 3 falhas, validação estrita da resposta (`client.ts:26-91`) |
| U13 | OCR (`ocr-worker.ts:4-13`, `document-extraction.ts:84-133`) | Página ou imagem | Texto | Tesseract local, `por+eng`; opcional `VAULT_OCR_URL` (`document-extraction.ts:57-82`) | Fixo | Por página sem camada de texto | Trechos do Cofre | Checkpoint por página. Não é LLM |

Não usam IA: títulos de conversa (primeiros 80 caracteres da primeira mensagem, `ai-store.ts:45-47`), histórico do chat (sem resumo ou compactação), notificações (`notifications/policy.ts:75-107`), central de comando, Drive, Calendar, Docs, exportação DOCX, candidatos de citação para aprovação (regex em `ai-policy.ts:14-23`), extração de datas da Agenda (`typesafe/agenda-time.ts`).

### 2.4 Usos do Jev

| Finalidade | Ponto de entrada | Pergunta | Efeito | Modo sombra respeitado? |
|---|---|---|---|---|
| `rag` | Busca do Cofre, `knowledge/retrieval.ts:191` → `typesafe/rerank.ts:34` | Nota 0-3 de utilidade por trecho | Reordena, 2 s | Sim (`rerank.ts:45`) |
| `documents` | Verificação de suporte, `typesafe/verification.ts` | suporta / não suporta / contradiz / contexto insuficiente | Mostrado na revisão do documento | Sim (`verification.ts:89`) |
| `documents` | Conferência de citações, `citations/review.ts:79` | tipo da citação, correspondência e suporte por fonte | Lista informativa | Sim (descarta respostas) |
| `agenda` | `k5_agenda_interpret`, só WebMCP e interface (`capabilities/agenda.ts:44`) | intenção, vínculos, data e horário escolhidos entre valores calculados no código | Proposta; só grava com "Confirmar e salvar" | Sim (`typesafe/agenda.ts:59`) |
| `research` | Rerank do acervo, `typesafe/research-rerank.ts:51` | Nota 0-4 por julgado | Reordena | Sim |
| `research` | Pertinência ao caso, `research/case-assessment.ts:162` | três notas, posição quanto à tese, adequação | Mostrado; exigido para vincular julgado (dispensável) | **Provavelmente não**: resultado gravado e exibido sem checar o modo (leitura do código, não executado) |
| `research` | Filtro da pesquisa web, `web-jurisprudence.ts:118` | nota 0-4 e "é decisão judicial?" | Remove candidatos com nota < 2 ou decisão < 0,5 | **Não**: só checa `status` (`:122`) |
| `email` | Triagem do Gmail, `google/gmail/triage.ts:88` | categoria, prioridade, precisa de resposta | Filtro e ordenação na caixa; nada muda no Gmail | Sim (`triage.ts:112`) |
| `feedback` | Worker, `feedback-triage.ts:110` | tipo, módulo, gravidade, valor, segurança, dado pessoal | Prioridade p0-p3 calculada no código; correção do admin prevalece | **Não**: `classified = status === 'evaluated'` (`:127`) |
| `rag` (teste) | `api/platform/typesafe/route.ts:27` | pergunta sintética | Nenhum | Sempre sombra |

Resultados de avaliação registrados no repositório (dados sintéticos, rótulos sem revisão independente, `docs/typesafe-implementacao.md:69-82`): RAG nDCG@8 de 0,7078 para 0,9997; documentos 117/120 concordâncias sem falso suporte; Agenda 79/80 intenções. O próprio documento diz que esses números "não justificam ativação automática em produção". Para pesquisa e pertinência não há métricas (`docs/validacao-pesquisa-jurisprudencia.md`).

### 2.5 Consequências de `reasoningEffort: 'xhigh'`

Fatos:

- Sol e Luna aceitam `none`, `low`, `medium` (padrão), `high`, `xhigh` e `max` (páginas dos modelos, seção 9). Portanto `xhigh` não gera erro com Luna.
- Tokens de raciocínio são cobrados como saída e ocupam `max_output_tokens`. Se o limite é atingido, a resposta volta como `incomplete` (guia de raciocínio, seção 9).
- O guia oficial recomenda `low` para uso de ferramentas e tarefas sensíveis a latência, `medium` como equilíbrio e `high`/`xhigh` quando a qualidade importa mais que a latência.
- O código envia `xhigh` em todas as chamadas OpenAI, e um teste garante isso (`tests/openai-effort.test.ts:6-16`). O README declara que "não há redução silenciosa" (`apps/web/README.md:156-157`).

Consequências prováveis, a verificar:

- Na extração estruturada (`maxOutputTokens: 12000`, `ai-runtime.ts:82`) e no plano de anexos com PDF de 300 páginas, o raciocínio pode consumir o limite e a resposta falhar. `generateStructured` transforma qualquer falha na mensagem genérica "A análise falhou" (`ai-runtime.ts:89`), e `ai_usage` não guarda o motivo. Não há como saber hoje se isso acontece.
- No teste de credencial (`maxOutputTokens: 32`), o raciocínio pode esgotar o limite. O código só trata `finishReason === 'error'` como falha (`ai-runtime.ts:62`), então o teste pode passar com resposta vazia. Não verificado.
- Qualquer comparação Sol × Luna feita sem mudar o esforço mede os dois em `xhigh`. A diferença de custo por token entre eles é de 20 vezes (seção 7), mas a latência de Luna em `xhigh` pode não ser menor que a de Sol em `medium`.

## 3. Matriz por caso de uso

Critério de "não crítico" adotado: resultado limitado, verificável e revisável, sem autoridade para enviar, alterar dados, decidir questão jurídica, calcular prazo ou agir sobre cliente ou processo sozinho. Cada linha avalia cinco dimensões separadas, porque resposta curta não implica tarefa segura.

Escala: B = baixo, M = médio, A = alto.

| ID | Caso | Sensibilidade dos dados | Gravidade de um erro | Efeito no usuário | Verificável por código | Reversível | Recomendação | Justificativa | O que mudaria a recomendação |
|---|---|---|---|---|---|---|---|---|---|
| U1 | Chat com ferramentas | A (fatos de clientes, documentos) | A (escreve sem confirmação) | A | Parcial (só citações, depois) | Parcial | **Sol. Luna não recomendado** | O modelo decide quais ferramentas chamar e com que argumentos; várias escritas não pedem confirmação (`route.ts:38`); uma escolha errada de cliente, caso ou data vira registro | Luna só seria reavaliado para um modo de chat somente leitura, e só se igualar Sol em seleção de ferramentas e argumentos numa bateria de 200 cenários, sem nenhuma escrita indevida |
| U1b | Esforço do chat | | | | | | **Sol com esforço avaliado entre `medium` e `high`** | O guia sugere `low` para ferramentas; `xhigh` em cada passo multiplica custo e latência | Se a bateria de ferramentas piorar abaixo de `xhigh`, manter `xhigh` |
| U2 | Pesquisa web, busca de candidatos | M (a questão pode conter fatos do caso; vai ao provedor com busca na web) | M (julgado irrelevante ou resumo infiel) | M (lista para leitura, com link) | Sim para URL; não para resumo | Sim (lista, sem escrita) | **Luna em piloto A/B, Sol como padrão até aprovar; escalonar para Sol quando não sobrar candidato com link** | Links são restritos aos que a busca retornou; o Jev filtra; a pessoa abre o link. O risco que sobra é o resumo, que o chat comenta | Resumos com erro material acima do de Sol na amostra revisada; ou provedor sem `web_search` no Luna (a página do modelo lista a ferramenta) |
| U2b | Pesquisa web, filtro | | | | | | **Jev, manter** | Já produz nota calibrada com limiar no código | Nenhum Luna aqui |
| U3 | Cronologia, extração por trecho | A (documentos do caso) | M-A (evento omitido, data errada; não é cálculo de prazo) | M (artefato marcado para revisão, verificação Jev) | Parcial: citação literal é verificada; omissão e interpretação da data não | Sim (artefato, versões) | **Luna com escalonamento para Sol, após avaliação** | Maior volume. A citação obrigatória elimina evento inventado. Omissão é o risco real e precisa de métrica de recall | Recall de Luna+escalonamento abaixo de Sol menos 2 pontos, ou mais erros de data; taxa de escalonamento acima de 50% (economia some, seção 7) |
| U4 | Revisão de divergências | A | M (divergência não apontada passa em silêncio) | B-M | Sim para índices | Sim | **Luna candidato de baixa prioridade; manter no modelo da execução até avaliar** | Saída limitada a índices validados, falha já degrada; mas é uma chamada por cronologia, economia pequena | Recall de divergências sintéticas abaixo de Sol |
| U5 | Estrutura da minuta | A | M | M | Esquema apenas | Sim | **Sol** | Uma chamada por minuta; economia pequena; a estrutura condiciona a busca de fatos de cada seção | Nenhum previsto |
| U6 | Redação por seção | A | A (texto jurídico entregue ao advogado) | A | Parcial (evidência por citação; qualidade da prosa não) | Sim | **Sol. Luna não recomendado** | É o produto final; a validação cobre proveniência, não qualidade argumentativa | Preferência cega de advogados por Luna em pelo menos 90% de empates ou vitórias numa amostra de 30 seções |
| U7 | Plano de anexos | A (documentos pessoais: RG, certidões, laudos) | A (anexo errado protocolado no PJe) | A | Parcial (ordem pela menção; limites de página não) | Sim (arquivos novos, nada é apagado) | **Sol. Luna não recomendado enquanto o chat puder gerar sem revisão** | O corte errado de páginas não é detectado por código, e a instrução do chat pula a revisão (`route.ts:41`, contradiz `capabilities/annexes.ts:15` e `README.md:166-167`) | Depois de exigir confirmação humana antes de `k5_vault_generate_annexes` no chat, pilotar Luna se acertar limites de página em 95% ou mais de 30 PDFs sintéticos |
| U8 | Transcrição Gemini | M | M (fala mal transcrita; a pessoa revisa antes de enviar) | B | Humano | Sim | **Manter** (não envolve OpenAI) | | |
| U9 | Teste de credencial | B | B | B | Sim | Sim | **Usar o modelo e o esforço configurados para cada perfil** | O teste deve reproduzir a chamada real, inclusive esforço | |
| U10 | Transcrição OpenAI | M | M | B | Humano | Sim | **Manter `gpt-4o-mini-transcribe`; Luna não se aplica** | Luna não aceita áudio (página do modelo) | Gravar uso em `ai_usage` |
| U11 | Embeddings | A | M (busca pior) | B | Sim (busca degrada) | Sim | **Manter modelo de embedding; Luna não se aplica** | Luna não oferece endpoint de embeddings (página do modelo) | |
| U12 | Classificações atuais (Jev) | varia | varia | varia | Sim (limiares no código) | Sim | **Jev; Luna não recomendado como substituto nem como fallback** | Jev devolve probabilidades que o código usa com limiares; LLM geraria texto a converter, sem calibração. Em falha, o comportamento atual cai para regra ou ordem original | Métricas reais mostrarem Jev pior que um classificador simples em alguma finalidade |
| U13 | OCR | A | M | M | | | **Manter Tesseract** | Sem LLM hoje; OCR por visão de Sol ou Luna é outro projeto com custo e privacidade próprios | |

## 4. Oportunidades novas

Ordenadas por valor esperado, depois por menor risco e esforço. Nenhuma existe hoje (conferido: não há resumo de e-mail, sugestão de perfil do caso, ficha de documento nem síntese de feedback no código).

| # | Oportunidade | Solução proposta | Valor | Risco | Esforço |
|---|---|---|---|---|---|
| O1 | Resumo sob demanda de uma conversa do Gmail | Luna, esforço `low`, somente leitura, iniciado pela pessoa | A | M | M |
| O2 | Proposta de fatos documentados para o perfil do caso | Luna extrai candidatos com citação; código verifica a citação; pessoa confirma cada fato | A | M | M-A |
| O3 | Ficha de documento no Cofre (tipo, datas citadas, partes, resumo curto) | Jev escolhe o tipo; Luna escreve o resumo com citações; processamento assíncrono | M-A | B-M | M |
| O4 | Síntese semanal de feedback para a equipe da plataforma | Luna agrupa tickets já triados pelo Jev e resume temas | M | B | B |

**O1. Resumo de conversa do Gmail.** Ponto de entrada: botão na conversa aberta (`components/google/gmail-panel.tsx`). Entrada: mensagens da conversa já obtidas por `k5_gmail_get_thread`, tratadas como conteúdo não confiável (a saída da ferramenta já carrega `untrustedContent`). Saída: até 5 linhas e uma lista de pedidos explícitos, cada item com trecho literal verificado por `quoteIsPresent` (`ai-policy.ts:26-28`). Regras: não inferir nem calcular prazo; se a conversa for de andamento processual (categoria `proceedings` do Jev), mostrar aviso para ler o original; nenhuma ferramenta disponível ao modelo. Controles existentes aproveitados: política Google, verificação de consentimento em `triage.ts:37-38`. Risco: conteúdo de cliente enviado à OpenAI, que hoje só recebe o que a pessoa leva ao chat. O TypeSafe recebe só assunto e trecho de 600 caracteres. Isso exige decisão da equipe (seção 8). Muda a recomendação: taxa de afirmação sem citação acima de 2%, ou qualquer instrução embutida no e-mail seguida na bateria de injeção.

**O2. Fatos do perfil do caso.** O perfil é preenchido à mão (`research/case-profile.ts:10-20`) e é pré-requisito da avaliação de pertinência. Luna lê os trechos dos documentos escolhidos e propõe fatos com `documentIds` e `chunkIds` e citação literal. O código descarta proposta sem citação encontrada. A pessoa confirma cada fato; questão jurídica, objetivo e tese continuam manuais, porque definem a estratégia. Etapa preparatória de baixo risco dentro de um fluxo importante: o perfil só é salvo pela pessoa, e a avaliação posterior usa o texto confirmado. Muda a recomendação: fatos propostos que distorcem o trecho em mais de 5% da amostra revisada.

**O3. Ficha de documento.** Ao terminar a extração (`vault.ts:434-478`), o Jev escolhe o tipo entre opções fixas (procuração, identidade, comprovante de residência, certidão, laudo, contrato, petição, decisão, e-mail, outro), com limiar de confiança como já faz a Agenda. Luna escreve um resumo de 2 a 3 linhas usando os primeiros trechos, com citação verificada. Uso: escolher documentos para chat, cronologia e anexos. Pode rodar em Batch ou Flex (metade do preço, seção 7) porque não é interativo. A ficha é marcada como sugestão e não entra em minutas nem em cronologias. Muda a recomendação: custo por documento acima do combinado, ou tipo errado em mais de 10% com confiança acima do limiar.

**O4. Síntese de feedback.** A triagem já grava tipo, módulo e prioridade por ticket (`feedback-triage.ts:131-144`). Luna recebe os tickets da semana já classificados, sem os marcados com dado pessoal (`personal_data_flag`), e devolve temas com os IDs dos tickets. Público interno, sem efeito automático. Valor menor, mas risco e esforço baixos.

Consideradas e descartadas ou adiadas:

- Resumo de publicações e intimações judiciais: o leitor tende a tratar o resumo como base de prazo. Fica fora até haver regra de produto explícita.
- Compactação do histórico do chat com Luna: o resumo alimentaria o agente que escreve sem confirmação; um fato perdido vira ação errada.
- Títulos de conversa gerados por modelo: valor baixo frente ao truncamento atual.
- Luna interpretando pedidos de Agenda no chat: o chat já cria atividades direto; trocar o modelo não acrescenta controle. O caminho seguro é o que já existe na interface (Jev + proposta + confirmação).
- Luna substituindo o Jev em triagem: perde probabilidades calibradas e limiares.

## 5. Proposta de roteamento, validação, fallback e observabilidade

### 5.1 Perfis

Trocar os quatro perfis atuais por perfis por etapa, cada um com modelo, esforço de raciocínio e limite de saída próprios. Todos começam com o valor atual (modelo de chat, extração ou redação, `xhigh`), para que a mudança de código não mude comportamento.

| Perfil novo | Substitui | Uso | Valor inicial | Alvo após avaliação |
|---|---|---|---|---|
| `chat` | `chat` | U1 | atual | Sol, esforço a avaliar |
| `research_web` | `chat` em U2 | U2 | igual a `chat` | Luna `low` ou `medium` |
| `extraction_chunk` | `extraction` em U3 | U3 | igual a `extraction` | Luna `medium`, escalonamento para Sol |
| `extraction_review` | `extraction` em U4 | U4 | igual a `extraction` | a decidir |
| `annex_plan` | `extraction` em U7 | U7 | igual a `extraction` | Sol |
| `drafting` | `drafting` | U5, U6 | atual | Sol |
| `summary` | novo | O1, O3, O4 | Luna `low` | Luna |
| `embedding` | `embedding` | U11 | atual | atual |

O modelo e o esforço de cada etapa devem ser gravados na execução, como já acontece com o modelo (`runs-service.ts:76-79`), para que uma troca no meio de uma cronologia não misture configurações.

### 5.2 Validação e escalonamento na extração de cronologia

O escalonamento é decidido por verificações em código, nunca pela autoavaliação do modelo. Um trecho processado por Luna vai para Sol quando qualquer condição abaixo ocorre:

1. Falha de esquema ou resposta incompleta.
2. Mais de 20% dos eventos descartados por citação ausente (`document-workflows.ts:88-89`).
3. Nenhum evento devolvido em trecho onde uma regex encontra data (padrões de `detect.ts` ou `agenda-time.ts` podem ser reaproveitados).
4. Data devolvida em formato completo sem a mesma data presente na citação ou no trecho.

O resultado de Sol substitui o de Luna para aquele trecho, e o checkpoint registra qual modelo produziu o resultado final. Os limites de 20% e das demais regras são pontos de partida a calibrar na avaliação.

### 5.3 Fallback

- Luna falha ou é escalonado: uma chamada a Sol. Sol falha: comportamento atual (falha da execução ou nota de degradação).
- Chave de desligamento por perfil na administração: voltar o perfil para Sol afeta só execuções novas, porque o modelo fica gravado na execução.
- Jev indisponível: manter o comportamento atual de cada finalidade (ordem original, lista sem nota, proposta manual). Não trocar por LLM.

### 5.4 Observabilidade

Nova migração acrescentando colunas a `ai_usage` (não editar `0001`):

| Coluna | Para quê |
|---|---|
| `profile`, `reasoning_effort` | separar etapas e esforço |
| `duration_ms` | latência |
| `reasoning_tokens`, `cached_input_tokens` | custo real (raciocínio é saída; cache custa 10% da entrada) |
| `finish_reason`, `error_kind` | distinguir `incomplete`, esquema inválido, tempo esgotado, provedor |
| `run_id`, `step_key`, `attempt`, `escalated_from` | custo por tarefa concluída e taxa de escalonamento |
| `validation_json` | eventos descartados, parágrafos sem evidência, candidatos sem link |

Também gravar uso de embeddings (U11) e da transcrição OpenAI (U10). Consulta mínima para o painel da administração:

```sql
SELECT profile, model_id, reasoning_effort,
       count(*) FILTER (WHERE status = 'completed') AS concluidas,
       count(*) FILTER (WHERE status = 'failed') AS falhas,
       count(*) FILTER (WHERE escalated_from IS NOT NULL) AS escalonadas,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
       sum(input_tokens) AS entrada, sum(cached_input_tokens) AS entrada_cache, sum(output_tokens) AS saida
FROM ai_usage
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2, 3;
```

Isolamento e privacidade: `ai_usage` já guarda `office_id`; não gravar prompt nem resposta, só contagens e códigos, como faz `typesafe_evaluation`.

### 5.5 Correções que precedem os pilotos

- Modo sombra ignorado na triagem de feedback (`feedback-triage.ts:127`), no filtro da pesquisa web (`web-jurisprudence.ts:122`) e, provavelmente, na pertinência ao caso. Sem isso, o modo sombra não serve para avaliar nada nessas finalidades.
- Exigir confirmação antes de `k5_vault_generate_annexes` quando chamado pelo agente, ou remover a instrução de gerar logo após planejar (`api/chat/route.ts:41`, `capabilities/annexes.ts:19`).
- Conferir se falhas de ferramenta chegam como `tool-error` em vez de `tool-result` no Mastra 1.67. A rota só trata `tool-result` (`api/chat/route.ts:245-248`). Se a suspeita se confirmar, os botões Confirmar não aparecem e o limite de chamadas não conta falhas. Afeta o controle de U1 com qualquer modelo.

## 6. Plano de avaliação lado a lado

Sem chamadas pagas nesta revisão; o plano abaixo exige orçamento aprovado pela equipe. Todos os conjuntos são sintéticos ou anonimizados, em pt-BR, e ficam fora do banco de produção (o padrão de `scripts/typesafe-eval.ts`, com esquema isolado, serve de modelo).

### 6.1 Conjuntos

| Caso | Conjunto | Rótulo de referência |
|---|---|---|
| U3 cronologia | 40 documentos sintéticos (petições, contratos, e-mails, laudos), 600 a 900 trechos, com 10 documentos escaneados de baixa qualidade | Lista de eventos e datas feita por advogado, revisada por um segundo |
| U4 divergências | 30 cronologias com divergências plantadas (data, valor, envolvido) e 10 sem divergência | Divergências plantadas |
| U2 pesquisa web | 60 questões jurídicas de áreas diferentes, 10 contendo tentativa de injeção no texto da questão | Para cada candidato: é decisão, é pertinente, o resumo corresponde à página |
| U1 chat (só para decidir o esforço de Sol) | 200 cenários de ferramenta: agenda, CRM, Cofre, anexos, pesquisa, Google, com 30 contendo instrução embutida em documento ou e-mail | Ferramenta e argumentos esperados; lista de ações proibidas |
| O1 resumo de e-mail | 50 conversas sintéticas, 15 com instrução embutida, 10 de andamento processual | Pedidos explícitos e datas citadas |
| O2 perfil do caso | 20 casos sintéticos com 3 a 8 documentos | Fatos documentados esperados |

### 6.2 Configurações comparadas

Para cada caso: Sol `xhigh` (atual), Sol `medium`, Luna `medium`, Luna `low`, e Luna com escalonamento para Sol. Mesmo prompt, mesmo esquema, mesmos validadores. Três repetições por item para medir variação.

### 6.3 Métricas

- Qualidade: recall e precisão de eventos, exatidão de data, eventos descartados por citação, divergências encontradas, precisão@5 dos candidatos, fidelidade do resumo (revisão humana), ferramenta e argumentos corretos, ações proibidas executadas.
- Segurança: instrução embutida seguida (deve ser zero), fato de julgado tratado como fato do cliente.
- Operação: falhas de esquema, respostas incompletas, taxa de escalonamento, latência p50 e p95, tokens de entrada, cache, saída e raciocínio.
- Custo por tarefa concluída (fórmula da seção 7).
- Revisão cega: dois advogados comparam pares de saídas sem saber o modelo.

### 6.4 Critérios de aprovação

| Caso | Aprovar Luna (com ou sem escalonamento) se |
|---|---|
| U3 | recall de eventos igual ou maior que o de Sol `xhigh` menos 2 pontos; erros de data sem aumento; nenhum evento sem citação no artefato; escalonamento abaixo de 40%; revisão cega "igual ou melhor" em 90% das cronologias |
| U4 | recall das divergências plantadas igual ao de Sol menos 5 pontos; nenhum falso positivo novo em cronologias sem divergência |
| U2 | precisão@5 igual ou maior que a de Sol menos 5 pontos; fidelidade do resumo com erro material em no máximo 3% dos candidatos mostrados; nenhuma instrução embutida seguida |
| U1 esforço | a configuração mais barata que empata com Sol `xhigh` em ferramenta e argumentos, sem nenhuma ação proibida |
| O1, O2 | nenhuma afirmação sem citação verificada chega à tela; nenhuma instrução embutida seguida |

### 6.5 Implantação e reversão

1. Rodar Luna em sombra na etapa escolhida: executa, grava métricas, não mostra resultado. Custo adicional pequeno (seção 7). Os dados vão ao mesmo provedor já usado, sem novo processador.
2. Liberar para uma parcela das execuções novas, com o modelo gravado na execução.
3. Reverter o perfil para Sol se, numa janela de 7 dias: escalonamento passar de 50%; falhas de esquema ou respostas incompletas passarem de 2%; reclamações de feedback no módulo documentos subirem acima da média das 4 semanas anteriores; ou qualquer incidente de instrução embutida seguida.

## 7. Custos: fórmula, cenários e dados que faltam

### 7.1 Preços oficiais consultados em 24/09/2026

Por milhão de tokens, processamento Standard (seção 9):

| Modelo | Entrada | Entrada em cache | Saída |
|---|---|---|---|
| GPT-6 Sol | US$ 2,00 | US$ 0,20 | US$ 10,00 |
| GPT-6 Luna | US$ 0,10 | US$ 0,01 | US$ 0,50 |

- Pedidos acima de 272 mil tokens de entrada custam o dobro na entrada e 1,5 vez na saída.
- Batch e Flex custam 50% do Standard. Fast custa o dobro.
- Tokens de raciocínio são cobrados como saída.
- Com a mesma contagem de tokens, Luna custa exatamente 1/20 de Sol.
- Referências fora de Sol/Luna: `gpt-4o-mini-transcribe` cerca de US$ 0,003 por minuto; `text-embedding-3-small` US$ 0,02 por milhão; Jev US$ 0,042 por milhão de entrada, conforme `docs/pesquisa-typesafe.md:23` (21/09/2026, não revalidado aqui).

### 7.2 Custo por tarefa concluída

```
C(m) = entrada_nao_cache × p_in(m) + entrada_cache × p_cache(m) + (saida_visivel + raciocinio) × p_out(m)

Custo por tarefa concluída =
  [ C(Luna) × (1 + r_L) + e × C(Sol) × (1 + r_S) ] / (1 − f)
  + P(erro não detectado) × H
```

- `r_L`, `r_S`: novas tentativas por tarefa em cada modelo.
- `e`: fração escalonada para Sol.
- `f`: fração que falha mesmo depois do escalonamento.
- `H`: custo de um erro que chega ao advogado. Não é custo de API e costuma dominar a conta.

Ponto de equilíbrio só em API: Luna com escalonamento empata com Sol quando `e ≈ 1 − C(Luna)(1 + r_L)/C(Sol)`. Com tokens iguais, isso dá cerca de 95%. **A decisão não é limitada pelo custo de token; é limitada pela qualidade e pelo tempo de revisão humana (`H`).**

### 7.3 Cenário: extração de cronologia por trecho

Premissas, nenhuma medida:

- 1.200 tokens de entrada: trecho de 1.800 caracteres, prompt, instruções gerais e esquema, a cerca de 3,5 caracteres por token em pt-BR.
- 600 tokens de saída visível.
- Raciocínio R em três hipóteses; o teto é o `maxOutputTokens` de 12.000.
- Tokens iguais nos dois modelos (hipótese; Luna pode raciocinar mais ou menos).

| Raciocínio por trecho | Sol por trecho | Luna por trecho |
|---|---|---|
| R = 1.000 | US$ 0,0184 | US$ 0,00092 |
| R = 4.000 | US$ 0,0484 | US$ 0,00242 |
| R = 10.000 | US$ 0,1084 | US$ 0,00542 |

Cronologia com 400 trechos e R = 4.000: Sol cerca de US$ 19,36; Luna cerca de US$ 0,97.

Com escalonamento (R = 4.000, `r_L` = 5%, `r_S` = 2%, `f` ≈ 0):

| Escalonamento `e` | Custo por trecho | Economia sobre Sol (US$ 0,0494 com novas tentativas) |
|---|---|---|
| 15% | 0,00254 + 0,15 × 0,0494 ≈ US$ 0,0099 | cerca de 80% |
| 30% | ≈ US$ 0,0174 | cerca de 65% |
| 50% | ≈ US$ 0,0272 | cerca de 45% |

O mesmo cenário mostra que reduzir o esforço de Sol de R = 10.000 para R = 1.000 corta o custo por trecho em cerca de 83%, sem trocar de modelo. Por isso D2 vem antes de D4.

### 7.4 Cenário: plano de anexos

- PDF de 300 páginas × 1.200 caracteres mais petição de 60 mil caracteres dá cerca de 120 mil tokens de entrada, abaixo do limite de 272 mil.
- Saída de 2.400 tokens mais 8.000 de raciocínio (premissa).
- Sol: cerca de US$ 0,24 + US$ 0,10 = US$ 0,34 por plano. Luna: cerca de US$ 0,017.

A economia absoluta por plano é pequena perto do custo de um anexo errado no protocolo. A recomendação de manter Sol vale mesmo que o volume de planos seja alto.

### 7.5 Cenário: chat

Não calculado com números. O tamanho do prompt depende do esquema de dezenas de ferramentas enviado em cada passo, do conhecimento do escritório (até 40 mil caracteres) e do histórico de 24 mensagens. Nada disso foi medido. A fórmula da seção 7.2 se aplica por passo. O cache de prompt (entrada em cache a 10%) é a principal alavanca de custo aqui, e hoje não se sabe a taxa de acerto porque `ai_usage` não grava tokens em cache.

### 7.6 Dados que faltam

1. Volume por tarefa, modelo e status nos últimos 30 dias (`ai_usage`).
2. Tokens de raciocínio e em cache por chamada.
3. Latência por chamada.
4. Número médio de trechos por cronologia e de seções por minuta (`ai_run` e `ai_checkpoint` permitem contar).
5. Tamanho real do prompt do chat com o catálogo de ferramentas.
6. Preço da ferramenta `web_search` para GPT-6 e quantas buscas cada chamada de U2 faz.
7. Tempo médio de revisão de uma cronologia pelo advogado, para estimar `H`.

## 8. Fatos não confirmados, onde procurei e perguntas à equipe

### 8.1 Não confirmado

| Fato | Onde procurei | Situação |
|---|---|---|
| Modelo ativo por tarefa em staging e produção | Banco local `127.0.0.1:55432` (conexão recusada); código; testes; docs | Desconhecido. O código cai em `gpt-5` sem atribuição; o teste usa `gpt-6-sol` só como exemplo |
| Modelo de embedding ativo | Mesmo | Desconhecido; a tela não permite trocar |
| Modos do TypeSafe ativos | Mesmo | Desconhecido; padrão do código é só `feedback` ligado |
| Falhas por resposta incompleta com `xhigh` | `ai-runtime.ts`, Sentry (`docs/auditoria-sentry-2026-09-24.md`, não detalhado para isto) | Hipótese; a mensagem genérica esconde o motivo |
| Teste de credencial passa com resposta vazia | `ai-runtime.ts:55-62` | Hipótese |
| Falhas de ferramenta chegam como `tool-error` | `api/chat/route.ts:232-276`; `node_modules/@mastra/core/dist/agent-Dk0N0Nlg.js` | Suspeita de subagente, não reproduzida |
| Pertinência ao caso aplicada em modo sombra | `research/case-assessment.ts:113-181`; `components/research-case-linker.tsx` | Leitura do código indica que sim; não executado |
| Serviço por trás de `VAULT_OCR_URL` | `document-extraction.ts:57-82`, `.env.example`, docs | Não identificado |
| Trocar o embedding reindexa o Cofre | `README.md:148`; `knowledge/indexing.ts`; `knowledge/retrieval.ts:124-130` | Código não reindexa documentos existentes nem compara o modelo da consulta com o da geração ativa. Contradiz o README |
| Qualidade de Sol e Luna em textos jurídicos em pt-BR | Fontes oficiais | Nenhum benchmark oficial encontrado; o anúncio no fórum traz só comparações de programação feitas por usuários |

### 8.2 Contradições entre documentação e código

- `apps/web/README.md:166-167` diz que nada é gerado sem confirmação nos anexos; `api/chat/route.ts:41` e `capabilities/annexes.ts:19` mandam o agente gerar logo após planejar.
- `apps/web/.env.example:31-33` e `docs/typesafe-implementacao.md:8-23` descrevem TypeSafe por escritório; o código usa uma conexão da plataforma (`0005_typesafe_platform.sql`, `typesafe/config.ts:17-25`).
- `audio-transcription.ts:9` fala em chave "do escritório"; a chave é a da conexão de chat da plataforma.
- A página de administração diz que o modelo do Lume responde também pela "busca do Cofre" (`app/app/admin/ai/page.tsx:28`); a busca usa o perfil `embedding`, que essa tela não altera.

### 8.3 Perguntas que exigem resposta da equipe

1. Qual modelo e qual esforço estão atribuídos hoje a chat, extração, redação e embedding em staging e produção? Sol está mesmo nos três primeiros?
2. O `xhigh` fixo foi escolhido com base em alguma avaliação? Se não, a equipe aceita testar `medium` e `high` antes de testar Luna?
3. Os contratos e a política de dados com a OpenAI permitem enviar conteúdo completo de e-mails de clientes (O1)? Há exigência de retenção zero ou de residência de dados? (Na documentação da OpenAI, a residência na UE para Sol e Luna vale só no processamento Standard.)
4. Pode compartilhar agregados de `ai_usage` e `ai_run` dos últimos 30 dias, sem conteúdo?
5. Qual é o orçamento para a avaliação da seção 6 e quem rotula os conjuntos (horas de advogado)?
6. A geração de anexos pelo chat sem revisão é intencional? A resposta muda a recomendação de U7.

## 9. Fontes externas (consultadas em 24/09/2026)

- [GPT-6 Sol, página do modelo](https://developers.openai.com/api/docs/models/gpt-6-sol): contexto de 1.050.000 tokens, 128.000 de saída, esforços `none` a `max` com padrão `medium`, entrada de texto e imagem, sem endpoint de embeddings nem áudio.
- [GPT-6 Luna, página do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna): mesmos limites de contexto e saída, mesmos esforços, entrada de texto e imagem, sem embeddings nem áudio; `web_search` e saída estruturada disponíveis.
- [Preços da API](https://developers.openai.com/api/docs/pricing): valores da seção 7.1.
- [Guia de modelos de raciocínio](https://developers.openai.com/api/docs/guides/reasoning): raciocínio cobrado como saída; `incomplete` ao atingir `max_output_tokens`; recomendações por nível de esforço.
- [Guia de escolha do modelo](https://developers.openai.com/api/docs/guides/latest-model): Sol "strong reasoning on demanding tasks"; Luna "efficient, repeatable work at scale".
- [Anúncio no fórum oficial de desenvolvedores](https://community.openai.com/t/announcing-gpt-6-sol-and-gpt-6-luna-in-the-api-codex-and-chatgpt/1399925), 22/09/2026. O post em `openai.com/index/introducing-gpt-6-sol-and-luna/` retornou HTTP 403 e não foi lido.
- Documentação do Mastra instalada (`@mastra/core` 1.67.0): uso da Responses API para OpenAI.
