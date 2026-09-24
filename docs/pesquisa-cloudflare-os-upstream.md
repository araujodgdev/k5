# Cloudflare OS: pesquisa do upstream para o Lume

Data: 24/09/2026. Escopo: pesquisa e planejamento; nenhum código upstream foi executado, instalado ou publicado. O código foi inspecionado em clones temporários fora do monorepo.

Revisões analisadas:

- Core: [`bfe217f5e5ef93748a67bc4f44fa56d8add34de6`](https://github.com/cloudflare/cloudflare-os/tree/bfe217f5e5ef93748a67bc4f44fa56d8add34de6), de 23/09/2026.
- Starter: [`3d211477ad009e13a98d863d843e5c12a29ad02b`](https://github.com/cloudflare/cloudflare-os-starter/tree/3d211477ad009e13a98d863d843e5c12a29ad02b). Seu submódulo fixa outra revisão do core; não se deve assumir que starter e HEAD atual estão sincronizados.
- Apresentação: [anúncio oficial](https://blog.cloudflare.com/cloudflare-os/).

## Conclusão para a decisão

A direção escolhida pelo usuário — adotar a experiência mais ampla do OS e adaptar a UI do Lume ao redor dela — é tecnicamente plausível. O upstream oferece mais que um loop de chat: workspaces, aplicações geradas, colaboração, contexto, integração com recursos, aprovações e tarefas agendadas. É uma base interessante para um ambiente de trabalho jurídico, mas não constitui um SaaS multi-escritório pronto.

**Recomendação de arquitetura, ainda não implementada:** manter um core fixado por commit, uma distribuição Lume ao redor dele e Gatekeepers do domínio jurídico. A experiência OS pode tornar-se o centro de trabalho; os serviços existentes continuam sendo a autoridade sobre dados, permissões e efeitos de negócio. O maior investimento inicial é a fronteira de identidade/escritório, seguido da compatibilidade funcional e da experiência visual.

Não adotar a premissa de que a versão pública já é mais madura em todos os aspectos. O próprio README classifica a v2 como early access, uma reescrita da versão interna, em desenvolvimento intenso. Na consulta, a [página de releases](https://github.com/cloudflare/cloudflare-os/releases) não continha releases, e `git ls-remote --tags` não retornou tags. Há testes e decisões de segurança substanciais, mas também lacunas documentadas. [README do core](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/README.md)

## Arquitetura comprovada no código

| Camada | Implementação upstream | Consequência para o Lume |
| --- | --- | --- |
| Interface | SPA React, Kumo, TanStack Router, Vite; Cap’n Web no cliente | Não é um componente Next.js plugável. Podemos adotar e adaptar sua experiência sem mover todos os módulos atuais para gadgets de uma vez. |
| Transporte | RPC Cap’n Web por WebSocket e HTTP batch em `/api` | Será necessário adaptar autenticação, reconexão e eventos; não é o mesmo contrato de streaming do chat atual. |
| Usuário | `UserDurableObject` | Conta, recursos conectados, modelos e índices próprios do OS. Precisa de mapeamento explícito para identidade Lume. |
| Workspace | `OverseerDurableObject`, armazenamento SQLite/typed storage, chats e registro de workpieces | Uma unidade de trabalho pode conter vários chats, gadgets e árvores de código. Não confundir workspace com escritório. |
| Aplicações | Dynamic Workers e Facets, com bindings limitados | Aplicações geradas não precisam receber acesso direto ao banco nem secrets do Lume. |
| Ferramentas | Gatekeepers em Workers separados | Bom ponto para integrar os serviços jurídicos e preservar suas regras. |
| Modelos | `pi-agent-core` 0.84.3 e `pi-ai` 0.84.4 no commit analisado | Não é uma implementação do Cloudflare Agents SDK; trocar apenas imports de SDK não reproduz o OS. |

Fontes: [frontend/package.json](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-frontend/package.json), [server.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/server.ts), [overseer.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/overseer.ts), [backend/package.json](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/package.json), [Wrangler do backend](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/wrangler.jsonc).

### Persistência e execução prolongada

Existe retomada real, não apenas persistência de mensagens: o Overseer grava `activeAgents`, agenda um alarme de manutenção e reconstitui turnos interrompidos na inicialização. O modelo é resolvido novamente a partir da conta iniciadora; se indisponível, a execução termina com erro explícito. O alarme sustenta trabalho mesmo após o fechamento do navegador. [Overseer: activeAgents, resumeAgent e alarm](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/overseer.ts)

O agente usa snapshots por etapa e uma barreira transacional que persiste o transcript e as alterações locais correspondentes. Uma queda antes dessa barreira pode repetir a etapa. **Inferência para integração:** isso não fornece exatamente uma execução para efeitos externos no PostgreSQL ou em provedores; chaves de idempotência e reconciliação continuam necessárias nos serviços Lume. [AgentHooks.commitAgentStep e loop do agente](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/agent.ts)

O Scheduler é um Gatekeeper separado, com DO/alarms, callbacks persistentes e horários com timezone. Entrega pode repetir; `runId` é estável para deduplicação. Há até oito tentativas, e ocorrências perdidas não são recuperadas. A gestão nativa é essencialmente consulta: não oferece todo o ciclo de edição, histórico e pausa independente do hook. Não deve substituir automaticamente a agenda e os lembretes existentes. [Scheduler](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-scheduler/README.md)

## Escritórios: isolamento ainda precisa ser projetado

O upstream isola workspaces, mas não encontrei uma entidade equivalente ao escritório do Lume que governe todo o produto. Evidências concretas:

1. Login Access resolve `UserDurableObject.idFromName(email)`; não há escritório nessa chave. Os métodos nativos expõem autenticação por token do OS, Cloudflare Access e login próprio. [server.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/server.ts)
2. O diretório de colaboradores é explicitamente global ao deployment. [user-directory.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/user-directory.ts)
3. Configuração administrativa e catálogo promovido vivem em um singleton de deployment, endereçado por `getByName("")`. [admin-settings.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/admin-settings.ts)
4. Context tem uma fronteira `sharingDomain`; o starter a deriva da origem pública ou de um valor fixo. Não é automaticamente um tenant por escritório. [Context library](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-context/src/library-gatekeeper.ts), [customização do starter](https://github.com/cloudflare/cloudflare-os-starter/blob/3d211477ad009e13a98d863d843e5c12a29ad02b/docs/customization.md)

**Inferência:** apenas incluir `office_id` no nome de um workspace não isola diretório, coleções, compartilhamentos, blueprints, modelos ou administração. Precisamos escolher entre deployment por escritório e runtime compartilhado com tenant explícito em todas essas fronteiras. O primeiro favorece isolamento estrutural, mas multiplica operação; o segundo favorece escala operacional, mas exige uma extensão de tenancy auditável.

Modelo de produto recomendado para discutir: escritório como tenant; vários workspaces dentro dele, por usuário, assunto ou caso; chats e gadgets dentro dos workspaces. Um único workspace por escritório misturaria permissões, históricos e ciclo de vida de trabalhos independentes.

### Privacidade e colaboração

As permissões nativas são `build` e `use`. `build` permite chat, código e bindings; `use` é acesso à interface publicada. Colaboradores `build` compartilham histórico do workspace. Permissões só de leitura ou só de chat são trabalho futuro. Logo, conversas privadas já existentes não devem ser importadas automaticamente para um workspace compartilhado. [Sharing](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/docs/sharing.md)

O framework de observers verifica se o destinatário tem acesso às informações observadas por um Gatekeeper; a granularidade é o workspace, não uma thread. O Gatekeeper Lume deverá consultar permissões atuais do usuário/escritório/caso antes de liberar observações e verificar novos colaboradores. O documento de observers é um plano histórico; interfaces e testes atuais devem acompanhar qualquer implementação. [Observers](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/docs/observers.md), [contrato Gatekeeper](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-shared/src/gatekeeper.ts)

## Integração do domínio e aprovações

**Proposta:** construir `gatekeeper-lume` com operações tipadas sobre os serviços/capabilities existentes. A capability de conexão carrega autoridade verificada de escritório e ator; parâmetros vindos do agente não concedem autoridade. O Gatekeeper não entrega SQL, credenciais Hyperdrive ou acesso irrestrito ao Cofre a gadgets.

A simulação promovida pelo anúncio não é obrigatória para todas as integrações. `ActionDescription.awaitDecision` permite que uma ação sem simulação peça suspensão do turno até a decisão; é uma orientação ao harness, não substituto da autorização. O MCP Gatekeeper já retorna ações como `pending` e permite buscar seu resultado posteriormente. Podemos representar proposta, aprovação, execução e falha sem afirmar que uma alteração jurídica aconteceu antes de confirmação real. [contrato das ações](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-shared/src/gatekeeper.ts), [MCP Gatekeeper](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-mcp/README.md)

O conector MCP suporta concessão para um servidor ou ferramentas nomeadas. O MCP Portal oferece escopo por servidor dentro de um portal administrado; um servidor inteiro inclui ferramentas adicionadas posteriormente. Para funções jurídicas sensíveis, a seleção explícita e as verificações no serviço de destino continuam preferíveis a uma integração ampla. [MCP Portal](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-mcp-portal/README.md)

Context entrega documentos e skills consultáveis pelo agente. Blueprints distribuem código da aplicação sem histórico, banco SQLite nem credenciais. Isso favorece modelos reutilizáveis de trabalho, mas **não migra automaticamente** o acervo pesquisável/RAG, os arquivos e as regras de acesso atuais do Lume. [Context](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-context/src/library-gatekeeper.ts), [Blueprints](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/docs/blueprints.md)

## Distribuição, UI e infraestrutura

O starter confirma o padrão de core fixado como submódulo, customizações externas e Workers próprios. Seu deployment básico contém seis Workers: router público, workshop, Context, Scheduler, Gatekeeper customizado e error reporter privados. Branding simples é configuração administrativa; adaptações profundas da UI não devem ser confundidas com esse branding. [Starter README](https://github.com/cloudflare/cloudflare-os-starter/blob/3d211477ad009e13a98d863d843e5c12a29ad02b/README.md)

**Proposta de organização:** uma distribuição em `apps/agent-os`, serviços/adapters próprios e uma cópia upstream fixada em diretório claramente separado. Evitar despejar o monorepo upstream inteiro em `apps/` e misturar todos os seus pacotes no workspace raiz sem uma decisão de build. O starter registra explicitamente problemas causados por versões diferentes de Cap’n Web entre instalações; seu catálogo precisa acompanhar o commit fixado. [pnpm-workspace do starter](https://github.com/cloudflare/cloudflare-os-starter/blob/3d211477ad009e13a98d863d843e5c12a29ad02b/pnpm-workspace.yaml)

O backend requer DOs SQLite, Dynamic Worker Loader, Browser Run, KV e R2; Workers AI/AI Gateway entram conforme catálogo/modelos e conversão de documentos. Isso é outra topologia em relação ao preview HTTP atual. Containers não são requisito desse core. [Configuração do backend](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/wrangler.jsonc)

Há um fluxo upstream de **Worker Previews multi-worker**, organizado em três etapas: Gatekeepers, workshop e router; injeta IDs de previews nos service bindings e deixa só o router público. O script ainda referencia uma build de Wrangler do PR 14416. Na verificação conjunta desta pesquisa, o Wrangler 4.135 instalado no K5 não declara `preview_id` no schema de service bindings; a documentação atual permite ligar Preview A ao Worker B, mas não ao Preview B. Para a prova inicial, usar um ambiente dedicado de Workers e recursos de teste, ou um preview público ligado explicitamente a serviços dedicados de teste; nunca deixar o vínculo cair em serviços de produção. [preview.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/scripts/preview/preview.ts), [recursos em Previews](https://developers.cloudflare.com/workers/previews/resources/)

Autenticação Better Auth não está pronta no starter. Preservar login, revogação e logout global exige um adaptador de identidade confiável e verificação de conexões RPC duradouras. Não fabricar JWTs Cloudflare Access ou confiar em `office_id`/email enviados pelo navegador. O acesso administrativo do OS também precisa ser mapeado à política de plataforma do Lume, sem transformar todo administrador de escritório em administrador global. [Access verifier](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/access.ts), [métodos de login](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/docs/oauth-signin.md)

### Escala de dezenas de escritórios

O usuário pretende dezenas de escritórios com provisionamento automático. Replicar integralmente o bundle requer considerar classes DO, além de quantidade de Workers. Na combinação do core analisado com o Gatekeeper customizado do starter, são **12 classes DO**: cinco do backend, quatro do Context, duas do Scheduler e uma customizada. O router e error reporter não adicionam classes nesses arquivos. Essa contagem é dos arquivos de configuração, não uma consulta às cotas ou recursos da conta. [Backend](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/wrangler.jsonc), [Context](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-context/wrangler.jsonc), [Scheduler](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/gatekeeper-scheduler/wrangler.jsonc), [Custom](https://github.com/cloudflare/cloudflare-os-starter/blob/3d211477ad009e13a98d863d843e5c12a29ad02b/packages/custom-gatekeeper/wrangler.jsonc)

| Deployments completos | Workers, usando 6 por escritório | Classes DO, usando 12 por escritório |
| --- | --- | --- |
| 10 | 60 | 120 |
| 30 | 180 | 360 |
| 50 | 300 | 600 |

A documentação lista limite padrão de **500 classes DO por conta paga** e **500 Workers**, sem limitar o número de objetos dentro de uma classe. Portanto 50 réplicas desse bundle já ultrapassariam a cota de classes, antes de conectores extras e ambientes de teste. A decisão entre frota por escritório, compartilhamento seguro de alguns serviços ou runtime multi-tenant precisa de orçamento de cotas, custos e operação. Não pressupor aumento de limites já aprovado. [Limites DO](https://developers.cloudflare.com/durable-objects/platform/limits/), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/)

## Paridade multimodal e política de modelos

Os anexos do upstream não preservam os limites atuais do Lume: servidor limita cada anexo a **1 MiB**; composer aceita cinco anexos e 5 MiB no total. Imagens fonte podem ter até 25 MiB antes de redução. Há JPEG/PNG/WebP, texto e PDF; PDF depende de Anthropic/OpenAI/Google, enquanto Workers AI/Ollama não recebem PDF por essa implementação. [Validação de anexos](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/chat-attachment-validation.ts), [preparação](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-frontend/src/features/chat/composer/attachments/prepareChatAttachment.ts), [composer](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-frontend/src/features/chat/composer/attachments/useComposerAttachments.ts)

Não foi localizado fluxo de gravação/transcrição de áudio ou câmera na busca por `MediaRecorder`, `getUserMedia`, `mediaDevices`, `audio/` e `transcription` no frontend/backend. Isso é ausência de evidência na revisão, não prova de impossibilidade. Preservar esses fluxos exige portar a integração Lume e validá-la.

Há `webFetch`, mas não foi encontrada equivalência pronta ao contrato de pesquisa web com citações estruturadas do Lume no loop inspecionado. Links em Markdown não bastam para comprovar essa paridade; manter pesquisa/citações como integração explícita. [web-fetch.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/web-fetch.ts)

`listModels()` inclui modelos individuais além do catálogo AI Gateway. `addModel()` restringe provider no modo gateway, mas não equivale ao modelo único global definido pelo administrador Lume. A política precisa ser aplicada no servidor e nas retomadas, não apenas escondendo o seletor na UI. [user.ts](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/user.ts#L588)

## Critérios para o primeiro experimento

As verificações abaixo são propostas, não resultados já obtidos:

- Dois escritórios e dois usuários por escritório: nenhum acesso cruzado por ID, busca, link, blueprint, Context, arquivo, ação pendente ou reconexão.
- Workspace privado preserva histórico privado; compartilhamento explícito funciona com os papéis definidos para o Lume.
- Encerrar navegador e reiniciar DO durante tarefa: retomada coerente, sem duplicar efeitos externos.
- Revogar usuário/sessão enquanto conexão e execução estão ativas: o comportamento respeita a política do Lume, inclusive aprovação de ações antigas.
- Uma tarefa real completa usa leitura, pesquisa, proposta de alteração, aprovação, execução idempotente, artefato e download; os módulos atuais permanecem utilizáveis.
- Configuração global de modelo, limites e atribuição de custos respeitam a administração atual.
- Deployment isolado comprova bindings para recursos e serviços do próprio ambiente.

Existe ainda um aviso no código do endpoint de chat externo: a execução pode sobreviver à autorização inicial e retomar sem reverificar um colaborador após mudança de escopo. O comentário orienta corrigir isso antes de conectar consumidores reais. Não tratar Slack ou mensagens externas como prontas para nossa migração só por existir infraestrutura relacionada. [overseer.ts, aviso KNOWN GAP no fluxo external chat](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/packages/workshop-backend/src/overseer.ts#L9988)

## Licença e limites desta pesquisa

O repositório publica [Apache License 2.0](https://github.com/cloudflare/cloudflare-os/blob/bfe217f5e5ef93748a67bc4f44fa56d8add34de6/LICENSE). A integração deve preservar seus avisos e registrar origem/commit. Não foi feita auditoria jurídica das dependências ou de marcas.

Esta pesquisa confirma estruturas e contratos no código, não desempenho, custo, segurança integral nem paridade do produto em produção. Nenhuma suite upstream foi executada. A documentação nova foi conferida contra os arquivos existentes no commit e os links de fontes; os testes de aplicação do K5 não são necessários para esta alteração documental.
