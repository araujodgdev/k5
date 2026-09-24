# Integração Google do Lume

## 1. Resultado e decisões

Implementar integração direta com Gmail, Google Calendar, Drive e Google Docs, usando a infraestrutura atual: TypeScript, Mastra, Cloudflare Workers, PostgreSQL/Hyperdrive, R2 e processadores Node.

A primeira versão terá:

- **Gmail:** caixa de entrada, leitura de conversas, composição, rascunhos, respostas e envio, pela interface e pelo agente.
- **Calendar:** sincronização bidirecional dos calendários escolhidos, com agenda pessoal privada e compartilhamento explícito de eventos com o escritório.
- **Drive:** seleção de arquivos, importação de cópias para casos do Cofre, renomeação, envio de novas versões e compartilhamento com pessoas identificadas.
- **Google Docs:** leitura e alteração de texto em documentos selecionados, pelo agente.
- **Autonomia:** ações durante pedidos da pessoa, conforme regras definidas exclusivamente pelo administrador do escritório.

Contatos e tarefas continuam no Lume. A sincronização de calendário funciona em segundo plano; não inicia ações proativas do agente.

**Padrões adotados:** uma conta Google ativa por integrante inicialmente; suporte a Gmail pessoal e Workspace; operações de escrita preservam os papéis atuais de administrador e advogado. O administrador configura regras, mas não recebe acesso às contas pessoais.

## 2. Fundação, autorização e execução

**Conexões Google**

- Separar a conexão Google do login Better Auth. Usar OAuth próprio, consentimento incremental e projetos separados para homologação e produção.
- Vincular cada conexão ao escritório, titular e identificador estável da conta Google. Validar propriedade em toda operação.
- Guardar refresh tokens cifrados, com rotação de chave; nunca expô-los ao navegador, agente ou logs. Coordenar renovações concorrentes.
- Permitir conectar, consultar permissões, reconectar e desconectar. Revogação, remoção do integrante ou perda de permissões interrompem novos trabalhos.
- Manter a autorização de sincronização independente da sessão de navegação. Logout encerra ações interativas; desconectar a integração encerra a sincronização.

