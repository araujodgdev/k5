### 🔴 e2e: 3 failed, 1 flaky, 102 passed, 2 skipped
7 agent steps · 4 replayed from cache · 5 model calls · 19.2k tokens (67% cached)

**🔴 citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 1280px**  
`e2e/chat-feedback.e2e.ts:41`

**ASSERTION_FAILED** at step 8 of 8: `expect.toBeVisible getByLabel("Atividade do Lume") >> getByText("Pesquisou na web: primeiro resultado")`, after 10.1s

- Expected: visible
- Observed: no node (0 matches)
- Failed the same way on both attempts: **ASSERTION_FAILED** at step 8.
- Screen: `/app/command-center`

Evidence: screenshot `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-83e16b4d/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_chat-feedback.e2e.ts-cita__es_e_duas_aprova__es_independentes_continuam_vis_veis_depois_de_remontar_o_chat_-d949fd58-24e183a2.md`

**🔴 citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 390px**  
`e2e/chat-feedback.e2e.ts:41`

**ASSERTION_FAILED** at step 8 of 8: `expect.toBeVisible getByLabel("Atividade do Lume") >> getByText("Pesquisou na web: primeiro resultado")`, after 10.1s

- Expected: visible
- Observed: no node (0 matches)
- Failed the same way on both attempts: **ASSERTION_FAILED** at step 8.
- Screen: `/app/command-center`

Evidence: screenshot `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/e2e_chat-feedback.e2e.ts__cita_C3_A7_C3_B5es_20e_20duas_20aprova_C3_A7_C3_B5es_20independentes_20continuam_20vi-7eb1eb9b/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_chat-feedback.e2e.ts-cita__es_e_duas_aprova__es_independentes_continuam_vis_veis_depois_de_remontar_o_chat_-2cc7352e-943e467c.md`

**🔴 seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px**  
`e2e/cliproxyapi.e2e.ts:43`

**ASSERTION_FAILED**

> expected {"status":"unconfigured","message":"O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."} to equal {"status":"unconfigured","message":"Nenhuma conexão de IA ativa na plataforma."}

- Failed the same way on both attempts: **ASSERTION_FAILED**.
- Screen: `/app/admin/ai`

