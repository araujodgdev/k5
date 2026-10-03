# Refinos do agente, memória, revisão e PDFs

Diagnóstico, implementação e pesquisa em 03/10/2026. As verificações usam dados sintéticos e PostgreSQL isolado. As pesquisas de [Honcho](research/honcho-lume-2026-10-03.md) e [PDFcn](research/pdfcn-lume-2026-10-03.md) detalham as dependências externas.

## Implementado no código

- `k5_vault_import_chat_attachment` copia originais desta conversa para o destino autorizado. O manifesto informa IDs de todos os arquivos presentes no contexto, inclusive documentos cujo texto excede o orçamento. A identidade por origem e destino impede duplicação por concorrência e reconcilia uma gravação cuja resposta se perdeu. A cópia possui armazenamento próprio, SHA-256 e procedência.
- A atividade das ferramentas aparece acima da resposta durante execução e no histórico. Chamadas da mesma identidade ficam em grupos expansíveis por teclado, com resultados, falhas e links individuais.
- A conferência considera URLs como candidatos, conserva até 64 mil caracteres por fonte e escolhe o trecho do artigo antes de limitar a avaliação. Uma URL sem conteúdo não recebe validação automática. O rótulo distingue link não conferido de fonte correspondente não encontrada.
- A aba Revisão possui checklist humano com decisões, observações, autoria, instante e revisão concorrente. Aprovar não altera o veredito automático. Uma nova versão exige nova conferência. A migração aditiva é `0064_agent_files_and_human_review.sql`.
- `k5_artifacts_export_pdf` entrega link autenticado da versão atual para geração com PDFcn e Forme 0.27.0. O editor usa PDFcn quando não há modelo Word; modelos Word preservam o caminho DOCX/LibreOffice. Layouts são componentes fixos, sem executar JSX, scripts ou buscar imagens remotas fornecidas no texto. Workers encaminham a geração para o processador Node.
- Honcho continua como pesquisa e proposta de integração. Nenhuma conversa real foi enviada a esse serviço e a memória Mastra atual foi preservada.

As descrições de falhas abaixo registram a situação anterior à implementação. As propostas preservam os critérios de aceitação e os trabalhos futuros. O manifesto segue a janela de contexto do chat; anexos de mensagens fora dessa janela não são expostos ao modelo. A exportação PDF oferece download e não arquiva automaticamente o PDF no Cofre. Anexos gráficos em Markdown são representados por seu texto, sem carregar recursos remotos.

## Anexos do chat para o Cofre

O problema está confirmado. O upload no chat persiste os bytes e a extração em `ai_chat_attachment`, com acesso por pessoa, escritório e conversa. Ele devolve `attachmentId`, não uma referência de upload do Cofre. A ferramenta `k5_vault_ingest_upload` exige `uploadRef`, que só vale quando existe em `vault_upload_ref`. Não há uma ferramenta que faça a ponte entre esses dois recursos. [Anexos](../apps/web/src/lib/chat-attachments.ts), [contrato da ingestão](../apps/web/src/lib/capabilities/contracts.ts), [referências de upload](../apps/web/src/lib/application/uploads-service.ts).

Há uma segunda lacuna: o prompt inclui `attachmentId` para imagens, mas para PDFs e outros documentos inclui somente nome e texto extraído. Por isso, reenviar um PDF não habilita a operação pretendida. O problema não é ausência dos bytes. [Montagem do prompt](../apps/web/src/lib/chat-prompt.ts).

Uma reprodução com PDF sintético confirmou que o modelo recebe o texto, não recebe o ID, o ID do anexo é rejeitado como `uploadRef` e o Cofre continua com zero documentos. A suíte existente também confirma que anexos permanecem privados e não criam documentos no Cofre. [Teste existente](../apps/web/tests/chat-attachments.test.ts).

### Implementação proposta

