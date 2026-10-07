# Domain-owned retained results and submitted research writes

Read-only candidate A. This document proposes signatures and behavior. It contains no production implementation. The parent owns synthesis, implementation, and verification. No tests, databases, browsers, git commands, or child agents were used. Only this Markdown is written.

Throughput checkpoint: n/a, read-only design investigation. The user's no-delegation instruction overrides architect, how, why, and p3-mode delegation. Their grounding and design disciplines are applied locally. Historical motivation comes from the accepted syntheses and parent corrections, without a git-history claim.

## Problem

People need useful shared research profiles, notes, and assessments while their private Lume conversation remains private. The current domain writers accept planner strings without retained policy. The canonical reference reader embeds an assessment, but replay reconstructs only top-level excerpts. Managed-file delivery confuses a readable original with a contribution the reader may disclose. Provider admission precedes storage, configuration, and reservation waits. Repair these handoffs inside existing owners. Preserve format-1 `ContentPolicy`, separate private artifacts and shared pages, independent requests, authorized historical results, human editing, exact confirmations, and current runtime accounting. The [round3 verdict](lume-provenance-round3-verdict.md) binds this design over earlier briefs.

## Usage (caller's view)

The public operations stay with their domains. An HTTP submission is authenticated human input. An agent request names the resource and the server-held current submission. It never supplies a replacement profile or notes as independently authored text. Research services return complete policy-bearing domain results. Adapters wrap and parse those results without rediscovering contributors.

The following examples are design pseudocode. All named additions are proposed, not implemented.

### Human profile editing through the existing HTTP capability

```ts
// capability-route.ts, after authenticated body parsing and scope resolution.
const human = await recordResearchSubmission(context, {
	kind: 'profile', caseId, expectedVersion: body.expectedVersion,
	viewToken: body.viewToken, fields: researchCaseProfileInput.parse(body),
});
const result = await saveResearchCaseProfile(context, {
	caseId, expectedVersion: body.expectedVersion, input: human,
});
return Response.json(result.value, { headers: noStoreHeaders });
```

`recordResearchSubmission` is a trusted ingress operation. The browser cannot supply a human-origin discriminant, policy, or seed omission. The owner resolves the actual base revision and any generated prefill from its server binding. A first unseeded form accepts typed or pasted human content under the existing human-contribution convention. Editing a generated field preserves that field's inherited policy. A reader with a filtered profile does not overwrite hidden facts by saving the visible form.

### Agent editing the profile or notes

```ts
// research-capability-service.ts. agentInput contains IDs and versions only.
const profile = await saveResearchCaseProfile(context, {
	caseId: input.caseId, expectedVersion: input.expectedVersion,
	input: { kind: 'request' }, // submissionId and generationId come from context.
});
return mapContentResult(profile, value => ({ profile: value }));

const reference = await updateResearchCaseReference(context, {
	referenceId: input.referenceId, expectedVersion: input.expectedVersion,
	purpose: input.purpose,
	notes: { kind: 'request' },
});
return mapContentResult(reference, value => ({ reference: value }));
```

The research owner prepares an exact structured proposal from the person's request, eligible current profile fields, and admitted selected sources. It uses the existing stateless structured runtime. The existing approval surface shows the exact structured result through an authorized review endpoint. Confirmation commits those exact bytes through the same research writer. Opaque attempt IDs recover retries. Confirmation retains the original agent context and cannot turn a raw planner body into person origin.

Purpose, material, and assessment IDs remain ordinary typed reference operations. If notes are unchanged or absent, no writing generation occurs. Adding a reference with empty notes remains possible. A requested notes change uses the same text provenance contract as profile fields.

### Worker and exact keyed replay

```ts
// case-assessment.ts owns the persisted job, snapshot, lease, and result policy.
await processNextResearchAssessment();

// The worker's internal provider call uses the job's exact saved input.
const evaluation = await evaluate(job.execution.context, 'research', job.input, {
	admission: job.execution, signal: leaseSignal,
});

// Generic idempotency captures the complete domain result, without field casts.
const binding = captureCapabilityReplay(parsedContentResult);
const replayed = await replayCapabilityResult(context, storedResult, binding);
```

The worker reconstructs resource scope, not a substitute session. It retains the original requesting session and source policy across queueing and retries. A stale result remains readable when its exact contributors are still authorized. An assessment with revoked contributors returns metadata and `result: null`. An exact cache replay with revoked contributors refuses the stored content rather than substituting today's reference or reexecuting the write.

### Connector callers

```ts
// Internal Gmail preparation. The public send operation still owns the workflow.
const attachment = await stageManagedFile(context, {
	documentId, version: selectedVersion,
});
const prepared = { ...compose, attachments: [attachment] };
await runGoogleOperation(context, operationUsing(prepared));

// Personal sharing stores the exact delivery binding. Reads reuse that binding.
await createShare(person, workspace, threadId, documentSelection);
await readDocumentShare(recipientContext, shareId);
```

The connector caller receives bytes with both access authorization and disclosure policy. The original author's eligible independent original can be disclosed without giving the recipient access to the private case. A folder reader cannot use that exception. Staging and dispatch still check the sender's exact managed access. The recipient read checks a separate share grant and disclosure policy.

## Shape

### Grounded ownership and current flow

Observed source anchors are relative to `apps/web/src/lib` unless indicated otherwise.

