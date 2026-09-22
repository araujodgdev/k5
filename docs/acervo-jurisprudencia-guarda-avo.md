# Acervo de jurisprudência por tema: guarda à avó

Data de referência: 22/09/2026.

Implementação planejada em [Pesquisa e acervo de jurisprudência](plano-pesquisa-jurisprudencia.md), com corpus público compartilhado e obtenção automática dos materiais disponíveis na página consultada.

## Objetivo confirmado com o usuário

A prioridade da integração judicial é formar um acervo de casos, processos e decisões para pesquisa de jurisprudência, descobertos por temática em fontes públicas. O primeiro tema escolhido é **guarda judicial de criança ou adolescente para a avó**. O usuário não precisa conhecer previamente um número processual nem escolher TJAM: o tribunal será uma fonte ou filtro da pesquisa.

Isso redefine a prioridade da [investigação de consulta pública](pesquisa-consulta-publica-documentos.md). O piloto TJAM de obtenção de peças passa a ser uma possibilidade complementar. A entrega inicial deve permitir descobrir julgados relevantes, preservar a fonte e pesquisar o acervo com citações.

## Primeira amostra verificada

| Referência | Circunstâncias e resultado da guarda | Material conferido |
| --- | --- | --- |
| STJ, REsp 993.458/MA; Terceira Turma; Nancy Andrighi; julgamento 07/10/2008; DJe 23/10/2008 | Guarda concedida à avó materna. Cuidados de fato consolidados, vínculo afetivo e concordância dos pais sustentaram a decisão. | Inteiro teor oficial lido e PDF baixado. |
| TJDFT, Acórdão 1715325; processo 0006284-52.2019.8.07.0013; Quinta Turma Cível; Lucimeire Maria da Silva; julgamento 21/06/2023 | Mantida a guarda com a avó materna. O julgado considerou a incapacidade dos genitores associada ao abuso de álcool e o ambiente estável oferecido pela avó. | Ementa pela API e síntese do Informativo 483 conferidas. |
| TJDFT, Acórdão 2171572; processo 0708387-46.2023.8.07.0014; Sétima Turma Cível; Fátima Rafael; julgamento 02/09/2026 | Mantida a guarda com a avó materna, com apoio em estudo psicossocial e estabilidade do ambiente familiar. Convivência materna progressiva e supervisionada. | Ementa retornada pela API; inteiro teor não validado. |
| TJDFT, Acórdão 814519; processo 20120111707983EIC; Segunda Câmara Cível; Vera Andrighi; julgamento 18/08/2014 | Negada transferência da guarda ao **avô** quando os pais exerciam o poder familiar e a finalidade era assistência financeira. Comparável sobre avós, não exemplo de avó. | Ementa pela API e informativo oficial. |

Fontes por registro:

- [Inteiro teor STJ, REsp 993.458/MA](https://processo.stj.jus.br/SCON/GetInteiroTeorDoAcordao?dt_publicacao=23%2F10%2F2008&num_registro=200702309708).
- [TJDFT, Informativo 483, seção sobre guarda à avó](https://www.tjdft.jus.br/consultas/jurisprudencia/informativos/2023/informativo-de-jurisprudencia-n-483).
- Acórdão 2171572: consulta POST na [API oficial de jurisprudência TJDFT](https://jurisdf.tjdft.jus.br/api/v1/pesquisa), reproduzível com o corpo abaixo e o filtro de identificador.
- [TJDFT, transferência de guarda ao avô por assistência financeira](https://www.tjdft.jus.br/consultas/jurisprudencia/informativos/2014/informativo-de-jurisprudencia-n-o-289/transferencia-de-guarda-ao-avo-2013-assistencia-financeira).

Os resumos acima são sínteses de pesquisa. Não demonstram orientação atual uniforme, força vinculante ou adequação a um caso concreto. O conjunto preserva resultados diferentes e suas circunstâncias. A amostra contém publicações de julgados de processos sob sigilo; a publicação da jurisprudência não representa acesso aos autos. Não foram buscados nomes de crianças ou partes.

## Consulta real à API TJDFT

A [documentação oficial](https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/documentacao_api_seti_transparencia.pdf) descreve pesquisa textual e filtros. Foi executada consulta anônima com `query: "guarda avó"`, página 0 e tamanho 5. Houve resposta HTTP 200 com um resultado diretamente pertinente (2171572) e outros resultados que exigem triagem de relevância. Isso demonstra descoberta por tema, não precisão suficiente para importação indiscriminada.

Os três identificadores TJDFT da tabela foram confirmados individualmente, com HTTP 200 e um registro em cada consulta:

```json
{
  "query": "guarda",
  "termosAcessorios": [{ "campo": "identificador", "valor": "2171572" }],
  "pagina": 0,
  "tamanho": 1
}
```

Observações efetivas relevantes para o conector:

- A contagem veio como `hits.value`, embora o exemplo documental mostre `hits` numérico.
- Os registros usaram `inteiroTeorHtml`, enquanto o manual exemplifica `inteiroTeor`.
- No Acórdão 1715325, `possuiInteiroTeor` veio verdadeiro, mas `inteiroTeorHtml` continha `Inteiro Teor indisponível.`. O indicador sozinho não comprova conteúdo disponível.
- No Acórdão 814519, o recurso foi provido e o pedido de guarda foi considerado improcedente. Resultado do recurso e resultado da pretensão são campos distintos.
- O número legado `20120111707983EIC` deve ser preservado como identidade nativa; não converter artificialmente em número CNJ.

## Caminho de implementação

Fluxo: **tema → busca nas fontes → seleção por pertinência → ementa/inteiro teor disponível → ficha do julgado → indexação → pesquisa com referências**.

A ficha precisa relacionar tribunal, identificador do julgado, processo de origem, órgão julgador, relatoria, datas, assunto, circunstâncias relevantes, resultado da guarda, resultado do recurso, fonte oficial e material efetivamente obtido. Sínteses produzidas por IA devem carregar referências ao texto de origem. Uma decisão pode discutir vários temas e um processo pode produzir várias decisões.

O K5 já possui armazenamento, extração e busca híbrida do Cofre. Porém, [o catálogo judicial](../apps/web/src/lib/judicial/connectors/index.ts) só registra DJEN, e [a busca atual](../apps/web/src/lib/knowledge/retrieval.ts) seleciona até 400 documentos recentes quando não recebe lista explícita. Há trabalho de conectores, metadados e recuperação para atender a um acervo crescente. O isolamento por escritório deve ser mantido; compartilhamento de acervo público entre escritórios exige modelagem explícita.

## Artefatos e verificação

- PDF oficial STJ salvo localmente em `apps/web/.data/research/guarda-avo/stj-resp-993458-ma.pdf`: 63.274 bytes, assinatura `%PDF-`; caminho ignorado pelo Git. A fonte oficial permanece vinculada acima.
- Fontes oficiais e consultas API verificadas. Documento e links locais conferidos.
- Nenhum conector, tela ou banco da aplicação foi alterado. A amostra ainda não foi importada no Cofre. Testes de aplicação não se aplicam a esta entrega documental.
