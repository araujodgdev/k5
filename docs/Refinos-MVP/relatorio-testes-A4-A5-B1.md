# Relatório de testes: A4 (processo e movimentos), A5 (vocabulário TPU) e B1 (acervo CKAN/STJ)

Data: 22/09/2026. Escopo: os itens A4 e A5 de
[plano-conectores-tribunais.md](plano-conectores-tribunais.md) e o item B1 de
[plano-jurisprudencia.md](plano-jurisprudencia.md). Nenhum teste contatou tribunal nem o portal do
STJ. A Onda 0 (habilitação) não foi feita, e o código recusa acesso real sem ela; o passo 4 mostra
isso acontecendo.

## Resultado em uma linha

**Tudo o que o plano especifica funciona e está coberto por teste. Os testes adicionais acharam 10
defeitos fora das suítes, 3 deles de severidade alta, registrados em
[fix/falhas-testes-A4-A5-B1.md](fix/falhas-testes-A4-A5-B1.md). Nenhum foi corrigido ainda.**

| Camada | O que verifica | Resultado |
| --- | --- | --- |
| 1. Suítes automatizadas | Aceites de A4, A5 e B1, regressão, monorepo inteiro | 272/272, typecheck e lint limpos |
| 2. Testes de mutação | Se cada proteção tem um teste que falha quando ela some | 26 de 27 detectadas |
| 3. Testes exploratórios | Casos de borda fora das suítes | 7 de 16 ok, 9 falhas |
| 4. CLI de ponta a ponta | `judicial:vocab` e `judicial:admin` contra um banco real | Todos os portões se comportaram como esperado |
| 5. Tela e API | Lista de movimentos no desktop e no celular, estados, isolamento | Funciona; 2 ajustes de texto |

## 1. Suítes automatizadas

Os 11 testes do A4, os 5 do A5 e os 8 do B1 passam.

![Suítes A4, A5 e B1](prints/16-suites-a4-a5-b1.png)

O monorepo inteiro também passa: 272 testes, com typecheck e lint limpos.

![Monorepo](prints/17-typecheck-lint-suite.png)

## 2. Testes de mutação

Cada proteção foi removida uma de cada vez, e a suíte do item rodou de novo. Se nenhum teste
falha, a proteção está sem cobertura. O arquivo original foi restaurado depois de cada rodada.

![Mutação](prints/18-mutacao.png)