- `content-policy.ts` already owns classification, digest checks, immutable observations, flat guards, source observation, and exposure metadata. `vaultPolicy()` describes stored derivation. `observeVaultFile()` adds current document and ancestor access. They answer different questions.
- `documents/shared-writing.ts` owns authenticated chat submissions and exact leased attempts. It currently hardcodes title/content/location output and treats every operation except page create/update as outbound text. Research cannot enter that branch because a profile is a shared case resource with structured fields.
- `documents/service.ts` owns session-aware content transactions and private artifact writes. Its schema-wide shared ACL gate is short. Current triggers order real ACL changes. The repair must not hold this gate over storage or provider work.
- `research/case-profile.ts` persists all freeform fields and revision snapshots. Its reader filters document IDs and documented facts. `researchCaseSnapshot()` bypasses that projection and reads raw profile content for the worker. Both require the new domain contract.
- `research/case-assessment.ts` resolves a live profile, Vault chunks, material, and TypeSafe configuration into a fingerprint. It recomputes inputs in the worker and stores `result_json` without policy. Its stale calculation and Vault-only excerpt filter do not authorize historical catalog text.
- `research/case-references.ts` owns reference links, version replacement, and notes. `referenceView()` nests the canonical assessment but does not retain its exposure. Some transaction callers reach the assessment getter through the global database. The getter must accept and use the caller's transaction.
- `application/research-capability-service.ts` wraps plain domain DTOs. `application/capability-replay.ts` guesses profile, assessment, reference, document IDs, and top-level `result.excerpts`. This misses nested assessment text and cannot account for notes or freeform profile fields.
- `application/agent-settings-service.ts` returns instructions, knowledge, and templates. `settingsReplayPolicies()` rereads mutable rows for keyed writes. `agent-instructions.ts` already checks disabled instructions during listing, but drops their policies. The getter must expose those same checked policies, including disabled rules.
- `knowledge/retrieval.ts` independently calls `observeResearch()` and `selectedResearchSources()`. `ai-sources.ts` already has immutable pinned research selection, but returns chunks separately from policies. Rerank authorizes before TypeSafe reservation waits.
- `ai-runtime.ts` waits for credits and model resolution before `agent.generate()`. `ai-providers.ts` has a custom fetch only for CLIProxyAPI. Other providers use router configs. A check before `agent.generate()` alone cannot promise protection for hidden SDK retries or transport preparation.
- `typesafe/client.ts` reserves after configuration and dispatches once. Its default SDK sets `maxRetries: 0`. `citations/review.ts` supplies a transport callback that checks source policies late, but lacks the complete original session, input-text policy, and Lume admission contract.
- Gmail and Drive bind stored version policy. `google/connections.ts` already calls `checkGoogleWrite()` after access-token waits and again after the one 401 refresh. `google/operations.ts` binds the durable reviewed operation. These mechanisms need complete file authorization, not another connector authorization framework.
- `personal-chat/shares.ts` checks a version at creation and loads stored policy again at recipient read. It does not persist the full current source binding. `artifact-file.ts::pinnedArtifactTemplate()` already separates `policy` and `authorization` for an own-original exception, but duplicates the inference.
- `case-pages/provenance.ts` consumes exposure when available and otherwise guesses DTO shapes. `agent-tools/index.ts` explicitly preserves WeakMap exposure across both Zod parses. That bridge is useful, but it cannot recover metadata already lost by object wrapping.
- `components/vault-annexes.tsx` cancels only reopen GETs. Analyze and generate callbacks, errors, and finalizers can change state after another scan is selected.

These observations agree with the bounded [handoff census](lume-source-round3-census.json) and [its source](lume-source-round3-census.mts). The census does not establish exhaustive coverage. The accepted [architecture](lume-architecture-synthesis.md), [provenance synthesis](lume-provenance-synthesis.md), and [parent annex correction](lume-provenance-round2-parent.md) explain why separate private resources, exact attempts, and independent plans remain constraints.

### Data structures before signatures

Reuse `ContentPolicy` format 1 unchanged. Research stores a fixed domain policy map beside each exact structured snapshot. A whole-profile policy is insufficient because the current product filters individual documented facts. A universal JSON-path provenance engine is unnecessary because the domain has a bounded known shape.

```ts
// content-policy.ts. Internal domain result, never a client wire object.
declare const retainedResult: unique symbol;
type ContentResult<T> = Readonly<{
	value: T;
	policies: readonly ContentPolicy[];
	sources?: Readonly<Record<string, ContentPolicy>>;
	identities: readonly ExactContentIdentity[];
	[retainedResult]: true;
}>;

// Existing replay identities stay supported. Add research identities where needed.
type ExactContentIdentity = ExistingReplayIdentity
	| { kind: 'research-profile'; caseId: string; version: number; digest: string }
	| { kind: 'research-reference'; id: string; version: number; digest: string }
	| { kind: 'research-assessment'; id: string; digest: string };

// research/case-content.ts. The fixed slots are private storage-domain types.
type ProfilePolicies = Readonly<{
	legalQuestion: ContentPolicy;
	objective: ContentPolicy;
	thesis: ContentPolicy;
	allegedFacts: ContentPolicy;
	gaps: ContentPolicy;
	documentedFacts: readonly ContentPolicy[];
}>;
type RetainedProfile = Readonly<{
	snapshot: ResearchCaseProfile;
	digest: string;
	policies: ProfilePolicies;
}>;
type RetainedNotes = Readonly<{ text: string; policy: ContentPolicy }>;
type AssessmentSnapshot = Readonly<{
	profileVersion: number;
	materialVersionId: string;
	request: ResearchAssessmentInput;
	coverage: ResearchAssessmentCoverage;
	excerpts: ResearchAssessmentResult['excerpts'];
	policy: ContentPolicy;
	inputDigest: string;
}>;

// The policy array has exactly the same order and length as documentedFacts
// in this immutable snapshot. Parsers reject a missing or mismatched slot.
// Each slot digest binds all content-bearing fields in that slot.
```

Scalar fields have individual policy. Alleged facts and gaps each use a list-level policy because the existing UI edits those lists as a field. Documented facts retain individual policy plus exact document observations. That granularity preserves current selective visibility without introducing sentence-level provenance throughout the application.

Generated changed fields each conservatively inherit the entire actual generation input policy. The model cannot claim a smaller contributor set. Unchanged fields retain their previous policies. A documented fact's explicit document list adds evidence obligations even when its text was directly human-entered. A human amendment preserves the previous policy of the actual field being amended and any known seed. A new independent profile starts with its own submitted fields. A new reference's notes do not inherit every prior reference or conversation source.

Fact edit correspondence comes from the exact authorized form view. The owner issues a view token bound to base revision, visible fact positions, and digest. Saving that view changes only its submitted visible fields. Hidden facts survive. New documented facts are explicit additions. Replacement of an existing fact retains that fact's policy. A full list replacement with no reliable correspondence conservatively retains the replaced list's policies in its changed entries. It must not guess lineage from text similarity or allow delete-and-reinsert in one managed edit to erase policy.

This is a local research edit map, not a new global content ledger. Existing API fields remain readable. Add optional `viewToken` and `unavailableFields` metadata to the DTO schemas. Human clients migrate to those fields. Old full-save clients remain supported only when the owner can verify that the submitted base view is complete. A partial view requires the bounded edit protocol rather than destructive full replacement.

