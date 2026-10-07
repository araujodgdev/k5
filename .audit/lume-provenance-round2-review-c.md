## Findings

All three findings are static producer-to-consumer traces. I performed no runtime reproductions or mutations.

### 1. [critical] Connector delivery drops another person’s original-file access boundary

**Location:** `apps/web/src/lib/google/gmail/service.ts:131`; `apps/web/src/lib/google/drive/service.ts:130`; `apps/web/src/lib/content-policy.ts:151`.

**Finding:** Gmail attachments and Drive replacement uploads use the stored version policy without retaining the original file’s current resource and ancestor obligations.

**Evidence:**

- `ingestUpload()` supplies `personPolicy()`; `createVaultDocument()` stores it without adding destination-folder guards.
- `vaultPolicy()` returns that stored policy. `observeVaultFile()` separately adds the document and ancestor guards, but these connector paths use `vaultPolicy()`.
- A participant B can create a restricted folder in A’s case, upload an original and grant A access. A can read the file but cannot move it outside B’s access boundary: `assertVaultDocumentMove()` explicitly enforces that distinction.
- Gmail nevertheless accepts its empty stored guards, reads the file as A and sends it to arbitrary external recipients. Drive accepts the same policy when replacing a remote file.
- Revoking A’s folder access after preparation also does not reach the final Google guard: its bound `contentPolicy` contains no reference to that file or folder.

This concerns another person’s protected original, preserving the accepted disclosure authority for someone’s own independent contribution.

**Suggestion:** Bind exact file bytes/version together with retained source authorization. Apply any original-owner disclosure exception explicitly, and recheck the retained authorization at dispatch. `pinnedArtifactTemplate()` already demonstrates this distinction.

### 2. [critical] Shared generation can send revoked source text after attachment staging

**Location:** `apps/web/src/lib/documents/shared-writing.ts:172–196`; `apps/web/src/lib/ai-runtime.ts:194–210`.

**Finding:** The shared writer releases its authorization transaction before asynchronous image loading, then sends the retained prompt without another source/session check at provider admission.

**Evidence:**

1. An authenticated request selects an eligible restricted document and an image attachment.
2. `prepareSharedWriting()` authorizes the combined policy and reserves the attempt inside `documentTransaction()`.
3. That transaction finishes. The subsequent attachment `objectStorage().get()` can wait without holding the ACL gate.
4. The source owner revokes access while storage is waiting.
5. After storage resumes, the writer calls `generateStructured()` with the retained document text.
6. `generateStructured()` checks credits and resolves configuration, then calls `agent.generate()`. It receives no source policy or session authorization callback.
7. The next `assertPolicyAccess()` occurs **after** the provider returns.

The post-generation check prevents publication, but the revoked bytes have already reached the provider. Session revocation during the same gap has the corresponding missing admission check.

**Suggestion:** Reauthorize the original session and exact admitted sources at the provider boundary after staging and configuration waits. Add a regression that pauses attachment storage, revokes access, resumes and asserts no provider dispatch.

### 3. [warning] Research retrieval can attach V1 policy to V2 text

**Location:** `apps/web/src/lib/knowledge/retrieval.ts:49–58,79–80`; `apps/web/src/lib/ai-sources.ts:selectResearchSources`; `apps/web/src/lib/research/case-references.ts:109`.

**Finding:** Research policy observation and research chunk selection independently resolve the mutable reference’s material version.

**Evidence:** `searchKnowledgeEngine()` first obtains V1’s policy through `observeResearch()`. A concurrent legitimate `updateResearchCaseReference()` can switch the reference to V2 before `selectedResearchSources()` reloads it. The returned text and `materialVersionId` then describe V2, while the exposure map still contains V1’s observation and digest.

`sourcesFromTool()` and `recordSources()` preserve this mismatched pairing in the citation cache. No version comparison rejects it. Updates require the same material, so this trace establishes incorrect historical binding rather than a cross-material permission bypass.

**Suggestion:** Select chunks from the version already observed, or resolve chunks and policy together under one transaction and verify their version identities.

## Inspection and limits

Substantial inspection covered these files, relative to `apps/web`:

```text
src/lib/content-policy.ts
src/lib/documents/service.ts
src/lib/documents/shared-writing.ts
src/lib/application/context.ts
src/lib/application/idempotency-service.ts
src/lib/application/capability-replay.ts
src/lib/application/annexes-service.ts
src/lib/application/agent-settings-service.ts
src/lib/application/conversations-service.ts
src/lib/annexes.ts
src/lib/artifact-file.ts
src/lib/acl-transaction.ts
src/lib/capabilities/annexes.ts
src/lib/capability-route.ts
src/lib/citations/sources.ts
src/lib/citations/review.ts
src/lib/citations/artifact-review.ts
src/lib/client-portal/service.ts
src/lib/client-portal/invitations.ts
src/lib/google/gmail/service.ts
src/lib/ai-runtime.ts
src/lib/chat-prompt.ts
src/lib/ai-sources.ts
src/lib/knowledge/retrieval.ts
src/components/vault-annexes.tsx
```

Targeted neighboring inspection covered:

```text
src/lib/agent-tools/index.ts
src/lib/capabilities/contracts.ts
src/lib/application/vault-service.ts
src/lib/application/research-service.ts
src/lib/application/agent-approvals.ts
src/lib/case-pages/service.ts
src/lib/case-pages/provenance.ts
src/lib/vault.ts
src/lib/office-deletion.ts
src/lib/chat-turn.ts
src/lib/document-workflows.ts
src/lib/agent-instructions.ts
src/lib/agent-knowledge.ts
src/lib/agent-profile.ts
src/lib/research/case-material.ts
src/lib/research/case-references.ts
src/lib/google/operations.ts
src/lib/google/connections.ts
src/lib/google/approval-review.ts
src/lib/google/drive/service.ts
src/lib/google/drive/import.ts
src/lib/personal-chat/shares.ts
src/lib/whatsapp/send.ts
src/lib/collaboration/access.ts
src/lib/collaboration/capability-access.ts
src/lib/typesafe/rerank.ts
src/lib/db/postgres.ts
src/lib/db/migrate.ts
src/lib/storage/index.ts
src/lib/auth-core.ts
src/app/api/chat/route.ts
src/app/api/conversations/[id]/route.ts
src/app/api/vault/cases/[id]/annexes/route.ts
src/app/api/vault/cases/[id]/annexes/files/route.ts
```

Migration inspection included relevant portions of `0076`/`0077` and the complete `0080a`, `0081`, `0082` and `0083`. Test-body inspection was selective across `source-round2`, `source-annex-plan`, `source-catalog-cache`, `source-gmail-binding`, `source-archive`, `content-exits` and `client-portal`; other test searches were declaration/call-site inspection.

I read repository instructions, the bundled Next route guide, accepted syntheses, current verdict/brief/report/parent correction, inventory/freeze metadata and targeted historical judgments.

Existing logs independently showed:

- Current `source-test-1791356668490`: **38/38 passed**.
- Current `source-checks-1791356668581`: **two successful typecheck tasks**.
- Current browser log `source-e2e-1791356625821`: unfinished at my last read; no aggregate result verified.
- Historical frozen runs: **219/219 PostgreSQL**, **49/49 browser**, with **22 session-endpoint 429s** in the trace summary.

I did not independently recompute hashes or verify a final current-tree lint outcome. Depth gaps remain in full editor/browser behavior, complete background/Drive reconciliation, personal-chat workers, Calendar, WhatsApp media, and exhaustive cross-owner lock ordering. The acknowledged reservation-recovery and intermittent-navigation limits remain unresolved; this review does not clear them.
