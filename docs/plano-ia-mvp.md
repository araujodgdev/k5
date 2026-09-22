# Plano de IA do MVP Lume

Status: primeira versão das cinco etapas implementada em `apps/web` (setembro de 2026). Pendências de validação:

- Testes com credenciais reais de providers, exportação conferida no Word com modelos reais do escritório e verificação manual de teclado, desktop e mobile.
- Decisões ainda abertas, listadas no fim deste documento: runner durável em produção, limites por escritório, serviços de OCR e armazenamento.

## Decisões confirmadas

- Prioridades: revisão documental e redação; due diligence em grande volume fica para depois.
- Entrada: PDF digital ou escaneado, DOCX, e-mails e planilhas. Considerar arquivos ou conjuntos com aproximadamente mil páginas.
- Vault com documentos organizados por caso e biblioteca reutilizável do escritório.
- O advogado seleciona os materiais usados pelo agente.
- Cronologia baseada nos documentos, com fontes, conflitos e lacunas explícitos.
- Redação seguindo estrutura, estilo e timbrado do modelo do escritório.
- Edição de conteúdo e estrutura no Lume; exportação DOCX e acabamento no Word. Não exigir fidelidade de paginação do Word no editor web.
- Não pesquisar legislação ou jurisprudência externa no MVP. Reutilizar citações fornecidas somente mediante seleção explícita do advogado, sem afirmar verificação externa.
- Chaves dos modelos administradas pelo Lume, com configuração de provider e credenciais por cliente (escritório).
- Painel privado para administradores da plataforma gerencia essas configurações.
- Avaliar UI compatível com Mastra, preservando ao máximo a identidade visual existente.

## Base existente

Next.js, React, TypeScript, shadcn/ui, Better Auth e SQLite local. Usuários pertencem a um escritório. Os papéis atuais são administrator, lawyer e reviewer, todos no contexto do escritório. Esta seção descreve o ponto de partida do plano; o estado atual está no status acima.

## Direção técnica proposta

Mastra para agentes, ferramentas e workflows. assistant-ui para a experiência de conversa, integrada ao Mastra através do adaptador AI SDK. A documentação apresenta essa combinação; assistant-ui é uma biblioteca independente, não uma biblioteca própria do Mastra.

Preservar shadcn/ui para navegação, formulários, tabelas e painel administrativo. Adaptar os componentes de conversa aos tokens do Lume. Não adotar o visual do Mastra Studio como interface do produto.

O backend do Lume permanece responsável por autorização, isolamento de escritórios, seleção de credenciais, arquivos, versões, referências e aprovações. Memória de agente e índices de busca não substituem o banco de negócio.

A resolução de modelos usa perfis de tarefa, como conversa, extração e redação. Cada perfil aponta para uma configuração autorizada do escritório. Trocar um provider suportado não deve exigir mudança no código da feature. Incluir um provider novo pode exigir um adaptador e validação de capacidades.

## Administração da plataforma

Rota proposta: `/platform/clients`, com detalhe `/platform/clients/[officeId]/ai`. Rotas administrativas separadas da navegação do escritório, disponíveis somente após autorização de plataforma no servidor.

Criar vínculo de administrador de plataforma separado de office_member. O papel administrator atual não concede acesso à plataforma. Proposta de provisionamento inicial: comando local/operacional que concede acesso a um usuário já existente, identificado explicitamente; nenhum cadastro público concede esse papel.

O painel lista escritórios e permite gerenciar conexões de IA por escritório:

- Criar conexão com nome, provider suportado, chave e modelos permitidos.
- Listar metadados e identificação mascarada, sem devolver a chave armazenada ao navegador.
- Editar nome, configuração, modelos, ativação e atribuições por tarefa.
- Substituir/rotacionar a chave sem revelar a anterior.
- Testar conexão usando uma requisição mínima sem documentos do cliente; esclarecer eventual consumo.
- Desativar conexão e excluir seu segredo, preservando metadados necessários à auditoria.
- Impedir exclusão de uma configuração em uso até desativar ou substituir suas atribuições.

Proposta inicial: uma conexão por escritório/provider, extensível a várias conexões nomeadas. A aplicação cadastra credenciais emitidas no provider; criar ou excluir a conexão no Lume não emite nem revoga automaticamente a chave no fornecedor.

Segredos criptografados em repouso com chave mestra separada do banco e do segredo do Better Auth, mantida no ambiente ou gerenciador de segredos. Definir versionamento para rotação da chave mestra. Não registrar segredos em logs, traces, mensagens do agente ou erros de SDK.

Toda operação administrativa verifica a sessão e o papel de plataforma. O officeId da URL só é aceito após essa autorização. Nas operações de negócio, escritório e usuário continuam derivados de requireWorkspace().

Resolver a credencial no servidor por escritório e tarefa, sem alterar variáveis globais de ambiente por requisição. Não usar fallback silencioso para outro cliente ou provider. Revalidar configuração em novas chamadas e retomadas de tarefas. Desativação não desfaz uma chamada já aceita pelo fornecedor.

