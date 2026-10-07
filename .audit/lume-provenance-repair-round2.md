# Source-policy repair round 2

Status: implemented and frozen checks complete; independent acceptance pending. One writer in the existing checkout. Parent owns independent review and wider delivery. All historical reports and applied migrations remain immutable.

## Shapes and callers before production edits

The failed premise is recorded in the round2 verdict. Policy inside a service does not survive a serialized cache, edited prefill or reconstructed context automatically. The bounded source-boundary census lists actual owners, not exhaustive coverage.

1. A generation attempt gains office ownership and cascading submission lifecycle. Its approval and committed page/version remain independent. Conversation API and capability deletion and office purge use the same database lifecycle.
2. An annex plan is an opaque owned domain record. It retains actor, case, scan ID/version/hash, exact petition policy, generated labels/order and combined policy. Analyze produces the binding; UI review and capability generation carry it. Edited fields retain its baseline. A known managed actor/case/scan baseline cannot be reset by omission or forgery. Independent human range splitting remains available where no managed baseline exists. Agent raw petition/labels cannot assert person origin.
3. A cached citation retains its catalog reference and material version policy. Knowledge search exposures supply exact source policies to sourcesFromTool and recordSources. conversationSources authorizes before chat/artifact TypeSafe admission. Independent public web links retain their classification. Known legacy catalog identities without recoverable policy fail closed.
4. Gmail preparation keeps the admitted subject bytes. Remote reply headers retain threading roles without silently becoming outgoing text. Seed contributors and their actual audience continue to govern managed replies.
5. A capability replay retains serialized exact result plus typed domain exposure identity/policy. Registration determines replay semantics. Cache hits reauthorize historical resources, validate output and record exposure every time. A keyed operation is serialized before its effect, so concurrent retries do not execute duplicate writes. Legacy protected JSON without an exact binding fails closed.
6. Portal mutations and writes acquire the existing gate before FK parents, session and access rows. Invitation/renewal/revoke/accept and file writers adopt one ordering without shared-to-exclusive upgrade.
7. Portal file commit retains original staff/client context and signal. The domain rechecks wall-clock session/access after database waits and before commit. A client does not become an office member through context reconstruction.
8. Private chat discovery records file metadata/original version policy without reading unavailable extracted text. Explicit extracted inputs remain strict. Native pending PDF uses the observed bytes and identity.
9. Gmail review binding retains admitted connection authorization generation. Final dispatch guard compares current generation after remote preparation waits. Existing completed/unknown reconciliation remains unchanged.

## Sequence and throughput checkpoint

Read contracts and census; retain negative parent repros; add behavioral reproductions. Repair lifecycle/replay and annex identity first. Repair citation/Gmail transport and portal ordering/context next. Repair private discovery. Verify each unit with actual services and external-boundary stubs only. Freeze production and tests before the combined PostgreSQL/browser checks and final hashes.

Nine groups across seven owner families. No additional writer, worktree or instance. Domain identity and existing transaction gates are the organizing structures. Model the Domain changes the annex/replay handoffs to retained owned records. Make Operations Idempotent changes concurrency verification to one committed effect and the same historical result. Prove It Works requires provider bytes, production transactions and actual browser results rather than prior green counts.

The only instance allowed is 20261006T234247-d88728, app 62541, PG 62542. Provider stubs prove admission and dispatch guards, not model quality. No external message or live model call is planned. Each completed group appends one six-column evidence row. Full root test/build and self-acceptance are excluded.

## Initial evidence

Parent runtime log source-test-1791351730088 records 0/2 desired-behavior passes. Actual proposal deletion failed PG23503. Actual protected restore replay returned revoked bytes. Other round2 findings are static traces until reproduced. Previous 124/124, 20/20 and 43/43 are historical evidence only.

## Implemented owners and finding map

