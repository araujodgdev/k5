# legal-acceptance

Test: `apps/web/e2e/legal-acceptance.e2e.ts`
Test: `apps/web/e2e/app-shell.e2e.ts`

The Termos de uso and Política de privacidade are accepted with their version (`legal_acceptance`, `src/lib/legal-version.ts`), and the Lume explains once that what is sent reaches the AI providers without anonymization.

- Entry points: the sign-up checkbox (`/sign-up`, "Li e aceito os Termos de uso…"), the portal invitation checkbox (`/client/invite/<token>`), the "Antes de continuar" / "Atualizamos os termos" screen that stands in front of `/app` and `/client` for anyone without the current version, and "Antes de usar o Lume" on the first visit to `/app/agents`.
- `ApiSession.signIn()` in `e2e/support/accounts.ts` accepts both for test accounts; `signIn(account, { acceptLegal: false })` keeps an account that has not.
- Check the rows with `sql`: `SELECT document, version FROM legal_acceptance a JOIN "user" u ON u.id=a.user_id WHERE u.email=$1`.
- The portal invitation checkbox is driven by `apps/web/e2e/client-portal.e2e.ts`, which also publishes a PDF; the instance has no PDF processor, so run it in CI. `tests/auth.test.ts` covers recording the version at sign-up.
