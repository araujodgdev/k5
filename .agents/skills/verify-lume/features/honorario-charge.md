# Cobrança manual e PDF

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `honorario-charge`.

## Sub-features

- `honorario-charge-01`: PIX e boleto anexado ficam ligados à parcela correta.
- `honorario-charge-02`: PDF contém dados e valor da versão vigente da cobrança.
- `honorario-charge-03`: Registrar envio mantém histórico sem registrar recebimento.
- `honorario-charge-04`: Parcela quitada bloqueia alteração/envio incompatível.
- `honorario-charge-05`: Publicar/retirar no portal altera acesso; lembretes seguem configuração.

## How to get to it (user POV)

- `/app/honorarios`

## Driving it with e2e

Test: `apps/web/e2e/honorario-charge.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [honorarios](./honorarios.md). Dependências adicionais de cenários: `soffice`, `notification-worker`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra parcela pendente e configure cobrança com PIX/boleto sintéticos.
2. Baixe o PDF, leia seu conteúdo e registre envio; confira histórico e saldo.
3. Publique/retire no portal e quite em cenário separado para observar bloqueios.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- O e2e cobre cobrança manual, PDF e recusas; publicação no portal e entrega de lembretes exigem complementos.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/honorarios/charge-form.tsx](../../../../apps/web/src/components/honorarios/charge-form.tsx), [apps/web/src/lib/honorarios/charges.ts](../../../../apps/web/src/lib/honorarios/charges.ts), [apps/web/src/app/api/honorarios/charges/[id]/pdf/route.ts](../../../../apps/web/src/app/api/honorarios/charges/[id]/pdf/route.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
