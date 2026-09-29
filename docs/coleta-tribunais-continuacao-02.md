# Continuação da coleta de STF, STJ e TST

Segunda execução assistida, em 28/09/2026, com um subagente por tribunal. Os três lotes foram publicados no PlanetScale `araujodgdev/lume`, branch `main`, banco `postgres`, schema `public`, com arquivos no R2 `k5-vault-staging`.

| Tribunal | Julgados novos | Ementas novas | Íntegras novas | Total de julgados após publicação |
| --- | ---: | ---: | ---: | ---: |
| STF | 5 | 5 | 0 | 7 |
| STJ | 15 | 5 | 10 | 23 |
| TST | 5 | 5 | 5 | 7 |

O acervo desses três tribunais agora contém 37 julgados, com 22 ementas e 22 íntegras. Alguns julgados têm ambos os materiais. Nesta rodada, 54 objetos foram enviados ao R2 e baixados novamente para conferir os hashes.

## Retomada e cobertura

- STF: sete de vinte resultados da consulta atual coletados. Próximo índice 7 na primeira página, com nova leitura e deduplicação. As sete íntegras permanecem pendentes. A rota processual permitiu obter um RTF oficial, mas seu conteúdo era somente dispositivo, sem relatório ou votos. O original foi preservado localmente e sua extração TXT foi salva no R2 como evidência complementar. Não foi classificado como inteiro teor. A enumeração do tesauro continua limitada à letra A; sinônimos não são tratados como novos temas independentes.
- STJ: quinze de 65 textos do ZIP e oito de 1.100 espelhos do recurso atual publicados. Próximos índices 15 e 8, respectivamente. O lote usa 44 assuntos oficiais, com 52 relações documento-assunto. A fila local organiza os documentos do ZIP por 129 assuntos encontrados nos metadados; nenhum tema foi predefinido. O ZIP contém menos textos que a listagem de metadados, e isso continua registrado como lacuna de cobertura.
- TST: sete de 74 resultados do ramo atual coletados. A busca foi refeita e os dois IDs anteriores foram reconhecidos e descartados antes de preparar cinco novos. Próxima posição 8 na primeira página, identificador `270ea1ec0e8f4614ac19a800a311b93c`. Os cinco HTML de inteiro teor foram baixados da fonte oficial e preservados. Decisões diferentes do mesmo processo continuam separadas.

Todos os checkpoints estão no PostgreSQL com status `partial`, sem lease ativo após a conclusão. Nenhum agendamento foi criado. Esta execução não conclui a varredura dos tribunais.

## Publicação e verificações

O publicador operacional de continuação usa `expectedPreviousRunId` para recusar um lote preparado sobre um checkpoint antigo. Reexecutar o mesmo lote do STF após sua conclusão foi recusado, sem nova execução ou duplicação de julgados. A continuação reutiliza as permissões das fontes cadastradas; não as reativa nem altera suas fichas.

O método de obtenção dos originais fica no manifesto e nas referências dos arquivos. O HTML oficial e a extração de texto são preservados separadamente. Captura de página, OCR e documento oficial baixado possuem identificação própria; nenhum texto ausente é completado pela IA.

Foram conferidos os hashes locais dos originais, os hashes dos objetos após download do R2, os textos publicados contra os manifestos e o avanço dos checkpoints. A verificação final não encontrou divergências. Os scripts operacionais passaram na verificação de sintaxe. Não houve alteração de código de produção, de schema ou de deploy nesta rodada.

Execuções:

- STF: `21ff9f8b-0740-4b9c-ae53-abf30b31dd74`.
- STJ: `45cc71b9-e289-4904-8123-33c63653156c`.
- TST: `6a8e9fd2-2735-4ead-88aa-016040178ab7`.

Comprovantes preservados no repositório:

- [STF publicado](coletas/jurisprudencia/stf/continuacao-02/publication-result.json).
- [STJ publicado](coletas/jurisprudencia/stj/continuacao-02/publication-result.json).
- [TST publicado](coletas/jurisprudencia/tst/continuacao-02/publication-result.json).
- [Conferência consolidada](coletas/jurisprudencia/shared/verification-continuacao-02.json).

Os arquivos de trabalho e scripts foram arquivados localmente durante a [limpeza da coleta](coletas/jurisprudencia/README.md).

Os manifestos também estão no R2, referenciados em `research_crawl_run.evidence_storage_key`. O lote inicial está descrito no [relatório anterior](coleta-tribunais-2026-09-28.md).
