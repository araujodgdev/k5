# Exportação PDF e DOCX

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `document-pdf`.

## Sub-features

- `document-pdf-01`: Exportar PDF baixa arquivo cujo texto corresponde à versão salva.
- `document-pdf-02`: Versão antiga solicitada explicitamente é recusada conforme contrato.
- `document-pdf-03`: Exportação sem sessão é recusada.
- `document-pdf-04`: Falha no conversor mostra erro recuperável sem corromper o texto.
- `document-pdf-05`: Exportar DOCX entrega arquivo legível e coerente com a versão.

## How to get to it (user POV)

- `/app/documents/[id]`

## Driving it with e2e

Test: `apps/web/e2e/document-pdf.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [document-saving](./document-saving.md). Dependências adicionais de cenários: `soffice`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Edite e salve um documento descartável; abra Exportar documento.
2. Baixe PDF e DOCX; extraia texto dos arquivos e compare à versão salva.
3. Teste versão antiga e ausência de sessão; exercite erro do conversor separadamente.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- PDF tem e2e com conversão real e erro simulado. A presença do botão DOCX não prova os bytes do DOCX.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/lib/document-export.ts](../../../../apps/web/src/lib/document-export.ts), [apps/web/src/lib/document-pdf.ts](../../../../apps/web/src/lib/document-pdf.ts), [apps/web/src/app/api/artifacts/[id]/export/route.ts](../../../../apps/web/src/app/api/artifacts/[id]/export/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
