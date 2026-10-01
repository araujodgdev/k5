# Importação INPI: evidências e operação segura

> Decisão posterior, em 01/10/2026: o usuário solicitou o retorno à [automação WIPO](implementacao-pesquisa-marcas.md). O agendamento INPI foi removido e o endpoint automático agora retorna HTTP 410. Este relatório registra a correção e o ensaio do importador, que permanece disponível apenas pela CLI. O plano de ativação abaixo é histórico e não deve ser executado como parte do retorno ao Brand DB.

## O que o incidente permite concluir

O contexto fornecido registra `No space left on device` em `base/pgsql_tmp/pgsql_tmp522422.462` às 16:53:05 UTC de 30/09/2026, armazenamento de 9,97 GB de 10 GB às 16:54 e erros posteriores de read-only. Não foram consultados produção, logs adicionais, métricas privadas ou o artefato implantado.

O HEAD local é `80a1267`. Nesse commit, quatro CSVs inteiros eram copiados para tabelas temporárias indexadas, e uma quinta relação consolidava os dados com agrupamentos e DISTINCT. Isso permite coexistência do corpus permanente, fontes temporárias, índices, resultado intermediário, arquivos de ordenação e WAL. A limpeza no `finally` só atua depois desse pico. A tentativa seguinte, após quinze minutos e sem baseline concluído, podia repetir toda a pressão.

O caminho `pgsql_tmp` é compatível com arquivos de trabalho de consultas. Não identifica a consulta responsável. A queda posterior de uso também é compatível com liberação de temporários, mas não prova autoria. O importador é uma causa plausível sustentada pelo código; a atribuição da consulta e da versão em produção continua pendente.

Na abertura deste trabalho já havia alterações locais para preparação em objetos e 32 partições. Elas foram revisadas e substituídas onde ainda mantinham uma transação de publicação integral, checkpoints apenas de arquivos inteiros e novas tentativas sem limite.

## Contrato de capacidade

O importador não inicia sem `inpi_sync.capacity` válido. O JSON aceito por `inpi:admin capacity <arquivo>` contém valores inteiros em bytes:

- `diskBytes`: capacidade física confirmada para o cluster.
- `databaseBytes`: teto permitido para o banco do Lume, incluindo corpus ativo/candidato, índices, tabelas normais e catálogo de importação.
- `candidateBytes`: teto da relação candidata, incluindo TOAST e índices.
- `walBytes`: teto de WAL, incluindo a reserva de 512 MiB para o próximo lote.
- `walMeasurement`: `generated` (padrão conservador) contabiliza todo WAL gerado no cluster desde o início da carga, sem pressupor reciclagem. `retained` mede a soma real de arquivos em `pg_ls_waldir()` antes de cada lote; exige acesso e confirmação de que essa visão corresponde ao armazenamento cobrado pelo provedor. Sem permissão, a carga suspende. A telemetria conserva também o WAL gerado nos dois modos.
- `otherBytes`: outros bancos, arquivos do cluster e qualquer uso do mesmo disco que não esteja em `pg_database_size` ou na medição de WAL escolhida. No modo `generated`, incluir aqui também o WAL que já existia na medição inicial; no modo `retained`, ele já está contabilizado em `walBytes`.
- `appReserveBytes`: folga adicional de pelo menos 1 GiB para operação normal.
- `approvedUntil`: data ISO, com validade de no máximo 24 horas.

O código exige:

```text
databaseBytes + walBytes + otherBytes + appReserveBytes + 512 MiB <= diskBytes
```

Antes de novos lotes, banco, candidato e WAL precisam estar pelo menos 512 MiB abaixo dos seus respectivos tetos. Essa reserva evita admitir um lote quando já se está próximo do limite. Os lotes têm limites próprios de bytes, registros, objetos, memória de SQL e tempo. A medição de `pg_database_size` não informa espaço livre físico nem WAL retido. A aprovação exige medições do provedor/host e monitoramento de crescimento de outros fluxos; o código não inventa essas métricas quando o papel não tem acesso.

