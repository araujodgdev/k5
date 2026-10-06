---
name: verify-lume
description: Launch an isolated Lume (the K5 web app in apps/web) on its own database and port, drive it in a real browser as the office user with the e2e suite, and capture proof (traces, screenshots, video, read-only DB checks). Use to prove a change to a screen, form, route or office-scoped data works end to end, without touching the developer's `pnpm dev` or database.
---

# Verify Lume

Lume's user surface is the Next.js web app in `apps/web`: pt-BR, public pages at `/`, the signed-in app under `/app`. This skill runs a **separate** instance with a throwaway embedded PostgreSQL, fresh secrets, and `next dev` on a free port with build directory `.next-verify`. The developer's server on port 3000, their database on `127.0.0.1:55432` and `.next` are never touched. Separate workers (`pnpm worker`, judicial, notifications, integrations) are not started. Local Node may process uploaded TXT inline after the response; verify it with `vault-upload`. Court collection, queued recovery and push delivery need their own processors. Do not infer that all ingestion is unavailable or that every format works from the TXT result. Portal and charge PDFs are converted in the Next.js process by LibreOffice (`soffice` on PATH): `drive client-portal` needs Writer installed, not a worker.

Everything goes through one CLI, run from the repository root:

```sh
L="pnpm --silent --dir apps/web exec tsx ../../.agents/skills/verify-lume/scripts/lume-verify.mts"
$L help                 # commands, in the order you use them
$L <command> --help     # options, output shape and examples
```

Every command prints one JSON object on stdout: `{ "ok": true, ... }` or `{ "ok": false, "error": { "code", "message", "fix", "details"? } }`, with exit code 1 on failure. Follow `error.fix`. Progress lines go to stderr.

## Launch

`$L up` creates `<os.tmpdir()>/lume-verify-<runId>/` (`/tmp` on Linux and macOS, `%TEMP%` on Windows) and starts PostgreSQL on a free port. It runs `apps/web/scripts/setup.ts` (all migrations) with its own env file and starts `next dev --hostname 127.0.0.1 --port <free>`. Once `/sign-in` answers 200, it registers the verification account through the real `POST /api/auth/sign-up/email`, which provisions the office through Better Auth's hook. Ready means the command returns `instance` (`baseURL`, `account`, `evidenceDir`, `log`). The first compile takes about a minute, and `up` gives up after about 5. `$L up --dry-run` prints the run id, directories and ports without starting anything.

- Account: `verify@lume.test` / `VerificaLume!2026#segura`, owner of the personal office `Escritório de Verificação`. K5 offices have one user each, so do not build same-office multi-member scenarios.
- Every variable in `apps/web/.env*` (Exa, Google, AbacatePay, Asaas…) is blanked for the instance, so external integrations are **off**. The platform starts without an AI connection. Real chat requires explicit setup through the admin API, as described in [CLIProxyAPI](features/cliproxyapi.md). The default drive never requires a private AI key.
- One instance at a time. `up` returns `INSTANCE_ALREADY_RUNNING` while one is alive, and cleans up a dead one's leftovers before starting.
- Node: the instance runs on whichever `node` your shell resolves. Anything meeting `engines` (≥ 22.13) serves the app and the e2e suite. `pnpm test` needs the CI version (24), so check `node -v` before reading unit-test failures as regressions.
- A detached supervisor owns PostgreSQL and `next dev`. Its log is `instance.log` at the `log` path `up` prints. `$L status` shows the registered instance without contacting it.

The browser and `BETTER_AUTH_URL` use `http://localhost:<port>`. Next.js normalizes loopback request URLs to that hostname, so this keeps the request URL and Origin equal for CSRF checks. The listener and PostgreSQL remain bound to `127.0.0.1`.

## Doctor

`$L doctor` is read-only. Run it before driving and whenever something looks off. It checks status `ready`, supervisor and `next dev` alive, ports other than 3000/55432, `/sign-in` serving "Entre no Lume", and the verification account linked to its office in the database. `ok: false` (code `UNHEALTHY`) means do not drive. Each failed check carries its own `fix`.

## Drive

For a system-wide pass, first read [coverage/README.md](coverage/README.md): the feature graph, stable check IDs, conditional prerequisites, known coverage gaps and a ready validation prompt. Its source review is not a live pass. New manual recipes have no Test lines, so `drive` returns `NO_TESTS`; follow their browser recipe or add e2e coverage in a separately scoped implementation task.

Start from the map: `$L features` lists each feature's `id`, its recipe (`features/<id>.md`) and the e2e tests its `Test:` lines name. Read [features/README.md](features/README.md) and the recipe before driving. When a feature has several entry points, a proof that drives only one is incomplete.

