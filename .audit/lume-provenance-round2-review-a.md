## Findings

Four findings supported by static producer-to-consumer tracing. I performed no writes, tests, migrations, database queries, browser actions or nested delegation.

### 1. [critical] Reference replay omits policies governing nested assessment excerpts

**Location:** `apps/web/src/lib/application/capability-replay.ts:37–46`; `src/lib/research/case-references.ts`, `referenceView()`.

**Finding:** Keyed reference writes can replay protected Vault excerpts after access is revoked.

**Evidence:** `addResearchCaseReference()` and `updateResearchCaseReference()` return a reference containing `assessment.result.excerpts`. Replay capture examines only `item.result.excerpts`, so it misses the nested assessment. These services attach no exposure policy that compensates for this omission.

Concrete path:

1. Complete an assessment containing excerpts from document D.
2. Add or update its reference through `runCapability()` with an idempotency key.
3. Remove the caller’s access to D while retaining case and catalog access.
4. Repeat the identical keyed request.

The stored binding checks the case, material and reference, but contains no obligation for D. Replay therefore returns the original nested excerpts. Executing the canonical reader would instead reach `getResearchCaseAssessment()`, which suppresses results containing inaccessible Vault excerpts.

**Suggestion:** Have the research domain return the policies governing its complete DTO, including nested assessment content. Reuse those policies for replay rather than reconstructing them through shallow shape casts.

### 2. [critical] Private planner text can become an unrestricted case research profile

**Location:** `apps/web/src/lib/research/case-profile.ts:59–67,70–110`; `src/lib/capabilities/research-case.ts`, `k5_research_save_profile`.

**Finding:** The agent can persist private conversation or protected-source information into a profile readable by other case participants.

**Evidence:** The save capability is published to agents and executes through `research.saveProfile()` → `saveResearchCaseProfile()`. It accepts planner-supplied `legalQuestion`, `objective`, `thesis`, `allegedFacts` and `gaps`. The writer neither uses the authenticated shared-writing submission nor retains `context.contentSources` or private-generation policy.

A private planner can supply a protected fact in `allegedFacts` with empty `documentIds` and `documentedFacts`. The writer accepts and stores it. Another participant’s profile GET returns that text: the reader filters only document IDs and documented facts, leaving the other fields unchanged.

Optional replay capture adds a case guard; it cannot restore omitted provenance or protect subsequent ordinary reads. This is an actual application-managed agent write, outside the explicit independent-human paste limitation.

**Suggestion:** Apply the accepted authenticated-generation and retained-policy boundary at the canonical profile writer. Preserve independent human profile editing without treating arbitrary planner text as human input.

### 3. [critical] Stale assessment reads still expose revoked catalog excerpts

**Location:** `apps/web/src/lib/research/case-assessment.ts:91–116`; `src/lib/application/research-capability-service.ts`, `getAssessment()`.

**Finding:** Revoking catalog availability or AI permission changes an assessment’s status but leaves its cached research text available to the agent.

**Evidence:** After an assessment succeeds, setting its material to `restricted` or revoking the installation’s `permission_ai` changes `assessmentInput()`’s fingerprint and eligibility. However, `rowView()` retains `result_json` even when `current` is false.

`getResearchCaseAssessment()` checks only excerpts whose source is `vault`. With still-accessible Vault evidence—or an assessment based solely on alleged facts—it returns the saved research excerpts with `status: 'stale'`.

The published `k5_research_get_assessment` tool returns those bytes without a research-material exposure policy. The agent can consequently receive revoked catalog text through this path despite the repaired citation-cache filter.

**Suggestion:** Authorize the saved result’s exact contributors before returning it. Preserve stale historical results when their sources remain authorized; suppress content whose current permissions were revoked.

### 4. [critical] Shared generation can send revoked source text after image preparation waits

**Location:** `apps/web/src/lib/documents/shared-writing.ts:171–202`; `src/lib/ai-runtime.ts:194–210`.

**Finding:** The shared writer’s last source/session authorization precedes asynchronous image loading, allowing revocation to complete before provider dispatch.

**Evidence:** `prepareSharedWriting()` authorizes the admitted policy inside `documentTransaction()`, then releases that transaction. It subsequently awaits attachment lookup and object-storage reads before calling `generateStructured()`.

A concrete interleaving is:

1. Prepare a shared request containing protected document text and an image attachment.
2. Pause the image’s object-storage read after the reservation transaction commits.
3. Revoke source access or end the session.
4. Resume image loading.

No authorization check runs between that wait and provider generation. `generateStructured()` checks credits and resolves the model, then sends the retained prompt. The source/session checks at lines 201–202 run only after generation, when disclosure has already occurred.

**Suggestion:** Reauthorize the exact admitted policy and trusted context at the provider-dispatch boundary after preparation waits. This finding is an unexecuted static interleaving.

## Inspection and limits

Substantial inspection covered these production paths under `apps/web/`:

```text
src/lib/content-policy.ts
src/lib/documents/service.ts
src/lib/documents/shared-writing.ts
src/lib/application/context.ts
src/lib/application/idempotency-service.ts
src/lib/application/capability-replay.ts
src/lib/application/agent-settings-service.ts
src/lib/application/annexes-service.ts
src/lib/application/research-capability-service.ts
src/lib/application/research-case-service.ts
src/lib/annexes.ts
src/lib/citations/sources.ts
src/lib/citations/review.ts
src/lib/knowledge/retrieval.ts
src/lib/client-portal/service.ts
src/lib/client-portal/invitations.ts
src/lib/google/gmail/service.ts
src/lib/research/case-profile.ts
src/lib/research/case-assessment.ts
src/lib/research/case-references.ts
src/lib/research/case-material.ts
src/lib/agent-instructions.ts
src/lib/agent-knowledge.ts
src/lib/personal-chat/shares.ts
src/lib/ai-runtime.ts
src/lib/chat-prompt.ts
src/lib/collaboration/access.ts
src/lib/collaboration/capability-access.ts
src/lib/capabilities/annexes.ts
src/lib/capabilities/agent-settings.ts
src/lib/capabilities/research-case.ts
src/components/vault-annexes.tsx
db/postgres/0083_retained_source_bindings.sql
```

Targeted inspection covered `agent-tools/index.ts`, `case-pages/service.ts`, `case-pages/provenance.ts`, `application/agent-approvals.ts`, `application/approvals-service.ts`, `application/research-service.ts`, `google/operations.ts`, `chat-turn.ts`, `ai-providers.ts`, `artifact-file.ts`, `office-deletion.ts`, `acl-transaction.ts`, capability contracts, research profile/annex HTTP routes, and the resource-visibility SQL in migrations 0076/0077/0078.

Test inspection covered relevant bodies in `source-round2.test.ts`, `source-annex-plan.test.ts`, `source-catalog-cache.test.ts` and `research-case.test.ts`, plus targeted searches in provider-boundary tests.

I read the repository instructions, targeted setup/design/Next route guidance, accepted syntheses, round2 verdict/brief/report, inventory, parent correction and supplied historical findings. The current annex selection does not restore the rejected lifetime union.

Existing logs inspected confirm historical **219/219 PostgreSQL** and **49/49 browser** results. Current parent logs confirm **38/38 targeted PostgreSQL tests** and passing root typecheck. The current browser log remained partial at my last read. I did not independently verify hashes or inspect browser media.

Depth gaps remain in complete Drive reconciliation/import, background document workflows, WhatsApp and personal-email dispatch, editor internals, full multimodal HTTP ingress, and exhaustive cross-owner lock analysis. This review does not clear those paths or establish runtime reproduction of the four findings.
