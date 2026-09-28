# WhatsApp Business

O Lume compartilha uma caixa de conversas individuais por escritório. A conexão usa o fluxo de coexistência da Zernio com o WhatsApp Business App. A elegibilidade do número e o histórico autorizado precisam ser conferidos no fluxo real do titular.

Administradores conectam e desconectam o número em Integrações. Administradores e advogados respondem a conversas existentes. Revisores consultam o histórico. O envio aceita texto ou um arquivo por mensagem, dentro das 24 horas posteriores à última mensagem recebida do cliente. Templates, grupos, campanhas, novos destinatários e respostas automáticas não fazem parte desta versão.

A caixa atualiza automaticamente enquanto está visível. Um botão de recuperação aparece apenas quando a atualização falha. A gestão da conexão fica em Integrações.

## Mídias e documentos

Arquivos são enviados como multipart autenticado à Zernio. O recebimento usa o identificador de mídia do webhook e a rota autenticada do provedor. Os bytes ficam no armazenamento privado do Lume; a interface recebe uma rota autorizada por sessão e escritório. Nenhuma chave de API ou URL pública de armazenamento vai ao navegador.

| Arquivo | Limite por envio |
| --- | --- |
| JPEG e PNG | 5 MB |
| MP4 e áudio MP3, OGG, AMR ou AAC | 16 MB |
| PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX e TXT | 25 MB |

Legendas aceitam até 1.024 caracteres. Áudio é enviado sem legenda. Imagens, áudio e vídeo têm controles no chat. PDF, DOCX e texto abrem uma pré-visualização. Formatos legados oferecem download. A reprodução depende dos codecs do navegador.

O backend confere tamanho, formato e conteúdo dos arquivos. Pacotes Office têm limites de expansão. A prévia Word fica isolada em um frame sem scripts ou recursos remotos. Arquivos expirados no provedor aparecem como indisponíveis; a caixa não inventa uma prévia para conteúdo que não recebeu.

## Configuração local

1. Configure `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `K5_CREDENTIALS_KEY` e `BETTER_AUTH_URL` em `.env.local`. A chave principal da Zernio fica no servidor. Cada escritório recebe um perfil e uma chave limitada às mensagens daquele perfil.
2. Configure `CLOUDFLARE_ACCOUNT_ID`, `FLAGSHIP_APP_ID` e `FLAGSHIP_EVALUATE_TOKEN`. Crie a flag booleana `whatsapp-integration`, com padrão `false`, e habilite os escritórios piloto pelo atributo `office_id`. O `targetingKey` também é o ID do escritório.
3. Execute `pnpm db:setup` na raiz. As migrações `0032_whatsapp.sql`, `0033_whatsapp_media.sql` e `0035_whatsapp_attachment_retries.sql` acrescentam as tabelas e preservam os anexos de tentativas anteriores. A migração `0034_personal_messages.sql` pertence ao módulo de mensagens pessoais.
4. Execute a aplicação e `pnpm integrations:worker`. O processo de integrações compartilha a fila persistida no PostgreSQL com o Worker da Cloudflare.
5. Cadastre na Zernio um webhook para `https://SEU_DOMINIO/api/whatsapp/webhook`, com o mesmo segredo configurado no servidor. Ative os eventos de mensagens, conversa e desconexão disponíveis para a conta.
6. Entre como administrador de um escritório liberado e use **Integrações → Conectar WhatsApp**. O callback verifica a sessão, o usuário, o perfil e a conta retornada pelo provedor antes de ativar a conexão.

As cotas locais padrão são 60 chamadas por minuto para a conta Zernio e 15 por escritório. Ajuste `K5_WHATSAPP_REQUESTS_PER_MINUTE` e `K5_WHATSAPP_OFFICE_REQUESTS_PER_MINUTE` ao contrato e ao tamanho do piloto. Elas não substituem os limites do provedor.

## Cloudflare

O web Worker e o Durable Object do chat recebem o ambiente WhatsApp por contexto da requisição. O staging usa o binding nativo `FLAGS`, com `getBooleanValue`, nos Workers `k5-staging` e `k5-integrations-staging`. Os dois arquivos Wrangler apontam para o app Flagship `lume-staging`, ID `2563a30d-9bc9-45e2-a06b-fafec09b879a`; esse binding dispensa token REST nos Workers. Processos Node usam as três variáveis de avaliação REST acima.

A flag `whatsapp-integration` tem as variações `disabled: false` e `enabled: true`, com `disabled` como padrão. Para liberar um escritório, adicione uma regra com o atributo `office_id` igual ao ID do escritório e a variação `enabled`. Sem regras, todos continuam desativados. O controle geral da flag deve estar ligado para avaliar as regras; desligá-lo retorna o padrão `false` para todos.

