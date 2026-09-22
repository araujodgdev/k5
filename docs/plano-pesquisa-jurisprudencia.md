# Plano de implementação: Pesquisa e acervo de jurisprudência

Data: 22/09/2026. Estado: implementação em andamento. Este documento conserva as decisões e os critérios de aceite; as seções no futuro descrevem requisitos, e a seção 16 registra o estado operacional e as lacunas do piloto.

## 1. Objetivo e decisões de produto

Criar o módulo **Pesquisa**, no qual o usuário encontra julgados por tema, consulta ementas e inteiro teor disponível e adiciona referências a casos do escritório após uma avaliação de pertinência pelo TypeSafe. Os resultados consultados alimentam um acervo incremental, com origem, versões e deduplicação.

O primeiro tema de validação é **guarda judicial de criança ou adolescente para a avó**. A [amostra já pesquisada](acervo-jurisprudencia-guarda-avo.md) fornece casos de concessão, manutenção e negativa, além da diferença entre avó e avô.

Decisões confirmadas na conversa:

- Entrada por temática, sem exigir número de processo conhecido.
- Fontes públicas e conteúdo efetivamente disponibilizado pelos tribunais.
- Persistência incremental dos achados e reutilização do acervo.
- Escolha de um caso para avaliação de compatibilidade e vínculo pelo usuário.
- Pertinência e relação com a tese são avaliações distintas; decisões contrárias permanecem pesquisáveis.
- Acervo público compartilhado entre os escritórios, com pesquisas, casos, anotações e avaliações privados.
- Obtenção e indexação automáticas do inteiro teor disponível para a página de resultados consultada.

Decisões respondidas pelo usuário durante o planejamento:

| Escolha | Decisão |
| --- | --- |
| Compartilhamento | Acervo público compartilhado entre escritórios; pesquisas, casos, avaliações e anotações privados |
| Obtenção do inteiro teor | Automática para os julgados da página consultada, em segundo plano, com limites e sem percorrer páginas não solicitadas |

Essas decisões definem a implementação. A ativação de fontes continua condicionada às permissões registradas pelo operador; instalar código e migrações não ativa coleta real.

## 2. Escopo da primeira entrega

Inclui pesquisa local e no TJDFT, histórico privado, persistência dos resultados, obtenção automática do conteúdo disponível por página consultada, leitor de ementa/inteiro teor, processamento durável, avaliação TypeSafe e referências vinculadas aos casos. Inclui o consumo de referências explicitamente selecionadas no Lume e na preparação de minutas, preservando a seleção de citações existente.

O STJ usa descoberta CKAN e ingestão explícita de recursos, seguida de busca local. Não tratá-lo como uma API de pesquisa temática equivalente à do TJDFT. A integração por recursos está no código; sua validação ao vivo com canário oficial permanece separada dos testes com fixtures.

Ficam para expansão: varredura nacional, monitoramento automático de temas, acesso autenticado a autos, peças não públicas, cálculo de prazo e alteração do provedor do banco de negócio. A coleta inicial cresce com páginas e materiais efetivamente solicitados.

## 3. Base e pontos de integração

| Área conferida no código | Integração da Pesquisa |
| --- | --- |
| [`/app/research`](../apps/web/src/app/app/research/page.tsx) | Pesquisa implementada em rota própria; Agenda mantém suas rotas |
| [Navegação compartilhada](../apps/web/src/lib/navigation.ts) | Pesquisa na sidebar e no menu Mais; mantidas as quatro abas móveis |
| [Banco](../apps/web/src/lib/database.ts) e [interface assíncrona](../apps/web/src/lib/db/types.ts) | SQLite em Node e D1 em Workers; usar `prepare` e `batch`, sem transações interativas ou API síncrona nova |
| [Fontes judiciais](../apps/web/src/lib/judicial/contracts.ts) | Instalação, proveniência e permissões reutilizadas com operações próprias para julgados |
| [Coleta judicial](../apps/web/scripts/judicial-worker.ts) | DJEN e jobs de Pesquisa têm filas e operações próprias; pesquisa temática TJDFT não usa `listChanges` de publicações |
| [Transporte judicial](../apps/web/src/lib/judicial/connectors/transport.ts) | Hosts, redirects e limites validados; resposta binária preserva PDFs |
| [Armazenamento do corpus](../apps/web/src/lib/research/storage.ts) | Chaves públicas próprias, sem escritório fictício e sem afrouxar a validação do Cofre |
| [Busca do acervo](../apps/web/src/lib/research/retrieval.ts) | FTS5 próprio percorre o corpus sem o corte de 400 documentos do Cofre |
| [Índice vetorial](../apps/web/src/lib/knowledge/vector-index.ts) | Continua privado por escritório; o corpus público usa índice lexical no MVP |
| [TypeSafe](../apps/web/src/lib/typesafe/client.ts) | Cifra, orçamento e auditoria reutilizados com finalidade e configuração independentes para Pesquisa |
| [Minutas](../apps/web/src/lib/document-workflows.ts) | Referências selecionadas entram como fontes versionadas, com autorização humana das citações |

