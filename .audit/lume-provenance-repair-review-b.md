## Findings

### 1. [critical] Generic idempotency replay bypasses content authorization and provenance

**Location**: `apps/web/src/lib/application/idempotency-service.ts:45–49,67`; `apps/web/src/lib/agent-tools/index.ts:278–295`

**Finding**: A cached content response returns without running the domain service’s current policy checks or recording the exact returned exposure.

**Evidence**: `runCapability()` places the executor, `recordToolProvenance()` and policy attachment inside `execute`. `withIdempotency()` skips that entire function on a cache hit and returns parsed JSON, which also loses the WeakMap exposure policies.

A concrete path is `k5_artifacts_restore_version`:

1. Restore an artifact derived from a restricted Vault source using an idempotency key.
2. Revoke the person’s access to that source while retaining their office membership.
3. Repeat the same request through `/api/capabilities/k5_artifacts_restore_version`.
4. Initial authorization checks the session and office membership; artifact capabilities receive no resource check from `scopeCapability()`.
5. The cache returns the stored artifact title and full content without calling `restoreArtifactVersion()` → `requireArtifact()` → `assertPolicyAccess()`.

Agent retries likewise expose cached content without adding its restrictions to the current turn’s `contentSources`. This defeats both current revocation and private derivative lineage.

**Suggestion**: Keep content replay in the canonical domain owner, where the exact historical result can be authorized and its policies attached. Exclude these operations from the generic JSON response cache.

### 2. [critical] Portal invitation renewal and file upload have inverse lock orders

**Location**: `apps/web/src/lib/client-portal/service.ts:26–32,64–76,159–166,197–203`; `apps/web/db/postgres/0049_client_portal.sql:36`

**Finding**: Concurrent client upload and invitation renewal can deadlock despite the new content gate.

**Evidence**: The actual HTTP paths call `uploadClientFile()` and `invitePortal()`. Their lock sequence permits:

- Upload holds `FOR SHARE` on `client_portal_access`.
- Renewal holds `FOR UPDATE` on the corresponding `crm_client`.
- Renewal’s access-row upsert waits for the upload’s shared lock.
- Upload’s `client_portal_file` insert checks its client foreign key, requiring a key-share lock on the client row held by renewal.

Both transactions now wait for each other. `invitePortal()` uses plain `withTransaction()` and does not participate in the gate acquired by `storeFile()`. Conservative gating in `database.batch` does not cover this owner.

This is an unexecuted PostgreSQL lock trace, not a reproduced `40P01`. The inspected portal tests exercise invitation replacement and uploads sequentially.

**Suggestion**: Give these domain owners a consistent gate and row-lock order, including the foreign-key parent locks.

### 3. [critical] Annex filenames discard the petition’s policy

**Location**: `apps/web/src/lib/annexes.ts:83–136,139–169`; `apps/web/src/components/vault-annexes.tsx:48–59`

**Finding**: The repair preserves the scanned PDF’s restrictions, but generated filenames can disclose information from a more restricted petition.

**Evidence**: `petitionText()` authorizes the selected petition or artifact, then returns only text. `analyzeAnnexes()` supplies that text to the provider alongside the scan. Its generated labels become reviewed UI fields.

The normal Generate action submits those labels and page ranges with only `scanDocumentId`; it sends neither the petition identity nor a retained plan binding. `generateAnnexes()` converts the labels into filenames and creates every file with only the scan’s policy.

For a public scan and a petition in a restricted folder, a label containing a petition-only fact becomes a filename visible to case participants who cannot read the petition. Leaving the suggested label unchanged is a recognized app-prefill flow; human review does not remove its lineage.

The repaired annex test covers restrictions inherited from the scan. It does not analyze a petition with narrower access and then generate the reviewed plan.

**Suggestion**: Retain the exact plan’s contributing source policies through review and generation, including the policy governing generated names.

### 4. [critical] Portal storage reconstructs a context that defeats the final session check

**Location**: `apps/web/src/lib/client-portal/service.ts:148–175,177–203`; `apps/web/src/lib/documents/service.ts:33–48`

**Finding**: The portal’s final writer drops `sessionId` and `signal`, so a session expiring during a later database wait can still publish a file.

**Evidence**: `publishPortalFile()` retains the original context in its authorization callback, but `storeFile()` calls:

```ts
documentTransaction({ officeId: input.officeId, userId: input.userId }, ...)
```

The callback checks the real session once, before insertion. The insert can subsequently wait on the client foreign key or an idempotency conflict. If the session expires during that wait, `documentTransaction()` performs its final check against the reconstructed context, which has no session to validate.

Client uploads have the same omission. Their `clientAccess()` check also reads the session without locking it, permitting logout during a later wait before commit.

These are static interleavings. The inspected expiry tests cover pages and run output, not this portal writer.

