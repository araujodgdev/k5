# Plano dos P0 do lançamento do MVP

Origem: [auditoria de 03/10/2026](auditoria-lancamento-mvp-2026-10-03.md) e decisões do responsável na mesma data. Uma frente por commit, todas na branch `feat/mvp-launch-p0`. Cada frente mantém a situação anterior para comparação.

## Frente 1 — Honcho na política de privacidade e nos termos

**Situação anterior.** A memória Honcho foi ativada em produção em 03/10 (`d5ca2fc`), mas não aparecia em `/politica-privacidade` nem em `/termos-de-uso`. Recebe linhas da memória de trabalho do Lume, que podem conter informações de clientes.

**Feito.** A versão 1.1 dos documentos legais, de 03/10/2026, passou a ficar centralizada em `src/lib/legal-version.ts`. Na política de privacidade, a seção de IA explica:
- o que a memória guarda;
- que as linhas novas vão para a Honcho (Plastic Labs, EUA), em espaços com identificadores opacos;
- que a separação entre memória e dados de clientes depende do modelo;
- como consultar e apagar a memória;
- as condições do fornecedor: backups de 90 dias e uso de dados desidentificados.

A Honcho também entrou na lista de destinatários. Nos termos, a seção de IA orienta a não pedir que a memória guarde dados de clientes.

**Pendente.** Contrato/DPA com a Honcho e confirmação do mecanismo de transferência internacional. As versões publicadas exigem aceite, que é feito na frente 7.

**Decisões.** O responsável optou por divulgar a Honcho como suboperadora em vez de desligá-la. Não existe botão para apagar a memória; o texto descreve o caminho real, que é pedir ao Lume na conversa.

## Frente 2 — Headers de segurança (clickjacking)

**Situação anterior.** `curl -I https://lume.software/sign-in` voltava sem HSTS, `X-Frame-Options`, CSP/`frame-ancestors`, `X-Content-Type-Options` e `Referrer-Policy`. `next.config.ts` só definia headers para `/sw.js`. As telas de aprovação (envio de e-mail, exclusão) podiam ser emolduradas por outro site.

