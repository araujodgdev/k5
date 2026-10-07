## Overview

K5 preserves the intended ownership split: `ai_artifact` belongs to one person in their home office; `case_page` belongs to a case in the case owner’s office. Publishing copies an explicitly selected artifact version into a new page. It does not share the private artifact or conversation.

The source boundary is less coherent. Chat accumulates a permanent conversation-wide provenance record, artifacts inherit that record independently of content commits, and pages retain live resource dependencies. Vault, connector exports, and client-portal publication use separate copy policies. The reviewed failures follow from treating these different boundaries as if they formed one complete provenance system.

All anchors below are relative to `apps/web/`. This explanation reconciles the three reviews against the current source; it does not report runtime reproduction.

## Key Concepts

- **Ownership versus audience.** Artifact ownership is `(office_id, user_id)`. Page access is current case membership, destination-folder access, and access to every recorded source. `created_by` does not bypass page authorization. See `src/lib/ai-store.ts:ownedArtifact`, `src/lib/case-pages/service.ts:requirePage`.
- **Provenance.** `Provenance` contains a Boolean `complete` and dependencies on cases, folders, Vault documents, or pages. Dependencies have resource IDs, but no source version, content digest, excerpt, or derivation edge. `recordProvenance()` unions dependencies and ANDs completeness permanently. See `case-pages/contracts.ts:4`, `case-pages/provenance.ts:59`.
- **Citation evidence.** `conversation_source` and artifact `source_refs` support citation checking. They are neither a complete model-input inventory nor an authorization policy. `conversationSources()` returns stored citation text by conversation ownership without reauthorizing the original resources. See `citations/sources.ts:11`, `ai-store.ts:publicArtifact`.
- **Approval.** `capability_approval` stores canonical operation input, actor, target, version, expiry, and status. Page approvals additionally store dependencies, originating conversation, and a recoverable result pointer. Approval binds an operation; it does not grant access to protected upstream material.

## How It Works

### 1. Chat admission freezes resource identity, not the complete input bundle

`src/app/api/chat/route.ts:41` resolves the user message, authorizes its scope, and stores `metadata.lumeScope`. Regeneration uses the original stored message and scope. `chat-scope-server.ts:authorizeMessageScope` resolves canvas resources, checks document and case identity, and authorizes selected resources.

This is a useful boundary: navigation cannot silently substitute another document for an already submitted request. However, the stored scope is not a snapshot of every byte subsequently supplied to the model. Writing rules, knowledge, memory, focused-resource metadata, and current source content are loaded separately.

`chat-turn.ts:runChatTurn` assembles these model inputs:

- Application instructions, writing rules, injected knowledge, learned memory, clock, resource labels, selected-document IDs/names/statuses, and focus instructions.
- The last 24 stored messages reconstructed by `chat-prompt.ts:chatPromptMessages`.
- Eligible attachment text and image bytes.
- Selected Vault images and pending PDF originals.
- Tool results during the model’s execution.
- Mastra working memory injected by its memory processor.

Before generation, the turn reauthorizes the previous conversation’s recorded dependencies and the focused artifact’s dependencies. It then adds selected Vault-document dependencies, the focused page, and the current case. A false completeness bit does **not** stop private chat; it prevents later shared generation. See `chat-turn.ts:162`.

### 2. Input ownership does not establish input authorship

**The person’s instruction.** Typed chat text and explicitly submitted human edits are direct inputs from the authenticated person. Their upstream authorship is unknowable if they contain pasted material. The application currently treats them as human input rather than recording source obligations.

Even ordinary `role: user` text is not necessarily entirely authored by that person. `components/lume/lume-workspace.tsx:173` constructs “Pedir ao Lume” messages by inserting the document’s full title and up to 280 characters of selected text before the person’s instruction. It also sends the selection structurally.

For shared pages, `chat-turn.ts:185` checks the structured title/selection with the injection guard. The duplicate embedded in user-message text remains untouched and enters subsequent history. Thus the reviewed injection bypass is confirmed: withholding one representation does not withhold the other.

**Writing rules.** `agent-instructions.ts:instructionsPrompt` loads enabled personal and office rules, filters by target, removes angle brackets, flattens newlines, and emits title/content pairs inside instruction blocks. These are identifiable `agent_instruction` records with scope, ID, version, and updater.

