# Operação e incidentes do Lume

Responsável primário: Douglas Araújo, conta Sentry `user:5003334`. A regra `6046507` envia diretamente para essa conta. O roteamento de e-mail do projeto Lume usa `info@lume.software`, conforme configuração confirmada pelo responsável. O destino não é um segredo.

## Sinais e frequência

| Sinal | Serviço | Frequência e limite |
| --- | --- | --- |
| Página de acesso disponível | Sentry Uptime, monitor `10418082` | GET `https://lume.software/sign-in` a cada minuto; incidente após 3 falhas; recuperação após 1 sucesso |
| Processadores, integrações e notificações executam | Sentry Crons | Check-in a cada minuto, tolerância de 2 minutos; duas falhas consecutivas abrem incidente |
| Filas fazem progresso | Worker Cloudflare `lume-monitoring`, monitor `lume-monitor-queues` | A cada 5 minutos; atraso acima de 15 minutos depois do prazo/lease; falhas terminais recentes de 24 horas |
| Login, painel, agenda e Cofre funcionam | Cloudflare Browser Run, monitor `lume-monitor-journeys` | Minutos 2, 17, 32 e 47; limite total de 330 segundos para a jornada; monitor externo detecta execução ausente |
| Erros da aplicação | Sentry SDKs + logs Cloudflare | Eventos por operação, códigos técnicos permitidos, `event_id`, `trace_id` e versão do Worker |

As filas cobertas incluem ingestão, indexação e exclusão do Cofre; Google nos dois runtimes; pesquisa e avaliação de materiais; coleta judicial; projeção e entrega de notificações; documentos de IA; chat; WhatsApp; e-mails pessoais; e verificação de documentos. Leases válidos e trabalhos agendados para o futuro não são falhas. Recursos desativados não geram alertas quando a fila possui esse estado explícito. A janela de 24 horas limita alertas históricos; um incidente aberto continua exigindo triagem mesmo quando sai dessa janela.

O Sentry monitora também a ausência dos check-ins. Isso permite detectar a paralisação do próprio Worker de monitoramento. Uma falha comum da infraestrutura pode interromper aplicação e monitores Cloudflare; o Uptime e os check-ins ausentes permanecem externos à Cloudflare.

O limite de 330 segundos cobre as etapas da jornada e o fechamento do contexto isolado. Cinco segundos ficam reservados para esse fechamento. A abertura e o fechamento do navegador remoto, as gravações no R2 e a conclusão no banco ficam fora desse limite local. O Sentry sinaliza execução acima de seis minutos e o lease expira após sete minutos; isso detecta um travamento externo, mas não garante seu cancelamento imediato. O check-in inicial é enviado antes do trabalho para evitar que o buffer do SDK provoque falsos alertas de ausência.

## Triagem

1. Abra o issue recebido e assuma o incidente na conta de Douglas. Registre hora, impacto observado, ambiente, operação, versão e link do issue. Não use quantidade de usuários Sentry como impacto real, pois identificadores pessoais são removidos.
2. Para indisponibilidade, compare o Uptime com uma requisição externa à página de login. Para filas, confira o nome, motivo, quantidade e idade. Para fluxos, consulte a etapa e o código de falha.
3. Correlacione `event_id` e `trace_id` com os logs do Worker Cloudflare. `database_code`, `network_code` e `http_status` ajudam a distinguir banco, rede, autenticação e limites do provedor. A pilha aponta para o local de captura da aplicação; mensagens e pilhas arbitrárias de provedores não são copiadas.
4. Reproduza no escritório sintético ou em ambiente local. Não reenvie mensagens, cobranças ou operações com resultado incerto. Em particular, um e-mail `unknown` requer reconciliação antes de nova tentativa.
5. Aplique a menor correção que explique a causa. Para reprocessamento, use as operações administrativas existentes e sua proteção de idempotência. Não edite estados de filas de clientes diretamente para tornar o monitor verde.

## Verificação e encerramento

Um deploy ou a ausência momentânea de erros não encerra um incidente. O registro deve conter:

