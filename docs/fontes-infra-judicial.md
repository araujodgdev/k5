# Fontes oficiais para a infraestrutura judicial do Lume

Pesquisa em 18/09/2026. Este documento fundamenta a descoberta de conectores; não certifica cobertura nacional nem autorização comercial de todas as fontes. **Documentado** significa declarado pela fonte oficial; **testado** significa resposta observada. Consultas autenticadas, contatos com tribunais e downloads de autos não foram realizados.

## Procedimento obrigatório por fonte

1. Abrir o domínio oficial do tribunal, seu catálogo de serviços, dados abertos e normas de integração. Pesquisar `site:dominio.jus.br API`, `webservice`, `MNI`, `dados abertos`, `integração`, `termo de adesão` e o sistema processual.
2. Registrar tribunal, grau, competência, sistema, período coberto, produto desejado e URL da evidência. Um tribunal pode exigir vários conectores.
3. Separar acesso público, credenciado e institucional. Documentar elegibilidade, identidade representada, procuração/vínculo, autenticação, custos, limites, finalidade e direitos de armazenamento, redistribuição e processamento por IA.
4. Obter OpenAPI/WSDL/XSD/dicionário pelos links oficiais; versionar sua cópia e hash. Não adivinhar rotas de produção a partir de homologação.
5. Executar consulta pequena e autorizada; registrar status, esquema, paginação, IDs, datas, caracteres, limite e comportamento de ausência/sigilo. Não interpretar HTTP 200 como completude.
6. Comparar amostra com o portal oficial e documentar lacunas. Validar correções, cancelamentos, republicações, migrações e continuidade após falhas.
7. Se faltar documentação, preparar pedido ao suporte/SIC: endpoints, credenciamento para software comercial de escritórios, limites, cobertura, mudanças e termos. O envio depende de autorização específica; esta pesquisa não enviou mensagens.
8. Aprovar uma capacidade por vez: `publications`, `case_metadata`, `movements`, `documents`, `precedents` ou `taxonomy`. Endpoint existente não prova todas essas capacidades.

## 1. DJEN: publicações e certidões

