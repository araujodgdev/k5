# Lume source-policy implementation

Implemented on `feat/lume-agent-canvas` in the existing checkout. The accepted contract is [.audit/lume-provenance-synthesis.md](lume-provenance-synthesis.md). This report covers the source-policy writer slot only. Existing editor, workspace, navigation, route and design changes were preserved. No subagents, commits, pushes, PRs, deployments, external messages, developer-database mutations or `.env.local` edits were performed.

The isolated verification app remains at `http://localhost:62541`, PostgreSQL `62542`, run `20261006T234247-d88728`. Its original supervisor and Next processes remain running. Root lint/typecheck/test/build and formal acceptance remain parent-owned.

## Final writer handoff

The GPT-6.1 Sol High writer inherited the production implementation and its scoped test/browser evidence from the interrupted writer. The frozen report is [lume-provenance-implementation-astra-interrupted.md](lume-provenance-implementation-astra-interrupted.md). Its SHA-256 remains `6df4e89a7363ffe480f27b2fab34f2d4253e6a8aae9d6cb09bf3f23e4f9c14ac`. This report is an implementation handoff, not parent acceptance.

The inherited final policy run actually failed **9/10** in `source-test-1791344067674`. The previous run `source-test-1791343987620` also failed **9/10**, first because its observer needed a fourth connection from a three-connection pool. After the observer moved onto the held connection, it repeatedly read one transaction-cached `pg_stat_activity` snapshot. The final writer added `pg_stat_clear_snapshot()` before each observation. The two-waiter requirement, independent approval-row lock, production decision calls and durable-result assertions remain unchanged. PostgreSQL documents this transaction snapshot behavior in [Viewing statistics](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-STATS-VIEWS).

The corrected final suite passed **10/10** in `source-test-1791344311665`. The final writer also ran the explicit-file ESLint helper successfully in `source-static-1791344384974`, and `pnpm --dir apps/web exec tsc --noEmit --incremental false` completed with exit 0 in session 42776. No production source or applied migration changed during this continuation. The only application-file edit was `apps/web/tests/content-policy.test.ts`.

The final writer inspected the policy, shared/private writers, admission/replay, review endpoint/UI, render pins and managed-exit callers against the synthesis. The read-only helper `.audit/source-handoff-checks.mts` verified the 82-file inventory, report links, frozen report, actual inherited test/e2e results, browser asset sizes, current SQL outcomes and both applied migration checksums. Its evidence is `source-handoff-1791344486879/checks.json`. The production content-write census still finds only `documents/service.ts` for private artifact content and `case-pages/service.ts` for page content. This census is a SQL-text check; it does not replace the production-entry-point regressions.

Inherited browser runs were inspected, not rerun. Their actual JSON results corroborate the scoped passing cases below and preserve the combined failures. The final writer visually inspected the inherited desktop/mobile review and private archive captures. A fresh owned T3 tab also signed in, reopened the existing private original at desktop and 390px, then used the consumed chat card's Abrir control to open its existing shared result. Both mobile document widths were 390px with no horizontal page overflow. This was a read of existing results, not a new generation or confirmation. Its recording, captures and observations are in `source-browser-handoff-1791344571883`.

The final writer changed this report, appended the TSV trail, added finalization metadata to `lume-provenance-files.json`, and added `source-handoff-checks.mts`. All broader application, editor and audit changes remain inherited. Prove It Works changed the verification choice to actual log/SQL/provider evidence. Fix Root Causes changed the barrier observer rather than the production decision path. Test Behavior, Not Implementation retained the real contention and durable-content assertions. No subagents were spawned.

## Result and domain shape

The private conversation can invoke the existing structured writer using its recorded authenticated request. The private planner supplies the operation and authorized resource identity; its title, body, summary, query and plan do not become shared instructions. The shared writer resolves exact selected versions, direct attachments, an eligible earlier task/proposal, eligible instructions and authoritative knowledge documents. Opaque private memory, transcript, old approval previews, generated untraceable rules/notes and provider continuation are excluded. Private chat and memory remain available under current known access.

