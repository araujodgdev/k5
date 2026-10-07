### 🔴 e2e: 6 failed, 1 flaky, 99 passed, 2 skipped
7 agent steps · 4 replayed from cache · 5 model calls · 19.3k tokens (48% cached)

**🔴 citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 1280px**  
`e2e/chat-feedback.e2e.ts:54`

**ASSERTION_FAILED** at step 8 of 8: `expect.toHaveCount getByRole("group", name: "Confirmação")`, after 10.0s

- Expected: count 2
- Observed: count 0 (0 matches)
- Failed the same way on both attempts: **ASSERTION_FAILED** at step 8.
- Screen: `/app/command-center`

Evidence: screenshot `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_chat-feedback.e2e.ts-cita__es_e_duas_aprova__es_independentes_continuam_vis_veis_depois_de_remontar_o_chat_-d949fd58-24e183a2.md`

**🔴 citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 390px**  
`e2e/chat-feedback.e2e.ts:54`

**ASSERTION_FAILED** at step 8 of 8: `expect.toHaveCount getByRole("group", name: "Confirmação")`, after 10.0s

- Expected: count 2
- Observed: count 0 (0 matches)
- Failed the same way on both attempts: **ASSERTION_FAILED** at step 8.
- Screen: `/app/command-center`

Evidence: screenshot `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_chat-feedback.e2e.ts-cita__es_e_duas_aprova__es_independentes_continuam_vis_veis_depois_de_remontar_o_chat_-2cc7352e-943e467c.md`

**🔴 seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px**  
`e2e/support/accounts.ts:50`

**ERROR**

> PUT /api/platform/ai/assignments: HTTP 400 {"error":"Escolha um modelo disponível antes de definir o esforço."}

- Failed the same way on both attempts: **ERROR**.
- Screen: `/app/admin/ai`

Evidence: screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/002-failure.png`, screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/001-proxy-selection-1280.png`, trace `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_cliproxyapi.e2e.ts-sele__o_do_CLIProxyAPI-administra_CLIProxyAPI_e_escolhe_uma_tarefa_pelo_teclado_em_1280p-94070fc5-d2b73c3f.md`

**🔴 a página inicial funciona pelo teclado e nos dois temas em 390px**  
`e2e/public-site.e2e.ts:55`

**LOCATOR_NOT_FOUND** at step 8 of 8: `locator.tap getByRole("button", name: "Usar tema claro")`, after 30.0s

> locator matched no nodes within getByRole("button", name: "Usar tema claro")

- Asked for: button "Usar tema claro"
- Waited: 30.0s
- Failed the same way on both attempts: **LOCATOR_NOT_FOUND** at step 8.
- Screen: `/#conteudo`
- Closest to the locator: `#n8 button "Usar tema escuro"`

Evidence: screenshot `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_public-site.e2e.ts-a_p_gina_inicial_funciona_pelo_teclado_e_nos_dois_temas_em_390px-1d9d7fff-134d8fc9.md`

**🔴 a página inicial funciona pelo teclado e nos dois temas em 1440px**  
`e2e/public-site.e2e.ts:55`

**LOCATOR_NOT_FOUND** at step 8 of 8: `locator.tap getByRole("button", name: "Usar tema claro")`, after 30.1s

> locator matched no nodes within getByRole("button", name: "Usar tema claro")

- Asked for: button "Usar tema claro"
- Waited: 30.1s
- Failed the same way on both attempts: **LOCATOR_NOT_FOUND** at step 8.
- Screen: `/#conteudo`
- Closest to the locator: `#n13 button "Usar tema escuro"`

Evidence: screenshot `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_public-site.e2e.ts-a_p_gina_inicial_funciona_pelo_teclado_e_nos_dois_temas_em_1440px-4f4aa34b-8d9fcfb2.md`

**🔴 o quadro de tarefas mostra 53 tarefas, move pelo teclado, delega ao Lume e se recupera de vazio e erro**  
`e2e/task-board.e2e.ts:130`

