# Conversas, anexos e voz

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `agent-chat`.

## Sub-features

- `agent-chat-01`: Nova conversa mantém histórico após recarregar e não aparece para outro usuário.
- `agent-chat-02`: Enviar uma pergunta produz resposta; interromper termina o fluxo e permite novo envio.
- `agent-chat-03`: Anexo enviado aparece na conversa; arquivo recusado apresenta erro sem perder o rascunho.
- `agent-chat-04`: Áudio só é oferecido com transcrição configurada; texto transcrito aparece antes do envio.
- `agent-chat-05`: Compositor e rascunho permanecem acessíveis em conversa longa a 390px.

## How to get to it (user POV)

- `/app/agents`
- `/app/agents?conversationId=[id]`
- `/app/agents?caseId=[id]`

## Driving it with e2e

Test: `apps/web/e2e/workspace.e2e.ts`
Test: `apps/web/e2e/cliproxyapi.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [legal-acceptance](./legal-acceptance.md). Dependências adicionais de cenários: `ai-provider`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Lume e aceite o aviso de IA; crie uma conversa com título identificável.
2. Envie texto, anexe um arquivo de teste e, com transcrição pronta, grave áudio curto.
3. Interrompa uma resposta, reabra pelo histórico e confira com segunda conta sem acesso.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- workspace simula o histórico; cliproxyapi tem chat real opt-in. Anexos, voz e interrupção precisam de evidências próprias.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/agent-chat.tsx](../../../../apps/web/src/components/agent-chat.tsx), [apps/web/src/app/app/(office)/[section]/page.tsx](../../../../apps/web/src/app/app/(office)/[section]/page.tsx), [apps/web/src/app/api/chat/transcribe/route.ts](../../../../apps/web/src/app/api/chat/transcribe/route.ts), [apps/web/src/app/api/chat/attachments/route.ts](../../../../apps/web/src/app/api/chat/attachments/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
