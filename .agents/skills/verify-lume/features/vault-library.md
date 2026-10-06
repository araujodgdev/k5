# Biblioteca, documentos e versões

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `vault-library`.

## Sub-features

- `vault-library-01`: Upload na Biblioteca aparece com nome e escopo corretos.
- `vault-library-02`: Enviar nova versão mantém histórico e download coerente.
- `vault-library-03`: Renomear, mover/vincular e excluir seguem confirmações disponíveis e permissões.
- `vault-library-04`: Arquivo em processamento ou erro exibe estado; tentar novamente permite acompanhar a recuperação.
- `vault-library-05`: Pesquisa/seleção não revela arquivos de outro escritório sem compartilhamento.

## How to get to it (user POV)

- `/app/vault/library`
- `/app/vault/cases/[id]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive vault-library` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `document-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Envie arquivo pequeno na Biblioteca; aguarde estado compatível com o ambiente.
2. Abra opções do documento, envie nova versão e confira download/histórico.
3. Exercite ações disponíveis com conta proprietária e conta sem acesso; mantenha os IDs na evidência.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- vault-upload cobre APIs e vault-pagination cobre UI simulada; falta receita e2e completa da biblioteca com dados reais.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/vault-library.tsx](../../../../apps/web/src/components/vault-library.tsx), [apps/web/src/components/vault-document-options.tsx](../../../../apps/web/src/components/vault-document-options.tsx), [apps/web/src/app/api/vault/documents/[id]/versions/route.ts](../../../../apps/web/src/app/api/vault/documents/[id]/versions/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
