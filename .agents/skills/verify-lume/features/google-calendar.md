# Agenda pessoal Google

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `google-calendar`.

## Sub-features

- `google-calendar-01`: Visão pessoal apresenta eventos sincronizados no fuso correto.
- `google-calendar-02`: Criar/editar evento e responder convite refletem o estado autorizado no Google.
- `google-calendar-03`: Falha de sincronização não confunde reunião interna com evento pessoal.
- `google-calendar-04`: Desconexão impede novas operações e sinaliza a necessidade de reconectar.

## How to get to it (user POV)

- `/app/agenda?view=calendar`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive google-calendar` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [office-calendar](./office-calendar.md), [google-integration](./google-integration.md). Dependências adicionais de cenários: `google-test`, `integration-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Na Agenda, alterne para a visão pessoal com escopo Calendar autorizado.
2. Crie evento em calendário de teste, altere horário e confira do lado Google.
3. Execute a sincronização configurada e observe retorno, erro e desconexão.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/google/calendar-panel.tsx](../../../../apps/web/src/components/google/calendar-panel.tsx), [apps/web/src/lib/google/calendar/service.ts](../../../../apps/web/src/lib/google/calendar/service.ts), [apps/web/src/lib/google/calendar/sync.ts](../../../../apps/web/src/lib/google/calendar/sync.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
