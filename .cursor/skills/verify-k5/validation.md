# Comprovação da skill

Execução local em 27/09/2026, ID `20260927T231119-519253`. Revisão `b90cc9f8ee94ee229eca624279f4a0d82b9521ea`, com alterações locais preexistentes e trabalho concorrente no checkout. Esta é uma prova do estado local observado, não uma certificação do commit limpo.

## Resultado

O ciclo `up → doctor → drive office-tasks → down → status` terminou com sucesso. O PostgreSQL e o Next foram criados exclusivamente para a execução. O diagnóstico retornou seis verificações aprovadas. A posse da porta HTTP foi confirmada pelo processo Next descendente do supervisor; a porta do banco pertencia ao PostgreSQL iniciado por ele.

O driver comprovou login pela interface, criação de tarefa, persistência em PostgreSQL no escritório de verificação, permanência após recarregar, conclusão e presença em Arquivadas. Retornou sete verificações aprovadas, `passed: true` e `pageErrors: []`.

A inspeção visual mostrou que a captura móvel original ainda estava carregando. Uma execução adicional aguardou `aria-busy=false` e o botão habilitado, comprovou o estado vazio de Abertas depois da conclusão, a tarefa em Arquivadas e ausência de rolagem horizontal em 390px.

O teste adicional de teclado alcançou `Nova atividade` com Tab, abriu o diálogo com Enter e confirmou foco interno. Escape fechou o diálogo, mas a asserção de retorno do foco ao botão falhou após 30 segundos. Esse teste adicional terminou com código 1; não foi contado como aprovado. A trace e o script da tentativa foram preservados. A correção da aplicação não faz parte desta alteração de documentação.

## Evidências locais

Os arquivos estão em `apps/web/playwright-report/verify/20260927T231119-519253/`, ignorados pelo Git. Em outro clone, execute a skill para produzir evidências próprias.

| Arquivo ou pasta | Conteúdo |
| --- | --- |
| `doctor.json` | Diagnóstico saudável |
| `drive.json` | Resultados do driver de tarefas |
| `office-tasks/` | Cinco capturas, trace, checks e erros |
| `office-tasks-mobile/` | Tela pronta, tarefa arquivada, diálogo por teclado e trace da falha |
| `mobile-proof.mts` | Receita executável do teste complementar; execução pela raiz com `pnpm --dir apps/web exec tsx playwright-report/verify/20260927T231119-519253/mobile-proof.mts`, enquanto a instância estiver ativa |
| `instance.log` | Log preservado antes da remoção do ambiente |
| `processes.json`, `revision.txt`, `working-tree.txt` | Proveniência e processos observados |
| `cleanup.json` | PIDs encerrados e destinos removidos |

Depois de `down`, `status` retornou `instance: null`, as portas 63048 e 63049 não tinham listeners, e foi confirmada a existência das traces, capturas e log. A limpeza também foi executada após a falha complementar.

## Limites e checagens

Cadastro, logout global, clientes, casos, entradas alternativas de tarefas e reabertura não foram executados. Os quatro arquivos do mapa têm seletores conferidos no código; somente os caminhos descritos acima têm prova de execução.

Foram conferidos links locais, frontmatter, estrutura das quatro seções de cada receita e `git diff --check`. As alterações desta tarefa são arquivos Markdown. Não foram executados lint, typecheck, testes unitários ou build da aplicação. Os scripts compartilhados em `.claude` e as alterações preexistentes da aplicação foram preservados.
