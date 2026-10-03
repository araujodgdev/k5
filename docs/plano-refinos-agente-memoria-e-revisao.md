# Refinos do agente, memória, revisão e PDFs

Diagnóstico, implementação e pesquisa iniciados em 03/10/2026. As verificações usam dados sintéticos e PostgreSQL isolado. As pesquisas de [Honcho](research/honcho-lume-2026-10-03.md) e [PDFcn](research/pdfcn-lume-2026-10-03.md) detalham as dependências externas.

Cada frente segue o mesmo formato:

- **Situação anterior** registra o diagnóstico antes da mudança, para comparação.
- **Feito** lista o que está no código, com o commit ou PR.
- **Pendente** lista o trabalho restante.
- **Decisões** registra as escolhas tomadas e as que continuam abertas.

O documento é atualizado à medida que as frentes avançam.

## Estado geral

| Frente | Estado | Onde |
| --- | --- | --- |
| Anexos do chat para o Cofre | Feito; ampliado pela frente Artefatos | `main` (bdbea4b) |
| Ordem e agrupamento das ferramentas | Feito | `main` (bdbea4b) |
| Conferência de fontes | Parcial: leitura dedicada da norma pendente | `main` (bdbea4b) |
| Revisão humana | Feito | `main` (bdbea4b) |
| PDF pelo agente com PDFcn | Feito em Node/Container; PDFcn no Worker adiado | `main` (bdbea4b) |
| Painel de Artefatos e salvar no Cofre | Feito | branch `feat/lume-artefatos-memoria` |
| Memória persistente com Honcho | Feito no código; ativação depende da chave | branch `feat/lume-artefatos-memoria` |