Para uma atualização, a base do cálculo é aplicação sem INPI, corpus ativo com índices, candidato completo com índices, catálogo intermediário, WAL e outros arquivos. O contrato também exige 512 MiB livres dentro do teto do banco, 512 MiB dentro do teto do WAL e mais 512 MiB fora desses tetos. Portanto, com medições em bytes, o mínimo de admissão é:

```text
aplicação + corpus ativo + candidato + catálogo + WAL + outros + appReserveBytes + 3 × 512 MiB
```

`candidateBytes` precisa comportar candidato mais 512 MiB, mas já está incluído no teto do banco. O corpus anterior e o candidato são necessários para uma troca consistente. Reduzir temporários não elimina esse custo permanente. A fórmula é um piso baseado nas medições; crescimento futuro e diferenças do ambiente precisam de margem adicional.

Nenhum orçamento de produção foi gravado. O ensaio local usa um orçamento explícito de desenvolvimento, que não autoriza mudança de plano. Os resultados e os limites do ensaio estão registrados abaixo; amostras funcionais não certificam a carga real.

| Unidade | Limite aplicado |
| --- | --- |
| Download HTTP | 8 MiB por intervalo, 30 s por requisição, cinco tentativas |
| Parser CSV | entrada em blocos de 32 KiB; registro de até 2 MiB |
| Preparação em memória | 8 MiB de entrada ou de linhas normalizadas, ou 50 mil linhas, mais um registro; rejeitados também avançam checkpoints |
| Objetos | até 1 MiB mais um registro por objeto; quatro PUTs simultâneos; PUT, GET e DELETE com cancelamento em 60 s |
| Intermediários globais | 16 GiB descomprimidos; fallback local de desenvolvimento de 128 MiB |
| Partição SQL | 512 partições; cada uma com até 32 MiB e 100 mil linhas nos quatro arquivos somados |
| Dados anteriores consultados por lote | até 32 MiB; carregamento de ausentes em lotes de mil registros e 8 MiB |
| SQL | statement 60 s, transação 120 s, espera de lock 3 s, work_mem 4 MiB, maintenance_work_mem 16 MiB, sem paralelismo |
| Temporários de execução | temp_file_limit de até 64 MiB; relações temporárias explícitas limitadas pelo tamanho da partição |
| Execução | checkpoints encerram fatias após dez minutos; watchdog cancela I/O aos doze minutos e suspende para análise; SQL em andamento continua sujeito a statement 60 s/transação 120 s; teto acumulado de 24 horas verificado entre lotes; uma sessão importadora por vez |

Os limites não são uma quota física do provedor: outros clientes ainda podem consumir disco. A reserva de 512 MiB é um limite de admissão conservador a confrontar com o crescimento por lote medido, e não uma medição de espaço livre. Se o ambiente não permitir medir e reservar o envelope completo, a condição correta é permanecer suspenso. A preparação não mantém os quatro CSVs integrais no PostgreSQL nem no container de produção.

Os limites em bytes dos registros/lotes descrevem a carga útil codificada em UTF-8, não o RSS total. Strings, arrays, compressão, clientes e runtime acrescentam memória; por isso o ensaio mede RSS separadamente. O teto de objetos usa tamanho descomprimido, e a medição registra também os bytes comprimidos efetivamente armazenados.

