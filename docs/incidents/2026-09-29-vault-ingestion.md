# Duas ingestões de PDF com falha detectadas pelo monitor

Estado: causa identificada e correção implementada em 03/10/2026; aguarda publicação, reprocessamento dos dois itens pelo responsável e duas verificações agendadas. Responsável: Douglas Araújo. Issue específico: [LUME-1E](https://lume-wr.sentry.io/issues/7761609542/). O alerta foi atribuído automaticamente à conta responsável.

O monitor de filas encontrou duas ingestões de PDFs em estado `failed`, atualizadas em 29/09/2026 às 14:41:16 e 14:41:17 UTC. A consulta manual às 15:43 e a execução agendada às 16:00:26 UTC detectaram a mesma condição. Os itens pertencem a escritórios reais, não ao escritório sintético. Nenhum conteúdo, nome de arquivo, identificador de cliente ou chave de armazenamento foi copiado para este registro.

O erro persistido é a mensagem estática da aplicação “Armazenamento de documentos indisponível.” O adaptador de armazenamento substitui a causa original por essa mensagem; portanto, não é possível estabelecer retrospectivamente se houve falha de rede, permissão ou binding. A proximidade com um deploy é apenas uma hipótese. Os dois itens não foram reprocessados nem alterados durante a instalação do monitor.

Evidência do monitor agendado: execução `c9faeeb3-7c33-41f8-85ce-273e195aa5a8`, versão `8e9b4fa6-b255-44d5-bc96-6731745132be`, fila `vault.ingestion`, motivo `failed`, quantidade 2, idade do item mais antigo 79 minutos. A persistência do alerta demonstra detecção de falha terminal sem depender de reclamação de usuário. O resultado de filas permanece vermelho por uma causa real.

Próxima ação operacional: verificar acesso ao R2 pelo processador correspondente, correlacionar os logs das 14:41 UTC e reproduzir com um PDF sintético. Se for necessário reprocessar os itens afetados, usar a operação administrativa existente e conferir idempotência e resultado antes de encerrar. Não remover registros ou mudar estados diretamente para silenciar o alerta. A saída da janela de 24 horas do monitor não prova recuperação.

Verificação complementar às 16:30 UTC: um PDF criado para o teste, no escritório sintético, foi enviado pela API autenticada, chegou a `ready` com 60 caracteres extraídos e foi excluído pelo fluxo normal de proposta/aprovação. O teste terminou em cerca de 19 segundos. Isso demonstra funcionamento atual para esse PDF pequeno; não reproduz os documentos originais nem estabelece a causa histórica. Evidência local: `apps/web/.data/monitoring/pdf-result.json`.

Critério de encerramento: causa identificada ou diagnóstico limitado explicitamente aceito pelo responsável, correção demonstrada com arquivo sintético, tratamento dos dois itens afetados e duas verificações agendadas posteriores sem a condição original.

## Causa identificada — 03/10/2026

Os logs do Workers Observability (retenção de sete dias) mostram a sequência no Worker `lume`:

1. 14:41:06 UTC: `Durable Object reset because its code was updated` — um deploy substituiu o código enquanto o processador de documentos executava a ingestão.
2. 14:41:16.018 e 14:41:17.017 UTC: o container, ainda executando o trabalho iniciado antes do deploy, pediu os dois originais em `GET http://k5-bindings/objects/<chave>.pdf`. O `ContainerProxy` da versão nova `bcb38cff` respondeu **403** em 1–2 ms, sem chegar ao R2. O handler `processorBindingRequest` não produz 403; a resposta veio do proxy da plataforma durante a troca de versão.
3. `readVaultOriginal` converteu o `ContainerBindingError(403)` na mensagem fixa e `processDocument` marcou os documentos como `failed`, sem nova tentativa.

Nos sete dias consultados, o agregado amostrado do `ContainerProxy` só contém respostas 200 e 204; os dois 403 coincidem com esse deploy. A falha foi de leitura transitória; nada indica perda dos originais, mas a existência dos dois objetos no R2 só será confirmada no reprocessamento.

Correção (`0067_vault_ingestion_retry.sql`, `src/lib/vault.ts`): falha de armazenamento diferente de "não encontrado" agora vira `VaultStorageUnavailableError`, que preserva a causa. A telemetria `vault.ingestion` recebe `http_status`/`failure_kind` e o número da tentativa. O documento volta para a fila com espera de 1, 5 e 15 minutos (`retry_at`). Só depois da terceira espera fica `failed`, com a mesma mensagem para a pessoa. O monitor de filas considera `retry_at` para não acusar atraso durante a espera. Teste: `tests/vault-ingestion-retry.test.ts`.

Para encerrar: publicar, pedir "Tentar novamente" nos dois documentos (ou o titular fazê-lo pela interface) e confirmar duas verificações agendadas sem a condição.
