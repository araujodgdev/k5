# @k5/web

Next.js App Router com Better Auth, PostgreSQL, TypeScript e Tailwind CSS.

Pesquisa tem as modalidades Marcas e Jurisprudência. Novas pesquisas de marcas usam a automação do WIPO Global Brand Database por nome ou logotipo, inclusive no Brasil. A busca Web continua disponível ao agente. O acervo importado do INPI foi removido, junto com as pesquisas feitas nele (migração 0063). A execução e os limites estão em [Pesquisa de marcas](../../docs/implementacao-pesquisa-marcas.md).

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

## Escritórios e colaboração

O Better Auth mantém contas e sessões. `user.officeName` preserva o nome informado no cadastro; o nome oficial fica em `office.name`. `office_member` exige um usuário por escritório e um escritório por advogado, sem papel. O provisionamento é idempotente e atômico, serializado no usuário.

`requireWorkspace()` deriva o escritório da sessão. Dados de negócio usam `office_id` e acesso ao recurso, sem confiar em IDs do navegador. Administração da plataforma é separada.

**Associados**, **Convites** e **Atividade** ficam em Escritório. **Atividade** (`/app/agenda?view=activity`) junta as auditorias do escritório (processos, acessos a casos, Google, anúncios e buscas no Cofre), das mais recentes às mais antigas; a consulta fica em `src/lib/audit.ts` e lê cada tabela de origem, filtrada pelo escritório da sessão. O aceite cria associação mútua sem liberar arquivos. Só o dono inclui associados em **Participantes** de um caso. Todos colaboram na raiz; subpastas são públicas, privadas ou restritas. Só o criador muda seu acesso. Listas, busca, downloads, Lume e Pesquisa respeitam também as pastas acima. Encerrar a associação retira cada advogado dos casos do outro, preservando o conteúdo.

`0059_associate_access.sql` substitui os papéis e convites antigos. Antes de aplicá-la em ambiente existente, execute `pnpm --filter @k5/web db:migrate --check-associates`. Vínculos incompatíveis impedem a migração sem remoção automática de dados. Veja [colaboração e convites](../../docs/colaboracao.md).

Convites chegam à conta existente e oferecem um link. Endereços sem conta exigem esse link e login com o mesmo e-mail. Não há envio automático por e-mail. **Esqueci minha senha** abre `/recover-password`; o portal usa `/client/recover-password`. O link de uso único redefine a senha e revoga sessões. O envio depende da [configuração de mensagens](../../docs/mensagens.md); o cadastro ainda não verifica e-mail.

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
resposta cabem; o modelo das tarefas `summary.email_digest` e `summary.email_thread` escreve o texto a
partir desses julgamentos. Sem o Jev, o resumo funciona sem esses julgamentos. O que é
gerado não é gravado: fica só na tela aberta. O HTML das mensagens chega apenas ao leitor, num
iframe isolado (sem scripts, sem formulários, imagens externas bloqueadas até a pessoa pedir),
por uma rota própria (`/api/integrations/google/mail-thread`); o agente continua recebendo só texto.

`/app/agenda` reúne tarefas, calendário com agenda do dia e CRM de
clientes. A migração `0012_agenda.sql` adiciona clientes, vínculos com casos e atividades.
Dados de clientes existentes nos casos do Cofre são preservados, sem importação automática.
O cadastro de cliente aceita endereço, cidade, UF, CEP e áreas jurídicas (cível, trabalhista,
previdenciário; mais de uma é permitida), todos opcionais. A lista filtra por área.

O advogado cadastra e edita no próprio escritório. Referências
a clientes, casos e responsáveis são verificadas no escritório autenticado. Atualizações
exigem a versão lida; tarefas concluídas e reuniões canceladas permanecem no histórico.
Tarefas usam datas civis opcionais; reuniões exigem início e fim com offset, persistidos em
UTC e apresentados no fuso do navegador. Não há cálculo automático de prazos judiciais.

As capacidades `k5_crm_*` e `k5_agenda_*` usam o mesmo executor da interface,
Mastra e WebMCP. O Lume cria, altera, conclui e reagenda atividades direto, com o
acesso e o escritório da sessão; WebMCP continua preparando sugestões por `k5_agenda_interpret`.
Ações de alto impacto pedidas pelo Lume (excluir caso, documento, pasta ou conversa, vincular,
desvincular ou consultar um tribunal, sobrescrever uma minuta) viram uma proposta em
`capability_approval` e só rodam quando a pessoa aperta **Confirmar** no chat
(`/api/chat/approvals/[id]`), com exatamente os argumentos propostos.