O vocabulário de produto está em [CONTEXT.md](../CONTEXT.md). Em particular, caso do escritório, processo judicial, julgado e material do julgado têm identidades diferentes.

## 4. Módulos e interfaces

Implementação em `apps/web`, com uma interface de aplicação em `src/lib/application/research-service.ts` e comportamento interno em `src/lib/research/`. Não criar outro app ou pacote compartilhado sem segundo consumidor.

| Módulo proposto | Responsabilidade |
| --- | --- |
| `research/contracts.ts` | Entradas e saídas tipadas, estados, identidades e erros |
| `research/sources/tjdft.ts` | Consulta, normalização e obtenção dos materiais publicados pelo TJDFT |
| `research/catalog.ts` | Identidade do julgado, materiais, versões, proveniência e admissão no acervo |
| `research/jobs.ts` | Fila privada de pesquisa/coleta/processamento, leases e idempotência |
| `research/retrieval.ts` | Busca do corpus, filtros, trechos e ordenação de candidatos |
| `research/storage.ts` | Originais públicos com chaves geradas pelo servidor |
| `research/case-references.ts` | Perfil do caso, avaliações e referências escolhidas |
| `typesafe/research.ts` | Perguntas, composição dos resultados e estados da avaliação |

O adaptador de fonte terá três operações: `searchJudgments`, `getJudgment` e `fetchMaterial`. Recebe instalação e filtros normalizados ou identificadores resolvidos no servidor; retorna registros, disponibilidade, proveniência e cursor opaco. A UI não fornece host, URL arbitrária, cabeçalhos ou credenciais.

A interface pública esconde paginação da fonte, persistência, recuperação de jobs e diferenças de formatos. Os testes de comportamento atravessam essa mesma interface, com transporte e TypeSafe controlados nos testes.

## 5. Modelo de dados

Usar novas migrações após o último número disponível no momento da execução; não reescrever migrações aplicadas. As tabelas abaixo descrevem o modelo a implementar, não tabelas já existentes.

### Acervo público de referência

| Entidade | Conteúdo e invariantes |
| --- | --- |
| `research_judgment` | Fonte, identificador externo do julgado, tribunal, processo de origem, classe, órgão, relatoria, datas, situação e revisão dos metadados. Unicidade por instalação e identificador da decisão |
| `research_material` | Material estável de um julgado: ementa, inteiro teor ou outro tipo expressamente suportado. Estado de obtenção e referência à versão corrente |
| `research_material_version` | Versão imutável: hash, tipo de conteúdo, tamanho, objeto original, metadados de citação, versão do parser e datas de origem/coleta. Uma ementa nunca se transforma silenciosamente em inteiro teor |
| `research_chunk` e índice FTS | Texto extraído, versão do material, página/parágrafo e referência estável. Somente versões publicadas e fontes acessíveis participam da busca |
| Orçamento global por fonte | Contagem e cadência agregadas por instalação, independentemente do escritório que solicitou a consulta |

São dados de referência publicados pelas fontes. Nenhuma dessas entidades pode conter termos privados pesquisados, identificação do cliente, perfil de caso, usuário solicitante, anotações ou respostas de compatibilidade. A exceção ao escopo de escritório é explícita e exclusiva deste corpus; tabelas de negócio continuam exigindo `office_id`.

Não deduplicar decisões pelo número do processo. Não unir registros de fontes diferentes por semelhança textual. Preservar identificador nativo quando o número não for CNJ válido. Hash identifica repetição de conteúdo de uma representação; não substitui a identidade do julgado.

### Dados privados do escritório

