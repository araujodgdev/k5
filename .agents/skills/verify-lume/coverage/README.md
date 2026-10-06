# Mapa de cobertura do Lume

Revisão de código em 2026-10-06 sobre `060160d`. **Preparação para validação: nenhuma funcionalidade foi executada nesta etapa.** Não equivale ao resultado `clean` da manutenção completa, que exige prova ao vivo.

São **51 grupos**, **302 itens de verificação** e **34 arquivos e2e referenciados** (incluindo preparação de sessão). 35 grupos referenciam testes existentes e 16 não têm e2e dedicado mapeado. Um arquivo pode servir a vários grupos. Essas contagens são de inventário, não taxa de aprovação.

## Arquivos

- [Grafo interativo](./feature-graph.html): busca, filtros e relações da funcionalidade selecionada; abre localmente, sem serviço/CDN.
- [Grafo JSON](./feature-graph.json): IDs, entradas, fontes, dependências, resultados esperados, limitações e vínculos a testes.
- [Grafo Mermaid](./feature-graph.mmd): todas as funcionalidades e seus subitens; relações de dependência e composição.
- [Prompt de validação](./validation-prompt.md): instrução pronta para o próximo agente.
- [Modelo de resultados](./validation-template.json): um registro por item, todos `not-run`; copiar para a pasta de evidências da execução, sem sobrescrever este modelo.
- [Achados e limites de cobertura](./findings.md).
- [Índice de receitas](../features/README.md).

## Como ler e manter

A seta sólida A → B significa que **o roteiro de B usa dados/estado preparado em A**. Não é grafo de chamadas de código e não obriga executar todo A para testar todo B. As subfuncionalidades pertencem a um grupo; dependências externas são condicionais e seu escopo aparece abaixo. Criar uma tarefa manualmente pode dispensar o modelo que dirige um teste agent/.

Os 21 grupos originais receberam revisão de fonte por funcionalidade. Os 30 adicionados vieram da inspeção de navegação, rotas, componentes e testes; seu `reviewDepth` registra essa distinção. Rotas parametrizadas usam IDs reais criados na execução. Este mapa cobre superfícies identificadas, não promete enumerar toda combinação interna, API ou configuração. O agente deve registrar novas lacunas descobertas e atualizar mapa/receita antes de afirmar cobertura total.

Preservar os IDs de grupos e itens; nunca renumerar ou reutilizar ID removido. Ao editar uma receita, atualizar JSON, Mermaid, HTML, índice e modelo de resultados. Manter os espelhos `.agents` e `.claude` idênticos. Arquivos auxiliares ficam em `coverage/`, pois o CLI interpreta todo `features/*.md`, exceto README, como receita.

## Ordem de execução proposta

1. Site público, autenticação e aceite; usar contas separadas para mudanças de credenciais e logout global.
2. Shell, perfil, tutorial e dados; exportação/agendamento/cancelamento apenas em contas descartáveis.
3. Clientes, casos, lista de tarefas, Kanban, detalhes, calendário, Início e atividade.
4. Cofre, pastas, colaboração e anexos; validar autorização com segunda conta.
5. Honorários, cobrança manual, cálculos e portal; preparar conversores só para os cenários que precisam deles.
6. Chat, artefatos, edição, revisão e exportação; separar documento preparado de geração real por IA.
7. Pesquisa e integrações externas em ambientes de teste, com seus processadores e fontes; nada configurado significa cenário bloqueado, não funcionalidade aprovada.
8. Administração, cobranças externas, notificações/push e PWA de produção. Verificar lacunas de montagem descritas em findings antes de presumir entrada pela UI.

Essa ordem agrupa cenários para reutilizar dados; o JSON detalha as dependências. Usar um único coordenador dirigindo a instância serialmente. Revisores de fonte podem trabalhar sem dirigir a aplicação.

## Critérios de resultado

