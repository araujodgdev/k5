# Mensagens entre pessoas

O módulo Mensagens separa conversas entre pessoas do chat com o agente Lume. A caixa pertence ao usuário autenticado. Trocar o escritório ativo muda as sugestões de contatos e as opções do Cofre, sem transferir a caixa a outros membros.

## Destinatários e e-mail

Uma conversa pode começar pela seleção de um membro ou associado conhecido, ou por um endereço completo de e-mail. Um endereço comprovado pode resolver diretamente para a conta correspondente. Um endereço sem prova recebe a mensagem por e-mail, mesmo quando já existe um cadastro não verificado. A interface informa o canal antes do envio.

Os e-mails são somente de saída. Respostas por e-mail não voltam para o Lume nesta versão. Cadastrar uma conta com o mesmo endereço não importa mensagens antigas. O link recebido no endereço exige uma sessão da conta correspondente e um token válido de uso único. O aceite habilita mensagens futuras na conversa. Concessões de documentos são aceitas individualmente.

## Cofre

Compartilhar um documento concede leitura da versão escolhida. O arquivo continua no Cofre. O destinatário não recebe acesso ao caso, aos arquivos vizinhos, à pesquisa ou a versões posteriores. O compartilhamento pode ser revogado. Pré-visualização e download consultam a concessão atual no servidor. A saída do remetente do escritório mantém os acessos já aceitos, mas impede aceitar os pendentes. O escritório proprietário continua podendo revogar o acesso.

Compartilhar um caso cria um convite com a permissão escolhida. O destinatário precisa aceitá-lo pelo fluxo de colaboração. Ser associado ou participar de uma conversa não concede acesso ao caso.

As prévias do Cofre suportam imagens, PDF, DOCX e texto simples. Formatos sem visualização disponível oferecem download. O chat do WhatsApp também reproduz áudio e vídeo, conforme os [formatos aceitos](../apps/web/docs/integracao-whatsapp.md). A reprodução depende dos codecs disponíveis no navegador.

## Configuração do envio externo

O envio usa o [Cloudflare Email Service](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). Configure um domínio remetente no serviço e preencha somente no ambiente do servidor:

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_EMAIL_API_TOKEN=
TISES_MESSAGES_FROM=
BETTER_AUTH_URL=
K5_CREDENTIALS_KEY=
```

`TISES_MESSAGES_FROM` é o endereço remetente autorizado. `BETTER_AUTH_URL` é a origem pública dos links de aceite. A chave de credenciais protege os segredos temporários necessários à entrega. Nenhuma dessas chaves deve usar o prefixo `NEXT_PUBLIC_`.

O processo `pnpm integrations:worker` consome a fila de e-mails no ambiente Node. Na Cloudflare, o worker de integrações executa o mesmo processamento pela fila existente e pelo cron. Web e worker precisam das mesmas configurações de mensagens e chaves de criptografia. Não há endpoint para receber respostas por e-mail.

Mensagem e intenção de entrega são gravadas na mesma transação. Uma chave repetida não cria outra mensagem. Aceitação pelo provedor não comprova leitura ou chegada à caixa de entrada. Falhas ambíguas ficam como envio não confirmado e não são repetidas automaticamente. Ausência de configuração não deve ser apresentada como entrega concluída.

## Validação

Os testes usam usuários e escritórios isolados em PostgreSQL, com transporte externo controlado. A homologação real exige domínio autorizado e destinatários de teste consentidos. Testes locais não comprovam entrega real nem reputação do domínio.