| Entidade | Conteúdo e invariantes |
| --- | --- |
| `research_search` | Escritório, usuário, tema, filtros, momento, estado e chave de idempotência. Histórico visível ao autor no MVP |
| `research_search_page` | Fonte/cursor de origem, estado, contagem informada, versão da página apresentada, julgados entregues ao usuário e progresso da obtenção automática. Payload que contenha ou ecoe pesquisa privada permanece privado |
| `research_search_result` | Relação da pesquisa com julgados, ordem observada, página e versão vista. Unicidade dentro da pesquisa |
| `research_job` | Escritório, solicitante, operação, alvo, tentativas, disponibilidade para execução, lease e resultado. Nunca expor job de outro escritório |
| `research_case_profile` e suas versões | Caso, questão jurídica, objetivo, tese opcional, fatos e alegações, lacunas e referências aos documentos privados utilizados. Atualização otimista e histórico imutável dos contextos avaliados |
| `research_assessment` | Perfil e material avaliados, versões, evidências, dimensões, distribuições, modelo, critérios, configuração, status e impressão dos insumos |
| `research_case_reference` | Caso, julgado, versão do material, avaliação escolhida, finalidade, anotação, usuário e data. Vínculo idempotente e remoção independente do corpus |

Toda consulta e escrita privada deriva escritório e papel da sessão. Referências entre tabelas privadas devem comprovar o mesmo `office_id`, inclusive nas operações do worker.

Uma referência fixa a versão utilizada. Nova versão no acervo apresenta uma ação de atualização; não altera a fonte histórica de um caso ou minuta. Exclusão de um caso remove seus vínculos e avaliações conforme a política do escritório, sem apagar julgados públicos. Restrição posterior da fonte deve retirar material da busca e impedir novos downloads; referências antigas passam a indicar indisponibilidade, com retenção do conteúdo revista conforme a condição da fonte.

## 6. Pesquisa, persistência e obtenção de conteúdo

1. A UI envia tema e filtros por POST. O servidor valida a entrada e cria a pesquisa de forma idempotente.
2. A busca lexical no corpus retorna resultados já conhecidos. Em paralelo, um job consulta a primeira página das fontes habilitadas; a requisição web não espera toda a coleta.
3. Cada página recebida é validada e persistida antes de aparecer como resultado durável. Registros sem identidade suficiente ficam em quarentena. Persistir todo resultado válido recebido na página, mesmo quando sua relevância for baixa.
4. Registrar ementas e outros textos completos que a resposta já trouxer. Campo ausente ou mensagem de indisponibilidade não apaga conteúdo válido conhecido nem gera versão vazia.
5. Ao entregar a página solicitada, o servidor registra seus julgados e enfileira automaticamente a obtenção dos materiais ausentes. Resultados e status ficam disponíveis imediatamente; a UI não espera o fim dos downloads para apresentar a página.
6. A UI recebe novos resultados e progresso por consulta periódica autenticada enquanto houver jobs ativos. O usuário pode continuar vendo o acervo quando a fonte externa falhar. Mais resultados solicita outra página por cursor opaco e repete a obtenção automática apenas para esse novo lote.
7. A página consultada é o lote de resultados normalizados efetivamente entregue em resposta à ação do usuário, incluindo resultados locais com material ainda ausente. Candidatos internos usados para ranking, prefetch de navegação e páginas não abertas não disparam obtenção. A página é identificada no servidor, sem aceitar listas arbitrárias de URLs ou IDs para download. Abrir um julgado acompanha seu job ou permite repetir uma tentativa que falhou.
8. O worker preserva bytes originais, verifica tipo/tamanho e calcula hash. Publica a versão apenas após armazenamento e registro consistentes; falhas intermediárias têm recuperação e limpeza de objetos órfãos.
9. Extração gera texto e referências por página/parágrafo. OCR usa o fluxo existente quando necessário. A ementa continua pesquisável enquanto o inteiro teor está em processamento.

Parâmetros iniciais propostos: 20 resultados por página, 30 candidatos para reranking, uma página externa por solicitação, até dois downloads simultâneos por instalação e 50 MB por arquivo. Falhas transitórias têm até cinco tentativas com recuo. São limites internos configuráveis, sujeitos a limites menores da fonte. Respeitar `Retry-After` e aplicar orçamento global por instalação mais orçamento por escritório. Esgotar orçamento deixa materiais pendentes com motivo visível e retomada; não classifica a página como integralmente processada.

Uma pesquisa idêntica recente pode reapresentar páginas coletadas por aquele escritório por 15 minutos; Atualizar fontes solicita nova consulta respeitando cadência e orçamento. Não usar essa janela como promessa de atualidade dos julgados. Histórico, datas observadas e cobertura parcial permanecem visíveis.

Downloads concorrentes do mesmo material usam uma reserva atômica no catálogo e jobs privados associados: um download publica a versão compartilhada; os demais reutilizam o resultado. Paginar ou sair da tela mantém o processamento iniciado em segundo plano. A ação Parar obtenção cancela somente solicitações pendentes daquele usuário, sem eliminar conteúdo público já obtido nem interromper trabalho necessário a outra solicitação. Materiais já válidos não são baixados novamente em cada visita.

