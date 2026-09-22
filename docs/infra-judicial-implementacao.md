# Infraestrutura judicial: o que existe no código

Data: 19/09/2026. Acompanha o [plano de implementação](plano-infra-judicial.md) e registra o que
foi construído, o que continua fechado e por quê.

Esta entrega implementa a **fase F1 (fundação)** e a parte do **F2 (DJEN)** que não depende de
acesso externo. Nenhum tribunal foi contatado, nenhuma credencial foi solicitada e nenhum processo
real foi coletado. O conector responde a partir de amostras sintéticas registradas no repositório.

## Decisão de localização

O código ficou em `apps/web`, seguindo a seção 10 do plano, e não em um app separado do monorepo.
A infraestrutura judicial reaproveita a sessão, o `office_id`, o catálogo de capacidades, o
armazenamento e a indexação que já existem; um segundo app Next.js duplicaria o modelo de
autenticação e o isolamento por escritório, que é justamente a parte que não pode divergir. A
separação que o plano pede e que foi feita é de **processo**: a coleta roda em
`scripts/judicial-worker.ts`, fora do worker de documentos.

`packages/` continua vazio. Extrair só faz sentido com um segundo consumidor real.

## Os dois interruptores

Uma fonte só contata um tribunal quando **as duas** colunas estão ligadas:

| Coluna | Significado | Padrão |
| --- | --- | --- |
| `enabled` | O operador habilitou a instalação para uso | `0` |
| `live_transport_enabled` | O acesso real à rede foi liberado | `0` |

`pnpm judicial:admin enable <id> --live` é recusado enquanto qualquer uma das cinco condições de
uso estiver como `nao_esclarecido`, ou enquanto a instalação não tiver hosts aprovados. Registrar
uma ficha nunca liga nada.

As cinco dimensões da seção 4.3 — consulta, cache, documentos, redistribuição e IA — são colunas
independentes. Só `permitido` autoriza; `restrito` e `nao_esclarecido` não.

## O que foi implementado

| Área | Onde | Observação |
| --- | --- | --- |
| Esquema e proveniência (J05) | `apps/web/db/migrations/0011_judicial.sql` | 14 tabelas; toda tabela de negócio carrega `office_id` |
| Contratos de conector (J07) | `src/lib/judicial/contracts.ts` | Operações, efeitos jurídicos e a taxonomia de erros da seção 5.2 |
| Normalização | `src/lib/judicial/normalization/` | CNJ com dígito verificador, datas com precisão preservada, impressões de deduplicação |
| Conector DJEN | `src/lib/judicial/connectors/djen.ts` | `normalize` puro, sem rede, com `parserVersion` fixado |
| Transporte seguro | `src/lib/judicial/connectors/transport.ts` | Allowlist por instalação, HTTPS, redirect manual, bloqueio de rede interna, teto de bytes e MIME |
| Fila, leases e orçamento (J06, J08) | `src/lib/judicial/jobs/queue.ts` | Contador de requisições no banco, não no processo |
| Agendador e coletor | `src/lib/judicial/jobs/` | Reavalia a autorização antes de gastar uma requisição |
| Serviço de negócio | `src/lib/application/judicial-service.ts` | Escritório e papel sempre derivados da sessão |
| Capacidades e ferramentas | `src/lib/capabilities/contracts.ts`, `src/lib/agent-tools/` | 11 contratos; UI, HTTP e agente no mesmo executor |
| Rotas | `src/app/api/judicial/` | Nenhuma coleta roda dentro da requisição |
| Worker de coleta | `apps/web/scripts/judicial-worker.ts` | `pnpm judicial:worker`, `--once` em desenvolvimento |
| CLI do operador | `apps/web/scripts/judicial-admin.ts` | `list`, `register --file`, `enable [--live]`, `disable` |
| Testes | `apps/web/tests/judicial-*.test.ts` | 55 testes; amostras sintéticas em `tests/fixtures/judicial/` |

### Decisões que o código impõe

- **Confirmar um vínculo é ato humano.** `k5_judicial_confirm_link` tem `publish: []`: nem o
  agente nem o WebMCP a recebem. Um vínculo nasce `pending_review` e só um confirmado autoriza
  consulta recorrente. O agente pode propor.
- **Um número que falha o dígito verificador não é descartado nem promovido.** Ele vira
  `native_number`, porque numeração legada é identidade real e a coluna CNJ é usada em junção.
- **Disponibilização, publicação, atualização declarada, consulta e ingestão são cinco colunas.**
  Uma data sem hora nunca ganha uma.
- **Achado de backfill é `historical_publication`, não `new_publication`.** Um mês de histórico
  chegando de uma vez não vira tempestade de novidades.
- **Errata e republicação criam linha nova ligada à anterior**, com `supersedes_id`. O original
  permanece.
- **Reexecutar um job é inerte.** A impressão da publicação e a chave de deduplicação do outbox
  transformam a segunda passagem em nenhuma linha nova e nenhum alerta repetido.
