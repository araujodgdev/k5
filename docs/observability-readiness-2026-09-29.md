# Prontidão de observabilidade do Lume — 29/09/2026

Avaliação após a implementação: **7–8/10 nas cinco capacidades**, com **85–90% de confiança na avaliação**. O monitoramento agora identifica indisponibilidade, ausência de execução, filas sem progresso e falhas em quatro fluxos autenticados. O item 5, expansão dos controles antes do deploy, permaneceu fora do escopo solicitado.

As notas são avaliações de engenharia, não probabilidades de detectar qualquer bug. Nota 7 significa cobertura útil dos caminhos avaliados, responsável definido, sinais verificáveis e limites conhecidos. Nota 8 exige cobertura complementar e evidência de operação real. Confiança indica a força das evidências para atribuir a nota; não significa disponibilidade de 85% nem garantia de entrega de e-mail.

| Capacidade solicitada | Antes | Agora | Confiança | Evidência e limite principal |
| --- | ---: | ---: | ---: | --- |
| 1. Alertar o responsável | 4/10 | 8/10 | 90% | Douglas definido como destinatário e responsável; regra acionada no exercício LUME-16 e recebimento em `info@lume.software` confirmado pelo usuário. Ainda depende de uma pessoa e de e-mail, sem escalonamento. |
| 2. Diagnosticar a causa | 6/10 | 7/10 | 85% | Operação, etapa, códigos seguros de HTTP/banco/rede, versão e correlação com logs; testes impedem vazamento de mensagens/pilhas arbitrárias. Falhas históricas de armazenamento perderam a causa original e continuam sem diagnóstico conclusivo. |
| 3. Detectar indisponibilidade e jobs parados | 2/10 | 8/10 | 90% | Uptime corrigido, cinco monitores de cron, quinze filas avaliadas e execução ausente detectada pelo Sentry. Duas falhas reais de PDF foram detectadas pelo agendamento. |
| 4. Detectar fluxos quebrados | 3/10 | 7/10 | 85% | Navegador remoto testa login, painel, gravação/leitura de tarefa e upload/processamento/exclusão no Cofre, em escritório isolado. Não cobre todos os fluxos ou qualidade semântica da IA. |
| 6. Conduzir incidente até correção verificada | 3/10 | 8/10 | 88% | Runbook com reprodução, correção, versão e recuperação; disponibilidade, preenchimento da agenda sintética e entrega de alerta verificados e encerrados. Incidente de PDF e observação da limpeza sintética permanecem abertos. |

## Como funciona em produção

- **Sentry** centraliza erros, agrupamento por operação/etapa, responsável, e-mails, disponibilidade externa e check-ins de cron. A regra `6046507` cobre novos issues, regressões e alta prioridade, com intervalo de 15 minutos.
- **Cloudflare Workers Observability** oferece logs e traces complementares. As configurações de produção removem query strings dos logs. Logs operacionais incluem identificadores de evento/trace quando disponíveis.
- **Worker `lume-monitoring`** consulta quinze filas a cada cinco minutos. Considera prazos, leases válidos, recursos desativados e timestamps de progresso. Identifica atrasos acima de quinze minutos e falhas terminais recentes.
- **Cloudflare Browser Run** executa os fluxos nos minutos 2, 17, 32 e 47. O escritório sintético não contém dados de clientes. O teste mantém uma tarefa identificada e exclui somente o arquivo criado naquela execução.
- **R2 privado** mantém resultados e imagens de falhas por sete dias. A captura só ocorre depois de validar a identidade e o escritório; telas de senha não são capturadas.
- **PostgreSQL** mantém último início, conclusão e sucesso de cada monitor. Um lease impede execuções concorrentes e uma conclusão antiga não sobrescreve uma execução nova.

Não foi contratado um novo fornecedor. Browser Run, Workers, R2 e Sentry consomem as cotas das contas existentes. A detecção abre caminho para correção proativa; não autoriza reenvio automático de mensagens, cobranças ou alteração de dados de clientes com resultado incerto.

