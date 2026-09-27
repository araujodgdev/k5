# @k5/web

Next.js App Router com Better Auth, PostgreSQL, TypeScript e Tailwind CSS.

O produto se chama **Tises**. Identificadores técnicos existentes — como o pacote
`@k5/web`, variáveis `K5_*`, capabilities `k5_*` e nomes de recursos de infraestrutura —
permanecem estáveis por compatibilidade e não aparecem como marca na interface.

## Ambiente local

Na raiz do monorepo:

```sh
pnpm install
pnpm dev
```

O script de desenvolvimento chama `db:setup` antes de iniciar o Next.js.
Configure DATABASE_URL em .env.local antes de iniciar. O setup aplica db/postgres/*.sql com transação, lock e checksum; ele preserva segredos. Não há conta ou senha padrão. Veja [PostgreSQL e Hyperdrive](../../docs/migracao-postgres.md).

### Variáveis

| Variável | Uso |
| --- | --- |
| `BETTER_AUTH_URL` | Origem confiável; padrão local `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Segredo de pelo menos 32 caracteres, gerado aleatoriamente pelo setup local |
| `DATABASE_URL` | PostgreSQL transacional para Next.js e workers Node |
| `DATABASE_URL_UNPOOLED` | Endpoint direto para migrações e importação |
| `RESEARCH_STORAGE_PATH` | Diretório dos originais públicos do acervo; padrão `.data/research-objects` |
| `SESSION_IDLE_SECONDS` | Expiração deslizante por inatividade; padrão 28800 (8 horas), mínimo 60 |
| `K5_CREDENTIALS_KEY` | Chave mestra (32 bytes, base64) das credenciais de IA; gerada pelo setup somente em desenvolvimento |
| `K5_CREDENTIALS_PREVIOUS_KEYS` | Chaves anteriores aceitas somente para leitura durante a rotação |
| `K5_CREDENTIALS_NEXT_KEY` | Nova chave preparada para [rotação em duas etapas](../../docs/rotacao-credenciais.md), mantendo a atual disponível para leitura |
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
- Login e cadastro têm limite de tentativas persistido no PostgreSQL. Sem IP confiável
  no runtime, o Better Auth usa um limite compartilhado por endpoint. Ao configurar
  o proxy de produção, defina os proxies/cabeçalhos de IP confiáveis antes de escalar.
  Na Cloudflare usa-se `cf-connecting-ip`; fora dela, `K5_CLIENT_IP_HEADER` nomeia o
  cabeçalho que o seu proxy sobrescreve.

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

A [integração Google](../../docs/integracao-google.md) é opcional e usa OAuth independente
do login. A aba Google pessoal sincroniza calendários escolhidos; a agenda do escritório
continua separada. `/app/email` acessa Gmail; `/app/integrations` conecta cada serviço e reúne
as regras do administrador em uma aba própria. O Cofre seleciona arquivos Drive e importa cópias
para a Biblioteca, caso ou pasta abertos, com procedência. Execute `pnpm integrations:worker`
localmente; em Cloudflare, o Worker dedicado faz Calendar e os processadores Node fazem
importações e reconciliação de Gmail/Drive/Docs. Sem OAuth configurado a interface informa
o estado indisponível. Migrações aditivas: `db/postgres/0014` a `0019`, incluindo importação
para a Biblioteca (`0018`) e classificação de e-mails (`0019`).

As opções inteligentes de `/app/email` (`src/lib/google/gmail/insights.ts`) resumem a caixa de
entrada do dia, da semana ou do mês e, dentro de uma conversa, dão um panorama e sugerem
respostas. Leem só a caixa da própria pessoa, pela conexão dela, e não alteram o Gmail. O Jev
(TypeSafe, modo e-mail ativado) julga prioridade, se a mensagem pede resposta e que tipos de
resposta cabem; o `gpt-6-luna` escreve o texto a partir desses julgamentos. Sem conexão OpenAI na
plataforma, usa o modelo de extração; sem o Jev, o resumo funciona sem esses julgamentos. O que é
gerado não é gravado: fica só na tela aberta. O HTML das mensagens chega apenas ao leitor, num
iframe isolado (sem scripts, sem formulários, imagens externas bloqueadas até a pessoa pedir),
por uma rota própria (`/api/integrations/google/mail-thread`); o agente continua recebendo só texto.

`/app/agenda` reúne tarefas, calendário com agenda do dia e CRM de
clientes. A migração `0012_agenda.sql` adiciona clientes, vínculos com casos e atividades.
Dados de clientes existentes nos casos do Cofre são preservados, sem importação automática.
O cadastro de cliente aceita endereço, cidade, UF, CEP e áreas jurídicas (cível, trabalhista,
previdenciário; mais de uma é permitida), todos opcionais. A lista filtra por área.

Administrador e advogado podem cadastrar e editar; revisor apenas consulta. Referências
a clientes, casos e responsáveis são verificadas no escritório autenticado. Atualizações
exigem a versão lida; tarefas concluídas e reuniões canceladas permanecem no histórico.
Tarefas usam datas civis opcionais; reuniões exigem início e fim com offset, persistidos em
UTC e apresentados no fuso do navegador. Não há cálculo automático de prazos judiciais.

As capacidades `k5_crm_*` e `k5_agenda_*` usam o mesmo executor da interface,
Mastra e WebMCP. O Tises cria, altera, conclui e reagenda atividades direto, com o
papel e o escritório da sessão; WebMCP continua preparando sugestões por `k5_agenda_interpret`.
Ações de alto impacto pedidas pelo Tises (excluir caso, documento, pasta ou conversa, vincular,
desvincular ou consultar um tribunal, sobrescrever uma minuta) viram uma proposta em
`capability_approval` e só rodam quando a pessoa aperta **Confirmar** no chat
(`/api/chat/approvals/[id]`), com exatamente os argumentos propostos.

Com modelos OpenAI ou Anthropic, o Tises tem a busca na web do próprio provedor. Com os demais
(Gemini inclusive, que não combina Google Search com ferramentas), `web_search` usa o Exa quando
`EXA_API_KEY` está configurada; só a consulta sai do escritório, e as páginas devolvidas entram na
conferência de citações. Sem a chave, esses modelos ficam sem busca na web. Em pedidos de
jurisprudência o modelo pesquisa com a própria `web_search` e envia os julgados encontrados a
`k5_research_score_jurisprudence`: o Jev (modo **Pesquisa** em `/app/admin/ai`) mede a aderência de
cada um ao caso (0 a 4) e se a página é decisão judicial, e o código confere se o link veio de uma
busca da conversa. Nada é descartado: o Tises apresenta cada julgado com a confiabilidade (alta,
média, baixa ou não avaliada) e o motivo.

Cada turno do chat roda fora da requisição que o pediu (`src/lib/chat-turn.ts`). No Cloudflare, o
Durable Object `LumeChatRun` (binding `CHAT_RUNS`, um por conversa) executa o agente até o fim e
guarda a resposta; fechar a página não interrompe mais o Tises. Ao reabrir a conversa, o chat se
reconecta ao turno em andamento por `/api/chat/[id]/stream`, e **Parar** chama `/api/chat/[id]/stop`.
Em Node (`pnpm dev`) e no preview, sem o binding, o próprio processo mantém o turno.

O módulo **Pesquisa** (`/app/research`) busca sempre na web pelo Exa, no tipo escolhido pela pessoa
(instantânea, rápida, automática ou profunda), e exige `EXA_API_KEY`. Cada busca fica em
`research_web_search`, visível só para quem a fez, e reabre pelo Histórico sem nova consulta.
O microfone do composer grava, mostra o nível do áudio e, ao parar, envia a gravação para
`/api/chat/transcribe`; a transcrição vira a mensagem da pessoa. Modelos OpenAI transcrevem com a
chave do escritório (`gpt-4o-mini-transcribe`); Gemini transcreve o próprio áudio. O áudio não é guardado.
O Tises tem uma memória de trabalho por pessoa e escritório (Mastra Memory, tabelas `mastra_*` da
migração 0023, sem criar tabelas em tempo de execução). Ela guarda preferências e o que a pessoa
pediu para lembrar, e acompanha as conversas seguintes. `k5_memory_get` mostra e `k5_memory_clear`
apaga a memória (`/api/agent/memory`). O histórico das conversas continua só em `ai_conversation`.
Resultados de ferramentas com texto de terceiros (Gmail, Google Docs, publicações judiciais,
jurisprudência e busca na web) passam pelo `PromptInjectionDetector` do Mastra, com o modelo de
extração, antes de o modelo lê-los. Se houver instruções dirigidas ao assistente, o conteúdo é
retido e o Tises avisa a pessoa (`src/lib/agent-guard.ts`).
Rotas autenticadas ficam em `/api/agenda/[resource]/[operation]`;
escritas verificam origem e papel. Chaves de idempotência evitam criação duplicada em
repetições, inclusive simultâneas. `k5_ui_open_resource` abre agenda, cliente e atividade.
O botão **Atualizar** recarrega alterações realizadas pelo agente ou por outro integrante.

Escopo e próximas etapas: [plano de Tarefas e Agenda](../../docs/plano-tarefas-agenda.md).

## IA e documentos

O plano está em [`docs/plano-ia-mvp.md`](../../docs/plano-ia-mvp.md).

Para validar regressões do editor, com o servidor local em execução e uma conta de
teste já provisionada, execute da raiz:

```sh
pnpm --filter @k5/web exec playwright test -c playwright.documents.config.ts
pnpm --filter @k5/web exec tsx scripts/verify-document-live.ts
```

`E2E_EMAIL` e `E2E_PASSWORD` permitem usar outra conta de teste existente. A suíte
usa o editor real e respostas controladas da API para reproduzir conflitos e
falhas de salvamento. O segundo comando usa o modelo configurado pelo administrador,
cria um documento de teste, salva, exporta DOCX e confere o painel móvel; exige a
conexão de IA ativa. Capturas, vídeo e DOCX ficam em `playwright-report/pr11-live/`.
Esse fluxo termina com logout pela interface, revogando as sessões dessa conta.

- **Administração:** módulo `/app/admin`, visível só para administradores da plataforma, com
  as abas Feedback, Clientes, IA e Credenciais. A aba IA (`/app/admin/ai`) configura uma vez,
  para todos os escritórios, as conexões de IA da plataforma (OpenAI, Anthropic, Google,
  DeepSeek, Inception, OpenRouter e AI Gateway) e a TypeSafe. O administrador escolhe o modelo
  do Tises para conversas, extração e redação, pela lista ou digitando o ID; o modelo de
  embeddings também é da plataforma, e trocá-lo reindexa o Cofre de todos os escritórios.
  A migração 0022 adotou as conexões do escritório configurado por último; as conexões antigas
  por escritório ficam guardadas, mas não são mais lidas. Clientes é a lista de escritórios.
  O roteador do Mastra resolve endpoint e protocolo do provedor. O usuário do escritório não
  escolhe nem vê o modelo no chat. O acesso à configuração vem da
  tabela `platform_admin`, independente do papel no escritório, e só é concedido pela linha
  de comando: `pnpm platform:admin grant --email usuario@exemplo.com` (`revoke` retira).
  Chaves ficam cifradas com AES-256-GCM e nunca voltam ao navegador; operações são auditadas.
  Conexões OpenAI enviam `reasoningEffort: 'xhigh'` em chat, geração estruturada e teste
  de credencial. O modelo escolhido precisa aceitar esse esforço; não há redução silenciosa.
- **Rotação da chave mestra:** siga os comentários de `.env.example` e execute
  `pnpm platform:admin rotate-key --email <administrador da plataforma>`.
- **Cofre (`/app/vault`):** casos e biblioteca; PDF (com OCR), DOCX, EML, XLSX, CSV e TXT
  com referências estáveis por página, parágrafo, mensagem ou célula.
- **Anexos da petição:** na aba **Anexos** do caso, a pessoa escolhe o PDF digitalizado com todos
  os documentos (já lido pelo OCR) e a petição (arquivo do caso ou texto colado). O modelo do
  escritório propõe os documentos e as páginas; o código ordena pela primeira citação na petição
  e deixa desmarcados os não citados. Depois da revisão, `pdf-lib` recorta os intervalos e salva
  cada anexo numa nova pasta do caso, numerado e sem acentos (`01_procuracao.pdf`). Nada é gerado
  sem confirmação; o Tises usa as mesmas capacidades (`k5_vault_plan_annexes`, `k5_vault_generate_annexes`).
- **Tises (`/app/agents`):** conversa com histórico por usuário. O botão **+** envia documentos
  e imagens privados para a conversa, com prévia, remoção antes do envio e acesso no histórico.
  Aceita até seis anexos por mensagem, escolhidos de uma vez, com documentos de até 25 MB e imagens de até 10 MB. Eles não criam documentos no Cofre.
  **Fontes** seleciona arquivos existentes do Cofre e referências do caso. Cronologia e minuta rodam como tarefas duráveis e abrem no
  editor em `/app/documents/[id]`, com exportação DOCX no timbrado do modelo.
- **Câmera:** **+ → Tirar foto** abre a câmera do dispositivo após a permissão do navegador,
  permite conferir ou repetir a foto e a anexa à mensagem. Exige HTTPS (ou localhost) e um
  modelo com visão. A alternativa **Escolher foto** permanece disponível quando a câmera
  não pode ser aberta. Para listas fotografadas, o Tises prepara uma sugestão de Agenda por
  item solicitado; a pessoa confere os campos e salva na Agenda.
- **Worker:** processamento de documentos, cronologias e minutas roda fora da requisição.
  Em outro terminal, execute `pnpm worker` na raiz. Sem ele, os itens ficam na fila.
- **TypeSafe/Jev:** uma única conexão da plataforma atende todos os escritórios; configure-a
  em `/app/admin/ai`. O custo é da plataforma e a reserva diária de tokens soma todos os
  escritórios. Enquanto nenhuma conexão da plataforma for salva, a primeira leitura adota a
  conexão de escritório mais recente que tenha chave (bancos migrados ou importados continuam
  funcionando sem redigitar a chave). Reranking do Cofre e da Pesquisa, avaliação de pertinência,
  verificação documental, sugestões da Agenda e triagem de feedback possuem modos independentes:
  desligado, avaliar sem aplicar e ativado. A triagem de feedback começa ativada; as demais, desligadas.
  A chave usa a mesma cifra/rotação das demais conexões; não existe chave global
  de produção em variável de ambiente. Jev não é um modelo de conversa do Tises.
  A verificação documental roda no worker e nunca aprova uma minuta automaticamente.
  Veja [operação e validação TypeSafe](../../docs/typesafe-implementacao.md).
- **Feedback:** o ícone de inseto ao lado de Instalar abre um diálogo para qualquer papel do
  escritório: problema ou melhoria, onde aconteceu (pré-selecionado pela tela atual), o texto e uma
  imagem opcional (até 5 MB). O que a pessoa escolheu fica guardado à parte e serve de pista ao
  worker, que classifica cada relato com o TypeSafe (tipo, módulo, gravidade de problemas,
  relevância de melhorias, sinais de segurança e de dados pessoais); a prioridade é calculada em
  código e a confiança baixa marca o ticket para revisão. Sem TypeSafe, o ticket chega com o tipo e o
  módulo informados. A fila fica em `/app/admin/feedback`, ordenada por prioridade e impacto;
  resolver um ticket notifica o autor, que vê a resposta em "Seus relatos", no mesmo diálogo. Correções manuais nunca apagam a resposta do modelo.
- **Infraestrutura judicial (fundação):** vínculo de processos, coleta de publicações,
  proveniência e caixa interna de eventos. A coleta roda em um worker próprio,
  `pnpm judicial:worker`, separado do worker de documentos porque OCR e coleta competem por
  recursos diferentes. Nenhuma fonte contata um tribunal antes de ser habilitada por um
  operador; veja [a nota de implementação](../../docs/infra-judicial-implementacao.md).

## Pesquisa de jurisprudência

`/app/research` consulta o acervo de julgados por tema e pode solicitar páginas da fonte TJDFT
quando uma instalação apta estiver habilitada. A pesquisa, os jobs e o perfil do caso pertencem
ao escritório e ao usuário; julgados e materiais oficiais admitidos formam o acervo público
compartilhado. O revisor lê o acervo, enquanto administrador e advogado podem iniciar coleta,
avaliar pertinência e vincular versões de material a casos. A busca pelo tema no STJ usa os
recursos já ingeridos no acervo; ela não consulta o CKAN a cada pesquisa de usuário.

Em desenvolvimento local, rode `pnpm db:setup`, `pnpm judicial:worker` para consultas e downloads,
e `pnpm worker` para extrair PDFs, OCR e avaliar materiais. O worker judicial também atende o DJEN;
nenhuma instalação nova acessa a rede só por estar cadastrada. O operador registra uma ficha
com as condições de consulta, cache e redistribuição, habilita a instalação e só depois libera
`--live` quando as condições necessárias estiverem documentadas. Documentos e envio à IA têm
permissões próprias. Sem fonte temática habilitada, a tela mostra os resultados conhecidos do
acervo e informa que a consulta externa não ocorreu.

```sh
pnpm judicial:admin register --file db/sources/tjdft.example.json
pnpm judicial:admin list
# Após documentar as condições de uso na ficha e registrá-la novamente:
pnpm judicial:admin enable <id> --live
pnpm judicial:worker
pnpm worker
```

Para o STJ, o operador descobre recursos CKAN e escolhe explicitamente cada recurso a ingerir:

```sh
pnpm judicial:admin register --file db/sources/stj-ckan.example.json
# Após documentar as condições de uso na ficha e registrá-la novamente:
pnpm judicial:admin enable <id> --live
pnpm judicial:admin stj-discover <id> --dataset espelhos-de-acordaos-segunda-turma --email <admin-da-plataforma>
pnpm judicial:admin stj-enqueue <id> --dataset <slug> --resource <UUID CKAN> --email <admin-da-plataforma>
pnpm judicial:worker
```

Espelho e inteiro teor STJ só são associados mediante evidência explícita:

```sh
pnpm judicial:admin stj-link <id> --mirror-id <ID-nativo> --document-id <SeqDocumento> --evidence <URL-oficial> --note <justificativa> --email <admin-da-plataforma>
```

Os recursos têm limite
de 50 MB e ingestão em lotes com checkpoint. Arquivos originais, hashes e versões ficam em
`RESEARCH_STORAGE_PATH`; no Docker, `web`, `worker` e `judicial-worker` compartilham
`/data/research-objects` e o mesmo PostgreSQL. Na Cloudflare, originais da Pesquisa usam o bucket R2 `VAULT`, com prefixo `research/`. O comando `docker compose down` preserva o volume.
`stj-enqueue ... --force` permite reprocessar um recurso de mesmo hash após registrar um vínculo;
nenhum vínculo entre espelho e inteiro teor é inferido pelo número do processo.
Para regras de fonte, limites, aceite e lacunas do piloto, veja
[o plano da Pesquisa](../../docs/plano-pesquisa-jurisprudencia.md).

## PWA e temas

O seletor **Tema** oferece **Sistema**, **Claro** e **Escuro** na tela de acesso,
no rodapé da sidebar, em **Mais** no celular e no cabeçalho da plataforma.
A escolha fica neste navegador e acompanha as outras abas; **Sistema** segue as
mudanças de aparência do dispositivo. A preferência é aplicada antes da hidratação.

Use **Instalar Tises** para instalar em navegadores compatíveis. No iPhone/iPad, use
Safari → Compartilhar → Adicionar à Tela de Início. O manifesto define abertura em
janela própria, ícones normais/maskable e atalhos para Tises, Cofre e Agenda.
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

## Plano e pagamentos (AbacatePay)

Cada escritório paga uma mensalidade em **Plano** (`/app/billing`). Só administradores pagam; os
demais papéis veem a situação. O pagamento usa o checkout hospedado da AbacatePay (PIX ou cartão):
`POST /api/billing/checkout` cria (uma vez) o produto `tises-plano-mensal-<centavos>` e o cliente
na AbacatePay e devolve a URL do checkout. Um checkout pendente dos últimos 30 minutos é reaproveitado,
inclusive quando chegam pedidos simultâneos do mesmo escritório (lock transacional no PostgreSQL).
Cada pagamento confirmado soma um mês a `office_billing.paid_until`, a partir do fim do prazo
atual quando o plano ainda está ativo; um reembolso remove exatamente o mês daquele pagamento
(migração 0026). Por enquanto nada é bloqueado sem pagamento.

A confirmação chega por dois caminhos, e o mês é creditado uma única vez: o webhook
`POST /api/billing/webhook` (confere o `webhookSecret` da URL e a assinatura HMAC do corpo,
e ignora entregas repetidas pelo `id`) e a própria página Plano, que consulta os checkouts
pendentes ao abrir. Por isso o fluxo também funciona localmente, onde nenhum webhook chega.

Configure `ABACATEPAY_API_KEY` (a chave de Dev mode simula pagamentos; use o cartão
`4242 4242 4242 4242`), `ABACATEPAY_WEBHOOK_SECRET` e, se quiser, `BILLING_PLAN_PRICE_CENTS`
(padrão R$ 199,00). Cadastre o endpoint HTTPS público
`<BETTER_AUTH_URL>/api/billing/webhook`, informe o mesmo segredo no campo `secret` da AbacatePay
e assine os eventos `checkout.completed` e `checkout.refunded`. O provedor acrescenta
`?webhookSecret=<secret>` nas entregas.

O staging usa `https://k5-staging.k5-web.workers.dev/api/billing/webhook`, com a chave de
**Dev mode** e os dois segredos no Worker Cloudflare. A validação de PIX, cartão e webhook está
registrada em [validação AbacatePay](../../docs/validacao-abacatepay.md). Isso não habilita cobranças
reais: produção exige chave e webhook próprios no ambiente de produção da AbacatePay.

### Administração financeira

`/app/admin/finance` reúne somente cobranças criadas pelo Tises, com filtros de cliente, período,
situação e ambiente. Testes e produção ficam separados; os totais são brutos, antes das taxas,
e o valor após reembolsos não representa saldo disponível na AbacatePay. A lista de Clientes abre
`/app/admin/clients/[officeId]`, com histórico paginado, comprovantes, assinaturas e ações auditadas.

Administradores **da plataforma** podem gerar/copiar um link avulso ou de assinatura mensal,
reembolsar integralmente um avulso pago, atualizar as cobranças e cancelar a renovação de uma
assinatura ativa. As mutações verificam sessão, papel de plataforma, origem e vínculo do recurso
com o escritório. O responsável selecionado precisa ser administrador daquele escritório;
o cadastro de cobrança existente é reutilizado. Não há envio automático de mensagens.

A assinatura usa o produto `tises-assinatura-mensal-<centavos>`, com `cycle: MONTHLY`, e checkout
no cartão. Só fica ativa após a adesão do cliente. Não se abre outro link enquanto houver assinatura
ativa ou aguardando adesão. O cancelamento preserva o prazo pago; retomar requer nova adesão.
Reembolso de assinatura **não é suportado pela API v2**. As migrações 0027/0028 distinguem os IDs
do checkout (`bill_`), assinatura (`subs_`) e pagamentos; múltiplas adesões ao mesmo link são
registradas separadamente. Solicitações de reembolso/cancelamento são gravadas antes do envio;
em caso de timeout, o botão de atualização consulta o resultado sem repetir a operação.

Permissões da chave: `CHECKOUT:CREATE`, `CHECKOUT:READ`, `SUBSCRIPTION:CREATE`,
`SUBSCRIPTION:READ`, `SUBSCRIPTION:DELETE`, `REFUND:CREATE`, `CUSTOMER:CREATE`,
`PRODUCT:CREATE`, `PRODUCT:READ`. Configuração de webhooks é feita separadamente; a chave do
aplicativo não precisa gerenciá-los. Nunca coloque a chave no frontend.

Além dos eventos avulsos, registre `subscription.completed`, `subscription.renewed`,
`subscription.cancelled` e `subscription.payment_failed` no mesmo endpoint/segredo. A renovação
depende desses eventos; a consulta ao voltar do checkout recupera apenas o primeiro pagamento.
Cada evento é associado a um checkout do Tises por consulta ao provedor, nunca pelo e-mail ou por
metadados enviados pelo cliente. Uma renovação soma um mês uma única vez, mesmo se a confirmação
chegar por mais de um caminho. Eventos atrasados não reativam uma assinatura cancelada.

A migração `0029_billing_checkout_reservation.sql` registra a identidade de criação antes de
contatar a AbacatePay. As chamadas externas não mantêm uma transação PostgreSQL aberta. Se a
resposta se perder ou a gravação local falhar, **Atualizar pagamentos**, o retorno à página Plano
ou um webhook recuperam o checkout pelo `externalId` persistido, sem repetir a criação.
Preparações interrompidas antes do envio podem ser retomadas após cinco minutos. Uma criação
já enviada não expira automaticamente: uma consulta sem resultado ainda pode ser temporária.

Pedidos de reembolso/cancelamento gravados, mas ainda não despachados, são retomados ao atualizar.
Depois da marca de despacho, o Tises somente consulta o resultado. Se a operação continuar
incerta, confira o ID da cobrança/assinatura no painel da AbacatePay antes de qualquer ação
manual; após confirmação no provedor, atualize novamente no Tises. Não apague registros de
auditoria nem libere uma tentativa incerta por tempo decorrido. Para uma criação sem resultado,
use o ID de `billing_checkout_reservation` como `externalId` na consulta ao provedor e encaminhe
essa referência ao suporte se a ambiguidade persistir. Um cancelamento necessário pode ser
concluído no painel do provedor após conferir o estado; a atualização importará a confirmação.

Links de assinatura pendentes são consultados mesmo após sete dias e só substituídos quando o
provedor confirma expiração/cancelamento. Uma falha de consulta de uma ação não impede a
reconciliação das demais; erros internos de banco ou programação continuam sendo propagados.

Referências: [assinaturas](https://docs.abacatepay.com/pages/subscriptions/get),
[eventos](https://docs.abacatepay.com/pages/webhooks/events/subscriptions),
[limites do reembolso](https://docs.abacatepay.com/pages/payment/refund).

## Observabilidade (Sentry)

Erros de navegador, Next.js, Workers Cloudflare e filas Node são enviados ao projeto
`lume-wr/lume`; traces usam amostragem de 10%, exceto as respostas do chat (`invoke_agent Tises chat`),
sempre enviadas, com um span por etapa do modelo e por ferramenta, inclusive a busca do provedor.
Desenvolvimento/testes ficam desativados por padrão. Veja [configuração, privacidade, source maps
e verificação](../../docs/sentry.md).

O conteúdo desses turnos não vai ao Sentry. Entradas e saídas das ferramentas, fontes das buscas,
avaliações do Jev e erros ficam em `agent_trace` e `agent_trace_event` (migração 0025), por
escritório, apagados com a conversa e varridos pelo worker após 30 dias. Administradores da
plataforma os consultam em **Administração → Execuções** (`/app/admin/traces`), com o link para o
trace correspondente no Sentry.

## Verificação

```sh
pnpm --filter @k5/web test
pnpm --filter @k5/web lint
pnpm --filter @k5/web typecheck
pnpm --filter @k5/web build
```

Os testes usam os endpoints reais do Better Auth e PostgreSQL com esquemas isolados para validar
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
