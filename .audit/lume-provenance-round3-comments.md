Files touched: **none**. Deletions performed: **0**.

Reviewed all **112 scoped files**. Recommend deleting **286 comment tokens**, grouped into **245 ranges**, covering **365 comment lines across 52 files**. Each `//` line counts as one token; each block comment counts once. Delete only comment text at the ranges below; preserve surrounding code and JSX delimiters.

Deletion candidates, with paths relative to the workspace root:

```text
apps/web/eslint.config.mjs: 9-11, 20-21, 26-28, 32, 34, 42, 46
apps/web/scripts/typesafe-eval.ts: 1
apps/web/src/components/agent-chat.tsx: 76, 129, 145, 161, 174-177, 200, 222-225, 279-282, 308-311, 383, 416, 429, 451, 512-514, 739-743, 898
apps/web/src/components/research-case-linker.tsx: 41
apps/web/src/components/vault-annexes.tsx: 79-80
apps/web/src/lib/agent-instructions.ts: 12-16, 25, 34, 95, 111
apps/web/src/lib/agent-knowledge.ts: 28, 80, 112, 124, 132
apps/web/src/lib/agent-profile.ts: 24, 64
apps/web/src/lib/agent-tools/index.ts: 256-260, 286-287, 303-307, 348
apps/web/src/lib/ai-policy.ts: 31, 38-39, 45-49
apps/web/src/lib/ai-providers.ts: 22, 29, 69, 75-76
apps/web/src/lib/ai-runtime.ts: 53, 187, 209
apps/web/src/lib/ai-sources.ts: 21
apps/web/src/lib/application/approvals-service.ts: 41-45, 199
apps/web/src/lib/application/research-capability-service.ts: 34
apps/web/src/lib/application/runs-service.ts: 56-59, 61, 63, 66, 72-73, 80, 90-91
apps/web/src/lib/application/vault-service.ts: 37, 53, 141, 152-153, 286-287, 295, 306-309, 344-345, 384
apps/web/src/lib/capabilities/contracts.ts: 17-22, 51-55, 119-122
apps/web/src/lib/chat-turn.ts: 303-304
apps/web/src/lib/citations/review.ts: 13-18
apps/web/src/lib/document-workflows.ts: 26, 31-34, 38-39, 53, 138, 146-147, 161, 201, 221-222, 232, 279
apps/web/src/lib/documents/managed-file.ts: 31
apps/web/src/lib/feedback-triage.ts: 16, 66, 81, 104, 146
apps/web/src/lib/google/connections.ts: 35, 59, 111, 120, 122, 147, 179, 234, 253, 300, 329
apps/web/src/lib/google/gmail/insights.ts: 58, 63, 96, 182, 223, 289, 309
apps/web/src/lib/google/gmail/triage.ts: 49, 81, 107
apps/web/src/lib/personal-chat/domain.ts: 125-126
apps/web/src/lib/personal-chat/email-worker.ts: 91
apps/web/src/lib/research/case-assessment.ts: 29, 47
apps/web/src/lib/research/case-content.ts: 127, 146
apps/web/src/lib/research/jurisprudence-score.ts: 10-16
apps/web/src/lib/research/retrieval.ts: 70
apps/web/src/lib/research/trademarks/wipo.ts: 106, 124
apps/web/src/lib/typesafe/agenda.ts: 35, 62
apps/web/src/lib/typesafe/client.ts: 39, 45, 113
apps/web/src/lib/typesafe/rerank.ts: 23, 34-35
apps/web/src/lib/typesafe/verification.ts: 58, 63-64, 74
apps/web/src/lib/vault.ts: 32, 39, 61-65, 94, 102, 111, 122, 193-194, 275-276, 332-333, 356, 372-374, 380, 432, 439-440, 511-516, 555-562, 592-593, 600, 621-622, 654-655, 660, 670, 734
apps/web/src/lib/chat-status.ts: 24
apps/web/tests/agent-approvals.test.ts: 30, 92-93
apps/web/tests/artifact-edits.test.ts: 42-43, 66
apps/web/tests/capabilities.test.ts: 32, 61, 81, 87, 114, 119, 124, 128, 134, 141, 205, 212, 218, 225, 242, 258, 268, 279, 287, 292, 329, 347, 356, 362, 375, 379, 383, 387, 393, 404-405, 415, 489, 493, 499, 503, 536-537, 546, 552, 572, 575, 590, 596, 642, 650, 722, 725, 729, 737, 742, 750, 773, 785, 793
apps/web/tests/collaboration.test.ts: 115, 136, 158, 190, 195, 219, 295
apps/web/tests/documents.test.ts: 247
apps/web/tests/google-fixture.ts: 61, 86
apps/web/tests/jurisprudence-score.test.ts: 18, 31, 46, 49, 73
apps/web/tests/openai-effort.test.ts: 18, 24
apps/web/tests/platform-auth.test.ts: 25
apps/web/tests/research-case.test.ts: 176, 253
apps/web/tests/research-core.test.ts: 525
apps/web/tests/run-model-plan.test.ts: 28, 40, 47
apps/web/tests/typesafe.test.ts: 69, 74, 331, 352
```

