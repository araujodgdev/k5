## Findings

All four findings are **static producer-to-consumer traces**, not runtime reproductions.

### 1. [critical] Managed file delivery drops restricted originals’ folder obligations

**Location:** `apps/web/src/lib/google/gmail/service.ts:131–133`; `src/lib/google/drive/service.ts:130`; `src/lib/personal-chat/shares.ts:108–111,185–197`.

**Finding:** These delivery paths use `vaultPolicy()` without the resource and ancestor obligations added by source observation. An authorized reader can consequently disclose another person’s restricted original.

**Evidence:** `ingestUpload()` stores a `personPolicy` with empty guards, including uploads into restricted folders. `vaultPolicy()` returns that stored policy. Gmail checks the sender’s access through `readVaultDocumentFile()`, then incorporates the empty policy into its final dispatch policy. Drive replacement follows the same pattern.

A concrete supported workflow is an associate B uploading an original into B’s restricted folder, with case owner A included as a member. A can read it but cannot change B’s folder audience. A’s Gmail attachment nevertheless passes `assertExternalDelivery()`, because no guard identifies that folder. Neither Gmail nor Drive checks whether A authored the original.

Personal sharing exposes the same gap directly: A’s office membership and source visibility satisfy creation checks; the recipient’s authorization is evaluated against the empty policy. `readDocumentShare()` then permits the active recipient without requiring access to B’s folder.

This concerns a recognized managed original, not downloading and independently reuploading it.

**Suggestion:** Carry an exact source binding containing resource and ancestor obligations through delivery and recipient reads. Preserve original-author disclosure only through an explicit author check.

### 2. [critical] Settings reads lose known policies before private derivation

**Location:** `apps/web/src/lib/application/agent-settings-service.ts:14–18`; `src/lib/case-pages/provenance.ts:82–95`; `src/lib/documents/service.ts:57`.

**Finding:** `k5_agent_settings_get` returns protected settings text without transferring its policies into the invocation’s `contentSources`.

**Evidence:** `listInstructions()` authorizes each instruction’s stored policy, but `getAgentSettings()` returns a plain object without `exposeContent()`. Its capability has no exposure classification. Therefore, `recordToolProvenance()` records uncertainty with **no dependencies**, rather than the policies of the returned settings.

Consider a fresh conversation reading a disabled instruction derived from protected source S. Disabled instructions are absent from `instructionsPrompt()`, so that separate prompt-loading path does not capture S. The settings tool still returns its full text. A subsequent `k5_artifacts_create` derives its policy from `privateGenerationPolicy(context)`, which now lacks S’s guard. Revoking S therefore does not revoke that resulting artifact or assistant-message history.

`settingsReplayPolicies()` covers keyed settings **writes**; it does not repair this read path. Owner-only uncertainty prevents sharing but does not preserve known revocable obligations.

**Suggestion:** Attach exact policies to settings read results at their owner, including instructions, notes and document metadata, and carry them through DTO parsing.

### 3. [critical] Reranking can send revoked source text after its authorization check

**Location:** `apps/web/src/lib/knowledge/retrieval.ts:191–195`; `src/lib/typesafe/rerank.ts:34`; `src/lib/typesafe/client.ts:42–64`.

**Finding:** The actual TypeSafe reranking dispatch lacks the final source guard used by citation review.

**Evidence:** `currentCandidates()` authorizes and reads candidates inside `documentTransaction()`, then releases its locks. `rerank()` passes their text to `evaluate()` without a guarded transport callback.

Before sending, `evaluate()` awaits configuration and a reservation transaction locking `typesafe_platform_connection FOR UPDATE`. While that reservation waits, an actual folder-access mutation can revoke the requester’s access and commit. Releasing the platform lock lets `evaluate()` dispatch the previously captured text; it checks cancellation, but no source policy.

The later `currentCandidates()` call can reject the capability result, but the external disclosure has already happened. This is a concrete unexecuted interleaving, with the platform reservation lock providing the waiting boundary.

**Suggestion:** Pass the captured policies through reranking and reauthorize immediately at its transport boundary, following citation review’s existing pattern.

### 4. [warning] An old annex analysis can replace the newly selected PDF’s review

**Location:** `apps/web/src/components/vault-annexes.tsx:51–58,65–67,89`.

**Finding:** Analysis responses are not fenced to the current scan selection.

**Evidence:** While analysis of PDF A is pending, the enabled scan selector allows choosing B. That clears the plan and starts B’s reopen request. The earlier analysis subsequently executes unconditional `setPlan(...)`, displaying A’s review beneath a selector showing B.

Generation explicitly submits `plan.scanDocumentId`, so it cuts A despite the current selection showing B. The reopen request’s abort controller does not govern the analysis POST.

**Suggestion:** Fence analysis and generation responses to the active selection/request, or prevent selection changes during those operations.

## Inspection and limits

Production inspection covered the complete retained-policy/replay owners and relevant ranges/callers in:

```text
src/lib/content-policy.ts
src/lib/documents/{service,shared-writing}.ts
src/lib/application/{context,idempotency-service,capability-replay,
  agent-settings-service,agent-approvals,approvals-service,
  annexes-service,artifacts-service,knowledge-service,
  vault-service,runs-service,research-service}.ts
src/lib/agent-tools/index.ts
src/lib/capabilities/{contracts,agent-settings,annexes}.ts
src/lib/capability-route.ts
src/lib/case-pages/{service,provenance}.ts
src/lib/annexes.ts
src/lib/vault.ts
src/lib/artifact-file.ts
src/lib/agent-{instructions,knowledge}.ts
src/lib/chat-{turn,prompt}.ts
src/lib/ai-{runtime,sources}.ts
src/lib/knowledge/retrieval.ts
src/lib/citations/{sources,review,artifact-review}.ts
src/lib/typesafe/{client,rerank}.ts
src/lib/google/{operations,connections,transport}.ts
src/lib/google/gmail/service.ts
src/lib/google/drive/service.ts
src/lib/google/calendar/service.ts
src/lib/client-portal/{service,invitations}.ts
src/lib/collaboration/{access,capability-access}.ts
src/lib/personal-chat/{shares,email-worker}.ts
src/lib/whatsapp/send.ts
src/lib/office-deletion.ts
src/lib/db/postgres.ts
src/components/vault-annexes.tsx
db/postgres/{0076,0077,0080a,0081,0082,0083}_*.sql
```

I also inspected the repository instructions, accepted syntheses, round2 verdict/brief/report, parent correction, inventory/freeze metadata, relevant regression bodies, and annex/private-chat browser tests.

Existing logs confirm historical **219/219 PostgreSQL** and **49/49 browser** results, and current post-cleanup **38/38 PostgreSQL** plus successful typecheck. The new browser log remained partial when inspected. The historical trace summary contains **22 session-endpoint 429s**, 85 console errors and zero page errors; it does not establish clean networking or diagnose the intermittent navigation failure.

Depth gaps include complete editor internals, all background/Drive reconciliation branches, full WhatsApp and research producers, exhaustive cross-owner lock ordering, and browser trace/video contents. I did not independently recompute hashes, run checks, query databases, use a browser, write files, mutate git, or delegate work.
