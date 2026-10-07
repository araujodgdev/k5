## Findings

These findings follow concrete production paths in the current tree. They are established by code inspection; I did not execute reproductions, tests, migrations, or writes.

### 1. [critical] Annex generation removes the source PDF’s restrictions

**Location**: `apps/web/src/lib/annexes.ts:129`, `:143`, `:151`; `apps/web/src/lib/vault.ts:429`

**Finding**: Splitting a protected PDF creates publicly located copies with a fresh, unrestricted person policy.

**Evidence**:

1. `POST /api/vault/cases/[id]/annexes/files` reaches `createAnnexFiles` and `generateAnnexes`.
2. `scannedPdf` checks the caller’s current access and reads the PDF. It captures neither its exact-version policy nor its protected ancestors.
3. `generateAnnexes` creates a root folder. `createVaultFolder` defaults to `visibility: "public"` at `vault.ts:261`.
4. Each output calls `createVaultDocument` without `policy` or `origin`.
5. The canonical writer substitutes `personPolicy('', '')`. Its missing-policy rejection applies only to `artifact_*` origins, which this caller does not provide.

For example, B can read A’s restricted folder, while C cannot. B splits its scan; C can list and download the resulting PDFs from the new public folder. Gmail’s actual attachment preparation then reads their empty-guard policies and accepts external delivery (`google/gmail/service.ts:119`). This is an application-managed derivation, within the repair’s explicit boundary.

The callback at `annexes.ts:147` rechecks capability access, not access to the original scan or its policy.

**Suggestion**: Make the canonical Vault creation boundary require an explicit trusted policy and context. Direct uploads can construct person policy at their authenticated ingress; managed transformations must supply the observed source policy and ancestry. The current optional contract makes omitted callers silently erase restrictions.

### 2. [critical] A Vault move can erase a folder restriction committed before the move

**Location**: `apps/web/src/lib/application/vault-service.ts:195–215`; `apps/web/src/lib/vault.ts:327–336`; `apps/web/db/postgres/0076_content_policy.sql:217`

**Finding**: Move authorization occurs before the SQL statement acquires the exclusive ACL gate. There is no authorization check after waiting.

**Evidence**:

`PATCH /api/vault/documents/[id]` reaches `updateDocument`. It reads the document, validates the destination, and calls `assertVaultDocumentMove` outside the mutation transaction. The final `UPDATE` checks only document ID, office ID, and deletion state.

A concrete ordering is:

1. B validates moving a directly uploaded document out of A’s currently public folder F.
2. A changes F to restricted/private and commits.
3. B’s `UPDATE folder_id=NULL` acquires the trigger’s gate afterward and executes using its earlier authorization.
4. The document appears at the public root. Its direct-upload policy does not retain F, so other participants can read it.

The trigger serializes the writes, but it does not revalidate the authorization that preceded it. `getDocument` afterward succeeds because the move has already removed the restrictive location.

**Suggestion**: Acquire the exclusive gate explicitly before reading the current document and both folder paths; reauthorize session, membership, destination, and move authority on that same connection before updating. A shared-gate transaction that later upgrades through this trigger would introduce a separate lock-order problem.

### 3. [critical] Managed archival discards the session before its final commit

**Location**: `apps/web/src/lib/application/vault-service.ts:395–415`, `:364`; `apps/web/src/lib/vault.ts:423–431`

**Finding**: A document archival operation can commit after global logout has completed.

**Evidence**:

The actual agent capability `k5_vault_save_artifact` receives a context containing `sessionId`; `runCapability` validates it at `agent-tools/index.ts:267` and `:275`.

`saveArtifactToVault` then renders the document and stages storage outside the transaction. `copyIntoVault` passes only scalar office/user IDs to `createVaultDocument`. That function creates a new context `{ officeId, userId }` for its final transaction.

If global logout deletes the session during rendering, the session trigger’s exclusive gate can commit before archival acquires its shared gate. The final transaction checks membership, case/folder access, and source policy, but never checks the deleted session. It still inserts the copy.

`assertPolicyAccess` does not provide a session check (`content-policy.ts:51`).

**Suggestion**: Carry the original trusted context through the Vault writer and run `assertCapabilityAllowed` inside the final gated transaction. Preserve cancellation context through the same boundary.

### 4. [critical] Edited Gmail suggestions can lose their seed by omitting both identifiers