A format-1 `ContentPolicy` binds a SHA-256 content digest, origin (`person`, `generated`, `legacy-human`, `uncertain`), eligibility, owner fences, observed version/digest receipts and a deduplicated flat set of intrinsic resource guards. Guards check current existence, office/case consistency, membership and folder ancestors. They do not recurse into the latest policy of a source page. Moving a source or copy preserves captured ancestor obligations. Editing or restoring retains the baseline and incorporated historical obligations.

`content_submission` records immutable authenticated request text, the original scope and selected inputs before private generation. `content_generation_attempt` reserves a leased attempt by submission/generation/operation, stores the actual provider input and exact output, and links the durable proposal. Retry recovers the same proposal; explicit regeneration has a new generation identity. `content_seed` binds application-generated prefill to purpose and audience/context. Gmail reply suggestions additionally bind connection generation, thread, messages and known recipient addresses; edited/omitted seed IDs cannot erase the server-known lineage.

`documents/service.ts` owns private content CAS, version policy, sampled text history and approval consumption/result on one transaction connection. Every committed artifact version has a compact `ai_artifact_policy` row; this does not introduce a text history row for every autosave. `case-pages/service.ts` owns shared content/version/policy and exact approval consumption/result atomically. Reconfirmation returns the original committed version subject to current access, even if the page has subsequently changed. Invalid edits, stale CAS, cancelled decisions and transaction failures cannot mutate classification separately from content.

Full page proposal text is served by the authenticated, no-store review endpoint. The chat card displays that endpoint's title, content, destination and audience; confirmation stays disabled during loading/error and a retry control is available. Stored chat/model history receives fixed operation/status metadata and opaque IDs. The recovered original invocation still governs capability/guest checks when a person confirms.

## Writer, input and exit inventory

| Production boundary | Final owner and enforcement |
| --- | --- |
| HTTP chat send, regeneration, original visible scope | `api/chat/route.ts`, recorded person submission, server scope authorization; regeneration uses original recorded scope, never today's canvas. |
| `workspace.ask` | Typed instruction remains separate from document identity and excerpt. Selected bytes are resolved once by the server. Completed draft/revocation/navigation guards remain intact. |
| Private chat inputs and tool exposure | `chat-turn.ts`, `chat-prompt.ts`, capability exposure metadata, `agent-tools/index.ts`, retrieval/knowledge readers capture known policies. Current-revoked history is withheld. Unattributable inputs remain uncertain. |
| Shared create/update/follow-up | `prepareSharedWriting` uses existing `generateStructured`, fresh task session, no tools/search/memory/previous provider response. Exact pending/consumed eligible task continuation is server-linked. |
| Private artifact create | Capability/application create and workflow create call `createPrivateDocument`; current content, initial history and compact policy commit together. |
| Private autosave, explicit edit, restore | HTTP PUT and artifact application methods call `updatePrivateDocument`; old raw `ai-store.updateArtifact` production writer is removed. Test adapter uses the same owner. |
| Background drafting/chronology | Queued input retains known source policy; worker rechecks source admission/access before model/checkpoint stages; artifact creation retains the run lease and uncertain owner classification. |
| Personal/office instructions and knowledge notes | Existing settings writers preserve base/seed policy; generated edits stay uncertain. Shared configured knowledge reads authoritative document content and omits ineligible notes without discarding eligible documents. |
| Shared page create/edit/restore/publication | Shared service owns content/history/policy/approval result. Publication checks exact artifact version and policy. Current participant/ancestor/source access is rechecked in the transaction. |
| Private artifact DOCX/PDF export | Current artifact and actual render inputs checked before/after preparation. Explicit inaccessible template does not fall back. |
| Actual selected/default DOCX template | `artifact-file.ts` pins template version, bytes digest and policy; rendered copy identity includes the actual template. PDFcn text rendering does not inherit an unused DOCX template. |
| Archive from conversation / artifact SaveForm | Existing conversation route and Vault application service permit owner Library/private-folder archives, preserving owner fences and source obligations. Rendering/storage staged outside the final content transaction. |
| Vault initial upload/copy and new version | `createVaultDocument`, Vault version service and Drive import bind bytes/version/policy atomically. Replacement preserves prior managed policy. New uploads retain direct-person semantics. |
| Vault move and folder broadening | Location may change under existing administration rules; effective policy remains. No new folder approval flow. |
| Vault list/count/search/chunks/file/download | Canonical `lume_vault_visible` plus exact version policy; list and count now use the same predicate. File reads recheck identity/access after opening bytes. |
| Research profile/assessment/material reads | Document admission and returned/cached facts use canonical Vault visibility; pinned research versions retain installation AI/redistribution and material availability guards. |
| Personal-chat pinned document shares | Exact source version retained; sender and internal recipient must satisfy inherited policy. External recipient requires source-independent eligible content. Recipient reads, list metadata and email dispatch recheck current policy. |
| Personal-chat generated text | Recomposition uses recorded person intent before existing confirmation and insertion; private planner text is not sent directly. |
| Direct portal artifact PDF | Exact artifact/template policies and actual template digest bind the portal copy. Final publication rechecks the input. Portal staff/client list/read and honorários attachments enforce retained policy. |
| Gmail subject/body/drafts/replies | Generated raw text is bounded recomposition; attachment policies retained in the exact reviewed operation. Existing draft policy survives edits. Reply seeds preserve same-audience facts and reject audience changes. |
| Gmail dispatch and reconciliation | Existing durable operation/Message-ID/unknown-outcome contracts remain. Policy checked before reservation/dispatch; no new confirmation round. |
| Google Drive replacement and Docs text | Exact Vault bytes/version/digest and current policy for file replacement; bounded generated text for Docs. Imported/reimported managed versions retain base policy and final folder authorization. |
| Drive rename/share notification | Generated textual payload is bounded from recorded intent; existing remote identity/ETag and exact confirmations remain. |
| Calendar create/update/share text | Generated title/description/location is bounded from recorded intent; policy participates in the existing operation and final share check. Existing attendee review and recurrence handling remain. |
| WhatsApp text | Bounded generated content, exact existing recipient/text/intent confirmation, durable policy and final provider-boundary check; prior idempotency/reconciliation and reply-window behavior preserved. |
| Future per-case Lume switch | Common `assertLumeAdmission`/`assertSourcesAdmitted` hooks cover agent admission, history, selected sources, workers and content commits. Absent `lume_enabled` means current behavior; no speculative settings model/UI added. |

