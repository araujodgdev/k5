# Exportação e exclusão dos dados de um escritório

Direitos de acesso, portabilidade e eliminação (LGPD, art. 18) no Lume. Cada escritório pertence a uma pessoa, então "o escritório" e "a conta" são a mesma coisa aqui.

## Exportação (autoatendimento)

Em **Perfil → Seus dados → Exportar dados**, `GET /api/office/export` monta um ZIP em streaming (`src/lib/office-export.ts`):

- `LEIA-ME.txt` descreve o conteúdo.
- `dados/*.jsonl` traz um registro por linha: clientes, casos, pastas, documentos e versões, agenda, honorários, conversas e documentos do Lume, instruções, pesquisas, processos e publicações, WhatsApp, portal do cliente, créditos e pagamentos. As colunas são listadas uma a uma; tokens, hashes, chaves de armazenamento e controles internos não saem.
- `cofre/<caso>/<arquivo>` traz o original atual de cada documento. A Biblioteca fica em `cofre/Biblioteca`.
- `memoria-lume.md` traz a memória de trabalho, quando houver.

Ficam de fora:
- textos extraídos e índices, que podem ser gerados de novo a partir dos originais;
- credenciais de integrações;
- casos de outros escritórios em que a pessoa participa.

Se um original não puder ser lido, o ZIP traz `<arquivo>.indisponivel.txt` no lugar e a exportação continua.

## Pedido de exclusão (autoatendimento)

Em **Perfil → Seus dados → Excluir conta**, a pessoa confirma a senha atual. `POST /api/office/deletion` grava `office_deletion_request` com `scheduled_for` = agora + 7 dias. Até lá, "Cancelar exclusão" (`DELETE`) encerra o pedido. Só um pedido aberto por escritório.

Durante o prazo, a conta continua funcionando normalmente.

## Execução (operador)

O expurgo **não roda sozinho**. Ele é executado por uma pessoa da operação, até existir uma restauração ensaiada (frente 5 de `plano-p0-lancamento-mvp.md`).

```sh
# Aponte para o banco certo de forma explícita.
K5_ENV_FILE=.env.postgres.local pnpm --filter @k5/web office:purge list
K5_ENV_FILE=.env.postgres.local pnpm --filter @k5/web office:purge dry-run <pedido>
K5_ENV_FILE=.env.postgres.local pnpm --filter @k5/web office:purge run <pedido>
```

1. `list` mostra os pedidos agendados e quais já venceram (`due`).
2. `dry-run` executa a exclusão dentro de uma transação e a desfaz, mostrando quantas linhas sairiam de cada tabela, quantos objetos e vetores entrariam na fila e quais tabelas ficam.
3. `run` só aceita pedidos vencidos e roda tudo numa única transação. Em seguida, os processadores apagam os originais no R2 e os vetores (`vault_deletion_queue`), e o Worker web apaga a memória na Honcho (`honcho_deletion`). Acompanhe as duas filas até esvaziarem.

O que `run` faz (`purgeOffice` em `src/lib/office-deletion.ts`):

- Apaga a memória de trabalho, as threads e a geração da Honcho de cada pessoa do escritório.
- Apaga as linhas de todas as tabelas com `office_id`, numa ordem que respeita as chaves estrangeiras. Se alguma linha de outra tabela ainda apontar para o escritório, a transação é desfeita e a mensagem diz qual tabela travou.
- Coloca na fila de exclusão as chaves de armazenamento (`stored_name`, `storage_key`, `signed_storage_key`) e os vetores dos documentos. O material compartilhado de pesquisa (`research/…`) não é do escritório e não entra.
- Anonimiza a pessoa: o nome vira "Conta excluída", o e-mail vira um endereço `.invalid`, e saem as sessões, as credenciais e o perfil. A conta não é apagada porque mensagens enviadas a outros escritórios também pertencem a eles.
- Marca o pedido como `completed` e grava o relatório em `report_json`.

Ficam guardados:
- pagamentos (`billing_*`, `office_billing`), pelo prazo fiscal;
- `platform_audit_log`, pelo prazo do Marco Civil;
- `legal_acceptance`, como prova do aceite, ligado à conta anonimizada;
- o próprio pedido;
- a linha `office`, renomeada, até as filas terminarem.

Cópias de segurança do provedor do banco e da Honcho seguem os prazos de cada fornecedor. A política de privacidade informa isso.

Teste: `apps/web/tests/office-deletion.test.ts`. Verificação de ponta a ponta: `apps/web/e2e/office-data.e2e.ts`.
