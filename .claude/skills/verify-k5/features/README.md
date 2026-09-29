# K5 verification map

This directory is the maintained source for verifying the user-facing behavior of the K5 web app (Lume). Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- An instance started by this run with `k5-verify.mts up`, and `k5-verify.mts doctor` all `OK`.
- The signed-in user is `verify@k5.test`, administrator of `Escritório de Verificação`. The office starts empty: no cases, clients or activities.
- Integrations are off: no AI connection, Exa, Google or AbacatePay keys, and no workers.
- Never drive the developer's server on port 3000 or its database.

## Driving conventions

- Run a feature with `k5-verify.mts drive <id>`. Each driver is `scripts/drive-<id>.mts`, built on `openApp()` from `scripts/session.mts`.
- Take screenshots only through `shot()`. A bare `page.screenshot()` hides the caret by writing `caret-color` into inputs, and before hydration that shows up as a false React hydration mismatch.
- Prefer roles and accessible names in pt-BR (`getByRole('button', { name: 'Salvar', exact: true })`). Use `exact: true`, because many labels share prefixes.
- Use unique titles per run (`Date.now().toString(36)` suffix), because the database persists for the whole instance.
- Wait for UI state or poll with `expect.poll`, never for a fixed sleep.

## Proof and skip reporting

- UI proof: numbered screenshots of before, action and after, plus `trace.zip`.
- Mutation proof: a `sql()` read of the row scoped to the verification office, and a page reload showing the same state.
- Mobile proof: the same screen at 390px wide, with no horizontal scroll.
- `errors.json` is empty or each entry is explained.
- Record the feature ID and entry point in the `log()` line of every `PASS`.
- Report an unreachable path with the attempted step and the missing precondition. Never report a skipped entry point as verified through another one.

## Feature entry contract

Each file has an H1, one paragraph on the user-visible behavior, then exactly: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright (session.mts)` (starting with `Preconditions:`), and `Gotchas`. Keep implementation details out; name user paths, handles, state and observable proof.

## Features

- [Office tasks](./office-tasks.md): create, persist, complete and archive tasks in Escritório → Tarefas. Driver: `drive-office-tasks.mts` (proved).
- [Vault cases](./vault-cases.md): create a case in Cofre and open its page.
- [Office clients](./office-clients.md): create and edit a client in Escritório → Clientes.
- [Profile](./profile.md): edit the profile, photo and credentials, and see a user's card while inviting. Driver: `drive-profile.mts`.
- [Authentication](./authentication.md): sign up a new office, sign in, and sign out everywhere.