- `not-run`: ainda não tentado. Estado inicial de todos os itens.
- `passed`: ação e resultado esperado comprovados, com evidência e ambiente; incluir persistência/autorização quando pertinentes.
- `failed`: cenário acessível produziu resultado contrário ao esperado; registrar reprodução e evidência.
- `blocked`: houve tentativa com entrada registrada, mas falta pré-requisito concreto ou a UI não oferece entrada; não converter em aprovado.

Não inventar uma aprovação por arquivo de teste: APIs simuladas podem provar apresentação/recuperação, mas não persistência, isolamento nem entrega externa. Preparação de dados não comprova o fluxo que criou esses dados. Um arquivo com `browser.route` também pode conter passos reais; ler suas asserções e classificar por cenário. A busca lexical em `testFiles` serve só como alerta.

Para cada item, registrar `featureId`, `checkId`, entrada tentada, esperado, observado, estado, evidências, ambiente e bloqueio. Capturar ação e efeito, testar desktop/390px e teclado onde aplicável, recarregar e ler dados autenticados. Não gravar diretamente no banco o efeito que está sendo provado. Manter credenciais e dados reais fora de traces/relatórios.

## Dependências condicionais

### email-test — Entrega de e-mail de teste

Somente confirmação, recuperação, mudança de e-mail e destinatários externos. Fluxos locais podem ser verificados sem entrega. Fonte: [apps/web/src/lib/personal-chat/email-transport.ts](../../../../apps/web/src/lib/personal-chat/email-transport.ts).

### disposable-account — Contas descartáveis

Obrigatórias para alteração de credenciais, convites, isolamento e exclusão. Nunca reutilizar conta/dados reais. Fonte: [apps/web/e2e/support/accounts.ts](../../../../apps/web/e2e/support/accounts.ts).

### runner-ai — Modelo que dirige o e2e

OPENAI_API_KEY no runner dos testes agent/. Não é pré-requisito do CRUD feito manualmente na UI. Fonte: [apps/web/e2e/agent/office-clients.e2e.ts](../../../../apps/web/e2e/agent/office-clients.e2e.ts).

### platform-admin — Administrador da plataforma

Permissão distinta da sessão chamada admin do runner; provisionar só na instância isolada. Fonte: [apps/web/scripts/platform-admin.ts](../../../../apps/web/scripts/platform-admin.ts).

### ai-provider — Modelo de tarefa e créditos

Conexão/atribuição válida, chave e saldo/isenção. Inclui modalidades específicas para voz/imagem e TypeSafe quando usado. Fonte: [apps/web/src/lib/ai-connections.ts](../../../../apps/web/src/lib/ai-connections.ts).

### soffice — Conversão PDF com LibreOffice

Somente caminhos que convertem DOCX com timbrado/portal/cobrança. PDFcn e Calc não exigem LibreOffice. PATH, LIBREOFFICE_PATH ou localização Windows. Fonte: [apps/web/src/lib/document-pdf-node.ts](../../../../apps/web/src/lib/document-pdf-node.ts).

### document-worker — Processamento documental/pesquisa

Harness não lança worker separado. Node pode processar TXT inline. Filas, OCR, pesquisa e runtime Cloudflare requerem verificar o processador e bibliotecas nativas efetivamente usados. Fonte: [apps/web/src/lib/vault.ts](../../../../apps/web/src/lib/vault.ts).

### judicial-worker — Coleta judicial

Worker de coleta apontado apenas ao banco isolado; acompanhar job e fonte. Fonte: [apps/web/src/lib/judicial/jobs/collector.ts](../../../../apps/web/src/lib/judicial/jobs/collector.ts).

### judicial-installation — Fonte judicial habilitada

Instalação, cobertura e permissões de uso configuradas; distinguir fonte sem resposta de inexistência do processo. Fonte: [apps/web/src/lib/judicial/repositories/installations.ts](../../../../apps/web/src/lib/judicial/repositories/installations.ts).

### research-sources — Acervo e fontes de pesquisa

Acervo/instalações e acesso às fontes oficiais; marcas usa o provedor configurado. Exa aplica-se à pesquisa web, não assumir requisito de toda consulta local. Fonte: [apps/web/src/lib/research/runtime.ts](../../../../apps/web/src/lib/research/runtime.ts).

