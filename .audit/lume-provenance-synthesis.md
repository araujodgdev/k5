# Accepted source-policy repair

## Problem and outcome

A normally personalized Lume conversation must create and edit an accessible shared page, produce an exact reviewable proposal, and preserve current protected-source access. The failed implementation used a permanent conversation completeness Boolean, changed private-artifact provenance before content succeeded, replayed untracked previews, and recursively followed mutable page dependencies. The repair replaces that mechanism while retaining the private ai_artifact / shared case_page split, persistent chat, existing runtime and editor.

This is the binding source-policy contract. It supersedes conflicting source-policy details in the original unit-2 brief and in all three design candidates. The broader accepted contract remains lume-architecture-synthesis.md. Editor lifecycle repair is independent.

## Synthesis decision

Select candidate 3 as the base. Its shared writer uses the existing tool-free generateStructured path, instead of introducing another agent tool loop. All candidates independently identified the same useful core: authenticated intent, an independently assembled writing request, immutable observed-version policy, current ACL checks and atomic content commits. The parent and independent judge agree on candidate 3. The judge scored A/B/C 18/19/20 out of 25; these are design judgments, not measurements or implementation proof. The parent recorded its own criterion scores in lume-provenance-parent-reading.md before receiving the verdict.

Take three focused grafts.

1. Candidate 2's authenticated submission and application-prefill binding. A raw person-save body is insufficient if the app seeded it from generated/protected text. Record the actual submission and inherited seed/base policy, including generated instructions and knowledge usage notes. Confirmation never converts model text into direct-person origin.
2. Candidate 2's shared-task continuation and generation-attempt reservation. Direct follow-up requests can refer to an exact eligible pending proposal/version and original selections. A simple “deixe mais breve” works in the same conversation. A retry recovers the same attempt/proposal; deliberate regeneration creates a new attempt.
3. Candidate 1's transaction-helper fit and preservation of existing artifact history behavior. Move artifact CAS/history SQL into the one transaction-aware writer. Preserve sampled autosave history while binding policy to every committed version. Authorization and approval helpers used inside the transaction must use its connection.

The independent judgment is in lume-provenance-judge.md. All five groups in lume-pages-review-verdict.md remain accepted defects; this contract covers groups 1-4 and the separate editor writer covers group 5. No review finding was dismissed as a style preference.

## Consumer usage and data shape

The existing private assistant remains the interface. Its shared-writing operation supplies the server-held current request identity and an authorized destination/reference, never free-form title/content/plan copied from the private model. The document service resolves the exact human request, eligible task continuation, target page version, explicit source selections and eligible configured context. It calls the existing structured runtime without private memory, transcript, native search, tools or provider continuation. Its exact output becomes a durable proposal shown in the existing confirmation surface.

The public shape follows candidate 3's document operations, with these corrections.

- A person write carries an authenticated submission identity bound to its immutable bytes and existing application seed/base. The transport adapter creates this record; the client/model cannot assert person origin or omit a known server-owned base policy to reset it. A new app-prefilled draft/setting must get a server-owned seed binding before the prefill is offered. Direct new typed/pasted/uploaded material is an explicit person submission, not a claim to prove its external authorship.
- A generated write carries an opaque server-created output/receipt identity bound to the exact provider input and output. A private model's output, IDs encoding instructions, title, summary, query or plan cannot become an independent direct instruction to the shared writer.
- An exact content version has one immutable policy, tied to content digest. It records share eligibility/owner-only uncertainty, observed source version/digest and a deduplicated flat set of current access obligations. Existing source-aware version metadata should be reused where it represents the same fact. Do not create duplicate generic stores merely to mirror the candidate's illustrative schema.
- A proposal binds operation, exact bytes, destination, original invocation, source/base versions, immutable policy and recoverable result identity/version. Do not union later conversation state into it. Reconfirmation returns the same committed result, subject to current access, not today's unrelated page revision.
- Each preparation has a server-owned attempt identity. Reserve/recover it by original send, attempt and operation. Link eligible follow-up requests to the actual shared task/proposal, not a private assistant paraphrase. Stale target CAS requires a new exact proposal rather than silently rewriting the original.

Document operations own authorization, content/version/policy CAS and approval outcome in one service. Policy internals own canonical legacy classification, source observation, flat guard evaluation and input construction. File preparation and delivery stages stay internal to real archive/share/portal/connector operations. Do not expose a public prepare/check/commit choreography that every caller must coordinate correctly.

## Input and generation boundary

Preserve private conversation/memory and existing provider selection, cancellation, run admission, tracing and usage accounting. Shared generation uses a fresh stateless, tool-free structured request in that same conversation. Prove the final actual provider request contains only admitted inputs. No new agent framework, scheduler or detached user chat is needed.

