# Prompt para validar o mapa do Lume

Copie a instrução abaixo para o agente executor. Este arquivo prepara a execução; não registra resultados.

```text
Use a skill verify-lume para validar .agents/skills/verify-lume/coverage/feature-graph.json.

Leia AGENTS.md, README.md, apps/web/AGENTS.md, apps/web/README.md, apps/web/DESIGN.md, verify-lume/SKILL.md e coverage/README.md. Leia cada receita antes de dirigi-la. Se escrever testes, use a skill e2e.

Objetivo: cada checkId termina como passed, failed ou blocked, com entrada tentada, esperado, observado, ambiente e evidências. Qualquer not-run restante torna a execução incompleta; relate-o. Não conte blocked como aprovado.

Use instância isolada da verify-lume, um coordenador dirigindo-a serialmente e contas/dados descartáveis. Não use servidor/banco do desenvolvedor. No navegador, prefira preview_status/open/navigate/snapshot e os controles colaborativos T3 disponíveis.

Após up, copie coverage/validation-template.json para evidenceDir/validation-results.json. Registre commit atual, divergências do snapshot, runId, baseURL sem segredos, início e fim. Rode doctor. Ordene cenários pelas dependências e reaproveite dados/testes sem confundir cobertura parcial com aprovação integral.

Execute e2e pertinentes e complemente subitens pelo fluxo real. Mocks não provam persistência/autorização/integração; seeds não provam geração por IA. Leia as asserções de cada teste. Cubra desktop/390px, teclado e estados vazio/carregamento/erro aplicáveis. Prove mutações por recarga e leitura autenticada, sem escrever diretamente o efeito no banco; confira outra conta e sessão revogada.

Dependências são por cenário. Use somente contas de teste/sandbox com autorização existente; não envie mensagens reais nem gere cobranças reais. Se faltar credencial, worker, flag, papel ou entrada UI, registre tentativa e pré-requisito concreto como blocked e prossiga nos independentes. Confira NotificationSettings/JudicialInbox sem montagem e o filtro de situação nas páginas posteriores do Kanban, descritos em findings.md.

Preserve artefatos antes de repetir drive, pois o CLI limpa a pasta da feature. Após falha, doctor e recuperação de estado conhecido. Em finally, encerre somente processos iniciados por você; confirme que evidências sobreviveram ao down.

Não altere código do produto nem enfraqueça o esperado para tornar o relatório verde. Reporte bugs reproduzidos e lacunas do harness separadamente. Se descobrir superfície fora do mapa, registre fonte concreta e novo item mantendo IDs existentes.

Entregue validation-results.json, resumo por funcionalidade/item com passed/failed/blocked/not-run, bugs, dependências pendentes e caminhos das evidências. Só declare validação completa quando todos os IDs estiverem contabilizados; só declare funcionamento integral sem failed, blocked ou not-run.
```