Personal rules may be directly entered by the person or written by an agent through the centrally approved settings capability. Office rules are office-authored instructions, not necessarily words from the current person. Their stored identity is useful evidence, but `instructionsPrompt()` returns only a string. Chat marks any nonempty string as incomplete instead of distinguishing these origins. See `application/agent-settings-service.ts:changeAgentSettings`, `application/approvals-service.ts:169`.

**Configured knowledge.** `agent-knowledge.ts:knowledgePrompt` retains authoritative Vault document IDs internally. It checks the owning office, deletion state, and folder visibility. Ready documents in `always` mode contribute extracted chunks joined with newlines, within a 40,000-character chat budget. Documents that do not fit, and `search` documents, contribute IDs, names, and optional usage notes instead.

The resulting string includes document IDs, but the loader returns no structured dependency bundle. Chat marks all nonempty configured knowledge incomplete—including a search-only listing. These inputs are traceable documents, not intrinsically unknown material. Their contents and names can still originate from third parties; personal configuration does not make them person-authored. The injected knowledge path uses quoting conventions, not `guard.check()`.

**Working memory.** `agent-memory.ts:agentMemory` uses one resource per person/office, with message-history storage and semantic recall disabled. Mastra writes the memory through its model-facing `updateWorkingMemory` tool. K5 instructs the model to remember only the person’s statements and never document/tool content, but does not attach source IDs to individual memory entries or enforce that distinction structurally.

The distinction between the loaders matters:

- `readMemory()` returns at most 6,000 characters for application use.
- Mastra’s processor reads `mastra_resources.workingMemory` directly and injects the stored value into a system-memory block. The K5 callback observes that read but does not truncate or replace its value.

This is visible in `agent-memory.ts:49` and the installed processor at `node_modules/@mastra/core/dist/agent-Dk0N0Nlg.js:18386`. The memory tool accepts model-produced Markdown text; it does not prove that each statement came from a human instruction.

**Learned memory.** `honcho-memory.ts:queueMemoryChange` extracts newly added lines from working memory and sends them as statements attributed to the person, with conversation/event metadata. `honchoContext()` retrieves a peer card and inferred representation, joins them, truncates to 2,500 characters, and injects them as fallible context.

These are derivatives of model-maintained memory. Conversation IDs identify where a change was queued; they do not identify the protected documents, messages, or excerpts underlying a conclusion. Existing working and learned memory therefore cannot safely be declared source-free merely because it is person-owned. Clearing memory changes future loading; it does not repair the conversation’s already-false completeness bit.

### 3. Uploads and connectors retain identities that the provenance union cannot express

**Chat uploads.** `chat-attachments.ts:createChatAttachment` stores original bytes and extracted text under an owned attachment ID. Resolution checks person, office, conversation, and message binding. This establishes who submitted the file and which bytes the application retained—not authorship of its contents.

`chat-prompt.ts:15` reconstructs eligible attachments for the last 24 messages:

- Text comes from persisted `extracted_text`, with newer attachments receiving the text budget first.
- Images come from the original object-storage bytes.
- DOCX embedded images are extracted from the stored original when vision is available.
- Names, attachment IDs, and omission notices also reach the model.

Inline audio is either sent directly for the current turn or transcribed into stored user-message text by the route. Selected Vault images and pending PDFs use their original bytes, with authorization before and after retrieval (`chat-turn.ts:262`).

Attachment IDs are absent from `SourceDependency`. Any current or stored chat attachment makes the conversation incomplete. Uploading is a known human submission event; its upstream origin remains unproven.

**Vault uploads.** `application/uploads-service.ts:createUploadRef` stores an owned upload reference with a digest. `consumeUploadRef()` enforces owner, expiry, and single use. `ingestUpload()` creates a Vault document and first version. Once ingested, its document ID is an authoritative authorization handle; no automatic connection is established to an artifact or source from which the person may have exported the upload.

**Vault retrieval.** Search returns document/chunk IDs and up to 4,000 characters per source. `getKnowledgeSource()` returns the selected chunk plus bounded adjacent text. These paths recheck access and expose identities that `recordToolProvenance()` can turn into document/case/folder dependencies. See `knowledge/retrieval.ts:36`, `application/knowledge-service.ts:26`.