**Location**: `apps/web/src/lib/google/gmail/service.ts:158–170`; `apps/web/src/lib/capabilities/google.ts:118–121`

**Finding**: The server-owned suggestion restriction remains dependent on optional client metadata.

**Evidence**:

`threadInsight` records a generated seed with its connection generation, source messages, and permitted recipients at `google/gmail/insights.ts:268–275`. The offered reply opens the composer with that seed (`gmail-panel.tsx:209`).

The ordinary authenticated Google HTTP route invokes `runCapability` without an agent invocation. Consequently, `outboundText` initially classifies the submitted subject/body as person content.

The fallback seed lookup matches only:

- the original body digest; or
- a supplied `replyToMessageId`.

Take an offered reply, edit its body, and submit the composer request with `seedId` omitted, `replyToMessageId: null`, no draft ID, and an outside recipient. Both lookup conditions fail. The scope checks are skipped, and `assertExternalDelivery` accepts the fresh person policy. The actual Gmail dispatch at `service.ts:302–307` checks that same unrestricted policy.

The test at `tests/google-email-insights.test.ts:228` omits `seedId` while retaining `replyToMessageId`; it does not cover this route.

The reverse problem also exists: matching by message ID attaches a suggestion’s restrictions to independently typed replies merely because a suggestion was previously generated for that message.

**Suggestion**: Bind the offered prefill to a server-owned compose/draft identity whose baseline survives edits. Do not use optional provenance fields or message-wide lookup as the distinction between seeded and independently typed content.

### 5. [critical] Vault observations label old extracted text as the new active version

**Location**: `apps/web/src/lib/content-policy.ts:149–160`; `apps/web/src/lib/application/vault-service.ts:276–281`

**Finding**: The immutable submission can freeze text from version 1 while claiming it observed version 2.

**Evidence**:

`addDocumentVersion` activates the new bytes and marks the document queued, but leaves the existing chunks intact. The ingestion worker deletes those chunks only after extraction finishes (`vault.ts:590–604`).

`observeDocument` reads the active version and SHA, then fetches chunks solely by document ID. It checks neither processing status nor an extraction/version binding.

Therefore:

1. D1 is ready with “valor: 100”.
2. D2 containing “valor: 200” is activated and queued.
3. A chat submission selecting D calls `recordPersonRequest` → `observeDocument`.
4. Its immutable input contains “valor: 100”, while the observation identifies version 2 and D2’s SHA.
5. `prepareSharedWriting` accepts the nonempty text and sends it to the actual structured writer.

Later ingestion does not repair the already persisted submission. `getKnowledgeSource` also uses this observation and then reads the same unversioned chunks (`application/knowledge-service.ts:33–44`).

**Suggestion**: Bind extracted text to the exact observed file version. At minimum, reject snapshots until extraction for that active version is ready; also ensure ingestion commits cannot install text from an obsolete lease/version.

### 6. [critical] Supported authenticated request modalities do not reach the shared writer

**Location**: `apps/web/src/lib/documents/shared-writing.ts:50–55`, `:134`; `apps/web/src/app/api/chat/route.ts:64–79`

**Finding**: The private assistant and the shared writer receive materially different human inputs.

**Evidence**:

**DOCX images — current UI path:** Upload → `/api/chat/attachments` → `createChatAttachment`. A Word file containing screenshots and no text is explicitly accepted at `chat-attachments.ts:47–49`. The private chat extracts and sends its embedded images (`chat-prompt.ts:99–106`).

`recordPersonRequest` captures image bytes only when the attachment’s top-level media type starts with `image/`. For DOCX, it records empty extracted text and no images. `prepareSharedWriting` consequently throws `NOT_READY`. Waiting cannot help: this chat attachment has already completed extraction, and its immutable submission remains empty. A normal supported upload can be understood privately but cannot produce the requested shared page.

**Inline audio — supported HTTP path:** The chat route computes `spoken`, but calls `recordPersonRequest` with only the original `text`. It appends the transcript to private history afterward. When the chat model accepts audio directly, the raw audio is likewise sent only to the private worker. The shared writer receives neither representation.

The current voice-recorder UI transcribes into the composer before sending, so that particular UI path is not implicated.

**Suggestion**: Normalize and persist the authenticated multimodal request once, including transcripts and embedded document images, then use that immutable representation for shared writing and regeneration.

### 7. [warning] Every later request in the same case inherits the previous proposal

**Location**: `apps/web/src/lib/documents/shared-writing.ts:57–61`, `:126–132`