**Suggestion**: Preserve the original trusted authorization context through `storeFile()`, and perform its session/access check after the database work before committing.

### 5. [critical] An unrelated unfinished file prevents ordinary case chat

**Location**: `apps/web/src/lib/chat-turn.ts:136–174`; `apps/web/src/lib/content-policy.ts:167–179`

**Finding**: Case chat now requires every implicitly listed document to have completed extraction, even when the person selected no documents.

**Evidence**: With a `caseId` and empty `documentIds`, `scopeDocuments` contains the case’s visible documents. The unconditional loop at line 174 calls `observeDocument()` for every item. That function rejects queued, processing, failed or extraction-mismatched documents.

Consequently, uploading one file can prevent an unrelated ordinary question from reaching the private provider. A failed extraction keeps blocking subsequent requests. This also makes the existing pending-PDF attachment path at `chat-turn.ts:295–310` unreachable for those documents.

The strict extraction check is appropriate for admitting extracted text into shared writing. Applying it while collecting private chat source metadata breaks the existing private original-file flow.

**Suggestion**: Observe metadata/original-file policies without requiring extracted text readiness. Enforce exact extraction readiness where extracted content is actually admitted.

## Inspection and limits

All findings are code-path conclusions; I ran no tests, migrations, browser actions or mutations. Existing logs confirm **124/124**, **20/20** and the frozen **43/43** browser result, with zero page errors and 25 session-endpoint 429 responses. Those results do not exercise the interleavings and producer/consumer combinations above.

Production paths inspected in depth or by relevant ranges, relative to `apps/web`:

```text
src/lib/acl-transaction.ts
src/lib/db/postgres.ts
src/lib/db/migrate.ts
src/lib/content-policy.ts
src/lib/documents/service.ts
src/lib/documents/shared-writing.ts
src/lib/case-pages/service.ts
src/lib/case-pages/provenance.ts
src/lib/application/context.ts
src/lib/application/idempotency-service.ts
src/lib/application/artifacts-service.ts
src/lib/application/approvals-service.ts
src/lib/application/agent-approvals.ts
src/lib/application/knowledge-service.ts
src/lib/application/vault-service.ts
src/lib/application/annexes-service.ts
src/lib/agent-tools/index.ts
src/lib/agent-instructions.ts
src/lib/agent-knowledge.ts
src/lib/agent-profile.ts
src/lib/chat-turn.ts
src/lib/chat-prompt.ts
src/lib/vault.ts
src/lib/artifact-file.ts
src/lib/annexes.ts
src/lib/knowledge/retrieval.ts
src/lib/citations/sources.ts
src/lib/citations/artifact-review.ts
src/lib/collaboration/service.ts
src/lib/collaboration/capability-access.ts
src/lib/client-portal/service.ts
src/lib/personal-chat/shares.ts
src/lib/personal-chat/service.ts
src/lib/personal-chat/email-worker.ts
src/lib/google/operations.ts
src/lib/google/approval-review.ts
src/lib/google/gmail/service.ts
src/lib/google/gmail/insights.ts
src/lib/google/calendar/service.ts
src/lib/whatsapp/send.ts
src/lib/capabilities/contracts.ts
src/lib/capabilities/google.ts
src/lib/capabilities/annexes.ts
src/lib/capability-route.ts
src/components/vault-annexes.tsx
src/app/api/chat/route.ts
src/app/api/capabilities/[name]/route.ts
src/app/api/approvals/[id]/route.ts
src/app/api/artifacts/[id]/restore/route.ts
src/app/api/client-portal/[accessId]/files/route.ts
src/app/api/client-portal/manage/route.ts
db/postgres/0049_client_portal.sql
db/postgres/0076_content_policy.sql
db/postgres/0077_content_policy_validation.sql
db/postgres/0078_source_policy_repair.sql
db/postgres/0079_citation_source_policy.sql
db/postgres/0080_calendar_share_review.sql
db/postgres/0080a_capture_upgrade_compat.sql
db/postgres/0081_source_capture_upgrade.sql
db/postgres/0082_capture_upgrade_compat_cleanup.sql
```

Test inspection covered `source-acl.test.ts`, `source-session-expiry.test.ts`, `source-extraction.test.ts`, `source-archive.test.ts`, relevant ranges of `source-repair-behavior.test.ts`, `google-email-insights.test.ts` and `client-portal.test.ts`, plus targeted searches in `chat-source-boundary.test.ts` and `annexes.test.ts`.

Remaining depth gaps: complete Drive synchronization/reconciliation, background draft/research pipelines, complete WhatsApp dispatch, editor component internals, and the remaining test/browser inventory. Office deletion, Drive import and research profile/reference owners received targeted caller/lock searches rather than complete reviews.
