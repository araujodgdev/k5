---
name: verify-k5
description: Verifica a interface web do K5 (Tises) em uma instância local isolada, com Playwright, PostgreSQL real e evidências. Use para comprovar fluxos de autenticação, tarefas, clientes e casos do Cofre depois de uma alteração.
---

# Verificar K5

A aplicação principal é `apps/web`, em Next.js, com interface em pt-BR. Esta skill reutiliza os [utilitários existentes](../../../.claude/skills/verify-k5/scripts/k5-verify.mts); mantenha essa pasta junto desta skill. O [mapa de funcionalidades](features/README.md) define os caminhos a verificar e distingue receitas de fluxos executados.

Veja a [execução de comprovação](validation.md) para o resultado, as evidências locais e a falha de foco observada no teste adicional de teclado.

## Launch

Execute na raiz do repositório, em PowerShell. Confira `node --version` e `pnpm --version`: o projeto exige Node >= 22.13.0 e pnpm 12.4.2. Use as dependências já instaladas. Se o sandbox oferecer outro pnpm e tentar reinstalar `node_modules`, use o runtime local correto; não aceite a remoção das dependências para executar a verificação.

```powershell
function Invoke-K5Verify { pnpm --dir apps/web exec tsx ../../.claude/skills/verify-k5/scripts/k5-verify.mts @args }
Invoke-K5Verify status
Invoke-K5Verify up
```