**Finding**: The continuation selection does not distinguish a follow-up from a new independent task.

**Evidence**:

`recordPersonRequest` selects the latest ready attempt with a pending, approved, or consumed approval. For a create-page attempt, matching the conversation and case is enough to assign `continuation_id`. There is no task identity or explicit continuation signal.

After a proposal derived from restricted source S, revoke access to S. Now submit a fresh, source-independent request in the same conversation and case. Its own submission is eligible, but `prepareSharedWriting` unconditionally loads the previous proposal and fails its policy-access check. The new request cannot create a page.

Without revocation, the previous proposal’s content and restrictions are still injected into the unrelated task. The existing shortening test covers the desired follow-up, not this independent-task case.

**Suggestion**: Resolve continuation against an explicitly selected shared task/proposal. Provide a fresh-task path within the existing conversation rather than treating every same-case send as continuation.

### 8. [warning] Consumed private-edit replay still authorizes the latest artifact first

**Location**: `apps/web/src/lib/application/artifacts-service.ts:64`; `apps/web/src/lib/documents/service.ts:71–74`

**Finding**: The historical replay implementation is bypassed by a current-version authorization check.

**Evidence**:

`updatePrivateDocument` correctly returns the stored consumed result after checking that result version’s historical policy. However, `editArtifact` first calls `requireArtifact`, which calls `ownedArtifact` and validates the latest artifact policy.

A concrete sequence:

1. An approved edit commits A2 without source S.
2. A later edit creates A3 incorporating S.
3. Access to S is revoked.
4. Reconfirm the consumed A2 edit through `decideAgentApproval` → `runCapability` → `editArtifact`.

The current A3 policy denies access before the consumed-result branch is reached, although A2’s immutable policy remains authorized. The confirmation becomes “failed” rather than returning its previously committed result.

**Suggestion**: Resolve and authorize exact consumed approval results before loading current content. Retain current intrinsic ownership/session checks without importing unrelated later content obligations.

## Plausible concerns and evidence gaps

- I have no additional standalone speculative finding. The issues above have complete producer/consumer paths; their concurrent orderings still need controlled reproductions.
- I inspected the final policy output: `source-test-1791344311665/output.log` reports **10 passed, 0 failed**. That does not cover annex laundering, post-revocation moves/archival, edited suggestions omitting both identifiers, or DOCX-image ingress.
- I inspected the browser JSON summaries and failure output. `source-e2e-1791342994695` reports **39 passed, 2 failed**, including publication and shell URL assertions. `source-e2e-1791343977727` reports its one selected review test passed.
- I did not independently inspect the trace ZIPs, videos, or screenshots. The RSC-navigation explanation remains an unresolved diagnostic claim, not a root cause established by this review. There is no final combined all-green browser result.
- No live-model quality verification was performed.
- I did not establish a separate deadlock finding. Trigger existence and the schema-wide gate are not themselves findings; finding 2 concerns authorization occurring outside their serialization boundary.
- No writes, state-changing git commands, tests, database operations, app launches, or subdelegation were performed.

## Exact inspected paths and coverage

Paths below are relative to `apps/web`. **F** means whole-file inspection; **P** means targeted sections/diffs and caller tracing; **T** means test declarations and policy-related coverage inspection, not a complete test-body review. P/T entries remain unreviewed outside those portions.

