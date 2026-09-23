# Falhas encontradas nos testes de A1 e A3

Data: 22/09/2026. Origem: [relatório de testes de A1 e A3](../relatorio-testes-A1-A3.md). Cada item
registra o defeito, como reproduzir e a correção. **F1, F2 e F3 foram corrigidos em 22/09/2026**;
F4, F5 e F6 continuam abertos.

As suítes automatizadas passam (244/244). Os defeitos abaixo apareceram nos testes exploratórios e
nos testes de mutação, que exercitam casos que as suítes não cobrem.

| ID | Severidade | Onde | Resumo | Status |
| --- | --- | --- | --- | --- |
| [F1](#f1--atributo-xml-com--quebra-o-leitor) | Alta | `connectors/soap.ts` | XML válido com `>` dentro de atributo é recusado como `schema_changed` | Corrigido |
| [F2](#f2--probe-relata-conforme-quando-uma-requisição-falhou) | Alta | `jobs/probe.ts` | Probe diz "conforme" e sai 0 quando a segunda requisição foi barrada | Corrigido |
| [F3](#f3--cpf-em-campo-numérico-sobrevive-à-sanitização) | Alta (privacidade) | `connectors/sanitize.ts` | CPF gravado como número JSON chega intacto à fixture | Corrigido |
| [F4](#f4--teto-de-elementos-barra-processos-grandes-e-os-põe-em-quarentena) | Média | `connectors/soap.ts` | Teto de 50 mil elementos barra processos com mais de ~16,6 mil movimentos | Aberto |
| [F5](#f5--sanitização-adultera-hashes-e-identificadores) | Baixa | `connectors/sanitize.ts` | Hash e ids numéricos viram `[cpf]` / `[telefone]` na fixture | Aberto |
| [F6](#f6--três-proteções-sem-teste-que-as-isole) | Baixa (teste) | testes de A1/A3 | Três mutações não derrubam nenhum teste | Aberto |
| [F0](#f0--ambiente-pnpm-do-path-não-lê-o-lockfile) | Ambiente | máquina local | `pnpm` do PATH (9.15.9) não lê o lockfile do pnpm 12 | Contornado |

---

## F1 — Atributo XML com `>` quebra o leitor

**Onde:** [`soap.ts:74`](../../../apps/web/src/lib/judicial/connectors/soap.ts) — o fim da tag é
procurado com `xml.indexOf('>', open + 1)`, sem respeitar aspas.

**Reproduzir (teste exploratório E1):**

```xml
<movimento dataHora="20250101100000">
  <movimentoLocal codigoMovimento="1" descricao="Remessa > Contadoria"/>
</movimento>
```

- Esperado: movimento lido com `sourceText = "Remessa > Contadoria"`.
- Obtido: `schema_changed: XML malformado: tag de fechamento inesperada.`

**Impacto:** `>` literal em atributo é XML válido, e `descricao` de movimento local é texto livre do
tribunal. Um único movimento assim faz o processo inteiro virar `schema_changed`. Com isso o job vai
para quarentena, e o processo não é lido.

**Correção proposta:** achar o fim da tag percorrendo os caracteres e ignorando `>` entre aspas
simples ou duplas, ou usando uma regex de tag que consuma valores entre aspas
(`/<([^\s>\/]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y`). Adicionar E1 como teste
em `tests/judicial-mni.test.ts`.

**Correção aplicada:** `tagEnd()` em `soap.ts` percorre a tag ignorando `>` entre aspas simples ou
duplas; uma aspa sem fechamento continua recusada como `Tag XML sem fim`. Teste:
`F1: '>' dentro de atributo é XML válido e não derruba o leitor` (`tests/judicial-mni.test.ts`).

---

## F2 — Probe relata "conforme" quando uma requisição falhou

**Onde:** [`probe.ts:124`](../../../apps/web/src/lib/judicial/jobs/probe.ts) — a falha do conector
(`failure`) só é considerada quando nenhuma resposta foi capturada. Se a primeira página chegou e a
segunda falhou, a falha é descartada.

**Reproduzir (E19):** instalação DJEN com `rateLimitPerMinute: 10`, primeira página cheia (100 itens) e
`--max-requests 2`. A segunda requisição é barrada pelo intervalo mínimo de 6 s.

- Esperado: saída diferente de 0, com a falha no `detail`.
- Obtido: `exit 0, 1 req, "Resposta conforme ao parser."`

**Impacto:** o probe existe para nunca silenciar. Aqui ele relata uma varredura completa e conforme
quando gastou menos do que o operador pediu e parou por erro. O mesmo vale para qualquer erro depois
da primeira resposta (403, 5xx, teto de bytes).

**Correção proposta:** quando `failure` existir e houver respostas capturadas, manter os relatórios
mas devolver `exitCode: 1` e `detail` com `failure.code: failure.message`. A exceção é
`schema_changed`, que já aparece como `parseError` no relatório e deve continuar saindo com 2. Para o
caso de ritmo, o probe pode esperar `retryAfterMs` como o coletor faz, já que o operador pediu mais
de uma requisição de forma explícita.

**Correção aplicada:** as duas partes.

- Uma falha depois da primeira resposta devolve `exitCode: 1`, com `detail` no formato
  `Probe interrompido após N resposta(s): <código>: <mensagem>`. Os relatórios do que chegou são
  mantidos, nenhuma amostra é gravada e a auditoria registra `error`.
- A exceção é a recusa do parser (`schema_changed` com `parseError` no relatório), que continua
  saindo com 2.
- Entre páginas, o probe espera o intervalo mínimo como o coletor. A primeira requisição e o
  orçamento diário nunca esperam.

Testes em `tests/judicial-conformance.test.ts`:

- `F2: falha depois da primeira resposta não vira 'conforme'`
- `F2: com --max-requests 2 o probe espera o intervalo mínimo em vez de falhar`

---

## F3 — CPF em campo numérico sobrevive à sanitização

**Onde:** [`sanitize.ts:29`](../../../apps/web/src/lib/judicial/connectors/sanitize.ts) —
`sanitizeValue` só aplica os padrões a `string`. Números passam como estão.

**Reproduzir (E9):** `sanitizeForFixture('{"cpf": 12345678909}', 'application/json')` devolve o CPF
intacto.

**Impacto:** a fixture gravada por `--record` vai para o repositório. Um CPF ou CNPJ publicado como
número JSON (comum em campos `documento`, `cpf`, `numeroDocumento`) seria commitado.

**Correção proposta:** tratar `number` como texto (`sanitizeText(String(value))`). Se o resultado
mudar, gravar o token. Além disso, zerar pelo nome da chave (`/cpf|cnpj|documento/i`), como já é
feito para `oab`. Adicionar E9 ao teste de sanitização.

**Correção aplicada:**

- Um número JSON passa pelos mesmos padrões do texto e só vira token se casar. Contagens, páginas e
  ids continuam números.
- Valores (texto ou número) de chaves `cpf`, `cnpj`, `documento` ou `numeroDocumento*` viram
  `[documento]`. `tipoDocumento` não entra, porque a chave precisa ser exatamente `documento`.

Teste: `F3: CPF e CNPJ em número JSON ou em campo de documento não sobrevivem`
(`tests/judicial-conformance.test.ts`).

---

## F4 — Teto de elementos barra processos grandes e os põe em quarentena

**Onde:** [`soap.ts:21`](../../../apps/web/src/lib/judicial/connectors/soap.ts) (`maxNodes: 50_000`)
e [`soap.ts:101`](../../../apps/web/src/lib/judicial/connectors/soap.ts).

**Medição:**

| Movimentos | Tamanho | Resultado |
| --- | --- | --- |
| 10.000 | 2,7 MB | lido em 90 ms |
| 16.000 | 4,4 MB | lido em 116 ms |
| 16.700 | 4,6 MB | recusado: limite de elementos |

**Impacto:** o transporte aceita até 8 MB ([`transport.ts:40`](../../../apps/web/src/lib/judicial/connectors/transport.ts)),
mas o leitor recusa bem antes disso. A recusa sai como `schema_changed`, então o job vai para
quarentena como se o contrato tivesse mudado, quando o problema é o volume. Processos antigos de
execução fiscal podem passar desse número.

**Correção proposta:** alinhar o teto ao limite de bytes (por exemplo, 500 mil elementos; o
desempenho medido é linear) e sinalizar o estouro como `partial`, que é o código que o transporte já
usa para resposta grande demais.

---

## F5 — Sanitização adultera hashes e identificadores

**Onde:** padrões de CPF e telefone em [`sanitize.ts:18-20`](../../../apps/web/src/lib/judicial/connectors/sanitize.ts).
Eles só olham dígitos vizinhos, não letras.

**Reproduzir:**

- E12: `"hash ab12345678901cd"` vira `"hash ab[cpf]cd"`.
- E13: `{"id": "1234567890"}` vira `{"id": "[telefone]"}`.

**Impacto:** não vaza dado, mas a fixture deixa de corresponder à fonte em campos de identidade
(`id`, `hash`, `numeroComunicacao`). O relatório gravado junto com a amostra continua coerente,
porque também é calculado sobre a amostra sanitizada. Uma comparação futura com a produção por id ou
hash, porém, falharia.

**Correção proposta:** exigir fronteira de palavra (`(?<![\w])` e `(?![\w])`) em vez de só dígito, e
não aplicar padrões a chaves de identidade (`/^(id|hash|numero(Comunicacao|Edicao|Pagina))$/i`).

---

## F6 — Três proteções sem teste que as isole

Nos testes de mutação, cada proteção foi removida isoladamente. Três remoções não derrubaram nenhum
teste, porque existe uma segunda camada que cobre o mesmo caso e o teste não distingue qual delas
agiu:

| Mutação | Por que o teste continuou passando | Teste que isola |
| --- | --- | --- |
| M5: sem pré-checagem de `<!DOCTYPE`/`<!ENTITY` em `soap.ts` | o leitor também recusa qualquer `<!` que não seja comentário ou CDATA | afirmar a mensagem `XML com DTD ou entidade declarada foi recusado` |
| M11: sem a lista de operações recusadas em `mni.ts` | a lista de operações permitidas também recusa o nome | afirmar a mensagem `possível efeito de ciência ou peticionamento` |
| M13: sem teto de requisições no transporte do probe | o DJEN já para em `maxPages = maxRequests` | probe com um conector de teste que ignora `maxPages` |

O [plano](../plano-conectores-tribunais.md) diz: "Um teste que não falha se o código for removido
também não conta." As proteções continuam funcionando; o que falta é o teste de cada uma.

---

## F0 — Ambiente: pnpm do PATH não lê o lockfile

**Onde:** máquina local, fora do repositório.

- O projeto fixa `pnpm@12.4.2`, mas o `pnpm` do PATH é o 9.15.9. Ele recusa o lockfile com
  `ERR_PNPM_BROKEN_LOCKFILE ... expected a single document`, porque o formato do pnpm 12 tem dois
  documentos YAML.
- O cache do corepack para o 12.4.2 está incompleto: `Cannot find module ...\corepack\v1\pnpm\12.4.2\bin\pnpm.cjs`.
- Por isso o `@sentry/*` não estava instalado e a suíte `judicial-pipeline` não carregava.

**Contorno usado nos testes:** `npx -y pnpm@12.4.2 <comando>`. Ele usa a versão fixada sem alterar
nada global.

**Correção:** reinstalar o pnpm fixado, por exemplo com `corepack prepare pnpm@12.4.2 --activate`,
depois de limpar `%LOCALAPPDATA%\node\corepack\v1\pnpm\12.4.2`.

---

## Verificação das correções F1–F3

- **Testes novos:** 4, todos passando. Suíte completa: 248/248; typecheck e lint limpos.
- **Contraprova:** o código antigo de cada correção foi recolocado, um de cada vez, e o teste novo
  correspondente falhou em todos os cinco casos (F1, as duas partes do F2 e as duas partes do F3).
- **Exploratórios:** E1, E9 e E19 passam agora. E7, E12 e E13 continuam falhando, por serem F4 e F5.

Prints: [testes](../prints/07-fix-testes.png), [contraprova](../prints/08-fix-contraprova.png),
[exploratórios](../prints/09-exploratorio-pos-fix.png).
