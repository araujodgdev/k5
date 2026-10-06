# Conexão ChatGPT Ads BETA

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `ads`.

## Sub-features

- `ads-01`: Flag controla menu e acesso direto por usuário/escritório.
- `ads-02`: Conectar chave válida mostra conta, moeda, fuso e situação sem expor segredo.
- `ads-03`: Revalidar/substituir chave respeita versão e apresenta falha recuperável.
- `ads-04`: Desconectar remove vínculo após confirmação.
- `ads-05`: Interface informa que criar/publicar/gerir campanhas ainda não está disponível.

## How to get to it (user POV)

- `/app/ads`

## Driving it with e2e

Nenhum e2e dedicado mapeado. `drive ads` retorna `NO_TESTS`; executar o roteiro manual pelo navegador ou adicionar teste em uma tarefa de implementação.

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [authentication](./authentication.md). Dependências adicionais de cenários: `ads-test`, `rollout`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Com flag desligada, tente menu e rota; registre o bloqueio esperado.
2. Com conta sintética habilitada, conecte, revalide, recarregue e desconecte.
3. Não criar campanha: o escopo implementado é validação da conexão.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- Sem e2e dedicado localizado nesta revisão; executar a receita manual e registrar evidência por subitem.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/components/ads/connection.tsx](../../../../apps/web/src/components/ads/connection.tsx), [apps/web/src/lib/ads/service.ts](../../../../apps/web/src/lib/ads/service.ts), [apps/web/src/lib/ads/rollout.ts](../../../../apps/web/src/lib/ads/rollout.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
