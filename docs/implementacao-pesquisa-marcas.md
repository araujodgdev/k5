> Atualização em 01/10/2026: novas pesquisas voltam à automação WIPO para todos os territórios, inclusive o Brasil. A carga automática do INPI foi desativada. Históricos INPI permanecem acessíveis com suas fontes originais.

# Pesquisa de marcas com WIPO Global Brand Database

Pesquisa oferece Marcas e Jurisprudência, cada uma com seu histórico pessoal. Os links incluem `mode` e `search`. Links antigos da pesquisa Web abrem uma nova consulta de Marcas. A busca pública na web continua disponível ao agente pela ferramenta `web_search`.

## Consulta

- Nome ou logotipo PNG/JPG/WebP até 5 MB; formato conferido pelos bytes no servidor.
- Brasil por padrão; 15 países selecionáveis. Território significa escritório nacional **ou** país designado na WIPO.
- Todos os status por padrão. Ativos corresponde a Registered; pedidos a Pending; encerrados a Ended/Expired. A categoria geral não substitui o status oficial.
- Classe Nice opcional. Nome oferece correspondência por termos, nome exato, aproximação ou fonética; logotipo usa comparação conceitual. Comparações de forma, cor e composição ficam para uma entrega posterior.
- Páginas de 30 resultados, até 10 páginas solicitadas. Fontes individuais, horário de coleta e página própria de detalhes, com link ao escritório de origem quando publicado.

Histórico, entradas e resultados pertencem à pessoa e ao escritório. Imagens ficam no armazenamento privado e as rotas revalidam o acesso. Esta versão conserva imagens com o histórico; exclusão e expiração automática ficam para uma entrega posterior.

## Execução

As seis capacidades `k5_research_*trademark*` usam o mesmo serviço na tela, WebMCP e Lume. Iniciar devolve o identificador; acompanhar lê o estado persistido. Links obtidos alimentam o registro de fontes da conversa.

O Worker web contém um Durable Object `LumeTrademarkRun` por pesquisa e um binding Browser Run `BROWSER`. Puppeteer, já utilizado no projeto, controla o portal. Não há dependência do Cua Driver local. Monitoramento mantém seu próprio Worker e browser.

PostgreSQL guarda entradas, tarefas, leases e páginas concluídas. Alarmes retomam tarefas pendentes; o cron recupera acionamentos perdidos. Leases duram 90 segundos e são renovados a cada 25; três leases abandonados encerram a espera com erro. Limites: quatro tarefas simultâneas globais, 30 pesquisas e 60 uploads por pessoa/dia, quatro minutos por tarefa. Uma falha de outra página conserva resultados anteriores. Cancelamento e revogação impedem publicação de respostas tardias.

Cada tarefa abre e fecha seu browser, reaplica filtros e, se necessário, envia novamente a imagem privada. O portal precisa inicializar antes de receber critérios. O formulário é submetido pela interface e a estrutura devolvida é conferida. Cards e detalhes são carregados antes da extração. Quando o card não expõe o identificador, o executor abre o detalhe pela interface, lê o identificador na URL e retorna à mesma página. Mudança do portal ou bloqueio vira erro explícito.

O tipo de registro mostrado no card não é o escritório de origem. Tipo e território são preservados separadamente; o escritório é obtido no detalhe, quando publicado.

Jev usa a conexão TypeSafe central, finalidade `research`, perguntas versionadas e candidatos fechados para escolher botões ambíguos. Só aplica escolhas em modo enabled com confiança mínima de 0,85. Passos conhecidos são determinísticos; nenhuma escolha segura interrompe a ação. O modelo não produz seletores, URLs ou código.

## Operação

`wrangler.jsonc` declara BROWSER e TRADEMARK_RUNS, com migração v3 do Durable Object. A migração PostgreSQL é `0053_research_trademarks.sql`. O deploy existente aplica o esquema antes de publicar. Não requer chave WIPO ou conexão TypeSafe por escritório.

`pnpm dev` em Node permite verificar formulário/histórico e exibe indisponibilidade do navegador. Para executar consultas, use o runtime Cloudflare com BROWSER remoto e banco local isolado, ou o Worker publicado. Previews HTTP existentes continuam sem executor externo.

A prova em Browser Run remoto em 30/09/2026 verificou o adaptador real: LUME + Brasil + Pending + Nice 35; imagem sintética + Brasil; detalhes BR500000905046595, incluindo Ended, Official status Rejected e origem INPI. Totais mudam conforme a base.

Testes PostgreSQL cobrem privacidade, idempotência, upload, fontes, deduplicação, detalhes, resultados parciais, bloqueio, cancelamento, revogação e perda/expiração do lease durante a operação.

## Limites

Os termos públicos da WIPO restringem consultas automatizadas. Essa restrição foi discutida no planejamento; acesso público não altera os termos. A implementação não contorna desafios ou bloqueios. Confira a situação na fonte; a consulta não certifica disponibilidade ou viabilidade jurídica.

