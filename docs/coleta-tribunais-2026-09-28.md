# Coleta inicial de STF, STJ e TST

Execução assistida em 28/09/2026 por três subagentes, um por tribunal. Este registro descreve o lote efetivamente publicado, não uma varredura completa nem um agendamento recorrente.

## Resultado publicado

| Tribunal | Julgados | Ementas prontas | Íntegras prontas | Descritores descobertos | Objetos R2 conferidos |
| --- | ---: | ---: | ---: | ---: | ---: |
| STF | 2 | 2 | 0 | 1.631 | 5 |
| STJ | 8 | 3 | 5 | 907 | 14 |
| TST | 2 | 2 | 2 | 13 | 8 |

Metadados e textos pesquisáveis estão no PlanetScale `araujodgdev/lume`, branch `main`, banco `postgres`, schema `public`. Os objetos estão no R2 `k5-vault-staging`, em `research/sha256/`, com nomes derivados do SHA-256. Cada objeto foi baixado novamente e teve seu hash conferido antes da publicação dos vínculos no banco.

As ementas e íntegras usam o fluxo existente `upsertSourceJudgment` e `publishMaterialText`. Os HTML e o PDF originais foram preservados como versões `official-original-v1`, sem substituir a versão textual pesquisável. Os JSON de metadados do STF são evidências da execução, não versões de inteiro teor.

## Progresso

- STF: letra A do tesauro, 1.638 entradas agrupadas em 1.631 descritores únicos. Primeiro descritor canônico descoberto produziu 20 resultados; dois foram coletados. Retomar a primeira página com deduplicação e índice de referência 2. A enumeração do catálogo continua na letra B. As duas íntegras permanecem pendentes: HTTP direto retornou corpo vazio, e o navegador bloqueou o visualizador. Correspondência temática vem da consulta oficial, não de uma classificação CNJ presumida.
- STJ: 12 conjuntos oficiais descobertos. O recurso de metadados de 22/09/2026 contém 2.752 registros e 907 códigos de assunto; 905 têm rótulo no CSV oficial do CNJ. O ZIP correspondente contém 65 textos, dos quais cinco foram publicados; isso não comprova disponibilidade dos demais registros dos metadados. Três de 1.100 espelhos do recurso de agosto foram publicados. Próximos índices: 5 no ZIP e 3 nos espelhos. Documentos DJE usam o namespace `stj-dje:<SeqDocumento>`, sem associação presumida com espelhos.
- TST: seis assuntos-raiz e sete descendentes descobertos na árvore oficial. A consulta pelo primeiro ramo exposto retornou 74 acórdãos. Dois foram coletados; retomar a primeira página, deduplicando, com referência à terceira posição. Ambos pertencem ao mesmo processo, mas são decisões distintas. Dois HTML e um PDF oficial foram preservados; o PDF teve páginas, processo e dispositivo conferidos.

Nenhuma lista de palavras-chave foi predefinida. Cada catálogo permanece parcial e deverá ser atualizado durante as próximas coletas.

## Banco e fichas

A migração [0040_research_crawl.sql](../apps/web/db/postgres/0040_research_crawl.sql) adiciona o catálogo de assuntos, as partições com lease e checkpoint, o histórico de execuções e as relações entre assuntos e julgados. Foi aplicada pelo migrador normal, sem editar migrações anteriores. O papel de execução tem acesso às tabelas novas.

Fichas: [STF](../apps/web/db/sources/stf-staging.json), [STJ](../apps/web/db/sources/stj-ckan-staging.json) e [TST](../apps/web/db/sources/tst-staging.json). STF e TST estão admitidos para armazenamento, com transporte automático desabilitado: a coleta atual é assistida e não há conector autônomo de busca registrado. STJ reutiliza a instalação existente; sua permissão de documentos foi atualizada após conferir a licença CC-BY, o dicionário e a correspondência dos identificadores de um lote oficial. O envio a provedores de IA não foi habilitado.

Execuções persistidas:

- STF: `73e15cce-7694-4706-b683-40aa76cd84a9`.
- STJ: `2e0cc266-618c-4b18-a4b4-7ef99a44206f`.
- TST: `f31565d0-f5a4-4ae5-87ca-1a95fa7a587c`.

Todas têm status `partial`. O checkpoint foi avançado somente após publicar o lote. Não há lease ativo ao fim dessas execuções.

## Evidências e reprodução

Os diretórios locais `output/jurisprudencia/stf`, `stj` e `tst` contêm os manifestos, os arquivos coletados e `publication-result.json`. A conferência consolidada está em `output/jurisprudencia/shared/verification.json`. Os manifestos também estão no R2 e seus endereços em `research_crawl_run.evidence_storage_key`.

O publicador operacional está em `output/jurisprudencia/shared/publish-batch.mjs`. Ele usa o adaptador injetável de armazenamento do aplicativo com operações reais de `wrangler r2 object put/get --remote`. Não usa o backend local como substituto do R2. Carrega a conexão PostgreSQL do arquivo privado existente, sem copiar credenciais para os artefatos.

Para republicar o mesmo lote, após conferir o manifesto e a ficha do tribunal, execute da raiz:

```powershell
pnpm --filter @k5/web exec node --conditions=react-server --import tsx ../../output/jurisprudencia/shared/publish-batch.mjs stf
pnpm --filter @k5/web exec node --conditions=react-server --import tsx ../../output/jurisprudencia/shared/publish-batch.mjs stj
pnpm --filter @k5/web exec node --conditions=react-server --import tsx ../../output/jurisprudencia/shared/publish-batch.mjs tst
```

Esses comandos publicam os manifestos existentes; não coletam a página seguinte nem substituem os futuros coletores recorrentes. A repetição usa as identidades e hashes do catálogo para evitar duplicação de julgados e versões. Para um lote posterior, preserve a partição correspondente e reconcilie o checkpoint, sem reaplicar o manifesto antigo sobre progresso mais recente.

Nenhum agendamento foi criado, e nenhum Worker foi publicado nesta execução.

## Validação

- `pnpm typecheck`: aprovado.
- `pnpm lint`: sem erros; um aviso preexistente sobre `_bytes` em `transport.ts`.
- `pnpm test`: 617 testes aprovados, nenhum reprovado ou ignorado.
- Migrador PostgreSQL: aplicação concluída e segunda verificação sem migrações pendentes.
- Publicação real: 12 julgados, 27 objetos R2 com hash conferido, sem versões prontas sem armazenamento e sem relações temáticas com instalação divergente.
- Sintaxe do publicador e links locais deste relatório conferidos.

Não foi necessário build, pois não houve alteração de rotas nem de código de produção compilado.
