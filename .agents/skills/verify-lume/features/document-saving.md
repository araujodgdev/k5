# Editor, salvamento e versões

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `document-saving`.

## Sub-features

- `document-saving-01`: Edição salva automaticamente e pode ser salva como nova versão explícita.
- `document-saving-02`: Alternar aba, fechar painel e navegar preservam alterações confirmadas.
- `document-saving-03`: Conflito ou falha preserva texto local e permite tentar novamente.
- `document-saving-04`: Restaurar versão exige salvar ou resolver alterações locais antes.
- `document-saving-05`: Logout continua possível com confirmação explícita para descartar alterações.
- `document-saving-06`: Painel móvel controla e devolve foco; voltar/avançar não perde rascunho com falha.

## How to get to it (user POV)

- `/app/documents/[id]`
- `/app/agents`

## Driving it with e2e

Test: `apps/web/e2e/document-saving.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [conversation-artifacts](./conversation-artifacts.md). Dependências adicionais de cenários: nenhuma. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra documento de teste em página inteira e no painel de conversa; edite e aguarde confirmação.
2. Salve versão, recarregue e restaure uma anterior, conferindo conteúdo e versão na API.
3. Exercite falha controlada e recuperação sem alterar dados reais; repita navegação/teclado em 390px.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- document-saving simula APIs de artefatos e alguns erros; não prova armazenamento real. Complementar salvamento/restauração sem mocks.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/document/document-workspace.tsx](../../../../apps/web/src/components/document/document-workspace.tsx), [apps/web/src/components/document/document-panel.tsx](../../../../apps/web/src/components/document/document-panel.tsx), [apps/web/src/app/api/artifacts/[id]/route.ts](../../../../apps/web/src/app/api/artifacts/[id]/route.ts), [apps/web/src/app/api/artifacts/[id]/restore/route.ts](../../../../apps/web/src/app/api/artifacts/[id]/restore/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
