## Findings

Seven findings. These are code-traced production paths, not runtime reproductions. I performed no writes, migrations, tests, or browser interactions.

### 1. [critical] The ACL gate introduces a lock-order deadlock with participant changes

**Location**: [documents/service.ts:17](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/documents/service.ts:17), [collaboration/service.ts:125](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/collaboration/service.ts:125), `db/postgres/0076_content_policy.sql:205–212`.

**Finding**: The statement triggers acquire the exclusive gate after existing collaboration code has acquired conflicting row locks. Content transactions acquire those locks in the opposite order.

**Evidence**:

1. `changeAccess()` locks `office` with `FOR UPDATE` through `lockOffices()` (`collaboration/service.ts:27–29,125`).
2. A concurrent page confirmation acquires the shared advisory gate.
3. Its `INSERT INTO case_page` (`case-pages/service.ts:124`) checks the `office_id REFERENCES office(id)` foreign key (`0075_case_pages.sql:3`). That requires a key-share lock, which conflicts with the existing office `FOR UPDATE`.
4. The participant transaction executes its INSERT/UPDATE (`collaboration/service.ts:133,139`). Its statement trigger now requests the exclusive advisory gate, blocked by the page transaction.

Both transactions wait on each other. PostgreSQL must abort one. This affects ordinary participant management and page creation, without unusual data.

The passing gate test (`tests/content-policy.test.ts:129`) runs a raw case UPDATE against a transaction doing reads. It does not exercise the collaboration service’s earlier office lock or the content INSERT’s foreign-key lock.

**Suggestion**: Acquire the exclusive gate at the beginning of ACL-changing domain transactions, before existing row locks. Retain triggers as a backstop. Verify the actual participant-change/page-confirmation interleaving; add a migration if database changes are needed.

### 2. [critical] Gmail seeds fabricate a common audience from the union of thread participants

**Location**: [google/gmail/insights.ts:270](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/gmail/insights.ts:270), [google/gmail/service.ts:167](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/gmail/service.ts:167).

**Finding**: Generated replies can contain information from messages with a narrower audience, but the permitted recipients include anyone appearing anywhere in the thread.

**Evidence**: The writer receives the last six message bodies (`insights.ts:236–261`). The seed records the union of every message’s From/To/Cc (`270–273`), and `prepare()` accepts any recipient in that union (`service.ts:169`).

Concrete route: an earlier message includes Bob; a later message to Alice excludes Bob and contains confidential facts. A generated reply can use those later facts. `email-smart.tsx:105` supplies that seed to the reply editor; the person adds Bob; the audience check accepts him. The seed policy has no guards or owner fence (`insights.ts:269`), so the delivery checks also accept it. `sendMail()` sends the resulting MIME through Gmail (`service.ts:300–307`).

This is an application-managed generated reply, within the repair’s boundary.

**Suggestion**: Bind the seed to the actual admitted messages and an audience authorized for all contributing content. If recipients change, recompose from sources authorized for those recipients and retain the existing confirmation flow.

### 3. [critical] Saving a seeded Gmail draft drops its audience binding

**Location**: [google/gmail/service.ts:84](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/gmail/service.ts:84), [google/gmail/service.ts:158](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/gmail/service.ts:158), [gmail-panel.tsx:196](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/google/gmail-panel.tsx:196).

**Finding**: The normal save/reopen flow loses both `seedId` and `replyToMessageId`. This breaks an unchanged seeded draft and permits an edited draft to escape its original audience restriction.

**Evidence**:

- The initial reply carries both fields (`gmail-panel.tsx:203–210,297–299`).
- Successful save immediately calls `openDraft()` (`313–315`).
- `draftView()` always returns `replyToMessageId: null` and returns no seed identity (`service.ts:84–90`).
- The reopened editor consequently carries neither binding (`gmail-panel.tsx:196–198`).
- Server seed recovery uses only an exact body digest or the supplied reply message ID (`service.ts:158–161`).

An unchanged body recovers its seed by digest, then fails because the reply ID is absent (`168`). Editing the body changes the digest; with no reply ID, the seed is no longer recovered. Changing the recipient can then pass.

The prior successful draft operation supplies only its `contentPolicy` (`173–177`). That policy does not contain the seed’s connection/message/recipient scope, and the offered reply’s policy has empty guards and owners. The real send path therefore cannot enforce the original audience after this round trip.