1. Expor um manifesto com identificador opaco, nome e tipo de todos os anexos disponíveis na conversa, mesmo quando o orçamento de contexto omitir sua extração.
2. Adicionar `k5_vault_import_chat_attachment` com `attachmentId` e destino. A operação copia um original existente no chat para a Biblioteca, um caso ou uma pasta explicitamente escolhidos. A implementação usa identidade determinística por origem e destino para evitar duplicações, sem uma chave fornecida pelo modelo.
3. Resolver a origem pela pessoa e pelo escritório autenticados e confirmar que o anexo pertence à conversa atual. Resolver o destino pelas permissões de caso e pasta. Não aceitar caminhos, URLs de armazenamento ou escritório fornecidos pelo modelo.
4. Preservar a identidade do escritório de origem quando o destino for um caso compartilhado. O escopo de destino pode mudar `officeId`; isso não muda a propriedade do anexo pessoal. [Escopo compartilhado](../apps/web/src/lib/collaboration/access.ts).
5. Criar uma cópia com chave de armazenamento própria do Cofre, hash e procedência. Não compartilhar a mesma chave do chat, porque excluir a conversa remove os seus originais. [Exclusão da conversa](../apps/web/src/app/api/conversations/[id]/route.ts).
6. Reusar a criação do documento e a fila de extração/indexação. Retornar documento, destino e estado real. Somente após persistência o agente pode dizer que salvou. Reenvios da mesma origem para o mesmo destino devem retornar a cópia existente.

Aceitação: importar PDF por pedido no chat sem reenviar bytes; preservar nome e conteúdo; repetir chamada sem duplicar; negar origem de outro usuário/conversa; negar pasta inacessível; manter o documento ao excluir o chat; mostrar link para o documento e eventual falha de processamento.

## Ordem e agrupamento das ferramentas

O servidor emite `text-start` antes de qualquer resultado de ferramenta. O AI SDK cria imediatamente uma parte de texto, e os resultados são acrescentados depois. Os deltas posteriores preenchem a parte que já estava na primeira posição. Uma reprodução com o leitor real do AI SDK produziu `['text', 'data-tool']`, embora a ferramenta tivesse terminado antes da resposta. O componente renderiza as partes nessa ordem. [Stream](../apps/web/src/lib/chat-turn.ts), [renderização](../apps/web/src/components/agent-chat.tsx).

O histórico persistido usa outra ordem: ferramentas primeiro e texto depois. Portanto, o mesmo turno pode mudar de posição quando a conversa é recarregada. Não é uma decisão do modelo sobre a apresentação.

### Implementação proposta

Renderizar a atividade em uma região estável acima da resposta, tanto no stream quanto no histórico. Adiar a abertura do texto até existir um delta também evita o bloco vazio inicial, mas não substitui a regra de apresentação quando o modelo escreve uma introdução antes de agir.

Agrupar chamadas concluídas da mesma ferramenta em uma linha expansível, por exemplo `Pesquisou na web · 4 chamadas`. A expansão preserva cada resultado, ordem, link e falha. Não agrupar por texto do rótulo: várias ferramentas desconhecidas recebem o mesmo rótulo genérico. Aprovações humanas permanecem controles independentes. Documentos criados mantêm seus links visíveis. Os nomes desconhecidos precisam de rótulos úteis a partir do catálogo, sem mostrar apenas `Executou uma operação`. [Rótulos](../apps/web/src/lib/agent-tools/index.ts).

Aceitação: ordem igual durante execução, conclusão e recarga; agrupamento por identidade real da ferramenta; falhas visíveis; links preservados; expansão por teclado; sem rolagem horizontal em 390px; estados de processamento e interrupção coerentes.

## Por que existe link e aparece "Sem fonte consultada"

A conferência não usa qualquer URL escrita no documento como prova de consulta. Ela compara cada menção com fontes registradas em `conversation_source`. A seleção inicial usa título, tribunal, número de processo e texto; não considera a URL nem um fragmento do link. Se não houver candidato correspondente, retorna `no_source`. Se houver candidatos, o avaliador ainda precisa reconhecer a mesma autoridade e avaliar a sustentação do parágrafo. [Seleção](../apps/web/src/lib/citations/detect.ts), [vereditos](../apps/web/src/lib/citations/verdict.ts), [avaliação](../apps/web/src/lib/citations/review.ts).

