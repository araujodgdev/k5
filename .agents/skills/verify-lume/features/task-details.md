# Task details

Each Kanban card opens a task page with its status, date, notes, responsible person and linked client or case. Editing the task preserves its status. The page links back to the Kanban.

## Sub-features

- Open a card's title and reload its own URL.
- Edit the title and notes without a status or type selector.
- Confirm the saved fields and preserved status in the authenticated office's database.
- Read the page and reach its actions at 390px without horizontal page overflow.
- Show an unavailable task for a missing ID or a meeting.

- `task-details-links`: Editar prazo, responsável, cliente e caso preserva vínculos e situação; erro parcial das opções é informado.
- `task-details-session`: Abrir sessão do Lume navega para a conversa vinculada sem conceder acesso a outra pessoa.

## How to get to it (user POV)

Open Escritório, choose Kanban and select a task title. The page lives at `/app/agenda/tasks/[id]`. Use "Voltar ao Kanban" to return.

## Driving it with e2e

Test: `apps/web/e2e/task-details.e2e.ts`

Preconditions:

- `doctor` all OK and the verification account signed in through the admin session.
- The main test creates a task through "Nova atividade" and sets its initial in-progress status through the same public update API the board uses. It then opens the card, edits fields, checks office-scoped SQL, reloads and checks the mobile page.
- Run `drive task-details --video` for recordings, screenshots and traces.

## Gotchas

- The update API responds with 201 for a successful write, including updates.
- The load-error recovery test simulates a 503 response. Report that case as UI-only. The detail/edit/persistence test uses the real API and database.
- The record title remains visible on mobile. Status is plain text on the page. The editor omits the selector and preserves current status in the payload.

- **Revisão de fonte; sem execução nesta etapa:** Teste presente; execução e cobertura por subitem ainda precisam ser verificadas.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
