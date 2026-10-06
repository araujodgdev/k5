# Google Drive e Docs

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `google-drive-docs`.

## Sub-features

- `google-drive-docs-01`: Picker mostra arquivos acessíveis e respeita cancelamento/escopo.
- `google-drive-docs-02`: Importar arquivo para Cofre preserva nome, conteúdo e destino.
- `google-drive-docs-03`: Enviar versão a documento existente mantém histórico e autorização.
- `google-drive-docs-04`: Operações Docs disponíveis pelas ferramentas aprovadas preservam formato e destino.

## How to get to it (user POV)

- `/app/integrations`
- `/app/vault/library?import=drive`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive google-drive-docs` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [google-integration](./google-integration.md), [vault-library](./vault-library.md). Dependências adicionais de cenários: `google-test`, `integration-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Importar do Google Drive e selecione arquivo sintético da conta de teste.
2. Importe para Biblioteca e depois envie versão a documento existente.
3. Confira bytes e versão no Cofre e execute operação Docs documentada pelo catálogo de capacidades, registrando aprovação e resultado.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- vault-pagination simula o Picker; não é prova de OAuth, importação ou Docs real. Ler capacidades disponíveis antes de executar uma operação.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/google/drive-panel.tsx](../../../../apps/web/src/components/google/drive-panel.tsx), [apps/web/src/components/google/drive-picker.tsx](../../../../apps/web/src/components/google/drive-picker.tsx), [apps/web/src/lib/google/drive/import.ts](../../../../apps/web/src/lib/google/drive/import.ts), [apps/web/src/lib/google/drive/docs.ts](../../../../apps/web/src/lib/google/drive/docs.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
