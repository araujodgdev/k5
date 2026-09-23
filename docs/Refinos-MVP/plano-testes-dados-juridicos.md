# Testes e gate de liberação — dados de tribunais e jurisprudência

Data: 22/09/2026. Parte do [plano de execução](plano-execucao-dados-juridicos.md). Define as três
suítes, onde cada arquivo de teste mora, como uma fixture de fonte real entra no repositório e qual
é o checklist que uma instalação precisa passar antes de `--live`.

A regra que organiza tudo: **um item das trilhas A, B ou C só está entregue quando o teste nomeado
no bloco `Teste que acompanha` existe, falha se o código for removido, e passa.**

## As três suítes

| Suíte | Comando | Onde roda | O que prova |
| --- | --- | --- | --- |
| Determinística | `pnpm test` | Sempre, inclusive em CI de PR | Contrato, normalização, autorização, durabilidade e isolamento, sobre amostras gravadas |
| Navegador | `pnpm --filter @k5/web test:browser` | Job próprio em CI | As doze guardas da [trilha C](plano-automacao-navegador.md), com Chromium de verdade contra site local |
| Conformidade ao vivo | `pnpm judicial:probe` e `pnpm judicial:canary` | Operador, nunca em CI | Que o contrato documentado corresponde à resposta real da fonte |

As três são separadas de propósito. A primeira precisa ser rápida e não pode depender de rede. A
segunda precisa de Chromium e de 1–2 minutos a mais. A terceira gasta requisição de um tribunal e
exige habilitação — colocá-la em CI significaria consultar um tribunal a cada pull request.

### Por que os testes de navegador ficam em um diretório próprio

`apps/web/package.json` define `"test": "tsx --test tests/*.test.ts"`. O glob é de um nível, então
os testes de navegador ficam em **`apps/web/tests/browser/`** e não entram na suíte padrão. Quem
não tem Chromium instalado continua rodando `pnpm test` normalmente.

`apps/web/tests/package.json` fixa `"type": "commonjs"` para a pasta inteira; o subdiretório herda
isso, e `@playwright/test` carrega como CommonJS sem ajuste.

## Arquivos novos

### Suíte determinística

| Arquivo | Trilha | Cobre |
| --- | --- | --- |
| `tests/judicial-conformance.test.ts` | A1 | Probe, relatório de campos desconhecidos, sanitização de fixture |
| `tests/judicial-djen-contract.test.ts` | A2 | Contrato fixado, certidão, reconciliação de caderno, duas instalações |
| `tests/judicial-mni.test.ts` | A3, A6 | Envelope, XXE, credencial, faults, graus, pureza; parametrizado por instalação |
| `tests/judicial-case-pipeline.test.ts` | A4 | Linha de base, alertas, deduplicação, órfãos, isolamento |
| `tests/judicial-vocabulary.test.ts` | A5 | Importação idempotente, história preservada, código desconhecido |
| `tests/judicial-operations.test.ts` | A7 | Canário, degradação por instalação, painel |
| `tests/jurisprudence-ckan.test.ts` | B1 | Licença por recurso, checksum, versões, truncamento |
| `tests/jurisprudence-api.test.ts` | B2 | Paginação, filtros declarados, ementa versus íntegra |
| `tests/jurisprudence-scope.test.ts` | B3 | Escopo de corpus versus escritório, permissões de IA e redistribuição |
| `tests/jurisprudence-search.test.ts` | B4 | Citação resolvível, rótulo de origem, conteúdo não confiável |
| `tests/jurisprudence-ranking.test.ts` | B5 | Ordenação determinística, desempate, filtros |

### Suíte de navegador

| Arquivo | Trilha | Cobre |
| --- | --- | --- |
| `tests/browser/portal-runner.test.ts` | C1 | Filtro de fila por tipo, snapshot antes do parse, pureza, recusa de loopback em produção |
| `tests/browser/portal-recipes.test.ts` | C2 | Receita fechada, sem seletor externo, teto de paginação |
| `tests/browser/portal-guards.test.ts` | C3 | As doze guardas |
| `tests/browser/portal-gate.test.ts` | C4 | Portão de habilitação de portal |
| `tests/browser/portal-jurisprudence.test.ts` | C5 | Primeira receita real contra o site de amostra |

### Fixtures

```
tests/fixtures/judicial/     amostras de DJEN, MNI, TPU e conformidade
tests/fixtures/jurisprudence/ pacotes CKAN, respostas de API e o conjunto de avaliação
tests/fixtures/portal/        o site de amostra: HTML, robots.txt, PDF e arquivo grande
```

## Como uma fixture de fonte real entra no repositório

Fixture sintética prova consistência do parser. Fixture real prova entendimento do contrato. A
segunda só entra assim:

1. `pnpm judicial:probe <id> --operation <op> --office <id> --record <nome>` grava a resposta.
2. O gravador aplica `sanitizeForFixture`: CPF, CNPJ, OAB, e-mail, telefone e elementos de
   credencial saem; a **estrutura e os nomes dos campos permanecem**, porque são exatamente o que
   está sendo testado.
