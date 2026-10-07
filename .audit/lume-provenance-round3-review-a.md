**ISSUES.** Four findings are supported by static production call-chain tracing. None was reproduced at runtime during this review.

I independently checked all 112 hashes against the current parent freeze. All matched. I performed no writes, tests, database operations, browser automation, process launches, git mutations, or nested delegation. I did not access other current functional reviewers’ output.

1. **High. Seeded profile replacement can discard source obligations.**

   Location is [`profilePartsForSave`, case-content.ts:105](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/case-content.ts:105), particularly the missing-ID check at line 120 and deletion handling at line 126.

   An authorized person reads a profile containing an alleged fact guarded by source S. They submit the valid read token and revision, mark that fact’s ID as deleted, and add a slightly edited copy with a null ID. Appending a sentence-ending period is sufficient to change its digest. The exact-copy check passes. Because the new entry has no `prior`, policy construction excludes both the prior policy and admitted seed policy. The canonical save persists the replacement with a fresh person contribution and no S guard. Another case participant without access to S can then receive the replacement through `projectProfile`.

   The real form can construct this payload through Remove and Add. [`research-case-linker.tsx:131`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/research-case-linker.tsx:131) supplies null IDs for additions and computes deleted IDs from omitted rows.

   Expected behavior is that a replacement derived from a shown entry retains its obligations. The [selected contract, line 39](C:/Users/douglas.araujo/Documents/dgstack/k5/.audit/lume-provenance-round3-synthesis.md:39) explicitly prohibits dropping IDs to declare an existing seeded value independently authored.

   The smallest repair is to require an identified replacement operation for seeded entries and reject ambiguous identity-reset replacements. Preserve genuinely independent additions. Fresh replacement must follow the separate authenticated, unseeded, reviewed, CAS-bound contract.

   **Evidence is static.** Existing identity coverage rejects exact copies, but does not establish rejection of this edited-copy path.

2. **High. Semantic-query embedding dispatch bypasses source and session admission.**

   Location is [`searchKnowledgeEngine`, retrieval.ts:130](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/knowledge/retrieval.ts:130), leading to [`embedQuery`, embedding-provider.ts:103](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/knowledge/embedding-provider.ts:103). Concrete requests use ordinary fetch at lines 54 and 73.

   A real agent reads protected page S. `recordToolProvenance` retains its policy in `context.contentSources`. Access to S is subsequently revoked while the session and another selected document remain accessible. The agent calls `k5_knowledge_search` with query text derived from S. Capability authorization checks the current session and search scope, but does not admit every previously retained contributor. With an active semantic generation, retrieval sends the query to the embedding provider before guarded TypeSafe reranking runs.

   `embedQuery` receives only a string. It cannot check the original session, query provenance, capability, or caller cancellation. Its provider fetch also permits automatic redirects. Later reranking denial cannot retract the earlier query disclosure.

   Expected behavior is admission of the query’s actual contributors at each concrete external dispatch after configuration waits. This violates the selected transport-admission contract.

   The smallest repair is to construct an owner-bound query admission before asynchronous configuration and pass its guarded transport through supported embedding providers. Authorization denial must propagate rather than enter retrieval’s generic lexical-degradation catch.

   **Evidence is static.** This neighboring dispatch file is outside the 112-name freeze, but lies directly on the changed retrieval owner’s authorized source-policy path.

3. **High. Healthy background drafts fail when TypeSafe RAG is active.**

   Location is [`draft`, document-workflows.ts:172](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/document-workflows.ts:172), leading to [`rerank`, rerank.ts:41](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/typesafe/rerank.ts:41) and [`contentAdmission.admit`, content-admission.ts:28](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/content-admission.ts:28).

   `startRun` stores the original session authority in `ai_run.input`. During section drafting, the worker instead passes `{officeId, userId}` to `searchKnowledgeEngine`. For a draft with selected documents, matching candidates, available budget, and configured TypeSafe RAG in enabled or shadow mode, evaluation reaches the guarded transport. Admission rejects the missing `sessionId` with `UNAUTHENTICATED`, even when the original session remains live.

   TypeSafe correctly preserves and rethrows that denial. Retrieval does not catch it. The worker catch marks the run failed at line 310, preventing the draft artifact from being produced.

   Expected behavior is successful execution under the stored original authority while it remains valid. The original-session contract forbids inventing replacement authority, but does not justify dropping authority already persisted.

   The smallest repair is to reconstruct the stored original workspace authority for retrieval, carry the run input’s contributor policy, and retain cancellation and lease checks. Do not exempt sessionless workers from admission.

   **Evidence is static.** The reported assessment-worker session regression does not cover this separate document-draft retrieval caller.

