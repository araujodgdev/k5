# Portal do cliente

Em Escritório → Clientes → cliente, o Portal permite gerar um convite para um e-mail. Copie o link e envie ao cliente pelo seu canal habitual. O link é secreto, de uso único e válido por sete dias. Gerar um novo convite invalida o anterior e suspende o acesso aceito até novo aceite. Revogar o acesso bloqueia consultas, anexos e downloads imediatamente.

O cliente cria sua senha pelo convite ou entra com uma conta existente do mesmo e-mail. Better Auth controla senhas e sessões. A conta de cliente não cria um escritório e não recebe papéis da equipe. Uma pessoa pode ter acessos explícitos a vários clientes/escritórios, escolhidos no portal em `/client`.

Publique um PDF do computador ou uma versão salva de um documento do Lume. A publicação copia os bytes para armazenamento privado; uma edição posterior da minuta não altera o PDF entregue. Documentos internos, fontes, observações e casos do Cofre não aparecem automaticamente. Retirar um arquivo do portal bloqueia novos downloads, preservando seu registro interno.

Na cobrança de uma parcela, **Publicar cobrança no portal** libera seus dados de pagamento, saldo atual, PDF e boleto anexado. **Retirar cobrança do portal** remove essa publicação. Somente quem cadastrou o honorário pode publicá-lo. O comprovante do cliente fica disponível para conferência em seu cadastro; o advogado registra o recebimento manualmente em Honorários. Um comprovante não dá baixa automática.

Arquivos do cliente: PDF, DOCX, PNG e JPG, até 20 MB. Publicações do escritório: PDF, até 20 MB. O portal mostra os cem arquivos e cobranças mais recentes por cliente. O conteúdo de arquivos não é executado nem inserido nas conversas do Lume automaticamente.

A recuperação de senha usa tokens de uso único do Better Auth e encerra sessões anteriores. O envio precisa das configurações já utilizadas pelo serviço de e-mail: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` e `TISES_MESSAGES_FROM`. Sem remetente configurado, o formulário informa a indisponibilidade. Convites são compartilhados manualmente e não dependem desse remetente.

Downloads usam armazenamento privado, conferem o SHA-256 do arquivo e revalidam a sessão e o acesso depois de ler os bytes. O hash verifica integridade; não constitui uma assinatura eletrônica.
