## Findings

Read-only review. The paths below demonstrate defects through static call-chain analysis; I did not run reproductions, tests, migrations, or browser actions.

### 1. [critical] Artifact-list results lose their known source restrictions

**Location**: `apps/web/src/lib/case-pages/provenance.ts:67–90`; `apps/web/src/lib/application/artifacts-service.ts:76–103`

**Finding**: Artifact exposure is recorded from `input.artifactId`, rather than the artifact versions actually returned. `k5_artifacts_list` has no such input, so its returned titles contribute only source-free uncertainty. `k5_artifacts_list_versions` contributes the current artifact’s policy instead of the policies of the historical versions it returns.

**Evidence**:

1. `listArtifacts` returns authorized artifact titles, IDs, and versions, including artifacts outside the current conversation.
2. `runCapability` passes that result through `recordToolProvenance` before returning it to the private model (`agent-tools/index.ts:282–286`).
3. For a list call, the artifact branch is skipped. `complete=false` adds `uncertainPolicy(userId)` with no source guards.
4. The model can repeat a protected title in its answer or create a derivative private artifact. The answer uses `privateGenerationPolicy` (`chat-turn.ts:453`); artifact creation uses the same captured policies (`documents/service.ts:35–45`).
5. After the original source’s ACL is revoked, the derivative lacks that obligation. `chatPromptMessages` checks the persisted message policy, so the copied title remains eligible for private-history replay (`chat-prompt.ts:24–37`).

The owner fence prevents broader sharing, but it does not preserve the known revocation restriction. Historical-version lists have the equivalent problem when historical and current versions have different guards.

**Suggestion**: Record policy from each returned artifact/version. Centralize extraction of returned resource observations instead of treating an input ID as proof of every byte exposed.

### 2. [critical] Gmail seeds fabricate a common audience from different messages

**Location**: `apps/web/src/lib/google/gmail/insights.ts:236–275`; `apps/web/src/lib/google/gmail/service.ts:166–170`

**Finding**: A generated reply uses several messages as sources, but its permitted recipients are the **union** of every participant anywhere in the thread. That does not establish that each participant could read every source message.

**Evidence**:

1. `threadInsight` sends the last six message bodies to the reply writer.
2. Its seed records all thread message IDs and the union of every `From`, `To`, and `Cc` address.
3. Consider an earlier message between A, B, and C, followed by a private reply between A and B containing a confidential fact. Both appear in A’s thread.
4. The generated reply can contain that fact. A uses the offered reply and adds C to CC through the existing editor (`gmail-panel.tsx:203–210`, `297–302`, `484`).
5. The seed check accepts C because C appeared in the earlier message.
6. The seed policy has no source guards. Both external-delivery checks accept it, and `sendMail` dispatches the MIME payload to Gmail (`gmail/service.ts:190–191`, `301–307`).

This violates the synthesis’s explicit requirement to reuse actual same-audience facts without fabricating equivalence. It concerns an application-managed generated suggestion, not outside-app copying.

**Suggestion**: Bind suggestions to the audiences of the messages actually supplied to generation. A broader recipient set requires bounded recomposition using sources authorized for that audience.

### 3. [critical] A new Vault version can freeze the previous version’s text

**Location**: `apps/web/src/lib/content-policy.ts:147–160`; `apps/web/src/lib/application/vault-service.ts:267–282`

**Finding**: `observeDocument` pairs the active version’s number/hash with document-level chunks that can still belong to the previous version.

**Evidence**:

1. `addDocumentVersion` activates version 2 and sets the document to `queued`. It leaves version 1’s chunks intact.
2. The ingestion worker replaces those chunks later, after extraction (`vault.ts:581–606`). Drive replacement has the same queued interval (`google/drive/import.ts:241–248`).
3. Before ingestion finishes, a person sends a shared-writing request selecting this document.
4. `recordPersonRequest` calls `observeDocument` (`shared-writing.ts:31`).
5. The observer selects active version 2 without checking document status, then reads chunks solely by `document_id`.
6. The submission durably stores version 1’s text with a version 2 observation. Because the old text is nonempty, the writer’s readiness check accepts it (`shared-writing.ts:134–139`).