```ts
// Trusted input identities are resolved by the owner, not parsed from tool JSON.
declare const researchSubmission: unique symbol;
type ResearchSubmission = Readonly<{
	id: string;
	[researchSubmission]: true;
}>;
type ResearchTextInput = ResearchSubmission | { kind: 'request' };

type ProfileWrite = {
	caseId: string;
	expectedVersion: number;
	input: ResearchTextInput;
	approvalId?: string;
};
type ReferenceNotesWrite = ResearchTextInput | { kind: 'unchanged' };

// application/context.ts. Persist the original execution identity for async work.
type ContentExecution = Readonly<{
	context: WorkspaceContext;
	operation: CapabilityName;
	policies: readonly ContentPolicy[];
	inputDigest: string;
	lease?: { kind: 'generation' | 'assessment'; id: string; token: string };
}>;
```

`ContentExecution` describes what to reauthorize. It is not a reusable permission grant. The context is server-created and its stored representation includes the original session ID, invocation, case scope, actor, office, and attempt identity. Workers load it from their own job. No model-supplied object is accepted as this type. Natural session expiry uses the clock at admission, not the job creation timestamp.

### Selected research ownership

Research owns text meaning, field-level retained policy, read projection, evidence validation, and atomic persistence. The existing submitted writer owns shared generation mechanics. It gains a closed typed research output mode. There is no arbitrary plugin registry, public caller-provided prompt, schema, or policy.

```ts
// research/case-profile.ts. Existing operation names remain canonical.
async function saveResearchCaseProfile(
	context: WorkspaceContext, command: ProfileWrite,
): Promise<ContentResult<ResearchCaseProfile>> {
	throw new Error('not implemented');
}
async function getResearchCaseProfile(
	context: WorkspaceContext, caseId: string, tx?: Transaction,
): Promise<ContentResult<ResearchCaseProfile | null>> {
	throw new Error('not implemented');
}

// research/case-references.ts. Link-only commands need no text generation.
async function updateResearchCaseReference(
	context: WorkspaceContext,
	command: ReferenceIdentityChange & { notes: ReferenceNotesWrite; approvalId?: string },
): Promise<ContentResult<ResearchCaseReference>> {
	throw new Error('not implemented');
}

// research/case-content.ts. Domain-internal, used by all three research owners.
function profileForViewer(
	retained: RetainedProfile, visibility: ResearchFieldVisibility,
): ContentResult<ResearchCaseProfile> {
	throw new Error('not implemented');
}
function applyProfileSubmission(
	base: RetainedProfile | null, submitted: AuthenticatedResearchEdit,
	observedEvidence: readonly ContentSource[],
): RetainedProfile {
	throw new Error('not implemented');
}

// documents/shared-writing.ts. Closed overloads, internal application API.
type SubmittedWriteTarget = ExistingPageOrOutboundTarget
	| { kind: 'research-profile'; caseId: string; expectedVersion: number }
	| { kind: 'research-notes'; referenceId: string; expectedVersion: number }
	| { kind: 'research-new-reference-notes'; caseId: string; materialVersionId: string };
type SubmittedWriteProposal = Readonly<{
	attemptId: string;
	policy: ContentPolicy;
	approvalId: string | null;
}> & (
	| { kind: 'text'; title: string; content: string; location?: string }
	| { kind: 'research-profile'; edit: ResearchProfileEdit }
	| { kind: 'research-notes'; notes: string }
);

async function prepareSharedWriting(
	context: WorkspaceContext, operation: CapabilityName,
	target: SubmittedWriteTarget,
): Promise<SubmittedWriteProposal> {
	throw new Error('not implemented');
}
```

The closed target discriminator replaces `sharedPage` and the broad outbound fallback. Research targets resolve scope from canonical resource identity, not from planner fields. The writer selects the research schema and prompt through the domain-owned `case-content.ts` specification. It uses the existing submission, generation identity, lease, input digest, images, stateless task session, and approval linkage. Internals may return a private typed prepared input to the writer. Domain callers never coordinate load, check, generate, and persist themselves.

The writer's profile mode returns a validated structured profile edit, not a stringified profile stored in `content`. Notes mode returns notes. The receipt binds discriminator, exact output, exact target/base version, schema version, actual admitted policy, and immutable input. Old attempts without a discriminator decode only as the existing page or outbound formats under their known operation. They cannot be reinterpreted as research receipts.

`ResearchProfileEdit` is the fixed validated profile field patch with the owner-resolved fact correspondence described above. It contains no policy claims. `addResearchCaseReference()` uses the same `ReferenceNotesWrite` type as update, with an unchanged value meaning empty notes for a fresh link. Its duplicate-link behavior remains the existing owner behavior. The operation cannot silently apply a different notes write when an existing reference wins its unique key.

Agent input schemas for save-profile and text-bearing reference changes use IDs and versions. Existing human input schemas keep the form fields. `runCapability` already selects `agentInput` for invocation. The canonical research writer independently rejects raw agent text even if another adapter bypasses that schema. For `webmcp`, freeform fields remain proposed model text until explicit authenticated human submission or bounded generation. A missing submission produces an actionable request for a new person send. It does not unpublish the feature.

Research generated proposals reuse the existing exact approval reader and confirmation machinery. Generalize its content projection only enough to show fixed profile fields and notes in pt-BR. Do not push the structured JSON, full preview, or private planner explanation into replayable history. Purpose/material changes retain their existing review rules. A stale target version requires a new proposal, not silent regeneration under the old approval.

`case-content.ts` stays domain-internal. Routes and capability adapters import canonical research operations. A targeted import restriction disallows adapters importing research policy builders, persisted-row decoders, or submitted writer input assemblers. This guides an agent editing a single file to the safe operation and makes the shortest compiling path the correct one.

### Persisted assessments and domain-complete reads

`assessResearchCaseMaterial()` creates `AssessmentSnapshot` under the existing short transaction. The snapshot captures the exact profile projection admitted for this caller, the exact pinned material, the actual bounded Vault chunks and catalog excerpts, and the complete policy of those inputs. It also stores the original execution identity. `input_fingerprint` remains a freshness and deduplication key. It is not authorization.