| Item | Detectadas | Não detectada |
| --- | --- | --- |
| A4 | 9 de 10 | M2: trocar a chave de deduplicação do alerta por um valor aleatório. Hoje outra guarda (M3) segura o comportamento, mas a chave em si não tem teste. Veja [F16](fix/falhas-testes-A4-A5-B1.md#f16--lacuna-de-mutação-chave-de-deduplicação-do-alerta) |
| A5 | 7 de 7 | — |
| B1 | 10 de 10 | — |

## 3. Testes exploratórios

Os casos foram escolhidos para quebrar o código: vínculos corrigidos, volume, arquivos
malformados, fontes sem metadados e ZIP inflado. Nenhum toca a rede. O E13 substitui o
`https.request` para garantir isso.

![Exploratórios](prints/19-exploratorio.png)

**O que passou:**
- Movimento repetido na mesma resposta vira 1 movimento e 1 alerta (E2).
- 4.000 movimentos: a linha de base é gravada em 217 ms, e o movimento seguinte gera exatamente 1
  alerta (E4b).
- Código repetido no catálogo é recusado (E5), e 20 mil termos entram em uma transação em cerca de
  0,6 s (E8).
- URL de recurso em outro host é recusada antes de qualquer chamada de rede (E13).
- Falha no meio da varredura mantém o que já foi gravado, e a execução seguinte baixa só o que
  faltou (E14).
- 10 mil documentos em um arquivo são sincronizados em cerca de 0,9 s (E15).

**O que falhou:**

| Caso | Defeito | Registro |
| --- | --- | --- |
| E4 | Resposta de processo acima de 512 KiB (5.000 movimentos mínimos, bem menos na prática) nunca é gravada, e o job repete para sempre | [F7](fix/falhas-testes-A4-A5-B1.md#f7--processo-com-resposta-acima-de-512-kib-nunca-é-gravado) |
| E1, E3 | Vínculo corrigido ou processo em dois casos: o segundo caso vê 0 movimentos, embora receba o alerta | [F8](fix/falhas-testes-A4-A5-B1.md#f8--movimentos-ficam-presos-ao-primeiro-vínculo-do-processo) |
| E9 | Documento com id repetido no arquivo derruba o recurso inteiro a cada ciclo e deixa arquivos órfãos | [F9](fix/falhas-testes-A4-A5-B1.md#f9--documento-repetido-num-arquivo-trava-o-recurso-para-sempre) |
| E10 | Recurso sem hash, data e tamanho nunca é baixado de novo | [F10](fix/falhas-testes-A4-A5-B1.md#f10--recurso-sem-hash-data-e-tamanho-nunca-é-baixado-de-novo) |
| E12 | ZIP de 199 KB expande para 200 MB sem recusa | [F11](fix/falhas-testes-A4-A5-B1.md#f11--zip-sem-limite-de-expansão) |
| E11 | Espelho continua apontando para a íntegra v1 depois que a v2 chega | [F12](fix/falhas-testes-A4-A5-B1.md#f12--relação-espelho--íntegra-fica-na-versão-antiga) |
| E6 | Vigência invertida é aceita no catálogo | [F13](fix/falhas-testes-A4-A5-B1.md#f13--vigência-invertida-é-aceita-no-catálogo) |
| E7 | Versão antiga importada depois vira a corrente | [F14](fix/falhas-testes-A4-A5-B1.md#f14--versão-antiga-importada-depois-vira-a-corrente) |

Na primeira rodada, o E2 falhou por um erro do próprio roteiro: o nome do caso tinha menos de 2
caracteres e esbarrou na restrição da tabela. Depois de corrigido o roteiro, passou. Não é defeito
do produto.

## 4. CLI de ponta a ponta

O roteiro rodou contra um SQLite temporário no scratchpad, criado com `scripts/setup.ts` e com todas
as migrações, inclusive a 0019. O banco `.data/k5.sqlite` não foi tocado.

![CLI de ponta a ponta](prints/20-cli-e2e.png)

| Passo | Resultado |
| --- | --- |
| `judicial:vocab import` da v1 | 7 termos novos; movimentos existentes não foram alterados |
| Mesma versão de novo | inerte: 0 novos, 7 inalterados |
| Outro conteúdo com a mesma versão | recusado inteiro, lista os 4 termos divergentes, sai com 1 |
| Conteúdo novo com versão nova | 7 termos novos |
| `describe --code 26` | mostra o termo nas duas versões |
| `--version ../x` | recusado pela validação do nome, mostra o uso |
| `judicial:admin register` da ficha do STJ | registrada e desabilitada |
| `enable --live` | recusado: as cinco permissões estão `nao_esclarecido` |

A sincronização do B1 (`syncDataset`) ainda não tem comando de CLI. Ela foi exercitada pelas suítes
e pelos exploratórios com transporte de fixture.

## 5. Tela e API (A4 e A5)

A cópia do banco de desenvolvimento está servida em `next start` na porta 3100, com o caso "Caso de
teste A4" e os catálogos `amostra-v1` e `amostra-v2`. O servidor do usuário na porta 3000 não foi
tocado. Os prints foram feitos com Chrome sem interface, via Playwright, usando uma sessão
temporária criada na própria cópia e apagada no fim, sem usar senha. O mesmo caso também foi aberto
no Chrome do usuário, onde a sessão já estava ativa.

**Desktop:** o painel do processo lista os movimentos em ordem decrescente, cada um com a data, o
texto da fonte e o código. O rótulo TPU vem do catálogo corrente ("TPU 11385 · Audiência de
conciliação designada"). O código local aparece como "Código da fonte 9001" e nunca é promovido a
TPU.

![Processos no desktop](prints/10-a4-processos-desktop.png)

![Lista de movimentos](prints/11-a4-movimentos-desktop.png)

**Celular (390 px):** a grade vira uma coluna, na ordem data, texto e código. Nada vaza na
horizontal. A barra inferior aparece sobreposta no meio do print porque a captura é da página
inteira e a barra é fixa; na tela real ela fica no rodapé.

![Processos no celular](prints/12-a4-processos-mobile.png)

**Estados:** carregando, vazio e erro. As respostas foram simuladas interceptando
`/api/judicial/movements`. Os três estados usam texto simples, sem selos, como pede o DESIGN.md.

| Carregando | Vazio | Erro |
| --- | --- | --- |
| ![Carregando](prints/15-a4-estado-carregando.png) | ![Vazio](prints/13-a4-estado-vazio.png) | ![Erro](prints/14-a4-estado-erro.png) |

**API:** a resposta traz `untrustedContent: true`. O movimento com "IGNORE AS INSTRUCOES
ANTERIORES…" é um texto de injeção plantado de propósito na amostra. Ele aparece como dado,
marcado como não confiável, e não entra no resumo do alerta. Um vínculo de outro escritório, ou
inexistente, responde 404 sem revelar se existe.

![API de movimentos](prints/21-api-movimentos.png)

**Ajustes de texto vistos na tela** ([F15](fix/falhas-testes-A4-A5-B1.md#f15--textos-da-tela-cobertura--a--e-código-n)):
- "Cobertura documentada pela fonte: — a —." aparece quando a ficha não declara cobertura.
- O movimento sem texto aparece como "[código 26]", embora o rótulo "Distribuição" já esteja
  resolvido na coluna ao lado.

## O que não foi testado

- **Contato real com tribunal ou com o portal do STJ:** bloqueado por projeto até a Onda 0.
- **Layout real dos arquivos do STJ:** o parser do B1 usa campos provisórios. O primeiro download
  real precisa passar pelo probe do A1 antes de alguém confiar nele. Isso está anotado na ficha
  `db/sources/stj-dadosabertos.json`.
- **`pnpm build`:** o build de produção usado na porta 3100 é do fechamento do A5. O B1 não mexeu em
  rotas nem em telas.
- **Orçamento de requisições do B1:** a sincronização respeita o ritmo, mas não debita
  `judicial_rate_budget`, que é por escritório. Essa limitação já está anotada no código e não foi
  tratada como defeito aqui.

## Como reproduzir

```bash
npx -y pnpm@12.4.2 test
```

```bash
cd apps/web && npx tsx --test --test-reporter=spec tests/judicial-case-pipeline.test.ts tests/judicial-vocabulary.test.ts tests/jurisprudence-ckan.test.ts
```

Os roteiros de mutação, os exploratórios e os prints ficaram fora do repositório. Cada item do
[arquivo de falhas](fix/falhas-testes-A4-A5-B1.md) diz qual caso exploratório vira o teste de
regressão quando for corrigido.
