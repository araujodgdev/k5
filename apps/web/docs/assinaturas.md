# Assinaturas de documentos

A conexão ZapSign fica em Integrações e só administradores a configuram. Use uma conta com acesso à API e a chave correspondente ao ambiente escolhido. Comece pelo sandbox. A chave fica cifrada com o chaveiro `K5_CREDENTIALS_KEY`, incluindo a rotação existente. Desativar novas solicitações mantém a consulta e o arquivamento das já enviadas.

No Portal do cliente, publique o PDF final e aguarde o aceite do convite. Em Assinaturas, escolha um PDF publicado de até 10 MB e a autenticação por assinatura na tela com código por e-mail ou por certificado digital do cliente. **Enviar PDF para assinatura** transmite o PDF privado em base64 à ZapSign e solicita ao provedor o envio de e-mail para o destinatário do portal. Há um destinatário por solicitação nesta versão. A modalidade com certificado exige certificado compatível e disponibilidade na conta do provedor; o Lume não emite certificados nem recebe suas chaves privadas. Custos e limites são os do contrato do escritório com a ZapSign.

O cliente abre **Assinar na ZapSign** dentro do portal. A autenticação e o aceite acontecem no provedor. **Atualizar assinatura**, disponível para cliente e escritório, consulta o resultado pela API autenticada. Esta versão não usa webhooks ou consulta automática em segundo plano. Ao confirmar a conclusão, o Lume guarda os bytes do PDF assinado em armazenamento privado, sem reexportar o documento, e disponibiliza o PDF e um JSON de evidências. O JSON contém identificador da solicitação e do provedor, método solicitado, ambiente, datas, hashes dos arquivos e histórico de consulta. O PDF conserva o relatório e as evidências que o provedor incluiu nele.

Uma publicação origina no máximo uma solicitação. Repetir a ação não envia outra solicitação ao provedor. Se o resultado do envio for desconhecido, aparece **Envio sem confirmação**. O Lume não reenvia automaticamente: confira na conta ZapSign o ID externo mostrado e vincule o token do documento existente. O vínculo verifica ID, destinatário, método, ambiente e hash do PDF original. Se nenhum documento tiver sido criado, confira isso com o provedor antes de publicar uma nova cópia e solicitar novamente.

**Cancelar solicitação** pede a exclusão definitiva da solicitação na ZapSign após confirmação na interface. Um PDF já assinado é preservado. Revogar o portal ou retirar sua publicação bloqueia o acesso no Lume; isso não cancela um link externo de assinatura já recebido. Para interromper uma solicitação em aberto, cancele-a no provedor pelo botão antes de revogar o portal.

O status **Assinado no provedor** registra a confirmação da API e o arquivamento do PDF. O Lume não executa validação criptográfica independente da cadeia ICP-Brasil nem classifica uma assinatura por e-mail como qualificada. Quando essa validação for necessária, confira o PDF no [VALIDAR do ITI](https://validar.iti.gov.br/). SHA-256 é uma conferência de integridade, não uma assinatura.

## gov.br

Existe uma API gov.br, mas a [solicitação oficial de credenciais](https://manual-integracao-assinatura-eletronica.servicos.gov.br/pt-br/latest/iniciarintegracao.html) exige gestor público, integração prévia ao Login Único e domínio oficial para produção. O Lume privado não deve presumir acesso a essa API. Uma integração direta depende de autorização e homologação do órgão competente.

O portal oferece o fluxo manual: baixar o PDF, assinar no [Assinador gov.br](https://assinador.iti.br/) com conta prata ou ouro e devolver o PDF pelo formulário de arquivos. O advogado confere o documento no VALIDAR e seu conteúdo antes de aceitá-lo. Um arquivo enviado pelo cliente não muda o status de uma solicitação ZapSign para assinado.

## Verificação

`tests/signatures.test.ts` executa as operações contra PostgreSQL e armazenamento privados reais, usando um transporte simulado somente na fronteira externa ZapSign. A verificação inclui timeout sem reenvio, vínculo e integridade na recuperação, certificado, arquivamento, credenciais cifradas, permissões e revogação durante download. `tests/credential-rotation.test.ts` cobre a rotação da chave de API e do link de assinatura pelo proprietário transacional e pela rota autenticada de administração.

A publicação em produção exige a conta real do escritório, sua chave de API e uma homologação no sandbox com os métodos habilitados no plano. Os testes locais não usam créditos do provedor nem enviam e-mail a clientes reais.

Referências da API: [criar PDF por upload](https://docs.zapsign.com.br/documentos/criar-documento), [consultar documento](https://docs.zapsign.com.br/documentos/detalhar-documento), [ambiente de testes](https://docs.zapsign.com.br/ambiente-de-testes), [excluir documento](https://docs.zapsign.com.br/documentos/excluir-documento).
