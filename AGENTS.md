# Working in K5

K5 is a pnpm/Turborepo monorepo for a Portuguese-language office application.
The application lives in `apps/web`; `packages/` is reserved for shared libraries.

## Before making changes

- Read `README.md` for workspace setup and commands.
- For work in `apps/web`, read `apps/web/AGENTS.md` and the relevant bundled Next.js guides it references. Preserve its generated instruction block.
- For UI changes, read `apps/web/DESIGN.md`; it defines the visual system, component choices, motion, and mobile behavior. Keep user-facing copy in pt-BR.
- For authentication, database, or deployment changes, read `apps/web/README.md` and `apps/web/.env.example` for the security model and environment requirements.

## Implementation boundaries

- Use pnpm from the repository root; the root `package.json` pins the package manager and Node.js requirement. Internal workspace dependencies use `workspace:*`.
- App Router routes and layouts live in `apps/web/src/app`, reusable components in `src/components`, and authentication, sessions, database access, and navigation in `src/lib` (paths relative to `apps/web`). The `@/*` alias resolves to `src/*`.
- Extend the shared navigation definitions in `apps/web/src/lib/navigation.ts` when adding app sections, keeping desktop and mobile navigation consistent.
- Protected server operations must derive their user and office from the authenticated session. Reuse `requireWorkspace()` in `src/lib/session.ts`; scope business data by `office_id` and check the required role. Client-supplied office IDs are not authorization.
- Keep database and session access on the server. Better Auth owns password hashing and sessions; preserve immediate revocation and global logout behavior.
- Database setup is in `apps/web/scripts/setup.ts`, with PostgreSQL migrations under `apps/web/db/postgres/`. Add a new migration instead of editing an applied one. Preserve existing local data and secrets when changing setup. Keep `.env.local` and `.data/` out of version control.

## Validation

- For code changes, run the relevant checks from the root: `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Scripts are defined in the root and app `package.json` files.
- Authentication tests in `apps/web/tests/auth.test.ts` exercise real Better Auth endpoints against PostgreSQL (`tests/postgres-fixture.ts`). Extend this coverage when changing session behavior, office isolation, or provisioning.
- For changes to screens, routes or user flows in `apps/web`, run the affected e2e tests (`pnpm --filter @k5/web exec e2e run e2e/<name>.e2e.ts`) and add or update one in `apps/web/e2e/`; CI runs the whole suite with `pnpm test:e2e`. See `apps/web/README.md` (Testes end-to-end) and the `e2e` skill.
- Run `pnpm build` for changes affecting routes, configuration, or production compilation. Configure the environment and run `pnpm db:setup` first, as described in the READMEs. `pnpm dev` performs setup automatically.
- For UI changes, verify desktop and mobile behavior, including keyboard access and affected loading, empty, and error states, against `apps/web/DESIGN.md`.
- Documentation-only edits need link/path and content checks; application tests are unnecessary. Report which checks ran and any checks that could not run.

## Cursor Cloud specific instructions

- The Cloud Agent `start` script brings up embedded PostgreSQL (`pnpm --filter @k5/web db:local`, `127.0.0.1:55432`) and then `pnpm dev` at http://localhost:3000. It writes `apps/web/.env.local` from `apps/web/.data/postgres-migration/dev.env` and keeps any secrets already there. `pnpm db:setup` migrates; it does not start the database.
- Use Node 22.22.2 from `/home/ubuntu/.nvm/versions/node/v22.22.2` (full ICU). Symlinks in `/usr/local/cargo/bin` put it ahead of `/exec-daemon/node`. That platform Node is 22.14 with small ICU: `windows-1252` decoding and `node:module.registerHooks` fail, so `pnpm test` fails those cases.
- Turborepo execs `~/.local/share/pnpm/.tools/pnpm/12.4.2/node_modules/pnpm` directly. If that file is still the shebang-less placeholder, run its `install.js` with Node so the native binary replaces it. Otherwise `pnpm dev` and `pnpm test` die with `Exec format error`.
- LibreOffice (`soffice`) is installed for PDF conversion. `pnpm test` starts a separate temporary PostgreSQL and does not use the dev database. One chat-attachment test still fails when `pdfjs-dist` 6.3.289 and `unpdf`'s bundled PDF.js 6.1.200 load in the same process; that clash is in the app, not in this environment.
