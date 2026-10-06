# Revisão humana de documentos

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `document-human-review`.

## Sub-features

- `document-human-review-01`: Confirmar um item com observação persiste na versão atual.
- `document-human-review-02`: Alterar decisão para Precisa de ajuste atualiza o resumo.
- `document-human-review-03`: Editar o documento cria versão e pede revisão novamente.
- `document-human-review-04`: Requisição sem sessão é negada; verificar também outra conta autenticada.

## How to get to it (user POV)

- `/app/documents/[id]`

## Driving it with e2e

Test: `apps/web/e2e/document-human-review.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [document-saving](./document-saving.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Revisão, escolha Confirmado, escreva observação e Salvar decisão.
2. Recarregue, altere a decisão e depois edite o texto em Editar.
3. Volte à Revisão e confira pendência na nova versão.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- E2e usa seed do documento; decisão e edição subsequentes passam por caminhos reais. Criação do artefato não é comprovada.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/document/human-checklist.tsx](../../../../apps/web/src/components/document/human-checklist.tsx), [apps/web/src/lib/document-human-review.ts](../../../../apps/web/src/lib/document-human-review.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
