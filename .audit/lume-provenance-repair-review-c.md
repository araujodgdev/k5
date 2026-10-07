## Findings

All findings below are **static call-chain findings**. I did not execute tests, reproduce races, change files, or modify application state.

### 1. [critical] Generic idempotency replay bypasses current source authorization

**Location**: `apps/web/src/lib/application/idempotency-service.ts:45–49,60–67`; `apps/web/src/lib/agent-tools/index.ts:278–295`.

**Finding**: Cached capability responses return content without rechecking its exact policy or recording its exposure. This bypasses the canonical artifact authorization and consumed-result repairs.

**Evidence**:

- `runCapability()` places the domain executor, `recordToolProvenance()`, output validation, and `exposeContent()` transfer inside `execute`.
- `withIdempotency()` returns deserialized `response_payload` directly on a cache hit. None of those steps runs.
- Artifact writes accept `idempotencyKey` and enter this wrapper. Their preliminary capability checks verify session/membership; `scopeCapability()` does not resolve artifact policies.
- Concrete path: restore a protected artifact version through `k5_artifacts_restore_version` with key K, then revoke access to its source while retaining office membership. Retrying `{artifactId, version, idempotencyKey: K}` returns the cached complete title/body. The normal executor would call `requireArtifact()` and the canonical writer, which enforce current access.
- For agent invocation, replay also skips provenance recording and loses the WeakMap exposure metadata. The returned bytes therefore bypass the repaired policy admission mechanism.

The consumed-edit regression in `tests/source-repair-behavior.test.ts:180` does not supply an idempotency key and exercises the canonical replay path instead.

**Suggestion**: Make replay return an exact domain result identity whose policy is reauthorized and whose exposure is recorded. An unqualified JSON response cache cannot own replay for protected content.

### 2. [critical] Annex filenames discard the selected petition’s restrictions

**Location**: `apps/web/src/lib/annexes.ts:83–95,99–135,139–169`; `apps/web/src/components/vault-annexes.tsx:48–59`.

**Finding**: The managed Analyze → Generate workflow preserves the scanned PDF’s policy but drops the petition’s policy. App-generated filenames and ordering can consequently disclose information from a more restricted petition.

**Evidence**:

- `petitionText()` authorizes the selected artifact/document, then returns only its text.
- `analyzeAnnexes()` sends that petition together with the scan to the provider. The output includes labels and petition-derived mentions/order, but no durable plan identity or source policy.
- The UI passes those generated labels to the generation endpoint, without the petition identity or plan identity.
- `generateAnnexes()` reloads only the scan, uses each label as the output filename, and supplies only the scan’s policy to `createVaultDocument()`.
- Concrete normal workflow: A selects a case-visible scan and a petition inside a restricted folder. An admitted provider label contains a detail from that petition. A clicks Generate. If the scan is at the public case root, the generated folder and filenames are visible to B, who cannot read the petition. Revoking petition access also has no effect on these outputs.

This is retained app-generated content from a known source, within the managed workflow. It does not require inferring authorship from arbitrary manually copied text.

`tests/source-archive.test.ts` checks generation from a protected scan with a supplied label; it does not exercise analysis using a separately restricted petition followed by UI generation.

**Suggestion**: Persist a reviewed plan bound to exact scan and petition versions/policies, and retain those obligations when generating filenames and documents.

### 3. [critical] An unselected processing file blocks ordinary case chat

**Location**: `apps/web/src/lib/chat-turn.ts:136–146,174`; `apps/web/src/lib/content-policy.ts:178–179`.

**Finding**: Any visible queued, processing, or failed document among the automatically discovered case files prevents an ordinary case conversation from starting, even when the person selected no document.

**Evidence**:

- With empty `body.documentIds`, `runChatTurn()` loads all visible case documents through `listVaultDocuments()`. That list has no readiness filter.
- Line 174 unconditionally calls `observeDocument()` for every discovered document.
- `observeDocument()` throws `NOT_READY` unless extraction matches the active version and hash.
- Consequently, a case-bound request such as “Olá”, with no selected source, fails before the agent/provider stream whenever one listed upload is still processing. A failed upload can keep blocking the conversation.
- The pending-source explanation and original-PDF handling elsewhere in the same flow cannot handle this state because execution fails first.

The inspected extraction tests cover an explicitly selected unavailable source. They do not cover ordinary case chat with an unselected queued/failed file.

**Suggestion**: Separate discovery/file metadata from extracted-text admission. Preserve strict extraction checks when text is actually read, while allowing unrelated conversation to proceed with unavailable implicit sources omitted.

### 4. [warning] Gmail seed generation is checked before preparation, but not before dispatch

**Location**: `apps/web/src/lib/google/gmail/service.ts:175–198,214–217,310–317`; `apps/web/src/lib/google/operations.ts:229–242`; `apps/web/src/lib/google/connections.ts:178–186,356–372`.

**Finding**: A seeded Gmail operation can dispatch after its connection’s authorization generation changes during preparation.

**Evidence**:

- `prepare()` compares the seed generation with the initially loaded connection.
- It then awaits remote reply metadata and attachment preparation.
- The persisted review binding contains the seed/compose identity and content policy, but not the checked authorization generation.
- Incremental OAuth consent preserves the connection ID while incrementing `authorization_generation`.
- Final execution checks compare only `live.id` with `row.connection_id`. Gmail seed policies contain no guard that checks this generation.
- Therefore, an operation passing the seed check at generation g can wait during preparation, undergo incremental reauthorization to g+1, and still dispatch. `googleRequest()` obtains the current token by the unchanged connection ID.