Com modelos OpenAI, Anthropic ou CLIProxyAPI, o Lume tem a busca na web do próprio provedor. Com os demais
(Gemini inclusive, que não combina Google Search com ferramentas), `web_search` usa o Exa quando
`EXA_API_KEY` está configurada; só a consulta sai do escritório, e as páginas devolvidas entram na
conferência de citações. Sem a chave, esses modelos ficam sem busca na web. Em pedidos de
jurisprudência o modelo pesquisa com a própria `web_search` e envia os julgados encontrados a
`k5_research_score_jurisprudence`: o Jev (modo **Pesquisa** em `/app/admin/ai`) mede a aderência de
cada um ao caso (0 a 4) e se a página é decisão judicial, e o código confere se o link veio de uma
busca da conversa. Nada é descartado: o Lume apresenta cada julgado com a confiabilidade (alta,
média, baixa ou não avaliada) e o motivo.

Cada turno do chat roda fora da requisição que o pediu (`src/lib/chat-turn.ts`). No Cloudflare, o
Durable Object `LumeChatRun` (binding `CHAT_RUNS`, um por conversa) executa o agente até o fim e
guarda a resposta; fechar a página não interrompe mais o Lume. Ao reabrir a conversa, o chat se
reconecta ao turno em andamento por `/api/chat/[id]/stream`, e **Parar** chama `/api/chat/[id]/stop`.
Em Node (`pnpm dev`) e no preview, sem o binding, o próprio processo mantém o turno.

O módulo **Pesquisa** (`/app/research`) reúne Marcas e Jurisprudência, cada uma com seu histórico
pessoal. A busca pública na web continua disponível ao agente pela ferramenta `web_search`.
OpenAI e Anthropic usam a busca do provedor; modelos sem busca própria usam Exa com `EXA_API_KEY`.
O microfone do composer grava, mostra o nível do áudio e, ao parar, envia a gravação para
`/api/chat/transcribe`; a transcrição vira a mensagem da pessoa. A tarefa `transcription.voice_note`
decide o modelo: sem atribuição, segue o provider do Agente (`gpt-4o-mini-transcribe` numa conexão
OpenAI, o próprio áudio no Gemini, microfone desligado nos demais). O áudio não é guardado.
O Lume tem uma memória de trabalho por pessoa e escritório (Mastra Memory, tabelas `mastra_*` da
migração 0023, sem criar tabelas em tempo de execução). Ela guarda preferências e o que a pessoa
pediu para lembrar, e acompanha as conversas seguintes. `k5_memory_get` mostra e `k5_memory_clear`
apaga a memória (`/api/agent/memory`). O histórico das conversas continua só em `ai_conversation`.
Com `HONCHO_API_KEY`, o Lume também aprende com essa memória (`src/lib/honcho-memory.ts`, migração 0066).
Depois de cada turno, só as linhas novas da memória de trabalho vão para o Honcho, como declarações da
pessoa, por uma outbox com reconciliação por `event_id`; documentos, anexos, resultados de ferramentas e
a conversa não são enviados. Antes da resposta, o Lume lê o que o Honcho concluiu (até 1,5 s; sem
resposta, segue sem) e trata como contexto falível. `k5_memory_clear` também troca a geração da memória
e pede a exclusão do workspace antigo; excluir uma conversa pede a exclusão da sessão dela. O cron
reenvia o que ficou pendente. Sem a chave, nada é enviado e vale só a memória de trabalho.
Resultados de ferramentas com texto de terceiros (Gmail, Google Docs, publicações judiciais,
jurisprudência e busca na web) passam pelo `PromptInjectionDetector` do Mastra, com o modelo da
tarefa `classification.injection_guard`, antes de o modelo lê-los. Se houver instruções dirigidas ao assistente, o conteúdo é
retido e o Lume avisa a pessoa (`src/lib/agent-guard.ts`).
Rotas autenticadas ficam em `/api/agenda/[resource]/[operation]`;
escritas verificam origem e acesso. Chaves de idempotência evitam criação duplicada em
repetições, inclusive simultâneas. `k5_ui_open_resource` abre no canvas do escritório um caso, uma página do
Lume, um arquivo do Cofre, um cliente, uma atividade ou um módulo pelo nome (`src/lib/canvas-protocol.ts`).
O botão **Atualizar** recarrega alterações realizadas pelo agente ou por outro integrante.

