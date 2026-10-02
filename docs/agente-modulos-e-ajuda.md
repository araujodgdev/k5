# Operações do agente e ajuda da plataforma

## Diagnóstico de 28/09/2026

O trace `5ce55d6a-3854-4f4c-8710-73e1904d3db1`, de 28/09/2026 às 17:15 UTC, mostrou duas falhas encadeadas. Honorários já tinha sete operações implementadas, mas nenhuma estava publicada para o agente. Além disso, a camada de execução e o serviço recusavam essa superfície. O agente procurou parcelas na Agenda e tentou registrar a baixa nas observações de um cliente.

O cadastro consultado tinha vínculo antigo com um caso excluído. A atualização de observações revalidava todos os vínculos, mesmo sem alteração deles, e retornava “Registro não encontrado neste escritório”. A correção preserva vínculos históricos quando não foram editados e continua recusando um vínculo novo com caso excluído.

As quatro consultas à Agenda usaram filtros diferentes. O tracing repetia o mesmo rótulo, mas não eram quatro chamadas idênticas. A principal correção é oferecer e orientar as operações corretas de Honorários. Uma proteção adicional impede repetir a mesma leitura normalizada durante um turno; gravações permitem consultar novamente e estados de processamento continuam atualizáveis.

Nenhum dado financeiro do escritório usado no diagnóstico foi alterado. As baixas de verificação usam dados sintéticos em PostgreSQL local.

## Cobertura

O catálogo de capabilities é a fonte das operações e permissões. Cada chamada revalida sessão, vínculo e acesso ao recurso. O modelo não escolhe o usuário ou escritório em nome de quem atua.

| Área | Operações do agente |
| --- | --- |
| Cofre e Biblioteca | Consultar, criar e editar casos/pastas/documentos, versões, movimentação, exclusão e processamento conforme contratos existentes |
| Escritório | Clientes, tarefas, reuniões, arquivamento, estados e vínculos com casos |
| Associados, convites e participantes | Consultar, convidar, responder, cancelar, incluir participantes e remover acesso |
| Honorários | Consultar/opções, cadastrar parcelas, registrar recebimento, estornar e cancelar |
| Pesquisa | Acervo e web, histórico, coleta, perfis factuais, avaliações e referências dos casos |
| Documentos e Lume | Geração, revisão, versões, conversas, memória, regras, conhecimento e modelo Word |
| Mensagens | Contatos, conversas, leitura/envio, compartilhar versões de documentos e revogar compartilhamento |
| Notificações | Consultar, marcar lida, arquivar, preferências e acompanhamento de caso |
| Google conectado | Gmail, agenda, eventos compartilhados, arquivos autorizados do Drive e Docs; inclui excluir rascunho e descartar alteração pendente |
| WhatsApp habilitado | Consultar caixa e conversa e enviar com confirmação |
| Ajuda | Consultar o manual público versionado com fontes |

Integrações e Plano não recebem ferramentas administrativas. Configuração OAuth, seleção inicial de arquivos pelo Google Picker, credenciais, cobrança da assinatura e administração global permanecem nas interfaces próprias. O agente usa serviços já conectados com as permissões existentes.

Operar um módulo não cria operações que o produto não oferece: mensagens enviadas não são editáveis/excluíveis; honorários preservam histórico com estorno/cancelamento; clientes são arquivados e tarefas usam seus estados. O agente descreve esses limites e usa a operação disponível.

O chat começa com ferramentas de consulta de entrada e `k5_tools_select_modules`. Esta última disponibiliza as ferramentas completas de até três módulos para os próximos passos. A seleção pode mudar durante o turno e nunca amplia as permissões. Isso mantém cada chamada abaixo do limite de ferramentas do provedor sem remover módulos do alcance do agente.

## Confirmações

Consultas e gravações comuns expressamente pedidas podem ocorrer diretamente. Exclusões já protegidas, estornos/cancelamentos, mensagens, compartilhamentos, convites, alterações de acesso e de configuração do assistente passam por propostas armazenadas no servidor. A confirmação fica vinculada à pessoa, escritório e argumentos completos, expira e não pode autorizar outra ação. Google conserva adicionalmente sua política de operações.

Os endpoints `/api/capabilities/[name]` só aceitam operações publicadas para WebMCP e sempre executam como essa superfície, inclusive sem cabeçalho do cliente. Assim, remover o cabeçalho não contorna confirmações. Os adaptadores tradicionais da interface conservam seus contratos.

## Manual e RAG

Fonte editorial: [Manual do Lume](manual-lume.md). O gerador produz `apps/web/src/lib/platform-help/content.json` e `apps/web/public/manual-lume.md`. O conteúdo é público e separado dos documentos dos escritórios.

```sh
pnpm --filter @k5/web help:generate
pnpm --filter @k5/web help:check
pnpm --filter @k5/web help:publish
```

A publicação usa `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` e, opcionalmente, `LUME_HELP_INDEX`. O token precisa executar Workers AI e escrever no índice Vectorize. Não salve credenciais no manual. O índice deve existir com 1024 dimensões e similaridade cosine. O publicador verifica a configuração, envia lotes e espera os IDs ficarem visíveis.

No Worker, os bindings `LUME_HELP_AI` e `LUME_HELP` executam embeddings e consulta. O modelo é `@cf/baai/bge-m3`. O namespace é o hash da versão do documento. A busca só devolve seções presentes na mesma versão local; IDs desconhecidos não viram conteúdo. Sem bindings ou em falha/timeout, a busca textual mantém a ajuda disponível. Publicar o índice não publica o aplicativo: os bindings e a ferramenta entram em uso no ambiente após o deploy dessa revisão.

Publicação verificada em 28/09/2026: índice `k5-platform-help-staging`, versão `d1a0c475a939bc2020a9`, 29 seções visíveis. Última mutação processada: `c7d62972-6289-4a88-8e2f-9fa1ca061bc8`. As consultas semânticas reais retornaram como primeiro resultado:

| Consulta | Seção |
| --- | --- |
| Como dar baixa na segunda parcela de honorários? | Registrar um recebimento de honorários |
| Como convidar um advogado para ser associado? | Associados, convites e participantes |
| Você pode alterar meu plano ou minhas integrações? | Integrações e Plano |
| Como apagar sua memória? | Fontes, memória e conhecimento do assistente |

## Verificação

`tests/honorarios.test.ts` reproduz a segunda parcela e testa confirmação financeira; `tests/agenda.test.ts` reproduz o vínculo excluído. `tests/agent-module-access.test.ts` verifica a seleção no streaming real do Mastra com modelo determinístico, fallback de ajuda, isolamento de mensagens/preferências, configurações e repetição de consultas. Os testes usam PostgreSQL real e não enviam mensagens externas.

`apps/web/e2e/agent-approvals.e2e.ts` cria um escritório sintético e verifica a API autenticada, confirmação por teclado, persistência após recarregar e cancelamento no celular. Roda no CI com o restante da [suíte e2e](../apps/web/README.md#testes-end-to-end).

Resultado desta revisão: `pnpm test` passou com 610 testes; após ampliar a cobertura de colaboração, a suíte focada `agent-module-access.test.ts` passou com 7 testes. `pnpm typecheck`, `pnpm db:setup`, `pnpm build`, `help:check` e a verificação no navegador passaram. `pnpm lint` terminou sem erros, com o aviso preexistente de `_bytes` não utilizado em `src/lib/judicial/connectors/transport.ts:416`. O build preservou os avisos existentes de tracing de armazenamento e registrou um aviso do cache do Turbo no Windows; a compilação concluiu. O deploy do aplicativo é uma etapa separada da publicação dos embeddings.
