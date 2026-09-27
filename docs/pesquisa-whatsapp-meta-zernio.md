# WhatsApp Business no Tises: Meta e Zernio

Pesquisa em **27/09/2026**, para um SaaS jurídico multiescritório. Afirmações verificadas em fontes primárias; recomendações identificadas como inferências. Não houve implementação, criação de contas nem contato com fornecedores.

## Meta: fatos que mudam a decisão

### Conectar clientes é diferente de integrar um número próprio

Embedded Signup conecta os ativos de cada cliente ao aplicativo do provedor, mantendo sua propriedade com o cliente. Para clientes reais, o aplicativo precisa de App Review e acesso avançado às permissões necessárias, normalmente `whatsapp_business_management` e `whatsapp_business_messaging`. Business Verification, App Review e Access Verification elevam o limite de onboarding de 10 para 200 novos negócios por janela móvel de sete dias. Acima disso, a Meta orienta ingresso no programa de parceiros. Como Tech Provider, cada cliente adiciona sua forma de pagamento; Solution Partners podem compartilhar sua linha de crédito. Versões 2 e 3 do Embedded Signup serão descontinuadas em **15/10/2026**; usar v4 em integração nova. [Meta: Embedded Signup, atualização 24/07/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview).

Após a autorização, o backend deve trocar o código por token do cliente, assinar webhooks, registrar o número quando aplicável e concluir a cobrança. O botão de conexão sozinho não completa a integração. [Meta: onboarding Tech Provider, atualização 05/08/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider).

**Inferência para o Tises:** testar nosso próprio número não valida onboarding de dezenas de escritórios. O piloto precisa usar uma empresa cliente real, incluindo propriedade do número, permissões e cobrança.

### Preservar o app WhatsApp Business existente

