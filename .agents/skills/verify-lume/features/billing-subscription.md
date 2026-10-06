# Plano e checkout

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `billing-subscription`.

## Sub-features

- `billing-subscription-01`: Sem provedor configurado, Plano apresenta indisponibilidade explícita.
- `billing-subscription-02`: Abrir checkout de plano usa uma cobrança por intenção concorrente.
- `billing-subscription-03`: Confirmação de pagamento no sandbox atualiza plano e histórico uma única vez.
- `billing-subscription-04`: Webhook repetido/estorno preserva consistência do plano e créditos.

## How to get to it (user POV)

- `/app/billing`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive billing-subscription` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `payment-sandbox`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Confira o estado sem pagamentos e depois use apenas AbacatePay sandbox autorizado.
2. Abra checkout em duas abas do escritório de teste e compare cobrança/link.
3. Confirme/repita evento no sandbox, recarregue Plano e confira estado, extrato e isolamento.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- brand-shell e credits conferem interface/saldo; não provam checkout e conciliação reais.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/billing-panel.tsx](../../../../apps/web/src/components/billing-panel.tsx), [apps/web/src/lib/billing/office-billing.ts](../../../../apps/web/src/lib/billing/office-billing.ts), [apps/web/src/app/api/billing/webhook/route.ts](../../../../apps/web/src/app/api/billing/webhook/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
