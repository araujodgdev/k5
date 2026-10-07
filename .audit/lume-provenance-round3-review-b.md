**ISSUES — six concrete findings, plus one unresolved ordering concern.**

All findings below come from static production call-chain tracing. I performed no writes, tests, runtime reproductions, browser actions or nested work. I verified the 112-file freeze without mismatches and did not use other current functional-review reports.

1. **[critical / P1] Background runs lose their original session before committing the artifact.**

   **Location:** [document-workflows.ts:235](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/document-workflows.ts:235), `stillAuthorized()` at line 61; `documents/service.ts:29`, `application/context.ts:49`.

   **Sequence:** `startRun()` stores the original authority in `ai_run.input`. `runAdmission()` uses it before provider dispatch. If that session expires or is revoked while the final provider call is in flight, subsequent checkpoint/progress checks validate policy, membership and lease, but omit the session. `compose` then calls `createPrivateDocument()` with only office, user and invocation. Both session checks inside `documentTransaction()` silently pass because this reconstructed context lacks `sessionId`.

   **Expected/actual:** Already-sent bytes cannot be recalled, but later protected writes must honor original-session revocation. The worker can still create the artifact and its version/policy records.

   **Contract:** Original authority retention, immediate revocation, and authenticated final commits.

   **Smallest repair:** Pass the retained authority into the artifact writer and include it in checkpoint/final authorization. The existing expiry test calls the writer directly with a session; it does not exercise this worker handoff.

2. **[critical / P1] Enabling TypeSafe RAG breaks background drafting from Vault documents.**

   **Location:** [document-workflows.ts:172](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/document-workflows.ts:172); `knowledge/retrieval.ts:194`, `typesafe/rerank.ts:41`, `content-admission.ts:28`.

   **Sequence:** A valid queued draft reaches its section retrieval. `draft()` constructs `{officeId, userId}` and passes it to `searchKnowledgeEngine()`. With nonempty candidates and TypeSafe RAG in `shadow` or `enabled`, reranking reaches the mandatory admission, which rejects the missing original session with `UNAUTHENTICATED`. That denial propagates out of drafting.

   **Expected/actual:** An authorized background draft should retain its requester authority through secondary evaluation. It instead fails despite having a valid session stored in the run. RAG `off` avoids this branch.

   **Contract:** Mandatory admission for secondary calls while preserving ordinary authorized workflows.

   **Smallest repair:** Propagate the retained run authority through retrieval and attach the run lease/cancellation check to its secondary admission. Keep sessionless admission forbidden.

3. **[critical / P1] Direct catalog tools expose text after AI permission is revoked.**

   **Location:** [research/retrieval.ts:10](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/retrieval.ts:10), `findResearchJudgment()` at line 114; `application/research-service.ts:302`, `agent-tools/index.ts:280`.

   **Sequence:** Leave query/cache/redistribution permitted and set an installation’s `permission_ai` to prohibited. The published `k5_research_get_judgment` tool calls `getResearchJudgment()` → `findResearchJudgment()`. Its SQL admission omits AI permission and returns full material text/chunks. The result carries the correct policy, but `runCapability()` only preserves that metadata. `recordToolProvenance()` records it without asserting access, and the tool returns the bytes to the agent.

   The next private-chat model step has no policy-admission check in `prepareStep`. These catalog tools are also not marked `untrustedResult`.

   **Expected/actual:** Human-local catalog access may remain available, but prohibited material must be withheld from agent consumption. The direct tool path returns it. Migration `0089` expressly includes `permission_ai` in both catalog guard predicates; those guards are never evaluated here.

   **Contract:** Current catalog AI admission, including neighboring producers/consumers. This is distinct from the repaired assessment replay.

   **Smallest repair:** Authorize the complete owned policies before returning these affected catalog results to agent/WebMCP consumers, preserving the intended human-local read behavior.

4. **[critical / P2] Replaying `saveDraft` bypasses managed-original read authorization.**

   **Location:** [google/gmail/service.ts:354](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/gmail/service.ts:354), `completedOrUnknown()` at line 302 and `admitDraftRead()` at line 121.

   **Sequence:** Save a Gmail draft with an authorized own original and an idempotency key. Remove the sender’s access to that document’s case/folder while preserving office membership and Google connection. Repeat the identical `saveDraft` request. `completedOrUnknown()` returns the stored operation result immediately, including attachment filename/MIME/size, without validating retained `fileBindings`.

   **Expected/actual:** The ordinary `getDraft()` path calls `admitDraftRead()` and denies this now-inaccessible managed draft. The keyed save replay exposes its cached metadata.

   **Contract:** Managed originals retain current access obligations through recognized draft lifecycle and protected replay, independently of disclosure permission.

   **Smallest repair:** Reauthorize the stored bound policy and managed-file bindings before returning a draft-bearing replay result. Preserve the historical result and do not repeat the Google effect.