- **Credencial recusada não é condição transitória.** `unauthorized` e `forbidden` encerram o job
  e suspendem a assinatura em vez de repetir a recusa a cada intervalo. `schema_changed` vai para
  quarentena, porque a correção é no parser e os originais já estão salvos.
- **Texto coletado é dado, não instrução.** `k5_judicial_get_publication` devolve
  `untrustedContent: true` junto do corpo. Uma das amostras contém texto em formato de injeção,
  justamente para fixar que nada age sobre ele.
- **Desvincular para a coleta e preserva a evidência.** As publicações já coletadas continuam:
  são registro do que um diário publicou.

## O que continua fechado, e por quê

| Item | Motivo |
| --- | --- |
| Conector MNI/SOAP (F3) | Depende de habilitação e homologação em um tribunal. O contrato e os erros existem; o adaptador, não. `connectorFor` recusa com `unsupported`. |
| Acervos STJ/STF (F6) | Depende dos direitos de cada conjunto. |
| DataJud | Restrição comercial não resolvida (seção 1 do plano). |
| Domicílio Judicial Eletrônico (F8) | Acesso ao conteúdo pode aperfeiçoar comunicação processual. Fora desta entrega por decisão, não por falta de tempo. |
| Importação de documentos externos | `fetchDocument` está declarado como efeito `unknown` e não entra no worker genérico. |
| Movimentos processuais | A tabela existe; o produtor é o conector processual, que depende de F3. |
| PostgreSQL (F5) | O banco continua SQLite síncrono. A migração é entrega própria. |
| Peticionamento, ciência e cálculo de prazo | Fora do primeiro produto, por decisão do plano. |

O contrato de requisição e resposta do DJEN foi escrito a partir do formato documentado e **não
foi confrontado com uma resposta de produção**. É por isso que `parserVersion` é fixado e que todo
payload original é persistido: quando o contrato real divergir, corrige-se `normalize` e os
snapshots são relidos, sem consultar o tribunal de novo.

## As telas (seção 9 do plano)

Duas superfícies consomem as mesmas rotas de capacidade, sem acesso próprio ao banco.

| Tela | Onde | O que ela recusa a fazer |
| --- | --- | --- |
| Vincular processo | Painel "Processos" na raiz de um caso do Cofre ([`judicial-case-links.tsx`](../apps/web/src/components/judicial-case-links.tsx)) | Confundir a cobertura declarada pela fonte com o que o Lume coletou; concluir que o processo não existe a partir de uma resposta vazia; confirmar um vínculo sem uma pessoa. |
| Caixa de publicações e mudanças | Central de comando ([`judicial-inbox.tsx`](../apps/web/src/components/judicial-inbox.tsx), rota [`/app/command-center`](../apps/web/src/app/app/command-center/page.tsx)) | Achatar publicação nova, achado histórico de varredura, correção da fonte e falha de atualização em uma só palavra; apresentar um alerta como substituto da intimação oficial. |

Estados cobertos nas duas: carregando, sem vínculo, sem resultado sob os filtros, múltiplos
registros na mesma fonte, fonte fora do ar ou sem conector, acesso expirado, dados parciais de uma
varredura truncada e coleta atrasada. Os filtros da caixa são aplicados no servidor antes do
limite; o histórico persistido das coletas restaura esses estados após recarregar a página, e
listas de processos com mais de uma página oferecem continuação. A frase sobre intimação oficial
fecha as duas telas.

## Como um operador liga uma fonte

```sh
# 1. Escreva a ficha da instalação (seção 4.3 do plano)
cp apps/web/db/sources/djen.example.json apps/web/db/sources/minha-fonte.json

# 2. Registre. Isso não habilita nada.
pnpm judicial:admin register --file db/sources/minha-fonte.json

# 3. Habilite apenas para amostras registradas
pnpm judicial:admin enable <id>

# 4. Depois da descoberta concluída, com as cinco condições de uso respondidas na ficha:
pnpm judicial:admin enable <id> --live

# 5. Rode o worker de coleta
pnpm judicial:worker
```

`apps/web/db/sources/djen.example.json` é exemplo: o endereço e a versão do contrato não foram
homologados, e todas as permissões estão como `nao_esclarecido` de propósito.

## Verificação executada

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | passou |
| `pnpm typecheck` | passou |
| `pnpm test` | 130 testes, 130 passaram |
| `pnpm build` | passou; as nove rotas `/api/judicial/*` compilaram |
| `pnpm judicial:worker --once` | subiu e encerrou com fila vazia |
| `pnpm judicial:admin` | `register`, `list`, `enable` e a recusa de `--live` verificados |

Os testes de integração reais contra um tribunal exigem acesso permitido e não foram executados,
conforme a seção 12 do plano. As fixtures são sintéticas e não contêm dados pessoais.