The queued worker uses that saved snapshot. It does not reconstruct generation inputs from today's `researchCaseSnapshot()`. Before dispatch, current admission checks the saved policy, original session, source Lume rules, worker lease, and case access. A current fingerprint mismatch can mark the job stale before dispatch according to existing product behavior. Once generation completes, the result bytes and their policy commit together under the lease token. Failed checks and lease loss cannot leave an unclassified result.

All assessment content, including answer choices, scores, explanations, coverage, and excerpts, is a derivation of the full admitted snapshot. Do not protect only quotations. The assessment result has one combined policy. The policy digest binds the canonical structured result with a fixed domain label through existing `contentDigest()`. Metadata that describes queue state remains available under base case access. The content result becomes null if exact retained contributors are revoked.

The same read projection serves ordinary HTTP reads, agent reads, reference nesting, worker assembly, and citation exposure. `referenceView()` combines visible notes policy, current reference access, visible material metadata policy, and the nested assessment's returned policies. It does not reconstruct the assessment. If the nested assessment is unavailable, the reference can remain with permitted metadata and notes. If notes are revoked, omit notes bytes and expose the authorized remainder with neutral unavailability metadata.

`researchCaseSnapshot()` becomes a domain-internal exact-version read through `case-content.ts`. Its raw `view(row)` bypass disappears. Every transaction-aware nested read receives the same `Transaction`; no callback inside `aclTransaction()` escapes to a global connection.

Freshness and access stay separate. V1 can remain readable after a legitimate V2 replacement if V1's current material permission and retained contributors remain allowed. A `permission_ai='proibido'` guard denies agent exposure of the historical result even when local catalog reading remains allowed. The existing `research-material` guard already includes AI permission. Do not weaken that format-1 rule. Direct catalog human reading continues through the catalog's `localAllowed` contract.

Every projected research result also carries current base case access. Reference results add current reference access. Exact profile, reference, and assessment versions use result identities rather than inventing new observed-pin kinds in format 1. Persisted source policies contain the contributors of their bytes. Read policies add resource access for the read. Those two representations are derived at their owner, not maintained by separate adapters.

### One policy-bearing result at adapter and replay boundaries

```ts
// content-policy.ts. Only a nominal ContentResult can use this adapter.
function mapContentResult<A, B>(
	result: ContentResult<A>, wrap: (value: A) => B,
): ContentResult<B> {
	throw new Error('not implemented');
}

// agent-tools/index.ts. One parse point preserves metadata and recomputes
// the serialized result digest after any schema transformation.
function parseContentResult<T>(
	schema: ZodType<T>, result: ContentResult<unknown>,
): ContentResult<T> {
	throw new Error('not implemented');
}

// application/capability-replay.ts.
function captureCapabilityReplay(result: ContentResult<unknown>): ReplayBindingV2 {
	throw new Error('not implemented');
}
async function replayCapabilityResult(
	context: WorkspaceContext, saved: unknown, binding: ReplayBinding,
): Promise<ContentResult<unknown>> {
	throw new Error('not implemented');
}

type ReplayBindingV2 = Readonly<{
	format: 2;
	resultDigest: string;
	identities: readonly ExactContentIdentity[];
	policies: readonly ContentPolicy[];
	sources?: Readonly<Record<string, ContentPolicy>>;
}>;

// application/agent-settings-service.ts.
async function getAgentSettings(
	context: WorkspaceContext, tx?: Transaction,
): Promise<ContentResult<AgentSettingsView>> {
	throw new Error('not implemented');
}
```

The existing capability registration gains a retained-result classification for migrated research and settings operations. Its executor type requires `ContentResult` for those entries. Pure status operations keep `exposure: 'none'`. Unsupported private outputs retain explicit uncertainty. This stays with the existing capability definitions rather than a second capability-name list.

For compatibility with current chat and citation consumers, the single adapter unwraps `value` and attaches the same policies with existing `exposeContent()`. It retains source-ID policies where present. `recordToolProvenance()` then receives complete policies after both output parses, as today. Research adapters cannot drop them by making `{ reference }`, `{ profile }`, or `{ references }` without `mapContentResult()`.

Replay V2 stores exact serialized result digest, complete policies, source policies, and typed exact identities from the owner. Capture performs no domain lookup or recursive JSON walk. Replay validates storage, digest, original identities, current session, scope, and all retained guards in the short read transaction. It does not replace old policy with the latest settings/profile/reference policy. Thus exact replay retains old nested assessment contributors after the reference itself is edited.

The domain owner records policies for every content-bearing member of its returned DTO. List operations combine only returned visible members. Known inaccessible fields are filtered before the returned policy list is composed. This avoids revoking an authorized notes-only response merely because an omitted assessment is unavailable.

`getAgentSettings()` becomes a policy-bearing snapshot assembled on its transaction connection. `agent-instructions.ts::scopeRows()` selects policy in the same query as text and returns the checked classification. This includes disabled instructions. `agent-knowledge.ts` returns document metadata policy and a separately checked usage-note policy. If a note is omitted, only the remaining returned metadata policy is exposed. Effective templates include the exact selected file policy. Missing legacy generated instruction or note policy remains uncertain under the existing conservative classification, never `personPolicy()` merely because it is a setting.

Writes return the same snapshot and store that snapshot's binding with consumed approvals. This removes the second mutable reread in `settingsReplayPolicies()`. Ordinary getter, consumed outcome, cache, private artifact derivation, and assistant history all carry the same known restrictions. Private conversation compatibility storage can remain conservative. It must not be used as a permanent input union for new shared requests.

### Immutable research chunks and policy together

```ts
// ai-sources.ts. Current and queued pinned selection share one implementation.
type ResearchSelection =
	| { kind: 'current'; referenceIds: readonly string[] }
	| { kind: 'pinned'; references: readonly PinnedResearchReference[] };
type ObservedResearchChunk = Readonly<{
	chunk: SourceChunk & { materialVersionId: string; researchChunkId: string };
	policy: ContentPolicy;
}>;
async function selectedResearchSources(
	context: WorkspaceContext, caseId: string, selection: ResearchSelection,
	query?: string,
): Promise<readonly ObservedResearchChunk[]> {
	throw new Error('not implemented');
}
```

One short read transaction resolves the reference, immutable version, digest, policy, and chunks. Ranking reads only that version. After query or provider waits, checks reauthorize the same observation. A changed live pointer cannot silently supply V2 text under V1 policy. A selection already pinned to V1 uses V1 subject to current base reference access, same-material identity, and material permissions. It does not recursively import V2's content policy.

