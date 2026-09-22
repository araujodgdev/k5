# @k5/web

Next.js App Router com Better Auth, SQLite, TypeScript e Tailwind CSS.

O produto se chama **Lume**. Identificadores técnicos existentes — como o pacote
`@k5/web`, variáveis `K5_*`, capabilities `k5_*` e nomes de recursos de infraestrutura —
permanecem estáveis por compatibilidade e não aparecem como marca na interface.

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
| `K5_VAPID_KEY_ID`, `K5_VAPID_SUBJECT`, `K5_VAPID_PUBLIC_KEY`, `K5_VAPID_PRIVATE_KEY` | Identidade Web Push persistente por ambiente; a chave privada fica somente no servidor/worker |

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

## Tarefas e Agenda

`/app/agenda` substitui Pesquisa e reúne tarefas, calendário com agenda do dia e CRM de
clientes. A migração `0012_agenda.sql` adiciona clientes, vínculos com casos e atividades.
Dados de clientes existentes nos casos do Cofre são preservados, sem importação automática.

Administrador e advogado podem cadastrar e editar; revisor apenas consulta. Referências
a clientes, casos e responsáveis são verificadas no escritório autenticado. Atualizações
exigem a versão lida; tarefas concluídas e reuniões canceladas permanecem no histórico.
Tarefas usam datas civis opcionais; reuniões exigem início e fim com offset, persistidos em
UTC e apresentados no fuso do navegador. Não há cálculo automático de prazos judiciais.

As capacidades `k5_crm_*` e `k5_agenda_*` usam o mesmo executor da interface,
Mastra e WebMCP. Agentes preparam sugestões por `k5_agenda_interpret`; criação,
alteração e confirmação de atividades ficam disponíveis somente na interface humana.
Rotas autenticadas ficam em `/api/agenda/[resource]/[operation]`;
escritas verificam origem e papel. Chaves de idempotência evitam criação duplicada em
repetições, inclusive simultâneas. `k5_ui_open_resource` abre agenda, cliente e atividade.
O botão **Atualizar** recarrega alterações realizadas pelo agente ou por outro integrante.

Escopo e próximas etapas: [plano de Tarefas e Agenda](../../docs/plano-tarefas-agenda.md).

## IA e documentos

O plano está em [`docs/plano-ia-mvp.md`](../../docs/plano-ia-mvp.md).

- **Plataforma:** `/platform/clients/[officeId]/ai` gerencia as conexões de IA por escritório
  (OpenAI, Anthropic, Google, DeepSeek, Inception, OpenRouter e AI Gateway). O administrador
  escolhe o modelo do Lume para conversas, extração e redação, pela lista ou digitando o ID.
  O roteador do Mastra resolve endpoint e protocolo do provedor. O usuário do escritório não
  escolhe nem vê o modelo no chat. O acesso à configuração vem da
  tabela `platform_admin`, independente do papel no escritório, e só é concedido pela linha
  de comando: `pnpm platform:admin grant --email usuario@exemplo.com` (`revoke` retira).
  Chaves ficam cifradas com AES-256-GCM e nunca voltam ao navegador; operações são auditadas.
- **Rotação da chave mestra:** siga os comentários de `.env.example` e execute
  `pnpm platform:admin rotate-key --email <administrador da plataforma>`.
- **Cofre (`/app/vault`):** casos e biblioteca; PDF (com OCR), DOCX, EML, XLSX, CSV e TXT
  com referências estáveis por página, parágrafo, mensagem ou célula.
- **Lume (`/app/agents`):** conversa com histórico por usuário, usando somente os
  documentos selecionados; cronologia e minuta rodam como tarefas duráveis e abrem no
  editor em `/app/documents/[id]`, com exportação DOCX no timbrado do modelo.
- **Worker:** processamento de documentos, cronologias e minutas roda fora da requisição.
  Em outro terminal, execute `pnpm worker` na raiz. Sem ele, os itens ficam na fila.
- **TypeSafe/Jev:** configure a conexão por escritório em `/platform/clients/[officeId]/ai`.
  Reranking do Cofre, verificação documental e sugestões da Agenda possuem modos
  independentes: desligado, avaliar sem aplicar e ativado. Todos começam desligados.
  A chave usa a mesma cifra/rotação das demais conexões; não existe chave global
  de produção em variável de ambiente. Jev não aparece no seletor de modelos do chat.
  A verificação documental roda no worker e nunca aprova uma minuta automaticamente.
  Veja [operação e validação TypeSafe](../../docs/typesafe-implementacao.md).
- **Infraestrutura judicial (fundação):** vínculo de processos, coleta de publicações,
  proveniência e caixa interna de eventos. A coleta roda em um worker próprio,
  `pnpm judicial:worker`, separado do worker de documentos porque OCR e coleta competem por
  recursos diferentes. Nenhuma fonte contata um tribunal antes de ser habilitada por um
  operador; veja [a nota de implementação](../../docs/infra-judicial-implementacao.md).

## PWA e temas

O seletor **Tema** oferece **Sistema**, **Claro** e **Escuro** na tela de acesso,
no rodapé da sidebar, em **Mais** no celular e no cabeçalho da plataforma.
A escolha fica neste navegador e acompanha as outras abas; **Sistema** segue as
mudanças de aparência do dispositivo. A preferência é aplicada antes da hidratação.