Eligible input includes the exact person request, explicitly linked direct follow-up instructions, an eligible previous proposal/version, authorized selected source versions/ranges, directly submitted uploads, application constants and eligible style/knowledge. Read configured knowledge as authoritative document records; omit an untraceable usage note without unnecessarily discarding the authorized document. Missing explicit sources or target are actionable failures. An unavailable implicit source can be omitted with neutral application wording. Do not claim that old working/learned memory, generated settings or assistant summaries are source-free. They remain useful privately and are absent from the shared writer unless represented by a genuinely eligible, independently established source.

workspace.ask keeps the typed instruction separate from document identity/version/selection. The server resolves and guards the selected source bytes once. Display-only title/excerpt text cannot enter ordinary user text or later history through a second path. Legacy app-inserted user-role quotes do not become direct contributions retroactively.

Full exact approval text belongs in a current-authorized review endpoint, not replayable chat summaries. Model history receives fixed operation/status metadata and opaque IDs. Legacy stored approval summaries are preserved but excluded from replay. Known revoked source-derived messages/results are withheld from model admission. Do not rebuild all historical memory or require adapters for every private capability before the safe shared slice works.

For new content-bearing private outputs, capture known source obligations and preserve explicit uncertainty when actual inputs are not fully attributable. Unknown never means no restrictions. Private artifacts, generated settings/notes and managed outbound text must inherit their actual server-owned generation/seed classification. Keep input/result exposure semantics with the existing capability definition/registration rather than another growing capability-name exemption list. Unsupported private results may remain private-only; they cannot acquire sharing eligibility through a raw body or confirmation.

## Versions, current permissions and finite work

Separate two questions. The immutable policy of the source version records the obligations of the bytes actually observed. Current source resource ACL checks establish current existence, case membership, folder ancestors and office/case consistency. A page-source guard must not recursively load the source page's latest content policy. This permits A/B/A and simultaneous A2-from-B1/B2-from-A1 without cycles while retaining revocation of base access and historical source obligations.

Flatten and deduplicate obligations when observing a source version. Retain observed protected ancestors so moving a source or copy cannot erase them. Later unrelated content added to the source does not retroactively restrict older derivatives. Ordinary edits/restores preserve the baseline and incorporated historical obligations. No text similarity, classifier or model assertion removes them. Existing owner disclosure authority for an original direct contribution remains; it never releases another person's or inherited protected obligations.

Use request/transaction-local bulk guard evaluation with explicit work/input bounds and no positive cross-request ACL cache. Do not truncate restrictions to fit a limit. Treat proposed numeric caps as execution limits to verify against real use, not measured requirements. Keep an iterative visited-once compatibility reader for 0075 dependencies. Missing/malformed/inconsistent source references fail closed; a cycle alone is handled as a finite union, not permanent inability to read otherwise authorized content.

## Transaction ownership and access changes

Use one withTransaction and its Transaction.prepare reader/writer for successful content changes. Existing database.batch/updateArtifact own a separate transaction and cannot be nested to achieve atomicity. Stage generation/rendering outside locks, then reauthorize and commit content, exact version policy, required history, approval consumption and recoverable result pointer together. Proposal creation and its policy extension also commit together. Invalid edits, cancellation, failed CAS and exceptions must leave unchanged content and classification unchanged. Preserve sampled artifact history behavior.

Transaction-bound checks must not escape to global database calls. Retain current session revocation/global logout semantics. Where atomic authorization against session or ACL changes is claimed, explicitly establish the ordering with the real session/ACL mutation path and prove it; a comment or a lock used only by the new service is insufficient. Do not redesign Better Auth or invent an unrelated session subsystem.

Candidate 3's shared/exclusive transaction-scoped ACL gates are acceptable only with an inventory and adoption of every relevant case membership, association, folder access/parent/delete, source move/delete and Lume-policy writer. Acquire affected keys in deterministic order, then target rows; keep network/model/render work outside transactions. Reauthorize again after waiting and immediately before privileged effects. The immutable shape removes graph write skew; locks order actual ACL mutations, not page derivation graphs. Keep existing guest capability boundaries and original agent invocation across a human approval click.

Review binds bytes, destination, operation and versions. Do not invalidate a still-authorized exact proposal merely because the destination's participant roster/fingerprint changed. Current effective-access intersection remains authoritative. A changed payload or operation needs a new review.

## Managed copies and exits

Canonical exact-version classification applies at page publication, private archive, model input, export and actual managed delivery. No raw missing-provenance shortcut may classify a model artifact as human. A permitted draft can be archived in its owner's Library/private folder with its owner fence and known obligations retained. A later move/folder broadening can change its location while its effective audience stays restricted; no additional folder-administration approval is necessary.

