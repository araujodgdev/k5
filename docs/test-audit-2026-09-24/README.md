# Auditoria e redução de testes — 24/09/2026

A meta inicial era remover 20% dos casos (89 de 441). Após a leitura dos 55 arquivos, a auditoria encontrou 21 remoções justificáveis. O usuário decidiu explicitamente preservar as regras de retenção e remover somente esses casos: redução de **4,76%**, sem reunir cenários independentes para diminuir artificialmente a contagem.

## Escopo e baseline

- Base: `main` em `5e6ab96da61fd85e1d5c617c91702a8854707761`, mais a correção Google preexistente no checkout. Essa correção e seus dois testes foram preservados e excluídos das métricas de alterações desta campanha.
- 55 arquivos Node, 435 declarações e 441 casos executados; a diferença vem de tabelas/loops existentes. Todos os 441 passaram, sem falhas prévias ou skips.
- Cada declaração recebeu R (reter), F (reparar), C (consolidar) ou D (excluir). Os registros por responsável contêm localização, contrato, chamadores, histórico, keeper e plano anterior à edição.
- Nenhum arquivo de teste inteiro, cenário de QA, configuração de CI ou fixture foi retirado. A descoberta automática de `tests/*.test.ts` continua igual.

## Responsáveis e resultados

| Área | Declarações auditadas | Casos retirados | Prova que permanece |
|---|---:|---:|---|
| Identidade e integrações | 138 | 4 | Rotação transacional e rota autenticada; Gmail/Drive com rede simulada; resposta real de validação do Cofre |
| Documentos, chat e capabilities | 117 | 6 | DOCX/PDF gerados, cronologia composta, requisição de citações, histórico e idempotência com isolamento |
| Pesquisa e runtime | 180 | 11 | Resultado DJEN, pipelines persistidos, datas, atualização PWA, catálogo de ferramentas e worker real |

Os oito helpers sem chamadores de produção foram removidos: rotação antiga de IA, rotação/contagem Google antigas, `isWorkerSafe`, `toCaseIdentity`, `cnjRoutingHint`, `sourceDay` e `movementFingerprint`. Seis helpers documentais e dois tipos intermediários deixaram de ser exportados; seu comportamento de produção continua igual. O contador usado pelo setup permanece.

Foram mantidos testes que poderiam parecer candidatos por serem estáticos ou lentos, mas protegem contratos independentes: autenticação e isolamento, CSRF, migrações, configuração/defaults, protocolo criptográfico, parser/checksum CNJ, privacidade PWA, prompts e transportes. Os três testes com verificações fracas foram reparados: disputa real de lease de indexação, alertas históricos não vazios e continuação/replay obrigatório de pesquisa.

## Revisão de preservação

Os três revisores trocaram de área após a edição. A revisão encontrou seis garantias que exigiam reforço nos keepers:

1. Conteúdo original de cada uma das 11 colunas criptografadas, com valores distintos e leitura somente pela chave nova.
2. Total positivo informado pelo DJEN, além da contagem de itens.
3. Itálico no trecho correto, independentemente do estilo da citação em bloco.
4. Todos os itens e marcadores das listas, na ordem correta.
5. Os dois textos do cabeçalho de tabela, mesmo quando o exportador completa células vazias.
6. Negrito no trecho do parágrafo, independentemente do negrito em itens de lista.

Todas foram restauradas nas declarações existentes. Cada uma recebeu uma mutação deliberada do proprietário de produção; também foi testada a retirada da proteção de lease. Cada controle precisa falhar na asserção correspondente, seguido de restauração byte a byte e execução verde. O primeiro controle de lease usou um parâmetro SQL sem tipo e foi descartado como prova; o controle válido usa cast explícito e demonstra a sobrescrita indevida do estado.

| Controle válido | Mutação temporária | Falha observada |
|---|---|---|
| Credencial | Gravar outro texto na coluna TypeSafe de plataforma durante a rotação | Texto descriptografado diferente do original |
| DJEN | Forçar `coverage.totalReported = 0` | `0 !== 3` |
| Itálico | Remover `italic: true` do token `em` | Run `itálico` sem `w:i` |
| Lista | Processar somente `list.items.slice(0, 1)` | Faltam `segundo` e `4.quarto` |
| Tabela | Processar somente `table.header.slice(0, 1)` | Segundo cabeçalho vazio, em vez de `Vencimento` |
| Negrito | Limpar `bold` dos runs de parágrafo na saída DOCX | Run `negrito` sem `w:b`, embora a lista continue em negrito |
| Lease | Trocar o predicado de proprietário por `?::text IS NOT NULL` | Worker antigo muda `running` para `queued` e apaga o proprietário novo |

## Validação e contagens

| Medida | Antes | Depois | Diferença |
|---|---:|---:|---:|
| Declarações de teste | 435 | 414 | −21 |
| Linhas dos arquivos `*.test.ts` | 10.073 | 9.929 | −144 |
| Linhas de suporte e fixtures textuais | 352 | 352 | 0 |
| Linhas de produção alteradas pela campanha | — | — | −102 líquidas |