3. Uma pessoa lê o arquivo antes de versioná-lo. A sanitização automática é a primeira barreira,
   não a única.
4. O relatório de conformidade da mesma execução é anexado ao pull request.
5. Publicações reais trazem nomes de partes por natureza. Quando a amostra não puder ser
   despersonalizada sem destruir o que se quer testar, ela **não** é versionada: fica fora do
   repositório e o teste usa a variante sintética, com a limitação registrada no item.

Nenhuma fixture versionada contém segredo, token ou senha — inclusive as de MNI, cujo teste procura
a string da credencial em snapshot, erro e log justamente para garantir isso.

## Esqueletos

O estilo é o do repositório: `node:test`, `assert/strict`, `testDb` e `testDatabase` vindos de
[`test-setup`](../apps/web/tests/test-setup.ts), fixtures lidas por URL relativa.

### Conector, sem rede

```ts
import "./test-setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ConnectorError, type InstallationRef } from "../src/lib/judicial/contracts";
import { createMniConnector, MNI_PARSER_VERSION } from "../src/lib/judicial/connectors/mni";
import { fixtureKey, fixtureTransport } from "../src/lib/judicial/connectors/transport";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
}

/** Um transporte que falha se for tocado: é assim que "normalize é puro" vira asserção. */
const refusingTransport = {
  mode: "fixture" as const,
  request() { throw new Error("normalize não pode tocar a rede"); },
};

test("XXE: DOCTYPE e ENTITY são recusados antes do parse", () => {
  const connector = createMniConnector(refusingTransport);
  assert.throws(
    () => connector.normalize("lookupCase", fixture("mni-xxe.xml")),
    (error: unknown) => error instanceof ConnectorError && error.code === "schema_changed",
  );
});

test("credencial não aparece em snapshot, erro nem log", async () => {
  const SENHA = "senha-de-fixture-nao-use";
  const logs: string[] = [];
  const restore = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    const inst = installation({ kind: "mni", liveTransportEnabled: false });
    const transport = fixtureTransport(new Map([
      [fixtureKey(inst.id, "POST", "intercomunicacao", {}), { body: fixture("mni-consultarProcesso-ok.xml") }],
    ]));
    const result = await createMniConnector(transport)
      .lookupCase!(inst, { identity: { cnjNumber: VALID, nativeNumber: null, degree: "first" }, credential: SENHA });

    for (const payload of result.rawPayloads) assert.ok(!payload.body.includes(SENHA));
    assert.ok(!logs.join("\n").includes(SENHA));
    assert.equal(result.source.parserVersion, MNI_PARSER_VERSION);
  } finally {
    console.log = restore;
  }
});
```

### Esteira, com banco

```ts
import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import test from "node:test";

import { processNextJudicialJob } from "../src/lib/judicial/jobs/collector";
import { enqueueJob } from "../src/lib/judicial/jobs/queue";

test("primeira coleta grava linha de base sem alertas", async () => {
  const { officeId, linkId, installationId } = seedLinkedCase();

  await enqueueJob({ officeId, installationId, linkId, kind: "refresh", operation: "lookupCase", request: {} });
  const outcome = await processNextJudicialJob();

  assert.equal(outcome?.status, "completed");
  assert.equal(outcome?.inserted, 12);
  assert.equal(outcome?.alerts, 0, "a primeira visão de um processo não é notícia");

  const alerts = testDb.prepare("SELECT COUNT(*) AS total FROM judicial_alert WHERE office_id = ?").get(officeId);
  assert.equal(alerts.total, 0);
});

test("reexecutar o job é inerte", async () => {
  // … mesma preparação, o job é enfileirado de novo com a mesma chave de idempotência
  const second = await processNextJudicialJob();
  assert.equal(second?.inserted, 0);
  assert.equal(second?.alerts, 0);
});
```

### Guarda de navegador, com Chromium

```ts
import "../test-setup";
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";

import { createPortalRunner } from "../../src/lib/judicial/portal/runner";
import { ConnectorError } from "../../src/lib/judicial/contracts";

/** Site de amostra local. O runner de teste recebe allowLoopback; o de produção, nunca. */
async function sampleSite(pages: Record<string, { type: string; body: string }>) {
  const server = createServer((req, res) => {
    const page = pages[req.url ?? "/"];
    if (!page) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": page.type }).end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test("guarda 3: Disallow impede a primeira navegação e não gasta orçamento", async () => {
  const site = await sampleSite({
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /pesquisa\n" },
    "/pesquisa": { type: "text/html", body: "<html><body>não deveria carregar</body></html>" },
  });
  try {
    const runner = createPortalRunner({ allowLoopback: true });
    await assert.rejects(
      () => runner.run(installationFor(site.origin), recipeDePesquisa),
      (error: unknown) => error instanceof ConnectorError && error.code === "forbidden",
    );
    assert.equal(await requestsUsedToday(officeId, installationId), 0);
  } finally {
    site.close();
  }
});
```

