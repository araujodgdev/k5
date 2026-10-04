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

Os links no cadastro são informativos. Esta alteração **não implementa registro
versionado de aceite**, checkbox obrigatório ou consentimento para marketing.
Um fluxo de aceite auditável exigirá persistência no servidor e tratamento de
novas versões, inclusive para contas já existentes.

## Validação jurídica e operacional necessária

O código comprova comportamentos técnicos; não comprova contratos ou rotinas
administrativas. Antes de tratar os documentos como uma auditoria de conformidade,
o responsável deve validar:

1. A identidade cadastral, o endereço e o atendimento efetivo da caixa de contato.
2. A necessidade de designar e divulgar um encarregado e sua identidade.
3. A tabela operacional de retenção, limpeza de cópias e índices, backups, logs
   sujeitos ao Marco Civil e atendimento dos direitos nos prazos legais.
4. Os contratos dos operadores, países e mecanismos efetivamente adotados para
   transferências internacionais. O texto não atesta assinatura de cláusulas
   padrão com todos os fornecedores.
5. As condições de IA, de retenção e de uso dos dados por cada provedor habilitado,
   sobretudo o uso limitado dos dados Google e eventuais intermediários.
6. A execução das obrigações de comunicação de incidentes e alterações materiais.

AbacatePay permanece fora do escopo de ativação em produção. A redação de cobrança
é condicionada à oferta e ao fluxo disponíveis; não afirma que a conta já está
habilitada para receber pagamentos reais.

## Fontes primárias consultadas

- [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).
- [Marco Civil da Internet](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm).
- [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm).
- [ANPD: transferências internacionais](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados).
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