**Research and connectors.** Other loaders also have authoritative identities:

- Research sources carry reference, material-version, judgment, and chunk IDs (`ai-sources.ts:selectResearchSources`).
- Google Docs returns selected file ID, revision ID, title, and extracted text (`google/drive/service.ts:225`).
- Gmail returns message/thread IDs, headers, body text, and attachment-part IDs (`google/gmail/service.ts:31`).
- Drive/Gmail imports retain account, external source identity, source version, and resulting Vault document/version (`google/drive/import.ts:18`, `processDriveImport`).

These identities are not equivalent to permission to share their contents. Direct connector results are guarded where listed in `GUARDED_TOOLS`, but their capabilities fall into provenance’s incomplete fallback. Research results lacking `documentId` do too. A completed connector import subsequently behaves as a Vault copy; its external-origin metadata is not consulted by `sourceAccess()`.

### 4. Provenance records successful capabilities, not every model-visible input

`agent-tools/index.ts:runCapability` authorizes and executes a capability, records provenance, then parses its output DTO. The injection processor runs on tool results afterward.

`case-pages/provenance.ts:recordToolProvenance` recognizes:

- Page operations: returned/referenced pages, case, and folder.
- Artifact operations with an input `artifactId`: the artifact’s existing provenance.
- Selected Vault/knowledge operations: document IDs.
- Three exempt operations: help search, resource opening, artifact creation.

Other successful capabilities mark the conversation incomplete. That includes ordinary case/folder/artifact discovery. The recorder also accumulates dependencies for content later withheld by the injection guard, so its coverage can be unnecessarily broad.

The opposite gap occurs on approval-required exceptions. No successful result returns, so the recorder never runs. `describeAgentApproval()` nevertheless loads the entire page publication/restore preview and places title and content into a persisted `data-approval.summary` (`application/agent-approvals.ts:30`).

`chat-prompt.ts:46` replays that summary verbatim, including when the proposal was cancelled or failed. Updating the approval state does not remove its content. The proposal’s dependencies remain in `case_page_approval`, not necessarily conversation provenance.

This confirms both consequences identified independently by reviewers:

1. Revoked preview material can be replayed because the conversation lacks the dependency needed to reject it.
2. Another generated output can inherit “complete” conversation provenance while using that preview text.

Citation recording cannot close this gap: it is a separate, selective record, not the admission boundary.

### 5. Private artifacts and shared pages commit provenance differently

**Private artifacts.** `application/artifacts-service.ts:createArtifact` creates an owned artifact and version 1. Agent creation first copies conversation provenance into a separate artifact-provenance transaction. Human creation normally creates no provenance row.

`artifactProvenance()` classifies an unrecorded artifact as human only when all origin indicators are absent: no agent flag, run ID, conversation ID, or source references. Otherwise it returns incomplete. Once a provenance row exists, that row takes precedence over these origin indicators.

`saveArtifact()` and `editArtifact()` call `preserveProvenance()` before approval, version validation, or successful content mutation. This confirms the apparently opposite review findings:

- An incomplete conversation permanently restricts a clean unchanged artifact, even if the proposed edit is cancelled or rejected.
- A complete clean conversation can initialize an untracked legacy agent artifact as complete, even if a stale-version edit subsequently fails.

The helper merges with an existing provenance row, but does not first incorporate the canonical missing-row classification. Artifact provenance is resource-wide, not versioned. Human saves and restores neither remove accumulated dependencies nor recover historical provenance.

The content/history operation itself already has a transactional foundation: `ai-store.ts:updateArtifact` uses a batch containing a row lock, version-conditioned history inserts, and version-conditioned replacement. The provenance write sits outside that transaction.

Private artifact reads remain ownership-based. `getArtifact()` does not itself reauthorize upstream sources; focus admission and shared publication perform additional checks. Thus private ownership and continuing source eligibility are currently distinct policies.

**Background-generated artifacts.** This is not exclusively a pre-migration problem. `document-workflows.ts:223` still creates run artifacts without `ai_source_provenance`. Runs retain selected source IDs, pinned research material, templates, citation evidence, and serialized writing/knowledge text, but those records do not establish exhaustive lineage for the generated text. Current run output therefore takes the same incomplete fallback unless separately recorded.

