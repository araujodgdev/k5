# K5

Monorepo pnpm + Turborepo. Frontend em Next.js 16, TypeScript e Tailwind CSS.
Autenticação com Better Auth e SQLite local.

## Começar

Requisitos: Node.js >= 22.13.0 e pnpm 12.4.2.

```sh
npm install --global pnpm@12.4.2
pnpm install
pnpm dev
```

Abra http://localhost:3000. A raiz leva a `/sign-in`.
`pnpm dev` prepara o SQLite e gera `apps/web/.env.local` com um segredo aleatório,
caso ainda não exista configuração. Não sobrescreve dados nem segredos existentes.
No primeiro acesso, escolha **Criar conta** para cadastrar seu escritório.

## Docker

```sh
cp .env.example .env     # preencha BETTER_AUTH_SECRET e K5_CREDENTIALS_KEY
docker compose up
```

Sobem `vectors` (pgvector), `setup` (migrações), `web` e `worker`. Detalhes e a configuração de
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
pnpm judicial:admin list                                         # fontes judiciais cadastradas
pnpm platform:admin grant --email usuario@exemplo.com
pnpm --filter @k5/web start

bash scripts/staging-setup.sh                                    # configura o staging (passos manuais)
pnpm --filter @k5/web exec tsx scripts/verify-staging.ts         # verifica R2, Vectorize e Neon
```

`build` e `start` pressupõem ambiente configurado e `pnpm db:setup` executado.
`start` exige um build anterior. Em CI, use `pnpm install --frozen-lockfile`.
Os testes de autenticação usam bancos SQLite em memória, separados dos dados locais.

## Rotas

| Rota | Tela |
| --- | --- |
| `/sign-in` | Entrar |
| `/sign-up` | Criar conta |
| `/app` | Redireciona para o Início |
| `/app/command-center` | Início (em breve) |
| `/app/agents` | Agentes |
| `/app/vault` | Cofre |
| `/app/research` | Pesquisa |
| `/app/documents/[id]` | Editor de cronologias e minutas |
| `/platform/clients` | Administração da plataforma (conexões de IA por escritório) |

As áreas de `/app` exigem sessão válida no servidor. Agentes e Cofre estão implementados;
Início e Pesquisa exibem “Em breve”. `/platform` exige o papel de administrador da plataforma.
Tarefas de documentos precisam do worker (`pnpm worker`) em execução; veja
[`apps/web/README.md`](apps/web/README.md).
A interface usa pt-BR, tema claro e sidebar responsiva.

## Configuração e dados

Veja [o guia do frontend](apps/web/README.md) e [as variáveis de exemplo](apps/web/.env.example).
O cadastro cria um escritório e um vínculo de administrador. Os papéis de advogado
 e revisor já estão modelados; convites, gestão de papéis e operações de negócio
ficam para as próximas etapas. Cada usuário pertence a um escritório nesta fase.

O logout encerra todas as sessões do usuário. As senhas ficam sob responsabilidade
do Better Auth, com hash scrypt; os cookies de sessão são HttpOnly. O acesso ao
escritório parte do usuário autenticado e não de um ID fornecido pelo navegador.

SQLite é a base de desenvolvimento. A migração para PostgreSQL e os demais
requisitos de infraestrutura do PRD serão tratados antes de produção.

## Adicionar workspaces

Crie um `package.json` em uma pasta diretamente em `apps/` ou `packages/`, com
nome único e scripts de tarefa. Declare dependências internas como `workspace:*`
e rode `pnpm install` na raiz. Exemplo: `pnpm --filter @k5/web dev`.

## Referências

- [Next.js](https://nextjs.org/docs)
- [Better Auth com Next.js](https://better-auth.com/docs/integrations/next)
- [Better Auth com SQLite](https://better-auth.com/docs/adapters/sqlite)
- [Turborepo](https://turborepo.dev/docs)