- Responsável, issue, início e impacto observado.
- Evidência da falha original, hipótese causal e reprodução.
- Correção aplicada, versão publicada ou configuração alterada e plano de reversão.
- Verificação que falhava antes e passou depois, quando aplicável ao tipo de incidente.
- Resultado do mesmo fluxo em produção e pelo menos duas execuções agendadas bem-sucedidas do monitor afetado. Para disponibilidade, observe no mínimo cinco minutos de respostas bem-sucedidas.
- Filas recuperadas ou itens restantes explicitamente encaminhados, sem mascarar falhas com exclusões.
- Hora de recuperação, link das evidências e decisão de encerramento.

Só então resolva o issue. Regressões acionam a regra novamente. Use [o incidente de disponibilidade](incidents/2026-09-29-uptime.md) como exemplo. A expansão dos controles de CI antes do deploy continua adiada por decisão do usuário.

## Comandos e evidências

Execute da raiz do repositório:

```sh
pnpm --filter @k5/web monitoring:run status
pnpm --filter @k5/web monitoring:run queues
pnpm --filter @k5/web monitoring:run journeys
pnpm --filter @k5/web monitoring:verify:browser
sentry issue list lume-wr/lume --query "is:unresolved" --fresh
sentry monitor list lume-wr/lume --json
```

O comando local usa o segredo ignorado pelo Git em `apps/web/.data/monitoring/secrets.json`. Não copie esse arquivo para tickets, chats ou commits. O status e as execuções manuais exigem autenticação; o endpoint público sem token retorna 404. O banco guarda início, resultado, último sucesso e versão de cada monitor. Um lease de sete minutos impede concorrência; somente seu titular pode gravar a conclusão.

Enquanto `status` for `running`, `started_at` pertence à execução atual, mas `finished_at` e `result_json` ainda descrevem a execução anterior. Use o estado como referência e só interprete o resultado como atual depois da conclusão. A API do Sentry também pode demorar para refletir check-ins; compare os horários com o registro do monitor ao investigar atrasos.

Os fluxos usam uma conta e um escritório exclusivos. Mantêm uma tarefa identificada como teste, enviam um arquivo textual sintético e excluem apenas o arquivo dessa execução. Qualquer resíduo anterior interrompe o fluxo para investigação. Não há envio a destinatários externos, cobrança ou uso de modelos de IA nesse teste.

O bucket privado `lume-monitoring-evidence` guarda resultados em `journeys/AAAA-MM-DD/<run_id>.json` e uma imagem em caso de falha após validar o escritório. A retenção é de sete dias. Não há imagem da tela de senha nem de outra conta. Uma imagem ausente não invalida o código e a etapa gravados no resultado.

Para recuperar uma evidência específica com a autenticação Cloudflare do operador:

```sh
pnpm --filter @k5/web exec wrangler r2 object get lume-monitoring-evidence/journeys/AAAA-MM-DD/RUN_ID.json --remote --file .data/monitoring/evidence.json
```

## Manutenção

- Ao trocar o domínio, atualize o Uptime e `MONITOR_BASE_URL`; verifique ambos em produção.
- Ao alterar um fluxo de UI, execute o monitor local e remoto. Revise seletores e resultado persistido sem relaxar as verificações para esconder uma falha.
- Ao adicionar uma fila, inclua seus estados, prazo, lease e timestamp de falha no registro de verificações, com casos reais de PostgreSQL.
- Após publicar o Worker, confira se os monitores aparecem ativos no Sentry, com responsável e regra vinculada. Um check-in enviado não prova que o monitor está habilitado na conta.
- Faça um exercício de alerta e recuperação periodicamente. Confirme entrega em `info@lume.software` após mudanças no roteamento.
- Cadastre um substituto para Douglas e um canal de urgência adicional se houver exigência de atendimento fora do horário comercial. E-mail sozinho não assegura resposta imediata.

IA, pagamentos, integrações externas completas e o conteúdo semântico das respostas ainda precisam de fluxos sintéticos específicos. Alertas ajudam a iniciar a correção antes de uma reclamação; não fazem correções autônomas em dados de clientes.
