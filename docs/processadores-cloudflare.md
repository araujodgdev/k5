# Processadores do staging

O web e as notificações acessam o PostgreSQL PlanetScale `araujodgdev/lume`, branch `main`, em São Paulo, pelo Hyperdrive `lume` (`cb3229db2c05407aa00420f68bcb6f8f`). O cache de consultas fica desativado para preservar isolamento e revogação imediata de sessões. O limite inicial é de cinco conexões de origem.

O Worker `k5-staging` também exporta `LumeProcessor` e `ContainerProxy`. Um cron por minuto inspeciona as filas no PostgreSQL e aciona as instâncias nomeadas `documents` e `judicial` somente quando há trabalho elegível. A limpeza de referências expiradas roda a cada cinco minutos. São no máximo dois Containers `basic`, com suspensão após 30 segundos ociosos. Trabalhos ativos renovam esse prazo; leases e checkpoints continuam no PostgreSQL.

Os Containers têm `constraints.regions: ["SAM"]` para permanecer na América do Sul, próximos ao PostgreSQL e às fontes brasileiras. A colocação automática chegou a iniciar o processador judicial em Taiwan, onde as chamadas ao TJDFT expiraram. A restrição está no Wrangler e foi aplicada à aplicação pela API Cloudflare. [Configuração oficial de localização](https://developers.cloudflare.com/containers/concepts/placement/).

Os Containers rodam Node e as mesmas rotinas de ingestão, OCR, indexação, minutas, verificação TypeSafe e pesquisa do aplicativo. Recebem `PROCESSOR_DATABASE_URL`, `K5_CREDENTIALS_KEY` e o chaveiro anterior pelo ambiente de execução. A URL direta usa um papel de leitura/escrita; migrações usam uma credencial administrativa separada. Nenhuma credencial é incorporada à imagem Docker.

O hostname privado `k5-bindings` é interceptado pelo proxy de saída do Container e encaminha operações ao bucket `VAULT` e índice `KNOWLEDGE` do Worker. Não existe uma rota pública para esse proxy, nem necessidade de chaves S3 ou tokens globais da Cloudflare nos processadores. Arquivos ficam no R2; o disco do Container é descartável. O SQLite exigido pela Cloudflare armazena apenas metadados de orquestração do Durable Object, não dados do aplicativo.

## Publicação e operação

1. Mantenha o Docker Desktop/engine Linux ativo. O Wrangler constrói a imagem `linux/amd64` definida em `apps/web/Dockerfile.processors` usando a raiz do repositório como contexto.
2. Configure `PROCESSOR_DATABASE_URL` como secret de `k5-staging`, mantendo as chaves criptográficas existentes. Aplique as migrações pela URL direta administrativa antes de publicar.
3. Execute os checks e `pnpm --filter @k5/web deploy:vinext`. Publique notificações com `pnpm --filter @k5/web notifications:deploy`.
4. Verifique a aplicação de Containers na Cloudflare, um upload processado, uma consulta externa habilitada e eventos operacionais no Sentry. O primeiro provisionamento da imagem pode levar alguns minutos.

O deploy do Worker termina antes da substituição de todas as instâncias do Container. Confira o digest de cada instância antes de repetir um teste que depende de uma nova imagem; a versão antiga pode continuar atendendo durante a atualização. [Ciclo oficial de atualização](https://developers.cloudflare.com/containers/configuration/rollouts/).

O OCR nativo usa somente a versão de PDF.js instalada em `pdfjs-dist`. `unpdf` fica restrito aos anexos textuais no Worker, porque carregar os dois leitores no mesmo processo mistura versões do worker de PDF.js. Os idiomas português e inglês do Tesseract são incluídos na imagem, em cache somente para leitura; o processador não depende de baixar modelos durante um upload.

`PROCESSORS_ENABLED=false` suspende novos despachos pelo cron. Isso não interrompe um trabalho já reservado. Erros operacionais são enviados ao Sentry com conteúdo privado removido; o servidor de processamento não escreve textos de documentos ou respostas de provedores nos logs.

Workers Paid e PlanetScale são cobranças separadas. Containers geram consumo enquanto executam; a suspensão e o limite de instâncias reduzem uso ocioso, mas não constituem teto financeiro.

## Corte realizado em 22/09/2026

- Importação final: 85 tabelas lógicas e 162 linhas, com contagens, checksums e relações conferidos. A origem D1 foi preservada e não está vinculada aos Workers atuais. Novas escritas já estão no PostgreSQL; uma reversão exige reconciliação.
- PlanetScale: PostgreSQL 18.6, PS-5, São Paulo, branch `main`, 10 GB, zero réplicas e crescimento automático de disco desativado. O papel de migração temporário expira em 24 horas; em futuras migrações emita outro papel administrativo. O papel de execução permanece separado.
- Notificações: fila `k5-notifications-staging` retomada após o corte e Worker usando o mesmo Hyperdrive.
- STJ: instalação `d8ec6c89-2057-4e4e-a004-d8c9a606e204` habilitada para os espelhos da Segunda Turma. O recurso de agosto de 2026 foi enfileirado, mas o download respondeu HTTP 403 ao container. Não há acervo STJ importado por essa tentativa. Íntegras e envio à IA continuam sujeitos às permissões específicas da ficha.
- Captura real no Sentry confirmada para OCR (`LUME-D`) e coleta STJ (`LUME-E`), sem conteúdo de documentos ou credenciais nos eventos.
- Validação remota do OCR: documento sintético `Validacao OCR PostgreSQL.pdf` chegou a `ready`, com 149 caracteres extraídos. A imagem `6d971183ebe4528b7513acd8dee07dfbb02fe7b3eeed57278cee545bae9e0c52` foi verificada nas duas instâncias após a correção de PDF.js. As falhas `LUME-C` e `LUME-D` foram resolvidas após esse teste.
- TJDFT: a instalação `6504a635-bc57-411d-bcd6-16c501ff800e` foi habilitada para consulta temática, com cinco requisições por minuto, quinhentas por dia no total e cem por escritório. O orçamento inicial de cem por dia deixava somente vinte por escritório, insuficiente para uma página com vinte inteiros teores além da busca. A ficha está em `apps/web/db/sources/tjdft-staging.json`. O envio de textos dessa fonte a provedores de IA permanece desabilitado.
- A migração `0004_judgment_revisions.sql` preserva revisões opacas como `versao: "1"` da API TJDFT, sem tentar convertê-las em data. A falha correspondente `LUME-G` foi resolvida após persistência e recuperação reais no staging.
- A requisição JSON às fontes declara `Content-Type`, evitando que o TJDFT ignore o tema e retorne sua listagem padrão. A criação idempotente de clientes e tarefas trata ambos os índices de identidade do PostgreSQL, inclusive em tentativas simultâneas.
- Validação local: 279 testes aprovados, tipagem e build aprovados, lint sem erros (um aviso anterior sobre `_bytes` no transporte de fixtures). O OCR também passou na imagem Linux com PostgreSQL isolado.
- Última publicação: Worker web `854a71aa-2801-4a67-a81f-6636f83237a7`, imagem dos processadores `c0ab03410673771fd5b2bf1770439a557b68d53db60ba1086a7f8141259bb2ab`. O Worker de notificações permanece em `c4c74063-0c03-4d73-b9f7-b4df4de41111`.
- Concorrência remota: quatro requisições simultâneas de criação, passando pelo Worker e Hyperdrive, retornaram a mesma tarefa. A tarefa sintética de QA foi cancelada após a conferência.
- Pesquisa real após a correção do JSON e da localização: consulta `7a860fb8-0899-487d-a8b3-1205e7a0452b` concluída com vinte resultados, incluindo o julgado TJDFT `2174227` sobre guarda exercida pela avó paterna. A página terminou sem erros nem materiais pendentes: um inteiro teor disponível e dezenove não fornecidos pela fonte. Não se confunde `possuiInteiroTeor` com disponibilidade efetiva de texto na API. As falhas de timeout `LUME-F` e de despacho durante a atualização `LUME-H` foram resolvidas após a recuperação.
- Interface da pesquisa conferida em desktop (1280×720) e celular (390×844), incluindo abertura do julgado, sem erros de JavaScript nem transbordamento horizontal. Evidências locais em `apps/web/playwright-report/staging-infra/`: `tjdft-result.json`, `tjdft-ui-result.json`, capturas e `tjdft-pesquisa-real.webm`.
- O teste de câmera/interface usa câmera e resposta de modelo simuladas. A conta estável de QA não tem modelo de IA ativo; a validação de foto → modelo real do escritório → sugestões de agenda aguarda login do usuário no Lume. Não confundir esses testes com uma resposta real do provedor.

## Publicação de 23/09/2026

- Migrações `0005_typesafe_platform`, `0006_crm_client_profile` e `0007_feedback_tickets` aplicadas no PlanetScale.
- Antes delas, o executor recusou `0001_initial.sql` e `0002_source_revisions.sql`: os arquivos tinham sido editados depois de aplicados. A comparação do catálogo (colunas, restrições, índices, funções e gatilhos) entre um banco criado pelos arquivos atuais e o PlanetScale não mostrou diferença de esquema. Por isso apenas os checksums registrados foram realinhados, numa transação sobre `postgres_migration`. Valores anteriores, para reversão: `0001` `1550a5bd5504488bd8d6afb825a0c3950684ea84501c6a7772ec6bfbee698cd0`, `0002` `4e9bd8d897fd06df0ec7d770a22a0527f50e35efc7ab27a0cec01cd55a494f67`. Os checksums agora ignoram CRLF e `.gitattributes` mantém `*.sql` em LF.
- A imagem dos processadores chegou a 4024 MB, acima do limite de 4000 MB dos Containers. Ela passou a instalar só dependências de execução (`pnpm install --prod`; `tsx` foi para `dependencies`): 3,35 GB → 2,99 GB localmente.
- Worker web `b19574f7-b54b-4771-bf4a-5853cb57e7ac`, imagem `sha256:76a237730d14…`; notificações `056e332f-c7eb-4adf-b134-0742840a65aa`.
- TypeSafe: havia três conexões de escritório com chave. A conexão única da plataforma é criada na primeira leitura a partir da mais recente.