**ASSERTION_FAILED** at step 35 of 35: `browser.waitForURL /\/app\/agents\?conversationId=board-session$/`, after 1m 0s

> expect.toHaveURL failed expected: URL /\\/app\\/agents\\?conversationId=board-session$/ observed: URL `http://localhost:3000/app/command-center`

- Failed on both attempts: **ASSERTION_FAILED** at step 34, then at step 35.
- Screen: `/app/command-center`

Evidence: screenshot `.e2e/artifacts/web/e2e_task-board.e2e.ts__o_20quadro_20de_20tarefas_20mostra_2053_20tarefas_2C_20move_20pelo_20teclado_2C_20delega-fc1a971e/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_task-board.e2e.ts__o_20quadro_20de_20tarefas_20mostra_2053_20tarefas_2C_20move_20pelo_20teclado_2C_20delega-fc1a971e/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_task-board.e2e.ts__o_20quadro_20de_20tarefas_20mostra_2053_20tarefas_2C_20move_20pelo_20teclado_2C_20delega-fc1a971e/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_task-board.e2e.ts-o_quadro_de_tarefas_mostra_53_tarefas__move_pelo_teclado__delega_ao_Lume_e_se_recupera_de-104641ee-c58189ba.md`

<details>
<summary>⚠️ 1 flaky test passed on a retry</summary>

**⚠️ administrador entra pelo formulário**  
`e2e/support/accounts.ts:59`

**ERROR**

> Não foi possível entrar nem cadastrar `admin@advocacia.test:` HTTP 401 / 422 {"message":"Failed to create user","code":"FAILED_TO_CREATE_USER"}

Details: `.e2e/failures/e2e_auth.setup.e2e.ts-administrador_entra_pelo_formul_rio-b7d1a32b-fdd79172.md`
</details>