A production SQL search found private content/version writes only in `documents/service.ts`; shared page content/version writes only in `case-pages/service.ts`. The remaining page-folder move is location administration, not content mutation. Vault version writers are its existing initial-create, add-version and Drive-import domain owners, all migrated.

## Authorization ordering and bounds

The content transaction takes a shared transaction-scoped advisory lock keyed by the current database schema before target row locks. A narrow statement-trigger function takes the exclusive side **before** the actual ACL mutation obtains row locks. This covers direct SQL and existing domain services, including Better Auth session deletion/expiry. It is not a deferred content-binding trigger or a new event system.

The complete trigger inventory in 0076 is:

- Insert/update/delete: `case_participant`, `office_associate`, `office_member`, `vault_folder_member`.
- Update/delete: `vault_folder`, `vault_case` (also orders the future Lume switch).
- Relevant scope/move/delete columns: `vault_document` (`office_id,case_id,folder_id,deleted_at`), `case_page` (`office_id,case_id,folder_id`).
- Update/delete: `research_case_reference`, `research_material_version`, `research_material`, `research_judgment`, `judicial_source_installation`.
- Session expiry update/delete: `session`; current session is also reread/locked on the transaction connection.

This uses a schema-wide gate, deliberately simpler and more conservative than a per-case lock-key topology. Content readers can proceed concurrently; unrelated ACL writes may wait for short content commits. Model/network/render work stays outside those transactions. External provider dispatch is reauthorized immediately before the request, but cannot be made transactionally atomic with a later remote side effect or retract already delivered bytes.

