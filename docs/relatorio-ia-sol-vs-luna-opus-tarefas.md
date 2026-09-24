# Checklist de cobertura: relatório Sol vs. Luna

Acompanha [relatorio-ia-sol-vs-luna-opus.md](relatorio-ia-sol-vs-luna-opus.md). Revisão feita em 24/09/2026 sobre a árvore de trabalho local (`main`, com alterações locais não relacionadas a IA preservadas). Nenhum código, configuração, dado ou segredo foi alterado. Nenhuma chamada paga a modelo foi feita.

Legenda: [x] inspecionado e classificado no relatório; [~] inspecionado, com fato não confirmado registrado na seção 8; [ ] não coberto.

## Leituras obrigatórias

- [x] `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTEXT.md`
- [x] `apps/web/README.md` (seções de IA, TypeSafe, anexos, voz, feedback)
- [x] `apps/web/.env.example` (a nota sobre chave TypeSafe por escritório está desatualizada)
- [x] `apps/web/src/lib/ai-connections-core.ts`, `ai-connections.ts`, `ai-runtime.ts`, `ai-providers.ts`, `ai-defaults.ts`, `ai-modalities.ts`, `ai-policy.ts`, `ai-sources.ts`, `ai-store.ts`
- [x] `apps/web/src/app/api/chat/route.ts`
- [x] `apps/web/src/lib/document-workflows.ts`, `application/runs-service.ts`, `document-composition.ts`
- [x] `apps/web/src/lib/annexes.ts`, `annexes-contract.ts`, `capabilities/annexes.ts`
- [x] `apps/web/src/lib/research/web-jurisprudence.ts`
- [x] `apps/web/src/lib/knowledge/embedding-provider.ts`, `indexing.ts`, `retrieval.ts`, `vector-index.ts`
- [x] `apps/web/src/lib/google/gmail/triage.ts`
- [x] `apps/web/src/lib/typesafe/` (todos os arquivos)

## Chamadas de IA encontradas (todas classificadas no inventário)

Busca usada: `generateStructured|createAgent(|recordUsage(|resolveModelConfig(|.generate(|.stream(|evaluate(|embedTexts|embedQuery|api.openai.com|api.typesafe.ai` em `apps/web/src` e `apps/web/scripts`.

LLM generativo (Mastra):

- [x] U1 chat do Lume com ferramentas (`app/api/chat/route.ts:125`, `:218`)
- [x] U2 pesquisa de jurisprudência na web (`research/web-jurisprudence.ts:77`, `:90`)
- [x] U3 extração da cronologia por trecho (`document-workflows.ts:87`)
- [x] U4 revisão de divergências (`document-workflows.ts:108`)
- [x] U5 estrutura da minuta (`document-workflows.ts:126`)
- [x] U6 redação por seção (`document-workflows.ts:143`)
- [x] U7 plano de anexos (`annexes.ts:123`)
- [x] U8 transcrição nativa por modelo com áudio, caminho Gemini (`audio-transcription.ts:44-57`)
- [x] U9 teste de credencial (`ai-runtime.ts:50-63`, rota `api/platform/ai/connections/[connectionId]/test`)

Outros serviços:

- [x] U10 transcrição OpenAI `gpt-4o-mini-transcribe` (`audio-transcription.ts:11-27`)
- [x] U11 embeddings de indexação e de consulta (`knowledge/embedding-provider.ts`, `indexing.ts:10`, `retrieval.ts:129`)
- [x] U12 TypeSafe/Jev, 10 pontos de chamada: rerank do Cofre (`typesafe/rerank.ts`), verificação de suporte (`typesafe/verification.ts`), conferência de citações (`citations/review.ts:79`), interpretação da Agenda (`typesafe/agenda.ts:54`), rerank do acervo (`typesafe/research-rerank.ts:51`), avaliação de pertinência ao caso (`research/case-assessment.ts:162`), filtro da pesquisa web (`research/web-jurisprudence.ts:118`), triagem do Gmail (`google/gmail/triage.ts:88`), triagem de feedback (`feedback-triage.ts:110`), teste de conexão (`api/platform/typesafe/route.ts:27`)
- [x] U13 OCR com Tesseract local (`ocr-worker.ts`, `document-extraction.ts`); não é IA generativa
- [~] U13b OCR externo opcional `VAULT_OCR_URL` (`document-extraction.ts:57-82`); serviço por trás da URL não identificado

Scripts (não são produto, sem chamada executada nesta revisão):

- [x] `scripts/typesafe-eval.ts` (rag, documents, agenda)
- [x] `scripts/research-assessment-eval.ts` (chama o SDK direto, sem orçamento nem `typesafe_evaluation`)