Uma reprodução confirmou que um link com `#art989`, título genérico do código e texto vazio produz `no_source`. Quando o texto consultado contém o artigo, o candidato passa a existir, mas sem avaliação o estado é `unchecked`. Link, leitura de conteúdo e confirmação de sustentação são etapas distintas.

A busca do provedor pode devolver somente título e link. O armazenamento limita o texto a 4.000 caracteres e a avaliação usa até 1.500 por fonte; uma norma longa pode perder o dispositivo relevante nesses cortes. A escolha do trecho precisa preceder a truncagem. O código já registra fontes ao terminar cada passo de busca, antes da ferramenta seguinte de documento; há um teste que cobre essa sequência. Não atribuir o problema genericamente a "fontes salvas só no fim do turno". [Registro](../apps/web/src/lib/citations/sources.ts), [busca](../apps/web/src/lib/citations/web-step.ts), [teste](../apps/web/tests/citations.test.ts).

O print não permite saber qual dessas condições ocorreu naquela conversa. Para fechar o caso individual, verificar o rastro do turno e o conteúdo registrado para cada dispositivo. Não declarar a norma inexistente, falsa ou juridicamente incorreta com base nesse status.

### Implementação proposta

Registrar separadamente URL descoberta, página efetivamente lida e trecho usado. A busca deve consultar o conteúdo da norma e extrair o dispositivo relevante, preservando URL, título e localização. Não executar automaticamente URLs arbitrárias vindas do texto do modelo. Aplicar os limites de rede e leitura no serviço que busca fontes.

Quando há somente URL, comunicar `Link disponível; conteúdo não conferido`. Quando não se encontra correspondência na base de fontes, comunicar `Fonte correspondente não identificada`. Manter a pendência e a possibilidade de conferência humana, sem promover uma URL isolada ao estado `verified`.

Aceitação: artigo correspondente reconhecido em lei extensa; link isolado não aprova citação; norma de mesmo número e diploma diferente não corresponde; fonte incompleta aparece como incompleta; indisponibilidade do avaliador continua distinta de ausência de fonte.

## Revisão como checklist humano

A aba atual reúne citações, pendências, verificação semântica e fontes. Ela não oferece uma decisão persistida por item. `Conferir de novo` pede uma nova análise automática; não registra aprovação humana. O painel de sustentação nas fontes também é um relatório automático. [Aba](../apps/web/src/components/document/document-review.tsx), [verificação](../apps/web/src/components/document-verification.tsx), [rota de conferência](../apps/web/src/app/api/artifacts/[id]/citations/route.ts).

### Implementação proposta

Cada item deve apresentar o trecho completo, a fonte, o resultado automático e uma decisão humana separada: `Pendente`, `Confirmado` ou `Precisa de ajuste`. Salvar pessoa, instante, observação, versão do documento e identidade do item. Usar identificador estável baseado no conteúdo e contexto, não apenas os índices `c0`, `c1` da detecção atual.

O checklist cobre citações e pendências de conteúdo, inclusive informações ausentes e condições apresentadas pelo agente como propostas. Aprovar manualmente não reescreve o resultado automático como validado pela IA. Uma confirmação com fonte ausente mantém registrada essa condição e a justificativa do responsável. O agente pode consultar a revisão, mas não assinar como humano.

O contador mostra itens sem decisão aplicável à versão atual. Edição de texto ou mudança relevante da fonte invalida as decisões atingidas; inicialmente, invalidar toda a revisão da versão é uma opção conservadora. Não reutilizar a aprovação de um contrato anterior para uma nova versão silenciosamente. Registrar a conclusão da revisão e permitir voltar uma decisão a pendente.

Aceitação: marcar e recarregar preserva decisão; outro usuário não decide pelo titular; nova versão exige revisão; agrupamentos de norma/artigo preservam evidência; decisões concorrentes não se sobrescrevem silenciosamente; teclado e toque funcionam; erro ao salvar mantém pendência e permite tentar novamente.

## Memória Honcho

A indicação "Atualizou a memória" vem da memória de trabalho Mastra já implementada. Ela persiste no PostgreSQL por identidade `officeId:userId`, entre conversas, e guarda preferências e informações pessoais permitidas. O histórico fica no chat, com recuperação semântica desativada. Essa atualização não treina os pesos do modelo. Há ferramentas para consultar e apagar a memória. [Implementação atual](../apps/web/src/lib/agent-memory.ts).

