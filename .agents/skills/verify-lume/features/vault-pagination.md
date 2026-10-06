# Paginação e seletores do Cofre

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `vault-pagination`.

## Sub-features

- `vault-pagination-01`: Arquivos além da primeira página permanecem alcançáveis.
- `vault-pagination-02`: Falha ao carregar página mantém dados atuais e permite nova tentativa.
- `vault-pagination-03`: Remover o último item recalcula a página sem perder acesso aos demais.
- `vault-pagination-04`: Seletores de anexos, e-mail e Drive alcançam arquivos antigos.
- `vault-pagination-05`: Layout móvel não cria rolagem horizontal da página.

## How to get to it (user POV)

- `/app/vault/library`
- `/app/vault/cases/[id]`
- `/app/email`

## Driving it with e2e

Test: `apps/web/e2e/vault-pagination.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [vault-library](./vault-library.md). Dependências adicionais de cenários: `google-test`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Prepare biblioteca de teste com mais de uma página pelo fluxo de upload.
2. Percorra páginas e seletores, selecione arquivo antigo e confira o ID real.
3. Exercite falha transitória e recuperação e repita em 390px.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Os testes existentes simulam documentos, aprovações e Google. Paginação real, autorização e exclusão precisam de complemento.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/vault-library.tsx](../../../../apps/web/src/components/vault-library.tsx), [apps/web/src/components/google/gmail-panel.tsx](../../../../apps/web/src/components/google/gmail-panel.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
