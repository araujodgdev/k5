# Integração com o Asaas

Objetivo: o escritório conecta a própria conta do Asaas, emite pelo Lume a cobrança de uma parcela de honorários (PIX, boleto ou cartão, à escolha do cliente) e recebe a baixa automática quando o Asaas confirma o pagamento.

Escopo decidido em 04/10/2026: conexão, emissão e baixa automática, nas contas de produção e de sandbox. Cada frente tem um commit, e as três vão no mesmo PR.

## Situação anterior

- O módulo Honorários registra parcelas e recebimentos informados pela pessoa. A cobrança da parcela (`src/lib/honorarios/charges.ts`) guarda uma chave PIX, instruções ou um boleto já emitido no banco e monta uma mensagem e um PDF. O Lume não emite PIX nem boleto, e cada recebimento é lançado à mão.
- O AbacatePay atende somente a assinatura do próprio Lume (módulo Plano). Não há conta de pagamento do escritório.
- A conexão do ChatGPT Ads (`src/lib/ads`) já guarda uma chave de API por escritório, criptografada com `K5_CREDENTIALS_KEY`, com verificação, versão otimista e auditoria. A integração removida da ZapSign recebia webhooks por escritório, identificados por um segredo na URL.

## Frente 1: conexão da conta

### Feito

- Migração `0071_asaas_connection.sql`: `asaas_connection`, com uma conta por escritório e a carteira (`wallet_id`) única entre escritórios, e `asaas_connection_audit`.
- `src/lib/asaas/provider.ts` é o cliente HTTP do Asaas. Envia os cabeçalhos `access_token` e `User-Agent`, tem prazo de 15 s e limita a resposta a 256 KB. Usa `redirect: 'manual'`, e os erros saem em pt-BR. A verificação lê `GET /myAccount/commercialInfo/` e `GET /wallets/`.
- `src/lib/asaas/service.ts` cuida de conectar, verificar de novo e desconectar. A sessão e o vínculo são revalidados antes e depois da chamada externa. Também expõe `asaasCredential()` para uso no servidor.
- O ambiente vem do prefixo da chave: `$aact_prod_` para produção e `$aact_hmlg_` para sandbox. Uma chave antiga, sem prefixo de ambiente, é testada primeiro em produção e depois no sandbox.
- A rota `/api/asaas/connection` aceita `GET`, `POST`, `PATCH` e `DELETE`, com o mesmo contrato da conexão de Anúncios.
- O painel "Asaas" em Integrações mostra a conta, o CPF ou CNPJ mascarado, o ambiente, a situação e a última verificação. Tem formulário de chave e confirmação de desconexão.
- A coluna `asaas_connection.encrypted_api_key` entrou na rotação de credenciais (`src/lib/credential-rotation.ts`).
- `tests/asaas.test.ts` cobre:
  - criptografia;
  - detecção de ambiente e chave antiga;
  - uma conta por escritório;
  - troca de conta recusada;
  - conflito de versão;
  - auditoria;
  - sessão revogada e vínculo removido, que não chegam a chamar o Asaas.

### Decisões

- **Sem OAuth:** o Asaas não oferece OAuth para contas de terceiros, então a conexão usa a chave de API do próprio escritório, colada uma vez e nunca devolvida ao navegador.
- **Identidade da conta:** a carteira identifica a conta. Trocar de conta exige desconectar antes, para que cobranças e clientes já criados não fiquem ligados à conta errada.
- **Dados guardados:** só nome, e-mail, CPF ou CNPJ mascarado, tipo de pessoa e situação da conta. Faturamento, endereço e telefone devolvidos pelo Asaas são descartados.
- **Sem flag de rollout:** a conexão vale para todos os escritórios e não altera nada fora do Lume.

### Pendente

- Nada nesta frente.

## Frente 2: cobrança Asaas da parcela

### Feito

- A migração `0072_asaas_charges.sql` cria duas tabelas:
  - `asaas_customer`: o cliente do escritório na conta conectada, sem CPF ou CNPJ;
  - `asaas_payment`: cobrança por parcela, com no máximo uma ativa (`creating` ou `open`) por parcela, chave idempotente por pessoa e lease da tentativa em andamento.
- `src/lib/asaas/charges.ts` consulta, emite, confere e cancela. Só quem criou o honorário age, no escritório ativo, com a sessão e o vínculo revalidados.
  - **Cliente:** reaproveitado pela referência `lume-cliente:<id>` ou criado com o CPF ou CNPJ informado. O número vai só ao Asaas e fica fora do hash de idempotência.
  - **Cobrança:** `POST /payments` com `billingType: UNDEFINED`, valor igual ao saldo atual da parcela e `externalReference: lume:<id>`.
  - **Resposta perdida:** se a criação fica sem resposta, a linha continua `creating` até o lease de 60 s vencer. "Conferir no Asaas", ou repetir a mesma chave, procura a cobrança pela referência e só reenvia se ela não existir.
  - **Recusa:** a cobrança recusada pelo Asaas (valor mínimo, CPF inválido…) fica `failed`, com o motivo, e libera uma nova emissão.
- A rota `POST /api/asaas/charges` tem as operações `get`, `create`, `cancel` e `confirm`. As rotas do Asaas usam `apiWorkspace`, que recusa contas do portal do cliente.
- A seção "Cobrança pelo Asaas" no formulário de cobrança da parcela emite, abre a fatura, copia o link, confere uma resposta perdida, cancela e mostra as cobranças anteriores.
- O link da cobrança aberta entra na mensagem montada por `src/lib/honorarios/charges.ts`, e com ela no portal do cliente.
- As cobranças do Asaas entram na exportação do escritório (`honorarios-cobrancas-asaas`).
- Testes em `tests/asaas.test.ts`, com o Asaas simulado de `tests/asaas-fake.ts`:
  - cadastro único do cliente e reemissão idempotente;
  - uma cobrança ativa por parcela;
  - resposta perdida com e sem criação no Asaas;
  - recusa e cancelamento;
  - isolamento entre escritórios.

### Decisões

- **Escolha do meio de pagamento:** `billingType: UNDEFINED` deixa o cliente escolher entre PIX, boleto e cartão na fatura do Asaas. O Lume não escolhe o meio nem replica QR Code ou linha digitável.
- **Avisos ao cliente:** os avisos do Asaas (e-mail e SMS) seguem a configuração da conta do escritório. O Lume não altera `notificationDisabled`.
- **Valor da cobrança:** o valor é o saldo da parcela no momento da emissão. Recebimentos manuais posteriores não alteram a cobrança já emitida.
- **Fora do assistente:** a emissão não foi publicada como capability para o assistente nem para o WebMCP, porque cria cobrança real na conta do escritório.

### Pendente

- Publicar a emissão para o assistente, com confirmação, se fizer sentido depois do uso real.
- Mostrar o link do Asaas como botão no portal do cliente, que hoje só exibe a mensagem.
