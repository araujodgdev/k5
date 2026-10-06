# Task board

Escritório → Tarefas has a Kanban layout: tasks appear as cards in four status columns (A fazer, Em andamento, Concluídas, Canceladas). A card moves only by dragging its grip, `button "Arrastar <título>"`, to another column with the mouse or the keyboard; the card has no status select or menu. The card changes column at once, saves on its own while it reads "Salvando…", and goes back with an alert when the save fails. The title opens the task's page, "Delegar ao Lume" opens a chat about the task, and the board shows "Nenhuma tarefa." when empty and an alert with "Tentar novamente" when loading fails. The layout is kept in the URL (`?layout=kanban`).

## Sub-features

- `board-layout`: "Kanban" button switches the layout; reload keeps it.
- `board-cards`: all tasks render (the mocked test uses 53, across pages of the list API).
- `board-drag-pointer`: pressing the grip with the mouse, moving past a few pixels and releasing over another column moves the card there; the column under the pointer gets a 2px brand rule. Releasing outside the board, over the card's own column, or pressing Escape changes nothing and sends no request.
- `board-drag-keyboard`: with the grip focused, Space or Enter picks the card up, ArrowLeft and ArrowRight choose the adjacent column (the board scrolls to it on a phone), Space or Enter drops it and Escape cancels. Focus is back on the grip after the drop.
- `board-optimistic`: while the save is pending the card already sits in the new column with "Salvando…" and its grip is `aria-disabled`; other cards stay movable, and the board is not reloaded.
- `board-versions`: each move sends the card's current version; a second move of the same card uses the version the first one returned.
- `board-rollback`: a failed save returns only that card and shows an alert, "Não foi possível mover “<título>” para <coluna>. …", with "Fechar"; the board and every other card stay. The next attempt uses the refreshed version.
- `board-open`: the card title is a link to `/app/agenda/tasks/<id>?from=kanban` (the page itself is in [task-details](./task-details.md)).
- `board-delegate`: "Delegar ao Lume" navigates to `/app/agents?conversationId=…`.
- `board-states`: empty ("Nenhuma tarefa." in each of the 4 columns), error alert, recovery.
- `board-persist`: every drag is stored on the signed-in office's task and survives a reload (real path only).
- `board-mobile`: at 390px the grip is 44×44 with `touch-action: none`, the keyboard drag crosses columns, and the page has no horizontal scroll.

## How to get to it (user POV)

- Sidebar "Escritório" (`/app/agenda`) → tab Tarefas → button "Kanban"; or open `/app/agenda?layout=kanban`.
- To move a card: press and drag `button "Arrastar <título>"`, or focus it and use Space, the arrow keys and Space.

## Driving it with e2e

Test: `apps/web/e2e/task-board.e2e.ts`
Test: `apps/web/e2e/task-board-persistence.e2e.ts`

Preconditions:

- `doctor` all OK; `{ session: 'admin' }`.

- **Mocked board** (`task-board.e2e.ts`, UI only). Open `/app/agenda`, focus `button "Kanban"`, press Enter; `label "Quadro de tarefas"` has 53 `article`s and no `combobox`; the title link of "Revisar contrato 1" points to `/app/agenda/tasks/board-0?from=kanban`. Focus `button "Arrastar Revisar contrato 1"`, Space, ArrowRight, Space; `region "Em andamento"` contains it, the grip is focused, one update went out with version 1 and the list API was not called again. The board and its 53 cards survive `browser.reload()`.
- **Pointer and cancel** (same file). With `browser.mouse`, drag a grip to another column; drop outside the board, on its own column, and press Escape mid-drag, each sending nothing.
- **Optimistic, rollback, versions** (same file). A held update shows the card in its new column with "Salvando…" while a second card moves on its own. A 409 on a stale version returns only that card, shows the alert, and the retry sends the refreshed version. Three moves in a row send versions 1, 2 and 3.
- **Mobile** (same file). At 390×844 the keyboard carries a card across A fazer, Em andamento and Canceladas; there is no horizontal scroll.
- **Delegate.** At 390×844, tap the first "Delegar ao Lume"; URL becomes `/app/agents?conversationId=board-session`.
- **Empty and error.** Open `?layout=kanban` with an empty list (4 × "Nenhuma tarefa."), tap "Atualizar" with a 503 (alert), then "Tentar novamente".
- **Real path** (`task-board-persistence.e2e.ts`, no mocks). Create a task through "Nova atividade" titled `Tarefa do quadro <sufixo>`. Drag it with the mouse to Em andamento, then to Concluídas, reading its row after each drop (`status` and `version` 2 then 3, in the signed-in office), reload, then return it to A fazer by keyboard (version 4) and reload again. At 390px move it to Em andamento by keyboard (version 5), check there is no horizontal scroll and reload once more.
- **Proof.** `drive task-board --video` returns both files' tests with their traces, screenshots and one WebM per test.

## Gotchas

- After Space or Enter picks up a card, wait for the grip's `aria-pressed="true"` and the live region's initial column announcement before sending an arrow. The keyboard sensor attaches its listener asynchronously; an immediate arrow can scroll the page instead, especially in the production build used by CI.
- The delegated-chat destination can take longer than 10 seconds to compile on the first visit in `next dev`; its URL assertion allows 60 seconds.
- `task-board.e2e.ts` mocks every agenda API (`browser.route` on `/api/agenda/*` and `/api/vault/cases`), so it proves the board's behavior, not persistence. Report drag, optimistic saves, rollback and versions from it as UI-only, and persistence only from `task-board-persistence.e2e.ts`.
- Pointer drags are real `browser.mouse` events aimed at the grip's and the column's on-screen boxes. Touch gestures are not simulated. At 390px only the keyboard path is driven, because a pointer reaches the next column only through the board's edge scrolling, whose speed is not deterministic.
- A drag changes the status only. The order inside a column follows the due date, not where the card is dropped.
- Dropping onto Concluídas or Canceladas hides "Delegar ao Lume" on the card; dropping back onto A fazer reopens the task, with no confirmation.
- With a Situação filter, a moved card stays on the board until the next load.
- Cards are `article`s inside `label "Quadro de tarefas"`; each column is a `region` named after it. The grip's accessible name is exact, so `Arrastar Revisar contrato 1` does not match `Arrastar Revisar contrato 10`.
