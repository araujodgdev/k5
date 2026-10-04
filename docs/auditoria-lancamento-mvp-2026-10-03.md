# Auditoria de prontidão para lançamento do MVP — 03/10/2026

Auditoria conjunta e independente de Claude (Opus 5.5) e Codex (gpt-6.1-sol, esforço xhigh). Cada um auditou sozinho e depois discutimos as divergências até chegar a um consenso. Foram feitas leitura de código, documentação, migrações e testes, uma checagem HTTP em `https://lume.software`, `pnpm audit --prod` e consulta às páginas oficiais da Jusfy e da Projuris. Nenhum arquivo de aplicação foi alterado, e não consultamos o banco nem as configurações privadas de produção.

## Veredito consensual

**NO-GO hoje para abertura pública ou lançamento pago.**
**GO condicional para um beta fechado, gratuito e por convite, com 10 a 20 advogados autônomos** (de preferência com trabalho consultivo e documental), depois de cumpridos os P0 abaixo. A segunda onda passa a ser paga quando houver uma cobrança real comprovada de ponta a ponta.

Promessa comercial adequada: **"assistente para trabalhar com os documentos e a rotina dos seus casos"**. "Gestão completa do escritório", "andamentos processuais", "não perca prazos" e "citações conferidas" como garantia geral vão além do que o produto entrega hoje.

## O que está sólido

- **Isolamento por escritório.** O workspace vem da sessão (`apps/web/src/lib/session.ts:11`, `src/lib/workspace-api.ts:19`). As capabilities validam de novo a sessão, o escritório e a participação no caso (`src/lib/application/context.ts:45`, `src/lib/collaboration/access.ts:11`). Nas amostras, o registro é carregado com escopo antes de qualquer alteração por id (`application/runs-service.ts:35-46`, `uploads-service.ts:105-121`). Nenhum IDOR foi demonstrado nos caminhos inspecionados.
- **CSRF.** A verificação de origem é centralizada para capabilities de escrita (`src/lib/capability-route.ts:18-21`, `trusted-origins.ts`).
- **Autenticação.** Há rate limit em sign-in, sign-up e reset usando `cf-connecting-ip`. A sessão não usa cache de cookie, a revogação é imediata e existe logout global (`src/lib/auth-core.ts:39-66`).
- **Agente.** Ações destrutivas ou externas pedem confirmação humana. A política padrão do Google é de confirmação, e o modo `automatic` só é ativado por escolha explícita, com teto diário (`google/policy.ts:42`, `google/operations.ts:140`). Cada turno tem orçamento (`agent-budget.ts`).
- **Credenciais.** São cifradas com AES-256-GCM, há rotação documentada e o transporte judicial tem proteção contra SSRF.
- **Operação.** Sentry, check-ins de cron, monitor de 15 filas e jornadas sintéticas a cada 15 minutos (`docs/observability-readiness-2026-09-29.md`). A CI está verde, com cerca de 110 arquivos de teste e 27 cenários e2e.

## P0: bloqueadores (ordem consensual)