`$L drive <id> [--video]` runs those tests from `apps/web/e2e/` with the e2e runner against the ready instance (`K5_E2E_URL`), using its database (`DATABASE_URL`) and account (`E2E_EMAIL`, `E2E_PASSWORD`). It returns `passed` and one entry per test with `status`, `error` and artifact paths. On failure it returns `DRIVE_FAILED`, the runner's last lines in `error.details.failure`, and the summary to read in `fix`. `--video` also records a WebM per test, for a demo or a reviewer who will not open traces. Tests under `e2e/agent/` drive the UI with a model and need `OPENAI_API_KEY` in your environment (the runner's, not the instance's).

These are the tests CI runs on every pull request. To cover a feature with no tests (`NO_TESTS`), or a new screen, load the `e2e` skill, write `apps/web/e2e/<name>.e2e.ts` and add a `Test:` line for it to the recipe. Follow the existing files:

- `{ session: 'admin' }` restores the signed-in account from `e2e/auth.setup.e2e.ts`, which signs in once through the real `/sign-in` form. A test that changes credentials signs up its own account with `uniqueAccount()` and `ApiSession` from `e2e/support/accounts.ts`.
- `test` from `e2e/support/fixtures.ts` adds `sql(query, params)`, a query inside a `READ ONLY` transaction.
- Use roles and accessible names from the pt-BR UI (`screen.getByRole('button', 'Nova atividade')`, `screen.getByLabel('Título')`), not CSS classes or coordinates. Names match exactly by default.
- Assertions wait 10 s against the instance. A route's first compile in `next dev` can take longer, so a cold first drive may need a rerun before you call it a failure.

`$L sql "<query>" --params '<json array>'` runs one read-only query, for checks outside a test. Writes are rejected on purpose: create state through the UI.

## Evidence

Each drive writes to `apps/web/.e2e/verify/<runId>/<feature>/`, which is git-ignored and survives `down`:

- `report.json` and `summary.md`, with a page per failed test under `failures/`;
- per test, under `artifacts/web/<test>/default/attempt-0/`:
  - `trace/trace.zip`, always (open with `pnpm --dir apps/web exec playwright show-trace <path>`);
  - `screenshots/NNN-<label>.png`, one per `app.screenshot(label)` in the test;
  - `video/video.webm`, with `--video`;
  - `failure/screen.txt` (the accessibility tree at the failing step) and a failure screenshot, when it fails.

`drive`'s `tests[].artifacts` lists every path.

Proof standards:

- Exercise the real user path: UI controls and the same API calls the UI makes. Do not create the state you are proving with `browser.route` mocks, internal setters or direct DB writes. Mocks are acceptable only for external systems that production already isolates behind a boundary.
- Capture the action and the resulting state. The trace shows both; add `app.screenshot()` where a reviewer needs the before and after.
- Verify side effects, not only the screen: read the row back with `sql`, scoped to the verification office, then reload the page to prove persistence.
- Cover the 390px mobile width for UI changes, as `apps/web/DESIGN.md` requires: no horizontal scroll, primary action reachable.
- e2e does not collect console errors. When a page error matters, open the trace's console tab and explain each entry.
- Report which entry points you drove and which you could not, with the reason, such as a worker or external key the instance lacks.

## Cleanup

`$L down` asks the supervisor to stop `next dev` (process tree) and PostgreSQL (`pg_ctl stop -m fast`). It kills only the PIDs recorded in the run's state, never processes by name. It then deletes `<os.tmpdir()>/lume-verify-<runId>/` (database, secrets, log) and `apps/web/.next-verify/dev/types`, and unregisters the run. Those generated types are included by `tsconfig.json`, and `next dev` can leave them half-written, which breaks `pnpm typecheck`; run `pnpm typecheck` after `down`, not while an instance is up. `down` returns `evidenceKept`, the directory that survives. `$L down --dry-run` lists what would be stopped, deleted and kept.

Run `down` after every session, including failed attempts. If it returns `STOP_INCOMPLETE`, stop the listed PIDs as its `fix` says.

## Helpers

| File | Role |
| --- | --- |
| `scripts/lume-verify.mts` | The CLI above: `up`, `doctor`, `features`, `drive`, `sql`, `status`, `down`. |
| `features/` | The feature map: one recipe per user-facing feature, indexed in `features/README.md`. |
| `apps/web/e2e.config.ts` | The e2e config `drive` uses; `K5_E2E_URL` points it at the instance. |
| `apps/web/e2e/support/` | Accounts and HTTP sessions, the `sql` fixture, form sign-in, and seeding for AI-made records. |

The CLI keeps the `.mts` extension because the skill folder has no `package.json`, and `.ts` would load as CommonJS without top-level await. It resolves `pg`, `embedded-postgres` and the `e2e` runner from `apps/web`. This skill is mirrored at `.claude/skills/verify-lume/`; edit `.agents/skills/verify-lume/` and copy it over, keeping the two identical.
