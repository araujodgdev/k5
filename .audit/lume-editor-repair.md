# Editor repair

Pending restore and reload operations preserve later title and body edits and retain the existing conflict choices. Confirmed access removal clears the denied shared resource, its draft and message context, and permits navigation even when a save is pending. Both reproduced defects are fixed.

Implementation on `feat/lume-agent-canvas` follows [the repair contract](lume-editor-repair-brief.md). Both failures were reproduced independently in the implementation agent's own T3 tab before changes. The initial reproduction used real authenticated APIs and the owned PostgreSQL instance. A wrapper delayed delivery of the original restore response without replacing its status or body.

## Changes

The application changes are limited to these files:

- `apps/web/src/lib/document-drafts.ts` adds `DocumentDraftRevision`, guarded replacement and reopening, terminal invalidation that releases save/read waiters, and preservation of conflicts discovered while a save is pending.
- `apps/web/src/components/document/document-drafts-provider.tsx` removes a revoked document's save registration and lets a navigation already awaiting that save continue when its captured draft has been cleared. Ordinary failed private saves still block navigation.
- `apps/web/src/lib/lume-workspace.ts` adds `ResourceAccess` and guarded canonical invalidation. It advances resource resolution identities on revocation even if no tab remains.
- `apps/web/src/components/lume/workspace-context.tsx` exposes `invalidateResource` on the existing `WorkspaceActions`.
- `apps/web/src/components/lume/lume-workspace.tsx` owns scoped draft cleanup for editor denials and existing canvas denials through the same cleanup function.
- `apps/web/src/components/document/document-workspace.tsx` captures revisions before asynchronous replacement actions, classifies document HTTP responses, and passes the same request boundary to history and preview. A cleared draft cannot render cached editor content.
- `apps/web/src/components/document/page-preview.tsx` sends its export request through that boundary.
- `apps/web/tests/document-drafts.test.ts` covers intervening title and body edits, already saved edits, pending reads, queued writes, terminal invalidation, and pending-save conflict retention.
- `apps/web/tests/lume-workspace.test.ts` covers editor-discovered denial, cleared scope and selection, stale successes, background denial, and later authorization.
- `apps/web/e2e/editor-repair.e2e.ts` adds real persistence and owner/participant regressions, controlled request latency, transient-failure guards, and session expiry.

The local helper `.audit/run-editor-repair.mts` validates the owned run ID and ports, supplies its environment without changing secrets, and writes each e2e run to a new evidence directory. Prior evidence directories remain intact.

No source-policy, provenance, chat prompt, source payload, `workspace.ask`, agent execution, server API, migration, task, fee, activity, or visual redesign files were changed by this repair. Existing changes remain in the shared checkout. There were no delegates, commits, pushes, deployments, developer database migrations, or additional app instances.

## Draft and invalidation shape

`DocumentDraftRevision` contains the draft's invalidation generation and monotonic revision. Editing a different title or body advances the revision. Saving does not reset it. Replacing stored text also advances it, so a concurrent older replacement cannot undo the newer one.

Restore captures the revision before its prerequisite save and retains it through the POST response and subsequent GET. Explicit saved-version reload and automatic Lume reload capture it before waiting for a save or fetching. Initial reopening uses the same guard. A newer revision preserves the current title and body and enters the existing conflict state. The existing saved-version and keep-mine choices remain available. Keep-mine waits for the pending save before fetching and rebasing.

Invalidation permanently clears the old `DocumentDraft` object and aborts its internal lifetime signal. Save and read waiters settle when either that signal or the in-flight response finishes. This signal releases waiters without replacing a real network response. An exit already waiting on a save can finish immediately after revocation without waiting for the old network response. The writer remains guarded when it eventually finishes. A later authorized editor receives a fresh object from `DocumentDrafts`. Old loads, replacements, successful writes, failed writes, and not-yet-started queued writers cannot restore the old content. Neither a successful nor a failed pending save can dismiss a conflict discovered by another document operation.

