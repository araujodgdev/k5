# K5 verification map

This directory is the maintained source for verifying the user-facing behavior of the K5 web app (Lume). Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- An instance started by this run with `k5-verify.mts up`, and `k5-verify.mts doctor` all `OK`.
- The signed-in user is `verify@k5.test`, administrator of `Escritório de Verificação`. The office starts empty: no cases, clients or activities.
- Integrations are off: no AI connection, Exa, Google or AbacatePay keys, and no workers.
- Never drive the developer's server on port 3000 or its database.

## Driving conventions

- Run a feature with `k5-verify.mts drive <id>`. It runs the e2e tests that the recipe's `Test:` lines name (`apps/web/e2e/*.e2e.ts`) against the instance, signed in as its account. Write tests with the `e2e` skill.
- Every drive records a trace per test; e2e adds a screenshot on failure. Call `app.screenshot(label)` in a test for a before/after image.
- Prefer roles and accessible names in pt-BR (`screen.getByRole('button', 'Salvar')`). e2e matches names exactly by default, because many labels share prefixes; pass `{ exact: false }` for a substring.
- Use unique titles per run (`Date.now().toString(36)` suffix), because the database persists for the whole instance.
- Wait for UI state or poll with `expect.poll`, never for a fixed sleep. Reads such as `inputValue()` do not wait: assert the field is visible first.

## Proof and skip reporting

- UI proof: the trace of each test, plus `app.screenshot()` images where the before/after matters.
- Mutation proof: a `sql()` read of the row scoped to the verification office, and a page reload showing the same state.
- Mobile proof: the same screen at 390px wide, with no horizontal scroll.
- Open the trace when a page error matters: e2e does not collect console errors itself.
- The drive's `tests` list names each test title; a passing title is the proof of its entry point.
- Report an unreachable path with the attempted step and the missing precondition. Never report a skipped entry point as verified through another one.

## Feature entry contract

Each file has an H1, one paragraph on the user-visible behavior, then exactly: `Sub-features`, `How to get to it (user POV)`, `Driving it with e2e` (starting with its `Test:` lines, then `Preconditions:`), and `Gotchas`. Keep implementation details out; name user paths, handles, state and observable proof.

## Features

- [Tutorial library](./tutorials.md): videos by module, filters, keyboard access and desktop/mobile playback pages. Test: `e2e/onboarding.e2e.ts`.
- [Office tasks](./office-tasks.md): create, persist, complete and archive tasks in Escritório → Tarefas. Test: `e2e/office-tasks.e2e.ts`.
- [Vault cases](./vault-cases.md): create a case in Cofre and open its page. Test: `e2e/agent/vault-cases.e2e.ts` (agent steps, needs `OPENAI_API_KEY`).
- [Office clients](./office-clients.md): create and edit a client in Escritório → Clientes. Test: `e2e/agent/office-clients.e2e.ts` (agent steps, needs `OPENAI_API_KEY`).
- [Profile](./profile.md): edit the profile, photo and credentials, and see a user's card while inviting. Test: `e2e/profile.e2e.ts`.
- [Authentication](./authentication.md): sign up a new office, sign in, and sign out everywhere. Tests: `e2e/auth.setup.e2e.ts`, `e2e/password-recovery.e2e.ts`.
- [Brand shell](./brand-shell.md): the Lume identity across the signed-in shell, desktop and mobile. Test: `e2e/app-shell.e2e.ts`.
- [Office activity](./office-activity.md): the office's audit trail in Escritório → Atividade, with filters, desktop and mobile. Test: `e2e/office-activity.e2e.ts`.
- [Credits](./credits.md): the office's credit balance, statement and packages on Plano, desktop and mobile. Test: `e2e/credits.e2e.ts`.
- [Conversation artifacts](./conversation-artifacts.md): the Lume chat's Artefatos panel and saving its documents and attachments to the Cofre, desktop and mobile. Test: `e2e/conversation-artifacts.e2e.ts`.
- [Asaas](./asaas.md): connect the office's Asaas account in Integrações and the "Cobrança pelo Asaas" section of an installment's charge, desktop and mobile. Tests: `e2e/asaas.e2e.ts`, `e2e/honorario-charge.e2e.ts`.