**Coexistence** permite o mesmo número no app WhatsApp Business e na Cloud API. Exige Solution Partner ou Tech Provider e Embedded Signup configurado para esse fluxo. Com autorização da empresa, é possível sincronizar contatos e até seis meses de histórico individual. Mensagens 1:1 podem ser espelhadas entre ambos. Grupos existentes permanecem no app, mas **não são sincronizados**. Coexistência tem limite fixo de 20 mensagens/segundo. Listas de transmissão são desabilitadas; dispositivos vinculados são desconectados no onboarding e os compatíveis podem ser religados. Mensagens enviadas diretamente pelo app permanecem gratuitas; as da API seguem sua tarifação. A sincronização inicial deve ser solicitada em até 24 horas. [Meta: Coexistence, atualização 26/06/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

**Inferência:** manter número/app e validar histórico real são critérios do piloto. Não prometer grupos atuais ou importação integral de todo o histórico. Suporte da Meta não prova que um intermediário expõe o mesmo recurso.

### Escala possui limites distintos

- **Onboarding:** limite semanal de novos negócios citado acima.
- **Throughput por número:** Cloud API padrão comporta 80 mps e números elegíveis podem alcançar 1.000 mps automaticamente, sem cobrança adicional pela capacidade. Coexistência permanece em 20 mps. Conta entrada e saída. Webhooks produzem múltiplos eventos e a Meta tenta novamente entregas falhas por até sete dias. [Meta: throughput, atualização 17/06/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput).
- **Alcance:** limite de destinatários únicos fora da janela de atendimento, em 24 horas móveis, definido por portfólio empresarial. É separado do throughput; qualidade também importa. A infraestrutura da Cloud API escala dentro dos limites. [Meta: plataforma, atualização 04/08/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform).

**Inferência:** para escritórios, onboarding, filas, qualidade e isolamento entre clientes provavelmente exigirão atenção antes da vazão. Intermediários não removem limites Meta.

### Mudança de preços em outubro confirmada

A documentação técnica atualizada em 10/09/2026 anuncia, para **01/10/2026**, cobrança por entrega de serviço após **1.000 entregas gratuitas por número/mês**, sem acumulação, à tarifa de utilidade/autenticação do mercado. Templates de utilidade dentro de 24 horas também passam a cobrar. Sem pagamento, serviço deixa de ser entregue depois da franquia. A janela de atendimento não muda. Não foi extraído valor brasileiro verificado; orçar pela tabela de outubro. [Preços oficiais](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#updates-to-rate-cards).

A [página comercial](https://business.whatsapp.com/products/platform-pricing) ainda enfatiza gratuidade; a documentação técnica datada registra a atualização futura.

### Regras comuns

Fora de 24 horas desde a última mensagem do usuário, a empresa precisa de template aprovado; dentro da janela pode responder livremente. A política exige consentimento para contatos posteriores, respeito à saída e uma forma clara de encaminhar para atendimento humano quando houver automação. Ser cliente existente do escritório não dispensa essas regras. [Política oficial](https://business.whatsapp.com/policy/preview?lang=pt_BR).

**Inferência:** caixa de entrada, rascunhos assistidos e lembretes aprovados são um primeiro escopo útil. Controles para envio autônomo de conteúdo jurídico pertencem ao produto, independentemente do transporte.

## Verificação e pendências

- `README.md` lido; `docs/` já contém pesquisas semelhantes.
- O extrator web recebeu HTTP 429 da documentação técnica, mas as páginas foram lidas diretamente no navegador, no domínio oficial e sem login. As datas acima são as exibidas pela Meta.
- Confirmar no piloto elegibilidade do número real, sincronização, dispositivos utilizados pelo escritório, cobrança e migração/desconexão.
- Elegibilidade geral da API de grupos não foi pesquisada; a conclusão acima limita-se aos grupos existentes em coexistência.
- Edição documental; testes de aplicação não se aplicam.


## Zernio: integração, operação e custos

A Zernio documenta conexão pela Cloud API oficial, com Embedded Signup hospedado e opção de coexistência. O advogado precisa usar WhatsApp Business; o aplicativo pessoal não se qualifica. A coexistência espelha conversas individuais e pode sincronizar até seis meses de histórico, mas grupos existentes não entram na API. Há restrições adicionais no aplicativo, como listas de transmissão desabilitadas. O onboarding hospedado aceita pt-BR e mantém a marca Zernio. Estas capacidades foram verificadas na documentação, sem teste com conta real. [Conexão e coexistência](https://docs.zernio.com/platforms/whatsapp/connection)

A página comercial anuncia que o integrador não precisa passar pelo App Review próprio nesse fluxo. Isso reduz o trabalho inicial, mas não elimina as exigências de conta/número, as políticas da Meta e a homologação do produto. Não tratamos a promessa comercial de integração em minutos como prazo de implantação do Tises. [Apresentação do WhatsApp](https://my.zernio.com/whatsapp)

A organização para SaaS é por profiles, associados às contas conectadas. Chaves podem ser limitadas a profiles; o backend do Tises ainda deve resolver e conferir a relação com office_id. A documentação disponibiliza eventos de conexão/desconexão e consulta de saúde. Para WhatsApp, considerar um profile por número e permitir mais de um número no escritório. [Arquitetura para SaaS](https://docs.zernio.com/multi-tenant), [conexão WhatsApp](https://docs.zernio.com/platforms/whatsapp/connection)

### Valores observados em 27/09/2026

Cobrança progressiva das conexões: duas gratuitas; posições 3–10 a US$ 6/mês; 11–100 a US$ 3/mês; acima de 100 a US$ 1/mês. Cada número de WhatsApp conta como conexão. Para números próprios, mantidos o mês inteiro, sem outras redes conectadas:

| Escritórios, um número em cada | Conexões por mês |
| --- | ---: |
| 10 | US$ 48 |
| 100 | US$ 318 |
| 1.000 | US$ 1.218 |

Cálculos feitos a partir das faixas, sem tarifas Meta, câmbio/impostos, IA, infraestrutura ou números alugados. [Preços das conexões](https://docs.zernio.com/pricing)

A partir de **01/10/2026**, a Zernio cobra US$ 0,0001 por mensagem enviada acima de 10.000/mês. A franquia é da equipe inteira, compartilhada pelos escritórios; recebimento não é cobrado nesse medidor. Um total de 100.000 envios, por exemplo, adiciona US$ 9. Essa cobrança é separada das tarifas da Meta. [Preços de mensagens](https://docs.zernio.com/pricing/messages)

Segundo o fornecedor, as tarifas Meta são faturadas diretamente à conta WhatsApp Business e não recebem markup da Zernio. Usar número próprio dispensa aluguel de número pela Zernio; números provisionados por ela têm outra mensalidade. A página específica de custos ainda descreve a gratuidade Meta na janela de atendimento: não projetar essa descrição após setembro sem considerar a atualização primária da Meta registrada acima. [Custos WhatsApp](https://docs.zernio.com/platforms/whatsapp/pricing)

### Escala e confiabilidade

Os limites padrão publicados são 60 requisições/minuto para até duas contas, 600 para 3–2.000 e 1.200 acima disso, compartilhados pela equipe. Os headers podem indicar uma configuração superior. Estes são limites de requisições à Zernio, não de mensagens recebidas nem de destinatários permitidos pela Meta. Não multiplicar 600 pelo número de escritórios. [Limites da API](https://docs.zernio.com/guides/rate-limits)

A inbox deve ser alimentada por webhooks, com persistência própria, deduplicação por evento, processamento em worker e atualização de estados enviado/entregue/lido/falhou. A Zernio documenta assinatura HMAC e entrega pelo menos uma vez; aceitar uma requisição de envio não confirma entrega ao destinatário. [Inbox por cliente](https://docs.zernio.com/multi-tenant/inbox)

**Inferência para o Tises:** o maior limite inicial provavelmente será ativar escritórios sem mudar demais sua rotina. Em escala, testar picos agregados e justiça entre filas de escritórios. A API direta elimina a cota intermediária da Zernio, mas conserva limites, qualidade e políticas Meta. Não houve benchmark de latência ou disponibilidade de nenhum fornecedor.

### Dados e agente

A política pública da Zernio declara que não usa conteúdo acessado pela API/MCP para treinar modelos e prevê transferências internacionais. Ela não substitui a definição contratual de localização, retenção, eliminação de mensagens/anexos, subprocessadores e recuperação de incidentes para o nosso uso. Antes de um piloto com conteúdo jurídico real, esclarecer esses itens, o SLA e o procedimento de saída mantendo número e conta sob controle do escritório. [Privacidade](https://zernio.com/privacy-policy), [termos](https://zernio.com/tos)

A Zernio oferece MCP remoto, autenticado por OAuth ou API key. Isso viabiliza ferramentas do agente, mas não substitui recepção contínua por webhooks. [MCP](https://docs.zernio.com/mcp)

**Proposta para o Tises:** usar ferramentas próprias no Mastra, como listar conversas, sugerir resposta e preparar envio, passando pelo serviço autorizado do escritório. Manter credenciais no servidor, chave limitada ao profile quando aplicável, auditoria e revisão humana do envio no primeiro piloto. O contexto de conteúdo recebido deve continuar tratado como entrada de terceiros. Um MCP amplo não deve substituir as verificações de acesso do produto.

## Recomendação para o projeto

**Proposta, não decisão implementada:** começar com piloto Zernio se a prioridade for colocar a integração nas mãos de poucos escritórios e medir utilidade. Preferir Meta direta desde o início se a estratégia já exige controle integral do onboarding, operação e contratos, e houver capacidade para assumir esse trabalho. Nenhum número de clientes, isoladamente, obriga uma migração.

A base existente oferece CRM, casos e documentos no Cofre, isolamento de escritório, workers de integração e ferramentas Mastra com autorização compartilhada. A integração WhatsApp precisa acrescentar conexão por escritório/número, contatos, conversas, mensagens, anexos e estados de entrega; não existe somente por conectar um MCP. Evidência local: [README da aplicação](../apps/web/README.md), [sessão](../apps/web/src/lib/session.ts), [ferramentas do agente](../apps/web/src/lib/agent-tools/index.ts), [fila Google existente](../apps/web/src/lib/google/jobs.ts).

Manter um serviço de mensagens interno, com um adaptador inicial para o fornecedor escolhido, registros próprios e identificadores de origem. A interface e o agente usam esse serviço. Trocar o fornecedor também envolve permissões, número, webhooks e histórico; o adaptador reduz retrabalho, mas não garante migração automática ou sem interrupção.

O primeiro fluxo sugerido é receber conversas individuais, vincular cliente/caso, resumir histórico, transcrever áudio quando habilitado, sugerir respostas e enviar após revisão. Documentos escolhidos pelo advogado podem ser importados ao Cofre; não importar indiscriminadamente todo o histórico.

Critérios para encerrar o piloto: conectar número Business brasileiro já usado; validar espelhamento nos dois sentidos, áudio/documento, histórico elegível e restrições do app; testar desconexão, duplicidade e recuperação; medir tempo de ativação, chamadas por mensagem, pico agregado, custo por escritório e uso real. Considerar integração direta depois se ganhos de controle, cotas ou custo total justificarem a operação adicional.

Pesquisa documental. Não foram criadas contas, enviados dados a fornecedores ou implementada integração. Validação: leitura das fontes primárias, conferência aritmética e verificação dos caminhos locais. Testes da aplicação não se aplicam.
