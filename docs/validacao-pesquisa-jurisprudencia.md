# Validação da Pesquisa de Jurisprudência — 22/09/2026

Esta nota registra o que foi verificado na implementação da [Pesquisa de Jurisprudência](plano-pesquisa-jurisprudencia.md). O fluxo com corpus, caso, modelo, minuta e conversa sintéticos usou uma cópia isolada do SQLite e uma conta de teste estável. O estado de acervo vazio foi conferido na base principal, também com conta estável e apenas o histórico privado dessa conta. Os resultados no servidor de desenvolvimento não constituem aceite em produção nem comprovam cobertura das fontes judiciais reais.

## Verificações de código e infraestrutura

| Verificação | Resultado |
| --- | --- |
| `pnpm test` | 262 testes passaram. |
| `pnpm lint` | Zero erros; um aviso legado de variável não utilizada em `apps/web/src/lib/judicial/connectors/transport.ts`. |
| `pnpm typecheck` | Passou. |
| Build isolado com `K5_NEXT_DIST_DIR=.next-research-qa` | Passou em 49,5 s, com 55 páginas. |
| `docker compose config --quiet` | Passou; configuração analisada, sem implantação. |
| `pnpm db:setup` | Aplicou as migrações 0018–0020 nas bases principal e de QA. As migrações 0018 e 0019 não foram reescritas. |

Um defeito encontrado na execução do worker foi corrigido: o callback de observabilidade entregava o span como argumento opcional `workerId`, o que produzia o parâmetro SQL inválido `_traceId`. O wrapper agora chama a tarefa sem esse argumento. O teste de regressão passou (4/4), e a execução isolada do worker com `--once` terminou com código zero.

## Ensaio funcional no navegador

No servidor **de desenvolvimento** de QA, a pesquisa sintética apresentou 22 resultados e paginação. Foram exercitados o leitor e o acesso ao original, o perfil do caso, os estados de TypeSafe desligado e de continuação sem avaliação, o vínculo da referência ao caso, sua seleção no Lume, além de visualização mobile, navegação por teclado, modo escuro e logout. A conversa com Inception `mercury-2.5` usou streaming real. Os 15 checks do roteiro terminaram sem `pageErrors` ou `consoleErrors`.

As capturas e gravações são artefatos locais de QA, não evidência de importação de decisões reais. Os vídeos canônicos são [pesquisa e leitor sintéticos](../apps/web/playwright-report/research-synthetic/page@bd2159c1e25c5a560065cf7285d483b4.webm) (24,2 s), [conversa e mobile](../apps/web/playwright-report/research-synthetic/page@bbe8105210ef55c35dad33fd4f8b3b14.webm) (17,8 s) e [acervo vazio na base principal](../apps/web/playwright-report/research-empty/page@a16cb50a96734a531681ae2f33085c0d.webm) (30,6 s). A [captura dos resultados](../apps/web/playwright-report/research-synthetic/03-resultados-pagina-1.png), a [captura do leitor](../apps/web/playwright-report/research-synthetic/04-leitor.png), a [captura do Lume](../apps/web/playwright-report/research-synthetic/13-lume-stream.png) e a [captura do acervo vazio](../apps/web/playwright-report/research-empty/03-acervo-vazio.png) permitem revisar esses estados sem reproduzir os vídeos.

O fluxo de minuta **passou na segunda tentativa** no dev QA, da UI ao worker, artefato e fonte histórica. O run `15ea2667-325d-4e03-98f3-69fa07247b9c` terminou `completed`, progresso 100, com artefato `b7d7d38d-9d0f-4919-adbc-3ab5e1a3fe7a` em estado `needs_review`, versão 1. A referência fixada, a aprovação e a entrada em `source_refs` eram coerentes (uma de cada). A obtenção privada da fonte por `GET /api/artifacts/{id}/sources/{sourceId}` retornou `200` e `no-store`; o texto permaneceu marcado `AMOSTRA DE TESTE` e a versão `5cffe68a-215f-45bc-80ba-e167ffeeaa97` coincidiu com a referência fixada antes do run. Essa checagem HTTP é uma asserção do [roteiro Playwright](../apps/web/scripts/verify-research-draft.ts), não uma captura de tela. A verificação terminou sem erros de página ou console, seguida de logout. O [vídeo HD da minuta](../apps/web/playwright-report/research-draft/page@84db94c69f080f21bd5fd2de9b0a3a16.webm) (1280 × 720, 44,2 s) e as capturas de [citação aprovada](../apps/web/playwright-report/research-draft/01-citacao-aprovada.png), [minuta pronta](../apps/web/playwright-report/research-draft/03-minuta-pronta.png) e [artefato](../apps/web/playwright-report/research-draft/04-artefato.png) registram a passagem. Como não foi selecionada fonte factual do caso, o texto mostra `[PENDENTE DE INFORMAÇÃO]`; requer revisão jurídica humana antes de qualquer uso.

