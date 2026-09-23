# Runbook — da ficha ao `--live`

Data: 22/09/2026. Parte do [plano de execução](plano-execucao-dados-juridicos.md). Este é o
documento operacional: o que uma pessoa faz, em que ordem, para uma fonte sair de "existe
documentação" e chegar a "o Lume consulta".

Ele existe porque **este é o gargalo real**. As trilhas [A](plano-conectores-tribunais.md),
[B](plano-jurisprudencia.md) e [C](plano-automacao-navegador.md) são trabalho de engenharia e
avançam sozinhas. Nenhuma delas liga uma fonte. Ligar é decisão, e decisão precisa de evidência.

## Os dois interruptores e as cinco permissões

Uma fonte só contata um tribunal quando **as duas** colunas estão ligadas:

| Coluna | Significado | Padrão |
| --- | --- | --- |
| `enabled` | O operador habilitou a instalação para uso | `0` |
| `live_transport_enabled` | O acesso real à rede foi liberado | `0` |

E `enable --live` é recusado enquanto qualquer uma das cinco permissões estiver
`nao_esclarecido`, ou enquanto a instalação não tiver hosts aprovados:

| Dimensão | Pergunta que ela responde |
| --- | --- |
| `query` | Podemos consultar esta fonte, de forma automatizada, como fornecedor de software de escritórios? |
| `cache` | Podemos armazenar a resposta, e por quanto tempo? |
| `documents` | Podemos baixar e guardar os documentos que ela oferece? |
| `redistribution` | Podemos mostrar isso ao cliente do escritório, exportar, imprimir? |
| `ai` | Podemos enviar esse conteúdo a um modelo de linguagem? |

`permitido` autoriza. `restrito` e `nao_esclarecido` **não**. Silêncio de um tribunal a um pedido
não vira `permitido` com o tempo.

## Estágios

`discovery_status` tem oito valores e cada avanço exige evidência anexada à ficha.

| Estágio | O que já está provado | Quem decide o avanço |
| --- | --- | --- |
| `candidate` | Alguém acha que a fonte serve. Nada mais. | Engenharia de integrações |
| `documented` | Contrato técnico localizado e fixado com sha256 | Engenharia de integrações |
| `access_pending` | Pedido de acesso enviado, com data e canal registrados | Produto |
| `spike_approved` | As cinco permissões respondidas com evidência; amostra autorizada consultada | Responsável jurídico + produto |
| `pilot` | Amostra de aceite passou; cobertura medida com denominador | Produto |
| `production` | Piloto estável, canário ativo, runbooks de incidente exercitados | Produto + operações |
| `degraded` | Estava em piloto ou produção e algo quebrou; assinaturas pausadas | Automático pelo canário, ou operações |
| `suspended` | Acesso revogado, condição de uso mudou ou decisão de parar | Qualquer um dos responsáveis |

Regra dura: **"não encontrei documentação" é `candidate`**, nunca uma conclusão de que o tribunal
não tem interface. Essa distinção é o que impede o portal virar o caminho preguiçoso.

## Passo a passo

### 1. Abrir a ficha

```bash
cp apps/web/db/sources/djen.example.json apps/web/db/sources/<minha-fonte>.json
```

Preencher a unidade de cobertura: **órgão + instalação + grau + sistema + finalidade + intervalo
temporal**. Uma linha por sigla de tribunal não basta — um TJ pode ter e-SAJ legado, eproc atual,
turmas recursais e diários históricos, e cada um é uma instalação.

### 2. Localizar e fixar o contrato

Buscar no domínio oficial: `API`, `webservice`, `MNI`, `WSDL`, `integração`, `dados abertos`,
`consulta processual`, `jurisprudência`, `diário`. Guardar URL, data e quem investigou.

```bash
# a cópia fixada e o hash vivem ao lado da ficha
curl -o apps/web/db/sources/contracts/<fonte>-<versao>.json <url-oficial>
sha256sum apps/web/db/sources/contracts/<fonte>-<versao>.json \
  > apps/web/db/sources/contracts/<fonte>-<versao>.json.sha256
```

Endpoint observado no navegador continua **não documentado** até esclarecimento.

### 3. Registrar. Isso não liga nada.

```bash
pnpm judicial:admin register --file db/sources/<minha-fonte>.json
pnpm judicial:admin list
```

### 4. Perguntar, quando a documentação não responde

O modelo está na seção 4.3 do [plano de infraestrutura](plano-infra-judicial.md). Três variantes,
porque o interlocutor muda:

| Fonte | Canal | O que perguntar de diferente |
| --- | --- | --- |
| DJEN / CNJ | Canal de comunicações processuais do CNJ | Limites de requisição, cobertura por tribunal e período, condições de reutilização comercial |
| Tribunal com MNI | TI / integrações do tribunal | Elegibilidade de fornecedor de software atuando em nome do escritório, homologação, quais operações produzem ciência |
| Portal de jurisprudência | Ouvidoria ou SIC, quando não há canal técnico | Se existe exportação ou API antes de qualquer automação; condições para acesso automatizado |

Duas regras no contato: **não enviar documento de cliente** e **não pedir credencial pessoal de
advogado**. O envio é uma ação específica, autorizada pelo usuário, e não parte automática de
nenhum plano.

Registrar na ficha: data do envio, canal, protocolo e a data em que se volta a perguntar. Sem
resposta, a permissão permanece `nao_esclarecido` e a instalação permanece `access_pending`. Isso é
um resultado válido: o trabalho segue nas outras fontes.

### 5. Habilitar para amostra

```bash
pnpm judicial:admin enable <id>          # liga a instalação, ainda sem rede
```

Com as amostras registradas, tudo funciona: telas, fila, alertas, normalização. Nenhum byte sai.