Publicação: os commits do diagnóstico e da primeira implementação estão em `main` e no deploy de produção (https://lume.software, versão `96324c4d`, com as migrações 0062–0064). As frentes novas sobem num único PR, com um commit por frente.

## Premissas do produto

- Um escritório pertence a uma única pessoa. No cadastro, perfil, escritório e workspace são o mesmo espaço; não há mais vários usuários por escritório. Os casos compartilhados entre escritórios continuam pelo fluxo de associados e participantes.
- A memória do agente é por pessoa. Como escritório e pessoa coincidem, a identidade `officeId:userId` continua válida e não exige separação adicional.

## Anexos do chat para o Cofre

### Situação anterior

O upload no chat persistia os bytes e a extração em `ai_chat_attachment`, com acesso por pessoa, escritório e conversa. Ele devolvia `attachmentId`, não uma referência de upload do Cofre. A ferramenta `k5_vault_ingest_upload` exige `uploadRef`, que só vale quando existe em `vault_upload_ref`. Nenhuma ferramenta fazia a ponte entre esses dois recursos. [Anexos](../apps/web/src/lib/chat-attachments.ts), [contrato da ingestão](../apps/web/src/lib/capabilities/contracts.ts), [referências de upload](../apps/web/src/lib/application/uploads-service.ts).

O prompt incluía `attachmentId` para imagens, mas para PDFs e outros documentos incluía somente nome e texto extraído. Reenviar um PDF não habilitava a operação. [Montagem do prompt](../apps/web/src/lib/chat-prompt.ts).

Uma reprodução com PDF sintético confirmou o problema: o modelo recebia o texto, não recebia o ID, o ID do anexo era rejeitado como `uploadRef` e o Cofre continuava com zero documentos.

### Feito

- `k5_vault_import_chat_attachment` copia originais desta conversa para a Biblioteca, um caso ou uma pasta autorizados. [Serviço](../apps/web/src/lib/application/vault-service.ts).
- O manifesto do prompt informa os IDs de todos os arquivos presentes no contexto, inclusive documentos cujo texto excede o orçamento.
- A identidade determinística por origem e destino impede duplicação por concorrência e reconcilia uma gravação cuja resposta se perdeu.
- A cópia tem chave de armazenamento própria, SHA-256 e procedência em `vault_agent_origin`. Excluir a conversa mantém o documento.
- A origem é resolvida pela pessoa e pelo escritório autenticados e precisa pertencer à conversa atual. O destino respeita as permissões de caso e pasta.

### Pendente

- Nenhum item próprio. Salvar pela interface do chat entra na frente [Painel de Artefatos](#painel-de-artefatos-e-salvar-no-cofre).

### Decisões

- O manifesto segue a janela de contexto do chat. Anexos de mensagens fora dessa janela não são expostos ao modelo, mas continuam no painel de Artefatos.

## Ordem e agrupamento das ferramentas

### Situação anterior

O servidor emitia `text-start` antes de qualquer resultado de ferramenta. O AI SDK criava imediatamente uma parte de texto, e os resultados eram acrescentados depois. Uma reprodução com o leitor real do AI SDK produziu `['text', 'data-tool']`, embora a ferramenta tivesse terminado antes da resposta. O histórico persistido usava a ordem inversa, então o mesmo turno mudava de posição ao recarregar. [Stream](../apps/web/src/lib/chat-turn.ts), [renderização](../apps/web/src/components/agent-chat.tsx).

### Feito

- A atividade aparece numa região estável acima da resposta, durante a execução e no histórico.
- Chamadas da mesma ferramenta, pela identidade real e não pelo rótulo, ficam em grupos expansíveis por teclado, com resultados, falhas e links individuais.
- Aprovações humanas continuam como controles independentes; documentos criados mantêm os links visíveis.
- E2e `chat-feedback.e2e.ts` cobre ordem, agrupamento e teclado em desktop e celular.

### Pendente

- Nenhum.

## Conferência de fontes

### Situação anterior

A conferência compara cada menção com as fontes registradas em `conversation_source`. A seleção usava título, tribunal, número de processo e texto, sem considerar a URL. Sem candidato correspondente, retornava `no_source`, exibido como "Sem fonte consultada" mesmo quando o documento tinha link. O armazenamento limitava o texto a 4.000 caracteres e a avaliação usava até 1.500 por fonte, o que podia cortar o dispositivo relevante de uma norma longa. [Seleção](../apps/web/src/lib/citations/detect.ts), [vereditos](../apps/web/src/lib/citations/verdict.ts), [avaliação](../apps/web/src/lib/citations/review.ts), [registro](../apps/web/src/lib/citations/sources.ts).

Uma reprodução confirmou que um link com `#art989`, título genérico e texto vazio produzia `no_source`; com o artigo no texto e sem avaliação, `unchecked`. As fontes já eram registradas ao fim de cada passo de busca, coberto por teste; o problema não era "fontes salvas só no fim do turno".

### Feito

- URLs entram como candidatos, cada fonte conserva até 64 mil caracteres, e o trecho do artigo é escolhido antes de limitar a avaliação.
- Uma URL sem conteúdo nunca recebe validação automática.
- Os rótulos distinguem "Link disponível; conteúdo não conferido" de "Fonte correspondente não identificada".

### Pendente

- Registrar separadamente URL descoberta, página efetivamente lida e trecho usado.
- Buscar o conteúdo da norma no serviço de fontes, com limites de rede e leitura, e extrair o dispositivo com URL, título e localização. URLs arbitrárias vindas do texto do modelo não são executadas automaticamente.
- Testes de aceitação: artigo reconhecido em lei extensa; norma de mesmo número em diploma diferente não corresponde; fonte incompleta aparece como incompleta.

### Decisões

- Indisponibilidade do avaliador continua distinta de ausência de fonte. O status de conferência não declara uma norma inexistente ou incorreta.

## Revisão humana

### Situação anterior

A aba Revisão reunia citações, pendências, verificação semântica e fontes, sem decisão persistida por item. `Conferir de novo` pedia nova análise automática; não registrava aprovação humana. [Aba](../apps/web/src/components/document/document-review.tsx).

### Feito

- Checklist por item com `Pendente`, `Confirmado` ou `Precisa de ajuste`, observação, autoria, instante e controle de revisão concorrente. [Checklist](../apps/web/src/components/document/human-checklist.tsx), [serviço](../apps/web/src/lib/document-human-review.ts).
- Aprovar não altera o veredito automático. Uma nova versão do documento exige nova revisão.
- Migração aditiva `0064_agent_files_and_human_review.sql`, aplicada em produção.
- E2e `document-human-review.e2e.ts` cobre persistência, correção, nova versão pendente e acesso anônimo negado.

### Pendente

- Nenhum.

### Decisões

- Invalidar toda a revisão da versão a cada edição é a opção conservadora inicial. A invalidação por item atingido fica para depois, se houver demanda.
- Como escritório e pessoa coincidem, o isolamento é o do titular do documento; não há outro membro do escritório decidindo por ele.

## PDF pelo agente com PDFcn

### Situação anterior

O aplicativo exportava PDF pelo caminho DOCX → LibreOffice em Node/Container; na Cloudflare, encaminhava a conversão ao processador. O catálogo do agente tinha `k5_artifacts_export_docx`, sem equivalente PDF. [Exportação PDF](../apps/web/src/lib/document-pdf.ts), [conversão](../apps/web/src/lib/document-pdf-node.ts).

### Feito

- `k5_artifacts_export_pdf` entrega link autenticado da versão atual, gerada com PDFcn e Forme 0.27.0. [Geração](../apps/web/src/lib/document-pdfcn.ts).
- O editor usa PDFcn quando não há modelo Word; modelos Word preservam o caminho DOCX/LibreOffice.
- Os layouts são componentes fixos, sem executar JSX, scripts ou imagens remotas vindas do texto. Workers encaminham a geração ao processador Node.
- Foi removido o teste de conversão real DOCX/LibreOffice (`tests/document-pdf.test.ts`), que excedia 90 s no Windows. Continuam os testes de limite de entrada e de conversor indisponível.

### Pendente

- Salvar o PDF no Cofre pela interface e pelo agente: frente [Painel de Artefatos](#painel-de-artefatos-e-salvar-no-cofre).

### Decisões

- Rodar o Forme dentro do Worker fica para depois e não entra neste PR. A geração continua no processador Node/Container.
- O caminho LibreOffice não é mais exercitado por teste automatizado.

## Painel de Artefatos e salvar no Cofre

### Situação anterior

O painel "Fontes desta conversa" serve só para escolher documentos do Cofre e referências de caso como contexto. Documentos criados pelo Lume, anexos enviados e cópias feitas pelo agente não aparecem num lugar único. A pessoa não consegue salvar no Cofre, pela interface do chat, um documento produzido na conversa. O agente consegue copiar anexos, mas não salvar um documento que ele mesmo criou. [Painel](../apps/web/src/components/agent-sources-panel.tsx).

### Objetivo

- O painel passa a se chamar **Artefatos** e lista tudo o que o Lume criou ou o que foi importado naquela conversa: documentos do Lume, anexos enviados, documentos do Cofre selecionados como contexto e cópias já salvas no Cofre.
- Na interface do chat, a pessoa salva no Cofre um documento do Lume (PDF ou DOCX) ou um anexo, escolhendo Biblioteca, caso e pasta.
- O agente faz o mesmo por ferramenta: salva documentos que criou e anexos recebidos.

### Feito

- Ferramenta `k5_vault_save_artifact`, para o agente e para a interface. Grava a versão atual de um documento do Lume no Cofre em PDF (PDFcn) ou DOCX (biblioteca `docx`, com o modelo Word). A identidade é determinística por documento, versão, formato e destino, e a procedência fica em `vault_agent_origin`. Uma versão antiga é recusada; uma nova versão vira outro arquivo. [Serviço](../apps/web/src/lib/application/vault-service.ts), [arquivo](../apps/web/src/lib/artifact-file.ts).
- A cópia para o Cofre (destino, deduplicação, reconciliação) foi extraída para um caminho único, usado pelos anexos e pelos documentos.
- Migração aditiva `0065_artifact_vault_copies.sql`: origem `artifact_docx` e índice por origem.
- `GET /api/conversations/[id]/artifacts` lista documentos da conversa, anexos já enviados e as cópias no Cofre ainda acessíveis. `POST` na mesma rota salva pela interface, pelas mesmas ferramentas do agente. [Rota](../apps/web/src/app/api/conversations/[id]/artifacts/route.ts), [consulta](../apps/web/src/lib/conversation-artifacts.ts).
- Painel **Artefatos** no lugar de Fontes: Documentos do Lume (o título abre o documento ao lado do chat), Anexos enviados, cópias no Cofre com link e "Salvar no Cofre" com formulário sob a linha. A seleção de contexto continua como "Do Cofre nesta conversa". [Painel](../apps/web/src/components/agent-artifacts-panel.tsx).
- O prompt orienta o agente a usar `k5_vault_save_artifact` para guardar documentos dele. Os textos da ajuda, do manual e do `DESIGN.md` foram atualizados.

### Pendente

- Escolher subpastas além do primeiro nível no formulário (hoje: raiz do caso e pastas de primeiro nível; o agente aceita qualquer pasta acessível).

### Decisões

- Os dois formatos usam caminhos sem LibreOffice: PDF por PDFcn e DOCX pela biblioteca `docx`.
- O PDF salvo usa o layout A4 do Lume, sem o timbrado Word; quem precisa do timbrado salva em DOCX.
- Cópias em caso compartilhado aparecem só enquanto a pessoa continua participante do caso; cópias excluídas do Cofre somem da lista.

## Memória persistente com Honcho

### Situação anterior

A indicação "Atualizou a memória" vem da memória de trabalho Mastra. Ela persiste no PostgreSQL por identidade `officeId:userId`, entre conversas, e guarda preferências e informações pessoais permitidas. O histórico fica no chat, com recuperação semântica desativada. A atualização não treina os pesos do modelo. Há ferramentas para consultar e apagar a memória. [Implementação atual](../apps/web/src/lib/agent-memory.ts).

### Objetivo

Autoaprendizado com memória persistente desde já. O Honcho acrescenta inferências e consolidação entre conversas, sem substituir a memória Mastra, que continua como fallback.

### Feito

- Adaptador server-only por REST v3, sem SDK, para rodar igual em Node e no Worker. Sem `HONCHO_API_KEY` tudo é no-op e vale só a memória de trabalho. [Adaptador](../apps/web/src/lib/honcho-memory.ts).
- **O que é enviado:** depois de cada turno, só as linhas novas da memória de trabalho Mastra, como declarações do peer `pessoa`. Essa memória já é restrita, pelas instruções do agente, ao que a pessoa disse sobre si e ao que pediu para lembrar. Documentos, anexos, resultados de ferramentas, e-mails e o transcript não saem do Lume.
- **Identidade:** um workspace por ambiente, escritório, pessoa e geração, com nome opaco (hash), e uma sessão por conversa, também opaca. O peer `pessoa` é observado; o peer `lume` não é, e ninguém observa terceiros.
- **Entrega:** outbox no PostgreSQL (`honcho_outbox`), com lease para o chat e o cron drenarem ao mesmo tempo sem duplicar. O `event_id` vai em metadata; um envio cuja resposta se perdeu fica `uncertain` e é reconciliado consultando o Honcho antes de reenviar. Erros definitivos voltam a `pending` e são descartados após 8 tentativas. O turno do chat drena ao terminar, depois que a resposta já foi entregue; o cron de cada minuto drena o restante.
- **Leitura:** antes da resposta, o Lume lê o card e a representação do peer (até 1,5 s e 2.500 caracteres) e os inclui nas instruções como inferência falível, que não autoriza ações. Timeout ou falha seguem sem esse contexto.
- **Esquecer:** `k5_memory_clear` apaga a memória de trabalho e incrementa a geração. Leitura e envio passam ao novo workspace na hora, a outbox pendente é descartada e a exclusão do workspace antigo (sessões e workspace) entra em `honcho_deletion`. Excluir uma conversa pede a exclusão da sessão dela. `accepted` registra que o Honcho aceitou o pedido, não que a exclusão terminou.
- `k5_memory_get` devolve também `inferred`, o card do Honcho, para "o que você lembra de mim".
- Migração aditiva `0066_honcho_memory.sql`. Configuração documentada em `apps/web/.env.example` e `apps/web/README.md`.

### Pendente

- **Ativar em produção:** criar a conta e a chave no Honcho e cadastrar o secret (`npx wrangler secret put HONCHO_API_KEY` em `apps/web`). Opcionalmente `HONCHO_URL` (self-host) e `HONCHO_ENVIRONMENT`.
- Medir em uso real: p50/p95 da leitura de contexto, tempo até uma memória aparecer, custo por pessoa e qualidade em pt-BR comparada à memória de trabalho.
- Confirmar com o fornecedor a exclusão das inferências derivadas e dos backups. A API v3 só aceita a exclusão de forma assíncrona.
- Tela para a pessoa ver e apagar o que o Lume aprendeu (hoje: pelo chat, com `k5_memory_get` e `k5_memory_clear`).

### Decisões

- A memória de aprendizado entra já, por decisão do produto, desligada até a chave existir. A pesquisa recomendava piloto com dados sintéticos; o risco fica reduzido porque só sobem as declarações pessoais já filtradas pela memória de trabalho, nunca conteúdo de clientes ou documentos.
- A memória Mastra continua como fonte e fallback; o Honcho não substitui nada.
- Abertas: serviço gerenciado ou self-host; contrato de privacidade (treino, região, retenção).

## Validação

Toda alteração de aplicação passa por `pnpm lint`, `pnpm typecheck`, `pnpm test` e os e2e afetados. Mudanças de rotas ou compilação também exigem `pnpm build`. O banco local tem vínculos legados de associados que bloqueiam o preflight; setup, build e e2e usam uma instância PostgreSQL temporária, preservando os dados locais.

### Evidências da primeira implementação

| Verificação | Resultado |
| --- | --- |
| `tests/chat-attachments.test.ts` | Os cinco casos passaram. |
| Reprodução de PDF sintético anexado ao chat | Texto presente, ID ausente no prompt, ID rejeitado como uploadRef, zero documentos no Cofre (situação anterior). |
| Reprodução de stream com leitor real do AI SDK | Texto antes da ferramenta (situação anterior). |
| Reprodução de seleção de fonte com link sem texto | Link isolado: `no_source`; artigo sem julgamento: `unchecked` (situação anterior). |
| `tests/citations.test.ts` | Cinco casos passaram. |
| `tests/agent-files-review.test.ts` | Quatro casos passaram: importação concorrente sem duplicação, decisões humanas e invalidação por versão, PDF A4 multipágina com pt-BR, tabela e link, link isolado sem validação. |
| `pnpm lint` | Passou, com um aviso fora desta alteração. |
| `pnpm typecheck` | Passou. |
| `pnpm build` com PostgreSQL temporário | Passou. |
| `pnpm test` com `K5_TEST_CONCURRENCY=1` | 744 de 745; a falha era a conversão DOCX/LibreOffice, depois removida. |
| E2e `chat-feedback`, `document-pdf`, `document-human-review` | Passaram. |
| Deploy de produção (03/10/2026) | Versão `96324c4d` publicada em https://lume.software; migrações 0062–0064 aplicadas; processador atualizado. |

As duas primeiras páginas de um PDF sintético foram renderizadas e inspecionadas: margens, tabelas, acentos e quebras legíveis. A implementação PDFcn usa serialização explícita para evitar identidades diferentes de componentes no carregamento CJS/ESM. Links dentro de parágrafos usam a primitiva inline do Forme, pois o wrapper de link perdia a anotação.

### Evidências das frentes novas

| Verificação | Resultado |
| --- | --- |
| `tests/conversation-artifacts.test.ts` | Dois casos passaram: salvamento concorrente sem duplicação, PDF com texto em pt-BR, DOCX, versão antiga recusada, nova versão como outro arquivo, outra pessoa e caso inexistente negados; lista de artefatos com cópias, sem anexos não enviados, sem acesso de outra pessoa ou escritório, sem cópias excluídas. |
| `tests/agent-files-review.test.ts`, `tests/chat-attachments.test.ts` | Passaram depois da extração do caminho de cópia. |
| E2e `conversation-artifacts.e2e.ts` (instância isolada) | Passou: lista, salvar DOCX com falha e "Tentar de novo", anexo pelo teclado em 390px sem rolagem horizontal, procedência conferida no banco, acesso anônimo negado. |
| E2e `chat-feedback`, `document-pdf`, `document-human-review` | Passaram depois da troca do painel e da refatoração da exportação. |
| `tests/honcho-memory.test.ts` (servidor Honcho falso) | Quatro casos passaram: só linhas novas enviadas, uma vez, para sessão opaca que observa só a pessoa; resposta perdida reconciliada por `event_id` sem reenvio; erro definitivo retentado; contexto falível, limitado a 1,5 s e ausente sem chave; esquecer troca a geração, descarta a fila e exclui o workspace antigo e a sessão da conversa excluída. |
| `pnpm test` (suíte completa, `K5_TEST_CONCURRENCY=2`) | 750 de 750 passaram, com as migrações 0065 e 0066 aplicadas do zero. |
| `pnpm lint`, `pnpm typecheck` | Passaram; resta o aviso antigo em `judicial/connectors/transport.ts`. |