**Shared pages.** `case-pages/service.ts:resolveMutation`:

- Copies the exact currently matching artifact version for publication.
- Requires the current page version for update/restore.
- Preserves existing dependencies; restore additionally merges the historical version’s dependencies.
- Adds conversation dependencies for agent writes, excluding the destination page’s direct self-reference.
- Rechecks source access.

Human page creation/update avoids the conversation-provenance requirement. Human publication still requires exact review. The absence of agent invocation identifies the surface; it does not prove that submitted text has no upstream sources.

At confirmation, `mutate()` locks the approval, checks canonical input, reauthorizes stored dependencies, rechecks the originating conversation, and commits page content, page version, approval consumption, and result pointer in one transaction. Existing target pages are locked and compared by version.

This preserves an important behavior: publication copies a private version while leaving the original private. The destination page’s effective audience is the intersection of destination access and current source access—not every case participant.

Approval input remains exact, but source obligations are not frozen: confirmation also unions dependencies accumulated by the conversation after proposal creation. Consumed retries return the currently authorized page row; although `result_version` is stored, retry does not return a frozen historical result.

### 6. Page dependencies are live authorization graphs

A dependency on page A means “authorize A and recursively authorize A’s **current** dependencies.” It does not mean “authorize the source set associated with the version of A that supplied these bytes.” Historical page versions also traverse current dependencies of referenced pages.

This explains the sequential failure. After reading/editing A and then B, the persistent conversation contains both identities. B can depend on A; a subsequent edit of A introduces B. The post-write access check detects A → B → A and rolls back despite unchanged permissions.

Concurrent updates are a separate failure, not a contradiction. Each transaction locks its own destination page and approval. Source traversal uses ordinary reads. The transaction helper issues plain `BEGIN`, with no explicit graph serialization or isolation override. Under ordinary READ COMMITTED execution, both transactions can observe the other page’s previous dependency-free state and commit reciprocal edges.

Afterward, authorization rejects both pages. Restore cannot repair them because it also begins by requiring current page access.

The path-local `visited` set detects cycles but does not memoize already-authorized ancestors across branches. Dense acyclic graphs therefore repeat the same checks exponentially. See `case-pages/provenance.ts:12`, `service.ts:116`, `db/postgres.ts:49`.

### 7. Vault archival can preserve the immediate audience, but does not preserve upstream obligations

`application/vault-service.ts:saveArtifactToVault` checks ownership and exact current version, then renders PDF or DOCX. `copyIntoVault()` uses source identity, artifact version, format, and destination to derive an idempotent document ID. It stores independent file bytes and creates the document, first Vault version, and `vault_agent_origin` together.

The existing mechanism supports a private copy:

- The person’s Library is in their home office. Migration `0059_associate_access.sql` enforces one member per office; case participation does not grant Library access.
- A case folder marked private is visible only to its creator, subject to accessible ancestors and continuing case membership.

However, the current guard rejects every recorded incomplete artifact or artifact with any dependency **before examining the destination**. It therefore blocks these same-audience archives. Conversely, a missing provenance row passes the guard, including untracked agent/run output.

The copy retains source kind, artifact ID/version, and user as origin metadata. It does not retain enforceable upstream dependencies. This is the critical distinction: existing storage can retain a private archive, but the current policy neither evaluates the immediate audience nor carries obligations into later exits.

PDF rendering uses captured title/content. DOCX rendering may additionally use the currently selected or default Vault template (`artifact-file.ts:15`). That template is another identifiable input to exported bytes; it is not part of the archive’s provenance guard or deterministic copy identity.

Several existing exits can subsequently broaden access:

