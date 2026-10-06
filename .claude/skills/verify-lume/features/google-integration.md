# Conexão Google e permissões

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `google-integration`.

## Sub-features

- `google-integration-01`: Conectar Google solicita os módulos/escopos escolhidos e retorna à conta correta.
- `google-integration-02`: Estado de conexão e permissões persiste após recarregar.
- `google-integration-03`: Recusa ou expiração de autorização apresenta recuperação compreensível.
- `google-integration-04`: Desconectar invalida o acesso local sem afetar outra pessoa/escritório.

## How to get to it (user POV)

- `/app/integrations`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive google-integration` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `google-test`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Em Integrações, conecte uma conta Google de teste pelo consentimento real.
2. Confira Gmail, Agenda, Drive e Docs conforme escopos autorizados.
3. Recarregue, remova a conexão e tente uma operação anteriormente disponível.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/google/integrations-panel.tsx](../../../../apps/web/src/components/google/integrations-panel.tsx), [apps/web/src/lib/google/config.ts](../../../../apps/web/src/lib/google/config.ts), [apps/web/src/app/api/integrations/google/callback/route.ts](../../../../apps/web/src/app/api/integrations/google/callback/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