Linhas físicas, incluindo comentários e linhas vazias; o PDF binário de fixture permanece byte a byte. O novo `tests/AGENTS.md` é documentação e não entra como suporte executável. A movimentação do caso de lease entre dois arquivos não conta como remoção. A simplificação de produção exclui a correção Google anterior (+2 linhas líquidas). Nenhum limite de linhas, exclusão de cobertura ou lista de execução foi alterado.

Resultado final: **420 casos aprovados, zero falhas, cancelamentos ou skips**. O escopo de cobertura continua com os mesmos **444 arquivos** de `apps/web/src`, incluindo arquivos não executados e excluindo apenas declarações `.d.ts`.

| Cobertura V8/c8 | Antes | Depois | Variação em pontos percentuais |
|---|---:|---:|---:|
| Linhas / statements | 39,69% (15.496/39.033) | 39,96% (15.557/38.931) | +0,2607 |
| Funções | 61,98% (2.544/4.104) | 62,05% (2.558/4.122) | +0,0689 |
| Branches | 74,41% (6.722/9.033) | 74,35% (6.855/9.219) | −0,0587 |

As três medidas consolidadas ficam dentro do limite de 2 pontos percentuais e também da interpretação mais restrita de queda relativa de 2%. A comparação por arquivo, incluindo todas as perdas locais, está preservada no JSON de cobertura; o limite aqui é aplicado ao conjunto da aplicação, não a cada arquivo individual. Os percentuais não substituem a revisão de contratos e os controles de mutação.

Verificações concluídas:

- Baseline: `pnpm test` e execução completa com c8, 441/441 aprovados.
- Foco após restaurações iniciais: `pnpm --filter @k5/web test tests/credential-rotation.test.ts tests/judicial-connector.test.ts tests/documents.test.ts tests/vectorize-contract.test.ts`, 38/38 aprovados.
- Sete mutações: cada teste falhou pela asserção pretendida; fontes restauradas byte a byte. A execução completa final confirmou todos novamente verdes, incluindo o reforço final do negrito.
- Execução completa final pelo mesmo runner do workspace com c8: 420/420 aprovados.
- `pnpm lint`, lint específico após o último reforço documental, `pnpm typecheck`, `pnpm build` e `git diff --check`: aprovados. Lint com um aviso preexistente; build encerrou com código zero e um aviso do Turbo sobre o comprimento de um link do cache no Windows.
- Os 13 arquivos de suporte/fixtures permanecem byte a byte iguais. Nenhum teste foi ignorado ou excluído da execução.

O runner deste repositório é Node/tsx com PostgreSQL isolado. Os utilitários OpenClaw/Vitest/Crabbox mencionados no documento fornecido não existem neste workspace. A skill `$autoreview` também não está disponível; a revisão final foi feita por agentes independentes, com resolução dos achados. Foram usados o runner real do projeto, lint, typecheck, build e c8/V8; nenhuma mudança de dependência ou lockfile foi necessária.

Comando de cobertura, executado na raiz (trocar `final-v8` por `baseline-v8` para a base):

```powershell
pnpm dlx c8@12.0.0 --all --src=apps/web/src --include=apps/web/src/** --exclude=**/*.d.ts --reporter=json --reporter=json-summary --reporter=text-summary --reports-dir=apps/web/.data/test-pruning/final-v8 pnpm --filter @k5/web test
```

O wrapper direto do workspace é necessário porque o ambiente restrito do Turbo não propagou a variável de cobertura no ensaio inicial. Esse ensaio sem dados foi descartado; baseline e resultado final usam o mesmo comando acima.

Durante a validação no checkout compartilhado, outra atividade alterou as dependências do Mastra, o lockfile e a configuração do workspace. Essas alterações foram preservadas e não pertencem à campanha. Para a comparação definitiva, a suíte foi repetida em um worktree isolado do SHA acima, com o lockfile original (`pnpm install --offline --frozen-lockfile`), Mastra core 1.67.0 / ai-sdk 1.10.3 e somente os arquivos desta campanha mais a correção Google anterior. Os prefixos absolutos dos caminhos no relatório c8 são normalizados para comparar os mesmos arquivos; contadores e percentuais não são alterados.

## Evidências e entrega

- [Identidade e integrações](identity-ledger.md)
- [Documentos e chat](documents-ledger.md)
- [Pesquisa e runtime](research-runtime-ledger.md)
- [Inventário e resultado por arquivo](baseline-files.json)
- [Reconciliação de declarações e linhas](reconciliation.json)
- [Comparação de cobertura](coverage-comparison.json)
- [Controles de mutação](mutations.json)
- [Ambiente isolado e hashes das dependências](validation-environment.json)
- Regras duráveis: [propriedade dos testes](../../apps/web/tests/AGENTS.md).

A campanha não inclui commit, push, PR ou deploy. Nenhum defeito de produto foi identificado no baseline. A advertência de lint preexistente em `judicial/connectors/transport.ts` (`_bytes`) fica fora do escopo.
