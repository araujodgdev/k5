# Trilha C — Serviço de automação de navegador

Data: 22/09/2026. Parte do [plano de execução](plano-execucao-dados-juridicos.md). Entrega a coleta
por navegador para instalações que **não oferecem interface** — a maior parte dos tribunais
brasileiros, quando o assunto é jurisprudência.

Este é o item mais fácil de fazer errado do plano inteiro. Um coletor de navegador mal desenhado é
indistinguível de um raspador: imprevisível, frágil, e capaz de violar condições de uso sem que
ninguém perceba. A diferença entre as duas coisas não está na tecnologia, está nas guardas — e
guarda que não tem teste não é guarda.

## O que este serviço nunca faz

Antes de qualquer arquitetura, o limite. O serviço **não**:

- resolve CAPTCHA, nem por biblioteca, nem por serviço externo, nem pedindo ao usuário;
- usa plugin de furtividade, user-agent falso para parecer outro navegador, proxy rotativo ou
  qualquer técnica cuja finalidade seja não ser identificado;
- ignora `robots.txt`;
- contorna tela de login, paywall ou bloqueio por IP;
- envia formulário que produza efeito processual — peticionar, dar ciência, protocolar;
- entrega o controle do navegador a um modelo de linguagem.

Isso não é postura: é o que torna a coleta defensável diante do tribunal e do cliente. O
[plano de infraestrutura](plano-infra-judicial.md) já determina que "CAPTCHA, login ou bloqueio
significam reavaliar acesso, sem contorno", e que nenhuma fonte pode ser substituída por raspagem
em silêncio. Esta trilha implementa essa regra em código.

---

## Decisão 1 — O navegador é um transporte, não um pipeline

Um coletor de navegador com armazenamento próprio, deduplicação própria e alertas próprios seria um
segundo produto correndo em paralelo, divergindo do primeiro a cada semana. O navegador entra por
baixo do contrato que já existe:

```
Assinatura → fila judicial → conector (kind: court_portal) → PortalSession → Chromium
                                        ↓
                          snapshot + normalize puro + proveniência + outbox
```

Consequências diretas, e cada uma é um teste:

- A saída do navegador passa por `persistSnapshot` **antes** de ser normalizada, como qualquer
  payload. O HTML serializado é o original guardado.
- `normalize` continua puro. Corrigir um seletor relê o HTML gravado, sem voltar ao portal — a
  mesma propriedade que já protege o DJEN.
- Deduplicação, orçamento, lease, alertas e auditoria são os que já existem. Nada novo.
- O resultado entra em `judicial_publication`, `judicial_movement` ou `jurisprudence_document`,
  conforme a finalidade da instalação. Não há tabela "de raspagem".

## Decisão 2 — Onde o processo roda

O app web tem como alvo de staging o Cloudflare Workers (D1, R2, Vectorize, conforme
[ambientes.md](ambientes.md)). **Chromium não roda em um Worker.** O navegador vive em um processo
Node, em uma imagem própria.

E ele não precisa de RPC: os workers judiciais compartilham banco e fila, e `claimJob` já usa
lease. O runner de navegador é **mais um worker na mesma fila**, filtrado pelo tipo da instalação.

| Peça | Onde |
| --- | --- |
| `apps/web/Dockerfile` | Novo estágio `browser`, com Chromium instalado apenas nele |
| `docker-compose.yml` | Serviço `judicial-browser`, `command: ["pnpm", "judicial:browser-worker"]` |
| `apps/web/scripts/judicial-browser-worker.ts` | Laço que só reivindica jobs de instalações `court_portal` |
| `apps/web/src/lib/judicial/jobs/queue.ts` | `claimJob(now, { installationKinds })`, com junção na instalação |

`playwright` passa de dependência de desenvolvimento a dependência da aplicação; o download do
Chromium (`playwright install chromium`) acontece **somente** no estágio `browser`, de modo que a
imagem do web não engorda.

---

