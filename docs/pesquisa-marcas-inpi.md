# Histórico e operação manual do INPI

> Desde 01/10/2026, novas pesquisas usam a [automação do Brand DB](implementacao-pesquisa-marcas.md). O cron não inicia a carga do INPI e o endpoint automático responde HTTP 410. Este documento conserva os detalhes do importador manual e da leitura dos históricos anteriores.

As pesquisas brasileiras anteriores consultavam o acervo público do INPI. Seus resultados e fontes continuam acessíveis no histórico. Históricos e logotipos enviados são privados da pessoa e do escritório; o acervo oficial é compartilhado.

## Dados e atualização

A carga inicial lê os CSVs de bibliografia, titulares, classes Nice e classificação de Viena dos [dados abertos do INPI](https://dadosabertos.inpi.gov.br/index/marcas/). O download usa intervalos HTTP de até 8 MiB, com tamanho e ETag forte validados antes de entregar bytes ao parser. HTTP inválido, truncamento, falha de rede e alteração confirmada do arquivo têm códigos distintos.

Os campos necessários são normalizados e comprimidos em armazenamento de objetos, em 512 partições por número de processo. Documentos pessoais dos titulares são descartados antes dessa preparação. A memória de preparação tem um lote de até 8 MiB ou 50 mil registros, mais um registro de até 2 MiB. Os bytes de entrada também disparam checkpoints, mesmo em linhas rejeitadas. Um objeto recebe até 1 MiB mais um registro; no máximo quatro uploads ocorrem ao mesmo tempo. Leitura, escrita e exclusão de objetos têm cancelamento em 60 segundos. Há um teto global de 16 GiB de intermediários e de entrada. Em produção, armazenamento remoto é obrigatório. O fallback local de desenvolvimento fica limitado a 128 MiB.

A identidade da carga inclui os quatro URLs, ETags, tamanhos, datas e a versão do formato. Arquivos locais de desenvolvimento acrescentam SHA-256. Cada objeto tem SHA-256 próprio. O catálogo é gravado antes do PUT; a confirmação dos objetos e o avanço do checkpoint ocorrem na mesma transação. O offset vem do contador de bytes do parser, depois de um registro CSV completo. Aspas, UTF-8 e quebras de linha internas não são pontos arbitrários de retomada. Objetos de uploads interrompidos são removidos antes de repetir o lote. Mudança de identidade ou corrupção suspende a carga e exige invalidação explícita do candidato.

O PostgreSQL recebe apenas uma partição por transação, limitada a 32 MiB e 100 mil linhas nos quatro arquivos somados. Uma restrição única na bibliografia impede multiplicação do JOIN por processos duplicados. A preparação insere no corpus candidato, confirma seu contador e avança `next_bucket` na mesma transação. Processos existentes que não constam da carga são preservados por paginação da chave, em lotes de mil registros e até 8 MiB. Despachos posteriores à data do baseline continuam prevalecendo.

A publicação troca os nomes do corpus e do catálogo de Viena em uma transação curta, junto com a conclusão de `inpi_import`. Até esse COMMIT, leitores acessam o corpus anterior. A busca mantém um lock compartilhado entre metadados, contagem e página; a publicação usa o lock exclusivo correspondente. Não há transação abrangendo todos os lotes. O corpus anterior fica disponível para rollback até começar a próxima atualização. O custo é manter duas cópias finais com índices durante a atualização, além de WAL e da carga normal do aplicativo.

O papel importador usa PostgreSQL 17+, `work_mem=4MB`, `maintenance_work_mem=16MB`, paralelismo SQL desativado, `statement_timeout=60s`, `transaction_timeout=120s`, `lock_timeout=3s` e `temp_file_limit` de no máximo 64 MiB. O último limite não cobre tabelas temporárias explícitas; por isso os tetos de bytes e linhas da partição são necessários. Uma passagem cede após aproximadamente dez minutos em um checkpoint; um watchdog cancela I/O aos doze minutos e suspende para investigação, enquanto SQL em andamento mantém os prazos acima. O teto acumulado de 24 horas é verificado entre lotes. Há um único importador por conexão direta, protegido por advisory lock liberado pelo PostgreSQL quando o backend termina. RPI aguarda conclusão ou invalidação de um candidato pendente.

Antes de cada lote com dados, a carga confere o tamanho do banco, do candidato com índices e do WAL. O padrão conserva a reserva para todo WAL gerado desde o início; o modo explícito `walMeasurement=retained` usa `pg_ls_waldir()` e recusa execução sem acesso a essa medição. Mantém 512 MiB de reserva para a unidade seguinte. A aprovação de capacidade é obrigatória, vence em até 24 horas e precisa reservar espaço também para WAL já existente, outros bancos/arquivos e crescimento normal do aplicativo. Ausência de aprovação, falta de disco ou read-only suspendem a carga. Não há valor padrão que presuma caber em 10 GB. Veja [evidências, capacidade e implantação](inpi-importacao-segura.md).

Cada tentativa é reservada duravelmente antes do trabalho. Falhas transitórias esperam 15, 30, 60, 120 e 240 minutos, com no máximo cinco execuções consecutivas sem conclusão saudável. Dentro de um intervalo de download há no máximo cinco tentativas com espera progressiva. Falhas de capacidade, fonte ou infraestrutura exigem intervenção; `force` não remove a suspensão. Uma queda mantém a reserva e os checkpoints. Se o cluster não aceitar nem o registro da falha, a reserva anterior continua válida e o processo aplica um intervalo local de quinze minutos. Não é possível gravar um novo motivo num banco sem escrita; esse erro adicional é reportado separadamente.

Os eventos `inpi_attempt`, `inpi_progress` e `inpi_interrupted` registram identificação, etapa, tentativas, contagens, bytes e duração, sem conteúdo dos CSVs. A preparação registra banco, candidato, temporários explícitos e WAL gerado. `temp_bytes` é acumulado do banco, não pico de disco. O coletor de volume mede o diretório físico do cluster e RSS do importador em desenvolvimento. A limpeza dos objetos é paginada, limita uma passagem a 4096 objetos e cerca de 30 segundos e pode continuar após falhas ou em manutenções seguintes.

O importador consulta o [índice da RPI](https://revistas.inpi.gov.br/rpi/) a cada cinco minutos, inclusive terça e quarta. A publicação costuma ocorrer às terças, mas o índice determina a edição disponível. Não há horário fixo presumido. Uma falha mantém a base anterior e agenda nova tentativa. Edições intermediárias são recuperadas em ordem, e a carga de dados abertos é reconciliada periodicamente.

Cada XML é uma publicação de movimentos, e não uma cópia de toda a base. O importador preserva campos ausentes, guarda todos os despachos e valida número, data e estrutura. XML truncado ou incompatível não publica alterações. Cada passagem importa no máximo duas edições. A edição continua atômica, com transação limitada a 120 segundos, ZIP de até 64 MiB e XML de até 256 MiB; a capacidade é conferida antes de cada lote de movimentos. O parser recebe blocos de 32 KiB e esvazia o lote ao alcançar 500 processos ou 8 MiB, admitindo apenas o excedente daquele bloco. Fragmentos sem término de processo ficam limitados a aproximadamente 2 MiB. Uma edição que não caiba nesses limites suspende a execução e exige revisão, sem publicação parcial. O ZIP original fica no R2, com SHA-256 e metadados em `inpi_import`. O manifesto da carga inicial registra as identidades dos arquivos; os checkpoints registram linhas aceitas e rejeitadas, e o catálogo registra hashes dos objetos. A tela informa a data da carga histórica, a última RPI e quando a cobertura ainda é parcial.

Os resultados incluem a ficha oficial `https://servicos.busca.inpi.gov.br/marcas/<numero>`, a publicação de origem, titulares, classes, datas e campos disponíveis. O portal de fichas do INPI está em versão de avaliação e pode ter lacunas. O link permanece separado dos dados efetivamente importados. O XML não contém esse link: ele é formado a partir do número público do processo.

Situação nos CSVs e último despacho da RPI são informações distintas. Categorias gerais derivam de descrições reconhecidas; descrições ambíguas permanecem sem categoria. O `status` dentro de uma classe Nice não é a situação da marca. A seleção inicial inclui todos os status. O PDF continua sendo a publicação formal da RPI; não há processamento do PDF nesta implementação.

## Logotipos e agente

A pessoa pode enviar PNG, JPG ou WebP, até 5 MB. A tarefa `classification.trademark_logo`, configurável em Administração, IA, requer um modelo com visão. Ela descreve os elementos visíveis e sugere códigos existentes no catálogo de Viena do INPI. O aplicativo inclui os termos da [4ª edição publicada pelo INPI](https://manualdemarcas.inpi.gov.br/attachments/download/2175/viena.pdf), com atribuição à OMPI/WIPO e hash do PDF em `vienna-catalog.json`; descrições dos CSVs complementam o catálogo. Assim, a análise não depende da conclusão da carga histórica. Códigos inventados ou ausentes do catálogo são descartados. A tela exibe descrição, justificativas, fonte do catálogo e opção de refinar os códigos.

A busca figurativa encontra códigos em comum. Ela não compara pixels nem mede similaridade entre logotipos. Os dados abertos e o XML não fornecem os arquivos das imagens das marcas; o resultado oferece a ficha INPI para conferir a representação. Códigos oficiais de dois e três níveis são preservados.

O Lume recebe `k5_research_start_trademark_search` e `k5_research_analyze_trademark_logo` entre as ferramentas iniciais. Para uma imagem do Cofre, analisa pelo `documentId` autorizado; para um anexo de chat, usa `attachmentId` restrito à pessoa, escritório e conversa atual e consulta a base com `query.kind=vienna`. Para nomes, consulta diretamente a base. As ferramentas de histórico, paginação e detalhes estão no módulo research. As fontes obtidas entram no registro de citações da conversa. Ausência de resultado não certifica disponibilidade.

## Operação

As migrações são `0054_inpi_trademark_corpus.sql`, `0055_inpi_import_manifest.sql`, `0056_inpi_staging_objects.sql`, `0057_inpi_bounded_import.sql` e `0058_integration_circuit_lanes.sql`. O PostgreSQL precisa de `pg_trgm`. O binding `INPI_PROCESSOR` permanece declarado por compatibilidade, mas o Worker não o despacha e o endpoint responde HTTP 410. A execução do importador é exclusivamente manual pela CLI. Não há credenciais do INPI.

Na raiz:

```sh
pnpm --filter @k5/web inpi:admin status
pnpm --filter @k5/web inpi:admin sync
pnpm --filter @k5/web inpi:admin capacity caminho/medicao.json
pnpm --filter @k5/web inpi:admin resume
pnpm --filter @k5/web inpi:admin baseline
```

`K5_ENV_FILE=.env.postgres.local` seleciona a conexão direta de produção para esses comandos. Sem essa variável, usa o ambiente local. Os comandos sync e baseline em produção precisam de acesso ao R2 para o XML e os arquivos intermediários; prefira a atualização agendada pelo Container, que já recebe os bindings privados. No desenvolvimento, o armazenamento local atende ambos. O comando baseline também aceita um diretório de CSVs completos; o tamanho deve corresponder ao arquivo oficial. Credenciais e arquivos de desenvolvimento ficam fora do Git.
