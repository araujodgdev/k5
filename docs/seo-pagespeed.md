# SEO e PageSpeed da página pública

Diagnóstico em 29/09/2026, a partir dos relatórios enviados:

| Métrica | Celular | Desktop |
| --- | ---: | ---: |
| Desempenho | 85 | 94 |
| Acessibilidade | 95 | 95 |
| Boas práticas | 100 | 100 |
| SEO | 63 | 63 |
| FCP | 2,7 s | 0,6 s |
| LCP | 3,3 s | 0,7 s |
| TBT | 100 ms | 40 ms |
| CLS | 0 | 0 |

Fontes: [relatório mobile](https://pagespeed.web.dev/analysis/https-lume-software/48u62v7wau?form_factor=mobile) e [relatório desktop](https://pagespeed.web.dev/analysis/https-lume-software/r0nvhqtnyu?form_factor=desktop). Ambos estavam sem dados de usuários reais no CrUX.

## Causas e correções

A home herdava `noindex, nofollow` do layout. Ela agora declara `index, follow`, como as páginas de termos e privacidade. O padrão do layout continua bloqueando indexação de login, cadastro e páginas internas. O acesso aos dados continua dependendo da sessão no servidor.

`robots.txt` permite buscar as páginas e os arquivos necessários à renderização, restringe `/api/` e informa o sitemap. O sitemap lista somente a home, os termos e a política de privacidade. Login e páginas internas continuam acessíveis ao rastreador para que ele possa ler `noindex`, conforme a [orientação do Google sobre robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro).

A home recebeu título e descrição sobre o software jurídico, canonical em `https://lume.software/`, Open Graph, Twitter e dados estruturados `WebSite` com o nome Lume. Não há avaliações ou preços inventados. Os [Fundamentos da Pesquisa Google](https://developers.google.com/search/docs/essentials?hl=pt-br) orientam títulos descritivos, conteúdo útil e links rastreáveis.

O runtime da Cloudflare enviava metadados no corpo da página para alguns user agents. `htmlLimitedBots: /.*/` mantém os metadados no `head` em ambos os runtimes. Os metadados públicos são síncronos. A opção é global: a página privada de um caso precisa aguardar a consulta do título antes de enviar o HTML. Se novas páginas consultarem serviços externos em `generateMetadata`, reavalie o efeito no tempo de resposta.

O título Lume, identificado como LCP no relatório, começava fora da área visível por uma animação. O título e o texto do hero agora aparecem desde a primeira renderização. As animações abaixo da primeira tela usam IntersectionObserver e Web Animations, com o mesmo easing do design, execução única e respeito a movimento reduzido e foco por teclado. GSAP e ScrollTrigger saem das dependências da landing.

O erro global importava novamente todo o CSS do aplicativo. O relatório mostrava duas folhas de 22,4 KiB cada. O erro agora tem uma folha isolada, com estilos que também funcionam quando o layout raiz falha. Os links da landing deixam de antecipar o carregamento das telas de autenticação.

A numeração dos módulos e o copyright usavam texto com opacidade insuficiente. Ambos passaram a usar a opacidade de 80% já utilizada no sistema visual.

## Verificação

Com um servidor de produção local iniciado, execute na raiz:

```powershell
$env:BASE_URL = 'http://localhost:3106'
pnpm --filter @k5/web exec tsx scripts/verify-public-site.ts
```

O script verifica respostas HTTP, metadados no `head` sem JavaScript, user agent do Googlebot, canonical, sitemap, robots, bloqueio de indexação das telas de autenticação, redirecionamento da área privada, 404, temas claro e escuro, teclado, movimento reduzido e navegação em 390 e 1440 pixels. As capturas ficam em `apps/web/playwright-report/public-site/`.

Execute `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. Execute também `pnpm --filter @k5/web build:vinext` para validar o runtime da Cloudflare. Faça os builds em sequência: vinext e Next.js escrevem tipos de rotas em `.next/types`.

### Resultado local em 29/09/2026

Os 646 testes passaram. Lint, typecheck e build do Next.js passaram; o lint mantém um aviso preexistente em `src/lib/judicial/connectors/transport.ts`. O build do vinext e o verificador de páginas públicas passaram nos dois runtimes. A tela de erro foi exercitada sem o CSS principal, nos dois temas, com nova tentativa pelo teclado.

No Lighthouse 13.5.0, Chromium local e build de produção do vinext servido pelo Wrangler:

| Categoria | Celular | Desktop |
| --- | ---: | ---: |
| Desempenho | 81 | 99 |
| Acessibilidade | 100 | 100 |
| Boas práticas | 100 | 100 |
| SEO | 100 | 100 |

O CSS transferido nessa execução foi de aproximadamente 23 KiB, contra 44,8 KiB nos relatórios originais. A folha isolada do erro tem menos de 1 KiB. O LCP local foi 3,6 s no celular e 0,9 s no desktop, com CLS zero. Esse resultado local, sozinho, não demonstra ganho em produção; a medição após o deploy está abaixo. O JavaScript restante inclui React, vinext, observabilidade e os componentes globais do aplicativo.

Os relatórios HTML/JSON e logs locais ficam em `output/seo-pagespeed/`. As medições locais usam servidor, CPU e rede diferentes dos relatórios do PageSpeed e não devem ser apresentadas como uma comparação controlada de desempenho.

## Publicação em 29/09/2026

O pacote validado foi publicado no Worker `lume`, versão `9c8f2fdc-95f4-4da5-8f92-e96690dfc5b5`. A verificação de migrações confirmou que o banco já estava atualizado. O deploy preservou as variáveis remotas e os containers existentes. A versão anterior era `3cfb203e-2bc1-4204-8b80-623490a78f47`.

O verificador de páginas públicas passou em `https://lume.software`, incluindo HTML sem JavaScript, Googlebot, sitemap, robots, páginas privadas, navegação, teclado, temas e movimento reduzido no celular e no desktop. O log está em `output/seo-pagespeed/verify-production.log`.

O PageSpeed de produção, executado às 10h27 BRT, registrou:

| Métrica | Celular antes | Celular depois | Desktop antes | Desktop depois |
| --- | ---: | ---: | ---: | ---: |
| Desempenho | 85 | 87 | 94 | 97 |
| Acessibilidade | 95 | 100 | 95 | 100 |
| Boas práticas | 100 | 100 | 100 | 100 |
| SEO | 63 | 100 | 63 | 100 |
| FCP | 2,7 s | 2,4 s | 0,6 s | 0,5 s |
| LCP | 3,3 s | 3,0 s | 0,7 s | 0,6 s |
| TBT | 100 ms | 20 ms | 40 ms | 40 ms |
| CLS | 0 | 0 | 0 | 0 |
| Speed Index | 4,6 s | 5,3 s | 2,4 s | 1,8 s |

Relatórios novos: [celular](https://pagespeed.web.dev/analysis/https-lume-software/vurmkwlr5y?form_factor=mobile) e [desktop](https://pagespeed.web.dev/analysis/https-lume-software/vurmkwlr5y?form_factor=desktop). As notas de desempenho variam entre execuções. O Speed Index mobile piorou nesta medição, apesar do ganho em LCP e TBT. O LCP mobile de 3,0 s ainda supera o limite de 2,5 s para a faixa boa. O relatório continua sem dados de usuários reais no CrUX.

As capturas dos relatórios e o log da publicação estão em `output/seo-pagespeed/`.

### Search Console

Na propriedade verificada `https://lume.software/`, o Google confirmou a solicitação de indexação da home e sua inclusão na fila prioritária de rastreamento. A confirmação está em `output/seo-pagespeed/search-console-indexing.png`. Isso confirma o pedido, não a conclusão da indexação.

O envio de `https://lume.software/sitemap.xml` também foi aceito. O relatório de sitemaps ainda mostrava `Couldn't fetch` ao fim da verificação, sem detalhar a causa. A inspeção ao vivo do próprio Google às 10h30 confirmou `Crawl allowed: Yes` e `Page fetch: Successful`. O XML também respondeu HTTP 200, com tipo `application/xml`, sem redirecionamento ou bloqueio de indexação. Ainda é necessário acompanhar o processamento no relatório de sitemaps. Esse diagnóstico segue a [orientação do Google para erros de leitura](https://support.google.com/webmasters/answer/7451001?hl=en). A captura final está em `output/seo-pagespeed/search-console-sitemap-status.png`.

A nota de SEO verifica requisitos técnicos. A correção de `noindex` permite a indexação, mas não garante posição nos resultados. As métricas de usuários reais dependem de novas visitas e da disponibilidade de dados no CrUX.
