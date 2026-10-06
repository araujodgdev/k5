# Pesquisa e leitura de julgados

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `research-jurisprudence`.

## Sub-features

- `research-jurisprudence-01`: Pesquisar tema e tribunal cria pesquisa recuperável no histórico pessoal.
- `research-jurisprudence-02`: Consulta ao acervo e a fontes oficiais distingue resultados vazios, pendentes e falha de fonte.
- `research-jurisprudence-03`: Carregar mais resultados não repete nem perde itens.
- `research-jurisprudence-04`: Leitor apresenta ementa/inteiro teor e original quando disponível, com fonte oficial.

## How to get to it (user POV)

- `/app/research?mode=jurisprudence`
- `/app/research/judgments/[id]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive research-jurisprudence` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `research-sources`, `document-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Jurisprudência e consulte tema com tribunal conhecido no acervo de teste.
2. Ative fontes oficiais em cenário separado e registre a fonte habilitada.
3. Abra julgado, inspecione original, navegue a próxima página e reabra a pesquisa pelo histórico.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/jurisprudence-workspace.tsx](../../../../apps/web/src/components/jurisprudence-workspace.tsx), [apps/web/src/components/research-reader.tsx](../../../../apps/web/src/components/research-reader.tsx), [apps/web/src/lib/research/runtime.ts](../../../../apps/web/src/lib/research/runtime.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
