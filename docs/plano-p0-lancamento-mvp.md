# Plano dos P0 do lançamento do MVP

Origem: [auditoria de 03/10/2026](auditoria-lancamento-mvp-2026-10-03.md) e decisões do responsável na mesma data. Uma frente por commit, todas na branch `feat/mvp-launch-p0`. Cada frente mantém a situação anterior para comparação.

## Frente 1 — Honcho na política de privacidade e nos termos

**Situação anterior.** A memória Honcho foi ativada em produção em 03/10 (`d5ca2fc`), mas não aparecia em `/politica-privacidade` nem em `/termos-de-uso`. Recebe linhas da memória de trabalho do Lume, que podem conter informações de clientes.

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** O responsável optou por divulgar a Honcho como suboperadora em vez de desligá-la.

## Frente 2 — Headers de segurança (clickjacking)

**Situação anterior.** `curl -I https://lume.software/sign-in` voltava sem HSTS, `X-Frame-Options`, CSP/`frame-ancestors`, `X-Content-Type-Options` e `Referrer-Policy`. `next.config.ts` só definia headers para `/sw.js`. As telas de aprovação (envio de e-mail, exclusão) podiam ser emolduradas por outro site.

**Feito.** Ficou comprovado que o `headers()` do `next.config.ts` não chega a produção: o `/sw.js` publicado também saía sem os headers declarados ali. Os headers agora são aplicados em `src/workers/web.ts` por `src/lib/security-headers.ts`: HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` e CSP `frame-ancestors 'self'`. Valores próprios das rotas são preservados, e a CSP de sandbox das pré-visualizações passa a conviver com a regra de framing. Os arquivos estáticos recebem os mesmos headers por `public/_headers`, que também passa a entregar os headers do `/sw.js`. Teste: `tests/security-headers.test.ts`.

**Pendente.** Depois do deploy, `curl -I` em `/sign-in`, `/app` e `/sw.js`. Avaliar uma CSP completa (scripts, conexões), que exige inventário de Sentry, Google Picker e fontes.

**Decisões.** O framing pela mesma origem continua permitido porque a pré-visualização de PDF usa `<iframe>`. Isso continua impedindo o clickjacking por outros sites. HSTS fica sem `preload`, que é difícil de desfazer.

## Frente 3 — Landing alinhada ao produto atual

**Situação anterior.** `src/app/page.tsx` prometia "Andamentos processuais" e "os andamentos do processo aparecem no mesmo caso". As fontes judiciais estão desabilitadas e o DJEN traz publicações, não andamentos. A página também falava em "prazos" sem indicar que são cadastrados pelo advogado, em "citações conferidas" como garantia e em "escritórios de 2 a 5 advogados", quando o modelo é de um advogado por escritório com associados por caso.

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** —

## Frente 4 — Verificação de e-mail e créditos iniciais

**Situação anterior.** O cadastro era aberto, sem verificação de e-mail, e a troca de e-mail também não era verificada (`auth-core.ts:33`). Cada escritório novo recebia 850 créditos (`0061_credits.sql:20`). Pelos parâmetros dessa migração (crédito a R$ 0,10, margem de 30%, impostos de 6%, taxa de 3%, US$ 1 = R$ 5,50), isso equivale a cerca de US$ 9,40 de custo de provedor.

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** Cadastro continua aberto, agora com verificação de e-mail, enviada pela Cloudflare. Créditos iniciais: 500, abaixo do teto de US$ 10 por conta nova.

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

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** —

## Frente 8 — Prompt injection: filtro fail-closed

**Situação anterior.** `agent-guard.ts` liberava o resultado da ferramenta quando o detector falhava (`catch { return; }`). Também não examinava `k5_knowledge_search` nem as buscas executadas pelo próprio provedor, e lia só os primeiros 32 mil caracteres.

**Feito.** —

**Pendente.** Toda a frente.

**Decisões.** O responsável antecipou esta frente de P1 para P0.

## Frente 9 — Plano competitivo (Jusfy e Projuris)

**Situação anterior.** A auditoria listou as lacunas, mas sem desenho nem sequência.

**Feito.** —

**Pendente.** Consolidar com o Codex (gpt-6.1-sol, esforço high).

**Decisões.** —