### 6. Liberar a rede, quando houver o que liberar

```bash
pnpm judicial:admin enable <id> --live   # recusado enquanto houver nao_esclarecido
```

### 7. Primeiro contato real, uma requisição

```bash
pnpm judicial:probe <id> --operation listChanges --office <officeId> \
  --from 2026-09-15 --to 2026-09-15 --max-requests 1 --record <fonte>-amostra.json
```

Saída esperada: a amostra gravada e sanitizada, e o relatório de conformidade. Código de saída 2
significa campo desconhecido ou campo faltando — nos dois casos, o parser é corrigido **antes** de
qualquer coleta recorrente.

### 8. Amostra de aceite

Mínimo por instalação piloto: 30 processos autorizados cobrindo classes, graus, ativos, baixados e
legados; dez dias de publicações ou o período disponível; casos sintéticos para os erros raros.
Confrontar com o portal oficial e registrar o denominador. Processo sem acesso é **limitação de
cobertura registrada**, não um item omitido da conta.

### 9. Avançar o estágio

Só com a evidência anexada à ficha. O checklist completo está no
[plano de testes](plano-testes-dados-juridicos.md#checklist-de-liberação-por-instalação).

## Fila de trabalho da Onda 0

As cinco primeiras fichas, com o que a pesquisa de 18/09/2026 já apurou e o que falta. Detalhes e
links em [fontes-infra-judicial.md](../fontes-infra-judicial.md).

| # | Instalação | Já sabemos | Falta |
| --- | --- | --- | --- |
| 1 | **DJEN homologação** (`hcomunicaapi.cnj.jus.br`) | Swagger 1.0.4; consultas sem autenticação; ambientes separados na orientação oficial | Fixar o contrato, as cinco permissões, limites de requisição |
| 2 | **DJEN produção** (`comunicaapi.pje.jus.br`) | Endereço declarado na orientação oficial | Tudo de (1), como ficha separada |
| 3 | **STJ dados abertos** (CKAN) | CKAN respondeu; dois conjuntos declaram CC Atribuição com URL de licença | Licença **por recurso**, relação espelho↔íntegra, cadência de atualização |
| 4 | **TJDFT jurisprudência** | Manual oficial descreve `POST /api/v1/pesquisa`, `pagina` em zero | Filtros permitidos, tamanho máximo, condições de reutilização |
| 5 | **TJAM SAJ e Projudi** | Página de dados abertos declara acesso sem login nem habilitação; dois WSDL publicados | Operações reais, quotas, reutilização comercial, restrições de pesquisa nominal |

Acesso público declarado **não** encerra a análise de uso permitido. É por isso que (5) tem duas
linhas de "falta" apesar de a página do tribunal dizer que não exige habilitação.

Em paralelo, e barato: o dump do **TPU/SGT**, que é público e destrava o item A5.

## Runbooks de incidente

Cada um nomeia responsável, ação de suspensão, evidência a preservar e reconciliação. Nenhum apaga
migração, e nenhum tenta desfazer ato judicial externo.

### Credencial recusada (`unauthorized`, `forbidden`)

Não é condição transitória. O job encerra e a assinatura é suspensa — comportamento já implementado.
Ação: verificar validade e escopo em `judicial_connection`, confirmar que a representação do
escritório continua vigente, renovar pelo canal do tribunal. Não repetir a recusa em intervalo.

### Mudança de schema (`schema_changed`)

O job vai para quarentena e os originais já estão salvos. Ação: ler o snapshot, corrigir
`normalize`, subir `parserVersion`, reprocessar os snapshots. **Não consultar o tribunal de novo
para diagnosticar** — a resposta que quebrou já está no banco.

### Fonte bloqueou (`rate_limited` persistente, `source_unavailable`)

Reduzir o orçamento diário da instalação, aumentar o intervalo da assinatura, e só então voltar.
Bloqueio repetido é assunto de contato com o tribunal, não de mais tentativas.

### CAPTCHA ou parede de login em portal (`human_action_required`)

A assinatura é suspensa e **não** é reagendada. Ação: reabrir a investigação da fonte. Nenhuma
tentativa de contorno é aceitável, conforme a [trilha C](plano-automacao-navegador.md).

### Conteúdo com sigilo ou restrição

Preservar a evidência e marcar `visibility` do snapshot. `judicial_snapshot` tem `redacted_at` e
`redaction_reason` para exclusão obrigatória: um snapshot é versionado, não imune a uma ordem.

### Fila parada

Verificar o worker (`pnpm judicial:worker`, e o serviço `judicial` no compose depois de A7), leases
expirados e orçamento esgotado. Um lease expirado é retomado; um job em `running` sem worker vivo
volta para a fila no vencimento.

### Restauração

Ensaiada antes de produção, conforme F5. RPO proposto de 24 horas e RTO de quatro horas para o
piloto. Restaurar não recoleta: os snapshots são a evidência e voltam com o backup.

## Responsabilidades

| Papel | Responde por |
| --- | --- |
| Produto | Escolha de tribunais e escritórios piloto, critério de utilidade, envio dos pedidos de acesso |
| Engenharia de integrações | Contratos, fichas, conectores, conformidade, canários |
| Backend | Persistência, isolamento por escritório, fila e durabilidade |
| Frontend e IA | Seleção de evidência, citação, o que o agente pode e não pode afirmar |
| Operações | Continuidade, painel, incidentes, restauração |
| Responsável jurídico e de proteção de dados | As cinco permissões, efeitos processuais, retenção e exclusão |

A decisão de ligar uma fonte é sempre de pelo menos duas pessoas: quem tem a evidência técnica e
quem responde pela condição de uso. O CLI existe para que essa decisão deixe rastro — ela não
está em um formulário que um membro do escritório preenche.
