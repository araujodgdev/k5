---
name: verify-k5
description: Launch an isolated K5 (Lume) web app, drive it in a real browser as the office user, and capture proof with the e2e suite (traces, screenshots, read-only DB checks). Use to confirm a change to apps/web works end to end, such as a screen, form, route or office-scoped data, without touching the developer's `pnpm dev` or database.
---

# Verify K5

K5's user surface is the Next.js web app in `apps/web` (pt-BR, routes under `/app`). This skill runs a **separate** instance: a throwaway embedded PostgreSQL, fresh secrets, and `next dev` on a free port with build directory `.next-verify`. The developer's server on port 3000, their database on `127.0.0.1:55432` and `.next` are never touched. Workers (`pnpm worker`, judicial, notifications) are not started, so do not use this instance to verify document processing, court collection or push delivery.

Everything goes through one CLI, run from the repository root:

```sh
K="pnpm --silent --dir apps/web exec tsx ../../.claude/skills/verify-k5/scripts/k5-verify.mts"
$K help                 # commands, in the order you use them
$K <command> --help     # options, output shape and examples
```

Every command prints one JSON object on stdout: `{ "ok": true, ... }` or `{ "ok": false, "error": { "code", "message", "fix", "details"? } }`, with exit code 1 on failure. Follow `error.fix`. Progress lines go to stderr.

## Launch

`$K up` creates `%TEMP%/k5-verify-<runId>/`, starts PostgreSQL on a free port, runs `apps/web/scripts/setup.ts` (all migrations) with its own env file, starts `next dev --hostname 127.0.0.1 --port <free>`, waits until `/sign-in` answers 200, and registers the verification account through the real `POST /api/auth/sign-up/email`. That endpoint provisions the office through Better Auth's hook. The command returns `instance` (`baseURL`, `account`, `evidenceDir`, `log`) once ready. The first compile takes about 1 minute, and the command gives up after about 5 minutes. `$K up --dry-run` prints the run id, directories and ports without starting anything.

- Account: `verify@k5.test` / `VerificaK5!2026#segura`, administrator of office `Escritório de Verificação`.
- Every variable in `apps/web/.env*` (Exa, Google, AbacatePay…) is blanked for the instance, so external integrations are **off**. The office has no AI connection, so Lume chat and Pesquisa cannot be verified here.
- Only one instance runs at a time. `up` returns `INSTANCE_ALREADY_RUNNING` while one is alive, and it cleans up a dead one's leftovers before starting.
- A detached supervisor owns PostgreSQL and `next dev`. Its log is `instance.log`, at the `log` path printed by `up`. `$K status` shows the registered instance without contacting it.

## Doctor

`$K doctor` is read-only. Run it before driving and whenever something looks off. It checks: status `ready`, supervisor and `next dev` alive, ports different from 3000/55432, `/sign-in` serving "Entre no Lume", and the verification account with its office in the database. `ok: false` (code `UNHEALTHY`) means do not drive. Each failed check carries its own `fix`.

## Drive

`$K features` lists the map (`features/*.md`): each feature's `id`, recipe path, and the e2e tests its `Test:` lines name. Read the recipe before driving it. When a feature has several entry points, a proof that drives only one is incomplete.

`$K drive <id>` runs those tests from `apps/web/e2e/` with the e2e runner, against the ready instance instead of a server of its own (`K5_E2E_URL`), with the instance's database (`DATABASE_URL`) and account (`E2E_EMAIL`, `E2E_PASSWORD`). It returns `passed` and one entry per test with its `status`, `error` and artifact paths. On failure it returns `DRIVE_FAILED`, the runner's last lines in `error.details.failure`, and the summary to read in `fix`. Tests under `e2e/agent/` drive the UI with a model and need `OPENAI_API_KEY` in your environment (the runner's, not the instance's).

These are the same tests CI runs on every pull request. To cover a feature without tests (`NO_TESTS`), load the `e2e` skill, write `apps/web/e2e/<name>.e2e.ts` and add a `Test:` line for it to the recipe. Follow the existing files:

- `{ session: 'admin' }` restores the signed-in account from `e2e/auth.setup.e2e.ts`, which signs in once through the real `/sign-in` form. A test that changes credentials signs up its own account with `uniqueAccount()` and `ApiSession` from `e2e/support/accounts.ts`.
- `test` from `e2e/support/fixtures.ts` adds `sql(query, params)`, a query inside a `READ ONLY` transaction.
- Use roles and accessible names from the pt-BR UI (`screen.getByRole('button', 'Nova atividade')`, `screen.getByLabel('Título')`), not CSS classes or coordinates. Names match exactly by default.
- Assertions wait 10 s against the instance; a route's first compile in `next dev` can take longer, so a cold first drive may need a rerun.

`$K sql "<query>" --params '<json array>'` runs one read-only query, for checks outside a test. Writes are rejected on purpose: create state through the UI.

## Evidence

Each drive writes to `apps/web/.e2e/verify/<runId>/<feature>/` (git-ignored, kept by `down`): `report.json`, `summary.md` with a page per failed test under `failures/`, and `artifacts/` with a Playwright trace per test (open it with `pnpm --dir apps/web exec playwright show-trace <path>`), failure screenshots and any `app.screenshot()` images.

Proof standards:

- Exercise the real user path: UI controls and the same API calls the UI makes. Do not use `browser.route` mocks, internal setters or direct DB writes to create the state you are proving. Mocks are acceptable only for external systems that production already isolates behind a boundary.
- Capture the action and the resulting state: the trace shows both; add `app.screenshot()` where a reviewer needs the before and after.
- Verify side effects, not only the screen: read the row back with `sql`, scoped to the verification office, then reload the page to prove persistence.
- Cover the mobile width (390px) for UI changes, as `apps/web/DESIGN.md` requires. Check for no horizontal scroll and that the primary action is reachable.
- e2e does not collect console errors. When a page error matters, open the trace's console tab and explain each entry.
- Report which entry points you drove and which you could not, with the reason, such as a worker or external key the instance lacks.

## Cleanup

`$K down` asks the supervisor to stop `next dev` (process tree) and PostgreSQL (`pg_ctl stop -m fast`). It kills only the PIDs recorded in the run's state, never processes by name. It then deletes `%TEMP%/k5-verify-<runId>/` (database, secrets, log) and `apps/web/.next-verify/dev/types`, and unregisters the run. `tsconfig.json` includes those generated types, and `next dev` can leave them half-written, which breaks `pnpm typecheck`. Run `pnpm typecheck` after `down`, not while an instance is up. It returns `evidenceKept`, the directory that survives. `$K down --dry-run` lists what would be stopped, deleted and kept. Run `down` after every session, including failed attempts. If it returns `STOP_INCOMPLETE`, stop the listed PIDs as its `fix` says.

## Helpers

| File | Role |
| --- | --- |
| `scripts/k5-verify.mts` | The CLI above: `up`, `doctor`, `features`, `drive`, `sql`, `status`, `down`. |
| `apps/web/e2e.config.ts` | The e2e config `drive` uses; `K5_E2E_URL` points it at the instance. |
| `apps/web/e2e/support/` | Accounts and HTTP sessions, the `sql` fixture, form sign-in, and seeding for AI-made records. |

The CLI keeps the `.mts` extension, because the skill folder has no `package.json` and `.ts` would load as CommonJS without top-level await. It resolves `pg`, `embedded-postgres` and the `e2e` runner from `apps/web`.
