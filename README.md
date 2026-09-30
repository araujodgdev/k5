# Lume

Monorepo pnpm + Turborepo. Frontend em Next.js 16, TypeScript e Tailwind CSS.
Autenticação com Better Auth e PostgreSQL. Workers Cloudflare acessam o banco pelo Hyperdrive.

## Começar

Requisitos: Node.js >= 22.13.0 e pnpm 12.4.2.

```sh
npm install --global pnpm@12.4.2
pnpm install
# Configure DATABASE_URL em apps/web/.env.local (veja docs/ambientes.md).
pnpm dev
```

Abra http://localhost:3000. A raiz é a página pública do Lume; o acesso fica em `/sign-in`.
`pnpm dev` prepara o PostgreSQL e gera `apps/web/.env.local` com um segredo aleatório,
caso ainda não exista configuração. Não sobrescreve dados nem segredos existentes.
No primeiro acesso, escolha **Criar conta** para cadastrar seu escritório.

Para um PostgreSQL local sem Docker, execute `pnpm --filter @k5/web db:local`
em outro terminal. Ele mantém os dados na pasta ignorada `.data/postgres-migration/`
do aplicativo e escuta em `127.0.0.1:55432`. Copie somente as variáveis de conexão
de `apps/web/.data/postgres-migration/dev.env` para `apps/web/.env.local`,
preservando os demais segredos. Inicie esse processo novamente após reiniciar a máquina.

## Docker

```sh
cp .env.example .env     # preencha BETTER_AUTH_SECRET e K5_CREDENTIALS_KEY
docker compose up
```

Sobem `postgres`, `vectors` (pgvector), `setup` (migrações), `web`, `worker`, `judicial-worker` e `notifications`.
O PostgreSQL usa volume próprio. Os originais do Cofre e da Pesquisa continuam no volume `appdata`.
Detalhes e a configuração de
staging na Cloudflare estão em [docs/ambientes.md](docs/ambientes.md).

## Estrutura

- `apps/web`: frontend e endpoints de autenticação (`@k5/web`).
- `packages`: espaço para bibliotecas compartilhadas.
- `pnpm-workspace.yaml`: workspaces e permissões de instalação.
- `turbo.json`: tarefas e cache.

## Comandos

```sh
pnpm dev
pnpm db:setup
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm worker
pnpm judicial:worker                                             # coleta judicial, fila separada
pnpm notifications:worker                                        # caixa, lembretes e Web Push
pnpm judicial:admin list                                         # fontes judiciais cadastradas
pnpm platform:admin grant --email usuario@exemplo.com
pnpm --filter @k5/web start

pnpm --filter @k5/web db:migrate                                # conexão direta em .env.postgres.local
pnpm --filter @k5/web exec tsx scripts/verify-staging.ts         # valida workers Node com credenciais diretas de R2/Vectorize/PostgreSQL
```

`build` e `start` pressupõem ambiente configurado e `pnpm db:setup` executado.
`start` exige um build anterior. Em CI, use `pnpm install --frozen-lockfile`.
Os testes usam esquemas isolados em PostgreSQL real. `pnpm test` inicia uma instância temporária automaticamente; `TEST_DATABASE_URL` permite usar um servidor de testes existente.
Em máquinas com pouca memória livre, `K5_TEST_CONCURRENCY=1` executa as suítes em sequência; o padrão é quatro processos.
O servidor de testes precisa de `max_locks_per_transaction=256` para criar e remover os esquemas em paralelo. A instância temporária já usa esse valor.
Em containers executados como root, configure `TEST_DATABASE_URL`: o servidor PostgreSQL não inicia como root.

O staging hospedado usa bindings privados nos Containers, sem credenciais S3 locais. Sua validação e operação estão em [docs/processadores-cloudflare.md](docs/processadores-cloudflare.md).

Alertas, monitores de filas, jornadas sintéticas e encerramento de incidentes estão no [runbook de observabilidade](docs/observability-runbook.md). A [avaliação de prontidão](docs/observability-readiness-2026-09-29.md) registra cobertura, evidências e limites conhecidos.

O preview HTTP isolado para o refactor é publicado com `pnpm preview:deploy --name refactor`.
Recursos, configuração privada e escopo estão em [docs/previews.md](docs/previews.md).

## Rotas

| Rota | Tela |
| --- | --- |
| `/sign-in` | Entrar |
| `/sign-up` | Criar conta |
| `/app` | Redireciona para o Início |
| `/app/command-center` | Início: resumo do escritório e ações rápidas |
| `/app/agents` | Lume, assistente do escritório |
| `/app/vault` | Cofre |
| `/app/agenda` | Escritório: tarefas, agenda, clientes, equipe, associados e convites |
| `/invite/[token]` | Aceitar ou recusar um convite com a conta destinatária |
| `/app/agenda/clients/[id]` | Detalhes do cliente, contato, casos e atividades |
| `/client` | Portal do cliente: documentos publicados, cobranças e envio de arquivos |
| `/app/honorarios` | Honorários: parcelas, recebimentos e saldos do escritório |
| `/app/notifications` | Abre o painel de notificações (sino no rodapé do menu) |
| `/app/research` | Pesquisa na web pela Exa, com histórico pessoal |
| `/app/whatsapp` | Conversas do WhatsApp Business, para escritórios habilitados no piloto |
| `/app/ads` | Anúncios BETA: conexão e validação da conta ChatGPT Ads, para usuários habilitados pelo Flagship |
| `/app/messages` | Mensagens entre pessoas, associados e compartilhamentos do Cofre |
| `/app/documents/[id]` | Editor de cronologias e minutas |
| `/app/admin` | Administração da plataforma: feedback, conexões de IA por escritório e TypeSafe |

