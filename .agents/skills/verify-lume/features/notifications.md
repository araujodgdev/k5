# Notificações, lembretes e push

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `notifications`.

## Sub-features

- `notifications-01`: Sino/painel apresenta contagem, leitura, abrir destino e arquivamento coerentes.
- `notifications-02`: Marcar todas como lidas persiste sem afetar outra conta.
- `notifications-03`: Preferências de categorias, fuso e silêncio persistem. **Lacuna de entrada:** Componente NotificationSettings sem montagem localizada.
- `notifications-04`: Dispositivo pode ativar, testar e revogar push conforme suporte/permissão. **Lacuna de entrada:** Ativação por interface sem montagem localizada; exige também suporte e VAPID.
- `notifications-05`: Lembrete de atividade/cobrança chega no horário permitido e não após revogação.

## How to get to it (user POV)

- `/app/notifications`
- `/app/command-center?notificacoes=1`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive notifications` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `notification-worker`, `web-push`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Gere evento sintético por ação real e deixe o worker projetar a caixa; abra pelo sino.
2. Marque leitura e arquive, recarregue e confira isolamento.
3. Procure entrada real para preferências/push. Sem montagem, registre lacuna de produto/entrada bloqueada; testar API isolada não comprova o caminho de UI.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Painel do sino está ligado à navegação. NotificationSettings possui implementação, mas não foi encontrado import/montagem em src; preferências/ativação push têm lacuna de entrada UI. Não tratá-las como acessíveis no Perfil.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/notification-panel.tsx](../../../../apps/web/src/components/notification-panel.tsx), [apps/web/src/components/notification-settings.tsx](../../../../apps/web/src/components/notification-settings.tsx), [apps/web/src/lib/notifications/worker.ts](../../../../apps/web/src/lib/notifications/worker.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