Escopos iniciais por funcionalidade: `gmail.readonly` e `gmail.compose`; `calendar.calendarlist.readonly` e `calendar.events`; `drive.file` para arquivos selecionados e edição compatível no Docs. Solicitar apenas quando o módulo for ativado. [Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar](https://developers.google.com/workspace/calendar/api/auth), [Docs](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).

**Regras do escritório**

Cada ação terá três modos: **bloqueada**, **exige confirmação** ou **automática dentro dos limites**. Novas instalações começam com confirmação para escritas; o administrador habilita a autonomia.

Configurações separadas para enviar e-mail, enviar anexos, criar/reagendar/cancelar eventos, alterar documentos, substituir arquivos e conceder/remover acesso. Os limites configuráveis serão quantidade diária por integrante e ação, quantidade de destinatários e quantidade/tamanho de anexos quando aplicáveis.

Qualquer destinatário poderá ser usado, conforme sua escolha. Exceder um limite automático solicita aprovação da operação exata; aprovação não contorna bloqueios, permissões Google ou limites técnicos. Alterações de regras são versionadas e verificadas novamente antes da execução.

**Operações confiáveis**

Interface e agente usam os mesmos serviços e contratos Zod, passando pelo executor de capacidades existente.

Criar um registro durável antes de qualquer efeito externo, contendo titular, ação, argumentos, regra/aprovação utilizada e estado da execução. Diferenciar sucesso, falha, pendência e resultado desconhecido. Após timeout de envio, reconciliar o resultado antes de permitir repetição; não prometer execução exatamente uma vez.

Conteúdo de e-mails e documentos nunca concede autorização. Aprovações ficam vinculadas aos destinatários, conteúdo, anexos e versões efetivamente revisados.

## 3. Comportamento por módulo

**Gmail**

- Adicionar a seção E-mails, com lista paginada, busca, leitura de conversas, rascunhos e compositor com destinatários e anexos.
- Consultar mensagens sob demanda. Não criar uma réplica integral da caixa nem indexá-la automaticamente no conhecimento do escritório.
- Preservar encadeamento das respostas e identidade da conta remetente. Usar rascunhos do Gmail para composições persistidas.
- Importar anexos para o Cofre somente mediante escolha explícita de caso.
- Sanitizar HTML e impedir carregamento automático de recursos remotos nas mensagens.
- Manter mensagens e resultados do agente privados ao titular. Auditoria administrativa mostra ação, estado e consumo; conteúdo e destinatários ficam restritos ao titular.

**Agenda**

- Criar um modelo próprio de calendários e eventos pessoais, separado das atividades compartilhadas existentes. Unificar sua apresentação na Agenda, com filtros pessoal/escritório.
- Sincronizar criação, alterações e cancelamentos; preservar fusos IANA, eventos de dia inteiro, recorrência, exceções, participantes, respostas e links de reunião.
- Permitir criar e editar eventos regulares e recorrentes, distinguindo ocorrência, série inteira e ocorrência em diante.
- Respeitar as permissões reais do Google: calendários somente leitura permanecem somente leitura.
- Em concorrência, **os campos alterados no Lume prevalecem**: buscar a versão atual e reaplicar apenas esses campos, usando controle de versão. Preservar respostas de convidados e campos não editados. Exclusão remota ou perda de permissão gera pendência visível, sem recriação silenciosa.
- Compartilhar um evento cria uma projeção para o escritório, com campos revisados pelo titular. A edição do evento Google permanece exclusiva do titular.
- Revisar Início, notificações, ferramentas e sugestões para impedir vazamento de eventos privados.

Usar notificações Google, sincronização incremental, renovação de canais e reconciliação periódica. Tratar notificações duplicadas e reconstrução do espelho quando o cursor expirar. [Sincronização](https://developers.google.com/workspace/calendar/api/guides/sync), [controle de versões](https://developers.google.com/workspace/calendar/api/guides/version-resources).

**Drive, Docs e Cofre**

- Usar Google Picker. A pessoa escolhe o caso e os arquivos, com indicação clara de que as cópias seguirão as permissões do Cofre.
- Reutilizar armazenamento, extração, OCR e indexação existentes. Registrar conta de origem, ID do arquivo, versão disponível, data da importação e hash.
- Exportar Google Docs como DOCX, Sheets como XLSX e Slides como PDF para importação. Respeitar os formatos do Cofre, seu limite atual de 50 MB e limites menores do Google.
- Manter a cópia importada independente do original. Reimportação explícita cria nova versão; edição do original não atualiza silenciosamente a cópia.
- Editar textos de Google Docs com operações direcionadas e controle de revisão. Se o documento mudar durante a preparação, recalcular a alteração; exigir nova aprovação quando uma proposta aprovada mudar.
- Compartilhar somente com endereços identificados, como leitor, comentarista ou editor, respeitando capacidades do arquivo e regras do Workspace.
- Desconectar a conta interrompe acesso remoto; cópias incorporadas aos casos seguem a retenção do Cofre, informada no momento da importação.

## 4. Implementação e entrega

Executar em quatro etapas, todas integrantes desta versão:

1. **Fundação:** migrações aditivas para conexões, políticas, operações, referências externas e estado de sincronização; OAuth, criptografia, aprovações e tela de integrações.
2. **Agenda privada:** modelo de eventos, sincronização, recorrência, compartilhamento e adequação de notificações.
3. **Drive e Docs:** Picker, importação versionada, edição e permissões.
4. **Gmail e lançamento:** caixa de entrada, composição, ferramentas do agente e homologação completa.

Os contratos públicos terão referências opacas de conexão/recurso, paginação, versões e estados explícitos de operação. Escritório e titular sempre serão derivados no servidor. O agente não recebe tokens nem uma ferramenta genérica para chamar URLs arbitrárias.

Usar um Worker de integrações com Queue e Cron; PostgreSQL guarda trabalhos, versões e checkpoints. Filas transportam identificadores, sem conteúdo de mensagens. Importação e processamento pesado seguem para os processadores Node existentes.

A interface seguirá o DESIGN.md, em pt-BR, com navegação desktop/mobile consistente e estados de conexão expirada, sincronização pendente, falha e confirmação necessária.

A liberação será gradual por escritório e módulo. Produção depende de domínio verificado, consentimento e políticas publicados, verificação Google e avaliação de segurança aplicável ao Gmail. Validar também retenção das cópias, uso por modelos e contratos dos operadores conforme o fluxo implementado. [Requisitos OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [política de dados](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

## 5. Validação e critérios de aceite

- Isolamento entre escritórios e entre titulares do mesmo escritório, incluindo buscas, notificações, histórico e ferramentas.
- Regras automáticas, bloqueios, limites, alteração de política durante execução e invalidação de aprovações após mudança de argumentos.
- OAuth com consentimento parcial, renovação concorrente, revogação e reconexão.
- Envios com falha antes/depois da aceitação, resposta perdida e tentativa duplicada.
- Calendário com recorrência, exceções, dia inteiro, fusos, conflitos favoráveis ao Lume, exclusões e cursores expirados.
- Importação repetida, mudança de versão, arquivos incompatíveis, Shared Drives e permissões herdadas.
- Conteúdo adversarial em mensagens/documentos, HTML malicioso e tentativas de ampliar acesso.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`; testes reais em contas de homologação pessoais e Workspace, com dados sintéticos e verificação desktop/mobile.

O aceite exige completar os fluxos ponta a ponta, comprovar privacidade, mostrar pendências com precisão e demonstrar recuperação de falhas sem repetir efeitos externos inadvertidamente.