Current guard evaluation is a bulk SQL query, with no positive cross-request ACL cache. The compatibility walker is iterative/visited-once with explicit 2,048-node/guard bounds, 32,768-step work bound, and 64-folder ancestor bound. New combined policy also rejects excess guards/pins rather than truncating restrictions. These are conservative execution limits, not throughput measurements. The cyclic compatibility test asserts a single bulk query and finite union.

## Migration and legacy behavior

Added `0076_content_policy.sql` and then `0077_content_policy_validation.sql`. Both ran only against the owned disposable verification instance; 0075 and applied files were not rewritten. 0077 was a subsequent additive fix for malformed SQL-side policy visibility and legacy material-version guards.

Migration evidence: `source-migrate-1791341575288/output.log` and `source-migrate-1791342840478/output.log`, beneath the verification root. Existing content/history/approvals/origin metadata and private memory are preserved.

Legacy artifacts with no agent, run, conversation or source-reference evidence retain the historical human convention. This is an ownership assumption, not proof of external authorship. Agent/run/conversation evidence overrides an old completeness flag. Unknown model text stays owner-fenced and ineligible for a new automated shared output. Human in-place edits retain those restrictions. Legacy shared pages remain readable under bounded recoverable obligations/current intrinsic ACL; they are not retroactively certified as source-complete.

Old pending proposals lacking support for a new share remain stored and return an actionable new-request/selected-sources error. New proposals retain exact result recovery. Legacy portal artifact copies without an actual render-template pin require republication rather than inventing a source-free classification. Manual downloads/copy-paste/screenshots and unrecognizable reuploads remain outside enforceable future in-app ACL.

## Verification and evidence levels

All paths below are under `apps/web/.e2e/verify/20261006T234247-d88728/`. The wrapper `.audit/lume-source-checks.mts` verifies the instance identity/ports, exports credentials only into the child environment, uses separate test schemas and writes unique logs. It never rewrites application env files or starts/stops the instance.

### Scoped application checks

- `pnpm --dir apps/web exec tsc --noEmit --incremental false`: inherited session 60481 passed. The final writer reran it after the barrier-reader correction; session 42776 completed with exit 0.
- Explicit-file ESLint: inherited `source-static-1791344022264` passed. Final `source-static-1791344384974/checks.json` and `eslint.log` passed. The full file list is recorded, not inferred from this checkout's preexisting dirty state.
- Final link/path, frozen-report and applied-migration checks: `source-handoff-1791344486879/checks.json`. `git diff --check` passed; existing Windows line-ending warnings remain. Final doctor and closure checks are recorded in the closing TSV entry.

Representative commands:

```text
pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts test <scoped tests below>
pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts e2e <affected files below>
pnpm --dir apps/web exec tsx ../../.audit/check-source-static.mts
pnpm --dir apps/web exec tsc --noEmit --incremental false
pnpm --silent --dir apps/web exec tsx ../../.agents/skills/verify-lume/scripts/lume-verify.mts doctor
```

| Scoped run | Result and coverage |
| --- | --- |
| `source-test-1791342654716` | 18/18: actual HTTP chat, portal, policy and personal-chat behavior. |
| `source-test-1791342887598` | 18/18: instructions, knowledge, profile, managed exits and conversation artifacts. |
| `source-test-1791342987807` | 2/2 background model-plan tests, including resumed real chronology writer with current/history/compact policy and result. |
| `source-test-1791343107922` | 96/96: case pages (10), chat route (5), Drive (20), Gmail (16), workspace (22), personal chat (8), WhatsApp (15). |
| `source-test-1791343771814` | 9/9 central policy tests, including real image bytes at the actual provider wire and malformed policy denial. |
| `source-test-1791343831521` | 14/14 research capability/case tests after restoring the fixture's real active Vault version. |
| `source-test-1791343987620` and `source-test-1791344067674` | Each 9/10, with the observer failures explained above. Retained as failures. |
| `source-test-1791344311665` | Final writer's 10/10 policy suite, including both pending decision updates observed behind an independent approval-row lock before release. |
| Calendar / artifact-file scope | 13 calendar and 4 agent-file tests passed in `source-test-1791342600097`; that run's single conversation-artifact expectation failure was corrected and covered by the later 18/18 run. |

These are per-run counts, not a claimed unique aggregate. Several suites repeat deliberately after fixes.

