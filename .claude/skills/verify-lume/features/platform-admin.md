# Administração da plataforma

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `platform-admin`.

## Sub-features

- `platform-admin-01`: Conta comum recebe bloqueio de rotas e APIs administrativas.
- `platform-admin-02`: Feedback permite consultar ticket, anexos, triagem e histórico A/B conforme os controles disponíveis.
- `platform-admin-03`: Clientes apresenta escritório, plano, pagamentos e concessão de créditos auditada.
- `platform-admin-04`: Financeiro filtra cobranças, separando sandbox de produção.
- `platform-admin-05`: IA configura conexões/atribuições e TypeSafe; Execuções mostra lista e detalhe.
- `platform-admin-06`: Credenciais permite rotação sem revelar segredos na evidência.
- `platform-admin-07`: Auditoria filtra grupo/escritório e pagina sem misturar contexto.

## How to get to it (user POV)

- `/app/admin`
- `/app/admin/feedback`
- `/app/admin/feedback/[id]`
- `/app/admin/feedback/historico`
- `/app/admin/clients`
- `/app/admin/clients/[officeId]`
- `/app/admin/finance`
- `/app/admin/ai`
- `/app/admin/traces`
- `/app/admin/traces/[id]`
- `/app/admin/credentials`
- `/app/admin/audit`

## Driving it with e2e

Test: `apps/web/e2e/cliproxyapi.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `platform-admin`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Prepare administrador somente no banco isolado pelo mecanismo documentado.
2. Abra cada seção listada nas rotas; gere registros sintéticos pelas funcionalidades correspondentes.
3. Compare usuário comum e administrador; faça concessão/rotação apenas em recursos descartáveis e confira auditoria.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- cliproxyapi cobre parte de IA; não cobre a administração inteira. Nunca alterar credenciais ou cobranças de produção nesta validação.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/app/app/(office)/admin/layout.tsx](../../../../apps/web/src/app/app/(office)/admin/layout.tsx), [apps/web/src/lib/navigation.ts](../../../../apps/web/src/lib/navigation.ts), [apps/web/src/lib/platform-core.ts](../../../../apps/web/src/lib/platform-core.ts), [apps/web/src/components/platform-connections.tsx](../../../../apps/web/src/components/platform-connections.tsx).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