`MUST KILL` flags identify refactor targets, not application edits made by this review:

- `apps/web/src/components/vault-annexes.tsx:64-81` — **MUST KILL `VaultAnnexes`’s effect**: remove the `exhaustive-deps` suppression and make `start`, `setPlan`, and `setResult` dependencies explicit through extraction or stable callbacks; this rule protects closure correctness. [Rule proof](https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps).
- `apps/web/eslint.config.mjs:28-29` — **MUST KILL `eslintConfig`’s `no-misused-promises` override**: `checksVoidReturn: false` disables correctness checks for callbacks, properties, returns, variables, and inherited methods; the React-handler justification does not cover that scope. [Rule proof](https://typescript-eslint.io/rules/no-misused-promises/).
- `apps/web/src/components/agent-chat.tsx:448-452` — **MUST KILL `ComposerTools.pick`**: replace the implicit zero-delay timer/render ordering with an explicit point at which the input’s `accept` value is applied.
- `apps/web/src/components/agent-chat.tsx:174-178` — **MUST KILL `DocumentLinks.announce`**: its name hides document opening/reloading side effects; rename or extract those actions.
- `apps/web/src/lib/agent-instructions.ts:111-112` — **MUST KILL `flat`**: give the prompt-boundary encoding a specific name instead of explaining its security purpose beside a generic string helper.
- `apps/web/src/lib/agent-knowledge.ts:112-113` — **MUST KILL `quoted`**: expose knowledge-block delimiter handling through a named encoder or typed prompt boundary.
- `apps/web/src/lib/agent-tools/index.ts:256-260,303-307` — **MUST KILL `runCapability` / `agentTools` boundary narration**: make the execution boundary explicit in the API; the second block currently describes tool construction while attached to `ApprovalRequest`.
- `apps/web/src/lib/ai-policy.ts:45-49` — **MUST KILL `groundedInstructions`**: separate the named sourcing policy from conversational instructions instead of explaining that distinction in a product sermon.
- `apps/web/src/lib/ai-providers.ts:75-79` — **MUST KILL `modelFor`’s proxy branch**: extract a factory named for the Responses protocol; the installed router confirms custom URLs select Chat Completions, but the additional “were proven on” justification is unproven history.
- `apps/web/src/lib/application/approvals-service.ts:41-52` — **MUST KILL `canonicalize`**: name its deep approval-value canonicalization explicitly; the long warning discusses a `JSON.stringify` replacer implementation absent from the live path.
- `apps/web/src/lib/application/runs-service.ts:80-96` — **MUST KILL `startRun`’s legacy model-column projection**: extract or type the compatibility projection; previous-release worker expectations are our-code coupling.
- `apps/web/src/lib/application/vault-service.ts:306-309,344-348` — **MUST KILL `copyIntoVault`**: expose deterministic-copy identity and insert reconciliation through named operations instead of the private idempotency justification.
- `apps/web/src/lib/document-workflows.ts:31-44,272-275` — **MUST KILL `configurationFailures`**: replace the object-identity error side channel with an explicit typed failure path; the inspected code proves the WeakMap workaround, not an unavoidable vendor constraint.
- `apps/web/src/lib/chat-turn.ts:303-308` — **MUST KILL `runChatTurn`’s `onStepFinish` link-readiness assumption**: make the ordering requirement explicit; the inspected vendor fragment did not establish the claimed ordering against subsequent tool execution.
- `apps/web/src/lib/vault.ts:61-70` — **MUST KILL `VaultStorageUnavailableError`’s incident justification**: express backend failure classification through the error contract; `LUME-1E` history is not an issue link or external constraint.
- `apps/web/src/lib/vault.ts:93-98` — **MUST KILL `requireVaultWorkspace`’s lazy session import workaround**: separate authenticated ingress from the worker-loadable vault module.
- `apps/web/src/lib/vault.ts:510-521` — **MUST KILL `retryVaultDocument`**: expose the retryable live-document transition through a named state operation; the queued/failed/tombstone explanation is our own state model.
- `apps/web/src/lib/vault.ts:555-572` — **MUST KILL `claimQueuedDocument`’s concurrency justification**: expose the PostgreSQL lease claim explicitly; the retained prose about D1’s transaction limitations is stale.
- `apps/web/src/lib/research/trademarks/wipo.ts:106,124` — **MUST KILL `createWipoBrowser.search`’s implicit portal phases**: name bootstrap, logo-session setup, and query navigation; the claimed vendor persistence behavior was not proven within the permitted checks.

The following **112 comment tokens survive**. Public-contract keeps state caller requirements, output semantics, ownership, ordering, or error behavior on exported APIs; the named implementations/types provide the local proof.

```text
apps/web/src/lib/agent-instructions.ts: 73, 116
  saveInstruction: create/update and version guard; instructionsPrompt: target-specific block and empty result.

apps/web/src/lib/agent-knowledge.ts: 11-16, 26, 115-119, 154
  KnowledgeMode: always/search semantics; ALWAYS_BUDGET: aggregate character unit;
  knowledgePrompt: complete-document budget/ordering; knowledgeCandidates: candidate ordering.

apps/web/src/lib/agent-profile.ts: 9-13, 49, 77
  TemplateScope/module contract and resolveDocumentTemplateId: personal/office precedence;
  templateCandidates: eligible Word files and ordering.

apps/web/src/lib/agent-tools/index.ts: 396, 633
  toolSummary: pt-BR result line; toolFailureMessage: domain-safe failure output.

apps/web/src/lib/ai-providers.ts: 14, 27, 37, 44
  ModelCredential.session: provider-specific meaning; providerCatalog: catalog semantics;
  conversationSession: stable opaque identity; protectedModelFor: native protocol and guarded transport.

apps/web/src/lib/ai-runtime.ts: 27, 68-71, 82, 95, 104-107, 140, 154, 156, 161-164, 193
  AgentFeatures: optional integrations; createAgent: selected/pinned model;
  testModelCredential/probeTaskModel: probe shapes; silentWav: sample format;
  errorClass: safe classification; UsageDetails.calls/webSearchCalls: billing units;
  recordUsage: transactional completed-only charging; StructuredOptions.signals: output-derived signals.

apps/web/src/lib/ai-sources.ts: 76, 81
  selectedPinnedResearchSources: worker-only pinned resolution;
  resolveArtifactResearchSource: immutable cited version/chunk resolution.

apps/web/src/lib/ai-store.ts: 21, 33-39
  conversationBootstrap: owner-scoped initial state; mergeHistory: append versus replace-and-truncate.

apps/web/src/lib/annexes.ts: 22, 37-40, 120, 177
  annexModelOutput: ranges/citation shape; orderAnnexPlan: petition-derived ordering;
  analyzeAnnexes: retained input identities; generateAnnexes: reviewed-range PDF outputs.

apps/web/src/lib/application/agent-approvals.ts: 29, 167, 197-201
  describeAgentApproval: human-readable proposal; resourceHref: result-derived navigation;
  decideAgentApproval: execution of the stored proposal.

apps/web/src/lib/application/approvals-service.ts: 31, 176-180, 217
  publicApproval: response exclusions; centralApprovalCapabilities: confirmation boundary;
  approvalIdFromMessage: refusal/proposal identification.

apps/web/src/lib/application/vault-service.ts: 27, 223-226, 274-277, 367-370, 399, 407
  asCapabilityError: status/code translation; addDocumentVersion: immutable history;
  ingestUpload: single-use owner-bound reference; saveArtifactToVault: version/format/destination identity;
  readyDocumentIds: readiness validation; findDeletedDocument: cleanup-only lookup.

apps/web/src/lib/artifact-file.ts: 13-16, 31-34
  artifactTemplate: precedence; artifactVaultFile: PDF/DOCX export behavior.

apps/web/src/lib/capabilities/contracts.ts: 37, 107, 672-675
  Capability.publish: absent/empty semantics; citationSummaryDto: public review result;
  publishedCapabilities: adapter publication filtering.

apps/web/src/lib/chat-turn.ts: 51
  ChatTurn.lease: persistence/release ownership requirement.

apps/web/src/lib/content-admission.ts: 16, 51
  contentAdmission: exact-input ownership and construction timing;
  admissionTransport: invocation-wide denial latch.

apps/web/src/lib/content-policy.ts: 69
  assertPolicyAccess: ACL checks versus historical content obligations.

apps/web/src/lib/content-result.ts: 40
  mapContentResult: explicit owner-evidence mapping.

apps/web/src/lib/documents/shared-writing.ts: 26
  recordPersonRequest: authenticated pre-planner ingress requirement.

apps/web/src/lib/feedback-triage.ts: 95, 117
  triageState: label-valued output; processNextFeedbackClassification: one-ticket/empty semantics.

apps/web/src/lib/google/connections.ts: 21, 40-43, 63, 130, 216-219, 245, 266-270, 357
  Owner: trusted ownership; requireConnection: live ownership/scopes;
  startGoogleConnect/completeGoogleConnect: bound OAuth flow;
  closeConnection: revocation/erasure/retention behavior; sweepRemovedMembers: maintenance revocation;
  accessToken: shared refresh lease; googleRequest: refresh/error translation.

apps/web/src/lib/google/gmail/service.ts: 69-72
  getThreadForReading: reader-only original HTML boundary.

apps/web/src/lib/google/gmail/triage.ts: 36
  triageMail: metadata-only, nonmutating operation.

apps/web/src/lib/knowledge/retrieval.ts: 33-37
  searchKnowledgeEngine: authorized scope and pushed-down vector filtering.

apps/web/src/lib/research/case-assessment.ts: 174
  processNextResearchAssessment: one leased assessment per invocation.

apps/web/src/lib/research/case-profile.ts: 33
  assertResearchCaseAccess: live private-case authorization.

apps/web/src/lib/research/jurisprudence-score.ts: 27, 38-42
  comparableUrl: normalized matching identity; webSearchLinks: accepted provenance-bearing result shapes.

apps/web/src/lib/research/retrieval.ts: 74
  searchCorpus: current-public-material search coverage without a recent-document universe cap.

apps/web/src/lib/typesafe/client.ts: 15-18
  evaluate: shared platform connection and tenant/public-boundary semantics.

apps/web/src/lib/typesafe/connection-probe.ts: 6
  testTypeSafeConnection: fixed application-controlled probe input.

apps/web/src/lib/vault.ts: 15-20, 46-49, 172, 217, 227, 236, 251, 298, 315-318, 343, 400-403, 416-419, 464-468, 500, 552, 713-718, 741
  Viewer: null/server ownership contract; VaultFolder: access-field disclosure;
  updateVaultCase: omitted/empty semantics; folder lookup/path/people APIs: visibility and bounds;
  updateVaultFolderAccess/deleteVaultFolder/assertVaultDocumentMove: access-preserving operations;
  findVaultDocument/createVaultDocument: liveness and upload ownership;
  original-file APIs: checked access and legacy-key behavior;
  STORAGE_RETRY_DELAYS_SECONDS: retry schedule;
  drainQueuedDocument/processDocumentIfQueued: dispatch and claim behavior.

apps/web/src/lib/chat-status.ts: 1-4, 36
  ChatStatus: transient transport contract; toolStatus: user-facing activity output.

apps/web/tests/google-fixture.ts: 21-24, 33, 35
  FakeGoogle: recorded matching/failure contract; on: precedence and one-shot routes;
  failNetwork: delivered-versus-undelivered failure simulation.
```

Proven dependency/platform exceptions, included in that survivor count:

- `agent-chat.tsx:135,729` — `clearMessages` / `loseAccess`: browser policy can make `sessionStorage` access throw; both comments sit on actual guarded storage accesses. [Platform proof](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage).
- `agent-chat.tsx:645` — `sendMessage`: the installed AI SDK’s `src/ui/chat.ts:375-383` awaits file-part preparation; this wrapper freezes scope before entering it.
- `agent-chat.tsx:821` — `initialize`: the code shares `creatingConversation.current`; React documents the extra development effect cycle. [Dependency proof](https://react.dev/reference/react/StrictMode).
- `agent-chat.tsx:1047` — `ConversationCards`: time-dependent rendered labels justify the adjacent `suppressHydrationWarning`. [React’s timestamp exception](https://react.dev/reference/react-dom/client/hydrateRoot#suppressing-unavoidable-hydration-mismatch-errors).
- `ai-runtime.ts:91,218` — `testModelCredential` / `generateStructured`: installed Mastra code resolves error finishes and distinguishes strict versus warning structured-output handling; both guards/options remain on live calls.
- `content-admission.ts:43` — `contentAdmission.admit`: the session recheck follows the awaited lease operation and uses `clock_timestamp()` through `assertWorkspaceSession`; PostgreSQL distinguishes wall-clock time from transaction-start time. [Database proof](https://www.postgresql.org/docs/current/functions-datetime.html).
- `google/connections.ts:101-103` — `idTokenClaims`: called on the token endpoint response, with issuer/audience/expiry checks; Google documents the direct HTTPS token-endpoint trust exception. [Vendor proof](https://developers.google.com/identity/openid-connect/openid-connect).
- `google/connections.ts:166` — `completeGoogleConnect`: the mismatched-account branch avoids revocation; Google revocation can invalidate project-wide grants/tokens. [Vendor proof](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow?authuser=19).
- `google/connections.ts:376` — `googleRequest`: the retry is specifically gated on 401; HTTP defines that response as an unapplied request lacking valid authentication. [Protocol proof](https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.2).
- `vault.ts:722` — `drainQueuedDocument`: `webpackIgnore` is an executable bundler directive on the runtime-only `cloudflare:workers` import. [Compiler proof](https://webpack.js.org/api/module-methods/#magic-comments).

Skips:

- `apps/web/db/postgres/0089_research_metadata_admission.sql:1`, `lume_policy_valid` — narration: `-- Metadata without published materials retains the catalog source obligation.` Excluded from deletion recommendations because applied migrations are protected by the explicit scope instruction.
- `eslint.config.mjs:23` — keep the `node:test` safe-call exemption itself; the runner owns registered top-level tests. Delete its two-line commentary, which overstates that awaiting a top-level test is wrong. [Runner contract](https://nodejs.org/api/test.html).
- **47 scoped files** contain no comment tokens; no TypeScript suppression directives were found.
- Generated instruction blocks, application behavior, audit files, git state, tests, DB, browser automation, and children were untouched.
