# Clientes

O escritório cadastra clientes, consulta seus detalhes e edita os dados. A lista permite buscar por nome e filtrar a área jurídica e o relacionamento.

## Sub-features

- `clients-create`: salvar um cliente no escritório.
- `clients-filter`: encontrar o cliente pelos filtros da lista.
- `clients-detail`: abrir a página de contato, casos e atividades.
- `clients-edit`: editar o nome e confirmar persistência.
- `clients-entry`: abrir o cadastro pela lista e pelo Início.

## How to get to it (user POV)

- `Escritório` no menu ou barra móvel, depois `Clientes`, em `/app/agenda?view=clients`.
- Botão `Novo cliente` na lista.
- Link `Cadastrar cliente` no Início, que abre `/app/agenda?view=clients&action=new`.
- Link com o nome do cliente na lista ou no resumo de clientes do Início abre `/app/agenda/clients/<id>`.

## Driving it with Playwright (session.mts)

Preconditions:

- `doctor` saudável; conta com permissão de escrita.
- Nome único para identificar o cliente. O escritório vazio não tem casos para vincular.

- Abra `page.goto('/app/agenda?view=clients')`. Em uma instância vazia, confira `Nenhum cliente encontrado.`. Clique em `page.getByRole('button', { name: 'Novo cliente', exact: true })`.
- No `page.getByRole('dialog', { name: 'Novo cliente' })`, preencha `getByLabel('Nome', { exact: true })` e `getByLabel('E-mail', { exact: true })`. Use um endereço de teste. Selecione `getByLabel('Relacionamento', { exact: true }).selectOption('active')`. Capture e clique em `Salvar` dentro do diálogo.
- Exija o fechamento do diálogo e o link com o nome cadastrado. Consulte `crm_client` pelo nome e escritório; confira `stage='active'`. Recarregue e confira o mesmo cliente.
- Preencha `page.getByRole('textbox', { name: 'Buscar clientes', exact: true })` com o nome. Confira o resultado; use um texto inexistente para provar o estado vazio e limpe a busca para restaurar a lista.
- Clique no link do cliente. Exija URL `/app/agenda/clients/` e `heading` de nível 1 com o nome. Clique em `Editar cliente`, altere `Nome` no diálogo, salve e recarregue. Exija o título novo e confira a mesma linha persistida.
- Abra `/app/command-center` e clique no link `Cadastrar cliente`. Confira o diálogo sem salvar outro registro; feche-o com Escape. Isso prova a segunda entrada sem duplicar o cliente.
- Capture lista, formulário e detalhe editado. Em 390×844, confira o título do registro, a ação de edição e ausência de rolagem horizontal. Registre os caminhos executados.

## Gotchas

- `Potencial cliente` é o relacionamento inicial; selecione `active` para a prova acima.
- Um cliente do CRM e os campos opcionais de cliente de um caso não são a mesma operação. Não presuma criação automática no CRM ao preencher o Cofre.
- Edições concorrentes usam versão e podem gerar conflito. Recarregue antes de repetir e preserve o erro como evidência se ele for o alvo do teste.
- Ainda não existe `drive-office-clients.mts`. Esta é uma receita conferida no código, não um teste executado.
