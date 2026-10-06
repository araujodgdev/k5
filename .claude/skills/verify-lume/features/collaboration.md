# Associados, convites e pastas

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `collaboration`.

## Sub-features

- `collaboration-01`: Convite só pode ser aceito pela conta destinatária; aceite cria associação.
- `collaboration-02`: Incluir associado nos participantes libera o caso conforme permissão.
- `collaboration-03`: Pastas públicas, privadas e restritas exibem apenas o conteúdo autorizado.
- `collaboration-04`: Alterar acesso e revogar participação remove acesso também pela API.
- `collaboration-05`: Erros permitem nova tentativa; teclado e 390px mantêm operações acessíveis.

## How to get to it (user POV)

- `/app/agenda?view=associates`
- `/app/agenda?view=invites`
- `/invite/[token]`
- `/app/vault/cases/[id]`

## Driving it with e2e

Test: `apps/web/e2e/collaboration.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [vault-cases](./vault-cases.md). Dependências adicionais de cenários: `disposable-account`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Crie duas contas descartáveis e convide uma pelo e-mail; aceite com a destinatária.
2. Inclua no caso e crie pastas de cada visibilidade com arquivos identificáveis.
3. Compare acesso das duas contas, altere permissões e revogue; confira links antigos.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- E2e existente percorre colaboração em desktop/mobile. Completar cenários negativos ausentes sem redefinir regressão como documentação.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/collaboration-panel.tsx](../../../../apps/web/src/components/collaboration-panel.tsx), [apps/web/src/lib/collaboration/access.ts](../../../../apps/web/src/lib/collaboration/access.ts), [apps/web/src/app/invite/[token]/page.tsx](../../../../apps/web/src/app/invite/[token]/page.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
