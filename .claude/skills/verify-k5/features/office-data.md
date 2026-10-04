# office-data

Test: `apps/web/e2e/office-data.e2e.ts`

Perfil → Seus dados: "Exportar dados" downloads the office as a ZIP (`GET /api/office/export`, `src/lib/office-export.ts`), and "Excluir conta" schedules the deletion of the office and account with the current password, shows its date and can be cancelled (`/api/office/deletion`, `src/lib/office-deletion.ts`).

- Use an account of its own (`uniqueAccount`): the test schedules a deletion.
- The purge itself is an operator step (`pnpm --filter @k5/web office:purge`, docs/exclusao-de-escritorio.md) and is covered by `tests/office-deletion.test.ts`, not by the UI.
- Check the request with `sql`: `SELECT status, scheduled_for FROM office_deletion_request WHERE office_id = $1`.
