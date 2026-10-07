# Separação de anexos de PDF

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `vault-annexes`.

## Sub-features

- `vault-annexes-01`: PDF e petição válidos permitem propor a divisão de anexos.
- `vault-annexes-02`: Revisar nomes, páginas, inclusão e ordem altera o plano antes de gerar.
- `vault-annexes-03`: Intervalos inválidos impedem geração com erro claro.
- `vault-annexes-04`: Gerar cria pasta/documentos cujos PDFs correspondem às páginas escolhidas.

## How to get to it (user POV)

- `/app/vault/cases/[id]?section=annexes`

## Driving it with e2e

Test: `apps/web/e2e/annex-plan.e2e.ts`

O teste prepara o plano pelo serviço real com stub apenas no provedor externo. A interface reabre o vínculo autorizado, revisa nomes e gera PDFs pelo endpoint real em desktop e 390px. Uma versão posterior do scan recusa o plano antigo.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [vault-cases](./vault-cases.md), [vault-upload](./vault-upload.md). Dependências adicionais de cenários: `ai-provider`, `document-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. No caso, abra Anexos e selecione PDF digitalizado e petição de teste.
2. Use Propor anexos; revise nomes, intervalos, inclusão e ordem.
3. Gere, abra a pasta e compare PDFs baixados ao original página por página.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- vault-pagination testa seletor com respostas simuladas, não a divisão de PDF.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/vault-annexes.tsx](../../../../apps/web/src/components/vault-annexes.tsx), [apps/web/src/app/api/vault/cases/[id]/annexes/route.ts](../../../../apps/web/src/app/api/vault/cases/[id]/annexes/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
