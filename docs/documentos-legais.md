# Documentos legais do Lume

Versão inicial: 29/09/2026. Versão 1.1: 03/10/2026, com a Honcho (memória do assistente) na política de privacidade e nos termos. A versão e a data vêm de `apps/web/src/lib/legal-version.ts`. Rotas públicas, independentes de autenticação:

- `/termos-de-uso`
- `/politica-privacidade`

Os textos são originais e adaptados ao Lume. Razão social, CNPJ e endereço foram
obtidos das páginas e do rodapé do Check Time indicados pelo responsável:
[privacidade](https://checktime.com.br/politica-privacidade) e
[termos](https://checktime.com.br/termos-de-uso).
O endereço é o publicado no site, não uma certidão da sede cadastral.
Contato adotado por instrução do responsável: `info@lume.software`.

## Correspondência com o produto

| Assunto | Evidência no repositório |
| --- | --- |
| Contas, sessões e isolamento por escritório | `apps/web/README.md`, `apps/web/src/lib/session.ts` |
| Google, escopos e classificação de e-mails | `docs/integracao-google.md` |
| Cobrança e cancelamento | `apps/web/src/lib/billing/` |
| Diagnóstico com redução de dados | `apps/web/src/lib/observability/privacy.ts` |
| Infraestrutura e provedores | `docs/ambientes.md`, `apps/web/.env.example`, configurações Wrangler |

Os textos não oferecem SLA, certificações, autenticação multifator, armazenamento
exclusivo no Brasil, retenção zero em todos os fornecedores, restauração garantida,
exatidão de IA, cálculo de prazo judicial ou protocolo automático. Não criam uma
renúncia absoluta a reembolso e indenização. Não atribuem um DPO fictício.

O aceite é versionado. O cadastro e o convite do portal têm a caixa obrigatória
"Li e aceito…", e o servidor grava em `legal_acceptance` (migração 0069) a pessoa,
o documento, a versão, a data, o IP e o navegador. Quem não tem a versão atual
(`LEGAL_VERSION`, em `src/lib/legal-version.ts`) precisa aceitar de novo antes de
entrar, o que vale também para as contas já existentes. Não há consentimento para
marketing.

## Validação jurídica e operacional necessária

O código comprova comportamentos técnicos; não comprova contratos ou rotinas
administrativas. Antes de tratar os documentos como uma auditoria de conformidade,
o responsável deve validar:

1. A identidade cadastral, o endereço e o atendimento efetivo da caixa de contato.
2. A necessidade de designar e divulgar um encarregado e sua identidade.
3. A tabela operacional de retenção, limpeza de cópias e índices, backups, logs
   sujeitos ao Marco Civil e atendimento dos direitos nos prazos legais.
4. Os contratos dos operadores, países e mecanismos efetivamente adotados para
   transferências internacionais. O texto publicado não atesta assinatura de
   cláusulas-padrão com todos os fornecedores. A pesquisa, a decisão e o passo
   humano da Honcho estão na seção seguinte. A tabela de suboperadores nomeia
   o que a política publicada já lista.
5. As condições de IA, de retenção e de uso dos dados por cada provedor habilitado,
   sobretudo o uso limitado dos dados Google e eventuais intermediários.
6. A execução das obrigações de comunicação de incidentes e alterações materiais.

AbacatePay permanece fora do escopo de ativação em produção. A redação de cobrança
é condicionada à oferta e ao fluxo disponíveis; não afirma que a conta já está
habilitada para receber pagamentos reais.

## Honcho e transferência internacional

Leitura em 05/10/2026. O que está sob "Pesquisa" é o texto público lido nessa data.
O que está sob "Decisão" é o padrão que o operador autorizou gravar. Não é parecer
jurídico fechado e não é contrato assinado.

Nenhum DPA com a Plastic Labs foi assinado ou aceito por um clique. A busca por
um DPA público da Honcho não achou página de aceite. O painel descrito na
documentação da Honcho trata de chave de API e cobrança, sem controle de DPA.

### Pesquisa

A [política de privacidade da Honcho](https://app.honcho.dev/privacy) tem vigência
e última atualização em 24/04/2025. Os [termos](https://app.honcho.dev/tos) incorporam
essa política. A seção 1.3 dos termos diz que usar o serviço é aceitar os termos.
A seção 15.1 diz que os termos são o acordo integral. A seção 7.1 diz que a
Plastic Labs trata dados conforme a política. Isso é aceite dos termos pelo uso,
se a conta foi criada. Este repositório não guarda quem criou a chave de produção
nem um comprovante de clique. Aceite dos termos não é DPA.

A retenção publicada está na seção 6 da política e na seção 9.2 dos termos.

| Dado | Texto publicado |
| --- | --- |
| Conta e cobrança | Enquanto a conta está ativa, mais 90 dias |
| Logs de API | 90 dias. Saem do arquivo na AWS no 91º dia |
| Conteúdo do cliente | Configurável. O padrão é 90 dias. Hard-delete imediato no purge ou ao apagar o workspace |
| Cópias de segurança | Snapshots cifrados por 90 dias, sobrescritos em rodízio |
| Encerramento da conta | A seção 9.2 guarda os dados por 90 dias para retirada e depois apaga |

A seção 2 da política trata de dados desidentificados. A Plastic Labs inclui, na
melhoria do serviço, fine-tuning não público sobre dados desidentificados. A
mesma seção diz que não treina modelos públicos de linguagem com Customer Content
sem opt-in explícito.

A transferência está na seção 4 da política e na seção 7.5 dos termos. A
infraestrutura principal
está nos Estados Unidos. O cliente, ao usar o serviço, reconhece a transferência
para os Estados Unidos e para os países dos suboperadores da Honcho. A política
diz que a Plastic Labs ainda não aderiu ao EU-U.S. Data Privacy Framework. Diz
também que, se um mecanismo específico for exigido, como as cláusulas-padrão da
União Europeia ou o adendo do Reino Unido, a Plastic Labs o implementa antes de
aceitar esses dados. O texto não cita a LGPD nem as cláusulas-padrão da ANPD.
A seção 17 dos termos diz que o serviço não tem SOC 2 nem HIPAA.

A seção 3 da política lista os suboperadores da própria Honcho. Supabase, Fly.io,
Stripe, Groq, Anthropic, Google Cloud Platform, Vercel, Sentry, Langfuse, AWS e
PostHog. O Lume não tem contrato separado com cada um deles. Região e garantia
específica pedem-se a privacy@honcho.dev, como a própria política indica.

A [página da ANPD sobre transferência internacional](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados),
lida na mesma data, diz que a Resolução CD/ANPD nº 19, de 23/08/2024, aprova as
cláusulas-padrão do Anexo II e que elas entram no contrato sem modificação. A
mesma página diz que, até aquela leitura, a decisão de adequação publicada é a
da União Europeia, pela Resolução nº 32/2026. A página não lista os Estados
Unidos. Diz também que, até aquela leitura, o Conselho Diretor não tinha aprovado
cláusula-padrão equivalente, cláusula específica nem norma corporativa global.
A Resolução nº 19 dá 12 meses, contados da publicação, para quem já usava
cláusulas contratuais incorporar o Anexo II. O prazo contado de 23/08/2024
termina em 23/08/2025. Essa conta é aritmética da data publicada. Não é
conclusão de fiscalização.

### Decisão

O responsável autorizou, em 05/10/2026, gravar o seguinte para a memória enviada à
Honcho, Plastic Labs, Inc., 169 Madison Avenue, STE 2703, New York, NY 10016.
"Responsável" aqui é Douglas. Não é o operador do art. 5º, VII, da LGPD, que é
quem trata dados em nome do controlador. Os incisos abaixo foram lidos em
https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm na mesma data.

O mecanismo registrado é o art. 33, inciso II, alínea "b", da Lei nº 13.709/2018.
O texto a firmar é o Anexo II da Resolução CD/ANPD nº 19/2024, por inteiro e sem
alteração. As cláusulas ainda não foram firmadas. A lista de adequação lida na
ANPD não cobre os Estados Unidos, então o inciso I não é o mecanismo desta
transferência. Cláusula específica e norma corporativa global dependem de
aprovação prévia da ANPD, e a página lida não registra nenhuma. A Plastic Labs
não integra o grupo da Web Star Studio. A seção 7.5 dos termos da Honcho é o
reconhecimento do próprio cliente da Honcho. O consentimento específico e em
destaque do titular está no inciso VIII, e uma linha de memória pode carregar
dado de terceiro. O inciso VIII não foi o mecanismo escolhido. O inciso VI é
compromisso de acordo de cooperação internacional. O inciso VII é execução de
política pública ou atribuição legal de serviço público. O inciso IX remete aos
incisos II, V e VI do art. 7º. Nenhum desses três incisos foi usado como cobertura
desta transferência.

A retenção que o Lume passa a registrar é a da política lida. Cópias de segurança
por 90 dias, em rodízio. Conteúdo do cliente no padrão de 90 dias, com hard-delete
no purge ou na exclusão do workspace.

O uso de dados desidentificados que o Lume passa a registrar é o da seção 2.
Fine-tuning não público sobre dados desidentificados permanece como condição
publicada do serviço. A Web Star Studio não dá opt-in para treino de modelo
público. Isso não é uma proibição negociada do fine-tuning não público.

Situação. Decisão autorizada pelo responsável, pendente de aceite da contraparte.
O passo de Douglas é enviar o e-mail abaixo. A Plastic Labs ainda precisa firmar
as cláusulas. Não há DPA assinado.

A política publicada, versão 1.1, já descreve os 90 dias e o uso de dados
desidentificados. `LEGAL_VERSION` fica onde está, e os usuários não recebem novo
pedido de aceite por esta gravação. Nomear o art. 33, II, "b" na página pública,
antes de as cláusulas-padrão estarem firmadas, diria aos titulares que o contrato
já existe.

### Passo humano que falta

Douglas Araújo envia o e-mail abaixo. O remetente é o e-mail que entra na
organização Honcho da chave de produção. Este repositório não guarda esse
endereço. O rodapé do e-mail usa o contato já adotado, info@lume.software. Se os
dois endereços forem diferentes, o De é o da organização Honcho.

Destino. privacy@honcho.dev, com cópia para support@honcho.dev.

Assunto.

Lume / Web Star Studio. Pedido de cláusulas-padrão da ANPD para a conta de produção da Honcho

Corpo.

Plastic Labs, Inc.

Eu, Douglas Araújo, escrevo por WEB STAR STUDIO DESENVOLVIMENTO DE SOFTWARE LTDA, CNPJ 57.717.768/0001-06, controladora do Lume (lume.software). A conta de produção usa a API em https://api.honcho.dev.

Esta mensagem não é um DPA assinado. Peço resposta por escrito.

Aceito, para essa conta, as condições publicadas em https://app.honcho.dev/privacy (vigência 24/04/2025, lida em 05/10/2026) e em https://app.honcho.dev/tos.

Cópias de segurança. Snapshots cifrados por 90 dias, sobrescritos em rodízio, como na seção 6 da política.

Conteúdo do cliente. Prazo padrão de 90 dias, com hard-delete imediato no purge ou ao apagar o workspace, como na seção 6. No encerramento, a seção 9.2 dos termos guarda os dados por 90 dias para retirada e depois apaga.

Dados desidentificados. A seção 2 permite fine-tuning não público sobre dados desidentificados. A mesma seção diz que a Plastic Labs não treina modelos públicos de linguagem com Customer Content sem opt-in explícito. A Web Star Studio não dá esse opt-in.

Mecanismo. Peço que a Plastic Labs firme com a Web Star Studio as cláusulas-padrão do Anexo II da Resolução CD/ANPD nº 19, de 23/08/2024, por inteiro e sem alteração. Esse é o mecanismo do art. 33, inciso II, alínea "b", da Lei nº 13.709/2018. A página da ANPD lida em 05/10/2026 reconhece a União Europeia pela Resolução nº 32/2026 e não lista os Estados Unidos.

Até a Plastic Labs firmar essas cláusulas, o registro interno do Lume fica como decisão autorizada pelo responsável, pendente de aceite da contraparte.

I am writing for WEB STAR STUDIO DESENVOLVIMENTO DE SOFTWARE LTDA, CNPJ 57.717.768/0001-06, the company that provides Lume (lume.software). The production account uses https://api.honcho.dev.

This email is not a signed DPA. Please reply in writing.

For that account I accept the terms published at https://app.honcho.dev/privacy (effective April 24, 2025, read October 5, 2026) and https://app.honcho.dev/tos. Backups are encrypted snapshots kept for 90 days and overwritten on a rolling basis. Customer Content defaults to 90 days, with immediate hard-delete on a purge call or workspace deletion. On termination, section 9.2 keeps the data for 90 days for retrieval and then deletes it. Section 2 allows non-public fine-tuning on de-identified data. We do not opt in to training public language models on Customer Content.

Please execute, in full and without alteration, the Brazilian standard contractual clauses in Annex II of ANPD Resolution CD/ANPD No. 19 of August 23, 2024. That is the transfer mechanism under article 33, II, "b", of Law No. 13,709/2018. The ANPD page read on October 5, 2026 recognizes the European Union under Resolution No. 32/2026 and does not list the United States.

Until Plastic Labs executes those clauses, Lume's internal record stays "decision authorized by the responsible person, pending counterparty acceptance."

Douglas Araújo
info@lume.software
WEB STAR STUDIO DESENVOLVIMENTO DE SOFTWARE LTDA

## Suboperadores nomeados na política publicada

A política em `apps/web/src/app/politica-privacidade/page.tsx` nomeia os prestadores
abaixo. A tabela diz o que foi lido em 05/10/2026 e o que este repositório não
comprova. Aceite não verificado significa que a página pública existe e que
nenhum comprovante de assinatura ou clique está neste repositório.

O código em `apps/web/src/lib/ai-connections-core.ts` também admite os provedores
`deepseek`, `inception` e `vercel`. A política publicada não os nomeia. Ficam
fora desta tabela.

| Prestador | Papel na política | Instrumento lido em 05/10/2026 | Situação neste repositório | Próximo passo humano |
| --- | --- | --- | --- | --- |
| Honcho, Plastic Labs | Memória do assistente. Infraestrutura principal nos EUA | Política e termos citados acima. Sem DPA público | Decisão autorizada pelo responsável, pendente de aceite da contraparte | O e-mail da seção anterior. A Plastic Labs ainda precisa firmar as cláusulas |
| Cloudflare | Hospedagem, armazenamento, processamento e entrega | [DPA do cliente, versão 6.4, 03/04/2026](https://cf-assets.www.cloudflare.com/slt3lc6tev37/1TTgT35GoUNlKZYGuKWBFy/4e7dfc8cf402419a9b1cf624291fc69f/cloudflare_customer_dpa-v6.4_april_3_2026.pdf). O PDF diz que vale a partir da data em que o cliente assinou ou as partes concordaram | Aceite não verificado | Douglas confere, na conta Cloudflare do Worker `lume`, se esse DPA foi aceito |
| PlanetScale | Banco de dados | [DPA](https://planetscale.com/legal/data-processing-addendum), incorporado por referência ao acordo. `docs/processadores-cloudflare.md` localiza o PostgreSQL de produção em São Paulo. Local do disco não prova ausência de acesso fora do Brasil | Aceite não verificado | Douglas confere, na organização PlanetScale `araujodgdev/lume`, se esse DPA faz parte da conta |
| Sentry | Diagnóstico de erros | [DPA 5.1.0, 29/05/2024](https://sentry.io/legal/dpa/). O texto descreve aceite eletrônico | Aceite não verificado | Douglas confere, na organização Sentry `lume-wr`, se o DPA foi aceito |
| OpenAI | Provedor de IA possível. Há chamada direta em transcrição e embeddings | [DPA](https://openai.com/policies/data-processing-addendum/). O texto diz que o cliente concorda ao clicar em "I agree", ao aceitar o pedido ou ao usar o serviço | Aceite não verificado. Uso do serviço, no texto deles, pode valer como aceite. Este repositório não guarda o comprovante | Douglas confere na organização OpenAI qual caminho de aceite se aplica à chave em produção |
| Anthropic | Provedor de IA possível | [Central de ajuda, 16/03/2026](https://support.anthropic.com/en/articles/7996862-how-can-i-view-and-sign-your-data-processing-addendum-dpa). O DPA entra nos termos comerciais, e aceitar esses termos aceita o DPA. Uso por plataforma de terceiro segue os termos da plataforma | Aceite não verificado. Se a chamada passar pelo OpenRouter, o DPA da Anthropic pode não ser o contrato | Douglas confirma se a chave de produção chama a Anthropic direto ou por intermediário, e só então confere o aceite |
| Google | Integrações conectadas e, na lista de IA, Gemini | Já citado abaixo. Google API Services User Data Policy e a política de dados do Workspace. Esta leitura não achou, nestes documentos, um DPA da API aceito | Aceite de DPA não verificado | Douglas confere no projeto Google `lume-staging-509519` se há aceite de DPA além da política de dados de API já vinculada |
| OpenRouter | Provedor de IA possível | [Ajuda](https://openrouter.zendesk.com/hc/en-us/articles/47828437697051-How-do-I-get-OpenRouter-s-Data-Processing-Agreement-DPA-for-GDPR-compliance). DPA assinado só para conta enterprise, pelo Trust Portal `trust.openrouter.ai`. Conta self-serve pode pedir o portal para leitura. O acordo vale para enterprise | Aceite não verificado | Se a produção usar OpenRouter, Douglas decide se pede o plano enterprise para ter DPA assinado |
| TypeSafe | Classificação e pesquisa | [DPA, atualizado em 24/04/2026](https://typesafe.ai/legal/data-processing). Integra o acordo. A seção 6 incorpora cláusulas-padrão da União Europeia e o adendo do Reino Unido. Não cita as cláusulas da ANPD. A retenção do anexo é pelo tempo necessário à finalidade, sem número fixo de dias | Aceite não verificado | Douglas confere na conta TypeSafe se o acordo que incorpora esse DPA foi aceito |
| Exa | Pesquisa externa possível | A busca não achou DPA público. O trecho retornado de [https://exa.ai/privacy-policy](https://exa.ai/privacy-policy) diz que conteúdo tratado em nome do cliente segue o contrato do cliente. A página inteira não foi relida | Aceite não verificado | Se a Exa receber consulta real, Douglas pede o contrato de cliente |
| Zernio | WhatsApp, quando habilitado | [Política](https://zernio.com/privacy-policy), atualizada em 05/10/2026, de ZERNIO SOFTWARE SL, Palamós, Espanha. Não é um DPA. A seção 13 diz que pode haver transferência internacional com salvaguardas, sem nomear o art. 33. O texto lido não menciona WhatsApp | Aceite não verificado. O papel na política do Lume e o texto lido hoje não fecham | Douglas pede à Zernio, em miki@zernio.com, o instrumento da conta usada pelo Lume, a retenção e o mecanismo do art. 33 |
| AbacatePay | Cobrança, quando utilizada | [Termos e privacidade](https://www.abacatepay.com/termos), com checkbox no cadastro. Fora da ativação em produção, como acima | Sem passo enquanto a cobrança real estiver desligada | Nenhum, até a ativação |

## Fontes primárias consultadas

- [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).
- [Marco Civil da Internet](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm).
- [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm).
- [ANPD: transferências internacionais](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados), lida em 05/10/2026.
- [Resolução CD/ANPD nº 19, de 23/08/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).
- [Resolução ANPD nº 32, de 26/01/2026](https://www.in.gov.br/web/dou/-/resolucao-n-32-de-26-de-janeiro-de-2026-683334547), adequação da União Europeia.
- [Política da Honcho](https://app.honcho.dev/privacy) e [termos da Honcho](https://app.honcho.dev/tos), lidos em 05/10/2026.
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
- [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

As páginas incluem data, versão, metadados canônicos, índice com âncoras e estilos
para impressão pelo navegador. Os links ficam no rodapé da página inicial e nos
formulários de acesso, abrindo outra aba no formulário para preservar os campos.

## Verificação desta implementação

- `pnpm lint`: passou, com aviso preexistente sobre `_bytes` em
  `src/lib/judicial/connectors/transport.ts`.
- `pnpm typecheck` e `pnpm build`: passaram. O build teve aviso do cache do Turbo
  sobre o comprimento de um link de `mammoth` no Windows, sem falha de compilação.
- `pnpm test`: 639 de 646 passaram na execução completa; os sete casos de
  `agent-module-access.test.ts` falharam por timeout de conexão ao PostgreSQL.
  A repetição isolada desse arquivo passou nos sete casos.
- Navegador: páginas públicas em desktop e viewport de 390 px, âncoras válidas,
  ausência de overflow horizontal, navegação por teclado, alternância de tema e
  estilo de impressão sem cabeçalho/índice e com texto preto.
- O cadastro local retornou erro porque o PostgreSQL configurado em
  `127.0.0.1:55432` estava indisponível. `pnpm db:setup` também falhou nessa conexão.
  As páginas legais não dependem do banco.
- A verificação somente de leitura do esquema remoto pelo script
  `deploy-cloudflare.ts --check` passou; nenhuma migração foi aplicada nesta tarefa.
- `pnpm --filter @k5/web build:vinext` e o dry-run do Wrangler passaram.
- Publicado no Worker `lume`, versão `3f2341da-3a64-49aa-952e-90ffa7f4fea4`,
  com `--keep-vars --containers-rollout=none`. Segredos e imagens dos processadores
  foram preservados, conforme a [documentação do Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/workers/).
- As duas páginas e `/sign-up` responderam HTTP 200 em `lume.software`.
  O navegador confirmou os textos publicados e os links no cadastro, que funciona
  no ambiente remoto apesar da indisponibilidade do PostgreSQL local.
- As URLs foram salvas em Google Auth Platform → Branding, no projeto
  `lume-staging-509519`. O console confirmou “Branding changes saved!”.
  O aplicativo Google continua em Testing; esta alteração não solicita verificação
  nem muda escopos ou audiência.

Evidências visuais em `output/legal/privacidade-publicada.png` e
`output/legal/google-oauth-documentos.png`.