Antes de `up`, confirme que `status` retorna `instance: null`, que `.next-verify` não está sendo usado por outro processo e que a sessão não herda `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `K5_CREDENTIALS_KEY` ou `K5_ENV_FILE`. O setup herda o ambiente do shell. Remova essas variáveis apenas do processo de verificação ou use um shell limpo, sem alterar arquivos privados. Não interrompa uma instância de outro trabalho. Os utilitários compartilham um registro em `%TEMP%/k5-verify-current.json` e um diretório de build; execute uma verificação por vez, inclusive entre checkouts.

`up` cria um PostgreSQL em `%TEMP%/k5-verify-<runId>/pg`, aplica as migrações por `scripts/setup.ts`, inicia `next dev` em porta livre com `K5_NEXT_DIST_DIR=.next-verify` e provisiona uma conta pelo endpoint real do Better Auth. Nenhum banco existente precisa ser preparado. As credenciais retornadas em `instance.account` pertencem exclusivamente a essa instância. Reutilize essa conta durante a execução.

A instância está pronta quando `up` termina com `ok: true` e `instance.status: ready`. Anote `runId`, `baseURL`, `evidenceDir`, `log` e os PIDs retornados. O primeiro carregamento compila `/sign-in` e pode levar alguns minutos. Em caso de falha, preserve o log e execute a limpeza antes de tentar novamente.

Os nomes definidos nos arquivos `.env*` de desenvolvimento são neutralizados no processo Next, e o utilitário fornece segredos temporários. Integrações adicionais herdadas do shell também devem estar vazias. Não há configuração de IA, Google, Exa ou pagamentos nessa conta, nem workers ativos. Esse ambiente cobre CRUD e sessão; não comprova streaming de IA, indexação, notificações externas ou serviços de terceiros. Os diretórios de originais do Cofre não são isolados pelo utilitário: não faça upload nesta instância.

O comando geral do projeto continua sendo `pnpm dev`, que executa setup antes do Next. Para esta verificação, use `up`, pois ele fornece banco, porta e build separados. Não execute `pnpm build` enquanto houver `next dev` escrevendo arquivos gerados. A parada da instância está em **Cleanup**.

## Doctor

```powershell
Invoke-K5Verify doctor
```

Exija `ok: true` e `healthy: true`. O diagnóstico consulta processos, página de login e banco sem modificar registros. Ele confere o supervisor, o Next, portas diferentes de 3000/55432, o texto `Entre no Tises` e o vínculo da conta com o escritório.

Compare o `baseURL` com o retorno de `up`. Para confirmar a posse da porta no Windows, consulte `Get-NetTCPConnection -LocalPort ([uri]$baseURL).Port -State Listen` e `Get-CimInstance Win32_Process`: o dono deve ser o Next iniciado nesta execução ou seu descendente. Use o `baseURL` anotado como valor de `$baseURL`. O diagnóstico não comprova posse da porta, versão do checkout ou validade de um cookie do navegador; o login real do driver comprova a sessão. Registre `git rev-parse HEAD` e `git status --short` como proveniência. Se os arquivos mudarem durante o teste, registre a interferência e repita a prova afetada.

Se algo parecer errado, rode `doctor` antes de continuar. Uma resposta HTTP isolada não basta para identificar a aplicação.

## Drive

Leia o [índice](features/README.md) e a receita correspondente. Para executar o fluxo disponível de tarefas:

```powershell
Invoke-K5Verify drive office-tasks
```

Ele entra pela tela `/sign-in`, abre `/app/agenda?view=tasks`, cria uma tarefa, consulta a persistência, recarrega, conclui a tarefa, confere Arquivadas e verifica a largura de 390px. Exija `passed: true` e `pageErrors: []`. Esse driver cobre o acesso direto à lista; não cobre automaticamente os demais caminhos do mapa, teclado, reabertura ou todos os estados de erro. A etapa móvel do driver espera apenas a visibilidade do botão e pode capturar `Carregando…`: complete a receita móvel abaixo antes de afirmar que verificou a tela pronta.

Para implementar outra receita, use o [driver de tarefas](../../../.claude/skills/verify-k5/scripts/drive-office-tasks.mts) como base e importe `openApp` e `expect` de [session.mts](../../../.claude/skills/verify-k5/scripts/session.mts). O comando `features` do utilitário lista o mapa antigo em `.claude`; `drive` exige um ID e um script registrados nessa pasta. As demais receitas desta skill são manuais até receberem um driver. Não declare que `drive authentication`, `drive office-clients` ou `drive vault-cases` funciona enquanto o script correspondente não existir.

`openApp(feature)` retorna `page`, `context`, `state`, `shot`, `sql`, `log`, `errors` e `close`. Ele faz login pela UI e configura `baseURL`, locale pt-BR e fuso America/Sao_Paulo. Use seletores como `page.getByRole('button', { name: 'Nova atividade', exact: true })` e `dialog.getByLabel('Título', { exact: true })`. Aguarde o resultado observável; evite esperas fixas. Chame `close()` em `finally` depois de obter a sessão. Se o próprio login falhar dentro de `openApp`, investigue também eventual navegador restante, pois esse helper ainda não fecha falhas anteriores ao retorno.

`sql(query, params)` executa uma transação de leitura. Use parâmetros e confira a associação ao escritório. Crie e altere dados pela interface. `Invoke-K5Verify sql 'SELECT count(*) FROM agenda_activity'` é uma consulta auxiliar, não uma prova do fluxo de criação.

## Evidence

Guarde a prova em `apps/web/playwright-report/verify/<runId>/`, fora do Git. O driver grava na subpasta `office-tasks`:

- `01-abertas-antes.png`, `02-dialogo-preenchido.png`, `03-tarefa-criada.png`, `04-arquivadas.png` e `05-abertas-mobile.png`;
- `trace.zip`, com ações e estados DOM;
- `checks.txt`, com resultados da interface e da consulta SQL;
- `errors.json`, com erros de página e console.

Capture a ação e o resultado, confira as imagens e preserve a trace. Não basta uma captura da tela final. Para mutações, prove persistência com uma consulta de leitura ou uma segunda visualização autenticada e recarregue a página. Não use setters internos, endpoints de teste ou respostas de negócio interceptadas como prova de integração. Mocks só cabem em fronteiras de sistemas externos já isoladas pela aplicação, com escopo declarado.

Antes da limpeza, copie `instance.log` para `evidenceDir` e salve o retorno de `doctor`, `drive`, a revisão Git e a lista de caminhos realmente exercitados. Evite copiar segredos ou dados pessoais para relatórios. A trace contém a sessão temporária; mantenha-a local. O driver não grava vídeo nem snapshot ARIA separado. Para esses formatos, configure o contexto Playwright e salve-os explicitamente.

Uma nova chamada de `drive office-tasks` na mesma instância sobrescreve arquivos. Preserve cada tentativa em uma pasta distinta ou use uma nova instância antes de repetir. O modo `up --dry-run` apenas calcula portas e caminhos; não inicializa serviços ou cadastra conta. Ao usá-lo como prova de ausência de efeitos, confirme que o registro, as pastas e os processos não foram criados.

## Cleanup

Feche o navegador do driver mesmo se uma asserção falhar. Antes de qualquer remoção, confirme os destinos absolutos retornados abaixo: a pasta temporária deve ser filha de `%TEMP%` com prefixo `k5-verify-`, e os tipos gerados devem estar em `apps/web/.next-verify/dev/types` deste checkout.

```powershell
Invoke-K5Verify down --dry-run
Invoke-K5Verify down
Invoke-K5Verify status
```

Compare o `runId` com aquele que você iniciou. `down` encerra os PIDs registrados, usa `pg_ctl` para o banco, remove o banco e segredos temporários, o registro e os tipos gerados. Nunca encerre processos por nome. Em `STOP_INCOMPLETE`, confira a identidade dos PIDs restantes antes de agir. O cache restante de `.next-verify` pode ficar para a próxima execução.

Exija `instance: null` em `status`, ausência dos listeners nas duas portas registradas e `Test-Path` verdadeiro para a trace, capturas e log copiado em `evidenceDir`. As evidências sobrevivem à limpeza. Execute `down` também depois de uma tentativa malsucedida de inicialização ou de teste.

Para mudanças no código da aplicação, rode `pnpm lint`, `pnpm typecheck` e `pnpm test` na raiz; faça build quando a alteração exigir, conforme `AGENTS.md`. Rode `typecheck` após a limpeza dos tipos temporários. Para alterações apenas nesta documentação, confira links, seletores e o fluxo real, sem exigir toda a suíte da aplicação.

## Helpers

| Utilitário existente | Invocação na raiz | Resultado |
| --- | --- | --- |
| `.claude/skills/verify-k5/scripts/k5-verify.mts` | `pnpm --dir apps/web exec tsx ../../.claude/skills/verify-k5/scripts/k5-verify.mts help` | Ajuda de `up`, `doctor`, `features`, `drive`, `sql`, `status`, `down` |
| `.claude/skills/verify-k5/scripts/drive-office-tasks.mts` | `Invoke-K5Verify drive office-tasks` | Prova de tarefas em desktop e largura móvel |
| `.claude/skills/verify-k5/scripts/session.mts` | Importado pelo driver acima | Sessão Playwright, SQL de leitura e captura de evidências |

Os arquivos `.mts` são executados com `tsx` e resolvem as dependências instaladas de `apps/web`. Esta skill não duplica nem modifica esses utilitários. Inclua a pasta `.claude/skills/verify-k5` ao compartilhar a skill, pois ela é uma dependência local obrigatória.

Use `/maintain-verification-skill` quando precisar atualizar o mapa após mudanças de rotas, textos ou comportamentos. Indique esta pasta como o alvo e confira também os utilitários compartilhados.