A memória atual continua pessoal por escritório e usuário. Honcho acrescentaria inferências e consultas de contexto entre conversas, mas não resolveria a importação no Cofre, a apresentação das ferramentas ou a validação das fontes jurídicas. A proposta usa integração de backend por SDK/REST, ingestão assíncrona e memória atual como fallback. [Pesquisa completa](research/honcho-lume-2026-10-03.md).

O piloto deve usar dados sintéticos até resolver exclusão de inferências derivadas e condições do serviço gerenciado. Definir explicitamente categorias pessoais permitidas antes de enviar mensagens. Documentos, clientes e resultados de ferramentas não entram automaticamente no perfil da pessoa.

## Geração de PDF pelo agente com PDFcn

Antes desta alteração, o aplicativo exportava PDF pelo caminho DOCX → LibreOffice em Node/Container; na Cloudflare, encaminhava a conversão para o processador. O catálogo do agente oferecia `k5_artifacts_export_docx`, sem equivalente PDF. [Exportação PDF](../apps/web/src/lib/document-pdf.ts), [conversão](../apps/web/src/lib/document-pdf-node.ts), [ferramenta DOCX](../apps/web/src/lib/application/artifacts-service.ts).

A integração pedida é um caminho de geração PDF com componentes PDFcn mantidos no projeto. O agente solicita a geração de um artefato salvo; o servidor valida propriedade e versão, escolhe componentes e layout aprovados e produz os bytes. O texto do modelo não pode virar JSX executável. Guardar a saída como arquivo versionado e, quando solicitado, importar no destino autorizado do Cofre, com nome, hash e procedência.