| # | Item | Evidência | Critério de saída |
|---|---|---|---|
| 1 | **Governança de dados / Honcho.** A memória Honcho foi ativada em produção (`d5ca2fc`; `docs/plano-refinos-agente-memoria-e-revisao.md:246`), mas não consta da política de privacidade (`app/politica-privacidade/page.tsx:43`). Recebe linhas derivadas de conversas sobre clientes (`src/lib/honcho-memory.ts:31,108`), e a política da Honcho prevê infraestrutura nos EUA, backups de 90 dias e fine-tuning com dados desidentificados. Os contratos com operadores e as transferências internacionais estão pendentes (`docs/documentos-legais.md:43`). | Interromper os envios. Inventariar o que já foi enviado e tratar a exclusão remota; desligar a chave também para o processamento de exclusões (`honcho-memory.ts:223-225`). Documentar DPA/subprocessadores, transferências e retenção na política. |
| 2 | **Clickjacking / headers.** `curl -I https://lume.software/sign-in` voltou sem HSTS, `X-Frame-Options`, CSP/`frame-ancestors`, `nosniff` e `Referrer-Policy`. O `next.config.ts:19-29` só define headers para `/sw.js`. As telas de aprovação (envio de e-mail, exclusão) podem ser emolduradas. | Comprovar, por GET nas páginas autenticadas do Worker publicado, `frame-ancestors 'none'` ou `X-Frame-Options: DENY`, além de HSTS, `nosniff` e `Referrer-Policy`. |
| 3 | **Oferta pública fiel.** A landing promete "ANDAMENTOS PROCESSUAIS" e "os andamentos aparecem no mesmo caso" (`app/page.tsx:48`), "prazos", "citações conferidas" e "escritórios de 2 a 5 advogados". As fontes judiciais começam desabilitadas (`docs/infra-judicial-implementacao.md:27-28`) e o DJEN não foi testado contra respostas de produção (`lib/judicial/connectors/djen.ts:22-27`). Além disso, o DJEN entrega publicações, não andamentos. A agenda não calcula prazos (`docs/manual-lume.md:91`). | Copy alinhada ao que é entregue: prazos cadastrados pelo advogado, colaboração por caso, nenhuma cobertura judicial não habilitada e citações com revisão em vez de "garantidas". |
| 4 | **Contenção do beta.** O cadastro é aberto, sem verificação de e-mail nem CAPTCHA (`auth-core.ts:28-33`), e dá 850 créditos (~R$ 85 de IA) por escritório (`db/postgres/0061_credits.sql:20`). `assertCredits` só verifica saldo > 0 e o débito vem depois (`lib/billing/credits.ts:87-95`; `app/api/chat/route.ts:56`). Como o bloqueio é por conversa, várias conversas em paralelo ultrapassam o saldo. | Allowlist/convite no servidor, que também barre contas já existentes e chamadas diretas de IA/OCR. Créditos iniciais controlados e teto financeiro no provedor. *Para abertura pública:* reserva de créditos antes da chamada e reconciliação depois. |
| 5 | **Recuperabilidade.** Não há evidência de restauração ensaiada de PostgreSQL + originais no R2 + chaves de cifra + reconstrução dos índices. | Restauração em ambiente isolado, com conferência de documentos e vínculos, teste de descriptografia e RPO/RTO medidos e registrados. |
| 6 | **Incidente LUME-1E.** Duas ingestões de PDF de escritórios reais falharam e o incidente continua "aberto". A causa original foi perdida no adaptador de armazenamento (`docs/incidents/2026-09-29-vault-ingestion.md`). | Tratar os dois documentos, preservar o diagnóstico sanitizado da causa e encerrar o incidente pelos critérios registrados. |
| 7 | **Relação contratual e direitos.** Não existe registro versionado de aceite (`docs/documentos-legais.md`) nem procedimento de exportação ou exclusão da conta. | Termo de piloto assinado e versionado (aceitável no beta). Procedimento escrito para suporte, exportação e exclusão, mesmo que manual. |
| 8 | **Antes da primeira cobrança.** O AbacatePay só foi validado em Dev mode (`docs/validacao-abacatepay.md:3`). | Conta de produção habilitada, uma transação real, webhook, reconciliação e cancelamento/reembolso. |

## P1: primeiras 2 a 4 semanas

1. **Next.js.** A versão 16.3.5 tem um advisory crítico (RCE em `next/og`, [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)), mas `next/og` não é usado. Atualizar para a **16.3.8** (30/09, que corrige outros sete advisories) e avaliar a aplicabilidade no runtime `vinext 1.0.0-beta.10`.
2. **Jurisprudência.** Separar aderência de autenticidade: hoje o "score" mede aderência a partir de metadados e resumo (`lib/research/jurisprudence-score.ts:60`), e a revisão de citações só acontece depois do streaming (`lib/chat-turn.ts:373`). Exigir conferência de tribunal, número, data e trecho antes de citar.
3. **Prompt injection.** O guard libera o resultado quando o detector falha (`lib/agent-guard.ts:151`) e não cobre `k5_knowledge_search` nem as buscas executadas pelo próprio provedor. Mudar para fail-closed e ampliar a cobertura.
4. **Ingestão.** DOCX e XLSX passam pelo parser sem limite de expansão do ZIP, com upload de até 100 MB (`lib/document-extraction.ts:152`; `application/uploads-service.ts:40`). Limitar expansão, entradas e células, criar cota por escritório e validar o conteúdo.
5. **Conta.** Verificação de e-mail (a troca de e-mail também não é verificada, `auth-core.ts:33`), Turnstile no cadastro e MFA/passkey, começando pelos administradores.
6. **Custos.** Registrar o custo de chamadas com falha ou canceladas (`lib/ai-runtime.ts:168`; `chat-turn.ts:394`) e reconciliar a cobrança ao cliente com o custo da plataforma.
7. **Desempenho e escala.** Início no celular com LCP de 5,0 s e primeira abertura do chat com 6,4 s (`docs/web-perf-2026-10-01.md`); entregar os dados do Início pelo servidor. Consultas sequenciais por caso compartilhado (`application/vault-service.ts:43`). A recuperação considera só os 400 documentos mais recentes (`knowledge/retrieval.ts:67`).
8. **Operação.** Um único responsável, alertas só por e-mail e nenhum escalonamento. Faltam jornadas sintéticas de pagamento e recuperação de senha, status page, SLO e um rollback coordenado com migrações.
9. **Google OAuth.** Escopos restritos do Gmail ainda em modo Testing (limite de 100 usuários e tela de app não verificado). No beta, aceitável para usuários autorizados; antes de abrir ao público, concluir a verificação ou esconder o Gmail.