## CI

O job atual `verify` continua como está. Entra um job próprio para navegador, porque instalar
Chromium em todo pull request custaria ~1 minuto a mais em todas as execuções que não mexem nele.

```yaml
  browser:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version-file: package.json
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @k5/web exec playwright install --with-deps chromium
      - run: pnpm --filter @k5/web test:browser
```

`apps/web/package.json` ganha `"test:browser": "tsx --test tests/browser/*.test.ts"`.

O job `migrations`, que recusa edição de migração já aplicada, continua valendo para as migrações
novas desta entrega: `0018_judicial_coverage.sql`, `0019_jurisprudence.sql` e
`0020_judicial_automation.sql` são arquivos novos, nunca edições dos anteriores.

## Checklist de liberação por instalação

A seção 12 do [plano de infraestrutura](plano-infra-judicial.md) define as áreas. Aqui elas viram
nomes de teste. Uma instalação chega a `--live` quando todas as linhas aplicáveis passam **para
aquela instalação**, com a evidência anexada à ficha.

| Área | Exigência | Onde é verificada |
| --- | --- | --- |
| Conector | Contrato fixado e conferido por sha256 | `judicial-djen-contract`, `judicial-mni` |
| Conector | Ambientes separados; allowlist de um recusa o host do outro | `judicial-djen-contract` |
| Conector | Cursor com mesma data, páginas repetidas, fora de ordem, resposta vazia | `judicial-connector`, `jurisprudence-ckan`, `jurisprudence-api` |
| Conector | 401, 403, 429, 5xx, timeout e mudança de schema | `judicial-connector`, `judicial-mni` |
| Dados | CNJ e numeração legada, vários graus, evento repetido, retificação | `judicial-normalization`, `judicial-case-pipeline`, `judicial-mni` |
| Dados | Fuso e precisão de data; campo ausente; código TPU desconhecido | `judicial-normalization`, `judicial-vocabulary` |
| Autorização | Dois escritórios, papéis, sessão revogada, conexão revogada durante o job | `judicial-pipeline`, `judicial-case-pipeline`, `jurisprudence-search` |
| Autorização | Link externo forjado; snapshot ou documento de outro cliente | `security`, `judicial-case-pipeline` |
| Durabilidade | Queda depois do download e antes do commit; lease expirado; reprocessamento | `judicial-pipeline`, `judicial-case-pipeline` |
| Durabilidade | Commit sem notificação; backfill cancelado; objeto órfão | `judicial-pipeline` |
| Segurança | SSRF, redirect, rede interna, arquivo excessivo, MIME | `judicial-connector`, `portal-guards` |
| Segurança | XXE e bomba de entidades | `judicial-mni` |
| Segurança | Segredo em erro ou log | `judicial-mni`, `portal-guards` |
| Segurança | Conteúdo tentando instruir o agente | `judicial-pipeline`, `jurisprudence-search`, `portal-guards` |
| Produto | Teclado e mobile; fontes parciais; vínculo ambíguo; status atrasado | `capabilities`, `jurisprudence-search`, verificação manual contra `DESIGN.md` |
| IA | Separar fato, ementa, decisão e publicação | `jurisprudence-search` |
| IA | Citação somente de fonte selecionada, em versão congelada | `jurisprudence-search`, `jurisprudence-ranking` |
| Portal | As doze guardas | `portal-guards` |
| Portal | Portão de habilitação com evidência de ausência de API | `portal-gate` |

### Amostra exigida por instalação piloto

Mantida como no plano de infraestrutura, e repetida aqui porque é ela que separa "passou nos
testes" de "funciona no tribunal":

- Pelo menos **30 processos autorizados**, cobrindo classes, graus, ativos, baixados e legados.
- **Dez dias de publicações**, ou o período disponível, confrontados com o caderno oficial.
- Casos sintéticos adicionais para os erros raros que a amostra real não produz sob demanda.
- Processos sem acesso entram como **limitação de cobertura com denominador**, nunca omitidos.

### Metas

| Meta | Valor | Como é medida |
| --- | --- | --- |
| Vazamento entre escritórios nos testes adversariais | zero | `security`, `judicial-case-pipeline`, `jurisprudence-scope` |
| Alertas duplicados nos ensaios de reexecução | zero | `judicial-case-pipeline`, `judicial-pipeline` |
| Evidências exibidas com origem e versão | 100% | `jurisprudence-search` |
| Itens do recorte de referência recuperados ou reportados como lacuna | 100% | relatório de cobertura de A2 e C5 |
| Divergência crítica investigada antes de habilitar | 100% | ficha da instalação, revisada no runbook |

Nenhuma dessas metas certifica cobertura nacional, e nenhuma é promessa de disponibilidade de
tribunal. Elas dizem que o Lume não mente sobre o que coletou.