### google-test — Conta Google de teste

OAuth/escopos autorizados, callback, Picker quando usado; conta/destinatários sintéticos. Fonte: [apps/web/src/lib/google/config.ts](../../../../apps/web/src/lib/google/config.ts).

### integration-worker — Processamento de integrações

Sincronização e entrega assíncrona devem usar recursos isolados. Confirmar modo de execução pelo README antes de iniciar. Fonte: [apps/web/src/lib/google/worker.ts](../../../../apps/web/src/lib/google/worker.ts).

### notification-worker — Worker de notificações

Projeção/entrega, captura e rollout de lembretes. Ausência não bloqueia leitura da UI vazia. Fonte: [apps/web/src/lib/notifications/worker.ts](../../../../apps/web/src/lib/notifications/worker.ts).

### web-push — Web Push e dispositivo

VAPID, HTTPS ou localhost, service worker e permissão/suporte de navegador. Há lacuna de montagem da UI de preferências. Fonte: [apps/web/src/components/notification-settings.tsx](../../../../apps/web/src/components/notification-settings.tsx).

### production-build — Build de produção isolado

Necessário para validar publicação do service worker/offline; dev pode pular esse cenário. Fonte: [apps/web/e2e/pwa.e2e.ts](../../../../apps/web/e2e/pwa.e2e.ts).

### payment-sandbox — AbacatePay sandbox

Chaves e webhook de teste; evitar cobrança real. Não necessário para consultar saldo/estado indisponível. Fonte: [apps/web/src/lib/billing/office-billing.ts](../../../../apps/web/src/lib/billing/office-billing.ts).

### asaas-sandbox — Asaas sandbox e webhook

Conta de teste, cifragem e URL pública HTTPS para emissão e conciliação; leitura sem conexão não depende disso. Fonte: [apps/web/src/lib/asaas/service.ts](../../../../apps/web/src/lib/asaas/service.ts).

### whatsapp-test — Zernio e contato de teste

Conta piloto, token/webhook e destinatário explicitamente de teste; janela de resposta aplicável. Fonte: [apps/web/src/lib/whatsapp/environment.ts](../../../../apps/web/src/lib/whatsapp/environment.ts).

### ads-test — Conta Ads de teste

Credencial de conta e cifragem para validar conexão; o produto não implementa gestão de campanhas. Fonte: [apps/web/src/lib/ads/service.ts](../../../../apps/web/src/lib/ads/service.ts).

### rollout — Flags de produto

Flagship/binding: whatsapp-integration e chatgpt-ads; validar flag desligada sem ligar módulos de produção. Fonte: [apps/web/src/lib/flagship.ts](../../../../apps/web/src/lib/flagship.ts).

## Comandos do harness

Na raiz, PowerShell:

```powershell
function Invoke-LumeVerify {
  & pnpm --silent --dir apps/web exec tsx ../../.agents/skills/verify-lume/scripts/lume-verify.mts @args
}
Invoke-LumeVerify features
Invoke-LumeVerify up
Invoke-LumeVerify doctor
Invoke-LumeVerify drive office-tasks --video
Invoke-LumeVerify down
```

Ler [SKILL.md](../SKILL.md) antes da execução. Guardar o resultado de `up`, especialmente baseURL e evidenceDir. O CLI `drive` de uma receita compartilhada executa o arquivo inteiro; reaproveitar um resultado só se o mesmo teste/ambiente/execução realmente cobrir o subitem. Receita sem Test retorna NO_TESTS: usar navegador colaborativo para o roteiro ou implementar e2e em tarefa própria. A instância não lança workers adicionais nem habilita integrações sozinha.

Preservar evidências **antes de repetir um drive**, pois o CLI limpa a pasta daquela funcionalidade no início da tentativa. Depois de falha, rodar doctor e recuperar estado conhecido. Em finally, encerrar somente processos desta execução; confirmar que evidências sobreviveram ao down. Rodar typecheck após down se a execução tiver gerado tipos de desenvolvimento, conforme a skill.