Escopo e próximas etapas: [plano de Tarefas e Agenda](../../docs/plano-tarefas-agenda.md).

## CLIProxyAPI e conversas simultâneas

Em **Administração → IA → Conexões**, o administrador pode cadastrar **CLIProxyAPI (Lume)**
com uma chave própria desse serviço. A conexão usa exclusivamente `https://api.lume.software/v1`
pela API Responses. A chave fica cifrada no banco e não volta ao navegador. Redirecionamentos
do endpoint são recusados. Ao trocar de ou para esse provider, informe uma chave nova.

Escolha a conexão explicitamente em **Modelos por tarefa**. Criar ou editar uma conexão
CLIProxyAPI não altera o padrão nem as atribuições existentes. O catálogo inclui `gpt-6-luna`
e `gpt-6.1-sol`. Tarefas de documentos preservam o provider fixado quando entraram na fila.
OpenAI direta continua usando sua conexão e credencial próprias.

A busca web do proxy usa a ferramenta nativa do SDK OpenAI, com fontes na resposta.
As chamadas usam `store: false`, pois o serviço não conserva os itens de resposta que
o SDK referenciaria nos próximos passos de uma chamada com ferramentas.
Imagens estão habilitadas somente em `gpt-6-luna`, verificado com uma requisição real.
Outros modelos do proxy não recebem imagens. PDF direto, áudio, transcrição e embeddings
não estão habilitados no proxy, mesmo quando o administrador digita outro ID de modelo.
Textos já extraídos do Cofre continuam disponíveis. Mantenha embeddings e transcrição
em conexões compatíveis com essas funções.

Cada pessoa pode manter até três respostas do Lume em execução, somando chat e
**Delegar ao Lume**, qualquer que seja o provider. A quarta recebe HTTP 429 antes de
guardar uma pergunta ou alterar a tarefa. Outra mensagem na mesma conversa recebe 409.
Concluir, parar ou falhar libera a vaga. Depois de uma queda do executor, a vaga expira
em até cinco minutos. Uma execução antiga não pode substituir o histórico nem liberar
a vaga de uma execução mais nova. O número de conversas salvas continua ilimitado.

O servidor deriva um `Session-Id` opaco por escritório, pessoa e conversa. Ele permanece
estável entre turnos e não contém o identificador da sessão de login. O histórico continua
no Lume, sem depender de um histórico local do Codex.

Os testes de contrato e concorrência rodam sem uma chave externa. O e2e
`e2e/cliproxyapi.e2e.ts` cobre a seleção em desktop e celular. Para incluir uma conversa
real, defina `K5_E2E_REAL_AI=1` e `K5_E2E_CLIPROXYAPI_KEY_FILE` no processo do runner.
A [receita verify-lume](../../.agents/skills/verify-lume/features/cliproxyapi.md) descreve
a configuração isolada, as evidências e os limites da prova local.

## IA e documentos

O plano está em [`docs/plano-ia-mvp.md`](../../docs/plano-ia-mvp.md).