### Contrato TJDFT a fixar

O ponto de entrada documentado é `POST https://jurisdf.tjdft.jus.br/api/v1/pesquisa`. A prova já realizada confirmou consulta temática e consulta por identificador. O adaptador deve cobrir os formatos observados: `hits.value`, `inteiroTeorHtml` e a mensagem de conteúdo indisponível apesar de `possuiInteiroTeor: true`.

Antes da implementação do download, demonstrar uma resposta positiva com conteúdo integral ou um endereço oficial de obtenção. Não inventar endpoint, inferir caminho de PDF ou classificar ementa como inteiro teor. Se a fonte oferecer somente ementa para um registro, esse será um resultado válido e explícito. O aceite do caminho binário terá também o PDF público STJ da amostra, por transporte controlado, sem simular uma integração STJ completa.

## 7. Busca do acervo e crescimento

Primeiro ciclo: FTS5 próprio para ementas e texto extraído, filtros estruturados e reranking TypeSafe de uma lista limitada. Aplicar filtros antes do ranking e da paginação; retornar página e continuidade de todo o corpus elegível, sem limitar silenciosamente aos documentos mais recentes.

Registrar separadamente a relevância ao tema da pesquisa e a pertinência a um caso. O TypeSafe só recebe candidatos recuperados e os trechos necessários. Não enviar todo o corpus a cada consulta. O cache de relevância é privado por escritório, consulta, modelo e versões dos insumos.

Busca semântica global é expansão posterior. O índice atual usa credenciais, modelos e gerações por escritório; reutilizá-lo como corpus global exigiria definir financiamento, conexão de embeddings de plataforma e geração própria. No MVP, a busca lexical com reranking funciona independentemente dessa decisão. Embeddings privados do Cofre continuam disponíveis para selecionar evidências do caso.

Não converter seleção de resultados pelo usuário em rótulo automático de correção jurídica. Adoção, descarte e feedback explícito podem apoiar uma avaliação futura, com significado preservado.

## 8. Perfil do caso e TypeSafe

Ao escolher um caso, o usuário preenche ou revisa um perfil curto: questão jurídica, objetivo, tese opcional e fatos relevantes. Pode selecionar documentos/trechos do Cofre como evidência. No MVP o texto é fornecido ou revisado pelo usuário; a extração automática de todo o caso não é dependência.

Cada fato tem estado `documentado`, `alegado` ou `não informado`, além da fonte quando existir. Alteração de documento selecionado ou do perfil torna a avaliação anterior desatualizada. Um caso só com título permite busca temática, mas não uma avaliação factual completa.

Adicionar `research` a `DecisionPurpose`, `research_mode` à conexão e controles correspondentes na plataforma. Manter `off`, `shadow` e `enabled`, chave por escritório, auditoria, orçamento e limite de concorrência. Não utilizar o modo RAG como autorização implícita para a nova finalidade.

Estado enviado: perfil versionado, metadados do julgado, tipo de material disponível e trechos identificados. Tratar textos como evidência não confiável, jamais instrução. Respeitar os limites reais do cliente atual; se houver seleção parcial de trechos, declarar essa cobertura na avaliação.

| Pergunta | Primitiva e critérios |
| --- | --- |
| Pertinência jurídica | `Score` 0–4: sem relação; tema amplo; questão parcialmente relacionada; mesma questão com diferenças relevantes; mesma questão diretamente examinada |
| Semelhança factual | `Score` 0–4: fatos incompatíveis; só características genéricas; algumas circunstâncias comuns; circunstâncias decisivas em grande parte comuns; circunstâncias decisivas diretamente comparáveis |
| Adequação do contexto processual | `Score` 0–4: objeto incompatível; relação remota; aplicação condicionada a diferenças; contexto bastante próximo; pedido e questão processual diretamente comparáveis |
| Relação com a tese fornecida | `Choice`: apoia, contraria, relação mista, não relacionado, informação insuficiente. Sem tese, a UI mostra não avaliado |
| Suficiência da evidência para a comparação | `Choice`: adequada, parcial, insuficiente, com critérios independentes dos scores |

Perguntas independentes são enviadas juntas; nenhuma pode depender da resposta de outra na mesma chamada. O código interpreta suficiência e configura o comportamento posterior.

Composição inicial para ordenação interna: 40% pertinência jurídica, 40% semelhança factual, 20% contexto processual, após normalização das escalas. A posição sobre a tese não entra como bônus ou penalidade. Não incorporar força vinculante ou atualidade presumida à fórmula; tais dados exigem fonte própria.