`ResourceAccess` contains the captured canonical `CanvasResource` and its authorization generation. The existing controller owns this generation alongside its read-attempt sequence. Completed authorization and revocation advance it. Starting a read does not. A unit regression showed why these identities must be separate. A pending newer read that subsequently fails with 503 cannot suppress an already confirmed editor denial. Confirmed shared 403/404 invalidates the captured resource only if its authorization still matches. A later different destination retains its own resource and sources. A later authorization of the same resource rejects the older denial. Existing navigation generations and result guards remain in place.

The workspace removes denied tabs, clears their scoped drafts and save registrations, and uses its existing reducer to clear selection and next-message sources. Cached content disappears immediately. Navigation that started before a denied save can proceed after invalidation. A different editor with an ordinary failed save still blocks it. A 401 redirects to sign-in. Network failures and 5xx retain editable drafts and retry. A 409 retains the conflict draft.

The added pending-navigation browser test exposed another part of the revocation race. `openResource` correctly rejected its old navigation generation after revocation, even though that request represented the person's explicit exit. Its guard now permits that exit only when no explicit result-generation argument was supplied, the originating URL is unchanged, that URL became revoked during the destination read or save wait, and the generation advanced exactly once. The guard runs after both waits. Agent results that supply their original navigation number retain the existing guard. A changed destination or a later authorization cannot use this exception.

## Runtime evidence

All live checks use run `20261006T234247-d88728`, app `http://localhost:62541`, PostgreSQL `62542`. Status and doctor confirmed the instance healthy. It remains running under its original supervisor.

Before-fix implementation-agent screenshots are [restore loss](lume-restore-own-before-fix.png) and [revocation trap](lume-revocation-own-before-fix.png). The independent parent observations and evidence remain in [the original failure record](lume-editor-failures-before-fix.json).

The after-fix T3 recording [restore preservation](lume-restore-after-fix.mp4) shows the real delayed restore and retained text and title. The [preserved editor screenshot](lume-restore-preserved-after-fix.png) captures the conflict choices. Choosing keep-mine persisted version 4 with title `Título preservado durante restauração` and content `Texto preservado depois do clique Restaurar.` through the real API.

The [390 px editor screenshot](lume-editor-mobile-after-fix.png) shows the retained document on mobile. The [revocation recording](lume-revocation-after-fix.mp4) shows a real owner removal, save-discovered 404, removed editor and tab, and successful navigation to Início. The [mobile denied-resource screenshot](lume-revocation-mobile-after-fix.png) contains no cached text. The page had zero editor elements afterward and no horizontal document overflow. Console HTTP 409 and 404 entries are expected results of these negative flows.

T3 lost its available desktop automation host during an additional recording of navigation already awaiting a real denied save. The real 404 and explicit Início click occurred, but the subsequent screenshot and recording transfer failed with `PreviewAutomationNoAvailableHostError`. That additional recording is not counted as proof. The earlier saved recordings and screenshots remain available. The pending-navigation regression uses the e2e runner's video and real-response gate for its complete proof.

## Verification

Final verification passed after the last production change. Focused lint, app-wide typecheck and all 38 draft/controller/editor unit cases passed. The final browser run passed all 38 cases in [editor-final-state-1791338459323](../apps/web/.e2e/verify/20261006T234247-d88728/editor-final-state-1791338459323/report.json). It includes 16 repair regressions, all 21 acceptance cases from `case-pages`, `document-saving` and `lume-shell`, and one authentication setup. Production code stayed frozen during this run. Videos, screenshots and traces are retained under that evidence directory.

The repair suite includes shared already-autosaved edits, pending denied-save navigation, an exit released before a held successful response, network retry, and real session expiry. The preceding complete selection also passed all 38 cases in [editor-acceptance-verified-1791337944481](../apps/web/.e2e/verify/20261006T234247-d88728/editor-acceptance-verified-1791337944481/report.json).

