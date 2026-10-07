Files touched: **none**. Deletions performed: **0**. Additional comment deletions recommended: **0**.

Reviewed all **112 scoped files** in place, using the freeze manifest plus documented parent changes. Remaining comments comprise **98 public-contract tokens**, **14 dependency/compiler tokens**, and **one protected migration comment**. No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck` directives remain.

Two actionable flags remain:

- **Flag 2 — MUST KILL `eslintConfig`’s broad void-return exemption**, [apps/web/eslint.config.mjs:24](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/eslint.config.mjs:24). `checksVoidReturn: false` disables every void-return category, including correctness checks for ignored asynchronous callbacks. The [rule documentation](https://typescript-eslint.io/rules/no-misused-promises/) supports narrowing categories independently. The parent’s completed diagnostic identifies two scoped callbacks: `ResearchCaseLinker`’s polling effect at `apps/web/src/components/research-case-linker.tsx:103` and `ReferenceRow`’s polling effect at `apps/web/src/components/research-case-references.tsx:70`. These are timer callbacks, so `attributes: false` does not exempt them. The diagnostic establishes suppressed violations, not an observed rejected request. Preserve the fence when narrowing enforcement; five other affected files are outside scope.
- **Flag 14 — MUST KILL `runChatTurn`’s dependence on stream-consumer timing**, [apps/web/src/lib/chat-turn.ts:303](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:303). Make consulted-link registration complete before dependent scoring executes. On the current Mastra path, `MastraModelOutput` awaits `onStepFinish` in `trip-wire-EBUkLDk_.js:3965`, but the workflow producer emits `step-finish` at `agent-Dk0N0Nlg.js:28027` through an `outputWriter` that only enqueues at `28158`. It does not await the consumer callback. `scoreJurisprudence`, at `apps/web/src/lib/research/jurisprudence-score.ts:74-76`, reads the resulting set and persisted sources. This establishes an absent ordering barrier; an incorrect score was **not reproduced**. The legacy awaits at `dist-CGImzm5F.js:5948,6625` do not settle this path.

The following fixes satisfy their original flags:

- **1:** `apps/web/src/components/vault-annexes.tsx:43-81`, `setPlan`, `start`, and `setResult` use `useCallback`; the effect explicitly lists them.
- **3:** `apps/web/src/components/agent-chat.tsx:426-431`, `ComposerTools.pick` assigns `input.accept` before `input.click()`.
- **4:** `apps/web/src/components/agent-chat.tsx:172,196,880`, `openOrReloadFromToolStep` names the action at all three sites.
- **5:** `apps/web/src/lib/agent-instructions.ts:102-104`, `encodeInstructionLine` names the encoding.
- **6:** `apps/web/src/lib/agent-knowledge.ts:112,139`, `escapeKnowledgeDelimiters` names the delimiter handling.
- **9:** `apps/web/src/lib/ai-providers.ts:45-56,76`, `modelFor` reuses `protectedModelFor` with the redirect-refusing transport.
- **10:** `apps/web/src/lib/application/approvals-service.ts:41-51`, `canonicalizeApprovalValue` names the recursive operation.
- **11:** `apps/web/src/lib/application/runs-service.ts:76,90`, `legacyModel` explicitly projects the typed plan entry into the legacy columns.

Reject these prior code flags:

- **7:** `apps/web/src/lib/agent-tools/index.ts:256-294,299-303`, `runCapability` already parses, authorizes, executes, projects, replays, and records provenance; `agentTools` constructs the published catalog. The misplaced narration is gone.
- **8:** `apps/web/src/lib/ai-policy.ts:42-49`, `groundedInstructions` is already a named policy, separate from `conversationStyle` at `apps/web/src/lib/chat-turn.ts:94`. No additional coupling was demonstrated.
- **12:** `apps/web/src/lib/application/vault-service.ts:301-341`, `copyIntoVault` explicitly hashes source/destination identity, authorizes transactional reuse, checks tombstones and moved copies, and reconciles PostgreSQL `23505`. Another wrapper is not required by the evidence.
- **13:** `apps/web/src/lib/document-workflows.ts:31-40,214-264`, `configurationFailures` preserves typed errors using the same closed-over `RunRow`. Installed Mastra’s `DefaultExecutionEngine.formatResultError`, `agent-Dk0N0Nlg.js:3562-3567`, returns serialized JSON, losing the application error prototype. This is a proven dependency constraint, not a demonstrated faulty carrier.
- **15:** `apps/web/src/lib/vault.ts:61-65`, `VaultStorageUnavailableError` already expresses HTTP 503 and retains `cause`. The deleted incident anecdote warranted no constructor refactor.
- **16:** `apps/web/src/lib/vault.ts:88-94`, `requireVaultWorkspace` explicitly defers the session import until authenticated ingress executes. No faulty behavior requiring relocation was established; the complete worker import graph was not certified.
- **17:** `apps/web/src/lib/vault.ts:495-501`, `retryVaultDocument` already names and implements the live failed/queued transition in one update.
- **18:** `apps/web/src/lib/vault.ts:530,535-544`, `claimQueuedDocument` explicitly claims a PostgreSQL lease with `FOR UPDATE SKIP LOCKED`. The stale D1 explanation is gone.
- **19:** `apps/web/src/lib/research/trademarks/wipo.ts:107-132`, `createWipoBrowser.search` visibly performs homepage, optional logo upload, and query navigation on the same page. No local defect was established. Vendor persistence remains unverified; that is not evidence of a bug.

The **14 dependency/compiler comment tokens** retain their exceptions:

- `agent-chat.tsx:134,706`, `clearMessages` / `loseAccess`: guarded storage operations can throw under browser policy. [Platform proof](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage).
- `agent-chat.tsx:622`, `sendMessage`: installed `ai/src/ui/chat.ts:383` awaits file conversion; scope is copied before SDK entry.
- `agent-chat.tsx:793`, `initialize`: both development effect runs share `creatingConversation.current`. [React proof](https://react.dev/reference/react/StrictMode).
- `agent-chat.tsx:1018`, `ConversationCards`: the adjacent hydration suppression covers time-dependent text. [React timestamp exception](https://react.dev/reference/react-dom/client/hydrateRoot#suppressing-unavoidable-hydration-mismatch-errors).
- `ai-runtime.ts:91,217`, `testModelCredential` / `generateStructured`: installed Mastra exposes resolved errors and distinguishes structured-output warning from error handling.
- `content-admission.ts:43`, `contentAdmission.admit`: the session recheck follows the awaited lease; PostgreSQL distinguishes wall-clock time from transaction-start time. [Database proof](https://www.postgresql.org/docs/current/functions-datetime.html).
- `google/connections.ts:99-101`, `idTokenClaims`: direct HTTPS token-endpoint trust, with issuer, audience, and expiry checks. [Google proof](https://developers.google.com/identity/openid-connect/openid-connect).
- `google/connections.ts:162`, `completeGoogleConnect`: revocation can invalidate grants across the project. [Google proof](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow).
- `google/connections.ts:368`, `googleRequest`: the single retry is gated on an unapplied, unauthenticated 401 response. [Protocol proof](https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.2).
- `vault.ts:691`, `drainQueuedDocument`: `webpackIgnore` is an executable compiler directive. [Compiler proof](https://webpack.js.org/api/module-methods/#magic-comments).

All paths above lacking a prefix are under `apps/web/src/components/` for `agent-chat.tsx`, otherwise `apps/web/src/lib/`. The 98 JSDoc tokens retain the public-contract exception described in the first report. The package-specific `node:test` safe-call exemption at `apps/web/eslint.config.mjs:20` remains justified by [runner-owned test execution](https://nodejs.org/api/test.html).

Skipped deletion of `apps/web/db/postgres/0089_research_metadata_admission.sql:1`, `lume_policy_valid`: `-- Metadata without published materials retains the catalog source obligation.` Applied migrations are protected.

No writes, git mutations, tests, DB operations, browser automation, or children. Root validation and functional acceptance remain parent-owned.