| Group | Current findings | Retained boundary and behavior | Behavioral regression |
| --- | --- | --- | --- |
| 1. Attempt lifecycle | A1 | Additive 0083 gives attempts office ownership, submission CASCADE and approval SET NULL. Actual conversation HTTP/capability deletion removes pending, failed and consumed attempts. Independent approvals and committed page/version policies survive conversation deletion. Office purge discovers and removes every attempt state while preserving another office. | source-round2; chat-source-boundary |
| 2. Annex plan | A2, B3, C2 | Durable annex_plan retains actor/case, exact scan version/hash, petition policy and generated labels/order. An artifact petition additionally retains its exact artifact version/digest. Analyze, authorized reopen GET, capability contracts, API and edited UI review share the opaque plan ID. Every known owned actor/case/scan baseline is retained, including omitted IDs; forged IDs fail. Changed scans reject. Agent raw petition text is refused; independently submitted human text/ranges remain supported. Planner edits retain private uncertain origin; human edits preserve the managed baseline. Files and filenames carry all contributor obligations. | source-annex-plan; annex-plan.e2e; source-archive |
| 3. Citation cache | A3 | Knowledge exposures retain the exact research reference/material version policy through sourcesFromTool and recordSources. conversationSources filters revoked catalog records and known legacy catalog rows without bindings. TypeSafe's actual transport guard checks again at admission. Independent public web citations remain available. | source-catalog-cache; source-repair-behavior; citations |
| 4. Gmail subject | A4 | Remote reply Subject no longer overwrites the bounded writer's admitted subject. In-Reply-To/References remain; Gmail threadId is used only when the admitted subject matches the fetched thread subject. Seeded replies retain contributor audience checks, ordinary unseeded agent replies and independent human composition still dispatch. | source-gmail-binding; google-email-insights; google-gmail |
| 5. Generic replay | B1, C1 | Typed module registration separates canonical effect owners from generic replay. A reservation precedes the effect, including the concurrent-save branch. Exact historical artifact/page/file identities and policies, annex-plan identity and source maps are serialized. Every replay reauthorizes, validates the DTO and records actual tool exposure. Settings include exact note/instruction policies and original files; research profiles/assessments/references and catalog-search material versions retain current guards. Legacy JSON without a retained binding fails closed. Later revisions do not replace historical results; request mismatch conflicts. | source-round2 concurrent save/replay/settings; source-catalog-cache search replay; security; agent-capabilities |
| 6. Portal ordering | B2 | Invite/renew/revoke/accept take the exclusive ACL gate before the CRM FK parent and session/access rows. File writers take the shared gate, parent KEY SHARE, original session and access SHARE locks, then insert. No lock upgrade. The Better Auth registration hook preserves its supplied PostgreSQL pool through withPostgres; acceptance cannot mutate a different backend. | client-portal deterministic upload/renewal, acceptance/renewal/revoke and logout/revoke waits; auth registration |
| 7. Portal context | B4 | storeFile retains the original staff/client context and signal. The authorization callback runs after all database work before commit. Natural session/invitation expiry uses clock_timestamp. Logout/revoke that begin behind a locked authorized upload linearize after it and deny every later access; logout before the final writer and cancellation deny publication. Ordinary publication/upload and keyed retries remain available. | client-portal natural staff/client expiry, invitation expiry, real logout and cancellation; auth |
| 8. Private chat readiness | B5, C3 | Discovery observes original-file metadata/version policy rather than stale extracted chunks. Pending PDF/image bytes use that exact stored identity, digest and current access. An unrelated queued/failed file does not block private conversation. Explicit shared extracted input still rejects unready/mismatched text. | authenticated chat-source-boundary provider stream/PDF bytes; source-extraction; private-chat-readiness.e2e |
| 9. Gmail generation | C4 | Prepared/review/draft bindings retain authorizationGeneration, and the final Google write guard compares the live generation after remote waits. Same-account incremental consent during preparation prevents POST. Completed/unknown reconciliation is preserved; fresh unseeded operations remain possible. | source-gmail-binding remote-wait interleaving; google-foundation; google-gmail |

The extended bounded census covers 30 path entries in seven families after including the registration hook. Its matched lines are inventory aids, not a coverage score. The neighboring cache tests and the authentication suite exposed missing setup/bindings beyond the two initial runtime defects. New round2 regressions do not replace internal domain services. Existing authentication fault-injection tests remain intact. Test server-only-fixture disables only Next's import marker under plain Node; PostgreSQL, Better Auth, ACL, storage and domain operations remain real.

## Historical repairs retained

Round1 findings remain mapped to their original owners and are exercised again in the combined suites:

