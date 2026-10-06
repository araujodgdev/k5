# Gmail, rascunhos e anexos

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `google-mail`.

## Sub-features

- `google-mail-01`: Caixa e conversa exibem mensagens e paginação da conta conectada.
- `google-mail-02`: Escrever/salvar/reabrir/excluir rascunho preserva destinatários, assunto e conteúdo.
- `google-mail-03`: Anexar do Cofre e importar anexo respeitam permissões e limites.
- `google-mail-04`: Enviar para destinatário de teste produz entrega única e confirmação.
- `google-mail-05`: Triagem/insights distinguem resultado, pendência e indisponibilidade.

## How to get to it (user POV)

- `/app/email`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive google-mail` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [google-integration](./google-integration.md). Dependências adicionais de cenários: `google-test`, `integration-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra E-mails com caixa de teste e leia uma conversa.
2. Em Escrever, salve rascunho com anexo do Cofre, reabra e confira conteúdo.
3. Envie somente a conta de teste autorizada e confirme no destino; se indisponível registre bloqueio da entrega.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/google/gmail-panel.tsx](../../../../apps/web/src/components/google/gmail-panel.tsx), [apps/web/src/components/google/email-smart.tsx](../../../../apps/web/src/components/google/email-smart.tsx), [apps/web/src/lib/google/gmail/service.ts](../../../../apps/web/src/lib/google/gmail/service.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