**Documentado:** o [Swagger do CNJ](https://hcomunicaapi.cnj.jus.br/swagger/index.html), versão 1.0.4, informa consultas sem autenticação e operações autenticadas exclusivas dos tribunais; pede respeito aos limites de requisições. As [orientações oficiais](https://www.cnj.jus.br/programas-e-acoes/processo-judicial-eletronico-pje/comunicacoes-processuais/orientacoes-aos-tribunais/) distinguem produção `https://comunicaapi.pje.jus.br/api/v1` de homologação `https://hcomunicaapi.cnj.jus.br/api/v1`.

**Descoberta:** baixar a especificação pelo Swagger; confirmar contrato de produção; começar por `GET /comunicacao`, `GET /comunicacao/{hash}/certidao` e `GET /caderno/{sigla_tribunal}/{data}/{meio}`. Verificar filtros efetivos por processo/OAB/data, paginação, limites, horários dos cadernos e cancelamentos. Testar uma janela curta e conciliar API, certidão e caderno. Registrar adesão e lacunas por tribunal, sem prometer todo o histórico nacional.

**Utilidade:** caixa de publicações, alertas revisáveis, cronologia e evidência da comunicação. Não equivale ao andamento integral ou a todas as peças. O [CNJ distingue DJEN e Domicílio Judicial Eletrônico](https://www.cnj.jus.br/programas-e-acoes/processo-judicial-eletronico-pje/comunicacoes-processuais/); acesso ao Domicílio exige descoberta própria. Não inferir ciência ou prazo automaticamente.

## 2. STJ: jurisprudência estruturada e íntegras

**Testado:** chamadas públicas CKAN `GET /api/3/action/package_show?id=...` responderam para os dois conjuntos abaixo; ambos declararam `license_title = Creative Commons Atribuição` e `license_url = http://www.opendefinition.org/licenses/cc-by`.

- [Espelhos de acórdãos — Segunda Turma](https://dadosabertos.web.stj.jus.br/dataset/espelhos-de-acordaos-segunda-turma), slug `espelhos-de-acordaos-segunda-turma`: 54 recursos no momento da pesquisa.
- [Íntegras de decisões terminativas e acórdãos do Diário da Justiça](https://dadosabertos.web.stj.jus.br/dataset/integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica), slug correspondente ao último segmento da URL: 2.599 recursos, incluindo metadados JSON e arquivos ZIP.

**Descoberta:** usar o [catálogo oficial](https://dadosabertos.web.stj.jus.br/) e sua CKAN API para enumerar conjuntos de cada órgão julgador; inspecionar metadados de recursos, dicionário, licença específica e datas. Baixar uma amostra, relacionar espelho e íntegra por identificadores documentados e medir PDFs digitalizados. Sincronizar por recurso e checksum, inclusive substituições de arquivos antigos; não assumir que cada recurso é um único julgamento.

**Utilidade:** pesquisa com filtros, fundamentação com citação verificável e comparação de precedentes. Espelho é representação estruturada; não substitui o inteiro teor. Recursos enumerados não são contagem de decisões.

## 3. TJDFT: API pública de jurisprudência

**Documentado:** [manual oficial](https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/documentacao_api_seti_transparencia.pdf/@@download/file/Documenta%C3%A7%C3%A3o_API_SETI_Transpar%C3%AAncia.pdf) descreve `POST https://jurisdf.tjdft.jus.br/api/v1/pesquisa`, JSON com `query`, `pagina` iniciando em zero e `tamanho`; filtros opcionais em `termosAcessorios`.

**Descoberta:** registrar filtros permitidos, tamanho máximo e condições de reutilização; testar termo restrito e duas páginas; verificar IDs, URLs, ementa versus íntegra e atualizações. Não extrapolar essa API para consulta de processos em andamento.

**Utilidade:** primeiro conector regional de pesquisa jurisprudencial, com contrato documentado e comparação com STJ.

## 4. TJAM: processos, documentos e buscas

**Documentado:** a página de [dados abertos do TJAM](https://www.tjam.jus.br/index.php/dados-abertos), obtida diretamente, declara acesso sem login, senha, token ou habilitação prévia. Descreve consulta de processo de primeiro/segundo graus, buscas por partes e advogados e documento individual em bytes PDF. Publica:

- PROJUDI: `https://projudi.tjam.jus.br/projudi/webservices/consultaProcessualWebService?wsdl`.
- SAJ: `https://consultasaj.tjam.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao?wsdl`.

**Descoberta:** obter os dois contratos, mapear as operações reais separadamente e testar processos públicos conhecidos. Verificar se a resposta contém movimentos e quais documentos estão disponíveis. Esclarecer quotas, reutilização comercial e restrições de pesquisa nominal no [Balcão oficial](https://balcao.tjam.jus.br/) quando necessário. A declaração de acesso público não confirma licença irrestrita nem disponibilidade do serviço, ainda não testado.

**Utilidade:** piloto concreto de ligação de processo ao Cofre, atualização de movimentos e importação seletiva de documentos; não iniciar com coleta indiscriminada por nomes.

## 5. MNI/PJe: contratos comuns, habilitação local

**Documentado:** o [STF](https://portal.stf.jus.br/textos/verTexto.asp?pagina=mni&servico=processoIntegracaoInformacaoGeral) descreve integração institucional, termo de adesão e credenciais de homologação. Não demonstra elegibilidade de um SaaS privado. Um [anexo oficial do TRT3](https://portal.trt3.jus.br/internet/transparencia/licitacoes-e-contratos/contratos/contratos-comprasnet/480979/act_id_973394.pdf/@@cached-display-file/file/act_id_973394_2026_03_21_04_46_30.pdf) exige credenciais PJe e identificação do convênio/CNPJ e limita documentos por requisição.

**Descoberta:** em cada instalação PJe, encontrar página MNI e regulamento vigente, determinar se escritório/fornecedor é elegível, obter versão WSDL/XSD e credenciais próprias autorizadas. Inventariar operações de consulta separadamente de peticionamento ou confirmação de recebimento. Testar somente consultas que não produzam ciência ou alteração processual.

**Utilidade:** capa, movimentos e documentos autorizados do escritório, conforme capacidades efetivas. Não tratar MNI como credencial universal nem como API pública nacional.

## 6. eproc, e-SAJ e Projudi: validar cada instalação

**eproc:** o [TJAC documenta SOAP público](https://www.tjac.jus.br/servicos/consulta-web-service/documentacao-api/) para `listarTabelas`, `consultarDados` e `listarEstrutura`, com WSDL `https://eproc1gws.tjac.jus.br/eproc/wsdl.php?srv=consultarTabela`. Serve para tabelas de domínio; não comprova acesso a autos. Buscar no tribunal-alvo a integração processual específica, normas e elegibilidade; manter versões por grau e sistema.

**e-SAJ:** a [integração fiscal TJSP](https://www.tjsp.jus.br/ProcessoDigitalExecFiscalProc) exige convênio para procuradorias/autarquias. É evidência de serviço institucional, não de disponibilidade ao Lume. Confirmar separadamente consulta pública, eventual serviço autorizado e migração para outro sistema.

**Projudi:** usar TJAM como primeira investigação documentada. Não copiar seus endpoints ou condições para TJPR/TJGO: localizar seus próprios contratos e regras.

**Utilidade:** histórico completo e documentos onde permitido. Se só houver portal, verificar condições de automação antes de construir coletor; CAPTCHA, login ou bloqueio significam reavaliar acesso, sem contorno. Manter importação manual como alternativa explícita.

## 7. STF Corte Aberta: bases estatísticas

**Documentado:** [publicação oficial de 14/09/2026](https://noticias.stf.jus.br/postsnoticias/corte-aberta-reune-dados-do-stf-em-paineis-interativos-e-bases-para-download/) anuncia bases XLSX/CSV e dicionário de dados.

**Descoberta:** seguir os links do Corte Aberta, inventariar arquivos de acervo/decisões, cobertura temporal, granularidade, licença e periodicidade. Testar recursos individuais e atualização por hash. Esta pesquisa não confirmou API pública de consulta de inteiro teor.

**Utilidade:** contexto estatístico e exploração de acervo; não substituir processos nem jurisprudência textual com tabelas agregadas.

## 8. TPU/SGT: taxonomia nacional

**Documentado:** o [webservice público CNJ](https://www.cnj.jus.br/sgt/infWebService.php) publica WSDL `https://www.cnj.jus.br/sgt/sgt_ws.php?wsdl` e operações de busca e detalhe para assuntos, movimentos e classes.

**Descoberta:** obter WSDL/dump oficial, testar código conhecido e hierarquia; capturar versões, vigência e itens desativados. Conservar códigos locais e seu mapeamento, sem sobrescrever o texto original.

**Utilidade:** filtros consistentes, normalização de movimentos e agrupamento entre tribunais. Código semelhante não prova significado idêntico de evento.

## 9. DataJud: opcional e condicionado

**Verificado em texto oficial completo:** a [Portaria CNJ 374/2026](https://atos.cnj.jus.br/atos/detalhar/6972), publicada em 19/08/2026, prevê remessa diária com transição de 180 dias. Acrescenta ao mínimo normativo prioridade, sistema eletrônico e polos quando pessoas jurídicas. Isso corrige a afirmação absoluta de que nunca há partes; a implementação real desses campos na API não foi testada.

O ato mantém finalidade não comercial, veda modificação/distribuição/venda/exploração comercial, exige atribuição e não garante atualidade. Processos sigilosos devem ser excluídos ou anonimizados. O conector deve permanecer fora do caminho crítico comercial até definição documentada do uso permitido. Obrigação de envio diário não é SLA de disponibilidade.

## Resultado e limites

Priorizar provas de conceito DJEN, STJ, TJDFT e TJAM, mais TPU como suporte. As chamadas CKAN e páginas documentais foram verificadas; serviços processuais, autenticação, completude, desempenho e elegibilidade comercial ainda exigem validação específica. Documentação-only: nenhum código da aplicação mudou e testes da aplicação não se aplicam.
