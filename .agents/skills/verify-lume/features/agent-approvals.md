# Confirmações de ações do agente

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `agent-approvals`.

## Sub-features

- `agent-approvals-01`: Ação financeira fica pendente e não altera o saldo antes de Confirmar.
- `agent-approvals-02`: Confirmar executa uma vez e remove a ação disponível; repetir não duplica o efeito.
- `agent-approvals-03`: Cancelar preserva o estado anterior e mantém o registro cancelado.
- `agent-approvals-04`: Consulta à ajuda retorna fontes sem conceder acesso administrativo a Integrações.

## How to get to it (user POV)

- `/app/agents`

## Driving it with e2e

Test: `apps/web/e2e/agent-approvals.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [honorarios](./honorarios.md), [agent-chat](./agent-chat.md). Dependências adicionais de cenários: `ai-provider`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Proponha uma ação financeira na conversa de teste e confira o estado anterior.
2. Confirme uma proposta e cancele outra; recarregue chat e honorário.
3. Leia o recebimento e tente repetir a confirmação e acessar a proposta com outra conta.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- O e2e prepara mensagens/propostas; comprova confirmação da proposta existente, não a criação pelo modelo.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/lib/application/agent-approvals.ts](../../../../apps/web/src/lib/application/agent-approvals.ts), [apps/web/src/app/api/chat/approvals/[id]/route.ts](../../../../apps/web/src/app/api/chat/approvals/[id]/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