Use **Instalar Lume** para instalar em navegadores compatíveis. No iPhone/iPad, use
Safari → Compartilhar → Adicionar à Tela de Início. O manifesto define abertura em
janela própria, ícones normais/maskable e atalhos para Lume, Cofre e Agenda.
Instalação e service worker exigem HTTPS em produção (localhost funciona para testes).

O service worker é registrado somente no build de produção. O build gera
`public/sw.js` a partir de `scripts/service-worker.js`, com uma versão nova a cada
build; o Turborepo restaura esse arquivo junto com os demais artefatos. Não edite
o arquivo gerado. Para recriar os ícones a partir da marca vetorial, execute
`pnpm --filter @k5/web exec tsx scripts/generate-pwa-icons.ts` na raiz.

O cache contém somente recursos públicos: tela offline, ícones e arquivos estáticos
do Next.js. Páginas autenticadas, respostas RSC, APIs, documentos e operações de
escrita não são armazenados nem repetidos em segundo plano. Sem conexão, uma página
já aberta mostra um aviso; uma nova navegação completa mostra **Você está sem conexão**
com **Tentar novamente**. Trabalhar com os dados do escritório exige internet.
Notificações usam o mesmo service worker e nunca armazenam dados do escritório no Cache Storage.
O payload exibido na tela bloqueada é genérico; abrir o aviso volta ao servidor para revalidar a
sessão, o destinatário e o acesso ao registro de origem.

## Notificações

`/app/notifications` oferece uma caixa pessoal, leitura independente por integrante, preferências,
horário de silêncio e adesão Web Push por dispositivo. A caixa funciona sem permissão de push.
Alterações relevantes da Agenda são gravadas na mesma operação atômica da atividade; lembretes de
tarefas usam 09:00 da data civil no fuso salvo, e reuniões usam 30 minutos antes do instante UTC.

Em desenvolvimento ou Docker, rode `pnpm notifications:worker`. O processo aceita `--once` no
script do workspace web. Em Cloudflare, `wrangler.notifications.jsonc` define um Worker separado,
Cron por minuto e Queue; os secrets VAPID devem ser configurados nesse Worker. O banco continua a
fonte de verdade, e o Cron recupera dicas de fila perdidas. A entrega aceita pelo provedor não
significa exibição nem leitura e não substitui o acompanhamento de prazos.

Uma nova versão aguarda a ação **Atualizar agora**. Salve alterações antes de aceitar;
outras abas não são recarregadas automaticamente. Os caches de versões anteriores
são preservados enquanto houver clientes abertos, e arquivos estáticos com hash
podem ser lidos desses caches mesmo se já tiverem saído do servidor. A limpeza ocorre
somente em uma ativação sem clientes; não há limite por idade ou quantidade de versões
que possa interromper uma aba antiga. A tela offline e os ícones usam a versão atual.
Recursos nunca armazenados ainda dependem do servidor e da retenção dos arquivos no deploy.
O servidor entrega `/sw.js` sem
cache HTTP. Preserve esse comportamento no proxy/CDN.

Para validar, rode `pnpm db:setup`, `pnpm build` e `pnpm --filter @k5/web start`.
No navegador, confira Application → Manifest e Service Workers; após a primeira
visita online, simule modo offline e recarregue uma rota de `/app`. Confira que o
Cache Storage contém apenas recursos públicos e teste **Tentar novamente** ao reconectar.
O teste de navegador pode ser repetido com
`pnpm --filter @k5/web exec tsx scripts/verify-pwa.ts` contra esse servidor local.
Com `PWA_TEST_UPDATE=1`, o teste também simula uma nova versão local e confirma que
outra aba mantém seu formulário. O arquivo gerado é restaurado ao final.
O teste isolado `pnpm --filter @k5/web exec tsx scripts/verify-pwa-update.ts` inicia
um servidor temporário e verifica duas atualizações com abas abertas: remove os JS/CSS
antigos do servidor e confirma carregamento pelo cache, sem perder o formulário.

## Observabilidade (Sentry)

Erros de navegador, Next.js, Workers Cloudflare e filas Node são enviados ao projeto
`lume-wr/lume`; traces usam amostragem de 10%. Desenvolvimento/testes ficam desativados por
padrão. Veja [configuração, privacidade, source maps e verificação](../../docs/sentry.md).

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
A UI usa Inter e Newsreader, baixadas por `next/font/google` durante o build e
servidas pela própria aplicação. A variante itálica da Newsreader só é carregada
pelo navegador quando usada; as variantes normais recebem preload.

## Visão geral e validação de interface

O Início reúne tarefas pendentes até hoje, próximas reuniões, clientes ativos, casos e conversas pessoais. Permite concluir tarefas e abrir os formulários existentes. As visões da agenda aceitam `?view=tasks`, `?view=calendar` e `?view=clients`; `action=new` abre o cadastro correspondente para quem pode editar. Clientes têm uma página própria em `/app/agenda/clients/[id]`.

Com o servidor local em execução, rode `pnpm --filter @k5/web exec tsx scripts/verify-workspace-ui.ts` na raiz. O script reutiliza a conta de validação (ou `PWA_TEST_EMAIL` / `PWA_TEST_PASSWORD`), intercepta dados de negócio com fixtures e não cadastra contas nem altera os registros do escritório. Confere menu Mais, chat longo, retorno ao fim, calendário, Início e detalhes de cliente em desktop/mobile. Capturas ficam em `apps/web/playwright-report/workspace-ui/`.
