# Office data

Perfil → Seus dados lets any signed-in member download the whole office as a ZIP ("Exportar dados") and schedule the deletion of the office and account with the current password ("Excluir conta"). The section heading is "Excluir conta e escritório". A scheduled deletion shows its date, survives a reload, and can be cancelled.

## Sub-features

- `data-export`: link "Exportar dados" downloads a ZIP (`GET /api/office/export`, `content-type: application/zip`).
- `data-delete-validation`: "Agendar exclusão" without a password shows "Informe sua senha atual."; a wrong one shows "Senha atual incorreta."
- `data-delete-schedule`: with the right password, "Exclusão agendada para <data>" appears and `office_deletion_request.status` is `scheduled`.
- `data-delete-cancel`: "Cancelar exclusão" brings back "Excluir conta" and sets the status to `cancelled`.
- `data-purge`: the actual purge (not driven: an operator step, `pnpm --filter @k5/web office:purge`, covered by `tests/office-deletion.test.ts`).

## How to get to it (user POV)

- "Perfil" in the shell (`/app/profile`), section "Seus dados" with the heading "Exportar dados" and the "Excluir conta" button.
- On mobile: the same route at 390px, which is where the test drives it.

## Driving it with e2e

Test: `apps/web/e2e/office-data.e2e.ts`

Preconditions:

- `doctor` all OK. The test uses its own account (`uniqueAccount('Dados')`) because it schedules a deletion; never drive deletion with the verification account.

- **Open.** At 390×844, `app.open('/app/profile')`; `heading "Exportar dados"` and `link "Exportar dados"` are visible, no horizontal scroll.
- **Export.** The test fetches `/api/office/export` with the account's session (the same request the link makes) and checks a 200, `application/zip` and the `PK\x03\x04` signature.
- **Validate.** Tap "Excluir conta" → "Agendar exclusão" with no password, then with `senha-errada` in `label "Senha atual"` (`.last()`); each error text appears.
- **Schedule.** Fill the right password, tap "Agendar exclusão"; text `/Exclusão agendada para/` is visible and `sql` returns `status = 'scheduled'`.
- **Persist and cancel.** Reopen `/app/profile`; the scheduled text is still there. Tap "Cancelar exclusão"; "Excluir conta" returns and `sql` returns `cancelled`.
- **Proof.** `drive office-data` returns the test passed with its trace.

## Gotchas

- There are two `label "Senha atual"` fields on the profile page (credentials and deletion); the deletion one is `.last()`.
- Check the row with `sql`: `SELECT r.status FROM office_deletion_request r JOIN office_member m ON m.office_id=r.office_id JOIN "user" u ON u.id=m.user_id WHERE u.email=$1`.