The first combined acceptance run recorded 19 passes and three failures in `acceptance-1791336366023`. They were a mobile editor readiness wait, a pending chat-status wait, and a post-retry navigation URL wait. Its reports, videos, and traces are preserved. The mobile failure screenshot still showed `Abrindo documento…`; the navigation failure screenshot showed saved text and unresolved destination context. These observations led to sequential reruns with production edits frozen. No assertion timeout or other subsystem was changed for these waits.

The expanded regression run `final-editor-repair-1791336760498` passed 14 of 15 repair cases and the setup. Its pending-navigation failure showed a cleared editor, removed tab, and unresolved message context, but an unchanged URL. That evidence confirmed the `openResource` generation guard was canceling the explicit exit. The bounded guard change above addresses that mechanism. The final rerun includes the complete repair and acceptance files with one worker.

The sequential `acceptance-final-1791337061822` run passed all 21 acceptance cases and setup but still failed pending denied-save navigation. Revocation could occur before the destination read completed, so a guard only after the save was insufficient. `repair-final-1791337519529` passed all 15 repair cases after the guard covered both waits. That run passed 36 of 37 selected cases. The single failure was the existing late-result case-page acceptance wait. Its trace records the requested route returning 200 after 10.114 seconds. The request was issued and the retained second-page text was visible in the failure snapshot. No assertion timeout or acceptance test was changed.

The final unit race for an already waiting exit timed out before terminal waiter release. It passed afterward. The new real browser case requires reaching Início before releasing the original successful PUT response and verifies the persisted page with a read-only database query.

The pending-save outcome matrix also reproduced a failed older write replacing a newly discovered conflict with generic error state. The final catch path preserves that conflict and its existing choices. Both successful and failed outcome tests now pass.

The focused failure and passing output for that last race was:

```text
✖ a pending failed save cannot dismiss a conflict discovered by another editor operation (1.7095ms)
  + 'error'
  - 'conflict'
✔ a pending failed save cannot dismiss a conflict discovered by another editor operation (0.1307ms)
```

Commands run from the repository root include:

```text
pnpm --dir apps/web exec eslint src/lib/document-drafts.ts src/lib/lume-workspace.ts src/components/document/document-drafts-provider.tsx src/components/document/document-workspace.tsx src/components/document/page-preview.tsx src/components/lume/workspace-context.tsx src/components/lume/lume-workspace.tsx tests/document-drafts.test.ts tests/lume-workspace.test.ts e2e/editor-repair.e2e.ts
pnpm --dir apps/web exec tsc --noEmit
pnpm --dir apps/web exec tsx --test tests/document-drafts.test.ts tests/lume-workspace.test.ts tests/document-panel.test.ts
pnpm --dir apps/web exec tsx ../../.audit/run-editor-repair.mts editor-final-state e2e/editor-repair.e2e.ts e2e/case-pages.e2e.ts e2e/document-saving.e2e.ts e2e/lume-shell.e2e.ts
pnpm --silent --dir apps/web exec tsx ../../.agents/skills/verify-lume/scripts/lume-verify.mts doctor
```

Full root `pnpm test` and `pnpm build` are excluded by the task contract. The owned instance is not stopped for type generation cleanup.

Scoped `git diff --check` passed. A separate whitespace check covered all ten changed application/test files, including untracked files. Report links and paths were checked. Final doctor reported the original supervisor and Next process alive, the expected isolated ports, HTTP 200 at sign-in, and the verification office present. The owned instance remains running.

## Decisions and remaining objections

Model the Domain shaped the two capture types and kept invalidation in the existing controller and draft state machine. Test Behavior, Not Implementation shaped the real API/browser/DB regressions. Prove It Works shaped the independent T3 reproduction, recordings, screenshots, and persistence reads. The corresponding leaf skills were read in this session.

The accepted architecture already defines both invariants. The repair uses that contract without reopening source-policy design or spawning another review round. No code objection remains unresolved within the repair contract. The additional T3 recording failure and the deliberately excluded full root checks are the verification limits described above.