O `wrangler.jsonc` local configura o importador dedicado como `basic`, com uma instância. Na documentação atual, esse tipo oferece [1 GiB de memória e 4 GB de disco](https://developers.cloudflare.com/containers/platform/limits/). A configuração não foi alterada. O RSS medido é do processo de importação em Windows, não do container Linux inteiro; o rollout precisa confirmar a soma com o processo supervisor e as bibliotecas. Os CSVs/intermediários completos não usam esse disco em produção, pois o armazenamento remoto é obrigatório.

## Checkpoints e publicação

`inpi_import.identity` identifica os quatro arquivos conjuntamente. `inpi_file_checkpoint` guarda cabeçalhos, offset em fronteira de registro, contagens, ordinal e término. `inpi_staging_object` guarda objetos, hash, bytes, linhas e confirmação. A fase, próximo bucket, cursor dos registros anteriores e tempo acumulado ficam em `inpi_import`.

O importador não mistura arquivos de execuções distintas. Um objeto corrompido suspende a execução. `invalidate` limpa somente intermediários/candidato de cargas pendentes e marca essas cargas como invalidadas. Não remove o corpus publicado. A limpeza pode precisar de várias chamadas, pois também é limitada.

Encerrar uma fatia cancela e aguarda todo o pipeline de leitura. Erros do stream de entrada não escapam como rejeições assíncronas depois de um checkpoint confirmado. A expiração do watchdog conserva os checkpoints e exige `resume` após investigar a latência.

O servidor do container mantém `/run/trademarks` pendente até terminar a fatia, permitindo que `run()` renove a atividade a cada quinze segundos. Não depende de despachos repetidos do cron durante a reserva de quinze minutos. Chamadas HTTP concorrentes compartilham a execução; uma falha é reportada uma vez e todas recebem HTTP 500. Baselines que consumiram um minuto ou mais deixam a RPI para outro disparo. O monitor do despacho aceita quinze minutos, alinhado ao [limite de duração dos Cron Triggers](https://developers.cloudflare.com/workers/platform/limits/); interrupções de plataforma continuam sujeitas aos checkpoints e à reserva durável.

Na migração, cargas antigas concluídas conservam seus metadados e recebem fase `done`. Cargas antigas interrompidas, sem checkpoints em fronteiras CSV, recebem fase `invalidated`; seus intermediários entram na limpeza limitada antes de admitir uma nova carga. O conteúdo do corpus publicado permanece intacto. Essa transição também tem teste de atualização a partir das migrações anteriores.

A cópia anterior fica em `inpi_trademark_previous` e `inpi_vienna_previous` até a próxima atualização. A nova tabela conserva checks, índices e permissões concedidas. A referência de `import_id` é mantida. A FK de eventos para a tabela física antiga foi removida na migração: o histórico é estável, enquanto a tabela física do corpus muda. A integridade de processos é mantida pelo RPI, que insere o processo antes do evento, e pelo baseline, que carrega adiante todos os processos anteriores. Escritas diretas fora desses importadores não fazem parte desse contrato.

Cada busca guarda internamente a identidade da última publicação concluída. Se o corpus mudar entre páginas, a paginação é interrompida com estado parcial e mensagem para iniciar uma nova pesquisa; os resultados anteriores são preservados. O identificador interno não entra no contrato público da tela. O lock compartilhado continua garantindo consistência entre metadados, contagem e resultados dentro de cada página.

## Integrações

Cron e Queue executam tarefas com resultados explícitos. Falha na limpeza do WhatsApp permite executar WhatsApp, e-mail pessoal e Google quando o banco continua disponível. O resultado agregado falha se alguma tarefa falhar. A Queue não confirma mensagens numa passagem parcial; os processadores existentes continuam responsáveis pelas reservas, leases e idempotência de cada envio.

As decisões de retry são explícitas por mensagem e levam o atraso de 900 segundos, conforme a API e as regras de precedência documentadas pelo [Cloudflare Queues](https://developers.cloudflare.com/queues/configuration/batching-retries/).

Um erro de disco, read-only ou conexão com o banco interrompe as tarefas restantes antes de novos envios. O circuito reserva quinze minutos no banco antes da passagem e consulta essa reserva antes de tentar outra escrita. Uma mensagem de fila é apenas uma dica; o lote inteiro executa uma passagem, e as mensagens recebem retry com atraso de 900 segundos. O processo Node também espera quinze minutos nessas falhas. Se a primeira reserva já falhar porque todo o cluster está read-only, não há como persistir um novo circuito; resta uma sondagem por disparo novo e o intervalo local. Não há repetição por mensagem nem por tarefa nesse caso.

As reservas saudáveis do Worker e do processador Node pesado são separadas pela migração 0058. Assim, importar um arquivo do Drive não bloqueia uma passagem independente de WhatsApp/e-mail no Worker. Cada executor mantém sua espera durável após falha; o circuito local por indisponibilidade continua abrangendo todas as tarefas do processo.

Uma reserva de outra passagem saudável aparece como `pass_reserved` e não abre o circuito local por quinze minutos. Erros ambíguos de socket podem vir do armazenamento ou do provedor; nesse caso há uma única sondagem de escrita no banco antes de decidir se as tarefas independentes podem continuar. SQLSTATE de falta de disco/read-only interrompe diretamente. Relatórios automáticos recebem mensagens genéricas e códigos; os erros originais ficam apenas no resultado em memória.

## Rollout proposto, ainda não executado

1. Suspender o cron/importador antigo e confirmar que seu advisory lock foi liberado. Identificar a versão implantada e a consulta do incidente, se logs do provedor estiverem disponíveis.
2. Guardar backup e conferir capacidade física, WAL/slots de replicação, papel de importação direto, PostgreSQL 17+ e permissões para DDL e limite de temporários. O aplicativo continua usando sua conexão normal; session locks do importador exigem conexão direta, sem pool transacional externo.
3. Aplicar as migrações 0056/0057/0058 e publicar juntos leitor, importador, agendador e integrações novos. A migração remove uma FK; agendar janela para o lock de DDL. Não iniciar o binário antigo após a migração/corte.
4. Sem aprovação de capacidade, a carga deve suspender antes do download. Registrar orçamento somente após o ensaio completo e a medição do ambiente de destino. Executar `capacity`, `resume` e uma passagem, acompanhando os checkpoints.
5. Verificar buscas durante preparação, falhas deliberadas em desenvolvimento, dados após a troca, WAL, disco físico, memória e ausência de novos retries no estado suspenso. Manter alertas de folga física, duração e crescimento do WAL.

## Rollback proposto

Antes do corte, suspender a manutenção basta para conservar o corpus antigo. O candidato e os checkpoints podem ser retomados ou invalidados depois da análise. Não reativar o importador integral antigo.

Após o corte, pausar importação/RPI, obter o lock de importação e o lock exclusivo de publicação e conferir se houve RPI posterior ao corte. Sem publicações posteriores, a troca inversa das duas tabelas pode ser feita na mesma transação que marca a nova carga como invalidada e suspende o agendamento. O corpus substituído deve ser preservado com outro nome para auditoria; não apagá-lo como primeira ação.

Se já houve RPI posterior, a cópia anterior está defasada. Não fazer troca cega: preparar uma restauração com replay das edições arquivadas e validar eventos, processos e metadados antes do corte inverso. Preferir correção adiante quando a restauração não estiver validada. Reverter apenas o código sem alinhar leitores, migrações e metadados não é um rollback seguro.

## Validação e medições

Consulte também os testes `inpi-bounded-import.test.ts`, `inpi-trademarks.test.ts`, `integration-pass.test.ts` e o ensaio opt-in `inpi-volume.test.ts`.

O ensaio de volume é executado na raiz com `K5_INPI_VOLUME=1 pnpm --filter @k5/web test tests/inpi-volume.test.ts`. Ele recusa bancos que não sejam a instância descartável do runner, usa os quatro CSVs oficiais inteiros, mede o diretório físico do cluster, intermediários, memória RSS/heap do importador, WAL e duração, e grava `.data/inpi-validation/volume.json` no aplicativo. O armazenamento de objetos é simulado em um diretório exclusivo de desenvolvimento com teto; não há PUT em R2 de produção.

Os picos físicos são amostrados a cada dois segundos; RSS dos processos PostgreSQL, a cada dez segundos. A soma de RSS pode contar páginas compartilhadas mais de uma vez. O importador também registra o máximo RSS informado pelo sistema operacional ao terminar. O ensaio ocorre em Windows com PostgreSQL descartável, sem tráfego real do Lume, e compartilhou a máquina com validações locais. Duração e latência de objetos não representam um benchmark do ambiente de produção.

Versões locais verificadas: Node 26.6.0, pnpm 12.4.2 (fixado pelo repositório) e PostgreSQL 18.4. O Windows informa aproximadamente 14,8 GiB de memória física visível. Os bytes de diretórios são a soma dos tamanhos de arquivos; não incluem a folga de alocação/metadata do NTFS. Os objetos simulados são medidos pelos bytes comprimidos armazenados.

O ensaio começou antes dos ajustes finais de cancelamento do pipeline, checkpoint também por bytes de entrada, watchdog e opção de WAL retido. Esses ajustes passaram nos testes funcionais finais; o esquema, os índices e o processamento SQL por partição medidos são os mesmos. O vínculo entre a resposta HTTP e a conclusão da fatia também foi corrigido depois do ensaio e tem um teste HTTP separado. A medição não certifica o último binário inteiro no container de produção. A preparação com checkpoints mais frequentes pode aumentar a quantidade de objetos e o catálogo; a aprovação do destino deve medir esse custo também.

Durante o ensaio, o orçamento lógico de desenvolvimento foi recalibrado com os dados observados. No lote 465, `max_wal_size` da instância **descartável** passou de 1 GB para 4 GB, para reduzir checkpoints forçados. Os picos finais incluem ambos os períodos. Não houve mudança de plano, disco, R2 ou configuração de produção. O artefato de medições registra os valores e horários de cada ajuste; reproduzir números exige considerar essa calibração, a concorrência de outras validações locais e a diferença entre WAL gerado e retido.

Em 01/10/2026, os HEADs públicos retornaram 934.724.960 bytes de bibliografia, 3.823.211.155 de Nice, 821.622.061 de Viena e 851.839.745 de depositantes. Total: 6.431.397.921 bytes. Todos tinham Last-Modified em 26/09/2026 e ETags fortes. Esses números são tamanhos de entrada, não uma medição do corpus final.

| Verificação | Resultado |
| --- | --- |
| `pnpm lint` | Passou: zero erros; um warning já existente em `src/lib/judicial/connectors/transport.ts:416` (`_bytes` não utilizado) |
| `pnpm typecheck` | Passou |
| `pnpm db:setup` e `pnpm build` | Passaram em PostgreSQL descartável, com ambiente de desenvolvimento e upload Sentry desabilitado; Turbo avisou sobre limite de tamanho de link de cache do Mammoth no Windows |
| `pnpm integrations:build` | Passou em dry-run, sem deploy |
| Última suíte completa, `K5_TEST_CONCURRENCY=1 pnpm test` | 733 testes: 721 passaram, 11 falharam e o volume opt-in foi ignorado; 26 min 47 s no runner (27 min 21 s no comando raiz). Executada antes do ajuste final da resposta HTTP; a revalidação específica está registrada abaixo |
| Dez falhas de agenda | `Connection terminated due to connection timeout` em `postgresFixture`, antes de executar as asserções de negócio. Reexecução isolada de `agenda.test.ts`: 10/10 passaram em 19,9 s. Não foram alterados agenda ou fixture para ocultar essas falhas |
| Falha de PDF | Teste existente `document-pdf.test.ts`, conversão pelo LibreOffice sem resultado em 90 s, retornando 503. Reproduzida isoladamente; os arquivos do conversor não foram alterados |
| Casos INPI/integrações | Os 35 casos passaram na suíte final, inclusive migração, 60 mil registros CSV multilinha/BOM/linhas finais vazias, retomada, leitura concorrente, falha no COMMIT, encerramento real do backend, perda de conexão durante PUT/COPY, HTTP/ETag inválido, corrupção, SQLSTATE 53100, read-only real, watchdog e independência entre Node e Worker |
| Revalidação após o ajuste HTTP | 39/39 passaram, sem falhas ou ignorados, em 6 min 43 s: os 35 casos acima, três testes dos processadores e o teste HTTP de espera, concorrência, erro 500 e execução posterior saudável. Comando na raiz: `pnpm --filter @k5/web test tests/processor-inpi.test.ts tests/processors.test.ts tests/inpi-bounded-import.test.ts tests/inpi-trademarks.test.ts tests/integration-pass.test.ts` |
| Ensaio completo dos CSVs oficiais | Passou: quatro arquivos completos, 512 lotes e 6.632.742 processos publicados; 2 h 23 min 23 s, incluindo coleta final |

Os logs locais estão em `apps/web/.data/inpi-validation/` (ignorados pelo Git): `root-delivery.log`, `agenda-isolated.log`, `lint-liveness.log`, `types-liveness.log`, `build-liveness.log`, `integrations-liveness.log`, `liveness-final.log` e `volume-complete.log`. Lint, tipos, setup/build e dry-run de integrações foram repetidos e passaram após o ajuste HTTP. A execução serial anterior, antes dos últimos endurecimentos, terminou com 724/726 aprovações, um PDF falho e o volume ignorado (`root-serial-verified.log`). Uma execução concorrente intermediária foi interrompida porque a varredura de arquivos PostgreSQL no Windows dominava o tempo dos testes. As falhas intermediárias de EOF/pipeline e de isolamento do catálogo de teste foram corrigidas; os casos correspondentes passaram na última suíte completa.

### Resultado do volume completo

O [artefato de medições](inpi-volume-2026-10-01.json) contém identidades/ETags, checkpoints, tamanhos exatos em bytes, parâmetros, ajustes e limitações. GB abaixo é decimal; MiB é binário.

| Medida | Resultado |
| --- | --- |
| Entrada oficial | 6,43 GB; quatro CSVs completos |
| Processos publicados | 6.632.742 |
| Corpus final com TOAST e índices | 7,45 GB |
| Banco ao publicar, incluindo catálogo e tabelas do aplicativo vazio | 7,82 GB |
| Pico do diretório PostgreSQL, incluindo WAL e temporários | 10,40 GB |
| Pico de objetos comprimidos no armazenamento simulado | 1,91 GB |
| Maior partição de entrada SQL | 12,21 MiB e 61.760 linhas (máximos observados separadamente) |
| Pico de relações temporárias explícitas por lote, com índices/TOAST | 26,97 MiB |
| Maior crescimento observado entre lotes | banco: 19,96 MiB; WAL gerado: 355,83 MiB |
| WAL gerado acumulado | 39,91 GB; não é ocupação simultânea |
| Pico de WAL retido observado | 2,50 GB; inclui a calibração de checkpoint descrita acima |
| RSS máximo do processo Node, incluindo instrumentação/coleta final | 477,55 MiB |
| Maior heap Node amostrado | 162,76 MiB |
| Maior soma de RSS dos processos PostgreSQL | 863,36 MiB; pode contar páginas compartilhadas repetidamente |
| Tempo total | 2 h 23 min 23 s; publicação observada às 08:46:16 UTC de 01/10/2026 |

A bibliografia aceitou 6.632.742 linhas e rejeitou 12; Nice, 5.331.060/14; Viena, 9.959.983/23; depositantes, 6.697.548/7. Todos os offsets chegaram exatamente aos tamanhos dos arquivos. As rejeições seguem a validação de identificadores/classes; não são registros descartados por interrupção. O corpus final coincide com a quantidade de processos bibliográficos aceitos.

**10 GB não comportam a atualização com duas versões.** Só os dois corpora medidos exigem 14.909.341.696 bytes. Aplicando ao ensaio o catálogo/banco vazio adicional medido, WAL retido de 2,50 GB, 128 MiB para outros arquivos, reserva operacional mínima de 1 GiB e as três reservas de 512 MiB, o piso aritmético de admissão é **20.592.776.895 bytes (20,59 GB)**. Somar os dados reais do restante do Lume, crescimento do corpus, diferenças do catálogo final e margem para o ambiente de destino. Isso não é uma recomendação de plano nem uma capacidade de produção homologada.

No modo conservador `generated`, a mesma conta com os 39,91 GB gerados exige aproximadamente 58 GB; esse excesso de reserva é intencional quando não se pode medir retenção. O modo `retained` evita tratar WAL já reciclado como ocupação atual, mas só deve ser aprovado quando a métrica representar o armazenamento do provedor. Nem o pico de 10,40 GB deste ensaio inicial nem amostras pequenas autorizam operar a atualização num disco de 10 GB.

Não foram executados uma atualização completa de 6,6 milhões de processos sobre outro corpus completo, um ensaio do binário final em Linux/R2 real ou tráfego concorrente real do Lume. Atualização, preservação do corpus anterior e falhas de publicação foram verificadas funcionalmente; o volume real mediu a importação inicial. O rollout deve validar essas diferenças e o volume de operações no armazenamento de objetos antes de autorizar custos ou ativar a carga.

A revisão automática das ferramentas bloqueou a remoção do cache recompilável `apps/web/.next/cache`, sem detalhar o motivo. O cache foi mantido; isso não bloqueou os testes ou a medição. Não foram apagados dados de produção.

## Arquivos da correção

- `apps/web/db/postgres/0057_inpi_bounded_import.sql`: checkpoints, estado de retomada, capacidade, circuito de integrações e ajuste da FK do corpus. Usa o catálogo de objetos de `0056_inpi_staging_objects.sql`, que já estava presente nas alterações locais.
- `apps/web/db/postgres/0058_integration_circuit_lanes.sql`: reservas independentes para trabalho pesado Node e tarefas leves do Worker.
- `apps/web/src/lib/research/trademarks/inpi-{baseline,staging,publish,capacity,retry,errors,download}.ts`: preparação limitada, publicação, proteção de recursos e classificação de falhas.
- `apps/web/src/lib/research/trademarks/inpi-{sync,xml,search}.ts`: RPI, manutenção e consistência dos leitores.
- `apps/web/src/lib/integration-pass.ts`, `src/workers/integrations.ts`, `src/lib/whatsapp/worker.ts` e `scripts/integrations-worker.ts`: isolamento das tarefas, erros explícitos e circuito.
- `apps/web/src/lib/storage/index.ts` e `src/lib/container-bindings.ts`: cancelamento de leitura, upload e exclusão, timeout e reutilização do cliente S3.
- `apps/web/src/workers/web.ts`, `src/lib/observability/diagnostics.ts` e `scripts/inpi-admin.ts`: despacho apenas quando autorizado pelo estado, códigos seguros e operação.
- Na etapa anterior ao retorno à WIPO, `apps/web/scripts/processor-server.ts`, `scripts/processor-inpi.ts` e `tests/processor-inpi.test.ts` vinculavam a resposta HTTP à conclusão da fatia. A desativação posterior substituiu esse fluxo por HTTP 410 e removeu o helper e seu teste. A linha de revalidação de 39 testes acima registra aquela etapa anterior, não um comando executável no estado atual. Veja a validação atual em [Pesquisa com WIPO](implementacao-pesquisa-marcas.md#validação-do-retorno).
- `apps/web/tests/inpi-bounded-import.test.ts`, `inpi-trademarks.test.ts`, `integration-pass.test.ts` e `inpi-volume.test.ts`: casos funcionais, falhas reais/injetadas e volume oficial.
- `docs/pesquisa-marcas-inpi.md` e este documento: contrato, evidências, operação e limitações. As alterações locais prévias em `src/workers/processors.ts` e `tests/processors.test.ts` foram preservadas.

## Referências

- [PostgreSQL: limites de recursos](https://www.postgresql.org/docs/current/runtime-config-resource.html). `temp_file_limit` não inclui tabelas temporárias explícitas.
- [PostgreSQL: locks explícitos](https://www.postgresql.org/docs/current/explicit-locking.html). Locks de sessão terminam quando a sessão acaba; locks transacionais terminam com a transação.
- [PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html). A troca de nomes precisa de locks de DDL.
- [PostgreSQL 17: funções administrativas](https://www.postgresql.org/docs/17/functions-admin.html). `pg_ls_waldir()` lista tamanhos de arquivos ordinários do diretório WAL e exige privilégios; arquivos externos/arquivados precisam de reserva separada.
- [INPI: dados abertos de marcas](https://dadosabertos.inpi.gov.br/index/marcas/).