A changed deadline or amount can therefore be generated from obsolete content while the source observation identifies the replacement file. Subsequent successful ingestion does not repair the frozen submission.

**Suggestion**: Reject observations until the active version’s extraction is ready, or bind extracted chunks to their actual immutable version. Test the real replacement operation followed immediately by chat submission.

### 4. [critical] Calendar sharing generates different content after confirmation

**Location**: `apps/web/src/lib/agent-tools/index.ts:277–282`; `apps/web/src/lib/google/calendar/service.ts:520–530`

**Finding**: `k5_calendar_share_event` confirms and consumes the planner’s payload before invoking the fresh writer. The shared title, notes, and location can differ from what the person approved.

**Evidence**:

1. Calendar sharing is centrally confirmed (`approvals-service.ts:178–183`).
2. The first call stores the raw tool input as the proposal and stops before executing `shareEvent`.
3. On confirmation, `decideAgentApproval` replays that stored input with the original invocation (`agent-approvals.ts:210–213`).
4. The central gate consumes approval before calling the executor (`approvals-service.ts:160–162`; `agent-tools/index.ts:280–282`).
5. Only then does `shareEvent` call `outboundText`, which calls `prepareSharedWriting` and potentially the provider.
6. It replaces the approved title, notes, and location with the new output, then writes those fields to `personal_event_share`.

Thus approval of payload A authorizes publication of generated payload B without reviewing B. Generation failure also leaves approval consumed despite no shared event being written.

**Suggestion**: Prepare the exact output before offering confirmation. Bind that output and policy to the existing approval, then commit those exact bytes and approval outcome together.

### 5. [critical] Shared submissions drop supported audio and DOCX-image content

**Location**: `apps/web/src/app/api/chat/route.ts:64–79`; `apps/web/src/lib/documents/shared-writing.ts:50–55`

**Finding**: The authenticated submission captures less human-supplied material than the private chat receives.

**Evidence**:

- **Inline audio ingress:** `chatRequestSchema` accepts inline audio attachments. For models without audio support, the route produces `spoken`, but calls `recordPersonRequest` with only `text`. The stored private message subsequently includes the transcript. For models with audio support, the private model receives the raw attachment, which likewise has no representation in the shared submission. An instruction carried by that audio is unavailable to the tool-free writer.
- **DOCX screenshots:** Upload accepts image-only DOCX files specifically because their embedded pictures are readable by the private model (`chat-attachments.ts:47–49`; `chat-prompt.ts:99–106`). Shared submission creates image inputs only when the attachment’s MIME type starts with `image/`. DOCX pictures disappear. An image-only DOCX then fails `NOT_READY` permanently; a mixed document silently loses its image facts.

The UI voice recorder that transcribes into composer text is unaffected; the audio finding concerns the separate supported inline request modality.

**Suggestion**: Build one canonical authenticated-input representation covering transcripts and pinned DOCX pictures, then use it for shared preparation. Preserve actual human input without admitting private-model paraphrases.

### 6. [warning] Eligible follow-ups lose the original task’s direct attachments

**Location**: `apps/web/src/lib/documents/shared-writing.ts:125–139`

**Finding**: Continuation adds the previous generated output and policy, but omits the original authenticated request and source snapshots. It consequently cannot use original direct attachments that were not repeated in the follow-up.

**Evidence**:

1. A person attaches a contract and requests an initial page.
2. The first generated proposal omits a particular deadline.
3. The person follows up with “inclua também o prazo do contrato anexado.”
4. The UI sends attachment IDs from the current message; pending files are consumed after their original send (`agent-chat.tsx:598–601`, `645–648`).
5. `recordPersonRequest` correctly links the eligible previous attempt.
6. Preparation loads only `previous.output` and `previous.content_policy`. Its provider input contains the new request, current inputs, and previous proposal text.
7. The contract’s original frozen content and pictures are absent. Carrying its policy preserves restrictions but cannot recover the missing facts.

