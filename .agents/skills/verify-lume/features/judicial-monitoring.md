# Processos, publicações e alertas

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `judicial-monitoring`.

## Sub-features

- `judicial-monitoring-01`: Vincular número de processo mantém fonte e situação no caso.
- `judicial-monitoring-02`: Confirmar/rejeitar vínculo proposto altera o estado correto.
- `judicial-monitoring-03`: Atualizar processo produz job observável e resultado ou erro explícito da fonte.
- `judicial-monitoring-04`: Detalhe do processo mostra quantidade/data de publicações; caixa JudicialInbox e marcação de alertas precisam de entrada UI demonstrada. **Lacuna de entrada:** JudicialInbox sem import/montagem em src nesta revisão.
- `judicial-monitoring-05`: Seguir e desvincular alteram apenas o vínculo/autorização esperado.

## How to get to it (user POV)

- `/app/vault/cases/[id]`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive judicial-monitoring` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [vault-cases](./vault-cases.md). Dependências adicionais de cenários: `judicial-worker`, `judicial-installation`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. No caso, abra Processos acompanhados e vincule processo de teste da instalação habilitada.
2. Atualize, acompanhe job e confira Publicações coletadas/Eventos.
3. Expanda detalhe do processo, confira quantidade/data de publicações, altere acompanhamento e retire acesso do participante. Registre separadamente a ausência de entrada da JudicialInbox.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Processos acompanhados tem entrada no caso. JudicialInbox existe, mas sem montagem localizada; não prometer navegação até Eventos/Publicações coletadas sem resolver essa lacuna.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/judicial-case-links.tsx](../../../../apps/web/src/components/judicial-case-links.tsx), [apps/web/src/components/judicial-inbox.tsx](../../../../apps/web/src/components/judicial-inbox.tsx), [apps/web/src/lib/application/judicial-service.ts](../../../../apps/web/src/lib/application/judicial-service.ts), [apps/web/src/lib/judicial/jobs/collector.ts](../../../../apps/web/src/lib/judicial/jobs/collector.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