4. **Medium. Research linker responses can overwrite a newly selected case.**

   Location is [`ResearchCaseLinker`, research-case-linker.tsx:145](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/research-case-linker.tsx:145). Assessment and reference completions have the same issue at lines 156 and 169. Case selection remains enabled at line 180.

   Start saving profile A, select B before the save completes, and allow B’s case-loading effect to finish. When A’s save returns, it unconditionally installs A’s profile and draft, marks the profile reviewed, and clears assessment state beneath the selected B label. A late assessment similarly installs A’s assessment after B’s load cleared it. The loading effect’s cancellation fence protects its own requests, not these event-handler requests.

   Expected behavior is that displayed profile, review status, assessment, and references belong to the selected case and current operation. Actual behavior can display A’s facts as B’s reviewed profile. A subsequent save generally conflicts through the case-bound token, but the visible review state is already incorrect.

   The smallest repair is to fence all success, error, and completion updates by selection epoch and operation identity. Include assessment material identity. The existing annex approach provides the relevant ownership pattern.

   **Evidence is static.** This is a separate consumer from the annex component covered by the controlled browser proof.

I traced all nine predecessor groups:

- **Nested research replay.** Explicit root ownership now combines reference and nested assessment policies through DTO parsing and replay. I found no recurrence on the inspected path.
- **Planner-authored profile and notes.** Raw planner text is rejected and finite preparation/confirmation contracts govern generated text. Human profile identity handling still has finding 1.
- **Historical assessment access.** Retained policy authorization precedes freshness labeling. Original execution authority and immutable input are persisted.
- **Image/configuration/credit waits.** Structured runtime uses guarded request-local provider factories and a denial latch. The embedding dispatch remains outside that protection.
- **Managed originals.** Gmail, Drive upload, personal shares, and deferred email distinguish sender access from recipient disclosure and retain exact version/hash/size binding. Own-original disclosure requires pinned contributor evidence.
- **Disabled settings.** Inspected instruction, knowledge, and template read aggregation retains policies through output projection.
- **Held TypeSafe reservation.** Concrete transport admission occurs after reservation. Denial accounting preserves the original error. Caller migration remains incomplete in the draft worker.
- **Annex selection races.** Current epoch and operation checks cover inspected success, error, and busy updates. Independent older plans remain independent.
- **Research V1/V2 pairing.** Inspected selection resolves one immutable material version and retains its corresponding text, policy, and citation identity.

The Mastra ordering objection remains unresolved. Installed code awaits `onStepFinish` in the stream consumer, while the workflow producer’s awaited writer only enqueues the event. That confirms the missing producer-to-consumer barrier. However, consulted-link registration also occurs synchronously at callback entry and in source/tool-result handlers. I did not establish an incorrect production score, so I have not promoted the absent barrier alone to another finding. The broad void-return lint exemption likewise establishes suppressed diagnostics, not a demonstrated functional failure.

The latest parent record I read reports current lint and typecheck passes. Current full tests, build, and combined affected browser validation remain pending. The earlier writer suite was 945/946, and the parent’s pre-cleanup production-owner regressions were 15/15. Those are reported existing evidence, not tests I ran. Controlled annex HTTP responses do not establish live provider or server-generation behavior. The combined ended-session navigation failure remains without a demonstrated causal fix.

Depth gaps remain in exhaustive migration compatibility, cross-owner lock ordering, complete Drive reconciliation/import, WhatsApp media delivery, private-chat provider continuation, editor internals, and every browser/device state. Test-body inspection was selective. I did not inspect browser media or independently reproduce external-service behavior. Generic pending/unknown recovery and already-admitted remote bytes retain the brief’s stated limits.

**Minimize Reader Load** shaped this review by keeping each finding tied to a concrete owner-to-consumer path and rejecting additional abstractions or refactors without demonstrated behavior.