This falls short of the accepted continuation contract, which includes original selections. The existing “deixe mais breve” case does not exercise this failure.

**Suggestion**: Retain the bounded shared task’s original authenticated instructions and immutable inputs, rechecking their current authorization on continuation. Do not recover them from private history.

### 7. [critical] Session-expiry checks use transaction-start time after lock waits

**Location**: `apps/web/src/lib/application/context.ts:54–58`; `apps/web/src/lib/documents/service.ts:14–19`

**Finding**: Transaction-bound session checks compare expiry against PostgreSQL’s transaction-stable `CURRENT_TIMESTAMP`. A session that expires while the transaction waits remains accepted by subsequent checks.

**Evidence**:

1. `documentTransaction` starts a transaction and can wait for the schema-wide advisory gate.
2. Page confirmation can additionally wait on the approval row (`case-pages/service.ts:193–202`).
3. Suppose the session is valid at transaction start but expires during either wait.
4. The later `assertCapabilityAllowed(..., tx)` still compares expiry against the earlier transaction timestamp.
5. The final checks immediately before page mutation use the same timestamp (`case-pages/service.ts:118`, `123`), so the transaction can commit after expiry.

The shared/exclusive gate orders explicit ACL and session mutations. It cannot order the passage of time. Repeating this check within the transaction does not make its clock current.

**Suggestion**: Use a current wall-clock comparison for expiry after waits and before effects. Verify it by holding an actual lock until natural session expiration, without updating or deleting the session row.

## Plausible concerns — not counted as findings

- `gmail/service.ts:158–160` infers an omitted seed only from exact body digest or reply message ID. Editing a seeded body and removing reply identity can defeat that inference. I did not establish whether an existing application flow performs this transformation while retaining a recognizable managed derivation; therefore I am not treating it as a demonstrated bypass.
- The generation reservation permits one destination per submission/generation/operation (`shared-writing.ts:110–120`). Multiple same-operation destinations in one human request will conflict. Whether that is a product defect depends on the intended supported multiplicity; the selected reservation contract alone does not settle it.

## Evidence gaps

- I inspected the saved final policy result: `source-test-1791344311665` passed **10/10**. I did not rerun it. That result does not demonstrate the edge cases above.
- Saved provider-wire tests establish input isolation for their fixtures. They do not establish live model quality or cover every accepted modality.
- There is **no final all-green combined browser run**. The unexplained RSC navigation timeouts remain unresolved evidence, even though affected suites and manual flows later passed. I found no basis to assign an environmental or production root cause.
- I did not dynamically reproduce lock timing, external dispatch, the queued-version interval, or the new defect routes. The findings identify concrete production call chains and missing invariants.

## Exact inspected paths

Paths below are relative to `apps/web`. Inspection included relevant source sections, callers, diffs, and searches; this is **not** a claim that every line of every listed file was audited.

**Policy, writers, and admission:**

```text
db/postgres/0076_content_policy.sql
db/postgres/0077_content_policy_validation.sql
src/lib/content-policy.ts
src/lib/documents/service.ts
src/lib/documents/shared-writing.ts
src/lib/case-pages/contracts.ts
src/lib/case-pages/provenance.ts
src/lib/case-pages/service.ts
src/app/api/chat/route.ts
src/app/api/artifacts/[id]/route.ts
src/lib/ai-store.ts
src/lib/ai-runtime.ts
src/lib/chat-prompt.ts
src/lib/chat-turn.ts
src/lib/agent-guard.ts
src/lib/agent-tools/index.ts
src/lib/agent-instructions.ts
src/lib/agent-knowledge.ts
src/lib/agent-profile.ts
src/lib/document-workflows.ts
src/lib/application/context.ts
src/lib/application/artifacts-service.ts
src/lib/application/approvals-service.ts
src/lib/application/agent-approvals.ts
src/lib/application/agent-settings-service.ts
src/lib/application/knowledge-service.ts
src/lib/application/runs-service.ts
src/lib/application/workspace-agent-service.ts
src/lib/capabilities/contracts.ts
src/lib/capabilities/research.ts
src/lib/capabilities/workspace.ts
src/lib/knowledge/retrieval.ts
src/lib/research/case-assessment.ts
src/lib/research/case-profile.ts
src/lib/research/case-material.ts
src/lib/typesafe/verification.ts
src/lib/collaboration/access.ts
```

