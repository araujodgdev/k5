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
- Run `pnpm build` for changes affecting routes, configuration, or production compilation. Configure the environment and run `pnpm db:setup` first, as described in the READMEs. `pnpm dev` performs setup automatically.
- For UI changes, verify desktop and mobile behavior, including keyboard access and affected loading, empty, and error states, against `apps/web/DESIGN.md`.
- Documentation-only edits need link/path and content checks; application tests are unnecessary. Report which checks ran and any checks that could not run.