`knowledge/retrieval.ts` deletes its separate `researchPolicies` observation loop. It builds DTOs and per-source exposure from the returned pair. `chat-turn.ts`, `chat-scope-server.ts`, `application/knowledge-service.ts`, `application/citations-service.ts`, and `document-workflows.ts` migrate to this owner. `selectedPinnedResearchSources()` becomes unnecessary after migrating its callers to the explicit pinned selection. `observeResearch()` delegates its version resolution to the same domain observation or becomes a text projection of that observation. It cannot retain a second mutable-reference implementation.

Catalog chunks and labels must bind the selected material version and metadata revision used by the actual response. Mutable current metadata may be returned as separate current status, not mislabeled as historical source bytes. Existing `resolveArtifactResearchSource()` retains its pinned chunk/version behavior and receives the same canonical material-policy classification at its content exposure boundary.

### Exact managed access and original-author disclosure

```ts
// documents/managed-file.ts. Internal to actual file operations.
type ManagedFileBinding = Readonly<{
	identity: {
		documentId: string; versionId: string; version: number;
		sha256: string; byteSize: number;
	};
	authorization: ContentPolicy;
	disclosure: ContentPolicy;
	authority:
		| { kind: 'own-original'; authorUserId: string; contributionReceipt: string }
		| { kind: 'retained' };
}>;
type ManagedFile = Readonly<{
	bytes: Uint8Array; name: string; mimeType: string;
	binding: ManagedFileBinding;
}>;
async function stageManagedFile(
	context: WorkspaceContext,
	selection: { documentId: string; version?: number },
): Promise<ManagedFile> {
	throw new Error('not implemented');
}
async function assertManagedDelivery(
	context: WorkspaceContext, binding: ManagedFileBinding,
	audience: { kind: 'external' } | { kind: 'person'; userId: string },
	tx?: Transaction,
): Promise<void> {
	throw new Error('not implemented');
}
```

Staging observes the selected exact version and current document/ancestor guards, reads that version's immutable storage key, and checks byte digest and size after storage returns. The authorization contains both retained derivation and managed resource access. It survives the original folder membership even if the file is later moved. The final boundary also checks current resource existence and current ancestor access through the document guard.

The disclosure defaults to the authorization policy. A narrowly proven own-original uses its independent stored contribution policy for disclosure while retaining full authorization for the sender. The exception requires the actual pinned version author, eligible independent origin, and no inherited owners, guards, or known managed derivation. Checking today's document creator or merely matching `version.created_by` is insufficient. A replacement editor, exporter, copier, or archive uploader cannot acquire independent authorship of inherited bytes.

Add an immutable contribution classification to Vault versions if existing origin records cannot establish that distinction. Direct authenticated fresh uploads alone can issue an independent-contribution receipt for their actual author. Managed copy/export/import and replacement operations issue derived classification and retain the observed source policy. Reuse existing `vault_agent_origin` evidence; do not rely on its absence as proof. Known legacy originals may use the accepted legacy-human convention only with actual pinned authorship and no contradictory managed-origin evidence. An ambiguous legacy version stays readable under normal access but cannot receive this new exception merely through migration.

The byte binding and authorship receipt must match the selected version. This fixes the current template helper's duplicated inference. `pinnedArtifactTemplate()` uses `stageManagedFile()` and returns its authorization, disclosure, and identity. Selecting a template does not require extracted text to be ready when the DOCX bytes themselves are usable. The current `observeDocument()` plus separate active-file read choreography disappears for templates.

Gmail preparation stores each attachment binding in its reviewed durable operation alongside bytes identity. Its composed text policy combines disclosure policies, while `__bound` separately retains all sender authorization bindings. Drive replacement does the same, preserving its remote version, checksum, and unknown-effect reconciliation. After file preparation and token refresh, the existing Google write guard calls `assertManagedDelivery()` using the original actor and session. Both the first write and the 401 retry check complete bindings. Reconciliation can record an already accepted effect without resending bytes or converting that outcome into a new permission grant.

For internal personal shares, creation checks the sender authorization and recipient disclosure eligibility. It persists the exact binding and share grant in the existing share row. Recipient reads check current share state, recipient identity/session, sender current authorization, exact version/bytes, and recipient disclosure policy before and after storage waits. They do not impose the sender authorization policy on the recipient of a legitimately disclosed own original. For a retained restricted source, the recipient must satisfy its resource and ancestor policy.

The sender's original session governs creation and deferred external dispatch. A later active share read uses the recipient's current session and the sender's continuing resource authorization; it does not depend on the sender remaining logged in forever. External claim and email workers load the persisted binding before dispatching source-derived title, filename, or content. Existing shares missing a complete binding use a conservative exact-version compatibility reconstruction. Another person's restricted original never becomes source-independent because its old stored derivation guards are empty.

### Final provider admission after actual waits

```ts
// application/context.ts. One source/session/Lume admission implementation.
async function assertContentDispatch(
	execution: ContentExecution, tx?: Transaction,
): Promise<void> {
	throw new Error('not implemented');
}

// ai-runtime.ts. Protected structured calls require a bound execution.
type ProtectedStructuredOptions<T> = StructuredOptions<T> & {
	admission: ContentExecution;
};

// ai-providers.ts. Request-local transport; no global fetch replacement.
function modelFor(
	config: ModelCredential, execution: ContentExecution,
): MastraModelConfig {
	throw new Error('not implemented');
}

// typesafe/client.ts. The guarded mode is required for managed content.
async function evaluate(
	context: EvaluationActor, purpose: DecisionPurpose,
	request: DomainDecisionInput,
	options: EvaluationOptions & { admission: ContentExecution },
): Promise<Evaluation> {
	throw new Error('not implemented');
}
```

Admission validates the original session with `clock_timestamp()`, actor membership and operation scope, cancellation, retained exact source guards, source Lume admission, and active lease where applicable. Explicit share generation also requires eligibility. Generated research input cannot include uncertain private model text. Rerank may consume authorized private sources, but their known obligations remain in the dispatch policy. The query and input text have their own provenance when generated privately; include that policy rather than checking candidates alone.

