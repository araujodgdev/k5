# Office tasks

A member of the office creates a task, sees it in the open list grouped by due date, completes it, and finds it under Arquivadas. The task belongs to the member's office and survives a reload.

## Sub-features

- `tasks-create`: the "Nova atividade" dialog saves a task with a title.
- `tasks-persist`: the task is stored for the signed-in office and reappears after reload.
- `tasks-complete`: the "Concluir <título>" checkbox moves the task out of Abertas.
- `tasks-archived`: Arquivadas lists completed tasks with "Reabrir <título>".
- `tasks-mobile`: the list and primary action fit a 390px screen.
- `tasks-home`: completing a due task from Início (not yet driven).

## How to get to it (user POV)

- Sidebar "Escritório" → tab "Tarefas" (URL `/app/agenda?view=tasks`), then the "Nova atividade" button.
- Início (`/app/command-center`) → link "Nova atividade", and the "Concluir …" checkboxes on today's tasks.
- On mobile: the bottom tab "Escritório".

## Driving it with e2e

Test: `apps/web/e2e/office-tasks.e2e.ts`

Preconditions:

- `doctor` all OK. The verification office may already contain tasks from earlier drives in the same instance.

- **Open list.** Go to `/app/agenda?view=tasks`. The button "Abertas" has `aria-current="page"`, and `region "Atividades"` has `aria-busy="false"`.
- **Create.** Click `button "Nova atividade"`. `dialog "Nova atividade"` opens. Fill `label "Título"`, leave `label "Tipo"` = `task`, click `button "Salvar"`. The dialog closes and `button "<título>"` appears under the "Hoje" group.
- **Stored.** Run `sql("SELECT a.status, a.kind, o.name FROM agenda_activity a JOIN office o ON o.id=a.office_id WHERE a.title=$1")`. Expect `pending`, `task`, `Escritório de Verificação`.
- **Reload.** `page.reload()`, and the same title is still listed.
- **Complete.** Click `checkbox "Concluir <título>"`. The row leaves Abertas, and `status` polls to `completed`.
- **Archived.** Click `button "Arquivadas"`. `checkbox "Reabrir <título>"` is checked.
- **Mobile.** At 390×844, `button "Nova atividade"` is visible and `scrollWidth <= innerWidth`.
- **Proof.** `k5-verify.mts drive office-tasks` does all of the above, producing the screenshots `01-abertas-antes`, `02-nova-atividade`, `03-tarefa-criada`, `04-arquivadas` and `05-abertas-mobile` plus `trace.zip` under the test's `attempt-0/` artifacts (add `--video` for a WebM). The `sql` reads are in the trace and the test's assertions, not a separate file.

## Gotchas

- The checkbox is controlled by server state: use `tap()`, not `check()`. `check()` waits for the box to become checked, but the row disappears instead of toggling.
- "Nova atividade" stays disabled until the case/client/member options load. Wait for it to be enabled, which `click()` does.
- The `h1 "Escritório"` is `sr-only` on mobile. Assert it with `toBeAttached()`, not `toBeVisible()`.
- The default due date is today, so a new task lands in "Hoje", which shows no date line.
