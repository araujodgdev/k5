# Falhas encontradas nos testes de A4, A5 e B1

Data: 22/09/2026. Origem: [relatório de testes A4, A5 e B1](../relatorio-testes-A4-A5-B1.md).
A numeração continua a de [falhas-testes-A1-A3.md](falhas-testes-A1-A3.md), cujos itens F4–F6
continuam abertos.

Nenhuma destas falhas aparece nas suítes do plano, que passam todas (272/272). Todas foram achadas
por testes exploratórios, pela mutação ou pela tela. Nada aqui foi corrigido ainda.

| # | Item | Severidade | Resumo |
| --- | --- | --- | --- |
| [F7](#f7--processo-com-resposta-acima-de-512-kib-nunca-é-gravado) | A4 | Alta | Processo com resposta acima de 512 KiB nunca é gravado |
| [F8](#f8--movimentos-ficam-presos-ao-primeiro-vínculo-do-processo) | A4 | Alta | Movimentos ficam presos ao primeiro vínculo do processo |
| [F9](#f9--documento-repetido-num-arquivo-trava-o-recurso-para-sempre) | B1 | Alta | Documento repetido num arquivo trava o recurso para sempre |
| [F10](#f10--recurso-sem-hash-data-e-tamanho-nunca-é-baixado-de-novo) | B1 | Média | Recurso sem hash, data e tamanho nunca é baixado de novo |
| [F11](#f11--zip-sem-limite-de-expansão) | B1 | Média | ZIP sem limite de expansão |
| [F12](#f12--relação-espelho--íntegra-fica-na-versão-antiga) | B1 | Baixa | Relação espelho → íntegra fica na versão antiga |
| [F13](#f13--vigência-invertida-é-aceita-no-catálogo) | A5 | Baixa | Vigência invertida é aceita no catálogo |
| [F14](#f14--versão-antiga-importada-depois-vira-a-corrente) | A5 | Baixa | Versão antiga importada depois vira a corrente |
| [F15](#f15--textos-da-tela-cobertura--a--e-código-n) | A4/A5 | Baixa | Textos da tela: "— a —" e "[código N]" |
| [F16](#f16--lacuna-de-mutação-chave-de-deduplicação-do-alerta) | A4 | Baixa | Lacuna de mutação: chave de deduplicação do alerta |

---

## F7 — Processo com resposta acima de 512 KiB nunca é gravado

**Onde:** `src/lib/judicial/repositories/evidence.ts` (`persistSnapshot`, `INLINE_PAYLOAD_LIMIT`),
chamado por `ingestCase` em `repositories/cases.ts`.

**Reprodução (E4):** a resposta `consultarProcesso` tem 5.000 movimentos, cerca de 600 KiB. O job
termina em `retrying` com a mensagem "Payload acima de 512 KiB recusado: armazenamento de objetos
não disponível para snapshots". Nada é gravado, e a próxima tentativa falha da mesma forma. Com
4.000 movimentos (480 KiB) tudo funciona: a linha de base é gravada em 217 ms e o movimento novo
gera 1 alerta.

**Por que importa:** o limite foi escrito para páginas do DJEN ("every DJEN page in practice"), e o
A4 passou a usá-lo para o processo inteiro. O teste usou movimentos mínimos, de cerca de 120 bytes.
Movimentos reais, com complementos, ocupam várias vezes isso, então o teto real deve ficar em
**algo como 1.000 a 2.000 movimentos**. Processos antigos e execuções fiscais passam disso com
folga. Esses processos nunca seriam acompanhados, e o job ficaria tentando para sempre.

**Correção proposta:** gravar o snapshot grande no `objectStorage()` via `storageKey()`. A tabela
`judicial_snapshot` já tem a coluna `storage_key`, e o armazenamento de objetos já existe no
projeto (é o mesmo que o B1 usa). O limite em memória continua valendo para o que fica inline.
Teste: o E4 com 5.000 movimentos precisa terminar `completed`.

## F8 — Movimentos ficam presos ao primeiro vínculo do processo

**Onde:** `ingestCase` (`ON CONFLICT … link_id = COALESCE(judicial_source_record.link_id,
excluded.link_id)`) e `listMovements` (filtro `r.link_id = ?` / `l.case_id = ?`).

**Reprodução:**
- **E1, vínculo corrigido.** O processo foi vinculado por engano ao caso A, coletado, desvinculado
  e vinculado ao caso B. A coleta seguinte conclui e gera 1 alerta para o caso B, mas a lista do
  caso B mostra **0 movimentos**. Os 4 movimentos continuam no caso A, que já foi desvinculado.
- **E3, mesmo processo em dois casos.** Os dois vínculos coletam, mas o caso 1 vê 3 movimentos e o
  caso 2 vê 0.

**Por que importa:** o registro do processo é único por escritório, fonte e número, mas guarda um
único `link_id`, o do primeiro vínculo, e nunca troca. Corrigir um vínculo errado, que é justamente
o fluxo que o aviso "Este caso tem 2 registros nesta mesma fonte" incentiva, deixa o caso certo
sem histórico para sempre. E o alerta chega para quem não consegue ver o movimento.

**Correção proposta:** não guardar o dono no registro. `listMovements` deve achar os registros
pelos vínculos ativos do caso, casando `installation_id` e `cnj_number` (ou `native_number`) de
`judicial_case_link` com `judicial_source_record`. A coluna `link_id` do registro fica apenas como
"quem pediu a primeira coleta". Testes: E1 e E3.

## F9 — Documento repetido num arquivo trava o recurso para sempre

**Onde:** `src/lib/jurisprudence/sync.ts`, laço de documentos em `syncDataset`.

**Reprodução (E9):** um arquivo traz o documento `D1` duas vezes. Os dois recebem a versão 1,
porque a consulta da versão anterior roda antes do batch. O batch falha com `UNIQUE constraint
failed: jurisprudence_document…`. O resultado é **0 recursos gravados, e a segunda execução baixa
tudo de novo e falha igual.** Sobram 2 arquivos órfãos no armazenamento, um por tentativa.

**Por que importa:** o `declared_checksum` só é gravado junto com o recurso, então um único
registro duplicado faz o recurso inteiro ser baixado e rejeitado a cada ciclo. Isso gasta banda e
armazenamento sem fim. Acervos exportados em lotes costumam repetir registros na virada de um lote
para outro.

**Correção proposta:** deduplicar por `sourceDocumentId` dentro do arquivo antes de montar o batch.
Se o conteúdo for igual, conta como inalterado. Se for diferente, fica o último e a divergência
entra em `coverage.rejected`. Apagar o objeto do armazenamento quando o batch falha. Teste: E9.

## F10 — Recurso sem hash, data e tamanho nunca é baixado de novo

**Onde:** `normalizePackage` em `connectors/ckan.ts` (`declaredChecksum = hash ??
"${updated ?? 'sem-data'}|${size ?? 'sem-tamanho'}"`) e o salto por checksum em `syncDataset`.

**Reprodução (E10):** o recurso não declara `hash`, `last_modified` nem `size`. A primeira execução
baixa. Na segunda, o arquivo ganhou um documento, mas houve **0 downloads e 0 documentos novos**.

**Por que importa:** sem nenhum sinal, o checksum declarado vira a constante `sem-data|sem-tamanho`,
que nunca muda. O acervo congela em silêncio na primeira versão.

**Correção proposta:** quando não houver sinal nenhum, baixar sempre e decidir pelo `sha256` do
conteúdo. O caminho "declaração mudou, bytes iguais" já existe. Registrar essa situação na cobertura
para ficar visível. Teste: E10.

## F11 — ZIP sem limite de expansão

**Onde:** `normalizeResource` em `connectors/ckan.ts` (`entry.asText()` sem teto).

**Reprodução (E12):** um ZIP de 199 KB expande para 200 MB e é lido inteiro, em cerca de 2 s. O
teto de 64 MiB vale só para os bytes baixados.

**Por que importa:** um arquivo de 64 MiB com a mesma taxa de compressão expandiria para dezenas de
GB e derrubaria o worker por falta de memória. O recurso vem de uma fonte externa. A fonte do STJ é
confiável, mas o conector é genérico para qualquer CKAN.

**Correção proposta:** somar o tamanho descompactado declarado de cada entrada antes de ler, e
recusar com `schema_changed` acima de um teto (por exemplo 512 MiB no total, ou uma razão de
compressão acima de 100:1). Teste: E12.

## F12 — Relação espelho → íntegra fica na versão antiga

**Onde:** o `UPDATE … SET related_document_id` em `syncDataset` só preenche relações que ainda
estão `NULL`.

**Reprodução (E11):** o espelho `ESP` declara relação com `INT`. Quando `INT` ganha a versão 2, o
espelho continua apontando para a **v1**.

**Por que importa:** o comentário do código promete "the latest version of the document the source
named". Quem abre o espelho chega à íntegra desatualizada. A v1 continua citável, o que é correto,
mas a navegação deveria levar à versão atual.

**Correção proposta:** decidir qual das duas regras vale. Se a regra for "mais recente", reapontar
também as relações cujo alvo ganhou versão nova. Se a regra for "a versão vista na coleta", corrigir
o comentário. Teste: E11.

## F13 — Vigência invertida é aceita no catálogo

**Onde:** `vocabularyFileSchema` em `normalization/vocabulary.ts`.

**Reprodução (E6):** um termo com `validFrom: 2025-01-01` e `validTo: 2020-01-01` é aceito. Esse
termo nunca aparece como filtro e não produz erro algum.

**Correção proposta:** acrescentar ao `superRefine` a regra `validTo >= validFrom`. Teste: E6.

## F14 — Versão antiga importada depois vira a corrente

**Onde:** `currentVocabularyVersion` em `normalization/vocabulary.ts`, que usa a última versão
inserida, pelo rowid.

**Reprodução (E7):** importar `exp-2026-02` e depois `exp-2025-01`, que nunca tinha sido importada,
faz `exp-2025-01` virar o catálogo corrente. Os rótulos e os filtros regridem.

**Por que importa:** é uma limitação já anotada no código com `ponytail:`. O caso realista é
preencher versões antigas para ter histórico. A CLI não avisa que a corrente mudou.

**Correção proposta:** a mínima é a CLI dizer "Catálogo corrente agora: X (antes: Y)". A completa
é um marcador explícito de versão corrente, que o próprio comentário já sugere.

## F15 — Textos da tela: "— a —" e "[código N]"

**Onde:** `src/components/judicial-case-links.tsx`. Visível nos prints 10–12 do relatório.

- **Cobertura:** "Cobertura documentada pela fonte: **— a —.** É o que a fonte declara cobrir…"
  aparece quando a ficha não declara cobertura. É o mesmo defeito que já foi corrigido no A4 para a
  "janela". O texto deveria ser algo como "A fonte não declara a cobertura."
- **Movimento sem texto:** um movimento que só tem código aparece como "[código 26]", e o rótulo
  "Distribuição" aparece apenas na coluna ao lado. É a melhoria de interface já listada como
  pendente no A5: usar o `tpuLabel` quando o texto da fonte for só o marcador.

## F16 — Lacuna de mutação: chave de deduplicação do alerta

**Onde:** `ingestCase`, `alertDedupeKey('new_movement', 'movement', …)`.

**Reprodução:** trocar a chave por `randomUUID()` (mutação M2) não faz nenhum teste falhar.

**Por que importa pouco:** o alerta também só é criado quando o movimento acabou de ser inserido
(guarda M3, que é detectada). Hoje a chave é uma segunda proteção sem teste. Ela passa a ser a única
se a guarda M3 mudar, por exemplo em uma reingestão que regrave movimentos.

**Correção proposta:** um teste que insere o mesmo alerta duas vezes diretamente, com o mesmo
`recordId` e a mesma impressão digital, e espera 1 linha.
