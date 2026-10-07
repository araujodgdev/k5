## Findings

### 1. [critical] Personalization disables the normal shared-page workflow

**Location**: `apps/web/src/lib/chat-turn.ts:167`, `apps/web/src/lib/case-pages/service.ts:79`, `apps/web/src/lib/agent-memory.ts:70`

**Finding**: Any writing rule, injected knowledge, learned memory or working memory permanently marks the conversation incomplete. Shared agent writes then fail before reaching review.

**Evidence**: A user whose only preference is “respostas curtas” asks Lume to edit an accessible page. `chat-turn.ts` records `complete=false`; `resolveMutation()` calls `agentSources()`, which rejects the operation. Creating a private artifact first also fails as a workaround: `preserveProvenance()` copies that incompleteness, and publication rejects the artifact.

The suggested “conversa nova sem memória” does not resolve this: working memory uses the person/office resource, and writing rules and knowledge load again in every conversation. The successful agent-write tests manually seed complete provenance rather than exercising this admission path.

**Suggestion**: Separate reviewed person-owned inputs from protected source obligations, return actual dependencies from known knowledge loaders, and provide a supported page-writing context that preserves stored personalization. The current blanket bit removes the requested workflow.

### 2. [critical] Live recursive dependencies break ordinary multi-page editing and permit permanent concurrent cycles

**Location**: `apps/web/src/lib/case-pages/provenance.ts:27`, `apps/web/src/lib/case-pages/provenance.ts:92`, `apps/web/src/lib/case-pages/service.ts:111`, `apps/web/src/lib/case-pages/service.ts:133`

**Finding**: Conversation-wide accumulation makes unrelated pages depend on each other’s current dependency graphs. Repeated editing becomes impossible; concurrent approvals can commit graphs that make both pages inaccessible.

**Evidence**: Start with accessible pages A and B with no dependencies. In one conversation, edit A, then B, then A again. Focus/tool reads accumulate `{A,B}`. Editing B records dependency A. Editing A next adds B; its post-write `requirePage()` traverses `A → B → A` and rolls back. Every permission remains valid, yet this normal persistent-conversation workflow fails.

There is also a write-skew path. After reading A and B, propose separate updates to both and confirm them concurrently. Each transaction locks only its own approval and destination page. Under the plain `BEGIN` in `db/postgres.ts:61`, each post-write check can observe the other page’s old dependency-free row. Both commit, leaving `A → B → A`. Subsequent reads, edits, exports and restores reject both pages; restoration itself requires successful page authorization.

**Suggestion**: Model authorization obligations as a bounded graph that validates every reachable resource once, retaining denial for missing or revoked sources. A recursion back-edge alone does not establish unauthorized access. If cycles remain forbidden, graph validation and mutation must also be serialized.

### 3. [critical] Cancelled or failed private edits permanently change the untouched artifact’s restrictions

**Location**: `apps/web/src/lib/application/artifacts-service.ts:40`, `apps/web/src/lib/application/artifacts-service.ts:85`, `apps/web/src/lib/case-pages/provenance.ts:67`

**Finding**: Artifact provenance commits before approval, version validation or applying the edit.

**Evidence**: A clean human draft is publishable. Lume proposes changing it from a conversation with incomplete provenance. `preserveProvenance()` immediately records `complete=false`, then `requireAgentApproval()` throws `APPROVAL_REQUIRED`. The person cancels. Content and version remain unchanged, but the draft can no longer be published or saved into Vault.

The same mutation happens before stale-version rejection or invalid targeted edits. Because completeness uses logical AND and dependencies only accumulate, later human saves cannot repair the restriction.

**Suggestion**: Store proposed provenance with the pending operation. Commit artifact content, version and provenance atomically only when the approved write succeeds.

### 4. [critical] Legacy agent artifacts bypass publication restrictions through Vault

**Location**: `apps/web/src/lib/application/vault-service.ts:402`, `apps/web/src/lib/case-pages/provenance.ts:76`

**Finding**: Vault copying accepts missing provenance, while publication correctly classifies an untracked agent artifact as incomplete.

**Evidence**: Existing agent/run artifacts receive no provenance rows from migration 0075. For such an artifact, `artifactProvenance()` returns incomplete, so publication refuses it. `saveArtifactToVault()` instead calls `readProvenance()` and allows `undefined`.

A stale artifact containing another participant’s protected material can therefore be saved into the owner’s Vault library or a public case folder. `copyIntoVault()` stores only an origin reference, without the upstream restrictions. Existing document sharing in `personal-chat/shares.ts:93` checks the new Vault document’s permissions, allowing that flattened copy to reach recipients who could not access the original source.

**Suggestion**: Use the canonical artifact-provenance boundary for Vault copying too, preserving the distinction between untracked human drafts and untracked agent output.

### 5. [critical] Publication previews enter replayed history without their source restrictions

**Location**: `apps/web/src/lib/application/agent-approvals.ts:41`, `apps/web/src/lib/agent-tools/index.ts:281`, `apps/web/src/lib/chat-turn.ts:367`, `apps/web/src/lib/chat-prompt.ts:50`

**Finding**: The full publication preview becomes model input on later turns, but its dependencies remain attached only to the approval.

**Evidence**: An artifact from an earlier conversation has complete provenance depending on protected source X. In another conversation focused on case Y, call publication directly using the supplied artifact ID/version. Proposal creation checks X and stores its dependencies in `case_page_approval`.

The executor then throws `APPROVAL_REQUIRED`, so `recordToolProvenance()` never runs. `describeAgentApproval()` nevertheless puts the artifact’s entire content into the stored approval summary. After access to X is revoked, conversation reauthorization sees no dependency on X, and `chatPromptMessages()` replays that full summary—even if the proposal was cancelled or confirmation failed.

The write remains protected, but the later model request consumes revoked material.

**Suggestion**: Record preview dependencies in conversation provenance before persisting or emitting the preview. Provenance must cover actual replayed inputs, including approval summaries, rather than only successful tool results.

### 6. [warning] A known shared-page revocation leaves a dirty editor trapped on the denied resource

**Location**: `apps/web/src/components/document/document-workspace.tsx:175`, `apps/web/src/components/lume/lume-workspace.tsx:86`

**Finding**: Save/read responses reporting lost access become ordinary editor errors instead of triggering resource and draft invalidation.

**Evidence**: A participant edits an open page after being revoked. Autosave receives 404, but preserves the editor and sets the draft to `error`. Navigating elsewhere calls `saveOpen()`, retries the denied save and returns false, blocking navigation. Closing the active tab uses the same navigation path.

Invalidation occurs only through `resolveResource()`. The e2e revocation scenario explicitly clicks the current tab to invoke that path; it does not cover revocation discovered through saving.

**Suggestion**: Route confirmed shared-resource access loss from editor operations through the existing revocation/invalidation boundary, then allow navigation away.

Read-only review; no edits, tests, servers, browser sessions or subdelegates were used.