Cloudflare AI Search continua reservado à modalidade futura. Seu [levantamento](pesquisa-cloudflare-ai-search.md) e o [plano](plano-pesquisa-direcionada-marcas.md) documentam a separação.

## Retorno à automação em 01/10/2026

O commit `c157227` introduziu a automação do Brand DB; `00280ce` passou as pesquisas brasileiras para o corpus INPI. O retorno reutiliza o navegador existente, incluindo paginação, detalhes, limites, cancelamento e tratamento de bloqueios. Não faz um revert integral desses commits.

Novas consultas usam `provider=wipo` e tarefas assíncronas para nome e logotipo. O contrato público não oferece mais consulta por códigos de Viena; o contrato dos históricos continua aceitando esse formato. Repetir a chave de uma consulta antiga conserva sua identidade e fonte. A classificação visual de anexos continua disponível como análise, sem iniciar pesquisa por códigos.

O cron deixa de despachar `INPI_PROCESSOR`, e `/run/trademarks` responde HTTP 410. Os bindings/classes existentes são mantidos para compatibilidade de infraestrutura; não há remoção de recursos nem migração destrutiva. A CLI do INPI permanece uma ferramenta manual com os limites documentados em [Importação INPI](inpi-importacao-segura.md). Não há carga automática para sustentar novas pesquisas.

O rollback desta troca de fonte é uma alteração coordenada de contrato, interface e serviço. Não reativar o importador antigo como parte de um rollback: a capacidade de 10 GB continua insuficiente para o modelo de duas versões. Dados INPI existentes não são apagados por esta mudança e continuam ocupando disco.

### Validação do retorno

Em 01/10/2026, os 21 testes de `trademarks.test.ts` e `inpi-trademarks.test.ts` passaram contra PostgreSQL descartável. Incluem novas pesquisas brasileiras por nome, fonética e imagem, repetição de chave de um histórico INPI, privacidade, paginação, cancelamento e recuperação de leases. `pnpm typecheck`, `pnpm lint`, `pnpm db:setup`, `pnpm build` e `pnpm integrations:build` passaram. O lint manteve um aviso anterior de variável não utilizada em `transport.ts`. O build usou banco descartável; a compilação de integrações foi um dry-run, sem publicação.

`pnpm test`, com concorrência 2, executou 735 testes em 20min20s: 731 passaram, três falharam e um foi ignorado. As falhas foram o PDF com erro 503 após o timeout de 90 segundos do LibreOffice, o caso CSV de 60 mil registros que não publicou antes do fim da primeira fatia de dez minutos e uma expectativa antiga de códigos de Viena no contrato enviado à OpenAI. O teste desse contrato foi atualizado para exigir consultas tipadas por nome e logotipo. A revalidação de `openai-effort.test.ts`, `trademarks.test.ts` e `inpi-trademarks.test.ts` passou com 25/25 testes em 12,65 segundos. O caso CSV passou isoladamente, com 60 mil registros publicados, em 2min29s. A suíte completa não foi repetida após a correção da expectativa; o timeout do PDF e a dependência de duração do teste CSV na suíte conjunta permanecem pendências de validação.

O servidor de processadores local respondeu HTTP 410 a `POST /run/trademarks`. A interface local foi conferida em 1280×800 e 390×844, sem rolagem horizontal: nome, fonética, upload de imagem, histórico com 32 resultados WIPO e fontes individuais. A pesquisa por teclado e o erro explícito de navegador indisponível no runtime Node também foram conferidos. A ferramenta de screenshots falhou; essas verificações usaram o DOM, a geometria dos elementos e a interação no navegador.

No portal público, a consulta LUME + Brasil + Pending + Nice 35 retornou 33 resultados, distribuídos em páginas de 30 e 3. O detalhe `BR500000943750245` expôs 27 campos e o link de origem INPI. Uma imagem sintética retornou a primeira página de 30 resultados por similaridade conceitual com o território Brasil preservado. Os totais pertencem ao momento da consulta. Reutilizar uma URL antiga no teste fez o portal descartar critérios; uma URL com timestamp novo, como a gerada pelo adaptador, preservou os filtros.

Esta rodada não executou o fluxo completo no Worker Cloudflare com Browser Run. A prova remota de 30/09 citada acima é anterior a esta alteração. Não houve deploy nem exclusão de dados. Antes de publicar, verificar nome e imagem no runtime Cloudflare de desenvolvimento com banco isolado; depois, em um rollout aprovado, conferir fonte WIPO, paginação, detalhes e ausência de novos disparos INPI.

A retirada do agendamento não encerra um importador que já esteja rodando na versão implantada. O rollout deve identificar execuções em curso e aguardar sua conclusão segura ou suspendê-las de forma controlada, preservando corpus e checkpoints. A remoção de dados INPI para recuperar espaço é uma operação separada e não faz parte desta alteração.