**Copies, exits, and UI:**

```text
src/app/api/artifacts/[id]/export/route.ts
src/lib/application/vault-service.ts
src/lib/vault.ts
src/lib/artifact-file.ts
src/lib/conversation-artifacts.ts
src/lib/client-portal/service.ts
src/lib/honorarios/charges.ts
src/lib/personal-chat/shares.ts
src/lib/personal-chat/service.ts
src/lib/personal-chat/email-worker.ts
src/lib/capabilities/google.ts
src/lib/capabilities/whatsapp.ts
src/lib/google/operations.ts
src/lib/google/drive/import.ts
src/lib/google/drive/service.ts
src/lib/google/gmail/service.ts
src/lib/google/gmail/insights.ts
src/lib/google/gmail/insights-contracts.ts
src/lib/google/calendar/service.ts
src/lib/whatsapp/send.ts
src/app/api/approvals/[id]/page/route.ts
src/components/document/page-approval-review.tsx
src/components/agent-chat.tsx
src/components/google/email-smart.tsx
src/components/google/gmail-panel.tsx
src/components/lume/lume-workspace.tsx
```

**Tests read fully or through selected bodies:**

```text
tests/shared-writing-fixture.ts
tests/document-writes.ts
tests/chat-source-boundary.test.ts
tests/content-policy.test.ts
tests/content-exits.test.ts
tests/case-pages.test.ts
tests/agent-capabilities.test.ts
tests/google-email-insights.test.ts
tests/run-model-plan.test.ts
tests/whatsapp-send.test.ts
e2e/source-policy.e2e.ts
```

**Tests inspected primarily through names/searches; bodies remain substantially unreviewed:**

```text
tests/ai-store.test.ts
tests/agent-files-review.test.ts
tests/agent-knowledge.test.ts
tests/agent-profile.test.ts
tests/conversation-artifacts.test.ts
tests/personal-chat.test.ts
tests/research-case.test.ts
e2e/workspace.e2e.ts
```

**Additional callers inspected:**

```text
src/lib/chat-scope-server.ts
src/lib/chat-contract.ts
src/lib/ai-providers.ts
src/lib/agent-memory.ts
src/lib/agent-history.ts
src/lib/chat-attachments.ts
src/lib/google/gmail/insight-cache.ts
src/lib/collaboration/service.ts
src/lib/db/postgres.ts
src/lib/honcho-memory.ts
src/lib/session.ts
```

**Repository documentation and audit artifacts inspected, fully or in relevant sections:**

```text
README.md
apps/web/AGENTS.md
apps/web/README.md
apps/web/.env.example
apps/web/DESIGN.md
.audit/lume-provenance-files.json
.audit/lume-provenance-synthesis.md
.audit/lume-architecture-synthesis.md
.audit/lume-pages-review-verdict.md
.audit/lume-provenance-how.md
.audit/lume-editor-repair.md
.audit/lume-provenance-implementation.md
.audit/lume-provenance-comments-review.md
apps/web/.e2e/verify/20261006T234247-d88728/source-handoff-1791344486879/checks.json
```

## Unreviewed coverage

This review does not establish complete correctness of every unchanged caller, every SQL lock interleaving, all connector reconciliation states, or desktop/mobile/keyboard behavior. Browser traces and screenshots were not exhaustively inspected. The separately accepted editor repair was not independently re-audited in full. The later task/fees/activity/Lume-switch unit was excluded as instructed.