For structured generation, inject a request-local guarded fetch into the concrete selected provider model. Build the request body first. After SDK preparation and immediately before each underlying fetch, perform a short admission transaction and call the underlying fetch with no intervening asynchronous configuration or staging. Protected calls cannot fall back to an unguarded router config. Keep normal provider resolution, pricing, tracing, signals, fresh task sessions, and output parsing.

The provider inventory is the existing `AI_PROVIDERS` list. OpenAI, Anthropic, Google, DeepSeek, Inception, OpenRouter, Vercel AI Gateway, and CLIProxyAPI must each use a guardable concrete HTTP transport for protected structured calls. Current CLIProxyAPI custom fetch is the integration pattern, not proof that the router providers are guarded. For these calls, force HTTP where the runtime can otherwise choose WebSocket. Reject redirects rather than follow a body to an unchecked origin. Fail a protected configuration explicitly if its transport cannot honor the contract; do not silently switch models or remove the feature.

Every HTTP attempt that can send the retained prompt invokes the guard. SDK transient retries, structured-output repair calls, any fallback model entry, and deliberate application retries are covered by the guarded transport. Disable undocumented SDK retry/fallback routes unless their repeated transport entry is proven. A single guarded `agent.generate()` entry is not enough. An old failed attempt recovers the saved exact provider input and policy, gets a new lease, and rechecks original session/access on each new dispatch. A ready attempt recovered without provider work still reauthorizes its result.

TypeSafe already disables SDK retries. Its guarded `evaluate()` path runs admission after configuration, reservation, and credential preparation, immediately before its single transport call. Any injected test transport enters after the same guard. `rerank()` binds the exact policies of each bounded batch plus query. It checks every batch, including shadow mode. Citation review uses that same path and includes the derived text's policy as well as candidate policies. Remove the citation-specific transport callback so it cannot provide a weaker session-free alternate path. Research assessment workers use the same TypeSafe admission after reservation and on every leased retry.

Admission failures before TypeSafe dispatch release or finalize the reservation without counting a provider fault. They must not increment circuit failures or disable credentials. Preserve the conservative charge reservation for a call that may have reached the provider. `ai-runtime.ts` likewise retains the domain authorization error instead of converting it into an IA-configuration error. Existing usage accounting still records actual attempted calls.

The exact protected boundary is application transport invocation. Revocation that completed while image storage, provider setup, token refresh, or TypeSafe reservation was waiting is observed before that invocation. The ACL gate is released before slow provider network work. A revocation ordered after the final short admission overlaps an already admitted send; this mechanism cannot revoke remote bytes, prevent a remote server's own internal retries, or prove atomic ordering with remote delivery. No local design can promise those properties without holding a gate over the network or changing the external system. Post-result checks remain required for persistence and reads, but are not described as disclosure prevention.

Natural expiry is checked again at the end of admission. Before the immediate transport call, also compare the captured expiry against the current wall clock. A queued job or expired original session cannot substitute a fresh approver or worker session. The tiny interval after the last local check remains part of the explicitly admitted-send boundary, not an unbounded prepared permission token.

### Annex request identity belongs to the selected scan

Keep the current server plan contract unchanged. It preserves exact old authorized plans and independently admitted new analyses after an unrelated old source is revoked. Do not restore `managedBaseline` or a permanent actor/case/scan source union.

```ts
// vault-annexes.tsx. Local UI identity, separate from server idempotency.
type AnnexRequest = Readonly<{
	caseId: string;
	scanId: string;
	selectionEpoch: number;
	requestId: number;
	kind: 'reopen' | 'analyze' | 'generate';
	planId?: string;
}>;
type AnnexViewState =
	| { kind: 'empty'; caseId: string; scanId: string; selectionEpoch: number }
	| { kind: 'pending'; request: AnnexRequest; plan: Plan | null }
	| { kind: 'review'; caseId: string; scanId: string; selectionEpoch: number; plan: Plan }
	| { kind: 'result'; request: AnnexRequest; result: Result };
```

Changing case or scan increments the epoch synchronously, clears visible plan/result/error, and aborts local outstanding fetches. Each request captures the epoch and unique request ID. Only the active matching request may install a plan, result, error, or busy finalizer. A reopen response must also match its requested scan. Starting analyze invalidates that scan's earlier reopen response. A late A response cannot replace B or clear B's busy state.

Generation requires `plan.scanDocumentId === activeScanId`. Its response is fenced to the exact captured plan and request. Preserve the existing signature-based server idempotency key; returning to a scan can recover the completed operation without duplicate files. Client abort is not server rollback. An ignored completed A operation remains discoverable through its real files or a reopened exact plan. Field edits during generation either stay disabled as today or invalidate the displayed result identity. Keyboard focus, pt-BR loading/error copy, 44px controls, and mobile layout follow `DESIGN.md`. This is a race repair, not the final visual redesign.

### Module map and deletions

`content-policy.ts` remains the policy algebra and typed result metadata owner. `application/context.ts` owns current execution admission. `documents/shared-writing.ts` owns submitted generation mechanics. `research/case-content.ts` owns the fixed research policy map, serializers, human edit/seed interpretation, generation schemas, and projected reads. Existing profile, reference, and assessment owners keep their persistence operations. `documents/managed-file.ts` owns exact managed bytes and disclosure interpretation. Existing connector and share operations keep delivery lifecycles. No universal resource service is introduced.

Delete or narrow these current weaker paths in the same implementation wave:

- Delete the profile/assessment/reference field reconstruction and excerpt casts in `captureCapabilityReplay()`.
- Delete `settingsReplayPolicies()` after settings results carry their exact checked policies.
- Delete the raw `researchCaseSnapshot()` profile decoder bypass. Keep the symbol only if callers need the new canonical exact snapshot operation.
- Delete the separate research observation loop in retrieval and the separate mutable-reference resolution in `observeResearch()`.
- Delete `selectedPinnedResearchSources()` after the unified selection union owns current and pinned reads.
- Delete the own-original SQL and policy inference in `pinnedArtifactTemplate()`.
- Remove Gmail, Drive, and personal sharing's direct delivery use of `vaultPolicy()`. It remains an internal derivation reader, not a delivery permission API.
- Remove the citation-only transport guard callback in favor of the common TypeSafe admission path.
- Replace the two duplicated output-parse/exposure-transfer blocks in `agent-tools/index.ts` with one metadata-preserving parse helper.
- Remove the migrated research/settings fallback through `recordToolProvenance()` JSON guessing. Preserve the explicit uncertainty fallback for unsupported private results and existing legacy compatibility evaluation.
- Replace annex's unconditional post-response state setters and shared busy finalizers with request-identity transitions.