O web Worker produz notificações na fila `k5-integrations-staging`, por `INTEGRATIONS_QUEUE`. Provisione essa fila antes de publicar a configuração. O Worker de integrações a consome e também varre os jobs a cada minuto, recuperando notificações perdidas. As notificações só ocorrem depois do commit; o PostgreSQL continua sendo a fonte dos jobs, leases e resultados.

Configure os segredos necessários tanto no web Worker quanto no Worker de integrações. A chave de criptografia deve ser a mesma. `pnpm integrations:build` valida o bundle sem publicar. O deploy continua separado da validação local.

Web e integrações usam o mesmo binding privado `VAULT` para os anexos. O Wrangler de integrações declara o mesmo bucket R2 do web Worker. No Node, use a mesma configuração de armazenamento e o mesmo diretório persistente quando os processos estiverem na mesma máquina.

A flag é avaliada no servidor para abrir a caixa, consultar mensagens, criar ferramentas e enviar respostas. Ausência, erro ou timeout fecham o acesso. Desligá-la não apaga mensagens nem impede que o administrador desconecte a conta. A ingestão de contas já verificadas continua para preservar eventos durante uma interrupção do piloto.

## Mensagens e agente

Webhooks têm assinatura HMAC sobre os bytes originais, limite de tamanho e deduplicação por evento. O ACK só sai após gravar o evento cifrado e seu job na mesma transação. O processamento usa leases e compara a geração da conexão para descartar respostas antigas. Eventos atrasados não reativam contas. Edições, exclusões e estados de leitura são aplicados sem regredir fatos conhecidos.

O histórico é incremental e pode estar parcial. Paginação local usa cursores por conta e conversa. Consultas periódicas da interface leem o cache; importações são reservadas em jobs. A origem WhatsApp Business App é mostrada quando o provedor a informa.

Mastra e WebMCP expõem `k5_whatsapp_list_threads`, `k5_whatsapp_read_thread` e `k5_whatsapp_send` somente para escritórios liberados. As leituras passam pelo detector de instruções em conteúdo de terceiros. O envio pelo agente exige confirmação do destinatário e texto exatos. Ele usa o mesmo serviço da caixa, com papel, escritório, sessão, janela e conexão revalidados.

O MCP remoto da Zernio não recebe a chave principal nem é exposto integralmente ao agente. A implementação atual usa REST no adaptador. A substituição das leituras por MCP depende de validar seu catálogo autenticado; não muda a ingestão por webhook nem as regras de envio.

Cada intenção de envio tem uma UUID persistida. Repetir a intenção consulta seu resultado e não dispara outra mensagem. Timeout, queda de rede ou erro ambíguo após o despacho tornam o resultado **não confirmado**. Histórico vazio e coincidência de texto não provam falha. A operação só é reconciliada automaticamente por identificador exato retornado pelo provedor.

## Recuperação de credenciais

A criação de uma chave é reservada antes da chamada externa. Se a resposta se perder, `key_provisioning_state` fica `unknown`; uma queda do processo pode deixá-lo `pending`. Ambos bloqueiam novas criações. `key_operation_id` identifica o nome enviado ao provedor, `Tises-<profile_id>-<key_operation_id>`.

Um administrador da plataforma deve inspecionar `GET /api-keys` com a credencial proprietária da Zernio, correlacionando nome exato e perfil, e revogar as chaves daquela tentativa. `keyPreview` não é uma chave utilizável. Uma lista vazia não comprova que uma chamada ainda em voo falhou. Mantenha o bloqueio até concluir a reconciliação; só então altere o estado local para `none` e reinicie a conexão. Nunca copie uma chave de outro escritório ou amplie seu escopo para contornar o bloqueio.

Chaves substituídas ou conhecidas após uma tentativa cancelada são revogadas por jobs persistidos. Os eventos cifrados e credenciais participam da rotação do chaveiro existente. Esta versão preserva o histórico local após desconectar; a política de retenção deve ser definida antes de ampliar o piloto.

## Homologação

Os testes usam PostgreSQL real e respostas controladas nas fronteiras Zernio/Flagship. Eles não comprovam coexistência, elegibilidade ou entrega ao aparelho. Antes de liberar um número, confira a conexão no aplicativo e no Lume, o recebimento nas duas superfícies, o reflexo de uma resposta pelo aplicativo, os IDs de conversa entre REST e webhook e a desconexão.

A documentação da Zernio contém descrições conflitantes sobre o identificador da conversa WhatsApp. O adaptador segue `InboxWebhookConversation.platformConversationId` como o ID usado pela listagem e pelas operações REST. A homologação precisa confirmar isso com eventos reais, sem correlacionar conversas apenas por texto.

Fontes oficiais: [conexão hospedada](https://docs.zernio.com/connect/get-connect-url), [listagem de chaves](https://docs.zernio.com/api-keys/list-api-keys) e [Cloudflare Flagship](https://developers.cloudflare.com/flagship/).
