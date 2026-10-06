# Office clients

A member registers a client in the office CRM, finds it in the Clientes list, opens its detail page, and edits it. Clients link to Cofre cases and to agenda activities.

## Sub-features

- `clients-create`: the "Novo cliente" dialog saves name, e-mail, phone, relationship stage, legal areas and address.
- `clients-list`: the list shows name and stage, and "Buscar clientes", "Filtrar área" and "Filtrar relacionamento" narrow it.
- `clients-detail`: the client link opens `/app/agenda/clients/<id>` with the name as `h1`.
- `clients-edit`: "Editar cliente" → "Salvar" updates the heading, and the change survives reload.
- `clients-agenda`: "Ver agenda de <nome>" switches to the calendar filtered by the client.

- `clients-conflict`: Edição obsoleta é recusada sem sobrescrever dados da versão atual.
- `clients-related`: Ficha abre honorários, portal e atividades vinculadas ao cliente correto.

## How to get to it (user POV)

- Sidebar "Escritório" → tab "Clientes" (`/app/agenda?view=clients`), then the "Novo cliente" button.
- From a Cofre case, Tarefas e Agenda opens the workspace filtered by case. Its client-data form edits vault_case.client_* and does not automatically create/link a CRM client.

## Driving it with e2e

Test: `apps/web/e2e/agent/office-clients.e2e.ts`

Preconditions:

- `doctor` all OK. Use a unique client name per run.

- **Open list.** Go to `/app/agenda?view=clients`. Without clients, the list shows "Nenhum cliente encontrado.".
- **Create.** Click `button "Novo cliente"`. `dialog "Novo cliente"` opens. Fill `label "Nome"` and `label "E-mail"`, select `label "Relacionamento"` = `active`, then click `button "Salvar"`. The dialog closes and `link "<nome>"` is listed.
- **Stored.** Run `sql("SELECT c.name, c.stage, o.name AS office FROM crm_client c JOIN office o ON o.id=c.office_id WHERE c.name=$1")`. Expect one `active` row in `Escritório de Verificação`.
- **Detail.** Click `link "<nome>"`. The URL matches `/app/agenda/clients/`, and `heading "<nome>"` is visible.
- **Edit.** Click `button "Editar cliente"`, change `label "Nome"`, then click `button "Salvar"`. The heading updates, and after `reload()` it still shows the new name.
- **Proof.** Screenshots of the list, the dialog, the detail page before and after the edit, and the detail page at 390px.

## Gotchas

- The office has no cases at start, so the "Casos do Cofre" fieldset in the dialog is empty. Create a case first to prove linking.
- Edits use optimistic versioning. Editing the same client from two tabs returns a conflict error, which is correct behavior and not a failure of the driver.

- **Revisão de fonte; sem execução nesta etapa:** Teste com agente exige OPENAI_API_KEY no runner. A ficha também aparece em workspace.e2e.ts com APIs simuladas.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
