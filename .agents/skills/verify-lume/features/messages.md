# Mensagens e compartilhamentos

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `messages`.

## Sub-features

- `messages-01`: Nova conversa com pessoa do Lume persiste mensagem e leitura entre as duas contas.
- `messages-02`: Compartilhar documento entrega a versão escolhida com download autorizado.
- `messages-03`: Remover acesso revoga links antigos sem apagar o histórico da conversa.
- `messages-04`: Destinatário externo recebe e-mail e reivindica endereço pela conta correta.
- `messages-05`: Paginação e recuperação de envio incerto não duplicam mensagens.

## How to get to it (user POV)

- `/app/messages`
- `/messages/claim/[token]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive messages` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md), [vault-library](./vault-library.md). Dependências adicionais de cenários: `email-test`, `integration-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Use duas contas de teste, abra Nova conversa e envie mensagem identificável.
2. Compartilhe documento, baixe pela destinatária, revogue e repita o link.
3. Em etapa externa separada, use e-mail de teste e valide reivindicação e entrega; respostas por e-mail não são importadas.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/messaging/inbox.tsx](../../../../apps/web/src/components/messaging/inbox.tsx), [apps/web/src/components/messaging/conversation.tsx](../../../../apps/web/src/components/messaging/conversation.tsx), [apps/web/src/components/messaging/address-claim.tsx](../../../../apps/web/src/components/messaging/address-claim.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