The existing omitted-seed test preserves `replyToMessageId` (`tests/google-email-insights.test.ts:241–244`); it does not cover save/reopen.

**Suggestion**: Persist and recover the seed’s audience binding by server-owned draft identity. Reconstruct reply context when reopening. Editing text must not erase known lineage.

### 4. [critical] Citation review sends revoked Vault text to a provider

**Location**: [citations/sources.ts:21](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/citations/sources.ts:21), [chat-turn.ts:427](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:427).

**Finding**: Current-access filtering excludes revoked conversation history, but citation review independently retrieves the conversation’s cached source text without authorization.

**Evidence**: Knowledge-tool results are persisted through `agent-tools/index.ts:324` → `sourcesFromTool()` → `recordSources()`. Vault text and adjacent context are stored in `conversation_source` (`citations/sources.ts:14–18,46–53`).

After participation or folder access is revoked, a fresh ordinary turn can proceed with the source selection cleared. `chat-turn.ts:169–172` detects revoked previous provenance and disables history-dependent memory. Nevertheless, its final citation review retrieves **all** conversation sources (`427`).

`conversationSources()` filters only office, user and conversation (`sources.ts:23–24`). It neither checks current source access nor returns the resource reference needed by the consumer. If the new answer cites a matching article or case number, `candidateSources()` selects the revoked cached source. Its text enters `reviewCitations()`’s provider state (`citations/review.ts:45–47,85–87`) and the actual TypeSafe transport (`typesafe/client.ts:64`) when configured.

Private artifact citation review uses the same unfiltered source function (`citations/artifact-review.ts:23`).

**Suggestion**: Bind cached Vault citations to canonical source identities/policies and authorize them before constructing provider state. Conversation ownership is insufficient authorization for cached business sources.

### 5. [critical] Legacy Vault receipts invalidate unchanged Drive confirmations

**Location**: [content-policy.ts:144](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/content-policy.ts:144), [google/drive/service.ts:130](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/google/drive/service.ts:130).

**Finding**: An ordinary legacy human Vault document receives a new random policy receipt every time it is read. Drive replacement binds that unstable policy into exact confirmation arguments.

**Evidence**: With no stored version policy and no artifact origin, `vaultPolicy()` constructs its fallback using `personPolicy()` (`content-policy.ts:144`). `personPolicy()` generates a fresh UUID (`31`).

`uploadVersion()` includes this entire policy in its bound review (`drive/service.ts:130–135`). The first attempt creates an approval with receipt R1. Confirming repeats preparation and produces R2, although file bytes, versions, recipient operation and permissions are unchanged.

`runGoogleOperation()` includes `__bound` in the approval input (`google/operations.ts:320–327`). `requireAndConsumeApproval()` compares canonical input exactly and rejects the different receipt (`approvals-service.ts:154–156`). An operation requiring confirmation therefore cannot complete for this supported legacy document class.

**Suggestion**: Give synthesized legacy classifications a stable identity derived from the immutable resource/version/digest, or persist their classification. Allocate random receipts when creating durable contributions, not during reads.

### 6. [critical] Vault snapshots can identify old extracted text as the newly uploaded version

**Location**: [content-policy.ts:149](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/content-policy.ts:149), [application/vault-service.ts:279](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/vault-service.ts:279).

**Finding**: Shared-writing admission combines the active version’s identity with whichever document chunks currently exist. After uploading a replacement, those chunks still belong to the previous version.

**Evidence**: `addDocumentVersion()` switches the active version and marks the document queued (`vault-service.ts:276–281`). It leaves existing chunks intact. Processing replaces them later (`vault.ts:581–604`).

Between those operations, `observeDocument()` reads the new active version/digest (`content-policy.ts:149–156`) but reads chunks solely by document ID (`158`). It checks neither processing status nor extraction version.

Concrete route: process V1, upload V2, then select that document for a page request before V2 extraction finishes. `recordPersonRequest()` persists the stale chunks as its frozen input (`shared-writing.ts:31`). Because they are nonempty, the NOT_READY check passes (`134–135`), and the shared provider receives V1 text under a V2 observation (`137–146`). The resulting proposal preserves that false provenance.

This requires no concurrent database race; the queued interval is sufficient.

**Suggestion**: Admit extracted content only when its extraction identity matches the selected immutable version/digest. Otherwise return NOT_READY or use the actual pinned original through a supported modality.