The result interface hides domain completeness, projection, exact-version identity, and persistence interpretation. A caller exposes one result or calls one canonical write. The managed-file interface hides storage pinning and original-author evidence. Transport admission hides current session, source, Lume, and lease checks. This follows Model the Domain, Boundary Discipline, and Laziness Protocol. Those leaf skills were read in this session. They respectively changed fixed policy slots, boundary-owned validation, and deletion of replay/settings reconstruction.

The red-flag screen leaves one policy owner per invariant. The selected writer has a closed output union rather than arbitrary prompts or schemas on its public API. The domain operations hide internal staging. Nominal results make policy loss a type error at migrated adapters. Import restrictions prevent direct access to domain policy internals. Existing capability registration owns the retained-result classification. `AI_PROVIDERS` remains the single provider inventory. The implementation must satisfy every declared provider entry rather than maintain a second hand-synced allowlist.

### Closure of the nine finding groups

1. A1 uses owner-complete reference results, including nested assessment policies, and digest-bound replay.
2. A2 uses authenticated structured submissions or bounded generated receipts at the canonical profile and notes writers.
3. A3 uses immutable assessment input/result policies independently of freshness status.
4. A4/C2 uses guarded actual provider transport after image, configuration, and reservation waits.
5. B1/C1 uses separate exact managed authorization and original-author disclosure bindings across Google and personal shares.
6. B2 uses policy-bearing settings results including disabled instructions, preserving metadata through parsing and history.
7. B3 uses common TypeSafe admission on every rerank batch after reservation, with the original execution context.
8. B4 uses selected-scan epoch and request identity for every annex response and finalizer.
9. C3 uses one immutable research chunk/policy observation for current and pinned selection.

### Additive persistence and compatibility

Use the next unused additive migration after 0083. Do not edit 0075 through 0083, including 0080a. Keep all existing content, histories, attempts, approvals, and shares. Format-1 policies stay valid.

The minimum data changes are research profile/revision policy-map columns, reference notes policy with exact revision support, assessment input/result policy and original execution context, managed version contribution evidence when needed, and personal-share delivery binding. Add closed output-kind/schema metadata to generation attempts with a decoder for existing attempts. Store exact reference text revisions only where needed for version-policy/replay identity; do not mirror the entire catalog or create a generic event ledger. Existing keyed cache can retain the exact payload and binding without a second copy of every response.

Legacy research data currently lacks reliable human-versus-agent attribution. `updated_by` and `reviewed_by` do not distinguish them. Therefore missing policy cannot mean independent human input. A compatibility reader recovers all known case, document, chunk, material, and nested assessment obligations from the exact saved revision. Missing or inconsistent contributors fail closed. Otherwise the text remains an uncertain legacy contribution for the recorded author under known guards. It is not eligible for a new shared automated derivative or disclosure. Participants retain permitted link metadata and current independent human fields; withheld text gets an honest unavailable state. This is a narrowly affected legacy research class, not a quarantine of every old page or human artifact.

Known historical human classification can be used only when positive existing origin/submission evidence supports it. Do not rewrite legacy unknown generated fields as human during migration. The author may preserve and amend an uncertain legacy field privately under its baseline. A new independent human field or fresh admitted request can create a separate eligible contribution. Confirmation or retyping a managed prefill cannot clear the old field's restrictions. Record this read behavior before rollout because some pre-repair shared profile text will become unavailable to other participants.

New research reads validate canonical structured digest and fixed slot coverage before filtering. Existing malformed policy fails closed. New revisions store content, policy map, revision snapshot, approval result, and attempt outcome atomically. Do not use the current profile `db.batch()` from inside an unrelated transaction. Reference and assessment readers accept the supplied connection. CAS failure, cancellation, or lease loss rolls back policy and bytes together.

Legacy replay bindings for content-bearing research/settings that lack complete owner metadata are not trusted merely because format 1 parses. Recover an exact binding only from an actual retained revision with sufficient evidence. Otherwise return an unavailable original result and leave the prior side effect intact. Never rerun a completed write to compensate for a bad cache. Existing safe artifact/page/document bindings remain readable under their present compatibility checks.

## Synthesis decision

Candidate A selects domain-owned research content policy with a closed extension of the existing submitted writer. The parent has not selected a cross-candidate base. No claim is made about the other candidates. This choice preserves one generation-attempt lifecycle and gives profile and notes one local structured-content contract. It rejects a document-body encoding and a generic JSON provenance walker.

## Tradeoffs accepted

- We accept fixed research field policy maps in exchange for preserving selective fact visibility without a global per-fact provenance system.
- We accept conservative full-input policy on each model-changed field in exchange for avoiding unverifiable model attribution.
- We accept a closed research output extension to the submitted writer in exchange for reusing its exact attempts, source admission, images, and retry receipts.
- We accept a small human view token for partial profile edits in exchange for retaining hidden fields and their policies across saves.
- We accept explicit concrete HTTP transport integration for protected model calls in exchange for covering every SDK request attempt after real waits.
- We accept uncertain legacy research text being restricted to its recorded author when evidence cannot prove shared eligibility, in exchange for no retroactive broadening of known generated content.
- We accept admission at the local transport boundary in exchange for keeping slow provider network work outside the global ACL gate. Remote delivery remains irreversible once admitted.

## Alternatives considered

### A. Selected closed submitted writer with research-owned content policy

The research owners resolve the target, shape the structured content, retain per-field policy, and commit. The existing submitted writer resolves authenticated intent and owns the exact attempt lifecycle. It supports fixed profile and notes schemas alongside current page and outbound schemas. The difficult complexity stays inside those two existing bodies of knowledge. Callers keep `saveResearchCaseProfile()` and reference operations. This is the deeper interface for this bounded repair.

### B. Viable separate research generation receipts

Research could own a private `research_case_write_attempt` and all typed generation, input snapshots, schema selection, profile/notes receipts, and exact approval recovery. It would invoke `generateStructured()` with a canonical admitted submission loader and final transport admission. The document writer would remain unchanged. Canonical research writers would accept either a human submission or a domain receipt. Fixed research policy maps and complete read results would be identical to A.

