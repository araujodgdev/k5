# Legal acceptance

Anyone without the current Termos de uso and Política de privacidade version is stopped by "Antes de continuar" before the office opens, must tick the checkbox, and the acceptance is stored with its version. On the first visit to the Lume chat, "Antes de usar o Lume" explains once that what is sent reaches the AI providers without anonymization, and the user's "Entendi" is stored too.

## Sub-features

- `legal-signup-checkbox`: "Li e aceito os Termos de uso…" on `/sign-up` (driven by `auth.setup`'s sign-up path in `authentication`).
- `legal-gate`: "Antes de continuar" (or "Atualizamos os termos" after a version bump) in front of `/app` and `/client`.
- `legal-gate-validation`: "Aceitar e continuar" without the checkbox shows "Marque a opção para continuar."
- `legal-ai-notice`: "Antes de usar o Lume" on the first `/app/agents` visit, mentioning "sem anonimização", dismissed with "Entendi".
- `legal-stored`: rows `terms` and `ai_notice` in `legal_acceptance` for the user.
- `legal-portal-invite`: the checkbox on `/client/invite/<token>` (not driven here: `client-portal.e2e.ts` publishes a PDF, which needs the PDF processor the instance lacks; run it in CI).

## How to get to it (user POV)

- A new account that skipped the sign-up checkbox, or any account after the terms version changes, opens `/app/command-center` and lands on "Antes de continuar".
- After accepting, the sidebar "Lume" (`/app/agents`) shows the AI notice once.

## Driving it with e2e

Test: `apps/web/e2e/legal-acceptance.e2e.ts`
Test: `apps/web/e2e/app-shell.e2e.ts`

Preconditions:

- `doctor` all OK. The test signs up its own account with `uniqueAccount('Aceite')` and `ApiSession.signIn(account, { acceptLegal: false })`, so the verification account is untouched.

- **Gate.** At 390×844, open `/app/command-center`; `heading "Antes de continuar"` is visible with no horizontal scroll.
- **Validation.** Tap `button "Aceitar e continuar"`; "Marque a opção para continuar." appears.
- **Accept.** Check `checkbox /Li e aceito os Termos de uso/`, tap "Aceitar e continuar"; the heading hides.
- **AI notice.** Dismiss the optional "Agora não" prompt, open `/app/agents`; `heading "Antes de usar o Lume"` and text `/sem anonimização/` are visible; tap "Entendi"; `heading "Lume"` level 1 is attached.
- **Stored.** `sql("SELECT a.document FROM legal_acceptance a JOIN \"user\" u ON u.id=a.user_id WHERE u.email=$1 ORDER BY a.document")` returns `ai_notice`, `terms`.
- **Proof.** `drive legal-acceptance` lists both tests passed; `app-shell` proves an accepted account goes straight to the shell.

## Gotchas

- `ApiSession.signIn()` accepts both documents by default; pass `{ acceptLegal: false }` to reach the gate.
- "Agora não" (a push-notification prompt) may or may not appear; the test waits up to 10 s and taps it only if visible.
- `tests/auth.test.ts` covers recording the version at sign-up; the UI test covers the gate.