The HTTP source-boundary test replaces only external model fetch responses plus the framework request-header adapter needed outside a Next request host. Real Better Auth sign-up/session, HTTP chat admission, actual chat turn/private memory/settings, actual tool registration/execution, actual structured runtime, PostgreSQL proposal and final confirmation execute. The private conversation request includes private personalization; the actual separate structured provider request excludes private transcript/working memory/settings/approval preview/planner sentinels and native continuation, with tools empty and a fresh task session. The image case verifies exact base64 bytes at that actual transport. These prove the application boundary, not external model quality.

PostgreSQL coverage includes forced content/history failures and rollback, sampled autosave policy, stale CAS, simultaneous exact confirmations, historical result replay, real A2-from-B1/B2-from-A1 followed by A3, finite old cycles, live source revocation, owner-only archive/move/list/count/chunks/download denial, malformed policy denial, and a real independent ACL-mutator connection observed waiting on the advisory gate. The final decision race additionally observes both production decision updates waiting behind an independent row lock before releasing them.

### Browser regressions and diagnosed failures

No acceptance timeout was increased. No completed editor production guard was changed.

- First affected run `source-e2e-1791341594721`: 37 passed, 4 failed. Three navigation assertions and a mobile home test assuming the canvas was initially active. The mobile test now explicitly selects Canvas for the existing home/chat behavior.
- Second run `source-e2e-1791342994695`: 39 passed, 2 failed. All **16 editor repair**, **12 document-saving** and **3 workspace** cases passed. Publication and shell navigation assertions remained pending.
- `source-e2e-1791343553245`: all **3 case-page** cases and **1 conversation archive/error-retry** case passed; five shell cases passed and the source-revocation navigation assertion failed.
- `source-e2e-1791343760462`: all **6 shell** cases passed. The new review test's first error injection was bypassed by a second development-mode fetch; the fixture was corrected to keep the endpoint unavailable until the test explicitly retries.
- `source-e2e-1791343884288`: the new test reached the intended error; its global alert locator also matched Next's empty alert. The test now scopes the alert to the confirmation group.
- `source-e2e-1791343977727`: new **source-policy review test passed**, covering loading/disabled confirmation, injected transient preview failure, real authorized retry, exact text rather than stored summary, desktop, 390px, keyboard confirmation and real persisted content/consumed approval.

The full original editor regression set therefore has a passing run, and every affected case has a passing final scoped result. There is **no claim of one all-green combined final run**. The intermittent URL assertion issue remains an unresolved navigation diagnostic limit. The recorded publication trace has review/confirmation HTTP 200 in about 150ms, then a new-page RSC request with no response before timeout; the dev server did not log that GET completion. The same UI path succeeded manually and in the next suite. This is evidence of a pending navigation, not proof of its ultimate root cause or an environment-failure classification. Initial failure screens, traces and videos remain available for the parent.

Earlier unit failures are preserved in the `source-test-*` logs. They exposed missing active-version/member fixture state, outdated error/query-budget expectations, one incorrect test table name, and real missed Vault list/count enforcement that was fixed. The image fixture initially rejected the SDK's local `data:` URL read; it now leaves that local read real and stubs only the external provider endpoint. The independent decision-barrier test initially exhausted the three-connection test pool by requesting a fourth observer. Observation now uses the held connection and clears its statistics snapshot between reads. The initial 0076 SQL quoting error was fixed before its successful application; 0077 was added after 0076 had run.

### Actual T3 browser evidence

T3 `preview_status` reported an available automation host; the agent-owned tab was used throughout. No browser fallback or standalone manual Playwright was used.

`source-browser/manifest.json` records original paths, copied files and evidence levels. `source-browser/persistence.json` contains read-only SQL verification of actual UI effects.

