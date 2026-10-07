# Validação final do Lume — 7 de outubro de 2026

Implementação local na branch `feat/lume-agent-canvas`. Sem commit, PR ou publicação. A instância de verificação `20261006T234247-d88728` foi encerrada; os arquivos de evidência foram preservados.

## Resultado entregue

Conversa privada persistente, canvas com abas e contexto por pedido; casos com páginas, arquivos, tarefas, honorários, atividade e compartilhamento; editor com publicação explícita; permissões de fontes e controle do Lume aplicados no servidor. A composição do Início e do caso foi conferida em desktop e celular de 390 px, com temas claro/escuro e teclado.

A última correção de produto removeu a reinicialização atrasada da seção do caso. Ela podia desfazer um clique imediato em Páginas. A seção agora acompanha mudanças reais dos parâmetros de navegação sem sobrescrever a escolha inicial da pessoa. O mesmo teste que falhou duas vezes passou após a correção; a composição e o fluxo de tarefas do caso também passaram novamente.

## Checks

Todos os caminhos abaixo são relativos a `apps/web/.e2e/verify/20261006T234247-d88728/`.

| Check | Resultado | Evidência |
| --- | --- | --- |
| Build após a última correção | Passou, 2m10,806s | `round3-root-build-1791390738065/output.log` |
| Lint após encerrar a instância | Passou, 1m32,171s; somente aviso preexistente de `_bytes` em `judicial/connectors/transport.ts:416` | `final-cleanup-typecheck-1791390879067/output.log` |
| Tipos após encerrar a instância | Passou, 53,856s | `final-cleanup-typecheck-1791390879067/output.log` |
| Testes PostgreSQL pela raiz | Rodada ampla: 973 reportados, 962 passaram e 11 falharam; todos os arquivos com falha têm reexecução aprovada após as correções abaixo | `round3-root-test-1791386995315/output.log` |
| Sete arquivos com falhas | 54 testes: 52 passaram; os dois restantes passaram na reexecução seguinte de 12 testes | `round3-root-test-1791388160881/output.log`, `round3-root-test-1791388339334/output.log` |
| Navegador, 23 arquivos afetados e autenticação | 72 selecionados/executados: 62 passaram e 10 falharam; os dez têm execução aprovada nas rodadas seguintes | `source-e2e-1791388516850/report.json` |
| Dez cenários com falhas e autenticação | 11 executados: 9 passaram; ficaram geração de anexos e clique em Páginas | `source-e2e-1791390072626/report.json` |
| Anexos, Páginas, composição, tarefas do caso e autenticação após a correção | 5/5 passaram | `source-e2e-1791390482685/report.json` |
| Whitespace | `git diff --check` passou; somente avisos de conversão LF/CRLF | `.audit/lume-final-whitespace-stderr.log` no repositório |

As rodadas se sobrepõem: seus totais não devem ser somados como testes distintos. A suíte inteira não foi repetida após cada reparo. Nos relatórios e2e, `skipped` inclui testes descobertos e excluídos pelo filtro; os selecionados foram todos executados. As três rodadas finais de navegador registraram zero chamadas de modelo.

## Correções da validação

- O bloqueio de tráfego dos testes precisava admitir URLs `data:` e o servidor HTTP local sintético do Honcho. O sexto teste Honcho ficou esperando uma requisição bloqueada e seu processo foi interrompido na primeira rodada; todos os seis passaram depois. O total 973 da rodada ampla não inclui esse cenário inacabado.
- Os dados de entrada do catálogo precisavam incluir os novos contratos de tarefas do caso. Dois testes de fontes ainda esperavam repetição após revogação ou criavam execução sem prazo de posse válido; foram atualizados mantendo as verificações de proteção e ausência de gravação.
- As primeiras compilações locais de algumas rotas levaram 11–18 segundos, acima da espera padrão de 10 segundos. As esperas afetadas foram ampliadas para 60 segundos, preservando as mesmas verificações de conteúdo, acesso e persistência.
- Uploads de colaboração e foto de perfil agora selecionam o campo no canvas. O seletor global antigo encontrava o anexo do chat persistente.
- Um lint direcionado foi interrompido por pressão de memória. Ele não conta como aprovação; o lint final é executado em série após a limpeza da instância.

## Limites

Qualidade de respostas de modelos reais, envios externos e processamento por workers não foram verificados nesta rodada. O Início mostra atividade dos casos recentes; a consulta de tarefas percorre os casos acessíveis e não recebeu teste de carga. Migrações foram aplicadas somente no banco descartável de verificação. O ambiente de desenvolvimento não foi migrado por esta validação.

Capturas e vídeo da composição estão em `native-visual-final/` dentro da raiz de evidência. O histórico detalhado das decisões e tentativas está em `lume-provenance-round3-parent.md` nesta pasta.