**Feito.** Ficou comprovado que o `headers()` do `next.config.ts` não chega a produção: o `/sw.js` publicado também saía sem os headers declarados ali. Os headers agora são aplicados em `src/workers/web.ts` por `src/lib/security-headers.ts`: HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` e CSP `frame-ancestors 'self'`. Valores próprios das rotas são preservados, e a CSP de sandbox das pré-visualizações passa a conviver com a regra de framing. Os arquivos estáticos recebem os mesmos headers por `public/_headers`, que também passa a entregar os headers do `/sw.js`. Teste: `tests/security-headers.test.ts`.

**Pendente.** Depois do deploy, `curl -I` em `/sign-in`, `/app` e `/sw.js`. Avaliar uma CSP completa (scripts, conexões), que exige inventário de Sentry, Google Picker e fontes.

**Decisões.** O framing pela mesma origem continua permitido porque a pré-visualização de PDF usa `<iframe>`. Isso continua impedindo o clickjacking por outros sites. HSTS fica sem `preload`, que é difícil de desfazer.

## Frente 3 — Landing alinhada ao produto atual

**Situação anterior.** `src/app/page.tsx` prometia "Andamentos processuais" e "os andamentos do processo aparecem no mesmo caso". As fontes judiciais estão desabilitadas e o DJEN traz publicações, não andamentos. A página também falava em "prazos" sem indicar que são cadastrados pelo advogado, em "citações conferidas" como garantia e em "escritórios de 2 a 5 advogados", quando o modelo é de um advogado por escritório com associados por caso.

**Feito.** Ajustes em `src/app/page.tsx`:
- Pesquisa: saíram "Andamentos processuais" e "os andamentos aparecem no mesmo caso"; entraram "Busca rápida ou profunda" e "link da fonte para conferir".
- Lume: "Citações conferidas" virou "Citações com a fonte".
- Escritório: agora diz "os prazos que você cadastra" e "Prazos que você define".
- Público: "escritórios de 2 a 5 advogados" virou "advogados que dividem casos com colegas", e a seção de casos fala em colega que entra no caso e encontra os arquivos liberados.

Nenhuma outra página pública repetia essas promessas.

**Pendente.** Voltar a anunciar publicações quando o DJEN for homologado (frente 9).

**Decisões.** A landing só anuncia o que funciona em produção hoje. Andamentos dependem de outra fonte (DataJud ou tribunais) e não voltam junto com o DJEN.

## Frente 4 — Verificação de e-mail e créditos iniciais

**Situação anterior.** O cadastro era aberto, sem verificação de e-mail, e a troca de e-mail também não era verificada (`auth-core.ts:33`). Cada escritório novo recebia 850 créditos (`0061_credits.sql:20`). Pelos parâmetros dessa migração (crédito a R$ 0,10, margem de 30%, impostos de 6%, taxa de 3%, US$ 1 = R$ 5,50), isso equivale a cerca de US$ 9,40 de custo de provedor.

**Feito.**
- **Envio.** O subdomínio `notify.lume.software` já estava habilitado no Cloudflare Email Service (cota atual: 200 e-mails/dia). Produção não tinha token nem remetente configurados, então nem a recuperação de senha enviava e-mail. O Worker web passou a enviar pelo binding `send_email` `EMAIL`, sem token, restrito ao remetente `nao-responda@notify.lume.software` (`wrangler.jsonc`, `personal-chat/email-transport.ts`).
- **Verificação.** O Better Auth exige verificação onde há envio (`auth-core.ts`). O cadastro cria a conta e o escritório, mas não abre sessão. O link vale 24 horas, abre a sessão e volta ao destino original (app, convite ou portal). Tentar entrar sem verificar reenvia o link.
- **Interface.** A tela "Confira seu e-mail" aparece no cadastro e no portal do cliente, e `EMAIL_NOT_VERIFIED` tem mensagem própria.
- **Limites e créditos.** O reenvio de verificação ficou limitado a 3 por minuto, para proteger a cota diária; o cadastro manteve 10 por minuto, porque 5 barrava fluxos legítimos (o Turnstile, em implementação em outra sessão, cobre o abuso). A migração `0068` dá as contas existentes como verificadas e reduz os créditos iniciais para 500.
- **Testes.** `tests/auth.test.ts` (fluxo completo) e `tests/personal-chat-email.test.ts` (binding).

**Pendente.** Depois do deploy, criar uma conta real e confirmar a entrega e o link. Avaliar o aumento da cota de 200 e-mails/dia antes de abrir ao público. Turnstile no cadastro. Exigir confirmação também na troca de e-mail.

**Decisões.** Cadastro continua aberto, agora com verificação de e-mail, enviada pela Cloudflare. Sem remetente configurado (ambiente local e e2e), a verificação fica desligada, para não criar contas que ninguém consegue confirmar. Contas existentes foram consideradas verificadas para não bloquear quem já usa. Com os parâmetros da `0061`, 500 créditos equivalem a cerca de US$ 5,55 de custo de provedor; o teto de US$ 10 corresponderia a cerca de 900 créditos. Créditos iniciais: 500, abaixo do teto de US$ 10 por conta nova.

## Frente 5 — Restauração ensaiada

**Situação anterior.** Não havia restauração ensaiada de PostgreSQL, R2, chaves e índices.

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** Adiada pelo responsável para depois das demais frentes.

## Frente 6 — Incidente LUME-1E (ingestão de PDF)

**Situação anterior.** Duas ingestões de escritórios reais falharam em 29/09 às 14:41 UTC com a mensagem fixa "Armazenamento de documentos indisponível.". `readVaultOriginal` descartava a causa e qualquer falha de leitura do original deixava o documento em `failed`, sem nova tentativa.

**Feito.** A causa foi identificada nos logs do Workers Observability: um deploy reiniciou o Durable Object do processador, e o `ContainerProxy` da versão nova respondeu 403 às leituras do container que ainda estava em execução. Detalhes em [incidente](incidents/2026-09-29-vault-ingestion.md). Falhas de armazenamento agora preservam a causa na telemetria e voltam para a fila com espera de 1, 5 e 15 minutos antes de virar `failed` (`0067_vault_ingestion_retry.sql`, `src/lib/vault.ts`, `queue-health.ts`). Teste: `tests/vault-ingestion-retry.test.ts`.

**Pendente.** Publicar. Reprocessar os dois documentos ("Tentar novamente") e confirmar duas verificações agendadas sem a condição.

**Decisões.** Não reprocessar documentos de clientes sem o responsável; ele fará o teste manual após o deploy.

## Frente 7 — Exportação e exclusão, aceite versionado e aviso de IA

**Situação anterior.**
- Não havia exportação nem exclusão dos dados do escritório pela interface.
- O cadastro tinha links informativos para os termos, mas o servidor não registrava qual versão foi aceita nem quando (`docs/documentos-legais.md`).
- O primeiro uso do Lume não avisava que o conteúdo enviado chega aos provedores de IA sem anonimização.
- Criptografia do Cofre: os originais ficam no R2 e o texto extraído no PostgreSQL (PlanetScale). Os dois provedores cifram os dados em repouso com chaves que eles mesmos gerenciam. Não existe cifra na aplicação por escritório. As credenciais de integrações usam AES-256-GCM na aplicação.

**Feito.**
- **7A — aviso de IA.** No primeiro acesso a `/app/agents`, a tela "Antes de usar o Lume" substitui o chat até a pessoa clicar em "Entendi". Ela explica que o que é escrito, anexado e consultado vai aos provedores de IA sem anonimização, pede cuidado com sigilo, base legal e dados sensíveis, e lembra de conferir as respostas (`components/legal-gate.tsx`). A ciência fica registrada com a versão do aviso.
- **7B — aceite versionado.** A tabela `legal_acceptance` (`0069`) registra pessoa, documento, versão, data, IP (o da borda Cloudflare) e navegador. O cadastro e o convite do portal têm a caixa obrigatória "Li e aceito…", e o servidor grava a versão marcada (`auth-core.ts`). Quem não tem a versão atual vê "Antes de continuar" ou "Atualizamos os termos" antes de `/app` e de `/client`. Basta subir `LEGAL_VERSION` para pedir novo aceite a todos. Testes: `tests/auth.test.ts`; e2e `e2e/legal-acceptance.e2e.ts` (passou no verify-k5, desktop e 390 px).

- **7C — exportação.** Em Perfil → Seus dados, "Exportar dados" baixa um ZIP gerado em streaming (`/api/office/export`, `lib/office-export.ts`, dependência `client-zip`). Ele traz `dados/*.jsonl` com colunas listadas uma a uma, os originais do Cofre por caso, a memória e um LEIA-ME. Se um original estiver indisponível, entra um aviso no lugar e a exportação continua. Teste: `tests/office-export.test.ts`.
- **7D — exclusão.** "Excluir conta" pede a senha atual e agenda a exclusão com 7 dias para cancelar (`/api/office/deletion`, `0070`). O expurgo é feito pelo operador com `pnpm --filter @k5/web office:purge list | dry-run | run`, que só aceita pedidos vencidos. Ele apaga as tabelas com `office_id` na ordem das FKs, enfileira originais e vetores, apaga a memória (inclusive na Honcho) e anonimiza a conta. Ficam guardados pagamentos, a auditoria da plataforma, o registro de aceite e o próprio pedido. Runbook em [exclusao-de-escritorio.md](exclusao-de-escritorio.md). Testes: `tests/office-deletion.test.ts`; e2e `e2e/office-data.e2e.ts` (passou no verify-k5, a 390 px).

**Pendente.** O e2e do portal (`client-portal.e2e.ts`) depende de conversão de PDF e não roda no verify-k5; fica para a CI.

**Decisões.**
- O expurgo não roda automaticamente enquanto não houver restauração ensaiada (frente 5): um erro ali não tem volta. A conta é anonimizada em vez de apagada, porque mensagens e participações em casos de outros escritórios também pertencem a eles.
- A senha confirmada no pedido de exclusão ainda não tem limite de tentativas próprio. Para tentar senhas por ali, seria preciso já ter uma sessão válida.
- Aceite dos termos e ciência do aviso de IA ficam na mesma tabela, com documentos distintos.
- O aviso aparece no módulo Lume e não em outros pontos com IA (e-mails, documentos), conforme pedido. A API do chat não bloqueia quem ainda não deu ciência; a barreira é a tela.
- Criptografia do Cofre: os originais (R2) e o texto extraído (PostgreSQL) ficam cifrados em repouso pelos provedores, com chaves deles. Cifra por escritório na aplicação protegeria contra acesso indevido ao bucket ou ao banco, mas não contra a própria aplicação. Para o texto extraído, impediria a busca textual no PostgreSQL. A recomendação é cifrar na aplicação só os originais no R2, com chave por escritório (envelope), em frente própria depois da restauração ensaiada, porque perder a chave significa perder os documentos.

## Frente 8 — Prompt injection: filtro fail-closed

**Situação anterior.** `agent-guard.ts` liberava o resultado da ferramenta quando o detector falhava (`catch { return; }`). Também não examinava `k5_knowledge_search` nem as buscas executadas pelo próprio provedor, e lia só os primeiros 32 mil caracteres.

**Feito.** Mudanças em `src/lib/agent-guard.ts`:
- **Fail-closed.** Se o detector falhar, o resultado é retido com `UNVERIFIED_NOTICE`.
- **Texto longo.** São examinados até 128 mil caracteres (16 blocos em paralelo). Acima disso, o resultado é retido inteiro com `TOO_LONG_NOTICE`, para não ser lido pela metade.
- **Documentos do escritório.** `k5_knowledge_search` e `k5_knowledge_get_source` entraram na verificação, porque a peça da parte contrária também é texto de terceiros.
- **Turno contaminado.** Qualquer resultado verificado, e qualquer busca executada pelo provedor (que não passa pelo hook), marca `context.untrustedContent.seen`. A partir daí, ações Google em modo `automatic` passam a pedir confirmação (`google/operations.ts`).

Envio de e-mail e WhatsApp, Mensagens, estornos e exclusões já exigiam confirmação. Testes em `tests/agent-capabilities.test.ts` e `tests/google-foundation.test.ts`. A suíte completa passou: 758 de 758.

**Pendente.** Acompanhar a taxa de retenção (`lume.guard.withheld`) nos documentos do Cofre e o custo/latência extra do classificador por turno. As buscas executadas pelo provedor continuam sem verificação de conteúdo; a defesa nelas é a confirmação das ações.

**Decisões.** O responsável antecipou esta frente de P1 para P0. Falso positivo (documento legítimo retido) foi preferido a falso negativo. Registros internos sem efeito externo, como criar cliente ou registrar recebimento, continuam sem confirmação.

## Frente 9 — Plano competitivo (Jusfy e Projuris)

**Situação anterior.** A auditoria listou as lacunas, mas sem desenho nem sequência.

**Feito.** O plano em [plano-competitivo-jusfy-projuris.md](plano-competitivo-jusfy-projuris.md) foi proposto pelo Codex (gpt-6.1-sol, esforço high) e revisado pelo Claude. Ele traz nove lacunas com o que já existe no código, o mínimo viável, o esforço e o critério de aceite, além de ondas de 0–30, 30–90 e 90–180 dias e uma lista do que não fazer.

**Pendente.** Decisão de preço (R$ 199 contra Jusfy Ultimate a R$ 117) e escolha do tribunal piloto pela carteira dos primeiros usuários.

**Decisões.** A prioridade é fechar o ciclo publicação → revisão → tarefa/prazo → documento → cliente antes de calculadoras, acervo e financeiro. O DJEN começa pela captura por OAB, se a homologação confirmar o filtro. O cálculo de prazo é determinístico, nunca feito por LLM, e sempre confirmado pelo advogado.
