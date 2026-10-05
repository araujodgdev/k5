# Office activity

The office owner opens Escritório → Atividade and reads who did what in the office, newest first: case access and invitations, court lookups, Google actions, ads connections and the Lume's searches in the Cofre. Each row is a sentence after the actor's name, with the source and the outcome in words under it. Filters narrow the list to one source, and "Mais antigos →" loads the next page. Rows from other offices never appear.

## Sub-features

- `activity-list`: an invitation the owner created reads "<nome> criou um convite para <convidado>", with "Acessos · Concluído" under it.
- `activity-isolation`: another office's invitation to the same person is absent.
- `activity-filters`: "Google" with no rows shows "Nada registrado com este filtro ainda."; "Acessos" shows the invitation again; "Tudo" works from the keyboard.
- `activity-mobile`: the list and filters fit 390px.
- `activity-pagination`: "Mais antigos →" after 50 rows (not driven; covered by `apps/web/tests/audit.test.ts`).
- `platform-audit`: Administração → Auditoria (`/app/admin/audit`) for platform administrators (not driven; see Gotchas).

## How to get to it (user POV)

- Sidebar "Escritório" → tab "Atividade" (URL `/app/agenda?view=activity`).
- On mobile: the bottom tab "Escritório", then "Atividade" in the tab grid.

## Driving it with e2e

Test: `apps/web/e2e/office-activity.e2e.ts`

Preconditions: none from the instance. The test signs up its own accounts over HTTP (`ApiSession`) and creates the invitations through `POST /api/collaboration`, the same call the Associados screen makes.

## Gotchas

- The instance has no platform administrator, so `/app/admin/audit` answers 404 there. Its query and filters are covered by `apps/web/tests/audit.test.ts`.
- Court lookups, Google actions and Cofre searches need workers or external keys the instance lacks; only invitation rows can be produced from the UI here.
