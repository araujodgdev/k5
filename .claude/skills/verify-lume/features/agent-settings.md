# Personalizar Lume

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `agent-settings`.

## Sub-features

- `agent-settings-01`: Criar, editar e remover regra persiste após recarregar.
- `agent-settings-02`: Referências do Cofre aparecem sem duplicar itens legados e respeitam o modo de leitura escolhido.
- `agent-settings-03`: Adicionar e remover modelo DOCX altera a seleção persistida.
- `agent-settings-04`: A lista e os formulários funcionam por teclado e em 390px.

## How to get to it (user POV)

- Meu perfil -> Personalizar Lume (`/app/profile/lume`). `/app/agents/settings` redirects here.

## Driving it with e2e

Test: `apps/web/e2e/agent-settings.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md), [vault-library](./vault-library.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Personalizar Lume e use Nova regra; salve e reabra a página.
2. Adicione referência e modelo do Cofre, altere o modo de leitura e remova ambos.
3. Recarregue e confirme o estado com leitura das APIs da própria sessão.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- O e2e prepara referências e modelo por API, e prova edição/remoção. Adição pela interface e efeito sobre geração real exigem complemento.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/agent-settings.tsx](../../../../apps/web/src/components/agent-settings.tsx), [apps/web/src/components/agent-rules.tsx](../../../../apps/web/src/components/agent-rules.tsx), [apps/web/src/components/agent-knowledge.tsx](../../../../apps/web/src/components/agent-knowledge.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
