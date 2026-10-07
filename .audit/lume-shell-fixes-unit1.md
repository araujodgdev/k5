# Unit 1 fix report

The confirmed canvas revocation bug is fixed. The existing diff remains in place on `feat/lume-agent-canvas`. This round made no commits, deployment, migration, development-secret changes, or changes to the services on ports 3000 and 55432. The existing verification instance remains running at `http://localhost:62541`, PostgreSQL port 62542, run `20261006T234247-d88728`.

## Behavior and data shape

`WorkspaceState.revokedHref` distinguishes a confirmed 403 or 404 from normal loader cleanup. A denied active resource loses its tab, authorized scope, selected excerpt and mounted canvas content. A confirmed case denial also removes that case's folder and file tabs. A denied background resource cannot clear another destination's content or sources. Network and 5xx failures retain the authorized state and drafts.

`ResourceResolution` is a union of `authorized`, `revoked` and `stale`. Monotonic resolution versions cover resource identity, URL variants and fresh case authorization. Older denials cannot revoke a newer authorized destination. Older successes cannot restore revoked tabs. Explicit resource opening now also checks the navigation version before and after saving.

Private document drafts have an invalidation generation. Known lost access clears cached text, and a pending save cannot restore it after resolving or failing. Ordinary route cleanup does not invalidate drafts. Private conversation drafts and private artifact ownership remain unchanged. Stored message scope retains its existing version-1 server contract.

## Confirmed causes

The original resolver converted every non-OK response into a generic exception. It never invalidated the already-authorized resource. A real second user lost case participation through `/api/collaboration`, received a real 404 from `/api/canvas/resource`, and still saw the old tab. The failing repro reported `expected: count 0` and `observed: count 1`. The final repro passes, hides the case content, disables sending, preserves the private input, rejects a forged case request through real `/api/chat`, verifies that no message was stored, and navigates to Cofre successfully.

The original menu trace confirms a click on SSR chrome before its client implementation was available. `call@509` performed the click at 43102.994 ms. Client instrumentation initialized at 44209.629 ms. The chunk containing `WorkspaceMenu`, `apps_web_src_0be_b3_._.js`, finished loading at 45434.709 ms. Workspace effects first requested notification data at 47151.223 ms. The test asserted only the URL and visible SSR panel before clicking. The menu implementation was not changed. The test now waits for the client-registered Início tab and checks expansion, Escape focus return, Enter opening and mobile navigation.

A second setup defect appeared during verification. `dismissTour` started its optional wait on `/app`, lost its execution context during the redirect, swallowed that failure and saved a session before the welcome dialog appeared. Its trace records `Execution context was destroyed, most likely because of a navigation`. The helper now waits for `/app/command-center` and an attached registered canvas tab before dismissing the tutorial. No sleeps were added.

The cache tests also matched the Next route announcer with their unqualified `alert` locator. They now identify the conversation error by its text. Their internal conversation mocks and the delayed `/api/chat` mock are explicitly tagged `frontend-contract`. Real empty-conversation streams are no longer mocked.

## Files changed in this round

- `apps/web/src/lib/lume-workspace.ts` implements resource invalidation and response-version guards.
- `apps/web/src/components/lume/lume-workspace.tsx` handles denied responses, clears document caches, suppresses revoked canvas content and guards navigation.
- `apps/web/src/lib/document-drafts.ts` clears revoked drafts and fences pending save results.
- `apps/web/tests/lume-workspace.test.ts` covers revocation, transient failures, cleanup, URL variants and cross-route races.
- `apps/web/tests/document-drafts.test.ts` covers late save success and failure after invalidation.
- `apps/web/e2e/lume-shell.e2e.ts` adds real participant revocation and private artifact denial, removes unnecessary stream mocks and labels frontend contracts.
- `apps/web/e2e/app-shell.e2e.ts` proves menu readiness, keyboard operation and mobile navigation.
- `apps/web/e2e/support/sign-in.ts` waits for the completed redirect and hydrated shell before dismissing onboarding.
- `.agents/skills/verify-lume/features/brand-shell.md` records the readiness and tutorial traps.
- `.claude/skills/verify-lume/features/brand-shell.md` mirrors those notes exactly.
- `.audit/lume-shell-fixes-unit1.md` records this handoff.

## Validation

- `pnpm lint` passed with zero errors and the pre-existing `_bytes` warning in `src/lib/judicial/connectors/transport.ts`.
- `K5_NEXT_DIST_DIR=.next-agent-verify pnpm typecheck --env-mode=loose` passed. Next regenerated that owned directory's route types. Its validators now reference the moved office calc and propostas routes. No generated validators were edited or build directories deleted.
- Final scoped ESLint on the eight implementation and test files passed. Final `pnpm --dir apps/web exec tsc --noEmit` passed.
- `node --import tsx --test tests/lume-workspace.test.ts tests/document-drafts.test.ts tests/document-panel.test.ts` through pnpm passed **24/24**, with zero failures.
- `pnpm --filter @k5/web test tests/chat-route.test.ts` passed **4/4** against a separate temporary PostgreSQL. It covers stored scope, regeneration reauthorization, admission races and private artifact denial.
- Final affected e2e run passed **8/8**, with zero failures or retries. This includes four real feature flows, three frontend contracts and one real sign-in setup.
- `drive brand-shell --video` separately passed **2/2** before the added keyboard checks. The final combined e2e run includes those checks.
- T3 preview recorded the desktop menu and a 390 px mobile menu. Mobile `aria-expanded` was `true`, and document scroll width was 390 px. The recording and captures were saved.
- `git diff --check` passed. The recipe mirrors have identical hashes. The final instance doctor passed.

The first combined post-fix run used the old sign-in helper and failed seven tests. It also had two collection errors because test titles were changed while that run was still active. That attempt is preserved and is not acceptance evidence. The next run passed five tests and exposed two ambiguous alert locators. The final run used stable files and passed all eight selected tests.

## Evidence

All browser runner artifacts are under `apps/web/.e2e/verify/20261006T234247-d88728/`.

- [Final e2e report](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/final/report.json) and [summary](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/final/summary.md) enumerate every trace, video and capture.
- [Failing real revocation repro](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/revocation-before/summary.md) retains its failure screen, trace and video.
- `unit1-fixes/brand-shell-original/` preserves the original report, failure PNG, trace and video before rerunning the feature.
- [Menu trace timings](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/menu-trace-evidence.txt), [desktop capture](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/menu-desktop.png), [390 px capture](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/menu-mobile390.png) and [T3 recording](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/menu-preview.mp4) support the menu diagnosis and UI checks.
- [Scoped unit output](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/scoped-unit-tests.log), [root lint output](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/root-lint.log), [root typegen output](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/root-typecheck.log) and [final doctor](../apps/web/.e2e/verify/20261006T234247-d88728/unit1-fixes/doctor-final.json) are preserved.

## Limits and decisions

No live model completion is claimed. The isolated instance has no configured provider. The delayed-result test proves frontend transport and presentation behavior, while the PostgreSQL tests prove server scope persistence and reauthorization. A real delayed model execution still belongs to the parent's final runtime verification when a provider is configured.

The full root unit suite and production build were not rerun, as requested. The parent retains those final checks and the later shared-page units. Node was 26.6.0. T3 preview intermittently disconnected after the saved recording, so the final navigation proof comes from the passing runner trace. No known failed check remains within this fix unit.

Model the Domain shaped the separate revocation event and typed resolution outcome. Fix Root Causes shaped the trace-based readiness correction without sleeps or app-menu changes. Test Behavior, Not Implementation shaped the real two-person revocation repro and assertions about content, scope, stored history and retained drafts.
