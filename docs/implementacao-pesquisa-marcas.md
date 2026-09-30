> Atualização: a modalidade agora se chama Marcas e usa o INPI para o Brasil. Veja [a implementação atual](pesquisa-marcas-inpi.md). O fluxo WIPO descrito abaixo permanece para outros países e históricos anteriores.

# Pesquisa de marcas — primeira versão

Pesquisa oferece Marcas Registradas, Web (Exa) e Jurisprudência. Os históricos anteriores continuam acessíveis. Links antigos com `?search=` abrem a pesquisa Web; os novos incluem `mode`.

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