```text
F db/postgres/0076_content_policy.sql
F db/postgres/0077_content_policy_validation.sql
F src/lib/content-policy.ts
F src/lib/documents/service.ts
F src/lib/documents/shared-writing.ts
F src/lib/case-pages/contracts.ts
F src/lib/case-pages/provenance.ts
F src/lib/case-pages/service.ts

F src/app/api/chat/route.ts
F src/app/api/artifacts/[id]/route.ts
F src/lib/ai-store.ts
F src/lib/ai-runtime.ts
F src/lib/chat-prompt.ts
F src/lib/chat-turn.ts
F src/lib/agent-guard.ts
P src/lib/agent-tools/index.ts
F src/lib/agent-instructions.ts
F src/lib/agent-knowledge.ts
F src/lib/agent-profile.ts
P src/lib/document-workflows.ts
F src/lib/application/context.ts
F src/lib/application/artifacts-service.ts
F src/lib/application/approvals-service.ts
F src/lib/application/agent-approvals.ts
F src/lib/application/agent-settings-service.ts
F src/lib/application/knowledge-service.ts
F src/lib/application/runs-service.ts
F src/lib/application/workspace-agent-service.ts
P src/lib/capabilities/contracts.ts
F src/lib/capabilities/research.ts
F src/lib/capabilities/workspace.ts
F src/lib/knowledge/retrieval.ts
P src/lib/research/case-assessment.ts
F src/lib/research/case-profile.ts
F src/lib/research/case-material.ts
P src/lib/typesafe/verification.ts
F src/lib/collaboration/access.ts

F src/app/api/artifacts/[id]/export/route.ts
P src/lib/application/vault-service.ts
P src/lib/vault.ts
F src/lib/artifact-file.ts
F src/lib/conversation-artifacts.ts
F src/lib/client-portal/service.ts
P src/lib/honorarios/charges.ts
F src/lib/personal-chat/shares.ts
P src/lib/personal-chat/service.ts
F src/lib/personal-chat/email-worker.ts
P src/lib/capabilities/google.ts
F src/lib/capabilities/whatsapp.ts
P src/lib/google/operations.ts
P src/lib/google/drive/import.ts
P src/lib/google/drive/service.ts
P src/lib/google/gmail/service.ts
P src/lib/google/gmail/insights.ts
F src/lib/google/gmail/insights-contracts.ts
P src/lib/google/calendar/service.ts
F src/lib/whatsapp/send.ts

F src/app/api/approvals/[id]/page/route.ts
F src/components/document/page-approval-review.tsx
P src/components/agent-chat.tsx
F src/components/google/email-smart.tsx
P src/components/google/gmail-panel.tsx
P src/components/lume/lume-workspace.tsx

F tests/shared-writing-fixture.ts
F tests/document-writes.ts
F tests/chat-source-boundary.test.ts
P tests/content-policy.test.ts
F tests/content-exits.test.ts
F tests/case-pages.test.ts
T tests/ai-store.test.ts
T tests/agent-capabilities.test.ts
T tests/agent-files-review.test.ts
T tests/agent-knowledge.test.ts
T tests/agent-profile.test.ts
T tests/conversation-artifacts.test.ts
P tests/google-email-insights.test.ts
T tests/personal-chat.test.ts
T tests/run-model-plan.test.ts
T tests/whatsapp-send.test.ts
T tests/research-case.test.ts
P e2e/workspace.e2e.ts
F e2e/source-policy.e2e.ts
```

Additional production paths inspected:

```text
F src/lib/annexes.ts
F src/lib/application/annexes-service.ts
F src/lib/capability-route.ts
F src/lib/chat-contract.ts
F src/lib/chat-scope-server.ts
F src/lib/chat-attachments.ts
F src/lib/session.ts
F src/lib/collaboration/capability-access.ts
F src/lib/google/routes.ts
P src/lib/collaboration/service.ts
P src/lib/application/ui-service.ts
P src/lib/office-deletion.ts
P src/lib/ai-sources.ts
P src/lib/document-extraction.ts
P src/lib/docx-images.ts
F src/app/api/capabilities/[name]/route.ts
F src/app/api/vault/documents/[id]/route.ts
F src/app/api/vault/cases/[id]/annexes/files/route.ts
F src/app/api/integrations/google/[operation]/route.ts
F src/app/api/chat/attachments/route.ts
```

Repository/audit documents inspected:

```text
README.md
apps/web/AGENTS.md
apps/web/README.md                         [partial]
apps/web/.env.example
.audit/lume-provenance-files.json
.audit/lume-provenance-synthesis.md
.audit/lume-architecture-synthesis.md
.audit/lume-pages-review-verdict.md
.audit/lume-provenance-how.md              [partial]
.audit/lume-editor-repair.md               [partial]
.audit/lume-provenance-implementation.md    [partial]
.audit/lume-provenance-comments-review.md
```

Evidence files inspected under `apps/web/.e2e/verify/20261006T234247-d88728`:

```text
source-test-1791344311665/output.log
source-static-1791344384974/checks.json
source-e2e-1791342994695/report.json         [summaries/failures/artifact metadata]
source-e2e-1791342994695/output.log          [failure tail]
source-e2e-1791343977727/report.json         [summary]
```

The accepted editor repair was not independently re-audited in full. Untouched portions of the large connector/UI modules, complete bodies of the T-marked tests, browser trace contents, and a comprehensive cross-service lock-order census remain outside this review’s established coverage.