| Prior findings | Preserved repair | Current regression owners |
| --- | --- | --- |
| A1, C2 | ACL mutation ordering and post-wait move authorization | source-acl; case-pages |
| B7 | Wall-clock expiry after database waits | source-session-expiry; client-portal; auth |
| A6, B3, C5 | Exact extraction version/hash and worker lease binding | source-extraction; content-policy |
| A7, B5, C6 | Authenticated voice/images/native bytes in bounded writing | chat-audio-source; source-repair-behavior |
| B6, C7 | Explicit task continuation and independent fresh task | source-repair-behavior; source-policy.e2e |
| B1 | Artifact-list/historical exposure policies | source-repair-behavior; source-round2 |
| A4 | Revoked Vault citation filtering before TypeSafe | source-repair-behavior; source-catalog-cache |
| A5 | Stable legacy Vault identity for unchanged Drive confirmations | google-drive; content-policy |
| A2, B2 | Actual contributor intersection for Gmail seed audiences | google-email-insights; source-gmail-binding |
| A3, C4 | Managed Gmail compose/draft baseline survives edited prefills | google-email-insights; source-gmail-binding |
| B4 | Exact reviewed Calendar fields, atomic approval consumption/result | google-calendar |
| C1 | Explicit Vault transformation policy at the canonical writer | source-archive; source-annex-plan |
| C3 | Original archival context through storage and final commit | source-archive; source-session-expiry |
| C8 | Exact consumed private-edit replay before latest-version authorization | source-repair-behavior; source-round2 |
| Combined browser gap | Explain failures and run affected suites together with one worker | final combined browser evidence below |

0081 and 0080a/0082 compatibility were not edited. The parent encoding corrections and removed test-comment lines were preserved. No tasks, fees, activity or Lume-switch feature work was added.

## Evidence progression and deviations

The rerunnable desired-behavior tests initially failed 0/2 in source-test-1791352050518, reproducing PG23503 and protected cached replay. Intermediate failures remain in the owned run logs. The wider 128/130 diagnostic run source-test-1791353386880 exposed invalid older fixtures: a guest folder creator lacked trusted case scope, and a fabricated Vault citation had no admitted source. The fixtures now use real association/case scope and actual upload/extraction/knowledge search. The source-catalog-cache search fixture gained the catalog owner's normal FTS row. Later authentication coverage exposed the registration pool handoff and plain-Node server-only marker; that owner and bootstrap were repaired rather than excluding the suite.

Portal's pre-edit deadlock was not runtime-reproduced before its implementation change. Its original inverse-lock trace remains static negative evidence. The completed production-path tests use deterministic table/parent locks and inspect pg_stat_activity to show actual owners waiting. No SQL imitation of the production transaction and no sleeps-only race proof was used. This is a deviation from the requested pre-edit reproduction order, not a claim that old 40P01 was observed.

The first annex browser attempt source-e2e-1791353180891 failed because the new GET compiled for 15.1 seconds beyond the unchanged 10-second assertion deadline. The warm retry passed without timeout widening. Private-chat browser fixture failures revealed the real mobile canvas/conversation toggle and the exact IA-unconfigured text; the route and locators were corrected, not the application behavior. Portal's older browser fixture inserted an unclassified AI artifact directly in SQL, so the authorized artifact selector correctly omitted it. The fixture now creates independent human content through the actual artifact API; no private draft policy was weakened. Native captures show one 390px layout with scrollWidth=390. The parent's duplicated capture was not reused as visual proof.

## Scope limits

External model/Google/TypeSafe stubs prove admitted bytes and dispatch guards, not model quality or live Gmail behavior. No real email was sent. The owned app has no live model configured; private-chat browser proof reaches the explicit IA-unavailable UI, while the authenticated provider-boundary test proves successful streaming with the external stub. A changed independent reply subject can start a new Gmail thread; the admitted subject remains authoritative and reply headers remain available.

Generic reservations deliberately leave ambiguous failed effects in unknown state and crashed reservations pending; they refuse automatic duplicate writes. Durable recovery UI for those states is outside this repair. Historical protected JSON without an exact replay binding is unavailable. Known managed annex baselines are conservative across omission and older plan IDs; the independent-human split workflow is available when no managed baseline exists.

Root full lint/test/build and acceptance remain the parent's delivery responsibilities. Scoped lint and root typecheck are run here. There is no claim of exhaustive ACL/connector/editor coverage or acceptance of the source-policy unit.

## Frozen verification and handoff

Frozen at 2026-10-07T06:33:48.806Z. No production, test, migration or inventoried helper changed during the final checks. Evidence paths below are relative to `apps/web/.e2e/verify/20261006T234247-d88728/`.

