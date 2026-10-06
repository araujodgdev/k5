# Pesquisa de marcas

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `research-trademarks`.

## Sub-features

- `research-trademarks-01`: Pesquisa por nome, território e classe Nice apresenta resultados ou vazio explícito.
- `research-trademarks-02`: Pesquisa por logotipo valida arquivo e apresenta andamento/resultado sem perder a entrada.
- `research-trademarks-03`: Histórico pessoal reabre a mesma pesquisa e seus filtros.
- `research-trademarks-04`: Detalhes apresentam fonte, situação e classificação; outra conta não acessa pesquisa privada.

## How to get to it (user POV)

- `/app/research?mode=trademarks`
- `/app/research/trademarks/[id]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive research-trademarks` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `research-sources`, `document-worker`, `ai-provider`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Em Pesquisa → Marcas, pesquise nome único com filtro de classe/território.
2. Repita com logotipo sintético e acompanhe fila até estado terminal.
3. Reabra pelo Histórico e tente o ID com outra conta; registre fonte consultada e dependências ausentes.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/trademark-workspace.tsx](../../../../apps/web/src/components/trademark-workspace.tsx), [apps/web/src/lib/research/trademarks/service.ts](../../../../apps/web/src/lib/research/trademarks/service.ts), [apps/web/src/lib/research/trademarks/worker.ts](../../../../apps/web/src/lib/research/trademarks/worker.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