- `page-edit-ask.mp4`, `page-desktop.png`, `page-mobile.png`: create/edit/save/reload and actual typed ask. The isolated account has no configured live model; the ask showed the real configuration error. It does **not** prove a live successful generation.
- `exact-publication-keyboard.mp4`, `publication-desktop.png`, `publication-mobile.png`, `publication-reloaded.png`: real document editing, exact preview, destination selection and Tab/Enter confirmation. The initial private document was arranged through its authenticated API. SQL confirms the published page v1 text equals private original v3.
- `legacy-private-archive.mp4`, `archive-form-mobile.png`, `archive-saved-mobile.png`: actual mobile DOCX archive. A legacy model artifact was deliberately arranged with the existing disposable-DB e2e seed helper. SQL confirms Library scope, `origin=uncertain`, `eligible=false`, retained owner fence and pinned source version.
- `chat-review-keyboard.mp4`, `chat-review-desktop.png`, `chat-review-mobile-focused.png`, `chat-review-confirmed.png`: exact current-authorized review card in real UI, Tab focus and Enter confirmation. A real authenticated person-publication proposal was arranged through its API; only its chat card was seeded. This is not presented as live model generation. Recording includes submission; the post-response screenshot and SQL confirm consumed approval and exact page v1.

Desktop and mobile images were visually inspected. Text/destination/review controls fit the shown viewport, the mobile focus ring is visible, and persisted outcomes were checked separately from screenshots. The supplementary empty-artifact recording is not counted as publication evidence.

## Tradeoffs and remaining limits

- No live external-model quality smoke test was possible in the isolated account. Deterministic provider-boundary and full HTTP admission checks passed.
- Intermittent Next dev navigation timing described above remains unexplained; it was not hidden by changing timeouts or weakening acceptance.
- A schema-wide ACL gate is intentionally conservative and may serialize unrelated permission edits. No benchmark is claimed.
- Source-bound policies cannot retract already delivered/downloaded bytes. External dispatch has an immediate check, not a distributed transaction.
- Known revoked history causes conservative private memory/provider-session suppression while its aggregate old obligations remain revoked. This does not introduce a per-fact memory reconstruction system.
- Legacy untracked model output stays privately useful and archivable; sharing requires a new bounded request, not a certification checkbox. Old portal renders without provable template input need republication.
- The future case Lume switch is an admission hook only; its product model/UI remains the parent's later unit.
- No outstanding deterministic content/policy defect is knowingly left open. Formal independent review and full root checks remain the parent’s responsibility.

## Exact source-policy file inventory

The following files were added or edited for this unit. Some already contained uncommitted work; only the scoped changes are claimed. `lume-provenance-files.json` is the machine-readable list used for the scoped static check. Preexisting design/shell/editor repair files not listed here were not reset or claimed as this implementation.

### Migration and policy

- `apps/web/db/postgres/0076_content_policy.sql`
- `apps/web/db/postgres/0077_content_policy_validation.sql`
- `apps/web/src/lib/content-policy.ts`
- `apps/web/src/lib/documents/service.ts`
- `apps/web/src/lib/documents/shared-writing.ts`
- `apps/web/src/lib/case-pages/contracts.ts`
- `apps/web/src/lib/case-pages/provenance.ts`
- `apps/web/src/lib/case-pages/service.ts`

### Admission and private writers

- `apps/web/src/app/api/chat/route.ts`
- `apps/web/src/app/api/artifacts/[id]/route.ts`
- `apps/web/src/lib/ai-store.ts`
- `apps/web/src/lib/ai-runtime.ts`
- `apps/web/src/lib/chat-prompt.ts`
- `apps/web/src/lib/chat-turn.ts`
- `apps/web/src/lib/agent-guard.ts`
- `apps/web/src/lib/agent-tools/index.ts`
- `apps/web/src/lib/agent-instructions.ts`
- `apps/web/src/lib/agent-knowledge.ts`
- `apps/web/src/lib/agent-profile.ts`
- `apps/web/src/lib/document-workflows.ts`
- `apps/web/src/lib/application/context.ts`
- `apps/web/src/lib/application/artifacts-service.ts`
- `apps/web/src/lib/application/approvals-service.ts`
- `apps/web/src/lib/application/agent-approvals.ts`
- `apps/web/src/lib/application/agent-settings-service.ts`
- `apps/web/src/lib/application/knowledge-service.ts`
- `apps/web/src/lib/application/runs-service.ts`
- `apps/web/src/lib/application/workspace-agent-service.ts`
- `apps/web/src/lib/capabilities/contracts.ts`
- `apps/web/src/lib/capabilities/research.ts`
- `apps/web/src/lib/capabilities/workspace.ts`
- `apps/web/src/lib/knowledge/retrieval.ts`
- `apps/web/src/lib/research/case-assessment.ts`
- `apps/web/src/lib/research/case-profile.ts`
- `apps/web/src/lib/research/case-material.ts`
- `apps/web/src/lib/typesafe/verification.ts`
- `apps/web/src/lib/collaboration/access.ts`

