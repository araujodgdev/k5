# Correções e recuperação do monitor sintético

Responsável: Douglas Araújo. Estes incidentes ocorreram no escritório sintético durante a implantação do monitor. Não indicam perda de dados de clientes.

## Preenchimento da agenda — encerrado

Issue [LUME-1C](https://lume-wr.sentry.io/issues/7761588593/). O teste remoto terminava por timeout na etapa `agenda_save`. A imagem de evidência mostrava o campo de notas preenchido parcialmente: a digitação caractere a caractere exigia muitas viagens pelo protocolo remoto. O monitor passou a inserir o texto em uma operação de teclado e verificar o valor completo, depois de confirmar que o formulário estava interativo.

A versão `8e9b4fa6-b255-44d5-bc96-6731745132be` passou todas as etapas em execução manual às 15:55 UTC e no agendamento das 16:02 UTC. O agendamento das 16:17 UTC, na versão `e56241c8-2685-485f-8e92-664108f876a7`, também passou a gravação e a leitura da agenda. São duas verificações agendadas da correção, além da execução manual. O issue foi resolvido no Sentry às 16:30 UTC.

## Check-in inicial retido — corrigido, recuperação observada

O agendamento das 16:02 terminou com sucesso, mas gerou um check-in `missed`. A inspeção do SDK mostrou que `IsolatedPromiseBuffer` guardava o envio até o fim do handler. O monitor agora drena o transporte por até dois segundos antes do trabalho, sem impedir o job quando a telemetria falha. Os testes cobrem envio inicial antes do callback e continuidade diante de erro do transporte.

Um check-in `in_progress` foi consultado antes da conclusão da execução manual iniciada às 16:12. O agendamento das 16:17 passou e foi posteriormente registrado como `ok` no Sentry. Durante a validação, a API do Sentry apresentou HTTP 500 e atraso na atualização de resultados; os horários de criação de registros no Sentry não devem ser confundidos com o início registrado no banco ou usados para prometer latência de alerta.

## Confirmação de exclusão — em observação

A execução `60e8853b-bcc6-4dd9-ac29-944478bd1825` retornou erro em `vault_cleanup`, embora a exclusão tivesse acontecido. O banco registrou `deleted_at=16:15:08.121 UTC`. O evento Cloudflare `01M3PZ5MH50000000000000004`, às 16:15:08.837 UTC, registra DELETE com HTTP 200, 2.838 ms de duração e resultado `ok`. A espera do navegador terminou depois disso.

A hipótese principal é a repetição do clique pelo locator depois que o diálogo desaparece. O clique de confirmação passou a usar uma única ação, preservando a proposta e a aprovação normais da aplicação. Foram acrescentados códigos de timeout por fase: identidade, biblioteca, diálogo, envio e verificação. As validações de resposta HTTP e ausência do arquivo persistido continuam obrigatórias.

A versão `b26edb0d-5cc9-4ee9-9b93-fba6bdb1ab17` passou as doze etapas manualmente em 143.206 ms; `vault_cleanup` passou em 22.694 ms. A execução agendada `70b437c0-b3bd-410b-a63d-76d3617979d2`, iniciada às 16:32:26 UTC, passou todas as etapas em 260.190 ms, com limpeza em 47.328 ms. A conclusão foi persistida às 16:36:50 UTC. Há uma execução manual e uma agendada após a alteração do clique; o issue geral permanece aberto até completar a recuperação exigida no runbook.

A duração de 260.190 ms deixou só 4.810 ms de margem antes do prazo efetivo da jornada. A versão final `9ae080ec-faa3-4beb-b5f5-b885dbf0ee3a` aumenta apenas o orçamento total de 270 para 330 segundos, dos quais cinco ficam reservados ao fechamento do contexto. Mantém os limites por ação, seis minutos no Sentry e sete minutos no lease. O build e o deploy passaram; as verificações funcionais acima pertencem à versão anterior, com os mesmos passos e o prazo menor.

Reversão: publicar uma versão previamente verificada do monitor; manter o escritório e as credenciais isolados. Nunca relaxar a verificação de identidade ou remover documentos por prefixo para fazer um teste passar.