As regressões do editor ficam em `e2e/document-saving.e2e.ts` e a exportação em PDF em
`e2e/document-pdf.e2e.ts` (veja [Testes end-to-end](#testes-end-to-end)). Elas usam o editor
real e respostas controladas da API para reproduzir conflitos e falhas de salvamento.

Alterações de documentos que ainda não foram salvas permanecem na memória da sessão
ao navegar dentro do aplicativo, inclusive com Voltar/Avançar. O menu tenta salvar
antes de sair do editor; falhas oferecem **Tentar salvar novamente**. Trocar de
escritório exige salvar os documentos pendentes. Sair tenta salvar; se falhar, a pessoa
escolhe continuar editando ou descartar os rascunhos e encerrar todas as sessões. Recarregar ou fechar o
aplicativo continua exigindo salvar antes: rascunhos privados não são gravados no navegador.

- **Administração:** módulo `/app/admin`, visível só para administradores da plataforma, com
  as abas Feedback, Clientes, Financeiro, IA, Execuções, Credenciais e Auditoria. A aba Auditoria
  (`/app/admin/audit`) lista `platform_audit_log`, com filtros por grupo de ação e por escritório. A aba IA (`/app/admin/ai`) configura uma vez,
  para todos os escritórios, as conexões de IA da plataforma (OpenAI, Anthropic, Google,
  DeepSeek, Inception, OpenRouter, AI Gateway e CLIProxyAPI) e a TypeSafe. Em **Modelos por tarefa** o
  administrador escolhe conexão, modelo e esforço de raciocínio por grupo (Agente, Redação
  jurídica, Extração de documentos, Resumo e texto curto, Classificação e segurança, Transcrição)
  e, quando precisar, por tarefa; o catálogo fica em `src/lib/ai-tasks.ts` e a resolução em
  `src/lib/ai-assignments-core.ts` (migração 0030). Sem escolha própria, a tarefa segue o grupo e
  o grupo segue o pai; modelo e esforço são herdados separadamente, e um esforço escolhido para um
  provider não passa para outro. Uma conexão escolhida que foi desativada ou excluída interrompe a
  tarefa com o motivo, sem trocar de provider sozinha. Cronologias e minutas fixam os modelos ao
  entrar na fila (`ai_run.model_plan`); a conexão de uma tarefa na fila não pode ser excluída nem
  mudar de provider. Cada chamada grava em `ai_usage` a tarefa, o esforço, a origem do modelo e do
  esforço, a duração, a classe de erro e sinais de qualidade (como citações sem trecho literal na
  cronologia). O modelo de embeddings continua na conexão, e trocá-lo reindexa o Cofre de todos os
  escritórios.
  A migração 0022 adotou as conexões do escritório configurado por último; as conexões antigas
  por escritório ficam guardadas, mas não são mais lidas. Clientes é a lista de escritórios.
  O roteador do Mastra resolve endpoint e protocolo do provedor. O usuário do escritório não
  escolhe nem vê o modelo no chat. O acesso à configuração vem da
  tabela `platform_admin`, independente do papel no escritório, e só é concedido pela linha
  de comando: `pnpm platform:admin grant --email usuario@exemplo.com` (`revoke` retira).
  Chaves ficam cifradas com AES-256-GCM e nunca voltam ao navegador; operações são auditadas.
  Só providers que aceitam esforço o recebem (OpenAI e CLIProxyAPI); os demais usam o próprio padrão. A
  migração 0030 manteve o esforço de antes: `xhigh` no Agente, na Redação e na Extração, `medium`
  no panorama de e-mails, `low` nas respostas rápidas e na guarda contra injeção. O modelo
  escolhido precisa aceitar o esforço; o botão **Testar** confere a combinação.
- **Rotação da chave mestra:** siga os comentários de `.env.example` e execute
  `pnpm platform:admin rotate-key --email <administrador da plataforma>`.
- **Cofre (`/app/vault`):** casos e biblioteca; PDF (com OCR), DOCX, EML, XLSX, CSV e TXT
  com referências estáveis por página, parágrafo, mensagem ou célula.
  Cada arquivo pode ter até 100 MB. A interface envia o arquivo no corpo da solicitação, com
  `x-k5-file-name` codificado por `encodeURIComponent` e os metadados em `x-k5-upload-scope`,
  `x-k5-upload-caseid` e `x-k5-upload-folderid`. Isso evita acrescentar multipart ao limite de
  100 MB da Cloudflare. As rotas de upload também aceitam multipart para clientes existentes.
  O binding R2 recebe o File sem cópia em ArrayBuffer e transmite downloads como stream.
  A biblioteca e cada nível de pasta exibem 50 arquivos por página, com Anterior/Próxima e o total.
  `/api/vault/documents` e `k5_vault_list_documents` aceitam `limit` (1–50) e `offset` (a partir de 0)
  e devolvem `{ documents, total }`, respeitando os mesmos filtros e permissões. A ordem é
  criação decrescente, com o ID como desempate; alterações concorrentes podem deslocar páginas.
  Os seletores de anexos, e-mail e versões do Drive percorrem automaticamente as páginas de 50
  até cobrir o total; uma falha permite repetir a consulta sem perder as opções já carregadas.
- **Anexos da petição:** na aba **Anexos** do caso, a pessoa escolhe o PDF digitalizado com todos
  os documentos (já lido pelo OCR) e a petição (arquivo do caso ou texto colado). O modelo da tarefa
  `extraction.annex_plan` propõe os documentos e as páginas; o código ordena pela primeira citação na petição
  e deixa desmarcados os não citados. Depois da revisão, `pdf-lib` recorta os intervalos e salva
  cada anexo numa nova pasta do caso, numerado e sem acentos (`01_procuracao.pdf`). Nada é gerado
  sem confirmação; o Lume usa as mesmas capacidades (`k5_vault_plan_annexes`, `k5_vault_generate_annexes`).
- **Lume (`/app/agents`):** conversa com histórico por usuário. O botão **+** envia documentos
  e imagens privados para a conversa, com prévia, remoção antes do envio e acesso no histórico.
  Aceita até seis anexos por mensagem, escolhidos de uma vez, com documentos de até 25 MB e imagens de até 10 MB. Eles não criam documentos no Cofre.
  **Fontes** seleciona arquivos existentes do Cofre e referências do caso. Cronologia e minuta rodam como tarefas duráveis e abrem no
  editor em `/app/documents/[id]`, com exportação PDF e DOCX no timbrado do modelo.
- **Câmera:** **+ → Tirar foto** abre a câmera do dispositivo após a permissão do navegador,
  permite conferir ou repetir a foto e a anexa à mensagem. Exige HTTPS (ou localhost) e um
  modelo com visão. A alternativa **Escolher foto** permanece disponível quando a câmera
  não pode ser aberta. Para listas fotografadas, o Lume prepara uma sugestão de Agenda por
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
  de produção em variável de ambiente. Jev não é um modelo de conversa do Lume.
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
compartilhado. O advogado lê o acervo e pode iniciar coleta,
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
`e2e/pwa.e2e.ts` confere manifesto, ícones, cabeçalho do service worker, o convite de
instalação e a cor do tema; offline e Cache Storage seguem nesta conferência manual.
O teste isolado `pnpm --filter @k5/web exec tsx scripts/verify-pwa-update.ts` inicia
um servidor temporário e verifica duas atualizações com abas abertas: remove os JS/CSS
antigos do servidor e confirma carregamento pelo cache, sem perder o formulário.

## Plano e pagamentos (AbacatePay)

Cada advogado administra a mensalidade do seu escritório em **Plano** (`/app/billing`).
O pagamento usa o checkout hospedado da AbacatePay (PIX ou cartão):
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

`/app/admin/finance` reúne somente cobranças criadas pelo Lume, com filtros de cliente, período,
situação e ambiente. Testes e produção ficam separados; os totais são brutos, antes das taxas,
e o valor após reembolsos não representa saldo disponível na AbacatePay. A lista de Clientes abre
`/app/admin/clients/[officeId]`, com histórico paginado, comprovantes, assinaturas e ações auditadas.

Administradores **da plataforma** podem gerar/copiar um link avulso ou de assinatura mensal,
reembolsar integralmente um avulso pago, atualizar as cobranças e cancelar a renovação de uma
assinatura ativa. As mutações verificam sessão, papel de plataforma, origem e vínculo do recurso
com o escritório. O responsável selecionado precisa ser o advogado dono daquele escritório;
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
Cada evento é associado a um checkout do Lume por consulta ao provedor, nunca pelo e-mail ou por
metadados enviados pelo cliente. Uma renovação soma um mês uma única vez, mesmo se a confirmação
chegar por mais de um caminho. Eventos atrasados não reativam uma assinatura cancelada.

A migração `0029_billing_checkout_reservation.sql` registra a identidade de criação antes de
contatar a AbacatePay. As chamadas externas não mantêm uma transação PostgreSQL aberta. Se a
resposta se perder ou a gravação local falhar, **Atualizar pagamentos**, o retorno à página Plano
ou um webhook recuperam o checkout pelo `externalId` persistido, sem repetir a criação.
Preparações interrompidas antes do envio podem ser retomadas após cinco minutos. Uma criação
já enviada não expira automaticamente: uma consulta sem resultado ainda pode ser temporária.

Pedidos de reembolso/cancelamento gravados, mas ainda não despachados, são retomados ao atualizar.
Depois da marca de despacho, o Lume somente consulta o resultado. Se a operação continuar
incerta, confira o ID da cobrança/assinatura no painel da AbacatePay antes de qualquer ação
manual; após confirmação no provedor, atualize novamente no Lume. Não apague registros de
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

### Créditos

IA e OCR consomem créditos do escritório (`src/lib/billing/credits.ts`, migração
`0061_credits.sql`). Cada chamada de modelo concluída é cobrada em `recordUsage`, na mesma
transação que grava `ai_usage`, pelo custo real: entrada, cache lido e escrito, saída (com
raciocínio), contexto longo por chamada e buscas web do provedor. Chamadas que falham são
registradas sem cobrança. Cada página lida por OCR custa 0,1 crédito, uma vez por documento e
página. Sem saldo, chat, tarefas em segundo plano, transcrição e OCR são recusados (HTTP 402); a
última chamada pode deixar o saldo um pouco negativo.

- Preço: `credit_settings` guarda o preço do crédito (R$ 0,10), a margem (30%), imposto (6%),
  taxa de pagamento (3%) e o dólar (R$ 5,50). Um crédito cobre R$ 0,061 de custo.
  `ai_model_price` guarda os preços oficiais por modelo; a linha `*` cobra modelos sem preço
  próprio. Ajuste os valores por SQL; não há tela.
- Saldo: escritório novo recebe 850 créditos uma vez. Cada mês pago do plano soma 850, e o saldo
  passa para o mês seguinte. Pacotes de 500, 1.000 e 2.500 créditos são checkouts avulsos
  (`kind = 'CREDITS'`); créditos comprados valem mesmo sem plano ativo. Um reembolso retira os
  créditos do pagamento.
- Administração: Clientes → escritório → Créditos adiciona créditos com motivo, auditado e
  idempotente. Administradores da plataforma usam a IA sem consumir créditos; o custo continua
  em `ai_usage`.

## Observabilidade (Sentry)

Erros de navegador, Next.js, Workers Cloudflare e filas Node são enviados ao projeto
`lume-wr/lume`; traces usam amostragem de 10%, exceto as respostas do chat (`invoke_agent Lume chat`),
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
pnpm --filter @k5/web build:vinext
```

O CI roda em jobs paralelos: lint e typecheck; `pnpm test`; o build do Next.js seguido da suíte
e2e contra `next start` nesse build, com um PostgreSQL descartável; e o build Cloudflare/vinext,
que usa a configuração de Workers e não publica uma versão nem provisiona recursos.

Os testes usam os endpoints reais do Better Auth e PostgreSQL com esquemas isolados para validar
autorização da plataforma, isolamento de credenciais, histórico de conversas, cronologia,
exportação DOCX, cadastro, senha, duplicidade, isolamento de escritórios, tentativa de injetar papel,
expiração, renovação, cookies forjados, logout global, origem e limite de tentativas.

O comando de produção é `pnpm --filter @k5/web start`, após setup e build.
A UI usa Inter e Newsreader, baixadas por `next/font/google` durante o build e
servidas pela própria aplicação. A variante itálica da Newsreader só é carregada
pelo navegador quando usada; as variantes normais recebem preload.

## Testes end-to-end

A suíte de navegador fica em `e2e/` e roda com o [e2e](https://e2e.tester.army/docs), que usa o
Playwright como motor. Da raiz:

```sh
pnpm test:e2e                                                  # suíte inteira
pnpm --filter @k5/web exec e2e run e2e/office-tasks.e2e.ts     # um arquivo
pnpm --filter @k5/web exec e2e run --exclude-tag agent --last-failed
```

- `e2e.config.ts` sobe o servidor: `next dev` localmente (ou reaproveita o que já responde em
  `localhost:3000`, lendo `.env.local` para as conferências no banco) e `next start` sobre o
  build no CI. `K5_E2E_URL` aponta a suíte para um servidor já iniciado, como a instância da
  skill `verify-lume`.
- A interface usa o canvas com a conversa persistente em todos os escritórios.
- Localmente, sem `K5_E2E_URL`, os testes de fluxo real criam contas descartáveis
  (`*@k5.test`) e registros de teste no banco do `.env.local`. Para não tocar nesse banco, rode
  contra a instância isolada da `verify-lume` (`lume-verify.mts up` e depois `drive <id>`).
- `e2e/auth.setup.e2e.ts` entra uma vez pelo formulário com `admin@advocacia.test` (ou
  `E2E_EMAIL`/`E2E_PASSWORD`) e cria a conta se ela não existir; os testes com
  `{ session: 'admin' }` reaproveitam essa sessão. Testes que mudam credenciais ou precisam de
  outra pessoa criam contas próprias pela API (`e2e/support/accounts.ts`).
- Tags: `agent` marca testes cujos passos o modelo conduz (`agent.act`/`agent.assert`) e exige
  `OPENAI_API_KEY`; o CI os pula quando o secret não existe. `pdf` marca o que depende do
  LibreOffice no servidor; em uma máquina sem conversor, use `--exclude-tag pdf`.
- O servidor que a suíte sobe confia no cabeçalho `x-e2e-client` (`K5_CLIENT_IP_HEADER`) para
  separar os limites de login por cliente de teste. Não configure esse cabeçalho em ambientes reais.
- A saída fica em `.e2e/` (ignorada pelo Git): `report.json`, `summary.md`, `failures/` e
  `artifacts/` com um trace por teste
  (`pnpm --filter @k5/web exec playwright show-trace <arquivo>`). O replay cache dos passos de
  agente fica em `.e2e/cache/`, preservado entre execuções do CI.
- Para escrever ou depurar testes, use a skill `e2e` (`.agents/skills/e2e`).

Os scripts em `scripts/` que ainda usam a biblioteca `playwright` não são testes: gravam o
tutorial (`record-tutorial.ts`, `tutorial-*.ts`, `record-system-live.ts`), conferem ambientes
publicados (`verify-sentry-browser.ts`, `verify-monitoring-browser.ts`) e reproduzem a
atualização do service worker com várias abas (`verify-pwa-update.ts`).

## Visão geral e validação de interface

O Início reúne tarefas pendentes até hoje, próximas reuniões, clientes ativos, casos e conversas pessoais. Permite concluir tarefas e abrir os formulários existentes. As visões da agenda aceitam `?view=tasks`, `?view=calendar` e `?view=clients`; `action=new` abre o cadastro correspondente para quem pode editar. Clientes têm uma página própria em `/app/agenda/clients/[id]`.

`e2e/workspace.e2e.ts` confere menu Mais, chat longo, retorno ao fim, calendário, Início e detalhes de cliente em desktop/mobile, com dados de negócio interceptados por fixtures; não altera os registros do escritório.


## Kanban e delegação de tarefas

Em Escritório → Tarefas, alterne entre Lista e Kanban. O quadro reúne todas as tarefas dos filtros selecionados em A fazer, Em andamento, Concluídas e Canceladas. Cada cartão tem uma alça, "Arrastar <título>", para mover a tarefa de coluna: arraste com o mouse ou o dedo, ou, pelo teclado, foque a alça e use Espaço ou Enter para pegar, as setas para a esquerda e para a direita para escolher a coluna, Espaço ou Enter para soltar e Esc para cancelar. O cartão muda de coluna na hora e cada tarefa é salva sozinha; se o salvamento falha, o cartão volta e um aviso explica o motivo, sem recarregar o quadro. Mover só altera a situação: a ordem dentro da coluna segue o prazo. O título do cartão abre a página da tarefa. `?layout=kanban` abre o quadro diretamente.

O advogado pode usar **Delegar ao Lume** em uma tarefa aberta. A ação cria uma conversa pessoal com título, observações, prazo e vínculos da tarefa, inicia o agente e coloca a tarefa em andamento. **Abrir sessão do Lume** retorna à mesma conversa. Cada usuário vê somente sua própria sessão. O agente deve entregar o resultado antes de concluir a tarefa; dúvidas e confirmações continuam na conversa.

## Cache das opções inteligentes de email

Os panoramas por período e os resumos com sugestões de resposta são persistidos por conexão Google, geração de autorização e versão da análise. Cada pedido confere o conteúdo atual no Gmail. Sem mudanças, reutiliza a análise, inclusive depois de recarregar a página. Marcar como lido atualiza a apresentação sem chamar a IA.

Quando chegam mensagens, o panorama usa a análise anterior e somente as conversas novas ou alteradas. Conversas removidas da caixa ou do período saem das referências. O resumo individual usa o resumo anterior e as novas mensagens; remoções exigem reconstrução do resumo. Permanecem os limites de 30, 50 e 80 conversas para dia, semana e mês, e a indicação de resultados limitados. Uma solicitação simultânea recebe uma orientação para aguardar; falhas não substituem o último resultado salvo. A autorização é verificada antes de qualquer leitura do cache.
