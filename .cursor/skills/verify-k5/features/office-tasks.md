# Tarefas do escritório

Uma pessoa cria uma tarefa, acompanha sua situação, conclui o trabalho e consulta o histórico em Arquivadas. A tarefa permanece no escritório depois de recarregar a página.

## Sub-features

- `tasks-create`: criar pelo formulário Nova atividade.
- `tasks-persist`: confirmar título, tipo e situação após recarregar.
- `tasks-complete`: concluir na lista Abertas e localizar em Arquivadas.
- `tasks-reopen`: reabrir a tarefa e encontrá-la novamente em Abertas.
- `tasks-entry`: abrir o formulário pela lista, pelo Início e pelo detalhe de cliente.
- `tasks-mobile`: alcançar a ação principal na largura de 390px.

## How to get to it (user POV)

- Menu ou barra móvel `Escritório`, depois `Tarefas`, em `/app/agenda?view=tasks`.
- Botão `Nova atividade` da lista ou da visão `Agenda`.
- Link `Nova atividade` no Início, em `/app/command-center`.
- Link `Nova atividade` no detalhe `/app/agenda/clients/<id>`, quando houver cliente.
- Link de uma tarefa pendente no Início abre a atividade; a caixa `Concluir <título>` permite concluí-la ali.

## Driving it with Playwright (session.mts)

Preconditions:

- `doctor` saudável; conta administradora retornada por `up`.
- Nome único para a tarefa. Para o caminho pelo cliente, crie-o antes pela receita [Clientes](office-clients.md).

- Abra `page.goto('/app/agenda?view=tasks')`. Exija `getByRole('region', { name: 'Atividades' })` com `aria-busy="false"` e botão `Abertas` com `aria-current="page"`. Capture antes da ação.
- Clique em `page.getByRole('button', { name: 'Nova atividade', exact: true })`. No diálogo de mesmo nome, preencha `getByLabel('Título', { exact: true })` e confira `getByLabel('Tipo', { exact: true })` com valor `task`. Capture o formulário preenchido e clique em `Salvar` dentro dele.
- Exija o fechamento do diálogo e `page.getByRole('button', { name: title, exact: true })` visível. Confira a linha de `agenda_activity` por título e escritório, com `kind='task'` e `status='pending'`. Recarregue e confira o mesmo título.
- Clique em `page.getByRole('checkbox', { name: 'Concluir ' + title })`. A linha sai de Abertas; a leitura de persistência deve retornar `completed`.
- Clique no botão `Arquivadas`. A caixa `Reabrir <título>` deve estar marcada. Capture o histórico. Para provar reabertura, clique nela e confirme a tarefa em Abertas após recarregar.
- Para o Início, abra `/app/command-center`, clique no link `Nova atividade` e confira o diálogo. Para o detalhe de cliente, clique no link homônimo e confira a associação ao cliente no formulário. Registre esses caminhos separadamente.
- Em 390×844, abra a lista, aguarde `getByRole('region', { name: 'Atividades' })` com `aria-busy="false"`, exija `Nova atividade` habilitado e confira `document.documentElement.scrollWidth <= innerWidth`. Capture a tela pronta e a tarefa em Arquivadas. Para provar teclado, alcance a ação com Tab, abra com Enter e confira o foco dentro do diálogo. Feche com Escape e confira o retorno do foco ao botão.
- `Invoke-K5Verify drive office-tasks` automatiza criação pelo URL direto, persistência, conclusão, Arquivadas e largura móvel. Reabertura, navegação por menus, cliente, Início e teclado ainda exigem execução adicional.

## Gotchas

- A linha desaparece ao concluir; use `click()`, pois `check()` espera a caixa continuar no DOM.
- `Nova atividade` fica desabilitado enquanto as opções carregam. Aguarde sua habilitação.
- O título da página fica visualmente oculto no móvel. Use `toBeAttached()` para o `h1`.
- Concluir uma tarefa não a apaga. Preserve o registro para provar o histórico; `down` remove o banco temporário.
- O driver existente consulta por título único e confere o nome do escritório. Novos drivers devem incluir também o escritório no filtro de leitura.
- A captura móvel do driver pode acontecer durante o carregamento. Inspecione a imagem e complete a espera e a captura da tela pronta descritas acima; `passed: true` sozinho não resolve essa limitação.
- Na [execução de 27/09/2026](../validation.md), Escape fechou o formulário, mas o foco não voltou a `Nova atividade`. Mantenha essa asserção nos próximos testes e registre a falha enquanto ela persistir.