Estimativa de navegador: com 96 execuções por dia e duração observada de 143–260 segundos, são aproximadamente 114–208 horas em 30 dias. Na tabela Workers Paid consultada em 29/09/2026, dez horas mensais estão incluídas e o excedente custa US$ 0,09/hora; isso sugere cerca de US$ 10–19/mês para o navegador deste monitor, dependendo do uso da franquia e do tempo real de sessão. É uma projeção, não uma leitura da fatura; Sentry, Workers e armazenamento têm consumo próprio. [Preços do Browser Run](https://developers.cloudflare.com/browser-run/pricing/).

## Evidências observadas

O [incidente de disponibilidade](incidents/2026-09-29-uptime.md) documenta o domínio antigo que retornava 404, a alteração para `https://lume.software/sign-in` e dez respostas 200 consecutivas entre 15:52:57 e 16:01:57 UTC, em três regiões. A recuperação foi observada por mais de cinco minutos.

A jornada remota manual `b0502f18-5642-4d72-bf5f-bcc43d9e9513` passou as doze etapas em 169.887 ms. A execução agendada `1bda9b7e-23d9-484a-bb1d-c672ce8366fe`, iniciada às 16:02:26 UTC, passou em 200.691 ms, com conclusão persistida às 16:05:50 UTC. Ambas usaram a versão `8e9b4fa6-b255-44d5-bc96-6731745132be`.

Esse primeiro agendamento revelou um falso check-in ausente: o transporte do SDK Cloudflare segurava o início até o fim do handler. A correção envia o buffer antes do trabalho, com espera limitada a dois segundos; falha da telemetria não impede o job. Dois testes verificam a ordem de envio e a continuidade em caso de falha. A execução agendada das 16:17 passou em 229.190 ms e foi registrada como `ok` no Sentry.

Houve ainda um falso negativo na espera da confirmação de exclusão: o servidor já havia respondido HTTP 200, mas o locator do navegador atingiu o timeout. O clique foi ajustado e a jornada manual seguinte passou em 143.206 ms na versão `b26edb0d-5cc9-4ee9-9b93-fba6bdb1ab17`. Na mesma versão, o agendamento `70b437c0-b3bd-410b-a63d-76d3617979d2`, iniciado às 16:32:26 UTC, passou as doze etapas em 260.190 ms e persistiu a conclusão às 16:36:50 UTC. [Diagnóstico, correções e estado de cada incidente do monitor](incidents/2026-09-29-synthetic-monitor.md).

Esse último resultado deixou apenas 4.810 ms de margem no prazo efetivo de 265 segundos. A publicação final aumentou somente o orçamento total de 270 para 330 segundos, mantendo os limites de cada ação, o monitor externo de seis minutos e o lease de sete minutos. Ela preserva as mesmas verificações funcionais. As jornadas bem-sucedidas citadas precedem esse ajuste de constante; o build e o deploy da versão final foram verificados.

O usuário confirmou nesta conversa que recebeu o exercício de alerta em `info@lume.software`. O issue LUME-16 foi resolvido após essa confirmação. O caminho evento, regra, conta responsável e caixa de entrada foi exercitado de ponta a ponta; isso não mede a disponibilidade futura do destinatário.

As execuções de filas das 16:00 e 16:05 UTC detectaram duas ingestões de PDF com falha. O [incidente LUME-1E](incidents/2026-09-29-vault-ingestion.md) foi atribuído automaticamente a Douglas e permanece aberto. O monitor vermelho representa falhas reais, não uma instalação incompleta. A mensagem histórica não permite concluir a causa; os itens não foram alterados para silenciar o alerta.

## Validação e publicação

A primeira validação passou 658 testes, lint, typecheck, configuração do banco, build Next.js e build vinext. Após corrigir o envio inicial do check-in, a suíte completa passou **659 testes**. Depois do último ajuste do seletor do navegador, lint, typecheck, build do monitor e jornadas remotas passaram novamente. O lint mantém um aviso anterior em `transport.ts`; não há erro de lint. A suíte de 659 testes precede o último ajuste de navegador, o nome explícito do container e a constante do prazo total. Esses ajustes foram verificados respectivamente no navegador real, no deploy da aplicação e no build/deploy do monitor.

A publicação inicial atualizou o Worker web, mas a imagem dos processadores ultrapassou o limite de 4 GB. A inspeção identificou Wrangler/workerd entrando por um peer do SDK Cloudflare, embora o processo Node não importe esse SDK. O SDK da Cloudflare e o navegador remoto foram classificados como dependências de desenvolvimento, usadas para gerar os bundles dos Workers. Também foi preservado explicitamente o nome existente `k5-staging-lumeprocessor`, que a renomeação anterior do Worker havia deixado implícito. O rollout da imagem corrigida foi verificado em **100%**, versão 39 da aplicação de containers.

Versões publicadas: web `46a04e1e-dc4b-4409-8033-f36488ea2fa6`; notificações `d6180729-2937-4f30-94c1-80dc8e378888`; integrações `cd36d3de-3759-4556-863b-59c46d80219e`; monitor `9ae080ec-faa3-4beb-b5f5-b885dbf0ee3a`. O [snapshot de evidências](observability-evidence-2026-09-29.json) reúne resultados sem credenciais. O [registro de decisões](observability-decisions.tsv) preserva tentativas, falhas e correções; o [runbook](observability-runbook.md) descreve triagem, comandos e critérios de encerramento. As mudanças de código permanecem no working tree local, sem commit criado nesta execução.

## Limites que continuam relevantes

1. E-mail e um único responsável não asseguram atendimento imediato fora do horário; um substituto e um canal com confirmação/escalonamento elevariam a prontidão.
2. A causa e o tratamento das duas falhas históricas de PDF continuam pendentes. Alertas sobre falhas terminais usam janela de 24 horas; sair dessa janela não encerra um incidente.
3. Pagamentos, integrações externas completas, recuperação de senha e qualidade das respostas de IA não possuem jornadas sintéticas específicas nesta implementação.
4. A janela de observação é curta. Ainda não há taxa histórica medida de falsos positivos, tempo médio de detecção, tempo médio de reparo ou SLO de latência. Os tempos do navegador remoto também incluem a comunicação com a automação e não medem isoladamente a experiência do usuário.
5. O Worker de monitoramento compartilha Cloudflare com a aplicação. Uptime e check-ins ausentes no Sentry fornecem uma segunda perspectiva externa. A duração máxima do Sentry sinaliza travamentos; não garante cancelamento imediato das operações remotas.

Revisão independente: gpt-5.6-sol confirmou os ajustes de privacidade, proteção dos leases e cobertura das filas. Após a confirmação do e-mail e o ajuste do prazo, recomendou nota 8 para alertas, fluxos e encerramento, mantendo diagnóstico em 7. Mantivemos fluxos em 7 pela janela curta de observação após a última correção da limpeza. Não havia transcrição exportada em `agent-transcripts/`; a revisão usou o contexto disponível e os artefatos locais, sem buscar conversas de outros projetos.