## P2

- Captura judicial homologada por fonte (DJEN primeiro), com cobertura, atraso e última coleta visíveis. Depois, cálculo de prazos validado (dias úteis, feriados forenses e suspensões).
- Calculadoras jurídicas determinísticas, se o segmento-alvo for trabalhista, previdenciário ou revisional.
- Papéis de equipe (secretaria, estagiário) se o público passar a incluir escritórios com funcionários. Hoje o modelo é deliberadamente um advogado por escritório, com associados por caso (`docs/colaboracao.md`).
- RLS como defesa em profundidade, `EXPLAIN` nas consultas quentes, ensaios recorrentes de carga e restauração.

## Posição competitiva

Fontes: [jusfy.com.br](https://www.jusfy.com.br/), [projuris.com.br](https://www.projuris.com.br/), [Projuris ADV](https://www.projuris.com.br/adv/) e manuais públicos da Jusfy, consultados em 03/10/2026. Registramos o que é oferecido, não a qualidade de uso.

| Necessidade | Lume (verificado no código) | Jusfy (R$ 47–227/mês) | Projuris ADV / Start |
|---|---|---|---|
| Publicações e andamentos | Infraestrutura DJEN, desabilitada e sem homologação | Monitoramento "ilimitado" de processos e publicações | Captura de intimações e andamentos (Oystr) |
| Prazos | Tarefas com data manual | Controle de prazos | Controle de prazos e agenda |
| Calculadoras | Não tem | 10+ (trabalhista, revisional, FGTS…) | Não verificado |
| Jurisprudência | 37 julgados próprios + web/STJ/TJDFT | "50+ milhões" | Não verificado |
| IA / redação | **Forte**: agente sobre o Cofre, aprovação humana, DOCX no modelo do escritório, anexos PJe | JusGPT, modelos | IA conversacional |
| Documentos/GED | **Forte**: Cofre com OCR, versões, permissões e busca semântica; portal do cliente | Modelos, JusSign | Documentos, área do cliente |
| Honorários | Parcelas, recebimentos, estornos | Jusfy Pay | Financeiro completo + timesheet |
| Equipe | 1 advogado por escritório + associados | Subusuários a partir do plano One | Equipes e relatórios |
| Preço | R$ 199/mês com 850 créditos | R$ 47 / 117 / 227 | Sob consulta |

**Leitura.** Hoje o Lume não substitui um gestor processual. O advogado de contencioso vai continuar usando outra ferramenta para publicações e prazos. O diferencial que se defende é o **trabalho documental assistido por IA com controle humano**, e é com ele que o beta deve competir: como complemento, não como substituto, da Jusfy ou da Projuris. A R$ 199/mês, acima do plano intermediário da Jusfy, essa proposta precisa ficar evidente no onboarding (primeiro documento útil em poucos minutos).

## Escopo do beta

Liberar: clientes e casos, Cofre (depois dos P0 5 e 6), assistente para leitura, cronologias e minutas com fontes e revisão humana, tarefas e agenda manuais e honorários básicos. Portal do cliente na segunda etapa.
Manter ocultos, inclusive nas APIs e capabilities: monitoramento judicial, Anúncios (`chatgpt-ads=false`), WhatsApp fora do piloto atual, conclusões de disponibilidade de marca, Honcho e cobrança real, até cumprir os respectivos P0.
Critério para abertura pública: P0 encerrados, fluxos centrais verificados no runtime publicado, gasto agregado controlado, restauração ensaiada e uma janela de estabilidade observada, com suporte funcionando.
