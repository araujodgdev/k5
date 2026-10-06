# WhatsApp Business

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `whatsapp`.

## Sub-features

- `whatsapp-01`: Flag desligada esconde entrada e bloqueia a rota direta.
- `whatsapp-02`: Conectar/sincronizar atualiza caixa e histórico da conta de teste.
- `whatsapp-03`: Enviar texto/anexo respeita janela de resposta e limites do arquivo.
- `whatsapp-04`: Envio incerto permite Verificar este envio sem duplicar a mensagem.
- `whatsapp-05`: Webhook atualiza o histórico; desconexão interrompe operações.

## How to get to it (user POV)

- `/app/whatsapp`
- `/app/integrations`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive whatsapp` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `whatsapp-test`, `integration-worker`, `rollout`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Confirme primeiro o comportamento com flag desligada.
2. Em escritório piloto sintético autorizado, conecte conta de teste Zernio e sincronize.
3. Responda contato de teste dentro da janela, simule perda de resposta e confira idempotência e desconexão.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/whatsapp/inbox.tsx](../../../../apps/web/src/components/whatsapp/inbox.tsx), [apps/web/src/components/whatsapp/connection-panel.tsx](../../../../apps/web/src/components/whatsapp/connection-panel.tsx), [apps/web/src/lib/whatsapp/send.ts](../../../../apps/web/src/lib/whatsapp/send.ts), [apps/web/src/lib/whatsapp/worker.ts](../../../../apps/web/src/lib/whatsapp/worker.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
