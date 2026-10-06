# Referências, avaliações e minutas

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `research-casework`.

## Sub-features

- `research-casework-01`: Vincular julgado ao caso mantém finalidade e anotação após recarregar.
- `research-casework-02`: Avaliação apresenta estado da versão atual e não reutiliza avaliação obsoleta.
- `research-casework-03`: Nova versão do material pode ser avaliada/atualizada com decisão explícita.
- `research-casework-04`: Gerar minuta a partir das referências apresenta progresso e documento vinculado.
- `research-casework-05`: Remover referência do caso preserva histórico de versões já usadas.

## How to get to it (user POV)

- `/app/vault/cases/[id]`
- `/app/research/drafts/[id]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive research-casework` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [vault-cases](./vault-cases.md), [research-jurisprudence](./research-jurisprudence.md). Dependências adicionais de cenários: `document-worker`, `ai-provider`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Vincule julgado ao caso de teste, edite anotação e recarregue Referências.
2. Com modelo/worker configurados, solicite avaliação e minuta.
3. Atualize material ou use fixture versionada; confira obsolescência e histórico antes de remover vínculo.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/research-case-references.tsx](../../../../apps/web/src/components/research-case-references.tsx), [apps/web/src/components/research-draft-starter.tsx](../../../../apps/web/src/components/research-draft-starter.tsx), [apps/web/src/lib/research/case-assessment.ts](../../../../apps/web/src/lib/research/case-assessment.ts), [apps/web/src/app/app/(office)/research/drafts/[id]/page.tsx](../../../../apps/web/src/app/app/(office)/research/drafts/[id]/page.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
