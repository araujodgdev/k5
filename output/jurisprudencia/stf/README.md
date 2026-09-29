# Coleta inicial STF

Lote limitado realizado em 28/09/2026. Preparado para publicação pelo agente coordenador, com dois registros e as ementas. A publicação no PlanetScale/R2 deve ser confirmada pelo coordenador.

## Descoberta dinâmica

O JavaScript público `https://portal.stf.jus.br/scripts/tesauro.js` informa o endpoint `https://portal.stf.jus.br/jurisprudencia/tesauro/tesauro-service.asp?letra=a`. A resposta contém 1.638 termos e suas relações USE, UP, TG, TE, TR, NE e CATEGORIA. O primeiro descritor sem relação USE foi usado na consulta inicial. Não existe lista fixa de temas escolhidos pelo agente.

O XML oficial contém caracteres de controle ilegais. `tesauro-a.xml` preserva o texto recebido; `topics.json` foi produzido removendo somente os controles ilegais antes da análise XML. O arquivo local é UTF-8, apesar da declaração ISO-8859-1 recebida na resposta.

## Resultados

Pesquisa pelo campo Ementa / Decisão / Indexação, expressão entre aspas, sinônimos e plural ativos, sem radicais, acórdãos, ordenação por julgamento crescente. Foram reportados 20 resultados. `search-response-browser.json` preserva os dez primeiros retornados na página 1.

Os registros `sjur185881` e `sjur187947` foram preparados em `bundle.json`. Os metadados de cada decisão estão nos arquivos `*-source.json`. O espelho HTML/TXT do primeiro registro foi preservado separadamente e não é inteiro teor.

## Download de inteiro teor

As requisições HTTP diretas retornaram status 202 com corpo vazio. A navegação oficial do primeiro documento levou a `https://redir.stf.jus.br/paginadorpub/paginador.jsp?docTP=AC&docID=617680`. O navegador recebeu status 200 e tipo application/pdf, mas bloqueou o visualizador filho. A captura de corpo retornou apenas HTML do visualizador, preservado em `sjur185881-viewer-wrapper.html`. O Chrome recusou a automação porque outra extensão estava aberta. Não houve contorno desse bloqueio.

Nenhum arquivo PDF válido foi obtido. O bundle mantém `fullTextStatus=pending` e as URLs oficiais para nova tentativa. Os arquivos vazios e o wrapper são evidências de diagnóstico e não devem ser publicados como documentos judiciais.

## Retomada

O checkpoint em `bundle.json` mantém a página 1, próximo índice 2, tema atual parcial, as duas íntegras pendentes e a próxima letra de catálogo B. Somente a letra A foi enumerada. A base monocrática não foi executada neste lote. Não há declaração de cobertura completa nem agendamento criado.

O script `prepare-bundle.ps1` apenas converte a resposta já coletada para o formato de publicação. Não é um coletor automático completo.

O catálogo de publicação contém 1.631 rótulos únicos. As 1.638 entradas oficiais incluem repetições; o bundle preserva todas as variantes em metadata.sourceEntries.