## Áreas pedidas pela equipe

- [x] Chat com ferramentas, catálogo de ferramentas e aprovações (`agent-tools/index.ts`, `application/approvals-service.ts`, `application/agent-approvals.ts`, `google/operations.ts`, `google/policy.ts`)
- [x] Pesquisa jurídica (web, acervo, pertinência ao caso)
- [x] Extração e redação de documentos
- [x] Anexos
- [x] Cofre e busca (lexical, semântica, rerank)
- [x] Agenda (Jev na interface e WebMCP; escrita direta pelo chat)
- [x] Gmail (triagem Jev; envio sob política do escritório)
- [x] Drive, Calendar e Docs (sem IA própria; operações pelo agente)
- [x] Feedback (triagem Jev; piloto A/B encerrado, sem chamada em tempo de execução)
- [x] Notificações (sem IA)
- [x] Início / central de comando (sem IA; plano cita resumos futuros)
- [x] Títulos de conversa (truncamento, sem IA: `ai-store.ts:45-47`)
- [x] WebMCP (sem LLM no servidor)

## Dados e configuração

- [x] `ai_usage`: esquema (`db/postgres/0001_initial.sql:162-174`), gravação (`ai-runtime.ts:65-68`), lacunas (sem latência, raciocínio, cache, execução; embeddings e transcrição OpenAI não gravam; nenhum leitor no código)
- [x] `typesafe_evaluation`: esquema (`0001_initial.sql:1122-1140`, `0005_typesafe_platform.sql`), reserva de orçamento (`typesafe/client.ts:41-53`)
- [x] `ai_connection` por plataforma (`0022_platform_ai_connections.sql`), exclusividade de tarefa (`ai-connections-core.ts:104-108`)
- [x] `typesafe_platform_connection` e modos por finalidade (`typesafe/contracts.ts:5-14`)
- [x] O que a interface de administração permite configurar (`lume-model-settings.tsx:41-43`, `typesafe-settings.tsx`)
- [x] Modelos padrão no código (`ai-defaults.ts:12-27`, `typesafe/contracts.ts:7`, `audio-transcription.ts:17`)
- [x] `reasoningEffort: 'xhigh'` e suas consequências (`ai-providers.ts:7-9`, teste `tests/openai-effort.test.ts`, README `:156-157`)
- [~] Modelo efetivamente ativo: não verificado. O PostgreSQL local escuta em `127.0.0.1:55432`, mas recusou a conexão de leitura; nenhum segredo foi lido ou exibido
- [~] Volumes reais: indisponíveis; relatório usa fórmulas e cenários

## Fontes externas

- [x] Página do modelo GPT-6 Sol (consultada em 24/09/2026)
- [x] Página do modelo GPT-6 Luna (24/09/2026)
- [x] Página de preços da API OpenAI (24/09/2026)
- [x] Guia de raciocínio e guia de escolha de modelo (24/09/2026)
- [~] Post de lançamento em openai.com retornou HTTP 403; usado o anúncio no fórum oficial de desenvolvedores
- [~] Preço da ferramenta `web_search` para GPT-6 não confirmado
- [x] Preço do Jev: apenas o registrado em `docs/pesquisa-typesafe.md` (21/09/2026), não revalidado

## Divisão do trabalho e conferência

- [x] Quatro subagentes de leitura: (a) chat, ferramentas e aprovações; (b) documentos, anexos, OCR e citações; (c) pesquisa, TypeSafe e avaliações; (d) embeddings, Google, feedback, notificações, administração e migrações
- [x] Conferência pessoal das evidências usadas em recomendações: chat (rota completa), documentos (arquivo completo), anexos, pesquisa web, embeddings, cliente e configuração TypeSafe, triagem do Gmail, triagem de feedback, transcrição, modo sombra em rerank/Agenda/verificação/pertinência, instrução de anexos, política padrão do Google, publicação de `k5_gmail_send`, geração do índice na busca
- [~] Suspeita de que falhas de ferramenta chegam como `tool-error` e não como `tool-result` (afeta botões Confirmar): apontada por subagente, não reproduzida

## Revisão final

- [x] Procurar usos omitidos (nova busca por `evaluate(`, `createAgent`, `generateStructured`, endpoints externos)
- [x] Recomendação sem evidência: cada linha da matriz cita arquivo e linha
- [x] Contradições registradas: README diz que anexos não são gerados sem confirmação, mas a instrução do chat manda gerar logo após planejar; README diz que trocar o embedding reindexa o Cofre, mas o código não reindexa; `.env.example` e `docs/typesafe-implementacao.md` ainda descrevem TypeSafe por escritório
- [x] Fatos separados de hipóteses (seção 8 do relatório)
