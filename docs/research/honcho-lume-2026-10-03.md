# Honcho no Lume: pesquisa para integração

Pesquisa em 03/10/2026. Escopo: memória pessoal do agente, APIs v3, isolamento, operação, exclusão, custos e hospedagem. Este documento propõe uma integração futura. Nenhum pacote foi instalado, serviço ativado ou dado privado enviado ao Honcho.

## Parecer

Honcho pode acrescentar contexto pessoal entre conversas do Lume. Ele recebe mensagens, produz inferências em segundo plano e oferece consultas sobre o usuário. A implementação deve começar com dados sintéticos e memória opcional, mantendo o PostgreSQL atual como fonte do histórico. A arquitetura abaixo é uma proposta para o Lume, não uma garantia do fornecedor. [Arquitetura oficial](https://honcho.dev/docs/v3/documentation/core-concepts/architecture).

Há três pontos que precisam de solução antes de enviar dados reais: a política gerenciada permite fine-tuning não público com dados desidentificados; a exclusão de sessão deixa inferências derivadas; a API de ingestão consultada não oferece idempotência para reenvios. Os detalhes e as fontes estão nas seções de privacidade, exclusão e entrega.

A página enviada pelo usuário, [Agentic Development](https://honcho.dev/docs/v3/documentation/introduction/vibecoding), apresenta MCP, plugins, CLI e skills para ferramentas de desenvolvimento. A integração no produto usa o SDK/REST descrito no [quickstart](https://honcho.dev/docs/v3/documentation/introduction/quickstart). Instalar um plugin do editor não integra a memória ao chat web.

Honcho também recebe PDF, texto e JSON, mas preserva o texto extraído como mensagens, não o arquivo original. Portanto, não fornece a operação de salvar o anexo no Cofre do Lume. Esse fluxo continua pertencendo ao armazenamento e às permissões do produto. [File Uploads](https://honcho.dev/docs/v3/documentation/features/advanced/file-uploads).

Honcho também não comprova a existência, autenticidade ou vigência de uma fonte jurídica. Uma inferência sobre o usuário e uma lista de evidências lidas não substituem consultar a publicação original. Os termos alertam para saídas incorretas, e Evidence não garante que cada item lido fundamentou a resposta. [Termos, seção 7.4](https://app.honcho.dev/tos), [Evidence](https://honcho.dev/docs/v3/documentation/features/advanced/evidence). A correção de anexos, apresentação das ferramentas e Revisão está no [plano consolidado do agente](../plano-refinos-agente-memoria-e-revisao.md).

## Base local e versões verificadas

O Lume usa `workingMemory` do Mastra com escopo `resource` e identidade `officeId:userId`. `lastMessages` e `semanticRecall` estão desativados; o chat mantém o próprio histórico. O template cobre preferências de trabalho, atuação e pedidos para lembrar. As instruções proíbem guardar conteúdo de documentos, e-mails, páginas e resultados de ferramentas como memória pessoal. [Código local](../../apps/web/src/lib/agent-memory.ts).

A geração do chat inclui essa memória e fornece o recurso ao agente. A persistência tem migração própria em PostgreSQL. A integração proposta deve conservar essa identidade e os controles atuais de sessão. [Fluxo local](../../apps/web/src/lib/chat-turn.ts), [migração](../../apps/web/db/postgres/0023_agent_memory.sql), [regras do repositório](../../AGENTS.md).

O pacote publicado consultado é `@honcho-ai/sdk` 2.5.1. O código correspondente declara API `v3`, enquanto o servidor em `main` declara versão 3.2.2. A pesquisa de código foi fixada no commit `8e4df990d974c146a100e96ab4b3957a6591ceab`; isso não prova qual revisão está implantada no serviço gerenciado. [Registro do pacote](https://registry.npmjs.org/@honcho-ai/sdk/latest), [package.json do SDK](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/package.json), [versão da API](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/api-version.ts), [servidor](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/pyproject.toml).

A referência antiga `plastic-labs/honcho-node` redireciona para `honcho-node-core`. O SDK de alto nível atual está em `sdks/typescript` no repositório principal. Usar os nomes e assinaturas desse SDK evita misturar exemplos antigos com v3. [Repositório redirecionado](https://github.com/plastic-labs/honcho-node), [SDK atual](https://github.com/plastic-labs/honcho/tree/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript).

## Modelo e isolamento

| Entidade | Função |
| --- | --- |
| Workspace | Contém peers e sessões. É a fronteira de separação entre aplicações, ambientes ou tenants. |
| Peer | Identidade persistente de uma pessoa ou agente dentro do workspace. Acumula representação entre sessões. |
| Session | Conversa ou contexto delimitado, com um ou mais peers. |
| Message | Conteúdo atribuído a um peer, com metadata e data de criação. |

Essa hierarquia e a gravação seguida de processamento assíncrono constam na [arquitetura oficial](https://honcho.dev/docs/v3/documentation/core-concepts/architecture).

`observe_me` controla a formação da representação do remetente. `observe_others` cria representações direcionais do que um participante observou sobre outros. Para o Lume, configurar o usuário com `observeMe: true`, o assistente com `observeMe: false` e ambos com `observeOthers: false` é suficiente para a primeira versão. As mensagens do assistente ainda podem existir como contexto. Desabilitar observação não impede armazenamento. [Configuração](https://honcho.dev/docs/v3/documentation/features/advanced/reasoning-configuration), [representações direcionais](https://honcho.dev/docs/v3/documentation/features/advanced/directional-representations).

Scopes agrupam sessões e limitam consultas que os nomeiam. Uma consulta sem scope continua vendo os dados permitidos no workspace. Eles não são fronteiras de autorização. Um scope nomeado tem sua própria perspectiva, inclusive inferências; uma allowlist de sessões restringe o recall às conclusões explícitas. [Scopes](https://honcho.dev/docs/v3/documentation/features/advanced/scopes).

Para memória pessoal, recomendo inicialmente um workspace por ambiente + escritório + usuário, com IDs opacos derivados no servidor. Isso facilita apagar toda a memória de uma pessoa sem afetar colegas. A alternativa é workspace por escritório e peer por usuário, mas exige mais cuidado com consultas coletivas e exclusão seletiva. Essa escolha deve permanecer explícita; memória coletiva do escritório teria um workspace próprio e outro fluxo de autorização.

## SDK e integração com o agente

O SDK usa `Honcho` com `apiKey`, `baseURL` e `workspaceId`; o padrão sem workspace explícito é `default`. Todas as operações de rede precisam de `await`. `peer.message()` apenas monta o objeto local, e `session.addMessages()` envia o lote. [Quickstart](https://honcho.dev/docs/v3/documentation/introduction/quickstart), [cliente](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/client.ts), [peer](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/peer.ts).

| Necessidade | API TypeScript verificada |
| --- | --- |
| Obter/criar identidades | `honcho.peer(id, options)` |
| Obter/criar conversa | `honcho.session(id, options)` |
| Definir participantes | `session.addPeers(...)`, `session.setPeerConfiguration(...)` |
| Enviar mensagens | `peer.message(...)`, `session.addMessages(...)` |
| Recuperar memória | `peer.context(...)`, `session.context(...)` |
| Perguntar sobre a pessoa | `peer.chat(query, options)` |
| Inspecionar conteúdo | `session.messages(...)`, `peer.conclusions.list(...)` |
| Apagar | `session.delete()`, `honcho.deleteWorkspace(id)`, `peer.conclusions.delete(id)` |

As assinaturas estão no [cliente](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/client.ts), [session](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/session.ts), [peer](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/peer.ts) e [conclusions](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/conclusions.ts).

Não encontrei adaptador oficial para Mastra no índice de integrações consultado. Há receita para Vercel AI SDK que recupera contexto, chama o modelo e registra mensagens. O Lume pode aplicar esse ciclo por um adaptador próprio antes/depois da execução do agente, sem substituir `Memory` nesta etapa. [Índice oficial](https://honcho.dev/docs/llms.txt), [receita Vercel AI SDK](https://honcho.dev/docs/v3/guides/integrations/vercel-ai-sdk).

## Inferências, contexto e treino

O funcionamento descrito produz memória externa por inferência. Deriver extrai afirmações e deduções; Summarizer resume sessões; Dreamer consolida conclusões e atualiza peer cards; Dialectic consulta essa memória para responder perguntas. A documentação chama essa evolução de continual learning. Isso não significa fine-tuning dos pesos do modelo de chat a cada conversa. Essa distinção é uma leitura da arquitetura descrita. [Reasoning](https://honcho.dev/docs/v3/documentation/core-concepts/reasoning).

`session.context()` recupera resumo e mensagens recentes. Para incluir a representação entre conversas é preciso `peerTarget`; há orçamento `tokens`, filtros semânticos e limite de conclusões. O retorno separa `peerRepresentation` e `peerCard`. No Lume, recuperar apenas esses campos evita importar um segundo histórico parcial quando só eventos pessoais forem enviados ao Honcho. [Get Context](https://honcho.dev/docs/v3/documentation/features/get-context).

`peer.chat()` sintetiza resposta sobre um peer; `honcho.chat()` pode consultar todos os peers do workspace. O nível padrão é `low`, com opções `minimal`, `medium`, `high` e `max`. O endpoint faz raciocínio durante a consulta, portanto tem custo e latência próprios. A personalização do Lume deve consultar o peer autenticado, sem disponibilizar workspace chat ao usuário. [Chat Endpoint](https://honcho.dev/docs/v3/documentation/features/chat).

Respostas estruturadas aceitam Zod ou JSON Schema. Alguns limites, como `maxLength` e `pattern`, são sugestões para o modelo e não validações do servidor. Validar também no Lume e permitir resultado desconhecido/nulo. `includeEvidence` informa conclusões e referências de mensagens lidas pelo Dialectic; a lista pode conter informação lida e não utilizada na resposta. Ela ajuda auditoria, mas não prova a veracidade da inferência. [Structured Outputs](https://honcho.dev/docs/v3/documentation/features/advanced/structured-outputs), [Evidence](https://honcho.dev/docs/v3/documentation/features/advanced/evidence).

## Privacidade e dados de terceiros

A política gerenciada, datada de 24/04/2025, permite melhorias com fine-tuning não público de dados desidentificados. Ela exige opt-in para treinar modelos públicos, o que não é uma promessa geral de zero treino. Declara infraestrutura principal nos EUA, subprocessadores de inferência/armazenamento e backups de 90 dias. Não confirma residência no Brasil. Também descreve exportação por solicitação ao contato de privacidade. Confirmar contratualmente zero treino, subprocessadores, região e retenção antes de dados reais. [Política de privacidade](https://app.honcho.dev/privacy).

Os termos atribuem ao integrador o dever de informar usuários, obter os consentimentos necessários, configurar retenção e tratar pedidos de exclusão. A página consultada declara ausência de certificação SOC 2/HIPAA e não oferece SLA geral. Não assumir adequação automática ao sigilo profissional ou à legislação brasileira. [Termos, seções 5.3, 7 e 17](https://app.honcho.dev/tos).

Proposta para o piloto: transmitir apenas declarações pessoais aceitas, como "prefiro respostas curtas", "atuo em direito trabalhista" ou pedidos explícitos para lembrar. Não transmitir anexos, petições, decisões, nomes/dados de clientes, e-mails, resultados do Cofre/Pesquisa, tokens ou resultados de ferramentas. Um texto colado pelo usuário também pode pertencer a terceiro; a autoria do turno não torna o documento uma preferência pessoal.

A seleção deve ocorrer antes da outbox. Não basta um prompt pedindo ao Honcho para ignorar informação sensível depois do envio. No início, exigir eventos pessoais explícitos e categorias permitidas; não enviar o transcript inteiro para um extrator externo decidir o que guardar. Conteúdo recuperado deve ser marcado como contexto falível, sem poder para autorizar operações ou alterar regras de ferramentas.

## Consultar, exportar e apagar

Para uma exportação feita pelo Lume, percorrer todas as páginas de sessões/mensagens e conclusões, e incluir cards, metadata e a configuração relevante. Listagens têm paginação; `representation()` é uma seleção de memória, não uma exportação completa. Não identifiquei endpoint único de exportação no índice v3. [Get Messages](https://honcho.dev/docs/v3/api-reference/endpoint/messages/get-messages), [List Conclusions](https://honcho.dev/docs/v3/api-reference/endpoint/conclusions/list-conclusions), [Peer Card](https://honcho.dev/docs/v3/documentation/features/advanced/peer-card), [índice](https://honcho.dev/docs/llms.txt).

| Operação | Resultado documentado |
| --- | --- |
| Apagar sessão | `202`; inativa a sessão de imediato e remove mensagens/dados associados em segundo plano. |
| Apagar workspace | `202`; precisa não ter sessões ativas e remove seus recursos em segundo plano. |
| Apagar conclusão | `204`; remove uma conclusão individual. |
| Apagar peer ou mensagem individual | Não há operação suportada na documentação consultada. |

Fontes: [Delete Session](https://honcho.dev/docs/v3/api-reference/endpoint/sessions/delete-session), [Delete Workspace](https://honcho.dev/docs/v3/api-reference/endpoint/workspaces/delete-workspace), [Delete Conclusion](https://honcho.dev/docs/v3/api-reference/endpoint/conclusions/delete-conclusion), [Deleting Data](https://honcho.dev/docs/v3/documentation/features/advanced/deleting-data).

Excluir sessão elimina conclusões explícitas ligadas a ela, mas preserva conclusões derivadas que pertencem ao workspace e podem combinar várias sessões. Essas inferências continuam na representação. A documentação não oferece endpoint para confirmar o término da cascata; tarefas de exclusão não entram em `queueStatus`. O fluxo completo exige primeiro apagar as sessões, depois o workspace. [Deleting Data](https://honcho.dev/docs/v3/documentation/features/advanced/deleting-data).

A política antiga descreve hard-delete imediato por purge/workspace, enquanto a API atual documenta exclusão assíncrona. Não encontrei purge no índice v3. Essa divergência, o prazo dos backups e a confirmação de término precisam de resposta do fornecedor. [Política](https://app.honcho.dev/privacy), [API de workspace](https://honcho.dev/docs/v3/api-reference/endpoint/workspaces/delete-workspace).

Proposta para "esquecer tudo": bloquear leitura e novos envios locais imediatamente, cancelar eventos pendentes, invalidar cache e limpar a memória Mastra. Incrementar a geração da identidade, sem reutilizar o workspace antigo. Depois solicitar exclusão das sessões/workspace antigo e registrar separadamente "uso interrompido", "exclusão aceita" e "exclusão confirmada", esta última somente com evidência adequada. Não apresentar um `202` como eliminação comprovada.

Para esquecer apenas uma conversa/fato, a primeira versão pode reconstruir a memória em novo workspace usando somente os eventos aprovados restantes e retirar o anterior de uso. Apagar uma conclusão isolada não demonstra eliminação de cards, outras inferências ou backups. O custo e a confirmação remota dessa reconstrução precisam de teste antes de prometer exclusão seletiva.

## Processamento, fila e idempotência

Honcho processa memória em segundo plano. `queueStatus` acompanha representação, resumo e dream, mas não confirma exclusão ou conclusão vitalícia. A documentação recomenda observabilidade sem esperar a fila ficar vazia. [Queue Status](https://honcho.dev/docs/v3/documentation/features/advanced/queue-status).

O código consultado acumula 512 tokens por unidade antes do processamento, usa janela alvo de 1.024 tokens e permite liberar unidades antigas após 1.800 segundos; `FLUSH_ENABLED` pode antecipar o processamento. Esses são defaults do código, não SLO do gerenciado. A memória de um turno curto pode demorar a aparecer. [DeriverSettings](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/src/config.py).

O lote permite até 100 mensagens. `MessageCreate` não recebe ID externo da mensagem; o servidor gera um ID novo a cada criação. Não encontrei chave de idempotência na rota/schema consultados. Deduplicação de resultados de busca ou conclusões não equivale a deduplicação de ingestão. [Schema](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/src/schemas/api.py), [criação](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/src/crud/message.py), [rota](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/src/routers/messages.py).

Os defaults do código limitam uploads a 5 MiB e mensagens a 25.000 caracteres. A página File Uploads menciona 50.000 caracteres, divergindo do código consultado. Validar o limite da revisão implantada antes de importações; essa API não faz parte do piloto de memória pessoal proposto. [Limites no código](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/src/config.py), [File Uploads](https://honcho.dev/docs/v3/documentation/features/advanced/file-uploads).

O cliente HTTP tem timeout padrão de 60 segundos e duas tentativas extras. Ele repete erros de rede/timeout e certos HTTP, inclusive em POST. Para a escrita, configurar `maxRetries: 0` e fazer reconciliação controlada no worker. [Cliente HTTP](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/http/client.ts).

Proposta de entrega: gravar o evento e a outbox na mesma transação local que confirma a mensagem; usar ID único, sequência da conversa, versão da política e geração da memória. Um worker com lease processa cada conversa em ordem. Enviar `eventId` em metadata, guardar os IDs retornados e marcar entrega. Em resultado ambíguo, consultar mensagens e reconciliar pelo `eventId` antes de reenviar. Impedir escritores simultâneos para a mesma conversa.

Esse mecanismo reduz duplicação, mas não fornece exatamente uma entrega entre dois sistemas: uma consulta seguida de POST não é atômica. Manter um estado de resultado incerto, sem repetição cega, e exigir teste de falha após aceite remoto. Idempotência no fornecedor ou tolerância documentada a duplicações permanece uma decisão de produção.

## Custos e latência

Preços publicados na consulta, em dólares:

| Item | Preço |
| --- | --- |
| Ingestão com raciocínio | US$ 2 por milhão de tokens |
| `context()` | Recuperação ilimitada |
| Dreaming padrão | Incluído |
| Chat `minimal` | US$ 0,001 por consulta |
| Chat `low` | US$ 0,01 por consulta |
| Chat `medium` | US$ 0,05 por consulta |
| Chat `high` | US$ 0,10 por consulta |
| Chat `max` | US$ 0,50 por consulta |

O site anuncia aproximadamente 200 ms para contexto e classifica `high`/`max` como assíncronos. Isso não é uma medição do Lume nem uma garantia de prazo. Confirmar o contrato de execução dessas consultas antes de desenhar jobs em torno do rótulo comercial. [Preços e latência anunciados](https://honcho.dev/).

Exemplo de orçamento, calculado com esses preços: 1.000 pessoas com 10.000 tokens enviados/mês somam 10 milhões, ou US$ 20. Dez consultas `low` por pessoa somam US$ 100. Total de Honcho: US$ 120, sem impostos, câmbio, tokens extras no modelo do Lume ou infraestrutura. Não executar Dialectic em todo turno sem medir benefício.

O quickstart anuncia US$ 100 de créditos, enquanto a página AI Memory divide a oferta em US$ 20 iniciais e US$ 80 após adicionar pagamento. Confirmar no plano contratado e não contar créditos promocionais no custo recorrente. [Quickstart](https://honcho.dev/docs/v3/documentation/introduction/quickstart), [AI Memory](https://honcho.dev/ai-memory).

## Gerenciado, self-host e Cloudflare

O self-host usa API FastAPI e worker Deriver, com PostgreSQL/pgvector. O compose oficial também inclui Redis e MCP. O código consultado exige Python >= 3.13. O worker é necessário para gerar memória; apenas levantar a API não basta. A instalação local pode usar CLI + Docker ou código-fonte. [Self-hosting](https://honcho.dev/docs/v3/contributing/self-hosting), [pyproject.toml](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/pyproject.toml).

O guia usa modelos externos por padrão para geração e embeddings. Aceita endpoints compatíveis, incluindo Ollama/vLLM, desde que os modelos de geração suportem ferramentas. Self-host não elimina envio a provedores externos se esses defaults continuarem ativos. A autenticação vem desativada no exemplo e precisa ser configurada antes de exposição em produção. [Self-hosting](https://honcho.dev/docs/v3/contributing/self-hosting).

O servidor tem licença AGPL-3.0; o SDK TypeScript declara Apache-2.0. Avaliar as obrigações aplicáveis à implantação/modificações antes da opção self-host. Não concluir que o backend proprietário do Lume deve ser publicado apenas por usar a API. [Licença do servidor](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/LICENSE), [licença do SDK](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/package.json).

| Opção | Avaliação proposta para o Lume |
| --- | --- |
| Gerenciado | Menor operação. Depende de contrato de privacidade, transferência, retenção, exclusão e limites do plano. |
| Self-host em serviço/container próprio | Controla banco, filas e logs. Exige operação, backups, migrações, monitoramento e seleção dos modelos. |
| Self-host com modelos locais | Pode manter o processamento no ambiente escolhido. Exige capacidade de inferência e avaliação de qualidade/custo. |

Recomendação de sequência: usar o gerenciado somente com dados sintéticos até resolver contrato e exclusão. Avaliar self-host com imagem/revisão fixadas como opção para maior controle operacional, sem pressupor que ele resolve custo, qualidade, backups ou envio a provedores de modelo. A decisão ainda está aberta.

O SDK HTTP usa `fetch`/`AbortController`, e o construtor pode ler `process.env`. É plausível consumir a API no Worker do Lume com configuração explícita e `nodejs_compat`, mas esta pesquisa não executou esse build. A Cloudflare documenta suporte a `process.env` conforme flags/data de compatibilidade. Usar REST com `fetch` é uma alternativa se o bundle do SDK falhar. [Cliente Honcho](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/client.ts), [HTTP Honcho](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/sdks/typescript/src/http/client.ts), [Cloudflare process](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/).

A proposta hospeda o servidor Python/Deriver separadamente e faz chamadas HTTPS a partir do Lume. Não pressupõe portar toda a pilha Python/PostgreSQL para o runtime Workers. Manter secrets somente no servidor/bindings; nenhum cliente web recebe chave Honcho.

## Arquitetura mínima proposta

1. Um adaptador server-only recebe o usuário/escritório derivados de `requireWorkspace()`. IDs externos vêm de um mapeamento local por ambiente, escritório, usuário e geração. O navegador não escolhe workspace, peer ou sessão remota.
2. Cada conversa tem uma sessão Honcho. Criar os peers antes de escrever eventos. O workspace da memória pessoal contém o usuário e o assistente; observação de terceiros permanece desativada.
3. O PostgreSQL conserva conversas, eventos pessoais aceitos, configuração de privacidade, mapeamento remoto e outbox. Não migrar automaticamente o histórico existente.
4. Antes da resposta, recuperar contexto pessoal com limite de tokens e prazo curto, por exemplo 300 ms como meta inicial a medir. Selecionar representação/card, validar categorias e combinar com a working memory existente. Em indisponibilidade, timeout ou contexto vazio, responder normalmente com a memória atual.
5. Depois de persistir a mensagem, publicar somente os eventos pessoais aceitos pela política. O worker envia por outbox, com reconciliação de resultado incerto. A resposta ao usuário nunca espera a ingestão ou a fila de raciocínio.
6. Oferecer controles coerentes para ver, exportar e esquecer memória local/remota. Ao desabilitar memória, interromper novas leituras/envios imediatamente. Processar a eliminação remota como tarefa separada, sem afirmar conclusão sem evidência.
7. Ativar por feature flag para pessoas/escritórios do piloto. Telemetria registra prazo, quantidade de tokens, falhas, backlog, idade de eventos e resultado da exclusão, sem textos pessoais nos logs.

O estado da memória deve distinguir desativada, ativa e em exclusão, em vez de acumular flags que permitam ler enquanto apaga. A outbox deve distinguir pendente, em processamento, entregue, resultado incerto e descartada pela política. Os estados são proposta do Lume e ainda precisam de desenho das tabelas/migrações.

## Decisões e validação antes de implementar

- Escolher gerenciado ou self-host e confirmar região, subprocessadores, condições de treino e retenção. Não enviar dados jurídicos reais durante essa decisão.
- Confirmar limite de workspaces/keys e viabilidade de workspace por escritório+usuário, mais geração para reconstrução/exclusão.
- Obter resposta sobre confirmação de exclusão, backups, cards/conclusões derivados e eventual API purge. A documentação pública atual não fecha esse fluxo.
- Definir categorias pessoais permitidas, experiência para correção e esquecimento, prazo da outbox e orçamento por usuário/escritório.
- Confirmar ingestão idempotente ou aceitar explicitamente a limitação; testar perda de resposta após POST aceito e concorrência de workers.
- Avaliar pt-BR com preferências corrigidas, homônimos, citações de clientes, documentos colados, prompt injection e memória antiga. As inferências precisam respeitar a correção mais recente.
- Testar isolamento entre dois usuários do mesmo escritório, entre escritórios e entre staging/produção. Testar consultas sem scope para demonstrar que a proteção depende do workspace/servidor.
- Medir p50/p95 de contexto e tempo até nova memória aparecer, custo real e qualidade contra a working memory atual. Simular 429, 5xx, timeout, retomada, desativação e exclusão durante envio.
- Fazer build e smoke test no Worker/OpenNext real. Não declarar compatibilidade com Cloudflare apenas por usar TypeScript/fetch.

Validação desta pesquisa: fontes primárias públicas consultadas, versões confirmadas no código/pacote, 44 links externos com HTTP 200 e quatro referências locais de código/instruções existentes. O plano consolidado é produzido pela investigação principal. O arquivo não contém whitespace ao final das linhas. Nenhuma chamada autenticada ao Honcho foi feita. Não foram medidos latência, preço faturado, prazo de exclusão ou qualidade do serviço. Como a alteração é documental, lint/typecheck/test/build/e2e da aplicação não se aplicam.
