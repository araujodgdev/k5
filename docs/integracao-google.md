# Configuração e operação da integração Google

Implementa o [plano](plano-integracao-google.md). A integração é opcional, separada do login
Better Auth, e fica liberada por padrão para todos os escritórios e módulos quando o ambiente
tem OAuth configurado. A plataforma pode bloquear módulos explicitamente por escritório;
as regras do escritório e o consentimento individual continuam obrigatórios.
Não há credenciais Google de homologação no repositório. Os testes locais usam transporte
simulado; a matriz de homologação real abaixo precisa ser executada antes da liberação.

## Google Cloud

Projeto de homologação informado pelo usuário: **Lume Staging**, ID
`lume-staging-509519`, número **97857362642**. Esse número também é o
`GOOGLE_PICKER_APP_ID`; ele não substitui a chave `GOOGLE_PICKER_API_KEY`.

## Uso no aplicativo

- **Integrações → Conexões:** escolha Gmail, Agenda, Drive ou Docs individualmente. A conta
  Google é única por pessoa/escritório; desconectá-la interrompe todos os serviços. Drive e
  Docs compartilham `drive.file`. Administradores encontram a política em **Regras do escritório**.
  Operações e consumo permanecem registrados no servidor, sem relatórios nesta página.
- **E-mails:** a lista e a mensagem têm rolagem independente. No celular, abra a mensagem e
  use **Voltar à lista**. **Classificar esta página** sugere categoria, prioridade e necessidade
  de resposta; filtros e ordenação abrangem somente as até 20 conversas carregadas.
- **Cofre:** **Importar do Google Drive** abre o seletor no próprio fluxo. Na Biblioteca,
  no caso ou na pasta, a cópia vai diretamente para o destino aberto. A ação no início do
  Cofre leva à Biblioteca. Após o worker concluir, a listagem é atualizada automaticamente.
  Renomeação, Docs e acessos ficam no painel Google Drive do Cofre. Cópias são independentes
  do original, e versões não se misturam entre Biblioteca, casos ou pastas.

### Classificação com Jev / TypeSafe AI

A conexão central fica em **Plataforma → TypeSafe**. Configure a chave e habilite
**Classificação de e-mails**. O padrão da migração é desligado; o modo **Avaliar sem aplicar**
executa a avaliação, mas não mostra sugestões. A chave fica cifrada no servidor, nunca no cliente.

O clique envia ao TypeSafe somente assunto (até 240 caracteres), remetente (200), trecho (600),
data e indicação de mensagem enviada pela própria pessoa. Não envia corpo completo nem anexos.
O Gmail não é alterado e não há indexação de mensagens no Cofre. A aplicação consulta a conta
autenticada, revalida acesso antes dos lotes e antes de devolver resultados, e descarta sugestões
se a sessão, consentimento ou configuração mudar.

São três julgamentos independentes: Choice para categoria, Score para prioridade e Noul para
resposta, em lotes de quatro mensagens. Categoria/prioridade com confiança abaixo de 0,75 são
marcadas **A conferir**; resposta entre 0,25 e 0,75 permanece indeterminada. Esses limiares são
heurísticas iniciais, não uma garantia de acerto. A prioridade orienta leitura e não calcula
prazos jurídicos. O dia de referência usa `America/Sao_Paulo`.

O cache, privado por conexão/pessoa/escritório, guarda apenas resultados tipados e fingerprint
por uma hora; nova mensagem ou alteração do trecho, modelo ou configuração invalida o resultado.
Falhas e limites de consumo mantêm a lista disponível sem inventar classificações. Reservas
de orçamento/concorrência são serializadas entre todos os usos do TypeSafe.