### 7. [warning] Inline audio is available to the private planner but absent from the shared request

**Location**: [api/chat/route.ts:76](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/api/chat/route.ts:76), [documents/shared-writing.ts:137](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/documents/shared-writing.ts:137).

**Finding**: The supported inline `attachments` request modality is not captured by the authenticated submission used for shared writing.

**Evidence**: For a model without native audio support, the route transcribes inline audio (`route.ts:64–74`). It passes only the original typed `text` to `recordPersonRequest()` (`76`), then appends the transcription to the private conversation message (`79`).

For a model supporting audio, the inline bytes reach the private planner (`chat-turn.ts:271–275`) but likewise never enter `content_submission`. Shared writing reads `submission.request_text` and its recorded sources/images; it has no inline-audio input (`shared-writing.ts:137–170`).

An authenticated request saying “Crie uma página conforme este áudio,” with the facts in `attachments`, gives the private planner those facts while the shared writer receives only the generic typed sentence. The immutable submission also preserves the omission on regeneration.

The normal microphone UI transcribes into composer text first, so this finding concerns the separately supported inline HTTP modality. Inline images in `body.attachments` have the corresponding omission; persisted `attachmentIds` follow another, covered path.

**Suggestion**: Freeze the actual normalized human modalities before recording the submission. Transcribed human audio belongs in that request; native modalities need a pinned supported representation or an explicit rejection.

## Plausible concerns

No additional speculative concern is promoted to a finding. In particular, I did not establish a current production producer that changes the obligations of a later Vault version enough to demonstrate the suspicious latest-version visibility check in `personal-chat/shares.ts:161`.

## Evidence and remaining gaps

- The existing `source-test-1791344311665/output.log` records **10 passed, 0 failed**. Its ACL test does not cover finding 1’s lock order.
- The handoff `checks.json` retains combined browser runs with **37/4** and **39/2** pass/fail counts, followed by narrower runs. The last recorded browser run passes one selected review test. This is **not** an all-green final combined browser run.
- The reported RSC navigation timeouts remain unexplained. I did not establish their root cause.
- I did not independently execute provider transports, concurrency reproductions, browser flows, lint, typecheck, build or tests. Parent-owned checks are outside this review.
- No live-model quality proof was inspected. The provider fixtures do not establish generated-content quality.
- Inspection was targeted source/caller/diff review, not a line-by-line audit of every unchanged function. Full editor revalidation, every session/ACL mutation service, extraction-worker concurrency, and all external reconciliation branches remain unreviewed.

## Exact inspected paths

The following inventory paths received source, targeted-range or diff inspection. Paths are relative to `apps/web`.

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
tests/shared-writing-fixture.ts
tests/document-writes.ts
tests/chat-source-boundary.test.ts
tests/content-policy.test.ts
tests/content-exits.test.ts
tests/case-pages.test.ts
tests/ai-store.test.ts
tests/agent-capabilities.test.ts
tests/agent-files-review.test.ts
tests/agent-knowledge.test.ts
tests/agent-profile.test.ts
tests/conversation-artifacts.test.ts
tests/google-email-insights.test.ts
tests/personal-chat.test.ts
tests/run-model-plan.test.ts
tests/whatsapp-send.test.ts
tests/research-case.test.ts
e2e/workspace.e2e.ts
e2e/source-policy.e2e.ts
```

Additional targeted source paths, relative to `apps/web`:

```text
db/postgres/0075_case_pages.sql
src/lib/chat-contract.ts
src/lib/chat-scope-server.ts
src/lib/collaboration/service.ts
src/lib/db/postgres.ts
src/lib/citations/sources.ts
src/lib/citations/review.ts
src/lib/citations/detect.ts
src/lib/citations/artifact-review.ts
src/lib/typesafe/client.ts
src/components/voice-recorder.tsx
src/lib/whatsapp/media.ts
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
```

Instructions, contracts and evidence inspected, relative to repository root:

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
.audit/lume-provenance-implementation.md
.audit/lume-provenance-comments-review.md
.audit/lume-editor-repair.md
apps/web/.e2e/verify/20261006T234247-d88728/source-test-1791344311665/output.log
apps/web/.e2e/verify/20261006T234247-d88728/source-handoff-1791344486879/checks.json
```

Database-wide searches examined foreign-key declaration matches beyond these paths; those matching migration files were not reviewed in full.
