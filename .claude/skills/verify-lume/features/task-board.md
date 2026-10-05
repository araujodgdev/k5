# Task board

Escritório → Tarefas has a Kanban layout: tasks appear as cards in status columns, a card is dragged by its "Mover <título>" button (including touch) or moved from the keyboard (Enter grabs, arrows aim, Enter confirms), "Delegar ao Lume" opens a chat about the task, and the board shows "Nenhuma tarefa." when empty and an alert with "Tentar novamente" when loading fails. The layout is kept in the URL (`?layout=kanban`).

## Sub-features

- `board-layout`: "Kanban" button switches the layout; reload keeps it.
- `board-cards`: all tasks render (the test uses 53, across pages of the list API).
- `board-move`: `button "Mover <título>"`, Enter, ArrowRight, Enter moves the card to "Em andamento"; dragging `button "Mover Revisar contrato 3"` onto `region "Concluídas"` moves that card. Both use the current version (no stale update).
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
- **Move.** Focus `button "Mover Revisar contrato 1"`, Enter, ArrowRight, Enter; `region "Em andamento"` contains it. Before the delegate tap, drag `button "Mover Revisar contrato 3"` onto `region "Concluídas"`; that region contains it. `staleUpdates` stays empty.
- **Reload.** The board and its 53 cards survive `browser.reload()`.
- **Delegate.** At 390×844, tap the first "Delegar ao Lume"; URL becomes `/app/agents?conversationId=board-session`.
- **Empty and error.** Open `?layout=kanban` with an empty list (4 × "Nenhuma tarefa."), tap "Atualizar" with a 503 (alert), then "Tentar novamente".
- **Proof.** `drive task-board` returns the test passed with its trace.

## Gotchas

- This test mocks every agenda API (`browser.route` on `/api/agenda/*` and `/api/vault/cases`), so it proves the board's UI behavior, not persistence. For a stored, office-scoped task use `office-tasks`; report the board's moves as UI-only.
- Cards are `article`s inside `label "Quadro de tarefas"`; the move control is the button "Mover <título>", driven by keyboard or drag.