Referências: [SDK JavaScript](https://docs.typesafe.ai/sdk/javascript),
[Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score),
[Noul](https://docs.typesafe.ai/primitives/noul) e
[classificação com confiança](https://docs.typesafe.ai/cookbooks/classification_using_confidence).

## Configuração no console Google Cloud

1. Crie projetos distintos para homologação e produção. No projeto correspondente, habilite
   Gmail API, Google Calendar API, Google Drive API, Google Docs API e Google Picker API.
2. Configure a tela de consentimento com identidade do aplicativo, domínio autorizado,
   suporte, política de privacidade e usuários de teste. Para atender Gmail pessoal e Workspace,
   use audiência externa; a organização Workspace pode exigir liberação pelo administrador.
3. Crie um cliente OAuth **Aplicativo da Web**. Cadastre a origem JavaScript exata do Lume
   (incluindo protocolo/porta) e o redirect exato: `<origem>/api/integrations/google/callback`.
   Para desenvolvimento: `http://localhost:3000` e
   `http://localhost:3000/api/integrations/google/callback`.
4. Crie uma chave de API para Picker, restrita à Google Picker API e aos HTTP referrers
   do aplicativo. Informe também o número do projeto (App ID), do mesmo projeto do OAuth.
5. Cadastre nas configurações OAuth somente os escopos usados pelo código. A conexão pede
   `openid email`, mais os escopos dos módulos selecionados:

| Módulo | Escopos |
| --- | --- |
| Gmail | `gmail.readonly`, `gmail.compose` |
| Agenda | `calendar.calendarlist.readonly`, `calendar.events` |
| Drive e Docs | `drive.file` |

Os nomes abreviados acima têm prefixo `https://www.googleapis.com/auth/`. Docs edita somente
arquivos escolhidos no Picker. O consentimento é incremental e recusas parciais deixam o
recurso correspondente indisponível. Uma pessoa pode ter uma conta ativa por escritório;
uma mesma identidade Google não é compartilhada entre integrantes do mesmo escritório.

Consulte as exigências atuais de [verificação de escopos Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)
e [publicação OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
Escopos restritos podem exigir verificação e avaliação de segurança para uso em produção.
Aplicativos externos em teste têm restrições de usuários e expiração de autorizações;
trate isso como condição de homologação, não como configuração final de produção.

## Ambiente local e liberação

Preencha `apps/web/.env.local` seguindo [`.env.example`](../apps/web/.env.example):

| Variável | Uso |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Cliente web do projeto correspondente |
| `GOOGLE_OAUTH_REDIRECT_URI` | Opcional; padrão deriva de `BETTER_AUTH_URL` |
| `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` | Chave pública restrita e número do projeto |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | HTTPS público terminando em `/api/integrations/google/notify` |
| `K5_CREDENTIALS_KEY` | Chave AES existente, 32 bytes em base64; não substitua sem rotação |
| `K5_CREDENTIALS_PREVIOUS_KEYS` | Chaves anteriores, separadas por vírgula, durante rotação |
| `K5_GOOGLE_USAGE_TIMEZONE` | Dia dos limites de uso; padrão `America/Sao_Paulo` |

Nunca publique client secret, refresh token ou chave de cifra. O navegador recebe somente
configuração pública do Picker. O GIS emite para ele um token temporário exclusivamente
`drive.file`, com `include_granted_scopes:false`, mantido em memória. O refresh token combinado
do servidor não é exposto ao Picker. Veja [GIS TokenClient](https://developers.google.com/identity/oauth2/web/reference/js-reference).

Na raiz do repositório:

```sh
pnpm db:setup
pnpm dev
# Em outro terminal; --once faz uma passagem e encerra.
pnpm integrations:worker
```

`db:setup` aplica migrações aditivas, preservando dados e segredos. O worker local executa
sincronização, renovação de canais, importações e reconciliação. Sem URL de webhook pública,
a agenda usa consultas periódicas. Para testar push local, use um endereço HTTPS de túnel
estável e configure-o como webhook; o callback OAuth continua precisando do endereço exato
registrado no Google.

Não é necessário executar uma liberação manual para escritórios novos ou existentes sem
configuração específica em `google_rollout`. Bloqueios explícitos existentes são preservados.
Para sobrescrever o padrão, o responsável deve estar cadastrado e possuir o papel de plataforma.
Essas exceções são independentes das regras do administrador do escritório:

```sh
pnpm integrations:admin --email operador@exemplo.com --office ID_DO_ESCRITORIO --modules gmail,calendar,drive,docs --enabled true
# Reversão: interrompe novos acessos dos módulos selecionados.
pnpm integrations:admin --email operador@exemplo.com --office ID_DO_ESCRITORIO --modules gmail,calendar,drive,docs --enabled false
```

Em **Integrações**, cada integrante seleciona módulos e conecta sua própria conta. O
administrador define bloqueio, confirmação ou execução automática por ação, sem acesso a
caixas de entrada, conteúdo, destinatários ou tokens dos demais. Novas regras começam com
confirmação para escritas. Os limites automáticos podem ser ultrapassados somente após
revisão da operação; bloqueios, papéis, permissões Google e limites técnicos são absolutos.

## Cloudflare e processadores

`apps/web/wrangler.integrations.jsonc` define um Worker independente, Cron a cada minuto,
Queue `k5-integrations-staging` e Hyperdrive. Confirme conta, nomes e Hyperdrive antes de
publicar. A Queue deve existir no ambiente; configure a mesma conexão PostgreSQL da web,
sem cache de consultas. Use outro arquivo/configuração e recursos para produção.

O Worker faz apenas Calendar e reconciliação leve. A Queue transporta identificadores ou
um aviso de varredura, nunca e-mails, documentos ou tokens. PostgreSQL conserva trabalho,
reservas de execução, cursores, tentativas e estados; Cron recupera trabalhos mesmo se um
aviso da Queue não chegar. Duplicações de entrega são esperadas.

Importações, OCR/indexação e reconciliação Gmail/Drive/Docs são executadas em Node. Em
Cloudflare, o processador `documents` é acordado por trabalhos `google_job` de runtime Node;
`ProcessorEnv` repassa o cliente OAuth e a chave de cifra aos containers. Em Docker, o serviço
`integrations` usa o mesmo banco e armazenamento dos demais serviços. Em Node independente,
`pnpm integrations:worker --node-only` delega Calendar ao Worker.

Segredos exigidos no **Worker web** e nos **processadores**: cliente OAuth e chave de cifra.
Na web, configure também Picker, origem e callback. No **Worker de integrações**, configure
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `K5_CREDENTIALS_KEY`, chaves anteriores
quando necessárias e URL pública do webhook. Use os mecanismos de secrets do ambiente;
não grave valores em `wrangler*.jsonc`. A publicação não faz parte do build local:

```sh
pnpm integrations:build
# Somente após configurar recursos/segredos e autorizar publicação:
pnpm --filter @k5/web integrations:deploy
```

O build faz `wrangler deploy --dry-run`; não publica nem envia source maps ao Sentry.
Na publicação, `SENTRY_AUTH_TOKEN` é obrigatório. O Worker registra falhas operacionais e
estados; não registre corpos, mensagens, destinatários ou credenciais nos logs.

## Comportamentos e recuperação

- **Privacidade:** agendas pessoais são separadas das atividades do escritório. Compartilhar
  publica apenas título, notas, local e horário revisados; convidados, descrição original e
  link de reunião não são copiados automaticamente. Revise esses campos antes de compartilhar.
- **Sessões:** logout revoga operações interativas; a autorização de sincronização continua.
  Desconectar apaga tokens locais, tenta revogar no Google e cancela trabalhos. Remoção do
  integrante é verificada antes do acesso remoto, além da limpeza periódica.
- **Resultados incertos:** timeout de escrita mantém estado `unknown`. O Lume consulta o
  Google antes de permitir repetição; não há promessa de exatamente uma execução. Não apague
  registros para forçar reenvio. Se não puder provar o resultado, a operação permanece em
  verificação. Efeitos parciais de séries recorrentes precisam de inspeção no Google.
- **Agenda:** seleciona calendários, acompanha cursores incrementais e refaz sincronização
  em `410`. Preserva alterações locais por campo; exclusão/perda de permissão fica visível.
  Séries suportam ocorrência, série ou desta em diante. Mudança de cadência/horário numa
  divisão com exceções futuras é recusada antes da escrita; altere essas ocorrências separadamente.
- **Gmail:** leitura sob demanda, busca e páginas; HTML é convertido em texto inerte, sem
  recursos externos. Não há indexação geral da caixa. Anexos entram no Cofre apenas após
  seleção explícita de um caso. Rascunhos/respostas mantêm a identidade da conta e da conversa.
- **Drive:** somente arquivos escolhidos no Picker. Importar cria cópia independente no Cofre;
  importação posterior cria uma versão, mantendo conta/origem/revisão/hash. Docs vira DOCX,
  Sheets XLSX e Slides PDF. Limite da cópia: 50 MB; exportações Google: 10 MB. Envios/anexos
  continuam sujeitos ao teto técnico de 25 MB. Não há sincronização bidirecional do Cofre.
- **Docs:** substituições de trechos exatos, únicos, usando revisão exigida. Revisão alterada
  exige releitura e nova operação. Acesso herdado de Drive compartilhado não é revogado aqui.

Para rotacionar a cifra, distribua a nova `K5_CREDENTIALS_KEY` e mantenha a antiga em
`K5_CREDENTIALS_PREVIOUS_KEYS` em todos os runtimes. Execute
`pnpm platform:admin rotate-key --email operador@exemplo.com`, que cobre credenciais IA,
tokens Google, verificadores OAuth, argumentos/resultados e checkpoints de operações.
Valide e repita a varredura sem escritas concorrentes antes de remover as chaves antigas.
Não restaure um backup cifrado com chave removida sem recuperar a chave correspondente.

## Validação e homologação

Checks locais: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:setup`, `pnpm build`,
`pnpm integrations:build`. Testes `apps/web/tests/google-*.test.ts` usam PostgreSQL isolado
e Google simulado para exercitar OAuth, renovação concorrente, regras/aprovações, ownership,
respostas perdidas, Gmail, recorrências/sync e importações. Esses testes não substituem:

1. Gmail pessoal e Workspace: consentimento integral/parcial/negado, incremento de módulos,
   reconexão, revogação externa, logout versus desconexão e troca de conta recusada.
2. Dois integrantes e dois escritórios: nenhum acesso à conta do outro, inclusive administrador,
   papel revisor sem escrita externa e remoção do integrante enquanto há trabalho pendente.
3. Gmail: recebido/enviado/rascunho, reply/thread, anexos pequenos e teto, edição do rascunho
   durante revisão, resposta perdida depois do envio e nenhuma repetição enquanto incerto.
4. Calendar: agenda principal/secundária/read-only, dia inteiro, DST/fuso IANA, Meet/RSVP,
   séries COUNT/UNTIL, exceções, alterações Google/Lume simultâneas, `410`, push duplicado,
   canal expirado e compartilhamento explícito sem vazamento de convidados.
5. Drive: Picker em ambas as contas, arquivo privado/Shared Drive, acesso herdado/removido,
   Docs/Sheets/Slides/PDF, limites 10/50 MB, nova versão e OCR/indexação no Cofre.
6. Docs: texto único/ambíguo, edição concorrente/revisão obsoleta e mudança após aprovação.
7. Operação: reinício do Worker/Node, reserva expirada, Queue duplicada, mudança de política
   antes da escrita, rotação das chaves e liberação/reversão por módulo.

Registre evidências de homologação sem conteúdo pessoal ou segredos. Libere primeiro um
escritório de teste e depois os módulos gradualmente. A matriz real permanece **parcial**:
a conta pessoal foi conectada; os cenários Workspace e os demais itens abaixo ainda precisam
de homologação específica.

### Verificação local em 23/09/2026

A suíte completa passou com 378 testes, sem falhas ou testes ignorados. Após o ajuste para
exibir a escolha de conta no OAuth (`consent select_account`), os 9 testes de fundação
passaram novamente, assim como o build da aplicação.
Também passaram lint, typecheck, setup das migrações, build da aplicação e build local
do Worker, sem publicação. O lint mantém um aviso preexistente em `judicial/connectors/transport.ts`.

No navegador, foram verificados desktop, celular de 390 px, navegação por teclado e estados
sem configuração. Com transporte Google inteiramente sintético, foram concluídos leitura e
envio de e-mail com aprovação, criação de evento, renomeação no Drive e edição de trecho no
Docs vinculada à revisão. O assunto MIME foi conferido após a correção da decodificação.
Essas verificações sintéticas são separadas da rodada real descrita a seguir.

### Homologação parcial com conta pessoal em 23/09/2026

O usuário selecionou uma conta pessoal no Chrome e confirmou o consentimento Google.
O callback concluiu a conexão no escritório local de teste. Credenciais e conteúdo da
caixa de entrada não fazem parte das evidências versionadas.

- **OAuth:** escolha explícita da conta, consentimento e callback com conexão ativa.
- **Gmail:** carregamento de 20 conversas; criação, releitura e exclusão de um rascunho
  sintético sem destinatários, com revisão e aprovação. A exclusão foi autorizada pelo
  usuário. Nenhum e-mail foi enviado.
- **Calendar:** consulta de quatro calendários, seleção apenas do principal, sincronização
  inicial e incremental com cursor persistido e sem erros; criação, releitura, edição e
  cancelamento de um evento sintético, sem convidados ou Meet. O cancelamento foi autorizado.
- **Operações:** criação/edição/cancelamento do evento e criação/exclusão do rascunho
  registradas como concluídas; nenhum conteúdo pessoal foi compartilhado com o escritório.

A rodada real revelou que um evento já cancelado ainda aparecia como ativo na lista.
A correção omite cancelamentos confirmados e preserva pendências/conflitos para revisão;
a regressão cobre também o desaparecimento posterior do registro de exclusão no Google.
Os 12 testes de Calendar passaram após essa correção.
O build da aplicação (incluindo TypeScript), o build local do Worker e o lint dos arquivos
alterados também passaram. Após reiniciar a aplicação, a agenda no Chrome mostrou
"Nenhum evento pessoal para este dia", confirmando que o evento cancelado não reapareceu.
O rascunho sintético também deixou de aparecer, com confirmação de exclusão na interface.

`GOOGLE_PICKER_API_KEY` foi fornecida e configurada em `.env.local` em 23/09/2026;
o servidor foi reiniciado e o Picker abriu no Chrome após autorização do usuário.
O valor não é versionado.

Na continuação da rodada, um documento Google Docs com conteúdo exclusivamente sintético
foi criado para validar o fluxo real:

- Seleção no Picker e registro de um único arquivo na conta conectada.
- Renomeação pelo Lume, com revisão e aprovação; duas edições de trecho único no Docs,
  vinculadas à revisão, com releitura do texto e mudança da revisão após cada escrita.
- Exportação para DOCX e importação no caso local `[Lume QA] Integração Google`; documento
  processado pelo worker do Cofre e exibido como **Pronto**.
- Reimportação como versão 2 do mesmo documento, preservando a versão 1. Os dois DOCX foram
  abertos programaticamente para conferir seus marcadores de texto distintos e hashes SHA-256
  diferentes; apenas a versão 2 ficou ativa.
- Duas tentativas durante a propagação das edições no Google foram recusadas porque a versão
  da origem mudou entre a solicitação e a execução. Não criaram versões locais. A nova
  tentativa, com a origem estabilizada, concluiu normalmente.
- O usuário autorizou mover o documento sintético para a lixeira do Google. As duas versões
  locais foram mantidas para conferência, e a cópia ativa continuou **Pronto** no Cofre.

A limpeza revelou um erro no refresh: a resposta de arquivo na lixeira era apresentada como
erro sem atualizar o estado disponível da linha. O refresh passou a persistir `not_found`,
preservando os metadados anteriores e as cópias locais. A regressão cobre lixeira, persistência,
preservação da cópia, propagação de erro 500 e restauração do arquivo; 13/13 testes focados
de Drive e o lint dos arquivos alterados passaram.
O build da aplicação (incluindo TypeScript) e o build local do Worker passaram. Após reinício,
o teste no Chrome confirmou a mensagem de arquivo indisponível e a mudança da linha para
"acesso perdido", mantendo o histórico das importações.

Permanecem pendentes conta Workspace, Shared Drive, demais formatos e limites em contas reais;
envio real de e-mail e anexos;
recorrências/RSVP/Meet e casos adversos da matriz acima em contas reais. Webhook público,
Queue/Cron e execução Cloudflare foram validados por testes/build local, sem publicação
nem teste de entrega externa. Esses pontos não devem ser apresentados como homologados.

Logs locais da rodada: `apps/web/.data/google-validation-current/` (ignorado pelo Git).

Referências de implementação: [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server),
[Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync),
[recorrências](https://developers.google.com/workspace/calendar/api/guides/recurringevents),
[Drive export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export),
[Docs batchUpdate](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).


## Validação da reorganização e da triagem (23/09/2026)

- Suíte completa: 392 testes aprovados. Após a revisão de cópias movidas, os 17 testes do
  Drive passaram, incluindo reimportação que preserva o arquivo transferido para outra pasta.
- Typecheck aprovado; lint sem erros (aviso preexistente em `judicial/connectors/transport.ts`).
  Builds de produção do aplicativo e worker aprovados. API HTTP confirmou 401 sem sessão,
  403 para origem externa e 400 para mais de 20 conversas ou tentativa de fornecer escritório.
- Chrome: lista e mensagem rolam independentemente, mantendo o documento principal parado.
  Verificados desktop e 390×844, retorno à lista, editor e acesso por teclado.
- Triagem na interface com respostas sintéticas: categoria, prioridade, ordenação,
  “A conferir” e limite de uso preservando a lista. Interceptações removidas após o teste.
- Jev real `jev-1.13.0`: 8/8 categorias esperadas em um conjunto sintético pequeno,
  incluindo mensagem ambígua, alias enviado e tentativa de instrução no conteúdo. Duas
  chamadas consumiram 5.258 tokens de entrada. Isso não mede precisão em e-mails reais.
  Uma chamada adicional validou o fluxo completo de serviço/cache com dois exemplos sintéticos.
  Nenhuma mensagem pessoal foi enviada ao TypeSafe durante a validação.
- Cofre: entradas da Biblioteca, caso e pasta mostram o destino atual. Importação,
  separação de versões e atualização após worker cobertas pelos testes do Drive; o fluxo real
  do Picker/Docs já validado anteriormente permanece descrito na matriz acima.
- Chave TypeSafe configurada cifrada no banco local, com classificação de e-mails ativada.
  Esta configuração não foi publicada em produção.

Evidências locais (ignoradas pelo Git): `apps/web/.data/google-validation-current/ux-*.log`,
`triage-live-eval.json` e `triage-live-pipeline.json`. Não contêm a chave TypeSafe.