A primeira UI mostra dimensões e posição sobre a tese, com indicação de cobertura e incerteza. Não apresentar percentual de êxito. Evidência insuficiente produz avaliação incompleta, não score zero. Falha, limite de orçamento e TypeSafe desativado são estados distintos de baixa pertinência.

Guardar scores, probabilidades e confiança por pergunta. Critérios, pesos e modos são versionados. Mudanças só nos pesos recalculam a composição; mudanças no modelo, perguntas, perfil ou material exigem avaliação nova. A chave de cache inclui escritório, caso, revisão do perfil, versões dos documentos privados usados, material/revisão de metadados, política da fonte, modelo, perguntas e versão da conexão.

Jev não gera justificativas em prosa. O MVP mostra descrições dos critérios, diferenças estruturadas e trechos considerados com referência. Explicações narrativas podem ser acrescentadas depois pelo modelo de redação, apoiadas nas mesmas evidências.

O vínculo passa pela tentativa de avaliação. Quando ela falhar ou estiver desativada, administrador/advogado pode escolher **Adicionar sem avaliação**, com estado registrado. Baixa pertinência ou posição contrária não bloqueia o vínculo. Uma avaliação antiga pode ser visualizada, mas não apresentada como avaliação dos insumos atuais.

## 9. Referências no caso, Lume e minutas

Criar a seção **Referências** no caso do Cofre. Mostrar julgado, material e versão, finalidade (`fundamentação`, `contraponto` ou `contexto`), data e avaliação. Anotações são privadas. Adicionar novamente a mesma versão é idempotente; outro caso cria outro vínculo ao mesmo material.

Introduzir referências de fonte tipadas para distinguir documento privado do Cofre e material público vinculado. Não transformar o acervo inteiro em documento autorizado de todos os casos, nem copiar PDFs para satisfazer artificialmente o contrato atual.

Na conversa e no início de uma minuta, resolver referências selecionadas dentro do escritório e caso autenticados. Acrescentar seus trechos à recuperação por meio de uma interface de fontes que preserve os caminhos existentes de documentos do Cofre. Evoluir contratos de seleção, `SourceChunk`, citação e resolução de fonte onde necessário, mantendo compatibilidade com entradas atuais `documentIds`.

O vínculo torna a referência disponível para seleção; não aprova automaticamente todos os seus trechos em uma minuta. A autorização humana de citações em `runs-service.ts` e `document-workflows.ts` permanece. Rascunhos preservam a versão e o trecho selecionados, com fonte resolvível. Nenhum fato narrado em outro processo vira fato do cliente.

## 10. HTTP, capacidades e acesso

Acrescentar módulo `research` ao catálogo, executores e cliente HTTP comuns. Rotas propostas sob `/api/research`, com entradas Zod e erros de domínio; os nomes finais devem seguir os padrões existentes.

| Operação | Comportamento e acesso |
| --- | --- |
| Consultar acervo / ler julgado | Leitura autenticada de materiais admitidos no corpus; todos os papéis |
| Iniciar pesquisa / pedir próxima página / atualizar fonte | POST idempotente; cria histórico, jobs de consulta e obtenção automática da página; administrador e advogado |
| Obter material | POST explícito e idempotente; inicia coleta autorizada; administrador e advogado |
| Ler pesquisa/job | Escopo do escritório e usuário autor; GET sem coleta externa |
| Salvar perfil do caso / avaliar pertinência | POST com versão esperada; administrador e advogado |
| Adicionar/remover referência / editar anotação | Papel e caso revalidados; vínculo humano e idempotente |
| Listar referências do caso | Todos os papéis que já podem consultar o caso |

Revisor pode pesquisar o acervo já disponível e consultar referências; não inicia consultas externas com custo, downloads ou avaliações. Essa distinção preserva o papel de consulta existente.

Publicar inicialmente para agente e WebMCP as leituras de acervo, julgados e referências. Pesquisa externa, avaliação e associação ficam na UI no primeiro ciclo. Isso evita que uma conversa inicie coleta, consumo ou vinculação sem uma ação de produto definida. O executor é compartilhado; `publish` controla a exposição.

Todas as rotas privadas usam sessão, verificação de origem nas mutações, limites de entrada e respostas sem cache compartilhado. Termos pesquisados não entram em URLs de recursos, logs operacionais ou telemetria de erro. Downloads passam por resolução de material no servidor.

## 11. Fontes, armazenamento e execução

As permissões existentes são independentes: consulta, cache, documentos, redistribuição e IA. Definir uma política por operação que exija apenas as dimensões correspondentes e manter ambas as chaves de ativação da instalação. A revisão da CLI precisa preservar o DJEN e não liberar uma dimensão por inferência.

