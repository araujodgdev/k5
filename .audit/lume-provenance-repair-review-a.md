## Findings

Four findings, established by static producer/consumer tracing. No reproductions, tests, migrations, browser actions, writes, or nested agents were performed.

### 1. [critical] Generation attempts prevent conversation deletion and office purge

**Location**: `apps/web/db/postgres/0076_content_policy.sql:36`; `src/app/api/conversations/[id]/route.ts:21`; `src/lib/application/conversations-service.ts:44`.

**Finding**: Once a conversation has a shared-generation attempt, its ordinary deletion fails.

**Evidence**: `content_submission.conversation_id` cascades on conversation deletion, but `content_generation_attempt.submission_id` references that submission without a delete action. `prepareSharedWriting()` creates the attempt; neither conversation-deletion path removes it. Deleting an idle conversation therefore attempts to cascade-delete a still-referenced submission and encounters a foreign-key violation. Failed attempts also retain this reference.

The same table lacks `office_id`, so `purgeOffice()`’s table inventory (`office-deletion.ts:92`) excludes it. Its references prevent the purge from deleting submissions and associated approvals.

**Suggestion**: Add an additive migration or explicit transactional cleanup that gives attempts the appropriate lifecycle under conversation and office deletion. Preserve committed shared pages and their immutable policies independently.

### 2. [critical] Annex plans lose petition lineage and the reviewed scan version

**Location**: `apps/web/src/lib/annexes.ts:83–169`; `src/components/vault-annexes.tsx:48–59`.

**Finding**: The analysis-to-generation boundary discards the policies and source identities of the reviewed plan.

**Evidence**:

- `petitionText()` authorizes a selected petition document/artifact but returns only its text.
- `analyzeAnnexes()` sends both petition and scan content to the provider, then returns raw labels, ranges and ordering without a durable policy or version binding.
- The actual UI prefills editable labels from that result and submits only `scanDocumentId`, labels and ranges.
- `generateAnnexes()` retains only the scan’s policy.

With a publicly accessible scan and a restricted petition, generated labels/order derived from the petition can become shared file metadata without the petition’s obligations. Revoking petition access between analysis and generation is also never checked.

Separately, replacing scan V1 with V2 before clicking **Gerar** silently applies V1’s reviewed ranges to V2. The generation-time pin proves which current bytes were cut; it does not prove they were the bytes reviewed.

The repaired annex regression starts directly at `generateAnnexes()` with handwritten labels and a restricted scan. It does not exercise this actual analysis/UI round trip.

**Suggestion**: Retain a server-owned plan identity containing the scan version/digest and both sources’ policies. Edited labels must retain that baseline. Generation should authorize the plan and use its pinned bytes or reject a changed scan.

### 3. [critical] Cached catalog research bypasses current citation authorization

**Location**: `apps/web/src/lib/citations/sources.ts:18,40,71–73`; `src/lib/knowledge/retrieval.ts:48–59`.

**Finding**: Catalog-derived research loses its current permission requirements when it enters the citation cache.

**Evidence**: `searchKnowledgeEngine()` observes research through `observeResearch()`, producing guards for the case reference and material version. However, `sourcesFromTool()` converts that result to `web_jurisprudence` and explicitly drops its policy. `recordSources()` stores every non-Vault source with `policy: null`; `conversationSources()` authorizes only Vault entries.

Consequently, after a material becomes `restricted` or its installation loses `permission_ai`, a fresh source-independent answer mentioning a matching authority still retrieves the cached research text. `candidateSources()` selects it, and `reviewCitations()` puts it into TypeSafe’s provider state. Both chat and artifact citation review use this path.

This concerns cached catalog material with explicit revocable permissions, not independent public web-search links. The current citation regression covers revoked Vault text and an independent public web sentinel.

**Suggestion**: Preserve material-version policy for catalog-derived citations and check it on replay. Keep independent public web citations public.

### 4. [critical] Agent Gmail replies insert an unadmitted remote subject after shared writing

**Location**: `apps/web/src/lib/google/gmail/service.ts:166–198`.

**Finding**: The safe shared writer does not own the final outgoing subject of an agent reply.

**Evidence**: `prepare()` first obtains subject/body through `outboundText()`. It subsequently fetches the reply message and, whenever `context.invocation` exists, overwrites the generated subject with the remote message’s `Subject` at line 193.