### Copies and exits

- `apps/web/src/app/api/artifacts/[id]/export/route.ts`
- `apps/web/src/lib/application/vault-service.ts`
- `apps/web/src/lib/vault.ts`
- `apps/web/src/lib/artifact-file.ts`
- `apps/web/src/lib/conversation-artifacts.ts`
- `apps/web/src/lib/client-portal/service.ts`
- `apps/web/src/lib/honorarios/charges.ts`
- `apps/web/src/lib/personal-chat/shares.ts`
- `apps/web/src/lib/personal-chat/service.ts`
- `apps/web/src/lib/personal-chat/email-worker.ts`
- `apps/web/src/lib/capabilities/google.ts`
- `apps/web/src/lib/capabilities/whatsapp.ts`
- `apps/web/src/lib/google/operations.ts`
- `apps/web/src/lib/google/drive/import.ts`
- `apps/web/src/lib/google/drive/service.ts`
- `apps/web/src/lib/google/gmail/service.ts`
- `apps/web/src/lib/google/gmail/insights.ts`
- `apps/web/src/lib/google/gmail/insights-contracts.ts`
- `apps/web/src/lib/google/calendar/service.ts`
- `apps/web/src/lib/whatsapp/send.ts`

### UI

- `apps/web/src/app/api/approvals/[id]/page/route.ts`
- `apps/web/src/components/document/page-approval-review.tsx`
- `apps/web/src/components/agent-chat.tsx`
- `apps/web/src/components/google/email-smart.tsx`
- `apps/web/src/components/google/gmail-panel.tsx`
- `apps/web/src/components/lume/lume-workspace.tsx`

### Tests

- `apps/web/tests/shared-writing-fixture.ts`
- `apps/web/tests/document-writes.ts`
- `apps/web/tests/chat-source-boundary.test.ts`
- `apps/web/tests/content-policy.test.ts`
- `apps/web/tests/content-exits.test.ts`
- `apps/web/tests/case-pages.test.ts`
- `apps/web/tests/ai-store.test.ts`
- `apps/web/tests/agent-capabilities.test.ts`
- `apps/web/tests/agent-files-review.test.ts`
- `apps/web/tests/agent-knowledge.test.ts`
- `apps/web/tests/agent-profile.test.ts`
- `apps/web/tests/conversation-artifacts.test.ts`
- `apps/web/tests/google-email-insights.test.ts`
- `apps/web/tests/personal-chat.test.ts`
- `apps/web/tests/run-model-plan.test.ts`
- `apps/web/tests/whatsapp-send.test.ts`
- `apps/web/tests/research-case.test.ts`
- `apps/web/e2e/workspace.e2e.ts`
- `apps/web/e2e/source-policy.e2e.ts`

### Audit and evidence helpers

- `.audit/lume-provenance-implementation.md`
- `.audit/lume-provenance-implementation.tsv` (append-only; an appended correction documents the initial hard-coded timestamp labels)
- `.audit/lume-provenance-files.json`
- `.audit/lume-source-checks.mts`
- `.audit/source-browser-fixture.mts`
- `.audit/read-source-trace.mts`
- `.audit/collect-source-evidence.mts`
- `.audit/check-source-static.mts`
- `.audit/source-handoff-checks.mts`
- `.audit/lume-provenance-implementation-astra-interrupted.md` is preserved, not edited by the final writer.

Evidence is under the existing isolated `apps/web/.e2e/verify/20261006T234247-d88728` directory and is not intended as shipped application source.
