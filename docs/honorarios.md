# Honorários

O módulo `/app/honorarios` registra os honorários de cada pessoa, suas parcelas e os recebimentos informados por ela. O caso do Cofre é opcional. A lista mostra parcelas a receber, recebidas e canceladas.

## Cadastro e recebimentos

O cadastro reúne cliente, descrição, observações e parcelas. O formulário gera uma programação mensal a partir do valor total, da quantidade de parcelas e do primeiro vencimento. A pessoa confere e ajusta valores e datas antes de salvar. A última parcela recebe os centavos restantes da divisão. Vencimentos no fim do mês usam o último dia válido quando necessário.

Cada parcela aceita recebimentos parciais ou integrais, com data, meio e observação. O saldo é o valor da parcela menos os recebimentos que continuam válidos. A situação de atraso considera o vencimento e o saldo em aberto, usando a data de São Paulo. A data do recebimento não pode ser futura.

Desfazer um recebimento exige motivo e mantém o registro original, o autor e a data da correção. Essa ação corrige o controle interno. Não movimenta dinheiro nem solicita reembolso bancário.

Um honorário pode ser cancelado quando não possui recebimentos válidos. O cancelamento preserva seu histórico e retira os valores dos totais. Valores, vínculos e cronograma não são editados depois do cadastro. Nesta versão, também não há cancelamento isolado de parcela ou renegociação de parcelas futuras após um recebimento.

## Propostas, tabelas e formação do preço

Em `/app/honorarios/propostas`, a pessoa consulta uma seleção de 30 atividades das tabelas OAB-PE e OAB-RS, edição 2026, e os links para os documentos integrais. O item, a página e a fonte ficam preservados na proposta. A data do serviço não determina automaticamente a vigência da tabela: o enquadramento precisa ser conferido.

A composição admite valor fixo por fase ou ato, horas, mensalidades e percentual. Cada componente pode ser exigível conforme a contratação ou condicionado ao êxito. O total contratado fica separado do êxito estimado. A referência da OAB não é somada automaticamente ao percentual. A tela mostra o valor publicado, a regra e um aviso quando o total estimado é inferior à referência monetária.

A proposta registra escopo, pagamento, despesas, hipótese de acordo, justificativa e planejamento de rateio. É possível revisá-la, consultar versões anteriores e exportar PDF/JSON. Não há assinatura eletrônica nem transferência de valores pelo rateio previsto.

Registrar contratação ou êxito é uma ação explícita. Ela exige evidência e gera as parcelas uma única vez por componente. Êxito percentual exige o benefício efetivamente obtido. Depois de gerar parcelas, a proposta deixa de ser editável; novos ajustes são novas propostas, sem modificar automaticamente o saldo anterior. Evidências, referências e rateios permanecem privados, mesmo quando as parcelas ficam visíveis a participantes de um caso.

O módulo [Calc](analise-honorarios-calc-2026-10-04.md#escopo-revisado-e-implementado-do-calc), em `/app/calc`, oferece sete cálculos e permite usar o resultado de uma versão salva como base da proposta. Esse vínculo não gera recebimentos automaticamente.

## Acesso e valores

Cada pessoa consulta os honorários que cadastrou no escritório ativo. Ser administrador do escritório não concede acesso aos honorários particulares de outra pessoa. Quando existe um caso vinculado, seu criador e os participantes cadastrados também podem consultar os valores. Isso inclui participantes de outros escritórios. Os compartilhados aparecem independentemente do escritório ativo.

Somente quem cadastrou pode registrar baixas, corrigir recebimentos e cancelar o honorário. Essa pessoa precisa manter o vínculo com o escritório e a sessão válida. Os demais participantes recebem consulta, sem poder alterar o registro.

Remover uma participação ou excluir o caso retira o acesso compartilhado. O dono mantém seu histórico financeiro enquanto possui acesso ao escritório. O módulo não acrescenta valores aos dados gerais de clientes ou casos, nem libera o cadastro completo de um cliente externo.

O servidor deriva o escritório da sessão e revalida o acesso antes de executar cada operação. O cliente precisa pertencer ao escritório ativo. No cadastro financeiro direto, o caso pode ser do escritório ou compartilhado com a pessoa; o servidor resolve o escritório proprietário e confere o acesso. Propostas e cálculos novos aceitam apenas casos próprios e permanecem privados por pessoa e escritório.

Valores são inteiros em centavos. O banco guarda parcelas, recebimentos e correções separadamente. Os saldos são calculados a partir desses registros. Os totais incluem apenas registros visíveis à pessoa e respeitam os filtros de busca, cliente, caso e vencimento, mas não a aba nem a página da lista. Um filtro de vencimento não representa o período em que o dinheiro entrou.

## Persistência e operação

As migrações `apps/web/db/postgres/0037_honorarios.sql` e `0038_honorarios_indexes.sql` criam a base financeira. `0071_calc_and_fee_pricing.sql` e `0072_fee_quotes.sql` acrescentam cálculos, índices, propostas, versões e a formação do preço, preservando os registros existentes. Execute `pnpm db:setup` antes do build. Calc e propostas não exigem credenciais novas; a consulta de índices depende de acesso à API pública do Banco Central.

Os contratos financeiros ficam em `apps/web/src/lib/honorarios/contracts.ts`; a precificação, em `pricing.ts`, e as propostas, em `quotes.ts`. `service.ts` concentra referências, saldos, recebimentos e cancelamento. As operações usam `/api/honorarios/[operation]` e a camada de capabilities do aplicativo. Calc usa `src/lib/calc` e `/api/calc/[operation]`.

Cada gravação exige uma chave de idempotência. A reserva da chave, a alteração e a resposta são confirmadas na mesma transação. Repetir a mesma solicitação retorna o resultado salvo. Reutilizar a chave com dados diferentes resulta em conflito. Recebimentos, correções e cancelamentos bloqueiam o mesmo honorário durante a transação, impedindo que duas baixas ultrapassem o saldo.

O catálogo de capabilities publica as operações autorizadas para o assistente e WebMCP. O agente consulta parcelas e propostas e registra recebimentos com valor, data, meio e chave idempotente; não substitui uma baixa financeira por uma nota no cliente. Estornos e cancelamentos exigem confirmação dos argumentos. Gerar parcelas de uma proposta fica disponível na interface e em WebMCP, sem execução automática pelo agente.

O financeiro prepara cobranças com instruções PIX, boleto já emitido e histórico de envio manual. Lembretes ao responsável respeitam preferências e situação da parcela. Isso não emite boleto bancário, movimenta dinheiro ou aplica juros automaticamente às parcelas financeiras. Atualizações de valores ficam no Calc. A assinatura Lume permanece no módulo Plano e no financeiro da plataforma.

## Verificação

`apps/web/tests/honorarios.test.ts` exercita as operações com PostgreSQL real. A validação cobre isolamento, autorização, concorrência, idempotência, recebimentos e correções. `calc-engine.test.ts` verifica as fórmulas e `calc-service.test.ts`, as versões, propostas, êxito, índices e privacidade.

Execute na raiz do repositório:

```sh
pnpm --filter @k5/web test tests/honorarios.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm db:setup
pnpm build
```

`apps/web/e2e/honorarios.e2e.ts` verifica parcelamento, baixas, correção, abas, cancelamento, erro e celular; `honorario-charge.e2e.ts`, a cobrança com PIX, boleto e PDF; `calc.e2e.ts`, os cálculos, versões, exportações e passagem para proposta/parcelas. Os testes criam escritórios sintéticos e integram a [suíte e2e](../apps/web/README.md#testes-end-to-end).