Evidence: screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/001-failure.png`, trace `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/trace/trace.zip`, log `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/failure/screen.txt` · Details: `.e2e/failures/e2e_cliproxyapi.e2e.ts-sele__o_do_CLIProxyAPI-administra_CLIProxyAPI_e_escolhe_uma_tarefa_pelo_teclado_em_1280p-94070fc5-d2b73c3f.md`

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
| 🔴 | **e2e/chat-feedback.e2e.ts** · 2 failed |  | 26.3s |
| 🔴 | citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 1280px |  | 13.9s |
| 🔴 | citações e duas aprovações independentes continuam visíveis depois de remontar o chat em 390px |  | 12.4s |
| 🔴 | **e2e/cliproxyapi.e2e.ts** · 1 failed, 2 skipped |  | 35.7s |
| 🔴 | seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px |  | 35.7s |
| ⏭️ | seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 390px (skipped: member 0 failed in this group attempt) |  |  |
| ⏭️ | novo usuário conversa pelo proxy, recarrega o histórico e mantém isolamento (skipped: Requer K5_E2E_REAL_AI=1 e uma chave de teste do CLIProxyAPI.) |  |  |
| ⚠️ | **e2e/auth.setup.e2e.ts** · 1 flaky |  | 3.9s |
| ⚠️ | administrador entra pelo formulário (1 failed attempt first) |  | 3.9s |
| 🟢 | **e2e/agent-approvals.e2e.ts** · 1 passed |  | 6.8s |
| 🟢 | ações financeiras do agente esperam confirmação no chat, e o agente consulta a ajuda sem acessar Integrações |  | 6.8s |
| 🟢 | **e2e/agent-settings.e2e.ts** · 1 passed |  | 7.4s |
| 🟢 | personalização do Lume reúne legados e novos itens em uma lista no desktop e celular |  | 7.4s |
| 🟢 | **e2e/agent/office-clients.e2e.ts** · 1 passed | 4 steps · 1 call | 11.6s |
| 🟢 | o agente cadastra um cliente, abre a ficha e corrige o nome | 4 steps · 1 call | 11.6s |
| 🟢 | **e2e/agent/vault-cases.e2e.ts** · 1 passed | 3 steps · 4 calls | 30.0s |
| 🟢 | o agente cria um caso no Cofre com dados do cliente e abre a página do caso | 3 steps · 4 calls | 30.0s |
| 🟢 | **e2e/annex-plan.e2e.ts** · 1 passed |  | 9.1s |
| 🟢 | plano persistido: revisão editada mantém vínculo, teclado e geração real em desktop e 390px |  | 9.1s |
| 🟢 | **e2e/app-shell.e2e.ts** · 1 passed |  | 3.5s |
| 🟢 | o shell mantém a marca Lume e todos os destinos no desktop e no celular |  | 3.5s |
| 🟢 | **e2e/asaas.e2e.ts** · 1 passed |  | 3.4s |
| 🟢 | o Asaas aparece em Integrações, recusa uma chave inválida e orienta a cobrança da parcela |  | 3.4s |
| 🟢 | **e2e/calc.e2e.ts** · 1 passed |  | 9.2s |
| 🟢 | Calc: consumidor, versões, tributo federal, proposta OAB e parcelas no desktop e celular |  | 9.2s |
| 🟢 | **e2e/case-collaboration.e2e.ts** · 1 passed |  | 19.4s |
| 🟢 | caso compartilhado: tarefas reais, conflito preservado, honorários, atividade e política no celular |  | 19.4s |
| 🟢 | **e2e/case-pages.e2e.ts** · 3 passed |  | 20.6s |
| 🟢 | páginas: criar no caso, editar, recarregar, restaurar e usar o canvas móvel |  | 9.6s |
| 🟢 | publicação: revisar uma cópia exata, manter o original particular e colaborar com conflito e revogação |  | 6.6s |
| 🟢 | contrato frontend: página enviada fica congelada e resultado tardio não toma o outro editor |  | 4.4s |
| 🟢 | **e2e/client-portal.e2e.ts** · 1 passed |  | 9.3s |
| 🟢 | o portal do cliente: convite, conta sem escritório, PDF e cobrança publicados, comprovante e revogação |  | 9.3s |
| 🟢 | **e2e/collaboration.e2e.ts** · 2 passed |  | 26.2s |
| 🟢 | associados e pastas: convite, colaboração e revogação no desktop |  | 14.3s |
| 🟢 | associados e pastas: convite, colaboração e revogação no celular |  | 11.9s |
| 🟢 | **e2e/conversation-artifacts.e2e.ts** · 1 passed |  | 3.7s |
| 🟢 | Artefatos lista o que a conversa criou e recebeu e salva no Cofre pela interface |  | 3.7s |
| 🟢 | **e2e/credits.e2e.ts** · 1 passed |  | 2.3s |
| 🟢 | um escritório novo vê os créditos iniciais e o extrato no Plano, no desktop e no celular |  | 2.3s |
| 🟢 | **e2e/document-human-review.e2e.ts** · 1 passed |  | 6.3s |
| 🟢 | decisão humana persiste, permite correção e pede nova revisão quando o texto muda |  | 6.3s |
| 🟢 | **e2e/document-pdf.e2e.ts** · 1 passed |  | 3.8s |
| 🟢 | exportar PDF baixa o texto salvo, recusa versão antiga e sessão ausente, e mostra a falha de conversão |  | 3.8s |
| 🟢 | **e2e/document-saving.e2e.ts** · 12 passed |  | 31.8s |
| 🟢 | salvamento de documentos › esconder a aba salva uma vez e deixa as edições seguintes salváveis |  | 3.2s |
| 🟢 | salvamento de documentos › salvar explicitamente grava uma versão mesmo depois do salvamento automático |  | 3.3s |
| 🟢 | salvamento de documentos › restaurar para quando salvar o texto atual falha |  | 1.4s |
| 🟢 | salvamento de documentos › documentos grandes terminam de salvar antes de o painel fechar |  | 1.9s |
| 🟢 | salvamento de documentos › uma revisão do Lume preserva o texto local depois de uma falha ao salvar |  | 3.4s |
| 🟢 | salvamento de documentos › uma revisão do Lume preserva o texto local depois de um conflito ao salvar |  | 3.1s |
| 🟢 | salvamento de documentos › no celular o chat oculto é inerte e alternar superfícies preserva o editor |  | 2.1s |
| 🟢 | salvamento de documentos › voltar à conversa para quando o documento em página inteira não salva |  | 1.9s |
| 🟢 | salvamento de documentos › o menu de módulos espera o salvamento e tentar de novo recupera uma falha |  | 2.0s |
| 🟢 | salvamento de documentos › uma falha ao salvar nunca prende o logout global e descartar exige escolha explícita em 1280px |  | 2.8s |
| 🟢 | salvamento de documentos › uma falha ao salvar nunca prende o logout global e descartar exige escolha explícita em 390px |  | 2.3s |
| 🟢 | salvamento de documentos › voltar e avançar mantém edições que falharam em 390px |  | 4.3s |
| 🟢 | **e2e/editor-repair.e2e.ts** · 16 passed |  | 1m 24s |
| 🟢 | restauração pendente particular preserva título e texto posteriores |  | 4.6s |
| 🟢 | recarga explícita particular preserva digitação durante a leitura |  | 3.6s |
| 🟢 | restauração pendente compartilhada preserva título e texto posteriores |  | 4.9s |
| 🟢 | recarga explícita compartilhada preserva digitação durante a leitura |  | 4.3s |
| 🟢 | restauração particular preserva uma edição já autosalva depois do clique |  | 4.1s |
| 🟢 | restauração compartilhada preserva uma edição já autosalva depois do clique |  | 3.9s |
| 🟢 | acesso removido descoberto por save limpa editor e contexto e libera navegação |  | 5.1s |
| 🟢 | acesso removido descoberto por versions limpa editor e contexto e libera navegação |  | 3.6s |
| 🟢 | acesso removido descoberto por restore limpa editor e contexto e libera navegação |  | 4.5s |
| 🟢 | acesso removido descoberto por export limpa editor e contexto e libera navegação |  | 5.2s |
| 🟢 | acesso removido descoberto por read limpa editor e contexto e libera navegação |  | 6.7s |
| 🟢 | uma resposta de save real pendente não ressuscita a página invalidada pelo histórico |  | 6.6s |
| 🟢 | navegação que aguarda save negado segue após a invalidação |  | 6.4s |
| 🟢 | revogação libera uma saída já aguardando save sem esperar a resposta anterior |  | 7.2s |
| 🟢 | falha transitória compartilhada preserva rascunho e permite retry real |  | 7.7s |
| 🟢 | um save com sessão encerrada retorna ao acesso em vez de invalidar como revogação do caso |  | 5.3s |
| 🟢 | **e2e/honorario-charge.e2e.ts** · 1 passed |  | 5.7s |
| 🟢 | a cobrança de uma parcela com PIX e boleto gera o PDF, registra o envio e trava depois da quitação |  | 5.7s |
| 🟢 | **e2e/honorarios.e2e.ts** · 1 passed |  | 9.2s |
| 🟢 | honorários pela interface: parcelamento, baixas integral e parcial, correção, abas, cancelamento, erro e celular |  | 9.2s |
| 🟢 | **e2e/legal-acceptance.e2e.ts** · 1 passed |  | 2.7s |
| 🟢 | termos e aviso de IA: aceite antes do escritório e ciência antes da primeira conversa |  | 2.7s |
| 🟢 | **e2e/lume-composition.e2e.ts** · 2 passed |  | 18.5s |
| 🟢 | composição real do Início e Tudo preserva contexto, paginação, rascunhos e compartilhamento em 390px |  | 14.9s |
| 🟢 | contrato de apresentação local usa uma linha por chamada e mantém a confirmação precisa |  | 3.6s |
| 🟢 | **e2e/lume-shell.e2e.ts** · 6 passed |  | 23.2s |
| 🟢 | a conversa e o rascunho sobrevivem aos modos, módulos e alternância móvel |  | 3.4s |
| 🟢 | contrato frontend: o transporte envia o caso visível e uma saída tardia abre só uma aba de fundo |  | 3.3s |
| 🟢 | links privados canônicos e abas restauradas conservam autorização e rascunhos |  | 5.0s |
| 🟢 | a revogação real de um caso remove a aba, o conteúdo e o contexto sem apagar o pedido privado |  | 6.3s |
| 🟢 | contrato frontend: a conversa restrita por 403 não reaparece pelo cache |  | 2.8s |
| 🟢 | contrato frontend: a conversa restrita por 404 não reaparece pelo cache |  | 2.4s |
| 🟢 | **e2e/office-activity.e2e.ts** · 2 passed |  | 10.7s |
| 🟢 | a atividade do escritório mostra quem fez o quê, com filtros, no desktop |  | 5.6s |
| 🟢 | a atividade do escritório mostra quem fez o quê, com filtros, no celular |  | 5.0s |
| 🟢 | **e2e/office-data.e2e.ts** · 1 passed |  | 5.6s |
| 🟢 | seus dados: exportar o escritório e agendar e cancelar a exclusão |  | 5.6s |
| 🟢 | **e2e/office-tasks.e2e.ts** · 1 passed |  | 5.4s |
| 🟢 | uma tarefa criada em Escritório é gravada no escritório, concluída e arquivada |  | 5.4s |
| 🟢 | **e2e/onboarding.e2e.ts** · 9 passed |  | 40.4s |
| 🟢 | leitor dos tutoriais entra com sessão autenticada |  | 2.1s |
| 🟢 | o tutorial percorre todas as etapas, pausa e retoma em 1440px |  | 14.7s |
| 🟢 | o tutorial percorre todas as etapas, pausa e retoma em 390px |  | 10.2s |
| 🟢 | o tour leva à biblioteca de vídeos por módulo |  | 2.2s |
| 🟢 | a biblioteca filtra módulos e abre vídeos independentes em 1440px |  | 3.7s |
| 🟢 | a biblioteca filtra módulos e abre vídeos independentes em 390px |  | 4.0s |
| 🟢 | cada tutorial tem vídeo, legenda e capa publicados |  | 276ms |
| 🟢 | falha de carregamento oferece tentar novamente e download |  | 1.8s |
| 🟢 | um endereço de vídeo desconhecido retorna página não encontrada |  | 1.4s |
| 🟢 | **e2e/password-recovery.e2e.ts** · 2 passed |  | 6.5s |
| 🟢 | recuperação de senha volta ao login do escritório em 1280px |  | 3.3s |
| 🟢 | recuperação de senha volta ao login do cliente em 390px |  | 3.1s |
| 🟢 | **e2e/private-chat-readiness.e2e.ts** · 1 passed |  | 3.7s |
| 🟢 | arquivo com falha não impede conversa particular: compositor chega à configuração do provedor |  | 3.7s |
| 🟢 | **e2e/profile.e2e.ts** · 1 passed |  | 13.7s |
| 🟢 | perfil, foto, credenciais e convite de associado com o card do perfil |  | 13.7s |
| 🟢 | **e2e/public-site.e2e.ts** · 3 passed |  | 6.4s |
| 🟢 | o site público entrega SEO no HTML do servidor e mantém as áreas privadas fora do índice |  | 198ms |
| 🟢 | a página inicial funciona pelo teclado e nos dois temas em 390px |  | 2.5s |
| 🟢 | a página inicial funciona pelo teclado e nos dois temas em 1440px |  | 3.7s |
| 🟢 | **e2e/pwa.e2e.ts** · 2 passed |  | 2.5s |
| 🟢 | o manifesto, os ícones e o service worker do Lume estão publicados para instalação |  | 31ms |
| 🟢 | instalar o Lume usa o convite do navegador ou explica como instalar, e o tema escuro ajusta a cor da barra |  | 2.5s |
| 🟢 | **e2e/research-linker-race.e2e.ts** · 1 passed |  | 11.4s |
| 🟢 | resposta de perfil do caso anterior não substitui o caso selecionado |  | 11.4s |
| 🟢 | **e2e/research-source-round3.e2e.ts** · 1 passed |  | 16.8s |
| 🟢 | perfil e anotação restritos preservam bytes; conteúdo preparado tem uma revisão exata |  | 16.8s |
| 🟢 | **e2e/source-policy.e2e.ts** · 2 passed |  | 8.1s |
| 🟢 | revisão no chat: carregamento, erro, nova tentativa e confirmação exata pelo teclado |  | 4.0s |
| 🟢 | seleção explícita de proposta e novo pedido independente pelo teclado, desktop e mobile |  | 4.1s |
| 🟢 | **e2e/source-round3.e2e.ts** · 1 passed |  | 5.3s |
| 🟢 | anexos: A/B/A mantém a resposta, erro, busy e geração da seleção atual |  | 5.3s |
| 🟢 | **e2e/task-board-persistence.e2e.ts** · 1 passed |  | 9.6s |
| 🟢 | arrastar uma tarefa no quadro grava a coluna no escritório: mouse, teclado e celular |  | 9.6s |
| 🟢 | **e2e/task-board.e2e.ts** · 6 passed |  | 20.1s |
| 🟢 | o quadro de tarefas mostra 53 tarefas, move pelo teclado, delega ao Lume e se recupera de vazio e erro |  | 6.1s |
| 🟢 | arrastar com o mouse move a tarefa de coluna; fora do quadro, na mesma coluna e com Esc nada muda |  | 3.8s |
| 🟢 | a tarefa troca de coluna antes da resposta e cada cartão salva sozinho |  | 2.6s |
| 🟢 | uma falha devolve só aquele cartão e a nova tentativa usa a versão atual |  | 3.3s |
| 🟢 | movimentos seguidos usam a versão devolvida e o teclado anda coluna a coluna |  | 2.7s |
| 🟢 | no celular o arrasto fica no quadro e o teclado leva a tarefa de coluna em coluna |  | 1.6s |
| 🟢 | **e2e/task-details.e2e.ts** · 3 passed |  | 18.9s |
| 🟢 | cada tarefa do Kanban abre a própria página, que edita título e observações sem mudar a situação |  | 10.5s |
| 🟢 | uma reunião e um id inexistente mostram a tarefa indisponível sem revelar o título |  | 7.0s |
| 🟢 | a página da tarefa mostra a falha de carregamento e tenta de novo |  | 1.4s |
| 🟢 | **e2e/vault-pagination.e2e.ts** · 2 passed |  | 10.7s |
| 🟢 | arquivos antigos do Cofre são alcançáveis e falhas de paginação se recuperam em 390px |  | 3.4s |
| 🟢 | arquivos antigos continuam selecionáveis em anexos, e-mail e Drive em 1280px |  | 7.3s |
| 🟢 | **e2e/vault-upload.e2e.ts** · 2 passed |  | 3.7s |
| 🟢 | o Cofre recebe arquivo de 100 MB e recusa um byte a mais |  | 3.1s |
| 🟢 | envio direto ao Cofre preserva nome, pasta e processamento do arquivo |  | 576ms |
| 🟢 | **e2e/workspace.e2e.ts** · 3 passed |  | 14.1s |
| 🟢 | área de trabalho › o menu da conta no celular alterna o tema e devolve o foco ao fechar |  | 2.0s |
| 🟢 | área de trabalho › o compositor do chat fica visível numa conversa longa e o rascunho sobrevive à rolagem |  | 2.3s |
| 🟢 | área de trabalho › Início, calendário e ficha do cliente com dados controlados, estados vazios e de erro |  | 9.8s |
</details>

<sub>e2e 0.15.1 · 3m 5s · web</sub>