## C1 — Fundação: sessão de portal e worker dedicado

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/src/lib/judicial/portal/session.ts` | `PortalSession`: `goto`, `fill`, `click`, `waitFor`, `capture`, `close`. Nada mais. |
| `apps/web/src/lib/judicial/portal/runner.ts` | `createPortalRunner({ allowLoopback })` sobre Chromium; `fixturePortalRunner` para testes |
| `apps/web/src/lib/judicial/connectors/court-portal.ts` | `createCourtPortalConnector(runner)`, implementa `JudicialConnector` com `kind: 'court_portal'` |
| `apps/web/src/lib/judicial/jobs/queue.ts` | Filtro de tipo em `claimJob` |
| `apps/web/scripts/judicial-browser-worker.ts` | O laço |

`allowLoopback` existe para que os testes possam servir um site de amostra em `127.0.0.1` com
Chromium de verdade. Ele é `false` por padrão e o worker de produção nunca o passa — e existe um
teste que verifica exatamente isso.

### Aceite

1. O worker de navegador reivindica **apenas** jobs de instalações `court_portal`; o worker
   judicial comum reivindica **apenas** os demais. Um job de cada tipo na fila, dois workers, e
   cada um pega o seu.
2. Nenhum job fica órfão quando um dos dois workers não está rodando: ele permanece `queued` e é
   reivindicado quando o worker correto sobe.
3. `capture()` grava o HTML serializado como snapshot antes de qualquer normalização; o sha256 do
   snapshot corresponde aos bytes capturados.
4. `normalize` do conector de portal é puro: recebe o HTML gravado, devolve os registros, sem
   navegador. O teste injeta um runner que lança se chamado.
5. Corrigir um seletor e reprocessar o snapshot produz os registros corrigidos sem nenhuma
   navegação nova.
6. O runner de produção recusa `127.0.0.1` e qualquer endereço privado, mesmo que a ficha os liste.

### Teste que acompanha

`apps/web/tests/browser/portal-runner.test.ts`

```ts
test("cada worker reivindica só o seu tipo de instalação", …)
test("job de portal espera o worker de portal em vez de falhar", …)
test("capture grava snapshot antes de normalizar", …)
test("normalize do portal é puro e dispensa navegador", …)
test("seletor corrigido reprocessa o snapshot sem nova navegação", …)
test("runner de produção recusa loopback mesmo listado na ficha", …)
```

---

## C2 — Receitas versionadas, não um agente navegando

### Problema

A tentação óbvia é dar o navegador ao modelo e pedir "pesquise jurisprudência sobre X no portal do
tribunal Y". Isso produz um sistema que ninguém consegue revisar, que muda de comportamento entre
execuções, que custa uma chamada de modelo por passo e que, em um portal judicial, clica em coisas
que ninguém aprovou.

### Decisão

Cada instalação tem uma **receita**: uma sequência declarativa, tipada, versionada em código e
revisada como código.

```ts
// apps/web/src/lib/judicial/portal/recipes/tjxx-jurisprudencia.ts
export const recipe = definePortalRecipe({
  installationKey: 'tjxx-jurisprudencia',
  version: 'tjxx-juris-2026-09-a',
  operation: 'listPrecedents',
  steps: [
    goto('/pesquisa'),
    fill('#termo', fromInput('query')),
    click('#buscar'),
    waitFor('#resultados'),
    capture(),
    paginate({ next: '#proxima', maxPages: 5 }),
  ],
});
```

Os seletores vivem no repositório, não no banco e não no modelo. A entrada é o mesmo objeto tipado
que o conector já recebe; nenhum texto livre vira navegação. A versão da receita entra no
`parserVersion` do snapshot, então uma mudança de seletor é rastreável até a linha coletada.

### Aceite

1. Um passo com destino fora dos caminhos declarados pela receita é recusado na construção, não em
   tempo de execução.
2. A receita não aceita seletor, URL ou passo vindos do banco, de entrada de usuário ou de saída de
   modelo. O teste tenta as três origens e as três são recusadas pelos tipos e pela validação.
3. `maxPages` é obrigatório em `paginate`; uma receita sem teto não constrói.
4. A versão da receita aparece no `parser_version` do snapshot gravado.
5. Duas execuções da mesma receita sobre o mesmo site de amostra produzem exatamente os mesmos
   registros.

### Teste que acompanha

`apps/web/tests/browser/portal-recipes.test.ts`

```ts
test("passo fora dos caminhos declarados não constrói", …)
test("seletor vindo do banco, do usuário ou do modelo é recusado", …)
test("paginação sem teto não constrói", …)
test("versão da receita entra no parser_version do snapshot", …)
test("duas execuções produzem os mesmos registros", …)
```

---

## C3 — As guardas

Doze regras. Cada uma tem um teste nomeado, e a suíte roda contra Chromium de verdade sobre um site
de amostra servido localmente — porque uma guarda testada contra um duplo de teste prova apenas que
o duplo se comporta.

| # | Guarda | Comportamento exigido |
| --- | --- | --- |
| 1 | **Allowlist em toda sub-requisição** | Cada requisição da página — documento, imagem, XHR, iframe, fonte — é comparada ao `allowedHosts` da instalação. Host fora da lista é abortado e a sessão falha com `forbidden`. |
| 2 | **Rede interna** | Endereço privado, loopback, link-local e CGNAT são recusados, com o mesmo `isPrivateAddress` do transporte. Rebind de DNS entre a resolução e a conexão não passa. |
| 3 | **robots.txt** | Buscado por host, com cache e expiração, e respeitado para os caminhos da receita. `Disallow` aplicável ⇒ a sessão **não começa**, e o erro é `forbidden`. |
| 4 | **CAPTCHA e antibot** | Detectado ⇒ `human_action_required`, assinatura suspensa, **sem repetição**. Nenhum código de resolução existe no repositório. |
| 5 | **Login** | Parede de autenticação ⇒ `unauthorized`. Credencial só é usada a partir de `judicial_connection`, com `holder_kind` declarado, escopo explícito e apenas para processos do próprio escritório. |
| 6 | **Orçamento e ritmo** | Cada navegação reserva uma unidade em `judicial_rate_budget`. Intervalo mínimo por host e **uma** sessão concorrente por host. |
| 7 | **Identificação** | O user-agent identifica o Lume e traz uma URL de contato. Ele nunca imita outro navegador para não ser reconhecido. |
| 8 | **Captura antes de interpretar** | `page.content()` e os PDFs baixados viram snapshot antes de qualquer parse. |
| 9 | **Download** | Só MIME da lista permitida, com teto de bytes. Nenhum executável. O caminho de gravação é do Lume, nunca sugerido pela página. |
| 10 | **Sem código da página** | A extração roda em Node sobre o HTML serializado. Nada é avaliado no contexto da página. |
| 11 | **Conteúdo não confiável** | Tudo que sai daqui carrega `untrustedContent: true` até a superfície. |
| 12 | **Sessão limpa e limitada** | Timeout duro, teto de memória, contexto novo por instalação, nenhum perfil persistente e nenhum cookie atravessando escritórios. |

Toda navegação — inclusive a recusada — grava uma linha em `judicial_access_audit` com URL, status
e bytes.

### Aceite

Cada linha da tabela acima é um aceite. Os que costumam ser esquecidos, explicitados:

1. A guarda 1 vale para **sub-requisições**, não só para a navegação principal: o site de amostra
   carrega uma imagem de host não listado e a sessão falha.
2. A guarda 3 é verificada antes da primeira navegação: com `Disallow: /pesquisa`, o contador de
   orçamento fica **em zero** — nem a primeira requisição acontece.
3. A guarda 4 não tenta de novo: após um CAPTCHA, a assinatura fica `suspended` e o agendador não a
   reagenda no ciclo seguinte.
4. A guarda 6 é medida: dez navegações consomem dez unidades e respeitam o intervalo mínimo, com
   tolerância declarada no teste.
5. A guarda 12 é observável: dois escritórios coletando da mesma instalação não compartilham
   cookie; o teste grava um cookie na sessão de um e verifica ausência no outro.

### Teste que acompanha

`apps/web/tests/browser/portal-guards.test.ts` — Chromium real, site de amostra em `127.0.0.1`
servido por `node:http`, `allowLoopback: true` explicitamente concedido ao runner de teste.

```ts
test("guarda 1: sub-requisição para host fora da lista aborta a sessão", …)
test("guarda 2: endereço privado é recusado mesmo com host listado", …)
test("guarda 2: rebind de DNS entre resolução e conexão não passa", …)
test("guarda 3: Disallow impede a primeira navegação e não gasta orçamento", …)
test("guarda 4: CAPTCHA vira human_action_required e suspende a assinatura", …)
test("guarda 4: assinatura suspensa não é reagendada no ciclo seguinte", …)
test("guarda 5: parede de login vira unauthorized sem tentar credencial", …)
test("guarda 6: dez navegações, dez unidades, intervalo respeitado", …)
test("guarda 6: uma sessão concorrente por host", …)
test("guarda 7: user-agent identifica o Lume", …)
test("guarda 8: snapshot existe antes do primeiro parse", …)
test("guarda 9: MIME fora da lista e arquivo acima do teto são recusados", …)
test("guarda 10: nada é avaliado no contexto da página", …)
test("guarda 11: saída chega ao agente marcada como não confiável", …)
test("guarda 12: cookies não atravessam escritórios", …)
test("toda navegação recusada também grava auditoria", …)
```

O site de amostra fica em `apps/web/tests/fixtures/portal/` com páginas para: resultado normal,
paginação, CAPTCHA, parede de login, sub-requisição externa, `robots.txt` restritivo, PDF
permitido, arquivo grande demais e uma página com texto em formato de injeção.

---

## C4 — O portão: quando é permitido ligar um portal

### Problema

Se ligar um portal for tão fácil quanto ligar uma API, o navegador vira o caminho preguiçoso e a
regra de "API primeiro" morre na prática.

### Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `apps/web/db/migrations/0020_judicial_automation.sql` | `judicial_source_installation` ganha `automation_cleared_at` e `automation_evidence` |
| `apps/web/scripts/judicial-admin.ts` | Bloco `automation` obrigatório na ficha de instalação `court_portal` |

O bloco `automation` da ficha exige quatro respostas, cada uma com evidência e data:

1. Qual interface foi procurada e não existe — com as URLs consultadas.
2. Qual condição de uso do portal autoriza acesso automatizado, citada, ou qual contato foi feito e
   quando.
3. `robots.txt` lido na data, com o trecho aplicável transcrito.
4. Quem no Lume responde por essa instalação.

### Aceite

1. `enable --live` de uma instalação `court_portal` é recusado sem bloco `automation` completo,
   além das cinco permissões já exigidas.
2. Ficha `court_portal` cuja evidência de ausência de API esteja vazia é recusada no `register`.
3. `automation_cleared_at` é gravado com a data do `enable --live` e aparece no painel.
4. Uma instalação que tenha conector de API implementado para o mesmo propósito e tribunal **não**
   pode ser ligada como `court_portal`: o comando recusa e nomeia a instalação existente.
5. A recusa é registrada em auditoria, como qualquer outra decisão de habilitação.

### Teste que acompanha

`apps/web/tests/browser/portal-gate.test.ts`

```ts
test("court_portal sem bloco automation não liga", …)
test("evidência de ausência de API é obrigatória no register", …)
test("portal duplicando propósito de uma API existente é recusado", …)
test("data de liberação de automação é gravada e exibida", …)
test("recusa de habilitação vai para auditoria", …)
```

---

## C5 — Primeira receita real: jurisprudência de um portal

### Entregáveis

Uma receita para o primeiro tribunal escolhido com portal e sem API, escrevendo em
`jurisprudence_document` com as mesmas colunas da [trilha B](plano-jurisprudencia.md):
`content_kind`, licença, atribuição, versão e data de coleta.

Escolha do primeiro alvo: um tribunal do [registro de cobertura](registro-cobertura-judicial.md)
onde (a) a busca de jurisprudência é pública, (b) não há API documentada após a busca do roteiro da
seção 4.2 do plano de infraestrutura, e (c) `robots.txt` permite o caminho de pesquisa. A escolha é
registrada na ficha com as três evidências, e não neste documento — porque `robots.txt` muda.

### Aceite

1. Uma busca por termo conhecido devolve resultados com `content_kind` correto; ementa sem íntegra
   nunca aparece como íntegra.
2. Licença não declarada pelo portal resulta em `nao_esclarecido`, e o documento **não** é indexado
   para IA nem exportável — a mesma regra de B3, agora por um caminho diferente.
3. Cobertura é medida: a amostra compara os resultados do Lume com o portal para dez consultas, e a
   divergência vira número e motivo, não um selo de "funciona".
4. Uma mudança de layout do portal faz a receita falhar com `schema_changed` e colocar a instalação
   em `degraded` — nunca gravar registros parciais como se fossem completos.
5. O snapshot permite recuperar tudo: com o HTML gravado e a receita corrigida, os registros são
   reconstruídos sem uma navegação nova.

### Teste que acompanha

`apps/web/tests/browser/portal-jurisprudence.test.ts`, sobre o site de amostra:

```ts
test("ementa sem íntegra não é apresentada como íntegra", …)
test("licença não declarada bloqueia indexação e exportação", …)
test("mudança de layout vira schema_changed e degrada a instalação", …)
test("registros parciais não são gravados como completos", …)
test("reconstrução a partir do snapshot dispensa nova navegação", …)
```

---

## Custo e limites, sem otimismo

Um navegador custa uma ordem de grandeza mais que uma chamada de API: memória, CPU, tempo de
sessão e manutenção de seletor a cada mudança de layout. A estimativa de manutenção entra no custo
por tribunal do [plano de infraestrutura](plano-infra-judicial.md), seção 13, e **não** é zero.

Por isso a ordem do plano de execução não é negociável: API primeiro, portal só onde o roteiro de
descoberta concluiu que não existe interface. Um portal ligado é uma dívida recorrente assumida
conscientemente, registrada na ficha, com responsável nomeado.
