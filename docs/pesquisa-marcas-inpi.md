# Pesquisa de marcas no INPI

A modalidade **Marcas** consulta o acervo público do INPI para o Brasil. Web e Jurisprudência permanecem disponíveis, e outros países continuam usando a WIPO. Históricos e logotipos enviados são privados da pessoa e do escritório; o acervo oficial é compartilhado.

## Dados e atualização

A carga inicial lê os CSVs de bibliografia, titulares, classes Nice e classificação de Viena dos [dados abertos do INPI](https://dadosabertos.inpi.gov.br/index/marcas/). Os arquivos são lidos por trechos HTTP com validação de tamanho e ETag, sem carregar os gigabytes inteiros na memória. Importações usam COPY e tabelas temporárias; a publicação ocorre em transação. Campos de documentos pessoais dos titulares não entram no acervo.

O importador consulta o [índice da RPI](https://revistas.inpi.gov.br/rpi/) a cada cinco minutos, inclusive terça e quarta. A publicação costuma ocorrer às terças, mas o índice determina a edição disponível. Não há horário fixo presumido. Uma falha mantém a base anterior e agenda nova tentativa. Edições intermediárias são recuperadas em ordem, e a carga de dados abertos é reconciliada periodicamente.

Cada XML é uma publicação de movimentos, e não uma cópia de toda a base. O importador preserva campos ausentes, guarda todos os despachos e valida número, data e estrutura. XML truncado ou incompatível não publica alterações. O ZIP original fica no R2, com SHA-256 e metadados em `inpi_import`. O manifesto da carga inicial registra arquivos, hashes e linhas inconsistentes. A tela informa a data da carga histórica, a última RPI e quando a cobertura ainda é parcial.

Os resultados incluem a ficha oficial `https://servicos.busca.inpi.gov.br/marcas/<numero>`, a publicação de origem, titulares, classes, datas e campos disponíveis. O portal de fichas do INPI está em versão de avaliação e pode ter lacunas. O link permanece separado dos dados efetivamente importados. O XML não contém esse link: ele é formado a partir do número público do processo.

Situação nos CSVs e último despacho da RPI são informações distintas. Categorias gerais derivam de descrições reconhecidas; descrições ambíguas permanecem sem categoria. O `status` dentro de uma classe Nice não é a situação da marca. A seleção inicial inclui todos os status. O PDF continua sendo a publicação formal da RPI; não há processamento do PDF nesta implementação.

## Logotipos e agente

A pessoa pode enviar PNG, JPG ou WebP, até 5 MB. A tarefa `classification.trademark_logo`, configurável em Administração, IA, requer um modelo com visão. Ela descreve os elementos visíveis e sugere códigos existentes no catálogo de Viena do INPI. O aplicativo inclui os termos da [4ª edição publicada pelo INPI](https://manualdemarcas.inpi.gov.br/attachments/download/2175/viena.pdf), com atribuição à OMPI/WIPO e hash do PDF em `vienna-catalog.json`; descrições dos CSVs complementam o catálogo. Assim, a análise não depende da conclusão da carga histórica. Códigos inventados ou ausentes do catálogo são descartados. A tela exibe descrição, justificativas, fonte do catálogo e opção de refinar os códigos.

A busca figurativa encontra códigos em comum. Ela não compara pixels nem mede similaridade entre logotipos. Os dados abertos e o XML não fornecem os arquivos das imagens das marcas; o resultado oferece a ficha INPI para conferir a representação. Códigos oficiais de dois e três níveis são preservados.

O Lume recebe `k5_research_start_trademark_search` e `k5_research_analyze_trademark_logo` entre as ferramentas iniciais. Para uma imagem do Cofre ou anexada à conversa, analisa pelo `documentId` autorizado e consulta a base com `query.kind=vienna`. Para nomes, consulta diretamente a base. As ferramentas de histórico, paginação e detalhes estão no módulo research. As fontes obtidas entram no registro de citações da conversa. Ausência de resultado não certifica disponibilidade.

## Operação

As migrações aditivas são `0054_inpi_trademark_corpus.sql` e `0055_inpi_import_manifest.sql`. O PostgreSQL precisa de `pg_trgm`. O Worker existente despacha o `INPI_PROCESSOR`, um Container Node separado, com banco direto e armazenamento pelos bindings privados. O cron de minuto em minuto mantém o Container ativo enquanto importa; sem trabalho, ele adormece. Não há credenciais do INPI.

Na raiz:

```sh
pnpm --filter @k5/web inpi:admin status
pnpm --filter @k5/web inpi:admin sync
pnpm --filter @k5/web inpi:admin baseline
```

`K5_ENV_FILE=.env.postgres.local` seleciona a conexão direta de produção para esses comandos. Sem essa variável, usa o ambiente local. O comando baseline também aceita um diretório de CSVs completos; o tamanho deve corresponder ao arquivo oficial. Credenciais e arquivos de desenvolvimento ficam fora do Git.
