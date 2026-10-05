# Task board

Escritório → Tarefas has a Kanban layout: tasks appear as cards in status columns, a card moves between columns from its "Mover <título>" combobox by keyboard, "Delegar ao Lume" opens a chat about the task, and the board shows "Nenhuma tarefa." when empty and an alert with "Tentar novamente" when loading fails. The layout is kept in the URL (`?layout=kanban`).

## Sub-features

- `board-layout`: "Kanban" button switches the layout; reload keeps it.
- `board-cards`: all tasks render (the test uses 53, across pages of the list API).
- `board-move`: `combobox "Mover <título>"`, ArrowDown + Enter, moves the card to "Em andamento" with the current version (no stale update).
- `board-delegate`: "Delegar ao Lume" navigates to `/app/agents?conversationId=…`.
- `board-states`: empty ("Nenhuma tarefa." in each of the 4 columns), error alert, recovery.
- `board-mobile`: no horizontal scroll at 390px.

## How to get to it (user POV)

- Sidebar "Escritório" (`/app/agenda`) → tab Tarefas → button "Kanban"; or open `/app/agenda?layout=kanban`.

## Driving it with e2e

Test: `apps/web/e2e/task-board.e2e.ts`

Preconditions:

- `doctor` all OK; `{ session: 'admin' }`.

- **Open.** `app.open('/app/agenda')`, wait for "Carregando…" to hide; focus `button "Kanban"`, press Enter; `label "Quadro de tarefas"` has 53 `article`s.
- **Move.** Focus `combobox "Mover Revisar contrato 1"`, ArrowDown, Enter; `region "Em andamento"` contains it.
- **Reload.** The board and its 53 cards survive `browser.reload()`.
- **Delegate.** At 390×844, tap the first "Delegar ao Lume"; URL becomes `/app/agents?conversationId=board-session`.
- **Empty and error.** Open `?layout=kanban` with an empty list (4 × "Nenhuma tarefa."), tap "Atualizar" with a 503 (alert), then "Tentar novamente".
- **Proof.** `drive task-board` returns the test passed with its trace.

## Gotchas

- This test mocks every agenda API (`browser.route` on `/api/agenda/*` and `/api/vault/cases`), so it proves the board's UI behavior, not persistence. For a stored, office-scoped task use `office-tasks`; report the board's moves as UI-only.
- Cards are `article`s inside `label "Quadro de tarefas"`; the move control is a native select, so drive it by keyboard.
