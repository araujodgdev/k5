# Cloudflare AI Search: pesquisa para o Lume

Data da consulta: 2026-09-30. Escopo: documentação oficial, planejamento e limitações. Nenhuma conta Cloudflare foi acessada e nenhum código foi implementado.

Na conversa, o usuário reservou AI Search para uma modalidade futura. A primeira modalidade, Marcas Registradas, usará Browser Run para consultar a WIPO; seu [plano está separado](plano-pesquisa-direcionada-marcas.md).

## O que o serviço oferece

AI Search gerencia ingestão, conversão para Markdown, divisão em trechos, índices e recuperação. A indexação é assíncrona; a consulta é síncrona. Pode usar busca semântica com embeddings, busca por palavras com BM25 ou ambas. A geração de resposta é opcional. [Funcionamento](https://developers.cloudflare.com/ai-search/concepts/how-ai-search-works/)

Cada instância possui armazenamento e índice próprios, gerenciados com R2 e Vectorize. Recebe uploads pelo Items API e pode também conectar um site ou bucket R2. O armazenamento interno pode coexistir com uma fonte externa. [Armazenamento interno](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)

Há uma diferença entre os padrões documentados: a configuração de índices habilita vetores e desabilita palavras por padrão, enquanto o guia do binding declara `retrieval_type: hybrid` como padrão da chamada. Para uma implementação, definir `index_method` e `retrieval_type` explicitamente e verificar sua compatibilidade. [Busca por palavras](https://developers.cloudflare.com/ai-search/configuration/indexing/keyword-search/), [binding de busca](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)

## Ingestão, atualização e exclusão

- O Items API envia arquivos ao armazenamento interno. O nome vira a chave do item; a chave é única por fonte, não necessariamente por instância. Consultar por `key` e `source` evita ambiguidade entre upload e fonte externa. [Items REST](https://developers.cloudflare.com/ai-search/api/items/rest-api/)
- `items.upload()` retorna antes do processamento terminar. `uploadAndPoll()` espera o processamento, com timeout configurável. Estados incluem `queued`, `running`, `completed`, `error`, `skipped` e `outdated`. `items.delete()` remove o item e os trechos indexados; o binding permite baixar o original. Portanto, "indexação imediata" significa iniciar o processamento, não garantir disponibilidade no retorno do upload. [Items binding](https://developers.cloudflare.com/ai-search/api/items/workers-binding/)
- A referência também expõe `PUT .../items` para criar ou atualizar um item indexado e `PATCH .../items/{item_id}` para sincronizar um item. Isso não comprova substituição atômica do conteúdo de um upload repetido, nem ausência de resultados antigos durante a atualização. Esses contratos precisam de verificação em uma prova técnica. [Referência de Items](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/)
- Site e R2 usam jobs que detectam arquivos novos, modificados e excluídos. O intervalo padrão é 6 horas; a narrativa lista 1, 2, 4, 6, 12 ou 24 horas. Um job pode ser disparado pelo app, com mínimo de 30 segundos entre disparos. Uploads internos não usam esses jobs. Após 31 dias sem consultas, o serviço pausa a sincronização externa; o índice continua pesquisável, mas pode estar desatualizado. [Sincronização](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/)
- Excluir uma instância conectada a R2 remove seu índice e preserva os objetos externos. No bucket compartilhado, uma instância por escritório pode restringir a ingestão a um prefixo por path filtering. [Multitenancy](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/)

Para R2, usar extensão reconhecida ou `Content-Type` suportado. A documentação rejeita MIME ausente, inválido e `application/octet-stream` para objetos sem extensão reconhecida. Metadados personalizados vêm de `x-amz-meta-*` ou `customMetadata`, com esquema prévio; valores incompatíveis com o tipo podem ser ignorados silenciosamente. [Fonte R2](https://developers.cloudflare.com/ai-search/configuration/data-source/r2/)

## Formatos e limites

Arquivos têm limite de 4 MB. São aceitos texto, Markdown e formatos de código, além de PDF, HTML, XML, imagens, CSV, DOCX, XLS/XLSX e variantes, ODT/ODS e Numbers. Formatos ricos passam por conversão para Markdown; imagens usam modelos de detecção e descrição. Arquivos maiores são ignorados e aparecem nos logs. Essa lista não assegura precisão de OCR, tabelas, paginação ou leitura de autos digitalizados. [Tipos de arquivo](https://developers.cloudflare.com/ai-search/configuration/data-source/)

| Cota | Workers Free | Workers Paid |
| --- | --- | --- |
| Instâncias por conta | 100 | 5.000 |
| Namespaces por conta | 100 | 100 |
| Arquivos por instância | 100.000 | 1 milhão; 500.000 com busca híbrida |
| Consultas mensais | 20.000 | Sem limite documentado |
| Instâncias em uma consulta conjunta | 10 | 10 |
| Páginas rastreadas por dia | 500 | Sem limite documentado |

Durante o open beta, AI Search é gratuito dentro das cotas. Armazenamento, indexação e Browser Run usado pelo crawler estão incluídos. Workers AI e AI Gateway têm cobrança separada. A Cloudflare promete anunciar preços com pelo menos 30 dias de antecedência; a documentação não fornece preço definitivo após o beta. [Limites e preços](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)

## APIs e modelos

As APIs atuais usam `/accounts/{account_id}/ai-search/namespaces/{namespace}/instances/{id}`. `POST /search` devolve trechos para exibição ou geração pelo modelo do app. `POST /chat/completions` recupera contexto e gera uma resposta. Aceitam `messages`; `/search` também aceita `query`. [Search REST](https://developers.cloudflare.com/ai-search/api/search/rest-api/)

Há consulta conjunta pelo namespace, com resultados mesclados e identificação da instância de origem de cada trecho. [Nota de lançamento de 16/04/2026](https://developers.cloudflare.com/ai-search/platform/release-note/)

Os bindings atuais são `ai_search`, por instância, e `ai_search_namespaces`, por namespace. O namespace é um agrupamento lógico; seu binding concede acesso a todas as instâncias contidas nele. Deve permanecer em código servidor confiável. [Namespaces](https://developers.cloudflare.com/ai-search/concepts/namespaces/)

O binding oferece `max_num_results` de 1 a 50 e `context_expansion` de 0 a 3 para adicionar trechos vizinhos. Resultados vêm em `chunks`, com texto, score e referência ao item. [Binding de busca](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)

Workers AI é suportado nativamente. Outros provedores usam chaves no AI Gateway. O modelo de embedding é definido na criação e não muda depois; o de geração pode mudar e receber override por consulta. Smart Default pode trocar o modelo automaticamente. [Modelos](https://developers.cloudflare.com/ai-search/configuration/models/)

A lista suportada inclui embeddings OpenAI `text-embedding-3-small/large`, Google `gemini-embedding-001` e modelos Workers AI, além de geração Anthropic, OpenAI, Google e outros. Não assumir que todo modelo disponível no provedor é aceito no AI Search. A qualidade em pt-BR e documentos jurídicos exige avaliação com nosso acervo. [Modelos suportados](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/)

## Fontes e citações

Os trechos retornam `id`, `text`, `score`, `item.key`, `item.timestamp`, metadados e detalhes de ranking. Consultas conjuntas identificam `instance_id`. Esses campos permitem exibir fontes, mas não garantem que cada afirmação gerada tenha uma citação correta, nem uma página exata do PDF. [Citações](https://developers.cloudflare.com/ai-search/how-to/chunk-citations/)

Para o Lume, a chave externa deve mapear para o documento autorizado e sua versão. Downloads e abertura de fontes precisam das mesmas permissões da consulta. Essa é uma decisão de integração do app, não uma garantia do provedor.

## Isolamento por escritório

A Cloudflare recomenda uma instância por tenant. A alternativa compartilhada depende de filtro obrigatório em cada consulta. Para o Lume, o escritório deve vir de `requireWorkspace()` e da sessão autenticada. O `x-tenant-id` do tutorial é apenas exemplo; não concede autorização. As regras locais exigem escopo por `office_id` nas operações protegidas. [Multitenancy](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/), [instruções do repositório](../AGENTS.md)

Filtros são aplicados antes da recuperação. `$in` compara um valor escalar com candidatos; arrays armazenados não são filtráveis. Strings só têm os primeiros 64 bytes UTF-8 filtráveis. Metadados personalizados precisam de esquema e permitem até cinco campos; cada vetor tem envelope total de 10 KiB, incluindo dados do sistema. Mudar o esquema reindexa todos os documentos. [Filtros](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/), [metadados](https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/)

Uma instância por escritório separa os escritórios, mas não resolve acesso por caso, documento ou usuário dentro do escritório. Essa política precisa ser projetada no Lume, inclusive para associados e revogação de acesso. Evitar transportar ACLs como listas de usuários em metadados, pois arrays não atendem esse filtro.

Endpoints públicos respondem sem autenticação. Cloudflare Access pode proteger um domínio próprio, mas o hostname padrão continua acessível se não for desabilitado. Para documentos privados, usar o backend do Lume como mediador de sessão, escritório e permissões. [Endpoint público](https://developers.cloudflare.com/ai-search/api/search/public-endpoint/)

O cache de respostas tem TTL padrão de 48 horas e vínculo aos trechos: alteração ou exclusão desses trechos invalida respostas relacionadas. A documentação consultada não demonstra chave de cache por usuário/ACL nem invalidação por mudança de permissão sem alteração do conteúdo. Até validar esse contrato, desabilitar cache de geração em consultas privadas ou projetar invalidação explícita. [Cache](https://developers.cloudflare.com/ai-search/configuration/retrieval/cache/)

## Diferenças do legado AutoRAG

`/autorag/rags/...` e `env.AI.autorag()` continuam funcionando, mas as novidades ficam nas APIs atuais. O legado usa `query` e retorna `data`; o novo aceita `messages` e retorna `chunks`. No streaming atual, um evento `chunks` precede a resposta gerada. [Migração REST](https://developers.cloudflare.com/ai-search/api/migration/rest-api/), [migração do binding](https://developers.cloudflare.com/ai-search/api/migration/workers-binding/)

Filtros atuais ficam em `ai_search_options.retrieval.filters` e usam `$eq`, `$in`, `$gte` e outros operadores. Atualizar permissões de token AutoRAG para AI Search. Exemplos antigos com `/ai-search/instances/` também devem ser conferidos contra os guias atuais com namespace. [Migração REST](https://developers.cloudflare.com/ai-search/api/migration/rest-api/)

## Perguntas que uma prova técnica precisa responder

1. Como representar documentos acima de 4 MB sem perder identidade, páginas e versões?
2. Qual a qualidade da conversão de PDFs digitalizados, tabelas e referências jurídicas em pt-BR?
3. Quando um upload substituído ou uma exclusão deixa de aparecer em busca e em respostas em andamento?
4. Como impor permissões por caso e revogar acesso imediatamente, inclusive com cache?
5. Quanto custam embeddings, conversão, reranking e geração no volume real do Lume?
6. Como controlar provisionamento, falhas de indexação, reprocessamento e exclusão ao encerrar um escritório?

Essas perguntas permanecem abertas porque a leitura da documentação não mede o comportamento do serviço nem define a feature desejada pelo usuário.
