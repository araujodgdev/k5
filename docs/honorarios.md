# Honorários

O módulo `/app/honorarios` registra os honorários de cada pessoa, suas parcelas e os recebimentos informados por ela. O caso do Cofre é opcional. A lista mostra parcelas a receber, recebidas e canceladas.

## Cadastro e recebimentos

O cadastro reúne cliente, descrição, observações e parcelas. O formulário gera uma programação mensal a partir do valor total, da quantidade de parcelas e do primeiro vencimento. A pessoa confere e ajusta valores e datas antes de salvar. A última parcela recebe os centavos restantes da divisão. Vencimentos no fim do mês usam o último dia válido quando necessário.

Cada parcela aceita recebimentos parciais ou integrais, com data, meio e observação. O saldo é o valor da parcela menos os recebimentos que continuam válidos. A situação de atraso considera o vencimento e o saldo em aberto, usando a data de São Paulo. A data do recebimento não pode ser futura.

Desfazer um recebimento exige motivo e mantém o registro original, o autor e a data da correção. Essa ação corrige o controle interno. Não movimenta dinheiro nem solicita reembolso bancário.

Um honorário pode ser cancelado quando não possui recebimentos válidos. O cancelamento preserva seu histórico e retira os valores dos totais. Valores, vínculos e cronograma não são editados depois do cadastro. Nesta versão, também não há cancelamento isolado de parcela ou renegociação de parcelas futuras após um recebimento.

## Acesso e valores

Cada pessoa consulta os honorários que cadastrou no escritório ativo. Ser administrador do escritório não concede acesso aos honorários particulares de outra pessoa. Quando existe um caso vinculado, seu criador e os participantes cadastrados também podem consultar os valores. Isso inclui participantes de outros escritórios. Os compartilhados aparecem independentemente do escritório ativo.

Somente quem cadastrou pode registrar baixas, corrigir recebimentos e cancelar o honorário. Essa pessoa precisa manter o vínculo com o escritório e ter papel de administrador ou advogado. Revisores apenas consultam. Os demais participantes recebem consulta, sem poder alterar o registro.

Remover uma participação ou excluir o caso retira o acesso compartilhado. O dono mantém seu histórico financeiro enquanto possui acesso ao escritório. O módulo não acrescenta valores aos dados gerais de clientes ou casos, nem libera o cadastro completo de um cliente externo.

O servidor deriva o escritório da sessão e revalida o papel antes de executar cada operação. O cliente precisa pertencer ao escritório ativo. O caso pode ser do escritório ou compartilhado com a pessoa. O servidor resolve o escritório proprietário do caso e verifica o acesso antes de vincular o honorário.

Valores são inteiros em centavos. O banco guarda parcelas, recebimentos e correções separadamente. Os saldos são calculados a partir desses registros. Os totais incluem apenas registros visíveis à pessoa e respeitam os filtros de busca, cliente, caso e vencimento, mas não a aba nem a página da lista. Um filtro de vencimento não representa o período em que o dinheiro entrou.

## Persistência e operação

As migrações aditivas `apps/web/db/postgres/0037_honorarios.sql` e `0038_honorarios_indexes.sql` criam as tabelas e os índices do módulo. Execute `pnpm db:setup` antes de iniciar um build. Não há novas variáveis de ambiente, workers ou credenciais de pagamento.

Os contratos ficam em `apps/web/src/lib/honorarios/contracts.ts`. O serviço em `apps/web/src/lib/honorarios/service.ts` concentra referências, saldos, recebimentos e cancelamento. As sete operações usam `/api/honorarios/[operation]` e a camada de capabilities já utilizada no aplicativo.

Cada gravação exige uma chave de idempotência. A reserva da chave, a alteração e a resposta são confirmadas na mesma transação. Repetir a mesma solicitação retorna o resultado salvo. Reutilizar a chave com dados diferentes resulta em conflito. Recebimentos, correções e cancelamentos bloqueiam o mesmo honorário durante a transação, impedindo que duas baixas ultrapassem o saldo.

As operações não são publicadas para o assistente ou WebMCP nesta versão. O controle é manual e não emite PIX, boletos, notas fiscais, juros, correção monetária ou cobranças recorrentes. Os pagamentos da assinatura Lume continuam no módulo Plano e no financeiro da administração da plataforma.

## Verificação

`apps/web/tests/honorarios.test.ts` exercita as operações com PostgreSQL real. A validação cobre isolamento, papéis, concorrência, idempotência, recebimentos e correções.

Execute na raiz do repositório:

```sh
pnpm --filter @k5/web test tests/honorarios.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm db:setup
pnpm build
```

Com o servidor local em execução, `pnpm --filter @k5/web exec tsx scripts/verify-honorarios-ui.ts` verifica o fluxo no navegador e grava evidências em `apps/web/playwright-report/honorarios/`. O script cria dados sintéticos em um escritório de validação. Ele só aceita servidor e banco locais.
