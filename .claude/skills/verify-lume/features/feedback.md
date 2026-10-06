# Relatos e sugestões

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `feedback`.

## Sub-features

- `feedback-01`: Enviar feedback permite problema, ideia e dúvida com descrição.
- `feedback-02`: Captura anexada pode ser removida antes de enviar.
- `feedback-03`: Confirmação e Ver seus relatos mostram o registro após reabrir.
- `feedback-04`: Histórico e anexos não ficam acessíveis a outra pessoa sem autorização.

## How to get to it (user POV)

- `/app/command-center?feedback=relatos`
- `/app/feedback`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive feedback` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Enviar feedback e crie relato sintético identificável.
2. Anexe/remova captura, envie e abra Ver seus relatos após recarregar.
3. Verifique a triagem administrativa em etapa separada e ausência do relato em conta alheia.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- chat-feedback.e2e.ts cobre citações/ações do chat, não este módulo.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/feedback-dialog.tsx](../../../../apps/web/src/components/feedback-dialog.tsx), [apps/web/src/app/api/feedback/route.ts](../../../../apps/web/src/app/api/feedback/route.ts), [apps/web/src/lib/feedback-tickets.ts](../../../../apps/web/src/lib/feedback-tickets.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
