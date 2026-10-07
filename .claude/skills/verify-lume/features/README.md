# Mapa de verificação do Lume

Leia [a skill](../SKILL.md), a receita correspondente e [o grafo/roteiro completo](../coverage/README.md).

## Condições básicas

- Usar instância isolada desta execução e doctor aprovado; nunca servidor/banco do desenvolvedor.
- Conta de verificação é dona do escritório pessoal; office_member.role não existe. A sessão e2e chamada admin não concede platform_admin.
- Usar nomes únicos e contas separadas para credenciais/logout. Passos anteriores podem ter criado dados.
- O harness não habilita integrações nem workers separados. Node pode processar TXT inline; demais processadores dependem do cenário/runtime.

## Convenções de prova

drive executa todos os arquivos Test da receita. Teste presente não é teste executado; um arquivo verde não aprova todos os itens. Sem Test, o CLI retorna NO_TESTS: dirigir o roteiro manual ou escrever teste em tarefa própria.

Capturar ação/resultado, persistência por recarga/leitura autenticada, isolamento, teclado e 390px. Bloqueio exige entrada tentada e pré-requisito concreto. Preservar artefatos antes de repetir drive, que limpa a pasta da feature.

## Contrato de receita

Cada arquivo tem H1, introdução e quatro H2: Sub-features; How to get to it (user POV); Driving it with e2e; Gotchas. Linhas Test apontam a arquivos reais. Auxiliares ficam em coverage/, pois todo features/*.md salvo README vira receita no CLI.

## Funcionalidades

### Acesso

- [Site público e SEO](./public-site.md) — `public-site`; 8 itens; testes existentes, cobertura parcial a conferir.
- [Cadastro, login e recuperação](./authentication.md) — `authentication`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Aceite de termos e aviso de IA](./legal-acceptance.md) — `legal-acceptance`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Navegação, marca e temas](./brand-shell.md) — `brand-shell`; 9 itens; testes existentes, cobertura parcial a conferir.
- [Perfil e credenciais pessoais](./profile.md) — `profile`; 8 itens; testes existentes, cobertura parcial a conferir.
- [Exportação e exclusão de conta](./office-data.md) — `office-data`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Tour e biblioteca de vídeos](./tutorials.md) — `tutorials`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Instalação e funcionamento offline](./pwa.md) — `pwa`; 4 itens; testes existentes, cobertura parcial a conferir.

### Escritório

- [Clientes e ficha cadastral](./office-clients.md) — `office-clients`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Tarefas em lista](./office-tasks.md) — `office-tasks`; 8 itens; testes existentes, cobertura parcial a conferir.
- [Quadro Kanban](./task-board.md) — `task-board`; 14 itens; testes existentes, cobertura parcial a conferir.
- [Página da tarefa](./task-details.md) — `task-details`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Atividade do escritório](./office-activity.md) — `office-activity`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Início e ações rápidas](./command-center.md) — `command-center`; 4 itens; testes existentes, cobertura parcial a conferir.
- [Agenda interna e reuniões](./office-calendar.md) — `office-calendar`; 4 itens; testes existentes, cobertura parcial a conferir.

### Cofre

- [Casos do Cofre](./vault-cases.md) — `vault-cases`; 7 itens; testes existentes, cobertura parcial a conferir.
- [Envio e download de arquivos](./vault-upload.md) — `vault-upload`; 6 itens; testes existentes, cobertura parcial a conferir.
- [Paginação e seletores do Cofre](./vault-pagination.md) — `vault-pagination`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Associados, convites e pastas](./collaboration.md) — `collaboration`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Biblioteca, documentos e versões](./vault-library.md) — `vault-library`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [Separação de anexos de PDF](./vault-annexes.md) — `vault-annexes`; 4 itens; roteiro manual, sem e2e dedicado mapeado.

### Lume e documentos

- [Abas e controles do Lume](./workspace-tabs.md) - `workspace-tabs`; persistent navigation and centered desktop/mobile dialogs.

- [Artefatos e cópias no Cofre](./conversation-artifacts.md) — `conversation-artifacts`; 9 itens; testes existentes, cobertura parcial a conferir.
- [Provedor de IA e chat real](./cliproxyapi.md) — `cliproxyapi`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Conversas, anexos e voz](./agent-chat.md) — `agent-chat`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Personalizar Lume](./agent-settings.md) — `agent-settings`; 4 itens; testes existentes, cobertura parcial a conferir.
- [Confirmações de ações do agente](./agent-approvals.md) — `agent-approvals`; 4 itens; testes existentes, cobertura parcial a conferir.
- [Citações e confirmações no chat](./chat-feedback.md) — `chat-feedback`; 4 itens; testes existentes, cobertura parcial a conferir.
- [Editor, salvamento e versões](./document-saving.md) — `document-saving`; 6 itens; testes existentes, cobertura parcial a conferir.
- [Revisão humana de documentos](./document-human-review.md) — `document-human-review`; 4 itens; testes existentes, cobertura parcial a conferir.
- [Exportação PDF e DOCX](./document-pdf.md) — `document-pdf`; 5 itens; testes existentes, cobertura parcial a conferir.

### Financeiro

- [Plano, saldo e créditos](./credits.md) — `credits`; 6 itens; testes existentes, cobertura parcial a conferir.
- [Honorários, parcelas e recebimentos](./honorarios.md) — `honorarios`; 10 itens; testes existentes, cobertura parcial a conferir.
- [Conexão e cobranças Asaas](./asaas.md) — `asaas`; 5 itens; testes existentes, cobertura parcial a conferir.
- [Cálculos e propostas de honorários](./calc.md) — `calc`; 11 itens; testes existentes, cobertura parcial a conferir.
- [Plano e checkout](./billing-subscription.md) — `billing-subscription`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Cobrança manual e PDF](./honorario-charge.md) — `honorario-charge`; 5 itens; testes existentes, cobertura parcial a conferir.

### Portal

- [Portal do cliente](./client-portal.md) — `client-portal`; 11 itens; testes existentes, cobertura parcial a conferir.

### Pesquisa

- [Pesquisa de marcas](./research-trademarks.md) — `research-trademarks`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Pesquisa e leitura de julgados](./research-jurisprudence.md) — `research-jurisprudence`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Referências, avaliações e minutas](./research-casework.md) — `research-casework`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [Processos, publicações e alertas](./judicial-monitoring.md) — `judicial-monitoring`; 5 itens; roteiro manual, sem e2e dedicado mapeado.

### Integrações

- [Conexão Google e permissões](./google-integration.md) — `google-integration`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Agenda pessoal Google](./google-calendar.md) — `google-calendar`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Gmail, rascunhos e anexos](./google-mail.md) — `google-mail`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [Google Drive e Docs](./google-drive-docs.md) — `google-drive-docs`; 4 itens; roteiro manual, sem e2e dedicado mapeado.
- [Conexão ChatGPT Ads BETA](./ads.md) — `ads`; 5 itens; roteiro manual, sem e2e dedicado mapeado.

### Comunicação

- [Mensagens e compartilhamentos](./messages.md) — `messages`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [WhatsApp Business](./whatsapp.md) — `whatsapp`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [Notificações, lembretes e push](./notifications.md) — `notifications`; 5 itens; roteiro manual, sem e2e dedicado mapeado.
- [Relatos e sugestões](./feedback.md) — `feedback`; 4 itens; roteiro manual, sem e2e dedicado mapeado.

### Administração

- [Administração da plataforma](./platform-admin.md) — `platform-admin`; 7 itens; testes existentes, cobertura parcial a conferir.

## Estado da revisão

51 receitas, 302 itens, 34 arquivos e2e referenciados (incluindo auth.setup). Todos os arquivos e2e encontrados têm vínculo a pelo menos uma receita; isso não significa cobertura integral das funcionalidades. Nenhuma validação ao vivo executada em 2026-10-06. Consulte [achados](../coverage/findings.md) e [prompt de execução](../coverage/validation-prompt.md).