As áreas de `/app` exigem sessão válida no servidor. Início, Lume, Cofre e Tarefas e Agenda estão implementados.
`/app/admin` exige o papel de administrador da plataforma; os endereços antigos em `/platform` redirecionam para lá.
Tarefas de documentos precisam do worker (`pnpm worker`) em execução; veja
[`apps/web/README.md`](apps/web/README.md).
A consulta a tribunais também precisa de `pnpm judicial:worker` e de uma instalação judicial
habilitada pelo operador. A extração de PDF e as avaliações de Pesquisa usam `pnpm worker`.
Veja [operação da Pesquisa](apps/web/README.md#pesquisa-de-jurisprudência).
A interface usa pt-BR, temas claro/escuro (ou o tema do sistema) e sidebar responsiva.
O Lume pode ser instalado como PWA; veja [instalação e funcionamento offline](apps/web/README.md#pwa-e-temas).

Tarefas e Agenda reúne clientes, vínculos com casos do Cofre, tarefas e reuniões internas,
com operações também disponíveis ao agente e ao WebMCP. Veja o
[plano do módulo](docs/plano-tarefas-agenda.md). A integração opcional Google adiciona agenda
pessoal sincronizada e convites, Gmail, Drive e Docs; veja [configuração e homologação](docs/integracao-google.md).
Os lembretes das atividades do escritório exigem o worker de notificações
(`pnpm notifications:worker`) em execução.

O módulo [Honorários](docs/honorarios.md) registra valores por cliente, com caso opcional,
parcelas e recebimentos manuais. Cada pessoa controla seus honorários e os participantes
dos casos vinculados podem consultar os valores. O dono corrige baixas com histórico
e cancela honorários sem recebimentos. Não há emissão de cobrança
bancária nesta versão.

O [Portal do cliente](apps/web/docs/portal-cliente.md) usa convite e senha próprios para trocar
PDFs, arquivos e comprovantes e consultar cobranças explicitamente publicadas pelo advogado.
O cliente não recebe acesso aos documentos internos do escritório.

A [integração de assinatura ZapSign](apps/web/docs/assinaturas.md) envia PDFs publicados
ao cliente e arquiva o PDF assinado após consulta ao provedor. O administrador configura
a chave por escritório em Integrações. O portal também orienta a assinatura manual pelo gov.br.

A integração WhatsApp Business usa Zernio e liberação por escritório via Flagship.
Ela oferece caixa compartilhada e ferramentas do agente com confirmação de envio.
Veja [configuração e homologação](apps/web/docs/integracao-whatsapp.md) e
[verificação local](apps/web/docs/whatsapp-verificacao.md).

O módulo [Mensagens](docs/mensagens.md) permite conversar com outras pessoas no Lume
e compartilhar documentos e casos do Cofre. Destinatários externos recebem e-mail;
respostas por e-mail não são importadas nesta versão. O envio externo exige a
configuração do Cloudflare Email Service e o worker de integrações.

O módulo [Anúncios BETA](apps/web/docs/integracao-anuncios.md) valida e conecta a conta
OpenAI Ads do escritório. O Flagship controla o acesso por usuário e escritório.
Criação e gestão de campanhas dependem da próxima etapa de implementação e homologação.

## Configuração e dados

O [tutorial e primeiros passos](docs/onboarding.md) apresenta o tour interativo e o vídeo em português.

Consulte o [Manual do Lume](docs/manual-lume.md) para o funcionamento de cada módulo e os limites do assistente. A [operação do agente e da ajuda](docs/agente-modulos-e-ajuda.md) descreve ferramentas, confirmações e publicação da base de conhecimento na Cloudflare.

Veja [o guia do frontend](apps/web/README.md) e [as variáveis de exemplo](apps/web/.env.example).
O cadastro cria um escritório e um vínculo de administrador. Em **Escritório → Equipe**,
administradores convidam membros e gerenciam os papéis de administrador, advogado e revisor.
Uma pessoa pode participar de vários escritórios e alternar o escritório ativo.
**Associados** reúne parceiros; a aba **Participantes** de cada caso permite compartilhar
somente aquele caso. Veja [colaboração e convites](docs/colaboracao.md).

O logout encerra todas as sessões do usuário. As senhas ficam sob responsabilidade
do Better Auth, com hash scrypt; os cookies de sessão são HttpOnly. O acesso ao
escritório parte do usuário autenticado e não de um ID fornecido pelo navegador.

O banco transacional é PostgreSQL em todos os runtimes. Veja [PostgreSQL e Hyperdrive](docs/migracao-postgres.md) para migrações, Hyperdrive sem cache e operação do staging.

## Adicionar workspaces

Crie um `package.json` em uma pasta diretamente em `apps/` ou `packages/`, com
nome único e scripts de tarefa. Declare dependências internas como `workspace:*`
e rode `pnpm install` na raiz. Exemplo: `pnpm --filter @k5/web dev`.

## Referências

- [Next.js](https://nextjs.org/docs)
- [Better Auth com Next.js](https://better-auth.com/docs/integrations/next)
- [Better Auth com PostgreSQL](https://better-auth.com/docs/adapters/postgresql)
- [Turborepo](https://turborepo.dev/docs)
