# Achados de fonte e limites a validar

Snapshot 2026-10-06, commit `060160d`. Nenhum teste da aplicação executado nesta revisão.

## Correções do mapa

- Créditos iniciais: 500 para novos escritórios, preservando saldos anteriores; mensalidade continua 850. Fontes: [migração](../../../../apps/web/db/postgres/0068_email_verification_and_initial_credits.sql), [teste](../../../../apps/web/e2e/credits.e2e.ts). apps/web/README.md ainda informa o valor antigo e ficou fora do escopo da skill.
- office_member.role foi removido; vínculo único é distinto de platform_admin. Fonte: [migração](../../../../apps/web/db/postgres/0059_associate_access.sql).
- Cadastro/alteração de e-mail podem exigir confirmação; auth.setup prepara conta/aceite por API. Recuperação e2e intercepta respostas. Fontes: [auth-core](../../../../apps/web/src/lib/auth-core.ts), [setup](../../../../apps/web/e2e/auth.setup.e2e.ts), [recuperação](../../../../apps/web/e2e/password-recovery.e2e.ts).
- Upload usa seletor múltiplo, sem drag-and-drop. Node pode processar TXT após a resposta sem worker separado. Fontes: [vault-files](../../../../apps/web/src/components/vault-files.tsx), [vault](../../../../apps/web/src/lib/vault.ts).
- Dados de cliente do caso não são CRM; o caso oferece Tarefas e Agenda. Fonte: [vault-case-view](../../../../apps/web/src/components/vault-case-view.tsx).
- Vencimentos preservam o dia escolhido, limitado ao fim do mês. Fonte: [editor](../../../../apps/web/src/components/honorarios/editor.ts).
- Artefatos salvos no Cofre usam PDFcn/DOCX sem LibreOffice; exportação com timbrado e portal têm caminhos próprios. Fontes: [artifact-file](../../../../apps/web/src/lib/artifact-file.ts), [exportação](../../../../apps/web/src/app/api/artifacts/[id]/export/route.ts).

## Suspeita de produto para reproduzir

**Kanban e filtro de situação após a primeira página.** [agenda-workspace.tsx](../../../../apps/web/src/components/agenda-workspace.tsx) passa activityStatus na primeira consulta, mas não nas seguintes (linhas 168–176 no snapshot). Pode incluir tarefas fora do filtro com mais de 50 resultados. Criar conjunto sintético de múltiplas situações, aplicar filtro e comparar todas as páginas com consulta autorizada. O cenário existente de 53 cartões não seleciona esse filtro. Estado: suspeita estática, ainda não reproduzida. Não corrigida nesta tarefa.

## Componentes sem entrada montada localizada

- [NotificationSettings](../../../../apps/web/src/components/notification-settings.tsx): busca por uso/import em src encontrou apenas declaração. O [painel do sino](../../../../apps/web/src/components/notification-panel.tsx) está disponível, mas não comprova entrada para preferências/push. Não inventar caminho pelo Perfil.
- [JudicialInbox](../../../../apps/web/src/components/judicial-inbox.tsx): também sem montagem localizada. [Processos acompanhados](../../../../apps/web/src/components/judicial-case-links.tsx) existe no caso e mostra detalhes/quantidade de publicações; não substitui caixa de eventos e marcação de leitura.

Na execução, se a entrada continuar ausente, registrar blocked com tentativa/caminho e lacuna de produto. Teste direto da API não aprova um fluxo UI inexistente.

## Limites de cobertura

- workspace, chat-feedback, document-saving e vault-pagination usam simulações em percursos centrais. task-board tem complemento real task-board-persistence. Erro 503 simulado não invalida os outros passos reais: classificar por asserção.
- document-human-review, document-pdf, client-portal e conversation-artifacts preparam artefatos por seed; não provam geração por IA.
- cliproxyapi usa chat real por opt-in. Três turnos simultâneos, cancelamento/falha e runtime hospedado exigem prova própria.
- PWA em dev pode pular service worker; esse resultado não aprova offline.
- Calc abre sete modalidades, mas calcula principalmente Consumidor/Tributário no e2e; demais fórmulas e BCB precisam de prova.
- Tutorial confere mídia/atributos; observar reprodução real. Página administrativa tem gate, MP4 publicado é público.
- Asaas/AbacatePay, Google, WhatsApp, Ads e e-mail/push precisam de cenários de teste configurados. Recusa sem configuração só prova esse estado.
- Receitas sem Test têm roteiro manual: NO_TESTS é lacuna de automação, não prova de bug.

O JSON diferencia revisão de fonte de execução e mantém todos os itens pendentes. Testes de serviço ajudam a investigar, mas não substituem a prova da jornada do usuário.