Para compor o corpus compartilhado, a fonte precisa ter condições de consulta, persistência e compartilhamento registradas. Obtenção de material e processamento por IA exigem suas condições correspondentes. Fontes ainda não aptas permanecem candidatas; a prova técnica HTTP 200 não preenche automaticamente os campos de uso.

Conteúdo restrito devolvido indevidamente, páginas de login e documentos sem identificação confiável não entram no corpus. Preservar a distinção observada entre processo sigiloso e ementa jurisprudencial oficialmente publicada, sem tentar obter autos a partir da publicação.

Coleta e busca externa: novos jobs de Pesquisa executados pelo processo `judicial-worker.ts`, em alternância justa com o DJEN e com tabelas/estados próprios. Extração, OCR e avaliação: processamento por tipos de job no worker de documentos, com limites para não bloquear uploads. Aplicar claim atômico, lease, checkpoint por página/material, retomada e tentativas limitadas. Respostas e erros de uma fonte não afetam o estado do DJEN.

O ciclo inicial de execução será validado em Node/Docker, com web e workers no mesmo banco de negócio e armazenamento. O código atual resolve SQLite no processo Node e D1 no Worker Cloudflare: não declarar suportada uma combinação web/D1 + worker/SQLite independente. A publicação em Cloudflare exigirá execução dos jobs contra o mesmo D1, via runtime/binding apropriado; esse requisito deve ser resolvido e validado antes de ativar Pesquisa naquele ambiente.

## 12. Experiência do usuário

Seguir [DESIGN.md](../apps/web/DESIGN.md), com pt-BR, superfície única, linhas separadas por bordas discretas, estados em texto e controles existentes. A implementação visual deverá aplicar as skills de UI pertinentes e validar referências visuais antes de criar componentes novos.

- Pesquisa: campo de tema, filtros, escopo Acervo/Acervo e fontes, resultados paginados e histórico pessoal.
- Resultado: tribunal, órgão, número, data, trecho relevante, material disponível e origem. Mostrar resultado parcial quando uma fonte falhar.
- Página consultada: progresso textual de obtenção e indexação, com quantidades prontas, pendentes e indisponíveis; ação Parar obtenção. A navegação permanece utilizável durante o processamento.
- Leitor: ementa e inteiro teor como materiais distintos; abertura da fonte oficial; status de coleta/processamento quando necessário.
- Adicionar ao caso: seleção do caso, revisão do perfil, avaliação e finalidade. Falta de fatos leva ao preenchimento do perfil, sem fabricar contexto.
- Caso: referências, avaliação atual/desatualizada, anotação e remoção do vínculo.
- Plataforma: fontes e permissões existentes mais configuração Pesquisa do TypeSafe; consumo e falhas sem conteúdo privado.

Estados obrigatórios: inicial, carregando acervo, consultando fontes, nenhum resultado, resultado parcial, fonte indisponível, documento ausente, coleta/processamento pendente, conteúdo substituído/restrito, perfil insuficiente, avaliação em curso, baixa confiança, TypeSafe desligado/falhou/orçamento excedido, avaliação desatualizada, referência já vinculada e sessão expirada.

No celular, resultados em linhas de leitura, filtros recolhíveis e leitor dedicado; seleção de caso em sheet acessível. Restaurar busca e posição ao voltar, manter foco e acesso por teclado, respeitar movimento reduzido e os quatro atalhos da navegação móvel.

## 13. Entregas e dependências