| Check | Result | Exact evidence |
| --- | --- | --- |
| Real PostgreSQL combined run, 28 files, one worker | 219/219; zero failures, skips or cancellations | `source-test-1791355088952/output.log` |
| Original unchanged parent desired-behavior repro | 2/2: conversation deletion succeeds; protected retry returns NOT_FOUND without body | `source-test-1791355903270/output.log`; original `.audit/lume-source-round2-repro.test.ts` |
| Frozen combined browser run, 11 affected suites plus authentication setup, one worker | 49/49 across 12 files; 723.37 seconds | `source-e2e-1791355147204/report.json`, `output.log`, all traces/videos/screenshots |
| Scoped ESLint, all 41 owned TypeScript production/test/browser files | exit 0 | `source-round2-scoped-lint.log` |
| Root pnpm typecheck with owned environment | 2 tasks successful; exit 0 | `source-checks-1791354854864/output.log` |
| Freeze and database integrity | 53 normalized-LF SHA256 file hashes match; all 10 applied migration checksums match; zero temporary fixture schemas and zero compatibility triggers | `source-round2-freeze.json`; `source-round2-manifest-1791355915691/manifest.json` |
| Final verify-lume doctor | healthy; app 62541/PG62542; existing supervisor/Next processes remain running | doctor executed after final manifest; no instance stopped or replaced |
| Native T3 preview | 13 media artifacts: four recordings and nine screenshots; desktop 1280x900, mobile 390x844; width/scrollWidth 390/390 | `source-round2-preview/manifest.json`, review/generation/keyboard/changed-scan and private-chat media |

The PostgreSQL combined command uses the existing guard:

```text
pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts test tests/source-round2.test.ts tests/source-annex-plan.test.ts tests/source-catalog-cache.test.ts tests/source-gmail-binding.test.ts tests/client-portal.test.ts tests/chat-source-boundary.test.ts tests/chat-audio-source.test.ts tests/source-session-expiry.test.ts tests/source-acl.test.ts tests/source-extraction.test.ts tests/source-archive.test.ts tests/source-repair-behavior.test.ts tests/content-policy.test.ts tests/content-exits.test.ts tests/case-pages.test.ts tests/citations.test.ts tests/google-email-insights.test.ts tests/google-gmail.test.ts tests/agent-capabilities.test.ts tests/agent-profile.test.ts tests/research-case.test.ts tests/security.test.ts tests/auth.test.ts tests/agent-knowledge.test.ts tests/annexes.test.ts tests/google-calendar.test.ts tests/google-drive.test.ts tests/google-foundation.test.ts
pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts e2e e2e/annex-plan.e2e.ts e2e/private-chat-readiness.e2e.ts e2e/client-portal.e2e.ts e2e/case-pages.e2e.ts e2e/editor-repair.e2e.ts e2e/document-saving.e2e.ts e2e/lume-shell.e2e.ts e2e/workspace.e2e.ts e2e/app-shell.e2e.ts e2e/source-policy.e2e.ts e2e/vault-pagination.e2e.ts
pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts test ../../.audit/lume-source-round2-repro.test.ts
```

The final trace audit covers 49 traces with zero page errors, 85 console error records and four navigation-context-destroyed operation records in passing tests. HTTP error counts are 401=2, 403=1, 404=29, 409=9, 429=22 and 503=21. Intentional error/conflict/revocation tests account for the rejected save/publication/approval requests. The new annex GET's 404 in vault-pagination belongs to its synthetic `option-200` pagination fixture. There are 22 actual `/api/auth/get-session` 429 responses; these are an observed rapid-navigation limit, not clean network proof. Details are retained in `source-e2e-1791355147204/source-trace-audit.json` and `source-trace-summary.json`.

The preceding diagnostic browser run `source-e2e-1791354305649` was 47/49. Its portal fixture failure was repaired through the actual human artifact API. Its editor history/pending-save test removed the revoked editor but did not finish home navigation before the assertion. The trace showed the canvas authorization request succeeded and the destination RSC request did not finish. No navigation production patch or timeout widening was made; all 16 unchanged editor tests passed in the frozen combined run. The earlier intermittent navigation cause remains unresolved and its trace/video/screen are retained for acceptance review. The broad diagnostic PostgreSQL run `source-test-1791354295603` was 196/197 because auth imported the server-only marker; the final bootstrap and pool handoff are covered by all 23 authentication tests in the 219/219 run.

Native preview confirms edited annex labels, keyboard generation, changed-scan errors, one coherent narrow layout and private conversation beside a case with failed/queued files. The private-chat screenshots/recording show the actual IA-unconfigured error, not a successful live-model response. The authenticated provider regression separately proves successful streaming and exact pending PDF admission. No real email or live model was sent.

The final inventory preserves historical fields and adds round2 source/test/migration/helper ownership, exact frozen hashes, migration checksums, negative evidence and final evidence links. The six-column TSV maps each group to changes and proof. All nine groups and A1-A4/B1-B5/C1-C4 are implemented, with the deviations and limits above. Parent comment pass, three independent acceptance reviews and full-root delivery remain outstanding. No commit, publication, deployment, new thread, worktree or delegated child was created by this writer.