This is a stale authorization-binding defect; the inspected callback prevents changing the Google account subject, so I am not claiming a cross-account disclosure.

The inspected Gmail test changes the generation **before** a subsequent send. It does not exercise a generation change between preparation and dispatch.

**Suggestion**: Persist the seed’s authorization generation in the operation binding and check it at the final write guard.

## Inspection coverage

Paths below are relative to the repository root. “Targeted” means relevant sections and callers were inspected, not a complete audit of the file.

**Repository and audit instructions inspected:**

- `README.md`
- `apps/web/AGENTS.md`
- `apps/web/DESIGN.md` — targeted
- `apps/web/README.md` — targeted
- `apps/web/.env.example`
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — targeted
- `.audit/lume-provenance-files.json`
- `.audit/lume-provenance-synthesis.md`
- `.audit/lume-architecture-synthesis.md`
- `.audit/lume-provenance-repair-brief.md`
- `.audit/lume-provenance-review-a.md`, `.audit/lume-provenance-review-b.md`, `.audit/lume-provenance-review-c.md` — targeted
- `.audit/lume-provenance-repair-verdict.md`
- `.audit/lume-provenance-repair.md`
- `.audit/lume-provenance-repair.tsv`
- `.audit/lume-pages-review-verdict.md`
- `.audit/lume-editor-repair.md` — targeted
- `.audit/lume-provenance-how.md` — targeted
- `.audit/lume-provenance-implementation.md` — targeted

**Production files inspected substantially**, under `apps/web/`:

```text
db/postgres/0076_content_policy.sql
db/postgres/0077_content_policy_validation.sql
db/postgres/0078_source_policy_repair.sql
db/postgres/0079_citation_source_policy.sql
db/postgres/0080_calendar_share_review.sql
db/postgres/0080a_capture_upgrade_compat.sql
db/postgres/0081_source_capture_upgrade.sql
db/postgres/0082_capture_upgrade_compat_cleanup.sql
src/lib/content-policy.ts
src/lib/documents/shared-writing.ts
src/lib/documents/service.ts
src/lib/case-pages/contracts.ts
src/lib/case-pages/provenance.ts
src/lib/case-pages/service.ts
src/lib/application/context.ts
src/lib/application/artifacts-service.ts
src/lib/application/agent-approvals.ts
src/lib/application/idempotency-service.ts
src/lib/application/knowledge-service.ts
src/lib/application/annexes-service.ts
src/lib/acl-transaction.ts
src/lib/collaboration/access.ts
src/lib/collaboration/capability-access.ts
src/lib/collaboration/service.ts
src/lib/citations/sources.ts
src/lib/citations/artifact-review.ts
src/lib/knowledge/retrieval.ts
src/lib/google/gmail/service.ts
src/lib/annexes.ts
src/lib/capabilities/annexes.ts
src/lib/capabilities/workspace.ts
src/lib/capability-route.ts
src/lib/db/postgres.ts
src/lib/db/migrate.ts
src/lib/chat-scope-server.ts
src/lib/artifact-file.ts
src/lib/agent-instructions.ts
src/lib/agent-knowledge.ts
src/lib/agent-profile.ts
src/lib/conversation-artifacts.ts
src/components/vault-annexes.tsx
src/app/api/chat/route.ts
src/app/api/artifacts/[id]/route.ts
src/app/api/approvals/[id]/route.ts
src/app/api/client-portal/manage/route.ts
src/app/api/vault/cases/[id]/annexes/route.ts
src/app/api/vault/cases/[id]/annexes/files/route.ts
```

**Production files inspected selectively**, under `apps/web/`:

```text
src/lib/application/approvals-service.ts
src/lib/application/vault-service.ts
src/lib/application/runs-service.ts
src/lib/agent-tools/index.ts
src/lib/capabilities/contracts.ts
src/lib/chat-prompt.ts
src/lib/chat-turn.ts
src/lib/vault.ts
src/lib/google/gmail/insights.ts
src/lib/google/calendar/service.ts
src/lib/google/approval-review.ts
src/lib/google/operations.ts
src/lib/google/connections.ts
src/lib/google/drive/service.ts
src/lib/client-portal/service.ts
src/lib/personal-chat/shares.ts
src/lib/office-deletion.ts
src/components/google/gmail-panel.tsx
```

**Test bodies inspected**, under `apps/web/tests/`: `source-repair-behavior.test.ts`, `source-extraction.test.ts`, `source-archive.test.ts`, `google-email-insights.test.ts`, and `chat-audio-source.test.ts`, with selective coverage. `content-policy.test.ts` received declaration searches only.

**Recorded evidence inspected:** the output logs for `source-test-1791348944253`, `source-test-1791349946989`, and `source-e2e-1791350171158` under `apps/web/.e2e/verify/20261006T234247-d88728`, plus targeted report/trace-audit JSON reads. These logs record **124/124**, **20/20**, and **43/43** passing respectively. I did not rerun them or independently verify manifest hashes.

**Unreviewed coverage:** complete chat/editor UI behavior and browser tests; full AI runtime/store and provider-wire admission; Drive import worker; research producers; personal-chat workers; WhatsApp and fees exits; exhaustive lock-order/FK/nesting analysis across every owner. Those areas should not be treated as cleared by this review.