Na primeira tentativa, o outline havia sido gerado, mas a geração estruturada de uma seção falhou. A reprodução isolada do wrapper do provedor, da validação Zod e do registro de uso passou antes da nova tentativa. O sucesso da segunda execução não apaga a primeira falha, que deve ser acompanhada em operações posteriores.

## Execução em produção e limites do piloto

O build de produção compilou. A inicialização de `Next start` na porta 3001 foi recusada três vezes pela revisão automática com a mensagem `blocked by policy`, sem motivo específico informado. Nenhum processo de produção foi iniciado e não houve nova tentativa. O servidor de desenvolvimento de QA foi aceito para a verificação funcional acima; esse ensaio não substitui um teste de inicialização em produção.

Nenhuma fonte judicial real foi habilitada ou importada neste ambiente. Um contrato técnico pequeno do TJDFT foi verificado; o canário oficial do STJ teve timeout e seu esquema primário ainda requer confirmação ao vivo. Os testes de ingestão STJ com fixtures sintéticas não demonstram disponibilidade, cobertura ou permissão de uso da fonte.

Não havia configuração TypeSafe de escritório (`typesafe_connection`: zero registros) nem chave própria disponível para a finalidade Pesquisa. Assim, não ocorreu inferência TypeSafe real. O conjunto de avaliação tem 36 pares sintéticos, dos quais 9 são holdout; faltam rótulos humanos para comparar pertinência, contrapontos, custo e latência. O worker foi executado em Node na base isolada de QA. A configuração Docker passou em `docker compose config`, mas nenhum container foi testado. A coleta da Pesquisa no runtime Cloudflare não foi habilitada.

O aceite do piloto ainda depende da avaliação jurídica humana da minuta e da pertinência das referências, de fonte real habilitada sob suas condições de uso e de um smoke TypeSafe autorizado. Os procedimentos de fonte, workers e armazenamento constam no [guia da aplicação](../apps/web/README.md#pesquisa-de-jurisprudência).

## Preparação do deploy Cloudflare Staging

O destino configurado é o Worker `k5-staging` na conta `bf552f67bcf46921dbe4137ee0ff8980`, com D1 `k5-staging`, R2 `k5-vault-staging` e Vectorize `k5-knowledge-staging`. Esta seção registra somente a preparação anterior ao deploy; ainda não comprova uma versão publicada ou smoke remoto da Pesquisa.

O build `pnpm --filter @k5/web build:vinext` passou com as rotas da Pesquisa no manifesto. O empacotamento `wrangler deploy --config dist/server/wrangler.json --dry-run` passou com 437 módulos, 134 arquivos de assets e os bindings esperados, sem publicar. Em D1 local isolado, `wrangler d1 migrations apply k5-staging --local` aplicou as migrações até 0020, e uma consulta a `sqlite_master` confirmou as tabelas FTS `research_fts`, `research_fts_data` e `research_source_resource`. A consulta `wrangler d1 migrations list k5-staging --remote` ainda mostrava 0018, 0019 e 0020 pendentes; a aplicação remota deve preceder o deploy do Worker.

O teste focal `research-core.test.ts` passou (21/21); typecheck da aplicação e ESLint dos arquivos alterados passaram. O acesso a originais da Pesquisa agora falha explicitamente no runtime Cloudflare antes de usar o sistema de arquivos local: o serviço retorna `ResearchError('unsupported')`, mapeado pela rota privada para `NOT_READY`/HTTP 409, com mensagem em pt-BR. O caminho Node foi mantido e coberto pelo teste. O [sistema de arquivos virtual dos Workers](https://developers.cloudflare.com/changelog/post/2025-08-15-nodejs-fs/) não é armazenamento persistente compartilhado com os workers Node; não foi criado um espelho fictício em R2. Pesquisa e ingestão assíncronas continuam indisponíveis no Worker, conforme o guard existente. A leitura de acervo/histórico pode ser publicada, mas a coleta real ainda exige arquitetura compartilhada de fila e armazenamento.