5. **[warning / P2] Assessment capture can pair old Vault excerpts with a newer original-file pin.**

   **Location:** [case-assessment.ts:43](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/case-assessment.ts:43), fallback selection at line 48 and policy observation at line 100; `google/drive/import.ts:196`.

   **Sequence:** `assessmentInput()` reads ready V1 chunks and constructs evidence/excerpts. Before its later `observeVaultFile()` call, a legitimate Drive reimport can commit V2. Both owners hold shared ACL gates; the earlier chunk queries do not lock the document row. `observeVaultFile()` then locks the current row and contributes V2’s version/hash/policy to the snapshot containing V1 excerpts. It does not require extraction readiness.

   **Expected/actual:** Every retained excerpt must correspond to its observed source version. This snapshot can contain mixed identities. This establishes incorrect provenance; I have not established a cross-material disclosure.

   **Contract:** Exact source identity and consistent assessment snapshots.

   **Smallest repair:** Lock and pin each participating extracted document before selecting its chunks, then retain the corresponding version/hash/policy from that same observation.

6. **[warning / P2] Assessment execution can use a different TypeSafe configuration from its retained fingerprint.**

   **Location:** [case-assessment.ts:192](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/case-assessment.ts:192); `typesafe/client.ts:29`, `typesafe/config.ts:33`.

   **Sequence:** The worker checks configuration V1 against the queued row. An administrator saves V2 before `evaluate()` independently reloads the connection. Evaluation reserves and sends using V2; its internal consistency checks compare against V2 and can succeed. The assessment then stores `before.model` from V1 while retaining its original V1 configuration/fingerprint.

   **Expected/actual:** A queued assessment must execute with its pinned configuration or become unavailable. It can instead accept a V2 evaluation labeled with V1’s assessment identity/model.

   **Contract:** Assessment content identity includes configuration/model, separately from execution authority.

   **Smallest repair:** Give evaluation an owner-supplied expected configuration identity and validate it during reservation/final admission. Persist the model actually evaluated only when it matches the queued identity.

The **stream-registration objection remains valid as an ordering concern**, but I would not make it alone another broad acceptance prerequisite. I independently traced `chat-turn.ts:303`, `jurisprudence-score.ts:74`, and the installed Mastra producer/consumer: the producer awaits enqueueing `step-finish`, while the consumer separately awaits `onStepFinish`. There is no producer barrier ensuring source registration completes before dependent scoring. A delayed registration can leave a later searched URL unrecognized; current scoring assigns low reliability rather than falsely certifying it. No incorrect score was reproduced. The smallest direction is producer-side registration or an explicit ordering barrier. The global void-return lint exemption establishes suppressed diagnostics, not an evidenced functional failure here.

I traced all nine predecessor groups: nested assessment/result ownership and replay; profile/notes ingress, hidden entries, CAS and exact approvals; assessment catalog authorization; final structured dispatch/retry admission; managed access versus disclosure across Gmail/Drive/personal shares; disabled settings ownership; TypeSafe reservation admission; annex epochs and independent plan policies; and immutable research-version selection. Their specific repairs are present in the inspected paths. Findings above identify remaining neighboring handoffs rather than restating the original failures.

Existing evidence is qualified: I inspected the parent’s **15/15 production-owner regression log**. The latest parent report records current typecheck and lint passes. Historical writer root results remain **945/946**, with the status mapping subsequently repaired. Current full-root test/build/combined-browser results were still pending in the latest evidence I read. Isolated navigation passes do not explain the combined intermittent failure; external stubs do not establish live model or Google behavior.

Depth gaps remain: this was ownership-chain review, not complete line-by-line inspection of all 112 files. UI inspection was strongest for annex correlation and research contracts; full editor/browser behavior, every migration compatibility path, complete Drive/Google reconciliation, WhatsApp/portal exits, and exhaustive lock interleavings were not cleared. Generic pending/unknown recovery, session-endpoint 429s and intermittent navigation remain recorded limitations. Unit3 and final visual completion were correctly excluded.
