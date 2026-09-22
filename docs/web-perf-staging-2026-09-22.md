**Auditoria de desempenho do staging — 22 de setembro de 2026**

A tela de entrada do [staging](https://k5-staging.k5-web.workers.dev/sign-in) apresentou nota Lighthouse **97 no mobile** e **100 no desktop**. O principal problema é funcional: **as quatro rotas autenticadas retornaram HTTP 500 em todas as 18 tentativas de carregamento direto**. Esses erros impedem obter notas válidas de carregamento para a aplicação interna.

Após o login pela interface, Início, Lume, Cofre e Agenda chegaram a renderizar pela navegação interna. No percurso Início → Lume → Cofre → Agenda → Início, o retorno ao Início permaneceu no esqueleto de carregamento durante toda a espera adicional de 10 segundos. Assim, o funcionamento da navegação interna também não está integralmente aprovado.

**Ambiente e método.** URL `https://k5-staging.k5-web.workers.dev`; Worker `k5-staging`, versão `f9204fa6-3030-47e5-b948-fca7905dce76`, atendendo 100% do tráfego na consulta. Deployment `b9b4e317-b9be-44b5-99a3-18b01c48ee83`, criado às 09:14 de Brasília em 22/09/2026. As medições Lighthouse ocorreram entre **09:56 e 10:02**, seguidas pelas inspeções de rede, navegação e logs. Os resultados descrevem essa versão, sem inferir o commit remoto a partir da árvore local.

O staging usa **vinext/Vite/Rolldown em Cloudflare Workers**; a [auditoria local](web-perf-2026-09-22.md) usou Next.js/Turbopack em Node. A configuração está em [vite.config.ts](../apps/web/vite.config.ts), [wrangler.jsonc](../apps/web/wrangler.jsonc) e na [documentação dos ambientes](ambientes.md). A diferença de desempenho entre esses ambientes não isola o efeito da infraestrutura.

Foram usados Lighthouse 13.5.0, Playwright 1.63.0 e Chromium 153.0.8010.12, em navegador separado. Não havia Chrome DevTools MCP disponível; a coleta usou Lighthouse e CDP por Playwright. Foram preservados **22 relatórios HTML/JSON de tentativas e quatro traces válidos**, todos da entrada. Os relatórios das outras 18 tentativas registram `ERRORED_DOCUMENT_REQUEST`, sem métricas utilizáveis.

- Mobile: três rodadas por rota, viewport Lighthouse 412 × 823, RTT simulado de 150 ms, 1.638,4 Kbps e CPU 4× mais lenta.
- Desktop: uma rodada por rota; três para Lume, mantendo o protocolo da auditoria local. Perfil Lighthouse padrão, RTT simulado de 40 ms, 10.240 Kbps e CPU 1×.
- Cache HTTP, Cache Storage, service workers e localStorage foram limpos antes de cada medição; cookies autenticados foram preservados nas rotas privadas.
- Inspeções adicionais em 390 × 844 e 1440 × 900, sem throttling artificial; dez árvores de acessibilidade, capturas de tela, respostas de rede e consultas de leitura à telemetria do Worker.
- Foi reutilizada a conta de validação existente. Nenhuma mensagem de IA foi enviada. A contagem de conversas passou de zero para uma durante a auditoria, comportamento compatível com a inicialização automática de conversa pelo chat; não foram criadas contas ou fixtures.

**Métricas válidas da entrada.** Medianas mobile calculadas separadamente para cada métrica; desktop tem uma amostra.

| Perfil de `/sign-in` | Performance /100 | FCP | LCP | Avaliação LCP | CLS | Avaliação CLS | TBT | Speed Index |
| --- | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: |
| Mobile, três rodadas | 97 | 1,63 s | 2,53 s | Precisa melhorar, próximo do limite | 0 | Bom | 0 ms | 1,63 s |
| Desktop, uma rodada | 100 | 0,56 s | 0,72 s | Bom | 0 | Bom | 0 ms | 0,56 s |

As notas mobile foram **98, 97 e 94**, com LCP de **2,21, 2,53 e 2,82 s**. O resultado mediano fica ligeiramente acima do limite de 2,5 s para LCP bom; a variação recomenda evitar conclusões apoiadas somente na melhor rodada. A avaliação real de Core Web Vitals exige o percentil 75 das visitas dos usuários. **INP e dados de campo não foram medidos**; TBT é uma métrica de laboratório e não substitui INP. Fontes: [LCP](https://web.dev/articles/lcp), [CLS](https://web.dev/articles/cls) e [Web Vitals](https://web.dev/articles/vitals).

O elemento LCP mobile da segunda rodada foi o título `h1#auth-title`, “Entre no Lume”. O trace observado separou 78 ms de TTFB e 137 ms de atraso de renderização; esses valores pertencem à execução observada e não devem ser somados ao LCP de 2,53 s, que é simulado pelo Lighthouse. Não houve deslocamento de layout na entrada.

| Entrada mobile | Local | Staging |
| --- | ---: | ---: |
| Performance /100 | 87 | 97 |
| LCP mediano | 3,98 s | 2,53 s |
| TBT mediano | 82 ms | 0 ms |
| CLS mediano | 0 | 0 |
| JavaScript transferido, segunda rodada | 320,7 KiB | 272,5 KiB |

O staging teve LCP aproximadamente **36% menor** nessa comparação. Framework de execução, bundler, cache intermediário e rede diferem; isso não demonstra que mover o mesmo build para Cloudflare produz esse ganho. As [notas do Lighthouse](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring) também não constituem aprovação dos Core Web Vitals de toda a aplicação.

**Falha prioritária de carregamento autenticado.** Sessão válida, cookies presentes e acesso direto ao documento:

| Rota | Tentativas Lighthouse | Resposta do documento | Performance, LCP, CLS e TBT |
| --- | ---: | --- | --- |
| `/app/command-center` | 4 | HTTP 500 | Indisponíveis |
| `/app/agents` | 6 | HTTP 500 | Indisponíveis |
| `/app/vault` | 4 | HTTP 500 | Indisponíveis |
| `/app/agenda` | 4 | HTTP 500 | Indisponíveis |

O problema também foi reproduzido com Playwright fora do Lighthouse, em novos contextos autenticados. A resposta apresentou o fallback global padrão do vinext: “This page couldn’t load”. Não se trata de atribuir nota zero à aplicação: medir o documento de erro não representaria o conteúdo solicitado.

Os endpoints `/api/auth/get-session`, `/api/conversations`, `/api/vault/cases` e `/api/ai/models` responderam **200**; a sessão foi confirmada como válida. Pelo login e pelos links internos, requisições RSC `?_rsc=...` responderam **200**, e os títulos das quatro telas foram observados. Esse contraste restringe a investigação ao caminho de renderização inicial de HTML e às diferenças em relação à navegação RSC; ele não identifica, sozinho, a exceção responsável.

A telemetria do Cloudflare confirmou as requisições de erro na versão registrada. Exemplo: request ID `0d4a5063bbd8045db717d8df91c47974`, ray ID `a3f17954e8825215`, `/app/command-center`, resposta 500, 32 ms de CPU e 1.490 ms de duração total. O evento tinha `outcome: ok`: o Worker terminou e devolveu uma resposta 500. Os registros consultados não expuseram stack trace da exceção; não há evidência suficiente para atribuir a causa a autenticação, D1 ou limite de CPU.

**Problemas e ações, por prioridade.** As economias de tempo abaixo são estimativas do Lighthouse, não ganhos implementados, e não devem ser somadas.

| Prioridade | Evidência e impacto | Ação concreta |
| --- | --- | --- |
| Crítica — HTML das rotas privadas | 18/18 navegações retornaram 500; acesso direto e recarregamento não entregam a aplicação. | Capturar a exceção de SSR associada ao request ID; reproduzir no runtime Cloudflare/vinext e corrigir o caminho compartilhado das rotas privadas. Validar documento HTTP 200, conteúdo e sessão nas quatro rotas antes de repetir Lighthouse. |
| Alta — retorno ao Início | Ao voltar da Agenda, a URL e o título do documento mudaram, mas o conteúdo permaneceu no esqueleto por mais de 10 s; nenhum erro de JavaScript foi capturado. | Reproduzir a sequência registrada e verificar resolução do conteúdo RSC, estado de navegação e fronteira de carregamento. O HTTP 200 do payload não basta para aprovar o fluxo. |
| Média — preload de Newsreader itálica | Arquivo de 64.500 bytes, cerca de 63 KiB, carregado antecipadamente; nenhum texto visível da entrada mobile/desktop usou essa variante. | Separar o carregamento da variante itálica em [layout.tsx](../apps/web/src/app/layout.tsx), evitando seu preload global e mantendo-a disponível onde for usada. Ganho temporal isolado ainda não medido. |
| Baixa — JS inicial da entrada | 66 KiB estimados sem execução durante a carga; economia estimada de LCP de 150–300 ms nas três rodadas. | Inspecionar fronteiras dos schemas e módulos de autenticação para adiar código de outros fluxos. Cobertura da carga não demonstra que validadores ou runtimes possam ser removidos. |
| Baixa — CSS bloqueante da entrada | `layout.BixFyi9R.css`, 16,9 KiB transferidos; economia estimada de LCP de 100–150 ms no mobile, zero no desktop. | Avaliar separação de estilos por rota após corrigir o SSR e o preload; medir novamente. Não houve economia indicada para CSS não utilizado, portanto não há evidência para adicionar purge ou remover regras. |

**Rede e código.** Na segunda rodada mobile da entrada foram feitas 33 requisições, com **469,1 KiB transferidos**: 26 scripts somando 272,5 KiB, três fontes somando 168,6 KiB, um CSS de 16,9 KiB, documento e duas requisições fetch. Todas vieram da mesma origem. O número de requisições inclui recursos iniciados pela página durante a coleta, não apenas os indispensáveis ao primeiro paint.

As fontes são Inter normal (48.432 bytes), Newsreader normal (58.152 bytes) e Newsreader itálica (64.500 bytes); os valores individuais são do corpo dos arquivos, enquanto a tabela de rede inclui transferência HTTP. O HTML já antecipa as fontes. O maior caminho de dependências destacado foi documento → runtime vinext, com 201 ms no trace observado e zero economia isolada de LCP indicada para esse diagnóstico. Não houve candidato a preconnect adicional ou imagem principal a converter.

Os maiores itens da cobertura da entrada foram `schemas-C9-eWOed.js` (23.624 bytes sem execução), `vinext-CWtqL53Z.js` (22.153) e `framework-D0lXphEj.js` (21.824). O chunk de schemas é um ponto de investigação mais delimitado; os números dos runtimes não autorizam removê-los. Os problemas de bundle e CLS das rotas privadas encontrados na auditoria local não foram revalidados como métricas de carregamento em staging, devido ao erro de documento.

JS e CSS estáticos chegaram com **zstd**, `Cache-Control: public, max-age=31536000, immutable`, ETag e `CF-Cache-Status: HIT` nas inspeções. `/sign-in` usou `no-store, must-revalidate`. Não foi encontrado problema que justifique alterar compressão ou relaxar cache das páginas autenticadas. A auditoria de cache de recursos estáticos da entrada passou.

**Acessibilidade.** A entrada teve nota automática **100** nas quatro medições válidas. Foram salvas árvores de acessibilidade em mobile e desktop, além das telas internas que abriram pela navegação. Os erros de carregamento impedem avaliar a acessibilidade do documento inicial das áreas privadas. Não foi realizada nesta extensão da auditoria uma verificação completa de teclado, contraste de todos os estados ou equivalência com os achados locais; a nota da entrada não deve ser generalizada.

**Evidências e validação.** Os artefatos ficam no diretório local ignorado [web-perf-staging-2026-09-22](../apps/web/.data/web-perf-staging-2026-09-22/), com resultados consolidados em [summary.json](../apps/web/.data/web-perf-staging-2026-09-22/summary.json), [entrada mobile, segunda rodada](../apps/web/.data/web-perf-staging-2026-09-22/sign-in-mobile-r2.html), [inspeção de rede e DOM](../apps/web/.data/web-perf-staging-2026-09-22/inspection.json), [verificação das APIs](../apps/web/.data/web-perf-staging-2026-09-22/api-checks.json), [navegação interna](../apps/web/.data/web-perf-staging-2026-09-22/client-navigation.json), [captura do Início em carregamento](../apps/web/.data/web-perf-staging-2026-09-22/client-Início.png) e [eventos sanitizados do Worker](../apps/web/.data/web-perf-staging-2026-09-22/cloudflare-errors.json). Esses arquivos locais não acompanham um clone do repositório.

- [x] Coleta de traces: quatro válidos; 18 carregamentos privados bloqueados por HTTP 500.
- [x] Análise de LCP, CLS e métricas de apoio da entrada; limites de INP e dados de campo registrados.
- [x] Análise de rede, cache, compressão, fontes e dependências.
- [x] Captura das árvores de acessibilidade, com limitações das páginas privadas registradas.
- [x] Leitura do código/configuração e comparação com o relatório local, sem atribuir o build remoto às alterações atuais do workspace.

Esta extensão da auditoria adicionou somente este relatório e artefatos locais de coleta. Não alterou código da aplicação, configurações remotas ou deployment. Links locais, conteúdo e espaços finais do relatório foram verificados; lint, typecheck, testes unitários e build não foram repetidos para essa entrega documental. Os navegadores da coleta foram encerrados.