| Etapa | Trabalho concreto | Critério de conclusão |
| --- | --- | --- |
| P0 — contratos e amostra | Fixar formato TJDFT, filtros, paginação, identidade, falhas e material disponível; registrar condições da fonte; fixtures sintéticas representativas e canário público separado | Consulta por tema reproduzível, comparada ao portal; diferenças do contrato e disponibilidade descritas; nenhuma permissão inventada |
| P1 — corpus e jobs | Migrações, catálogo público, histórico privado, versões, storage, FTS, fila, orçamentos e política por operação | Repetição e concorrência sem duplicação; isolamento privado; recuperação de falha entre armazenamento e banco |
| P2 — busca e coleta | Adaptador TJDFT, capacidades, busca local, jobs externos, paginação e obtenção automática por página consultada | Nova busca persiste achados e enfileira conteúdo disponível; repetição reaproveita corpus; indisponibilidade externa preserva resultados locais |
| P3 — módulo Pesquisa | Rota, navegação, resultados, leitor, filtros e histórico | Fluxo utilizável em desktop/celular/teclado, incluindo estados parciais e vazios |
| P4 — perfil e TypeSafe | Perfil versionado, finalidade/configuração Pesquisa, perguntas, orçamento, cache e relatório estruturado | Casos favoráveis, contrários e insuficientes recebem tratamentos distintos; falha não vira score zero |
| P5 — vínculo ao caso | Referências e anotações, associação idempotente, versão fixada e atualização explícita | Mesmo julgado serve a vários casos sem duplicar arquivo; apagar vínculo não apaga corpus |
| P6 — uso no Lume | Seleção de referências, resolução de trechos e citações, integração à recuperação e preparação de minutas | Texto produzido aponta à versão selecionada; material de outro processo não é tratado como fato do cliente |
| P7 — aceite do piloto | Validação funcional, avaliação TypeSafe com rótulos humanos, limites/custos e recuperação | Fluxo ponta a ponta aprovado no tema guarda à avó e regressões existentes cobertas |
| P8 — expansão STJ | Ingestão dos recursos CKAN, deduplicação e relação entre espelho e inteiro teor, atualização por recurso | Segunda fonte consultável localmente, com origem e cobertura verificadas |

P0–P6 e P8 foram trabalhados em paralelo nesta implementação. P7 depende de validação funcional, fontes habilitadas sob condições documentadas e rótulos humanos; a existência de testes sintéticos não conclui esse aceite.

## 14. Validação e critérios de aceite

### Comportamento e integridade

- Duas pesquisas e dois usuários encontrando o mesmo julgado criam uma identidade pública e históricos privados independentes.
- Página repetida, resposta fora de ordem, timeout após gravação e worker reiniciado não geram duplicatas ou perda de checkpoint.
- Consultar uma página enfileira automaticamente seus materiais ausentes; não enfileira a página seguinte nem candidatos internos de ranking. Sair da tela mantém o processamento; Parar obtenção respeita outras solicitações concorrentes.
- Alteração real cria versão; resposta vazia/indisponível não substitui versão válida; referências antigas continuam fixadas ou indicam restrição posterior.
- Filtragem e busca encontram um julgado pertinente além dos 400 documentos mais recentes; paginação tem desempate estável.
- PDF preserva bytes/hash; MIME falso, conteúdo acima do limite, redirect para host não autorizado e corpo de login não são indexados.
- Ementa, inteiro teor indisponível e resposta com `possuiInteiroTeor` inconsistente recebem estados corretos.
- Escritório A não acessa pesquisas, perfis, jobs, avaliações ou anotações de B por ID, URL, cache, ferramenta ou citação. Ambos podem ler o mesmo julgado público habilitado.
- Exclusão de documento privado usado no perfil invalida a avaliação; alteração do caso durante a inferência impede que o resultado seja marcado como atual.
- Falhas de TypeSafe, modo desligado, orçamento e baixa confiança não recebem interpretação de reprovação jurídica.

### Qualidade das avaliações

Montar pelo menos 30 pares perfil de caso × julgado, com classificação revisada pelo advogado, cobrindo guarda à avó, casos envolvendo avô, mera finalidade financeira, contexto processual diferente, decisão contrária relevante e falta de fatos. Reservar parte dos pares para avaliação sem ajuste de critérios.

Comparar o ranking lexical com o ranking TypeSafe por relevância nos primeiros resultados; medir inclusão de contrapontos relevantes, avaliação insuficiente corretamente reconhecida, divergência entre posição sobre a tese e pertinência, custo e latência por operação. Os quatro julgados da pesquisa são sementes, não benchmark suficiente.

Começar em `shadow`. Pesos, rótulos de exibição e limiares de confiança só são promovidos após medir desempenho no conjunto reservado. Registrar falhas por evidência ausente, erro de modelo, erro de composição ou indisponibilidade. Não usar métricas do cookbook como garantia para o domínio brasileiro.

### Execução

Durante implementação, executar da raiz `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`, precedidos do ambiente e `pnpm db:setup` conforme os READMEs. Acrescentar testes através da interface de Pesquisa e testes de integração nas partes de sessão/isolamento afetadas.

Validar no navegador pesquisa → resultado → obtenção disponível → avaliação → vínculo → referência no caso → seleção no Lume/minuta. Incluir desktop, mobile, teclado, modo escuro e estados de falha. Quando aplicada a skill `validate-implementation`, usar conta estável e registrar a demonstração real sem expor dados privados de menores ou clientes.

Os testes automatizados usam transporte controlado e fixtures sintéticas. A consulta real à fonte e a chamada TypeSafe são verificações separadas, pequenas e identificadas, sem dependência de disponibilidade externa para toda a suíte.

