# Citações e confirmações no chat

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `chat-feedback`.

## Sub-features

- `chat-feedback-01`: Citação abre a fonte correta após reabrir a conversa.
- `chat-feedback-02`: Duas confirmações na mesma resposta mantêm estados independentes.
- `chat-feedback-03`: Confirmar uma ação e cancelar outra não apaga nem troca seus estados.
- `chat-feedback-04`: Fonte e ações permanecem acessíveis em 390px.

## How to get to it (user POV)

- `/app/agents`

## Driving it with e2e

Test: `apps/web/e2e/chat-feedback.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [agent-chat](./agent-chat.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra conversa que contenha citação e duas propostas distintas.
2. Confirme uma, cancele a outra, saia e reabra pelo histórico.
3. Confira destino da fonte e estados persistidos usando o fluxo real.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Apesar do nome do arquivo, este teste cobre citações/confirmações com APIs simuladas; não cobre o formulário Enviar feedback.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/agent-chat.tsx](../../../../apps/web/src/components/agent-chat.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
