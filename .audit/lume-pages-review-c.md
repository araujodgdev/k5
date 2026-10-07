## Findings

### 1. [critical] Approval previews introduce model-visible content without recording its provenance

**Location**: [agent-approvals.ts:43](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/agent-approvals.ts:43), [chat-turn.ts:366](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:366), [provenance.ts:85](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:85)

**Finding**: Publication and restoration previews can carry protected content into subsequent model turns without adding its dependencies to conversation provenance.

**Evidence**: Page proposals throw `APPROVAL_REQUIRED` before `runCapability` reaches `recordToolProvenance`. Their dependencies are saved only on `case_page_approval`. `describeAgentApproval` nevertheless embeds the complete preview content into a durable `data-approval` summary, which `chatPromptMessages` replays verbatim.

Concrete counterexample: a clean conversation publishes an explicitly identified artifact derived from restricted source S, without opening or reading that artifact separately. The reviewed copy correctly retains S. On the next turn, the model obtains its text from the approval summary, while conversation provenance still lacks S. Creating another root page from that text can therefore omit S and expose it to participants who cannot access the source. Revoking S also fails to prevent replay of that summary.

**Suggestion**: Keep full previews in the human review surface and replay only approval metadata/status to the model. Any preview text admitted to model history must pass the same provenance, current-access and injection boundaries as an ordinary source read.

### 2. [critical] Failed or cancelled agent edits permanently restrict unchanged private documents

**Location**: [artifacts-service.ts:40](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/artifacts-service.ts:40), [artifacts-service.ts:85](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/artifacts-service.ts:85)

**Finding**: Artifact provenance changes before approval, version validation, edit validation or successful content mutation.

**Evidence**: `preserveProvenance` writes immediately and commits independently. In `editArtifact`, it even precedes the stale-version check. A conversation with working memory consequently marks an otherwise publishable human document incomplete when Lume merely proposes an edit. Cancelling that proposal—or rejecting a stale version or invalid replacement—leaves its text and version unchanged but permanently prevents publication and Vault saving. `recordProvenance` cannot restore completeness.

**Suggestion**: Store proposed dependencies with the approval. Commit artifact content, version and provenance together after successful approval and CAS validation.

### 3. [critical] Personalization eliminates the normal shared-page agent workflow

**Location**: [chat-turn.ts:167](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:167), [service.ts:76](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/service.ts:76), [provenance.ts:107](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:107)

**Finding**: Ordinary writing preferences, knowledge configuration or working memory make shared agent creation/editing unavailable, with no supported recovery that preserves personalization.

**Evidence**: An enabled rule such as “respostas curtas” makes `writingRules` nonempty and permanently records `complete=false`. `agentSources` then rejects create/update/restore before presenting an approval. Starting another conversation reloads the same person-level rules and memory, so the prescribed “conversa nova” cannot recover the workflow. Agent publication can produce a proposal, but confirmation rejects its incomplete originating conversation.

Additionally, normal discovery calls such as `k5_vault_list_cases`, `k5_vault_list_folders` and `k5_artifacts_list` fall into the unclassified-tool branch and permanently invalidate an otherwise clean conversation.

**Suggestion**: Introduce a source-aware shared-generation boundary while preserving private chat personalization. Track known knowledge resources explicitly and isolate genuinely unclassified/private context; do not make deleting personalization the recovery mechanism.

### 4. [critical] Untracked agent artifacts bypass restrictions through Vault

**Location**: [vault-service.ts:402](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/vault-service.ts:402), [provenance.ts:76](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:76)

**Finding**: Vault copying treats missing provenance as permission, whereas reviewed publication correctly treats untracked agent output as incomplete.

**Evidence**: A pre-0075 agent artifact has no `ai_source_provenance` row. `artifactProvenance` rejects its publication because of `created_by_agent`, `run_id` or other origin fields. `saveArtifactToVault` instead calls raw `readProvenance`; `undefined` passes its guard.

The existing “Salvar no Cofre” path can therefore copy a stale draft containing protected material into a public case root. The resulting Vault document retains an origin pointer but no enforceable upstream dependencies. Participants can download it, and subsequent retrieval tracks only that newly accessible document.

**Suggestion**: Use the canonical artifact provenance resolver for every sharing exit path, including retries. A Vault copy must preserve upstream restrictions or establish that its destination does not broaden access.

### 5. [critical] The Vault guard also blocks private preservation without an audience change

**Location**: [vault-service.ts:403](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/vault-service.ts:403)

**Finding**: The new guard rejects every incomplete or source-derived artifact before examining its destination.

**Evidence**: A document generated with a harmless writing preference cannot be saved into the person’s own Library or a “Só eu” folder. Even complete provenance containing only the current case dependency triggers rejection. The existing SaveForm offers these destinations, but the service unconditionally redirects the person toward shared-page publication.

This changes private Vault behavior without identifying an unauthorized disclosure. Publishing a case page is not an equivalent private archival operation.

**Suggestion**: Make the copy decision depend on destination access and retained source restrictions. Preserve private saving when it introduces no broader audience.

### 6. [critical] Selected shared text bypasses the injection guard through the user message

**Location**: [lume-workspace.tsx:180](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/lume/lume-workspace.tsx:180), [chat-turn.ts:185](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:185), [chat-prompt.ts:32](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-prompt.ts:32)

**Finding**: “Pedir ao Lume” sends shared title/selection text through two paths, and only one is guarded.

**Evidence**: `workspace.ask` embeds the complete document title and up to 280 characters of the selection into ordinary user-message text. `runChatTurn` checks the structured selection and may withhold it from `documentFocus`, but `chatPromptMessages` still passes the duplicate user text to the model unchanged.

A participant can place an injection in the title or opening selection. Another participant selects it and asks for an edit. Even when the classifier flags that exact text, it remains in the model prompt and future history.

**Suggestion**: Send the person’s instruction separately from structured source text. Admit the source excerpt through one guarded path; retain its display representation separately.

### 7. [critical] Concurrent dependency writes can commit a permanent source cycle

**Location**: [service.ts:120](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/service.ts:120), [provenance.ts:30](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:30), [postgres.ts:61](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/db/postgres.ts:61)

**Finding**: Cycle validation is transaction-local, while concurrent writes lock only their own target pages.

**Evidence**: Start with independent pages A and B. One approved agent edit adds B as A’s source; another adds A as B’s source. Each transaction locks a different page. Ordinary source reads see the other transaction’s previously committed, dependency-free row, so both post-write validations can succeed and both transactions commit.

Afterward, `sourceAccess` rejects A→B→A. Reads, exports and `resolveMutation` all fail, including for creators. Human editing cannot repair the cycle because it first requires access and preserves existing dependencies.

**Suggestion**: Validate dependency mutations under a concurrency-safe graph transaction, using appropriately ordered locks or serializable execution with conflict handling.

### 8. [warning] Acyclic source graphs cause exponential authorization work

**Location**: [provenance.ts:12](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:12)

**Finding**: The traversal detects cycles along each path but repeatedly reauthorizes shared ancestors.

**Evidence**: A valid sequence where each new page depends on all preceding pages forms a dense DAG. Checking a page with 20 predecessors requires roughly one million recursive source visits. The depth limit does not help: no path exceeds 20 levels. Page listing repeats these traversals again for each result.

This graph can arise through supported list/read/create operations; it does not require malformed data.

**Suggestion**: Use separate “currently visiting” and “already validated” sets within one access traversal, plus a bounded work budget. This preserves cycle detection while eliminating repeated ancestor work.

Read-only review. No tests, servers, browser sessions, mutations or subdelegates were run.