<details>
<summary>All 108 tests in 45 files</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🔴 | **e2e/chat-feedback.e2e.ts** · 2 failed |  | 25.2s |
| 🔴 | citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 1280px |  | 12.9s |
| 🔴 | citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 390px |  | 12.3s |
| 🔴 | **e2e/cliproxyapi.e2e.ts** · 1 failed, 2 skipped |  | 39.1s |
| 🔴 | seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px |  | 39.1s |
| ⏭️ | seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 390px (skipped: member 0 failed in this group attempt) |  |  |
| ⏭️ | novo usuário conversa pelo proxy, recarrega o histórico e mantém isolamento (skipped: Requer K5_E2E_REAL_AI=1 e uma chave de teste do CLIProxyAPI.) |  |  |
| 🔴 | **e2e/public-site.e2e.ts** · 2 failed, 1 passed |  | 1m 10s |
| 🟢 | o site público entrega SEO no HTML do servidor e mantém as áreas privadas fora do índice |  | 216ms |
| 🔴 | a página inicial funciona pelo teclado e nos dois temas em 390px |  | 33.0s |
| 🔴 | a página inicial funciona pelo teclado e nos dois temas em 1440px |  | 36.9s |
| 🔴 | **e2e/task-board.e2e.ts** · 1 failed, 5 passed |  | 1m 11s |
| 🔴 | o quadro de tarefas mostra 53 tarefas, move pelo teclado, delega ao Lume e se recupera de vazio e erro |  | 1m 3s |
| 🟢 | arrastar com o mouse move a tarefa de coluna; fora do quadro, na mesma coluna e com Esc nada muda |  | 2.1s |
| 🟢 | a tarefa troca de coluna antes da resposta e cada cartão salva sozinho |  | 892ms |
| 🟢 | uma falha devolve só aquele cartão e a nova tentativa usa a versão atual |  | 2.2s |
| 🟢 | movimentos seguidos usam a versão devolvida e o teclado anda coluna a coluna |  | 1.4s |
| 🟢 | no celular o arrasto fica no quadro e o teclado leva a tarefa de coluna em coluna |  | 1.6s |
| ⚠️ | **e2e/auth.setup.e2e.ts** · 1 flaky |  | 3.9s |
| ⚠️ | administrador entra pelo formulário (1 failed attempt first) |  | 3.9s |
| 🟢 | **e2e/agent-approvals.e2e.ts** · 1 passed |  | 7.6s |
| 🟢 | ações financeiras do agente esperam confirmação no chat, e o agente consulta a ajuda sem acessar Integrações |  | 7.6s |
| 🟢 | **e2e/agent-settings.e2e.ts** · 1 passed |  | 7.4s |
| 🟢 | personalização do Lume reúne legados e novos itens em uma lista no desktop e celular |  | 7.4s |
| 🟢 | **e2e/agent/office-clients.e2e.ts** · 1 passed | 4 steps · 1 call | 12.4s |
| 🟢 | o agente cadastra um cliente, abre a ficha e corrige o nome | 4 steps · 1 call | 12.4s |
| 🟢 | **e2e/agent/vault-cases.e2e.ts** · 1 passed | 3 steps · 4 calls | 29.0s |
| 🟢 | o agente cria um caso no Cofre com dados do cliente e abre a página do caso | 3 steps · 4 calls | 29.0s |
| 🟢 | **e2e/annex-plan.e2e.ts** · 1 passed |  | 8.9s |
| 🟢 | plano persistido: revisão editada mantém vínculo, teclado e geração real em desktop e 390px |  | 8.9s |
| 🟢 | **e2e/app-shell.e2e.ts** · 1 passed |  | 3.4s |
| 🟢 | o shell mantém a marca Lume e todos os destinos no desktop e no celular |  | 3.4s |
| 🟢 | **e2e/asaas.e2e.ts** · 1 passed |  | 3.1s |
| 🟢 | o Asaas aparece em Integrações, recusa uma chave inválida e orienta a cobrança da parcela |  | 3.1s |
| 🟢 | **e2e/calc.e2e.ts** · 1 passed |  | 10.1s |
| 🟢 | Calc: consumidor, versões, tributo federal, proposta OAB e parcelas no desktop e celular |  | 10.1s |
| 🟢 | **e2e/case-collaboration.e2e.ts** · 1 passed |  | 19.9s |
| 🟢 | caso compartilhado: tarefas reais, conflito preservado, honorários, atividade e política no celular |  | 19.9s |
| 🟢 | **e2e/case-pages.e2e.ts** · 3 passed |  | 21.3s |
| 🟢 | páginas: criar no caso, editar, recarregar, restaurar e usar o canvas móvel |  | 10.2s |
| 🟢 | publicação: revisar uma cópia exata, manter o original particular e colaborar com conflito e revogação |  | 7.3s |
| 🟢 | contrato frontend: página enviada fica congelada e resultado tardio não toma o outro editor |  | 3.8s |
| 🟢 | **e2e/client-portal.e2e.ts** · 1 passed |  | 8.8s |
| 🟢 | o portal do cliente: convite, conta sem escritório, PDF e cobrança publicados, comprovante e revogação |  | 8.8s |
| 🟢 | **e2e/collaboration.e2e.ts** · 2 passed |  | 24.1s |
| 🟢 | associados e pastas: convite, colaboração e revogação no desktop |  | 12.8s |
| 🟢 | associados e pastas: convite, colaboração e revogação no celular |  | 11.3s |
| 🟢 | **e2e/conversation-artifacts.e2e.ts** · 1 passed |  | 3.6s |
| 🟢 | Artefatos lista o que a conversa criou e recebeu e salva no Cofre pela interface |  | 3.6s |
| 🟢 | **e2e/credits.e2e.ts** · 1 passed |  | 2.0s |
| 🟢 | um escritório novo vê os créditos iniciais e o extrato no Plano, no desktop e no celular |  | 2.0s |
| 🟢 | **e2e/document-human-review.e2e.ts** · 1 passed |  | 5.4s |
| 🟢 | decisão humana persiste, permite correção e pede nova revisão quando o texto muda |  | 5.4s |
| 🟢 | **e2e/document-pdf.e2e.ts** · 1 passed |  | 3.0s |
| 🟢 | exportar PDF baixa o texto salvo, recusa versão antiga e sessão ausente, e mostra a falha de conversão |  | 3.0s |
| 🟢 | **e2e/document-saving.e2e.ts** · 12 passed |  | 31.2s |
| 🟢 | salvamento de documentos › esconder a aba salva uma vez e deixa as edições seguintes salváveis |  | 3.3s |
| 🟢 | salvamento de documentos › salvar explicitamente grava uma versão mesmo depois do salvamento automático |  | 3.0s |
| 🟢 | salvamento de documentos › restaurar para quando salvar o texto atual falha |  | 2.6s |
| 🟢 | salvamento de documentos › documentos grandes terminam de salvar antes de o painel fechar |  | 1.4s |
| 🟢 | salvamento de documentos › uma revisão do Lume preserva o texto local depois de uma falha ao salvar |  | 3.0s |
| 🟢 | salvamento de documentos › uma revisão do Lume preserva o texto local depois de um conflito ao salvar |  | 3.2s |
| 🟢 | salvamento de documentos › no celular o chat oculto é inerte e alternar superfícies preserva o editor |  | 1.7s |
| 🟢 | salvamento de documentos › voltar à conversa para quando o documento em página inteira não salva |  | 1.3s |
| 🟢 | salvamento de documentos › o menu de módulos espera o salvamento e tentar de novo recupera uma falha |  | 2.6s |
| 🟢 | salvamento de documentos › uma falha ao salvar nunca prende o logout global e descartar exige escolha explícita em 1280px |  | 2.4s |
| 🟢 | salvamento de documentos › uma falha ao salvar nunca prende o logout global e descartar exige escolha explícita em 390px |  | 2.7s |
| 🟢 | salvamento de documentos › voltar e avançar mantém edições que falharam em 390px |  | 3.8s |
| 🟢 | **e2e/editor-repair.e2e.ts** · 16 passed |  | 1m 19s |
| 🟢 | restauração pendente particular preserva título e texto posteriores |  | 4.6s |
| 🟢 | recarga explícita particular preserva digitação durante a leitura |  | 3.3s |
| 🟢 | restauração pendente compartilhada preserva título e texto posteriores |  | 4.7s |
| 🟢 | recarga explícita compartilhada preserva digitação durante a leitura |  | 4.3s |
| 🟢 | restauração particular preserva uma edição já autosalva depois do clique |  | 4.1s |
| 🟢 | restauração compartilhada preserva uma edição já autosalva depois do clique |  | 3.7s |
| 🟢 | acesso removido descoberto por save limpa editor e contexto e libera navegação |  | 5.5s |
| 🟢 | acesso removido descoberto por versions limpa editor e contexto e libera navegação |  | 3.6s |
| 🟢 | acesso removido descoberto por restore limpa editor e contexto e libera navegação |  | 3.9s |
| 🟢 | acesso removido descoberto por export limpa editor e contexto e libera navegação |  | 5.9s |
| 🟢 | acesso removido descoberto por read limpa editor e contexto e libera navegação |  | 7.2s |
| 🟢 | uma resposta de save real pendente não ressuscita a página invalidada pelo histórico |  | 6.3s |
| 🟢 | navegação que aguarda save negado segue após a invalidação |  | 5.7s |
| 🟢 | revogação libera uma saída já aguardando save sem esperar a resposta anterior |  | 5.0s |
| 🟢 | falha transitória compartilhada preserva rascunho e permite retry real |  | 6.9s |
| 🟢 | um save com sessão encerrada retorna ao acesso em vez de invalidar como revogação do caso |  | 4.4s |
| 🟢 | **e2e/honorario-charge.e2e.ts** · 1 passed |  | 6.6s |
| 🟢 | a cobrança de uma parcela com PIX e boleto gera o PDF, registra o envio e trava depois da quitação |  | 6.6s |
| 🟢 | **e2e/honorarios.e2e.ts** · 1 passed |  | 9.6s |
| 🟢 | honorários pela interface: parcelamento, baixas integral e parcial, correção, abas, cancelamento, erro e celular |  | 9.6s |
| 🟢 | **e2e/legal-acceptance.e2e.ts** · 1 passed |  | 2.4s |
| 🟢 | termos e aviso de IA: aceite antes do escritório e ciência antes da primeira conversa |  | 2.4s |
| 🟢 | **e2e/lume-composition.e2e.ts** · 2 passed |  | 18.5s |
| 🟢 | composição real do Início e Tudo preserva contexto, paginação, rascunhos e compartilhamento em 390px |  | 14.6s |
| 🟢 | contrato de apresentação local usa uma linha por chamada e mantém a confirmação precisa |  | 3.9s |
| 🟢 | **e2e/lume-shell.e2e.ts** · 6 passed |  | 23.8s |
| 🟢 | a conversa e o rascunho sobrevivem aos modos, módulos e alternância móvel |  | 4.0s |
| 🟢 | contrato frontend: o transporte envia o caso visível e uma saída tardia abre só uma aba de fundo |  | 3.1s |
| 🟢 | links privados canônicos e abas restauradas conservam autorização e rascunhos |  | 4.6s |
| 🟢 | a revogação real de um caso remove a aba, o conteúdo e o contexto sem apagar o pedido privado |  | 6.8s |
| 🟢 | contrato frontend: a conversa restrita por 403 não reaparece pelo cache |  | 2.7s |
| 🟢 | contrato frontend: a conversa restrita por 404 não reaparece pelo cache |  | 2.7s |
| 🟢 | **e2e/office-activity.e2e.ts** · 2 passed |  | 8.9s |
| 🟢 | a atividade do escritório mostra quem fez o quê, com filtros, no desktop |  | 4.6s |
| 🟢 | a atividade do escritório mostra quem fez o quê, com filtros, no celular |  | 4.3s |
| 🟢 | **e2e/office-data.e2e.ts** · 1 passed |  | 6.0s |
| 🟢 | seus dados: exportar o escritório e agendar e cancelar a exclusão |  | 6.0s |
| 🟢 | **e2e/office-tasks.e2e.ts** · 1 passed |  | 5.3s |
| 🟢 | uma tarefa criada em Escritório é gravada no escritório, concluída e arquivada |  | 5.3s |
| 🟢 | **e2e/onboarding.e2e.ts** · 9 passed |  | 31.7s |
| 🟢 | leitor dos tutoriais entra com sessão autenticada |  | 2.1s |
| 🟢 | o tutorial percorre todas as etapas, pausa e retoma em 1440px |  | 12.1s |
| 🟢 | o tutorial percorre todas as etapas, pausa e retoma em 390px |  | 7.6s |
| 🟢 | o tour leva à biblioteca de vídeos por módulo |  | 1.6s |
| 🟢 | a biblioteca filtra módulos e abre vídeos independentes em 1440px |  | 3.6s |
| 🟢 | a biblioteca filtra módulos e abre vídeos independentes em 390px |  | 2.6s |
| 🟢 | cada tutorial tem vídeo, legenda e capa publicados |  | 164ms |
| 🟢 | falha de carregamento oferece tentar novamente e download |  | 1.1s |
| 🟢 | um endereço de vídeo desconhecido retorna página não encontrada |  | 928ms |
| 🟢 | **e2e/password-recovery.e2e.ts** · 2 passed |  | 5.8s |
| 🟢 | recuperação de senha volta ao login do escritório em 1280px |  | 2.9s |
| 🟢 | recuperação de senha volta ao login do cliente em 390px |  | 2.9s |
| 🟢 | **e2e/private-chat-readiness.e2e.ts** · 1 passed |  | 3.1s |
| 🟢 | arquivo com falha não impede conversa particular: compositor chega à configuração do provedor |  | 3.1s |
| 🟢 | **e2e/profile.e2e.ts** · 1 passed |  | 10.9s |
| 🟢 | perfil, foto, credenciais e convite de associado com o card do perfil |  | 10.9s |
| 🟢 | **e2e/pwa.e2e.ts** · 2 passed |  | 1.8s |
| 🟢 | o manifesto, os ícones e o service worker do Lume estão publicados para instalação |  | 18ms |
| 🟢 | instalar o Lume usa o convite do navegador ou explica como instalar, e o tema escuro ajusta a cor da barra |  | 1.8s |
| 🟢 | **e2e/research-linker-race.e2e.ts** · 1 passed |  | 9.2s |
| 🟢 | resposta de perfil do caso anterior não substitui o caso selecionado |  | 9.2s |
| 🟢 | **e2e/research-source-round3.e2e.ts** · 1 passed |  | 12.3s |
| 🟢 | perfil e anotação restritos preservam bytes; conteúdo preparado tem uma revisão exata |  | 12.3s |
| 🟢 | **e2e/source-policy.e2e.ts** · 2 passed |  | 6.1s |
| 🟢 | revisão no chat: carregamento, erro, nova tentativa e confirmação exata pelo teclado |  | 3.2s |
| 🟢 | seleção explícita de proposta e novo pedido independente pelo teclado, desktop e mobile |  | 2.9s |
| 🟢 | **e2e/source-round3.e2e.ts** · 1 passed |  | 4.0s |
| 🟢 | anexos: A/B/A mantém a resposta, erro, busy e geração da seleção atual |  | 4.0s |
| 🟢 | **e2e/task-board-persistence.e2e.ts** · 1 passed |  | 6.8s |
| 🟢 | arrastar uma tarefa no quadro grava a coluna no escritório: mouse, teclado e celular |  | 6.8s |
| 🟢 | **e2e/task-details.e2e.ts** · 3 passed |  | 12.9s |
| 🟢 | cada tarefa do Kanban abre a própria página, que edita título e observações sem mudar a situação |  | 6.2s |
| 🟢 | uma reunião e um id inexistente mostram a tarefa indisponível sem revelar o título |  | 5.7s |
| 🟢 | a página da tarefa mostra a falha de carregamento e tenta de novo |  | 1.0s |
| 🟢 | **e2e/vault-pagination.e2e.ts** · 2 passed |  | 5.8s |
| 🟢 | arquivos antigos do Cofre são alcançáveis e falhas de paginação se recuperam em 390px |  | 2.1s |
| 🟢 | arquivos antigos continuam selecionáveis em anexos, e-mail e Drive em 1280px |  | 3.8s |
| 🟢 | **e2e/vault-upload.e2e.ts** · 2 passed |  | 2.1s |
| 🟢 | o Cofre recebe arquivo de 100 MB e recusa um byte a mais |  | 1.8s |
| 🟢 | envio direto ao Cofre preserva nome, pasta e processamento do arquivo |  | 274ms |
| 🟢 | **e2e/workspace.e2e.ts** · 3 passed |  | 11.6s |
| 🟢 | área de trabalho › o menu da conta no celular alterna o tema e devolve o foco ao fechar |  | 1.1s |
| 🟢 | área de trabalho › o compositor do chat fica visível numa conversa longa e o rascunho sobrevive à rolagem |  | 1.6s |
| 🟢 | área de trabalho › Início, calendário e ficha do cliente com dados controlados, estados vazios e de erro |  | 8.9s |
</details>

<sub>e2e 0.15.1 · 4m 51s · web</sub>