For an ordinary agent reply without a smart-reply seed or managed draft, the seed audience check is skipped. `combinePolicy()` then assigns that remote subject the shared writer’s policy without adding the message’s audience or source obligations. `sendMail()` dispatches it after checking that same policy.

A source-independent authenticated request to send a short acknowledgement can therefore disclose a private message’s subject to an additional recipient selected by the private planner, even though the subject never entered the admitted writing request. Confirmation displays the bytes but does not establish source eligibility.

**Suggestion**: Treat the remote subject as an actual contributor, with explicit admission and its known recipient boundary, or retain the independently written subject. Cover the actual agent reply path separately from seeded smart replies and independent human replies.

## Inspection and limits

Source inspection included whole files or targeted ranges below; paths are relative to `apps/web`:

```text
db/postgres/0076_content_policy.sql
db/postgres/0077_content_policy_validation.sql
db/postgres/0078_source_policy_repair.sql
db/postgres/0079_citation_source_policy.sql
db/postgres/0080_calendar_share_review.sql
db/postgres/0080a_capture_upgrade_compat.sql
db/postgres/0081_source_capture_upgrade.sql
db/postgres/0082_capture_upgrade_compat_cleanup.sql
src/app/api/chat/route.ts
src/app/api/conversations/[id]/route.ts
src/app/api/approvals/[id]/route.ts
src/app/api/vault/cases/[id]/annexes/route.ts
src/app/api/vault/cases/[id]/annexes/files/route.ts
src/components/vault-annexes.tsx
src/components/google/email-smart.tsx
src/components/google/gmail-panel.tsx
src/lib/acl-transaction.ts
src/lib/content-policy.ts
src/lib/documents/service.ts
src/lib/documents/shared-writing.ts
src/lib/case-pages/service.ts
src/lib/case-pages/provenance.ts
src/lib/application/context.ts
src/lib/application/artifacts-service.ts
src/lib/application/agent-approvals.ts
src/lib/application/knowledge-service.ts
src/lib/application/runs-service.ts
src/lib/application/vault-service.ts
src/lib/application/workspace-agent-service.ts
src/lib/application/conversations-service.ts
src/lib/application/annexes-service.ts
src/lib/agent-tools/index.ts
src/lib/agent-guard.ts
src/lib/ai-store.ts
src/lib/ai-runtime.ts
src/lib/ai-sources.ts
src/lib/chat-prompt.ts
src/lib/chat-turn.ts
src/lib/capability-route.ts
src/lib/capabilities/annexes.ts
src/lib/capabilities/google.ts
src/lib/capabilities/workspace.ts
src/lib/citations/sources.ts
src/lib/citations/artifact-review.ts
src/lib/citations/review.ts
src/lib/citations/detect.ts
src/lib/knowledge/retrieval.ts
src/lib/research/case-material.ts
src/lib/google/gmail/service.ts
src/lib/google/gmail/insights.ts
src/lib/google/calendar/service.ts
src/lib/google/approval-review.ts
src/lib/google/operations.ts
src/lib/google/routes.ts
src/lib/artifact-file.ts
src/lib/document-workflows.ts
src/lib/annexes.ts
src/lib/vault.ts
src/lib/office-deletion.ts
src/lib/collaboration/service.ts
src/lib/db/postgres.ts
src/lib/db/migrate.ts
src/lib/whatsapp/send.ts
tests/annexes.test.ts
tests/google-email-insights.test.ts
tests/source-repair-behavior.test.ts
tests/source-archive.test.ts
```

Test-declaration/search inspection additionally covered `tests/content-policy.test.ts`, `tests/content-exits.test.ts` and `tests/research-case.test.ts`. Repository instructions, bundled Next route/component guides, accepted syntheses, prior reviews/verdicts, repair brief/report/TSV, and historical implementation/editor context were inspected.

Existing output logs confirm **124/124**, **20/20**, and the frozen combined **43/43** browser run. These are existing scoped results, not executions by this reviewer.

Unreviewed coverage includes untouched portions of large modules, a complete census of every ACL/session interleaving, all portal/personal-chat/Drive reconciliation branches, full editor regression inspection, and browser trace/video contents. Later tasks/fees/activity/Lume-policy UI remain excluded.
