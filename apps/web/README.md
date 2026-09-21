# @k5/web

Next.js App Router com Better Auth, SQLite, TypeScript e Tailwind CSS.

## Ambiente local

Na raiz do monorepo:

```sh
pnpm install
pnpm dev
```

O script de desenvolvimento chama `db:setup` antes de iniciar o Next.js.
O setup é idempotente: gera `.env.local` se necessário, aplica o esquema do Better
Auth e as migrações de `db/migrations/` em ordem. O arquivo SQLite é criado em
`.data/k5.sqlite` dentro deste app. Não há conta ou senha padrão.

### Variáveis

| Variável | Uso |
| --- | --- |
| `BETTER_AUTH_URL` | Origem confiável; padrão local `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Segredo de pelo menos 32 caracteres, gerado aleatoriamente pelo setup local |
| `DATABASE_PATH` | Arquivo SQLite; caminho relativo ao diretório deste app |
| `SESSION_IDLE_SECONDS` | Expiração deslizante por inatividade; padrão 28800 (8 horas), mínimo 60 |
| `K5_CREDENTIALS_KEY` | Chave mestra (32 bytes, base64) das credenciais de IA; gerada pelo setup somente em desenvolvimento |
| `K5_CREDENTIALS_PREVIOUS_KEYS` | Chaves anteriores aceitas somente para leitura durante a rotação |
| `VAULT_OCR_URL`, `VAULT_OCR_TOKEN` | Serviço externo de OCR opcional; sem ele, PDFs escaneados usam Tesseract local |

Não versione `.env.local` ou `.data/`. Para trocar a porta ou hostname, ajuste
`BETTER_AUTH_URL` também. Em produção, configure segredos pelo ambiente e execute
as migrações explicitamente; não use o gerador local de segredos.

## Autenticação

- `/api/auth/[...all]` hospeda os endpoints do Better Auth.
- Cadastro exige nome, escritório, e-mail e senha de 8 a 128 caracteres.
- Após cadastro ou login, `/app` leva ao Início em `/app/command-center`.
- O servidor valida a sessão no layout e em cada página protegida.
- Senhas usam o hash scrypt do Better Auth. Cookies são HttpOnly, SameSite=Lax e
  Secure quando a origem usa HTTPS.
- Sessões são verificadas no banco, sem cache de cookie, para revogação imediata.
- A navegação renova a sessão e o cookie; não existe polling que prolongue
  artificialmente a sessão de um usuário inativo.
- `Sair` revoga todas as sessões do usuário e limpa o cookie atual.
- Login e cadastro têm limite de tentativas persistido no SQLite. Sem IP confiável
  no runtime, o Better Auth usa um limite compartilhado por endpoint. Ao configurar
  o proxy de produção, defina os proxies/cabeçalhos de IP confiáveis antes de escalar.

## Modelo inicial

O Better Auth mantém `user`, `account`, `session`, `verification` e `rateLimit`.
`user.officeName` guarda o nome informado no cadastro para permitir retomar a
criação do escritório após uma interrupção; o nome oficial fica em `office.name`.

`office_member` relaciona usuário e escritório com chaves estrangeiras e papel:
`administrator`, `lawyer` ou `reviewer`. O primeiro usuário é administrador. Nesta
fase, cada usuário tem um único escritório. O provisionamento é idempotente e a
criação de escritório/vínculo é atômica.

`requireWorkspace()` deriva usuário e escritório da sessão. `findOfficeForUser()`
sempre filtra a consulta pelo usuário, inclusive quando recebe um ID de escritório.
Novas tabelas de negócio deverão exigir `office_id`, e novas operações deverão
usar esse contexto autenticado e verificar o papel correspondente.

O papel `reviewer` apenas consulta Cofre e documentos. Convites, recuperação de senha e
verificação de e-mail ainda não foram implementados.

## IA e documentos

O plano está em [`docs/plano-ia-mvp.md`](../../docs/plano-ia-mvp.md).

- **Plataforma:** `/platform/clients` gerencia conexões de IA por escritório (OpenAI,
  Anthropic, Google, DeepSeek, Inception, OpenRouter e AI Gateway) e modelos por tarefa
  (conversa, extração, redação). O roteador de modelos do Mastra resolve endpoint e
  protocolo de cada provider, e a lista de modelos sugeridos vem do registro dele; um ID
  fora da lista pode ser digitado. O acesso vem da
  tabela `platform_admin`, independente do papel no escritório, e só é concedido pela linha
  de comando: `pnpm platform:admin grant --email usuario@exemplo.com` (`revoke` retira).
  Chaves ficam cifradas com AES-256-GCM e nunca voltam ao navegador; operações são auditadas.
- **Rotação da chave mestra:** siga os comentários de `.env.example` e execute
  `pnpm platform:admin rotate-key --email <administrador da plataforma>`.
- **Cofre (`/app/vault`):** casos e biblioteca; PDF (com OCR), DOCX, EML, XLSX, CSV e TXT
  com referências estáveis por página, parágrafo, mensagem ou célula.
- **Agentes (`/app/agents`):** conversa com histórico por usuário, usando somente os
  documentos selecionados; cronologia e minuta rodam como tarefas duráveis e abrem no
  editor em `/app/documents/[id]`, com exportação DOCX no timbrado do modelo.
- **Worker:** processamento de documentos, cronologias e minutas roda fora da requisição.
  Em outro terminal, execute `pnpm worker` na raiz. Sem ele, os itens ficam na fila.
- **Infraestrutura judicial (fundação):** vínculo de processos, coleta de publicações,
  proveniência e caixa interna de eventos. A coleta roda em um worker próprio,
  `pnpm judicial:worker`, separado do worker de documentos porque OCR e coleta competem por
  recursos diferentes. Nenhuma fonte contata um tribunal antes de ser habilitada por um
  operador; veja [a nota de implementação](../../docs/infra-judicial-implementacao.md).

## Verificação

```sh
pnpm --filter @k5/web test
pnpm --filter @k5/web lint
pnpm --filter @k5/web typecheck
pnpm --filter @k5/web build
```

Os testes usam os endpoints reais do Better Auth e SQLite em memória para validar
autorização da plataforma, isolamento de credenciais, histórico de conversas, cronologia,
exportação DOCX, cadastro, senha, duplicidade, isolamento de escritórios, tentativa de injetar papel,
expiração, renovação, cookies forjados, logout global, origem e limite de tentativas.

O comando de produção é `pnpm --filter @k5/web start`, após setup e build.
A UI usa fontes do sistema e não precisa baixar fontes durante o build.
