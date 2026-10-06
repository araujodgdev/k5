# Agenda interna e reuniões

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `office-calendar`.

## Sub-features

- `office-calendar-01`: Criar reunião com data e horário faz a atividade aparecer no dia correto.
- `office-calendar-02`: Trocar mês, pesquisar e filtrar por cliente/caso preserva os critérios.
- `office-calendar-03`: Editar, cancelar e reabrir atividades respeita o tipo e estado.
- `office-calendar-04`: Abrir ligação da ficha de cliente aplica o filtro correspondente.

## How to get to it (user POV)

- `/app/agenda?view=calendar`

## Driving it with e2e

Test: `apps/web/e2e/workspace.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Em Escritório → Agenda, crie reunião vinculada a cliente/caso de teste.
2. Navegue entre meses, filtre pelo cliente e edite a reunião.
3. Recarregue e compare datas/estado com a leitura autenticada.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- workspace usa APIs simuladas no calendário. Não confundir agenda interna com sincronização Google.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/agenda-workspace.tsx](../../../../apps/web/src/components/agenda-workspace.tsx), [apps/web/src/lib/capabilities/agenda.ts](../../../../apps/web/src/lib/capabilities/agenda.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