```ts
// Rejected interface, viable if research genuinely needs its own lifecycle.
async function proposeResearchEdit(
	context: WorkspaceContext,
	target: ProfileTarget | ReferenceNotesTarget,
): Promise<ResearchWriteReceipt> {
	throw new Error('not implemented');
}
async function applyResearchEdit(
	context: WorkspaceContext, receipt: ResearchWriteReceipt,
	approvalId: string,
): Promise<ContentResult<ResearchCaseProfile | ResearchCaseReference>> {
	throw new Error('not implemented');
}
```

This is structurally different because research owns a separate durable generation lifecycle and receipts rather than sharing the existing attempt table and writer. It hides structured semantics well. It loses here because submission continuation, image staging, configured context eligibility, lease recovery, output-policy commit, and approvals would require a second lifecycle or a new shared generation service beneath both. A caller would also coordinate proposal and application unless the canonical methods hide both. Hiding both restores caller simplicity but leaves duplicated state transitions for the eventual writer and future agents to maintain. No current finding requires that additional lifecycle.

### C. Viable conservative planner-output retention

Research could keep raw agent writes, classify every planner-provided changed field through `privateGenerationPolicy()`, preserve known contributors, and restrict those fields to the actual requesting owner. Independent human fields would still use authenticated submissions. Shared publication would require a later explicit bounded recomposition. This is safe when the read contract and replay are complete. It preserves private drafts, but it changes an agent's shared profile edit into a private overlay and requires a second projection or later publish operation. It loses because the accepted product expects a useful structured shared case profile, and the existing submitted writer already permits safe shared generation. Merely making `save_profile` private would evade rather than complete this repair.

The alternatives are ownership choices, not naming variants. A universal content graph, event ledger, or recursively inferred JSON policy is rejected because the fixed research and delivery owners can contain the demonstrated failures.

## Open questions and risks

These are proof obligations for the parent and eventual writer. They do not require a human preference checkpoint.

1. Can every configured provider's protected structured model use the request-local HTTP guard, including retries and structured-output repair? The local router defaults currently do not establish that property. Verify concrete factories and transport entry before claiming coverage. An adapter that cannot comply must fail explicitly.
2. Can all existing managed Vault copies and replacements be positively distinguished from independent pinned-version authorship? Inventory copy, export, archive, Drive import, and version replacement producers. The current template heuristic is insufficient evidence for ambiguous legacy files.
3. Does the new partial profile edit protocol preserve hidden documented facts under real human UI saves, reorder, deletion, concurrent edits, and edited generated prefills? The current UI posts a full visible profile and has no view token.
4. Can legacy profile and notes origin be recovered for any existing rows? If not, verify the proposed author-only uncertain read behavior and unavailable participant UI without certifying shared eligibility from `updated_by`.
5. Do original session and invocation survive existing approval recovery and fingerprint-based assessment coalescing? A shared fingerprint must not transfer an attempt from an expired requester to another caller's session. Keep the first job's original execution identity or create a separately admitted job when continuation is not equivalent.
6. Do source-policy and lease checks always use the same short transaction and actual ACL mutation ordering? A hidden global query inside nested research readers can invalidate the claimed lock order. Audit lock upgrades and the current portal ordering separately.
7. Does a guard denial before TypeSafe send leave accounting and circuit state correct, while unknown accepted effects remain nonretryable until reconciliation? Generic reservation crash recovery remains an existing limitation and is not solved by this design.
8. Does every metadata surface for a personal share authorize the same binding as file content? Include pick/list metadata, claim flow, email filenames, and reads after object-storage waits. An authorized own original must work for a recipient outside its private case.

### Evidence levels and remaining acceptance work

The parent's four runtime negative proofs are already known. They demonstrate revoked nested replay, planner-to-profile publication, revoked catalog assessment exposure, and image-wait dispatch leakage. Their source is [the round3 production-owner repro](lume-source-round3-repro.test.ts) and [the image dispatch repro](lume-source-image-dispatch-repro.test.ts). They were read, not run by this candidate. The copied citation sanity pass and failed fixture attempts are not additional security proofs.

The remaining findings are static until the parent reproduces them. Required runtime cases use actual production owners and real asynchronous barriers:

- Managed delivery rejects another person's restricted original, even when the sender can read its folder. Revoke sender access while bytes or Google token refresh waits and assert zero subsequent payload dispatch. Verify the positive own-original exception and derived-copy denial.
- A disabled protected instruction read contributes its policy to a new private artifact and assistant history. Revocation hides both. Getter, wrapper, both Zod parses, keyed settings write replay, and consumed approval all retain the same policy.
- Hold the TypeSafe platform row lock, revoke a candidate or end the original session, then release it. Each affected rerank batch sends zero protected bytes. Repeat for natural expiry, cancellation, source Lume denial, citation input text, and research worker retry.
- Pause research selection between reference resolution and chunk retrieval. Switch V1 to V2. Returned text, labels, chunk IDs, policy observations, and replay must all describe one immutable version. This is a historical binding proof, not a claimed cross-material permission bypass.
- Delay annex A analyze and generate responses. Select B or start a newer A request. Neither stale success, error, nor finalizer changes current state. Test reopened valid old plans and independently admitted new analysis after an unrelated old source revocation.

Also require positive stale historical assessment reads under still-valid permissions, profile field filtering without hidden-field loss, independent new notes/requests without source union, original-session worker denial, lease races, CAS rollback, consumed approval exact-result recovery, old attempt decoding, and malformed policy fail-closed reads. Provider tests observe actual transport requests for each configured adapter and retry entry. They do not prove live model quality or control provider-internal continuation.

After implementation, the parent runs relevant PostgreSQL tests, affected e2e, root lint/typecheck/test, and production build with the isolated environment. Desktop/mobile/keyboard evidence covers the changed forms and annex races. Existing session-endpoint 429s, intermittent navigation, generic reservation recovery, and earlier portal race acceptance limits remain recorded rather than silently cleared. Unit3 tasks, notifications, Lume flag UI, deployment, and final visual integration remain outside this repair.

## Next implementation step

Build the retained research read/result contract and additive exact snapshot storage first, migrate reference nesting and replay to that contract, then add the closed submitted research writes and transport admission under the single eventual writer.
