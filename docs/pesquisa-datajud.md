# DataJud no Lume: oportunidades e limites

Pesquisa documental em 18/09/2026. Nenhuma chamada autenticada à API foi executada; nenhuma integração foi implementada.

Atualização da pesquisa na mesma data: a [Portaria CNJ 374/2026](https://atos.cnj.jus.br/atos/detalhar/6972), publicada em 19/08/2026, prevê polos ativo/passivo quando pessoas jurídicas e remessa diária com transição de 180 dias. O glossário consultado abaixo não basta para afirmar ausência permanente de dados de partes; os novos campos e sua disponibilidade efetiva precisam ser testados. A restrição comercial permanece. Ver [catálogo atualizado de fontes](fontes-infra-judicial.md) e [plano de infraestrutura](plano-infra-judicial.md).

## Conclusão

O melhor encaixe é vincular processos aos casos do Cofre e permitir que o advogado selecione um retrato de suas movimentações como fonte para cronologias. Isso complementa o trabalho documental atual. A adoção comercial depende de esclarecer com o CNJ as restrições dos termos publicados.

## Fatos verificados nas fontes oficiais

- A API pública disponibiliza metadados de capas e movimentações de processos públicos, resguardando processos sigilosos e dados das partes. A documentação pública não deve ser confundida com o modelo de transferência usado pelos tribunais para alimentar o DataJud. [Visão geral](https://datajud-wiki.cnj.jus.br/api-publica/)
- O glossário inclui número CNJ, tribunal, grau, ajuizamento, classe e assuntos TPU, órgão julgador, sistema/formato e movimentos com código, descrição, data e complementos. Não lista nomes/CPF/CNPJ de partes nem conteúdo integral de decisões ou peças. O identificador combina tribunal, classe, grau, órgão e número: não tratar todo resultado de um mesmo número como um único registro equivalente. [Glossário](https://datajud-wiki.cnj.jus.br/api-publica/glossario/)
- `dataHoraUltimaAtualizacao` corresponde à atualização da origem; `@timestamp`, à atualização do documento no índice. São distintos da data de ocorrência de um movimento e da data em que o Lume consultaria a API. [Glossário](https://datajud-wiki.cnj.jus.br/api-publica/glossario/)
- A autenticação usa uma chave pública publicada pelo CNJ, com cabeçalho `Authorization: APIKey <chave>`. O CNJ pode alterá-la. [Acesso](https://datajud-wiki.cnj.jus.br/api-publica/acesso/)
- As pesquisas são dirigidas a aliases de tribunais, por exemplo `POST https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search`, usando JSON Query DSL. Há exemplos oficiais por número CNJ sem formatação e por classe/órgão. [Endpoints](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/), [número](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1/), [classe e órgão](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo2/)
- A documentação descreve retorno padrão de dez registros, `size` até 10.000 e paginação com `search_after`, `sort` por `@timestamp` e os valores de ordenação do último resultado. Isso não constitui garantia de uma exportação imutável enquanto o índice muda. [Paginação](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo3/)
- Os termos publicados restringem o uso a fins não comerciais (§3.3) e vedam exploração comercial da API ou informações derivadas (§3.8). Também não garantem precisão, integridade ou atualidade (§3.6). O limite é 120 requisições/minuto, salvo autorização expressa escrita (§3.13), podendo o CNJ reduzir limites (§3.14). A API pode ser alterada ou interrompida sem aviso (§3.4). Não foi identificada garantia de atualização em tempo real nas páginas consultadas. [Termos, versão 1.2](https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf)

## Proposta para o produto, em ordem de valor

| Etapa | Benefício | Limite de escopo |
| --- | --- | --- |
| 1. Vincular número CNJ ao caso | Preencher metadados, consultar movimentos e reduzir transcrição manual | Advogado confirma tribunal, registro e vínculo |
| 2. Cronologia com fontes | Combinar eventos processuais selecionados com fatos extraídos dos documentos | Diferenciar metadados DataJud de peças e decisões fornecidas pelo escritório |
| 3. Acompanhamento periódico | Destacar novos movimentos observados e preparar resumos para revisão | Exibir atualização da fonte e consulta; não substituir intimações nem calcular prazos automaticamente |
| 4. Análise de carteira | Comparar intervalos observados entre eventos, classe e órgão | Explicitar amostra, cobertura e dados ausentes; não prometer probabilidade de vitória |

Busca de jurisprudência integral, descoberta de todos os processos por CPF/CNPJ e verificação do conteúdo de decisões exigem outras fontes: os campos públicos documentados não sustentam essas funcionalidades.

## Encaixe na implementação atual

O [plano do MVP](plano-ia-mvp.md) prioriza fontes selecionadas pelo advogado e exclui pesquisa jurídica externa. A [política de IA](../apps/web/src/lib/ai-policy.ts) reforça esse limite. Portanto, adicionar uma fonte externa exige uma decisão explícita de escopo e proveniência, antes de disponibilizá-la aos agentes.

O cadastro inicial de [casos do Cofre](../apps/web/db/postgres/0001_initial.sql) não modela número CNJ. A proposta é criar vínculos processuais separados, permitindo mais de um processo/registro por caso. O [catálogo de ferramentas](../apps/web/src/lib/agent-tools/index.ts) é um ponto de integração; o [fluxo de documentos](../apps/web/src/lib/document-workflows.ts) já trabalha com fontes e referências estáveis.

Um primeiro incremento poderia oferecer consulta somente de leitura no servidor, vínculo autorizado pelo escritório e snapshot datado explicitamente selecionado para a cronologia. Conservar o payload e identificadores para rastreabilidade, normalizar movimentos de forma determinística e separar `consultadoEm`, atualização da origem e data do evento. Manter vínculos, anotações e permissões isolados por `office_id`, derivado da sessão. Caso a consulta falhe ou retorne vazio, informar indisponibilidade/ausência na fonte sem concluir que o processo não existe.

Polling e análise agregada ficariam para depois da validação de cobertura e permissão de uso. A proposta técnica inclui cache, deduplicação, orçamento global de requisições e retentativas com recuo, sem pressupor webhooks ou SLA que não estão documentados.

## Próximo passo recomendado

Esclarecer com o CNJ o uso pretendido no Lume e, com a permissão aplicável definida, avaliar uma pequena amostra representativa dos tribunais de interesse. Medir cobertura, defasagem observada, duplicidade e utilidade da cronologia antes de ampliar o produto. As oportunidades acima são propostas, não capacidades já implementadas ou garantias da API.
