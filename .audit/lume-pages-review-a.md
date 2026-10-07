## Findings

### 1. [critical] Normal personalization disables the requested agent workflow

**Location:** [chat-turn.ts:167](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:167), [service.ts:76](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/service.ts:76).

**Finding:** Any writing preference, working memory, learned memory or configured knowledge makes the conversation permanently ineligible for shared-page creation and editing.

**Evidence:** `runChatTurn` records `complete: false` whenever those inputs exist. `recordProvenance` makes that irreversible, and `agentSources` rejects before creating an approval. For example, a user with “prefiro respostas curtas” cannot ask Lume to correct a shared page. A new conversation still loads the same person-level memory. Artifacts generated in that conversation also become unpublishable.

This also affects identifiable knowledge documents whose permissions could be recorded, and routine discovery tools such as `k5_vault_list_cases`, which fall into the incomplete-provenance fallback.

**Suggestion:** Build shared proposals from an explicitly bounded, recorded input bundle, preserving identifiable source restrictions and providing a reviewed boundary for user-owned inputs. Keep personalization intact and genuinely unknown protected inputs blocked; the current permanent conversation-wide veto does not deliver the stated workflow.

### 2. [critical] Saving an untracked artifact into Vault bypasses publication restrictions

**Location:** [vault-service.ts:402](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/vault-service.ts:402).

**Finding:** Missing provenance is rejected by page publication but accepted by `saveArtifactToVault`.

**Evidence:** A legacy agent artifact has no `ai_source_provenance` row. `artifactProvenance` correctly classifies it as incomplete, but this path calls `readProvenance` directly and skips its restriction when the result is `undefined`.

Concrete path: retain a draft derived from a restricted case, lose access to that source, then save the draft into another case or the personal Library. `copyIntoVault` checks only the destination and exports the stored content. The new document carries an origin reference, without enforceable upstream dependencies. It can subsequently be shared through the existing Vault/message paths, whose checks concern the copied document.

**Suggestion:** Use one canonical artifact-provenance decision at publication and Vault-copy boundaries. Unknown agent provenance must not become unrestricted merely by choosing another copy mechanism.

### 3. [critical] A failed or unapproved edit can certify an unsafe legacy artifact

**Location:** [artifacts-service.ts:15](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/artifacts-service.ts:15), [artifacts-service.ts:83](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/artifacts-service.ts:83).

**Finding:** `preserveProvenance` initializes an existing artifact from the current conversation’s provenance without incorporating the artifact’s original provenance, and commits before approval or version validation.

**Evidence:** Start with an untracked legacy agent artifact containing protected material. In a clean conversation, call `k5_artifacts_edit` using its ID and a stale version. Line 85 first records `{ complete: true, dependencies: [] }`; line 86 then throws the version conflict. The artifact content never changes, but `artifactProvenance` now returns the recorded “complete” value instead of its legacy rejection. Human publication of the current version consequently succeeds without the original restrictions.

The inverse also occurs: proposing an edit from an incomplete conversation permanently poisons an otherwise publishable human artifact even if the person cancels.

**Suggestion:** Merge the canonical existing-artifact provenance with the generation’s provenance, and commit that change atomically with the successful content/version mutation. A failed or cancelled proposal must not change the artifact’s security classification.

### 4. [critical] Concurrent approved edits can commit an unreadable dependency cycle

**Location:** [service.ts:116](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/service.ts:116), [provenance.ts:27](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/case-pages/provenance.ts:27), [postgres.ts:61](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/db/postgres.ts:61).

**Finding:** Cycle detection is transactional for one write but does not protect the dependency graph against concurrent writes to different pages.

**Evidence:** Read initially independent pages A and B, then propose edits to both. Their approvals respectively contain dependency B and dependency A. Confirm them concurrently:

1. Each transaction locks its own approval and target page.
2. Each writes its dependency edge.
3. Each post-write `requirePage` reads the other page’s still-committed, dependency-free version.
4. Both validations pass and both transactions can commit.

Dependency reads use ordinary `SELECT`s; transactions use plain `BEGIN`. Neither serializes this graph invariant. Afterwards A → B → A causes reads, listing, export, editing and restoration of both pages to fail. Sequential cycle detection does roll back correctly; this finding concerns the concurrent interleaving.

**Suggestion:** Enforce acyclicity through serializable transactions with retry, or a shared serialization boundary for dependency-graph mutations.

### 5. [critical] Restoring a version can erase edits made while restoration is pending

**Location:** [document-workspace.tsx:314](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/document/document-workspace.tsx:314), [document-workspace.tsx:130](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/document/document-workspace.tsx:130).

**Finding:** The restore callback changed from `load(true, true)` to `load(true)`, removing protection for intervening local edits in both private and shared editors.

**Evidence:** Trigger restoration, let `beforeRestore` finish saving, then type while the restore request is pending. The editor remains editable. When restoration succeeds, `load(true)` fetches the restored version and calls `apply`, which unconditionally calls `draft.replace` and remounts the editor. Text typed before the next autosave is discarded without a conflict choice. Server-side version checks cannot protect this unsaved local text.

**Suggestion:** Preserve edits made after restoration began, using the existing preservation check or a captured draft generation.

Review performed read-only. No tests, servers, browser sessions, edits or subdelegation were run.
