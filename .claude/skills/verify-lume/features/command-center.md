# Início e ações rápidas

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `command-center`.

## Sub-features

- `command-center-01`: Resumo apresenta tarefas e dados do usuário autenticado.
- `command-center-02`: Concluir tarefa no Início persiste e aparece nas outras visões.
- `command-center-03`: Nova atividade abre o formulário correto.
- `command-center-04`: Estados vazio, carregamento e erro mantêm ações recuperáveis.

## How to get to it (user POV)

- `/app/command-center`

## Driving it with e2e

Test: `apps/web/e2e/workspace.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [office-tasks](./office-tasks.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Crie tarefa com vencimento e abra Início.
2. Conclua pela caixa do resumo e confira na lista e após recarregar.
3. Use Nova atividade; confira estado vazio com conta separada e recuperação de erro controlado.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- workspace cobre o Início com dados simulados; completar pelo resumo precisa de leitura real de persistência.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/command-center.tsx](../../../../apps/web/src/components/command-center.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