Cover the demonstrated production paths, including private/background artifact writers, Vault copy/version/list/search/chunk/download, pinned personal-chat shares and recipient reads, direct portal artifact publication and reads, actual render templates, and generated/copied connector file/text payloads at dispatch. Do not protect only the initial SaveForm while a later copy grants access. Reuse existing domain services, exact connector confirmations, dispatch/reconciliation and resource access rules.

Pin the actual selected/default template version and bytes used by a render, and include its policy and digest in the rendered-copy identity. PDFcn text rendering and template-based portal PDF are different paths; inspect actual inputs instead of assuming policy from file extension. A selected inaccessible template must not silently fall back. Rendering/object storage are staged outside the DB; a reachable file/version and its policy are bound in the final transaction. A retry reuses exact input/bytes and rechecks access.

Enforce application-known restrictions on both file attachments and generated raw subject/body/text. Unsupported protected external audiences must fail before dispatch. Preserve normal direct human/source-independent sends and existing connector confirmations. Do not add a remote ownership/redistribution proof platform or treat ordinary connector access as universal permission to disclose protected case sources. Reuse existing source/audience facts where they actually establish a same-audience operation; do not fabricate that equivalence. If bounded recomposition is needed, reuse the same authenticated-input boundary and existing confirmation once.

Downloads, manual copy/paste, screenshots and unrecognizable reuploads cannot carry enforceable future ACL outside the app. State that limit honestly; do not expand this repair into a generic DLP system. Recognized application-managed derivations must retain policy.

## Migration and compatibility

Use the next unused additive migration after 0075, which already ran only in the disposable verification instance. Preserve content, version history, approvals, origin metadata and private memory. Do not edit an applied migration or run setup against the developer database.

Retain the documented legacy human-artifact convention when no agent/run/conversation/source-reference evidence exists, while preserving every known restriction. This is a historical ownership assumption, not proof of all bytes' authorship. Untracked legacy/current model output remains explicitly uncertain and cannot gain sharing eligibility from a failed edit or a cleaner conversation. A present 0075 complete=true row cannot override contradictory origin evidence.

Preserve existing shared-page reads through bounded compatibility evaluation of current base ACL and all recoverable source restrictions. Do not quarantine every old page, create a cutover principal roster, or retroactively certify source completeness. Unknown old model text is not eligible input for a new automated shared derivative; human preservation/in-place editing must retain its uncertainty and known restrictions. Distinguish this compatibility use from certifying a new output. Migration 0075 is unshipped branch work, not an established production corpus requiring a new historical-sharing program.

Preserve pending/consumed approvals and exact stored outcomes. Revalidate a pending operation under canonical classification; if its inputs cannot support the requested new share, retain it and prepare a fresh exact proposal from permitted inputs. Existing private drafts can remain privately readable/archivable under current known access. Recovery uses a new typed request and selected accessible sources in the same conversation, without feeding the unsafe old title/body/summary to the shared writer or offering a false source-certification checkbox.

## Rejected additions

Reject dynamic tool infrastructure for the shared writer, a per-fact memory overhaul, a universal event/content platform, wholesale historical human-draft quarantine, cutover audience registries, a history text row for every autosave, mandatory audience-fingerprint invalidation and prerequisite deferred binding triggers. Keep the sole writer, immutable bindings/uniqueness, fail-closed new-version reads and production-entry-point regression coverage. A trigger or larger mechanism needs an identified gap that the chosen owner cannot contain.

## Verification and implementation sequence

Deliver the first real vertical slice, then migrate the demonstrated producers/exits before accepting the unit. Do not stop after a scaffold or a passing helper test.

1. Add canonical version policy, authenticated submission/seed binding and the provider-boundary fixture. Preserve legacy behavior as stated.
2. Exercise real scoped chat admission with private memory/personalization present, tool-free generation, exact authorized preview, atomic confirmation, eligible follow-up and retry. Prove excluded sentinels are absent from the actual provider request.
3. Migrate private/background writers and managed copy/text exits. Verify seed lineage, template pins and current source/recipient access at real production entry points.
4. Run real PostgreSQL rollback/CAS/approval replay and simultaneous A/B/A/source-revocation tests, finite traversal/query-budget assertions, private archive and later move/share/portal/connector denial tests. Cancellation/stale operations cannot poison or cleanse a draft.
5. Integrate ask/review controls with the completed editor repair, then affected desktop/mobile/keyboard e2e and manual T3 recording. Preserve the original frozen send/regeneration and late-result behavior.

Scoped checks belong to the implementation unit; parent owns full root checks/build and final review. Provider stubs prove the application boundary, not live model quality. Record exact evidence levels and any unavailable live-model smoke test honestly. The current contract requires no further design arena or human checkpoint; the user already authorized implementation.
