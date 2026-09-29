# Duas ingestões de PDF com falha detectadas pelo monitor

Estado: aberto. Responsável: Douglas Araújo. Issue específico: [LUME-1E](https://lume-wr.sentry.io/issues/7761609542/). O alerta foi atribuído automaticamente à conta responsável.

O monitor de filas encontrou duas ingestões de PDFs em estado `failed`, atualizadas em 29/09/2026 às 14:41:16 e 14:41:17 UTC. A consulta manual às 15:43 e a execução agendada às 16:00:26 UTC detectaram a mesma condição. Os itens pertencem a escritórios reais, não ao escritório sintético. Nenhum conteúdo, nome de arquivo, identificador de cliente ou chave de armazenamento foi copiado para este registro.

O erro persistido é a mensagem estática da aplicação “Armazenamento de documentos indisponível.” O adaptador de armazenamento substitui a causa original por essa mensagem; portanto, não é possível estabelecer retrospectivamente se houve falha de rede, permissão ou binding. A proximidade com um deploy é apenas uma hipótese. Os dois itens não foram reprocessados nem alterados durante a instalação do monitor.

Evidência do monitor agendado: execução `c9faeeb3-7c33-41f8-85ce-273e195aa5a8`, versão `8e9b4fa6-b255-44d5-bc96-6731745132be`, fila `vault.ingestion`, motivo `failed`, quantidade 2, idade do item mais antigo 79 minutos. A persistência do alerta demonstra detecção de falha terminal sem depender de reclamação de usuário. O resultado de filas permanece vermelho por uma causa real.

Próxima ação operacional: verificar acesso ao R2 pelo processador correspondente, correlacionar os logs das 14:41 UTC e reproduzir com um PDF sintético. Se for necessário reprocessar os itens afetados, usar a operação administrativa existente e conferir idempotência e resultado antes de encerrar. Não remover registros ou mudar estados diretamente para silenciar o alerta. A saída da janela de 24 horas do monitor não prova recuperação.

Verificação complementar às 16:30 UTC: um PDF criado para o teste, no escritório sintético, foi enviado pela API autenticada, chegou a `ready` com 60 caracteres extraídos e foi excluído pelo fluxo normal de proposta/aprovação. O teste terminou em cerca de 19 segundos. Isso demonstra funcionamento atual para esse PDF pequeno; não reproduz os documentos originais nem estabelece a causa histórica. Evidência local: `apps/web/.data/monitoring/pdf-result.json`.

Critério de encerramento: causa identificada ou diagnóstico limitado explicitamente aceito pelo responsável, correção demonstrada com arquivo sintético, tratamento dos dois itens afetados e duas verificações agendadas posteriores sem a condição original.