A integração usa o namespace `forme/` do PDFcn, com `@formepdf/react` e `@formepdf/core` no processador Node/Container. Os testes confirmaram paginação A4, texto em pt-BR, tabelas e links. A compatibilidade do bundle remoto com Workers ainda precisa de compilação e teste no runtime real. [Instalação oficial](https://www.pdfcn.dev/docs/installation), [geração programática](https://docs.formepdf.com/quickstart).

Preservar a exportação DOCX existente. Um template Word não vira automaticamente um layout PDFcn fiel; o relatório da dependência deve definir o motor e a estratégia de compatibilidade. [Pesquisa PDFcn](research/pdfcn-lume-2026-10-03.md).

Aceitação: PDF multipágina A4 com pt-BR, texto pesquisável/selecionável, links, tabelas e quebras corretas; original disponível no Cofre; versão exportada identificada; repetição sem duplicação; falhas não anunciadas como sucesso; renderização inspecionada em desktop e celular.

## Sequência de implementação e validação

1. Ponte chat → Cofre e manifesto de anexos. Testar limites de origem, destino, idempotência e exclusão independente.
2. Ordem estável e grupos de ferramentas. Executar e2e em desktop e celular, durante stream e após recarga.
3. Registro de leitura/trechos de normas e clareza dos estados. Executar testes de correspondência e sustentação sem substituir evidência por URL.
4. Checklist humano persistido e associado à versão. Adicionar migração e testes de autoria, concorrência e invalidação; verificar fluxo e2e.
5. PDFcn e ferramenta PDF do agente. Fazer prova do motor no runtime de produção e conferir páginas, texto, links e ACLs dos originais.
6. Honcho em piloto controlado, comparar qualidade, custo e latência com a memória atual e fechar as condições de exclusão antes de dados reais.

Todas as alterações de aplicação devem passar por `pnpm lint`, `pnpm typecheck`, `pnpm test` e os e2e afetados. Mudanças de rotas/compilação também exigem `pnpm build`, seguindo o setup existente. O banco local existente bloqueia o preflight por vínculos legados de associados. Seus dados foram preservados; setup, build e e2e usam uma instância PostgreSQL temporária.

## Evidências executadas

| Verificação | Resultado |
| --- | --- |
| Suíte `tests/chat-attachments.test.ts`, executada junto à reprodução temporária | Os cinco casos da suíte passaram; a falha inicial do carregador ficou restrita à reprodução em `.data/`. |
| Reprodução de PDF sintético anexado ao chat | Passou. Texto presente, ID ausente no prompt, ID rejeitado como uploadRef, zero documentos no Cofre. |
| Reprodução de montagem de stream com leitor real do AI SDK | Passou. Ordem observada: texto antes de ferramenta. |
| Reprodução de seleção de fonte com link sem texto | Passou. Link isolado: no_source; artigo presente sem julgamento: unchecked. |
| `pnpm --filter @k5/web test tests/citations.test.ts` | Cinco casos passaram, inclusive disponibilidade da fonte para a ferramenta de documento seguinte. |
| `pnpm --filter @k5/web test tests/agent-files-review.test.ts` | Quatro casos passaram. O caso de importação usa PDF real, manifesta seu ID no prompt, preserva os bytes e impede duplicação por concorrência. |
| `pnpm lint` | Passou. Um aviso de variável sem uso em `judicial/connectors/transport.ts`, fora desta alteração. |
| `pnpm typecheck` | Passou, além da checagem TypeScript no build isolado. |
| `pnpm build` com PostgreSQL temporário | Passou. O banco original não foi modificado. |
| `pnpm test` com `K5_TEST_CONCURRENCY=1` | 744 de 745 testes passaram. A única falha foi a conversão real DOCX/LibreOffice, por timeout de 90 segundos. |
| E2e `chat-feedback.e2e.ts` | Dois casos passaram, com agrupamento, ordem da atividade e teclado em desktop e celular. |
| E2e `document-pdf.e2e.ts` | Passou, com download PDF, versão desatualizada, anonimato, tela móvel e falha de conversão. |
| E2e `document-human-review.e2e.ts` | Passou, com persistência, correção, nova versão pendente e acesso anônimo negado. |
| Links relativos das pesquisas e do relatório | 53 referências existentes. |
| Conversor legado `tests/document-pdf.test.ts` | Um caso passou e um falhou. LibreOffice 26.2.5.2 excedeu 90 segundos na conversão real de DOCX com timbrado. A repetição com `soffice.com` também falhou pelo limite de tempo. |

O diagnóstico inicial passou nas 13 verificações acima. Depois da implementação, os quatro testes de `agent-files-review.test.ts` passaram: importação concorrente sem duplicação e preservação após excluir o chat; decisões humanas, concorrência e invalidação por versão; PDF multipágina A4 com pt-BR, tabela e link clicável; link isolado sem validação de sustentação. As cinco verificações existentes de anexos e as cinco de citações também passaram.

O primeiro ensaio da reprodução de PDF em `.data/` encontrou um erro interno do carregador do Node 26; a execução no diretório normal de testes terminou com código zero. A implementação PDFcn usa serialização explícita para evitar identidades diferentes de componentes no carregamento CJS/ESM, que inicialmente geravam documentos sem páginas. Links dentro de parágrafos usam a primitiva inline nativa do Forme, pois o wrapper de link da biblioteca perdia a anotação nesse contexto.

As duas primeiras páginas de um PDF sintético foram renderizadas e inspecionadas visualmente. Margens, tabelas, acentos e quebras ficaram legíveis. Os e2e do checklist inicialmente encontraram seletores incorretos no teste: `selectOption` usa o rótulo visível e o indicador "Salvo" fica oculto no celular. O teste corrigido passou. Nenhum resultado de ambiente Cloudflare remoto foi presumido a partir do teste Node.

A primeira execução da suíte geral foi interrompida por disputa de memória com builds em andamento. A repetição de `pnpm test` usou `K5_TEST_CONCURRENCY=1` e terminou com 744 casos aprovados e uma falha. A conversão DOCX/LibreOffice utiliza módulos que não foram alterados nesta implementação e permanece uma limitação observada no ambiente Windows. A documentação oficial recomenda `soffice.com` para uso de console, mas essa troca sozinha não resolveu o timeout observado. [Parâmetros do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).

Os scripts temporários de verificação foram removidos. Nenhuma publicação ou migração no banco original foi executada.