As migrações e o fluxo de aplicação foram implementados depois da redação inicial deste plano. Os resultados de testes e as lacunas operacionais estão na seção 16. A ativação real de uma fonte continua sendo uma ação separada do operador.

## 16. Estado operacional e lacunas do piloto

O código implementa o acervo compartilhado com FTS5, histórico privado, busca local, coleta TJDFT
por página solicitada, download automático dos materiais dessa página, leitor, perfil e avaliação
TypeSafe, referência versionada no caso e seleção explícita para Lume e minutas. A avaliação da
pertinência é separada da posição do julgado sobre a tese. O STJ usa descoberta CKAN e ingestão
manual de recurso; suas decisões só entram na busca local depois de importadas.

Para executar em Node local, configure o ambiente, rode `pnpm db:setup` e inicie `pnpm dev`,
`pnpm judicial:worker` e `pnpm worker` em processos separados. O primeiro worker atende as
consultas/downloads e o DJEN; o segundo extrai texto/OCR e processa avaliações. No Docker,
`docker compose up` executa `setup` antes dos serviços e compartilha SQLite e originais públicos
em `appdata`, com `RESEARCH_STORAGE_PATH=/data/research-objects`. Fora do Docker, os dois workers
e o servidor devem usar o mesmo `DATABASE_PATH` e `RESEARCH_STORAGE_PATH`.

As fichas em `apps/web/db/sources/` começam com permissões `nao_esclarecido`. O operador registra
evidências para consulta, cache e redistribuição antes de liberar uma fonte para o acervo;
documentos e envio à IA exigem permissões adicionais. O registro de uma ficha não habilita
requisições externas. O comando `pnpm judicial:admin list` mostra as instalações. Para o TJDFT,
registre `db/sources/tjdft.example.json` após revisar a ficha e habilite seu ID com `enable <id>
--live` somente quando as condições aplicáveis estiverem documentadas. O STJ usa a ficha
`db/sources/stj-ckan.example.json`, descoberta `stj-discover` e enfileiramento `stj-enqueue` por
recurso, conforme [o guia da aplicação](../apps/web/README.md#pesquisa-de-jurisprudência).

P7 ainda exige ao menos 30 pares perfil × julgado rotulados por advogado, incluindo contrapontos,
avô/avó, contexto diverso e fatos insuficientes; comparar ranking, calibração, custo e latência
em uma parte reservada antes de promover os limiares. Também faltam o aceite humano do fluxo
com casos de uso reais autorizados e a verificação ao vivo pequena de cada fonte sob sua política.
As tentativas de canário real `package_show` e download de amostra CKAN expiraram por timeout do
host oficial em 22/09/2026. Parser de espelhos, metadados e ZIP foi validado com fixtures
sintéticas; associação automática de espelho e íntegra está desativada. `stj-link` exige operador,
URL oficial, nota e identidades compatíveis. `stj-enqueue --force` permite reprocessar recurso
com o mesmo hash após um vínculo, preservando os bytes originais registrados. Esses testes não
comprovam cobertura ou permissões da fonte. Pesquisa em Cloudflare
permanece desativada até web e workers partilharem o mesmo banco e armazenamento nesse runtime.

No SQLite local inspecionado em 22/09/2026, `typesafe_connection` tem zero configurações.
Existe chave mestra configurada para cifrar credenciais, mas não há conexão TypeSafe de escritório
habilitada para Pesquisa. Por isso não foi feita inferência real nesta validação. O smoke real
requer cadastrar uma chave TypeSafe própria do escritório em `/platform/clients/[officeId]/ai`,
habilitar a finalidade Pesquisa em modo `shadow` ou `enabled`, registrar permissão `ai` da fonte
como `permitido` e usar um perfil e material sintéticos em uma cópia isolada do banco. Nenhuma
chave de exemplo dos testes serve para essa chamada.

## 15. Referências da implementação

- [API pública de jurisprudência TJDFT](https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/documentacao_api_seti_transparencia.pdf).
- [TypeSafe: Score](https://docs.typesafe.ai/primitives/score.md), [Choice](https://docs.typesafe.ai/primitives/choice.md), [pontuação composta](https://docs.typesafe.ai/patterns/composite-scoring.md) e [reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md), lidos durante a discussão.
- [Fundação judicial existente](infra-judicial-implementacao.md), [plano judicial anterior](plano-infra-judicial.md) e [integração TypeSafe existente](typesafe-implementacao.md).
- [Guia Next.js instalado: Route Handlers](../apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md) e [busca de dados](../apps/web/node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md).