- **Move or folder access change.** `updateDocument()` can move a Library document into a case. `assertVaultDocumentMove()` protects another creator’s restricted ancestor rules, but an archive creator can move material out of their own private folder. Folder creators can broaden that folder’s visibility. These checks concern the copy’s location, not its upstream sources (`vault.ts:284`, `vault.ts:323`).
- **Messages sharing.** `personal-chat/shares.ts:createShare` pins an active Vault version and creates a grant to a recipient. Read checks the grant, recipient, retained document/version, deletion, and source-case continuity. It does not authorize artifact/page ancestry. The recipient branch does not require the recipient to have the sender’s folder access. Explicit revocation stops future reads; replacing the active document version does not replace the pinned shared bytes.
- **Google/Gmail.** Vault files can become Gmail attachments or replace Drive-file contents. Drive replacement already binds Vault version, digest, and byte size and verifies them again before sending (`google/drive/service.ts:118`). These operations do not consult the new upstream provenance records.
- **Downloads.** Artifact exports authorize the private owner; shared-page exports use `getPage()` before and after rendering. Once bytes have been delivered, later server-side revocation cannot retract that download.
- **Direct client-portal publication.** `client-portal/service.ts:publishPortalArtifact`, reachable through `api/client-portal/manage/route.ts`, checks ownership and version, renders a PDF, rechecks the version, and stores an independent portal file with `artifact:<id>:v<version>` as `source_ref`. It does not consult artifact provenance. Portal-file or client-access revocation controls future portal downloads, not source revocation.

## Where Things Live

These existing boundaries remain useful grounding for a bounded comparison:

- **Identity and current access:** `application/context.ts:assertCapabilityAllowed`, `collaboration/access.ts:caseAccess`, `contextForCase`, and migration `0060_folder_access_fail_closed.sql`. Case/source checks can already accept a transaction reader; the private home-office and shared destination-office distinction is explicit.
- **Input admission:** `chat-scope-server.ts:authorizeMessageScope`, `chat-turn.ts:runChatTurn`, `chat-prompt.ts:chatPromptMessages`, and the instruction/knowledge/memory loaders. They expose the concrete locations where identifiable input becomes prompt text.
- **Capability execution and injection:** `agent-tools/index.ts:runCapability` and `agent-guard.ts:UntrustedToolResultGuard`. Authorization, output DTOs, injection handling, and provenance recording are separate hooks today.
- **Exact review and committed page writes:** `application/approvals-service.ts:canonicalInput` and `case-pages/service.ts:mutate`. The page service already owns transactional content/version/approval-result commits.
- **Transactions:** `database.batch` provides atomic statement batches; `withTransaction` provides a connection-scoped reader/writer with row locks. Transaction-scoped advisory locks are already used by `personal-chat/shares.ts:createShare`. The transaction helper supplies neither automatic serializable isolation nor retries.
- **Copies and exits:** `application/vault-service.ts:copyIntoVault`, `vault.ts:createVaultDocument`, `personal-chat/shares.ts`, `artifact-file.ts`, connector services, and `client-portal/service.ts`. Origin metadata and version/digest binding exist, but are not a shared source-policy boundary.
- **Editor lifecycle:** `document-drafts.ts`, `components/document/document-workspace.tsx`, and `components/lume/lume-workspace.tsx` already provide draft preservation and resource invalidation. The reviewed restore/access-loss failures are gaps in connecting those existing mechanisms.

## Gotchas and Explicit Unknowns

The tests in `tests/case-pages.test.ts` exercise ownership, nested folders, exact publication, source revocation, conflict handling, and transactional rollback. Successful agent scenarios manually seed complete provenance. They do not demonstrate admission through ordinary personalization, preview replay, legacy Vault copying, or concurrent graph mutation. I inspected those tests but did not run them.

The editor findings also match current code: restoration calls `load(true)` without its available `preserveEdits` option; save-discovered access loss becomes a generic error, while navigation waits for that save and resource invalidation occurs through a different resolver. See `document-workspace.ts:130`, `:175`, `:314`, and `lume-workspace.tsx:83`.

Existing records cannot reconstruct all legacy origins. Citation references, run inputs, attachment IDs, connector IDs, and memory conversation IDs provide partial evidence. They cannot recover arbitrary pasted text, uncaptured model inputs, or the dependencies underlying old memory conclusions.

The traces establish application-visible text and file transformations, not the exact serialized network request for a particular historical model call. No runtime request, database contents, provider configuration, or actual memory contents were inspected. In particular, a memory instruction prohibiting source-derived entries is not evidence that historical memory obeyed it.

No files were changed; no git commands, tests, servers, browser sessions, or subdelegation were used.