Auditoria registra ator, escritório, operação, conexão e horário, sem o segredo. Logs de uso registram provider, modelo, tarefa, execução e tokens quando disponíveis; valores monetários são estimativas quando não houver faturamento confirmado.

## Refactor de UI

Usar assistant-ui inicialmente para mensagens, compositor, streaming, cancelamento e estados de erro. A persistência e as permissões das conversas pertencem ao Lume; uma biblioteca de UI não as fornece automaticamente.

Adicionar seleção de documentos, fontes, progresso e aprovações conforme os workflows entrarem. A seleção de citações registra o usuário, a fonte, sua versão e o escopo da aprovação. Aprovar um modelo de petição não aprova automaticamente todas as autoridades jurídicas nele contidas.

Preservar o DESIGN.md: neutros quentes, tinta preta, títulos serifados, uma superfície principal, compositor inferior, texto em pt-BR, estados em texto simples, navegação responsiva e movimento reduzido. Não importar badges decorativas, fundos coloridos e animação de texto dos exemplos das bibliotecas.

Editor documental é uma seleção técnica separada: assistant-ui não substitui edição de documentos nem geração fiel de DOCX.

## Documentos e workflows

Ingestão: upload, validação, extração/OCR, segmentação com referências estáveis, indexação e estado de processamento. Preservar arquivo original e versão. Referências usam página para PDFs, seção/parágrafo para Word, mensagem para e-mail e aba/célula para planilha.

Cronologia: percorrer sistematicamente todo o material selecionado, extrair eventos com evidências, consolidar datas e envolvidos, expor divergências e gerar documento. Busca por similaridade isolada não garante cobertura completa.

Redação: selecionar fatos e modelo, identificar citações candidatas, obter seleção explícita, produzir minuta, validar referências e pendências e gerar versão editável/DOCX. Separar fatos do caso, instruções e exemplos de estilo para evitar importar fatos de processos anteriores.

Instruções dentro dos documentos são conteúdo não confiável; não concedem ferramentas, acesso a arquivos ou autorização. Consultas e ferramentas sempre aplicam escritório, caso e permissões no servidor.

Não prometer ausência absoluta de alucinação. Exigir fontes para afirmações factuais, impedir autoridades jurídicas sem origem autorizada e testar com casos de citações inexistentes, datas conflitantes e referências ausentes. Validação de origem não comprova validade jurídica.

Tarefas longas precisam continuar sem a aba aberta, registrar cobertura do processamento e retomar falhas sem duplicar resultados. Definir runner durável, armazenamento e limites de concorrência antes da entrega de ingestão em escala. Não executar todo um documento longo dentro de uma única requisição de chat.

## Sequência de implementação

1. Fundação: Mastra, perfis de modelos, papel de plataforma, armazenamento seguro de credenciais e painel administrativo funcional.
2. Chat integrado: assistant-ui com visual Lume, streaming, histórico autorizado, tratamento de falhas e registro de uso.
3. Vault: casos, biblioteca, arquivos, processamento durável, extração/OCR, referências e busca autorizada.
4. Revisão: cronologia verificável, conflitos, lacunas, editor e exportação.
5. Redação: modelo do escritório, seleção de citações, validação e DOCX com timbrado.

## Critérios de aceite da primeira entrega

- Usuário sem sessão e administrador de escritório sem papel de plataforma não acessam painel nem endpoints administrativos.
- Revogar papel de plataforma retira o acesso em novas operações.
- CRUD de conexões funciona e nunca devolve o segredo armazenado em respostas de leitura.
- Segredos não aparecem em logs, traces, bundle do cliente ou auditoria.
- Duas requisições concorrentes de escritórios distintos usam suas respectivas credenciais sem contaminação.
- Configuração ausente, desativada ou inválida produz erro controlado; nenhuma chamada usa credencial de outro escritório.
- Troca entre dois providers suportados preserva a lógica da feature. Testes simulados validam roteamento; teste real exige credenciais provisionadas no ambiente.
- Chat cobre vazio, envio, streaming, conclusão, cancelamento, falha e nova tentativa, sem mensagens duplicadas.
- Verificar teclado, desktop e mobile contra DESIGN.md.
- Rodar lint, typecheck, testes e build conforme as instruções do repositório; ampliar cobertura de autorização e isolamento.

## Decisões técnicas ainda abertas

- Providers/modelos iniciais e limites de uso por escritório.
- Ambiente de implantação, runner durável e estratégia de banco para execução concorrente.
- Serviços de armazenamento, OCR e indexação, incluindo tratamento de dados pelos fornecedores.
- Editor e mecanismo de geração DOCX; fidelidade de templates validada com exemplos reais.
- Formatos específicos de e-mail e planilha, limites de tamanho e amostras para avaliar documentos longos.

## Referências

- [Design do Lume](../apps/web/DESIGN.md)
- [Autenticação e ambiente](../apps/web/README.md)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra e bibliotecas de UI](https://github.com/mastra-ai/ui-dojo)
- [Integração assistant-ui com Mastra](https://www.assistant-ui.com/docs/integrations/frameworks/mastra/overview)
- [Componentes assistant-ui](https://www.assistant-ui.com/elements)
