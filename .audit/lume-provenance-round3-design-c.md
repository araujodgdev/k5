# Domain-owned research contributions and exact dispatch authority

Read-only candidate C. This is a proposed bounded repair. No production implementation or verification claim appears below. The parent owns synthesis, the sole eventual writer, and acceptance. The binding interpretation is [the round3 verdict](lume-provenance-round3-verdict.md), including its correction of the earlier annex lifetime union.

Throughput checkpoint: n/a, read-only investigation. `architect`, `p3-mode`, `how`, `why`, `technical-writing`, and `unslop` informed this package. The user's restrictions replace delegation, git-history exploration, runtime experiments, and implementation. Motivation below comes from accepted contracts and current source, not inferred commit history.

## Problem

Case participants need safe structured research profiles, notes, and historical assessments while the private planner remains useful. Current research writers accept planner text without a retained policy. Generic replay guesses the policies of a nested result. Managed file delivery confuses permission to read another person's original with authority to disclose it. Shared generation and reranking authorize before real waits. Repair the handoffs where these facts change owners. Retain `ContentPolicy` format 1, authenticated submissions, exact attempts, current resource guards, existing editor behavior, and existing connector approvals. Do not build another app architecture or remove the agent's research features.

## Usage (caller's view)

These are proposed APIs and pseudocode. They are written before the type sketch. A caller asks its domain to read or change a resource. The domain returns the exact visible value together with its complete policy binding. A transport adapter changes only the value's wire shape. A generic cache copies the binding instead of rediscovering it.

### A person edits the profile that the form actually showed

`research-case-linker.tsx` still lets a person edit the legal question, objective, thesis, documented facts, alleged facts, gaps, and document selection. A server-issued read token identifies the visible profile revision and editable entries. Hidden entries are not round-tripped as empty input.

```ts
import { getResearchCaseProfile, saveResearchCaseProfile } from '@/lib/research/case-profile';

const shown = await getResearchCaseProfile(context, caseId);
// The authenticated capability adapter records the submitted field bytes.
// It binds their server-known read token and any application prefill.
const saved = await saveResearchCaseProfile(context, {
	caseId, expectedVersion: shown.value?.version ?? 0,
	change: { kind: 'person', submission: authenticatedFormSubmission },
});
return capabilityDto(saved, value => ({ profile: value }));
```

The form submission holds domain-validated entries rather than a model assertion of human origin. The adapter obtains the person and office through `requireWorkspace()` and the original session. WebMCP is an invocation, not authenticated human typing. Existing raw HTTP payloads remain accepted at authenticated ingress, which seals this submission internally. The domain persists its receipt atomically with the field changes. A person editing the standalone research form does not need a conversation. The domain writer no longer exposes a raw freeform save to an invocation.

### The agent prepares structured research from the current person request

```ts
import { saveResearchCaseProfile } from '@/lib/research/case-profile';
import { updateResearchCaseReference } from '@/lib/research/case-references';

await saveResearchCaseProfile(agentContext, {
	caseId, expectedVersion,
	change: { kind: 'request', submissionId: agentContext.submissionId! },
});
// No legalQuestion, fact strings, notes, title, or rationale from the planner.
await updateResearchCaseReference(agentContext, {
	referenceId, expectedVersion,
	purpose: 'counterpoint',
	notes: { kind: 'request', submissionId: agentContext.submissionId! },
});
```

The research domain loads the actual submission, selected evidence, and eligible base entries. It produces a structured proposal with the existing stateless structured runtime. The normal review endpoint shows the exact field changes. Confirmation commits the stored proposal, never a body resubmitted by the planner. Existing reference confirmation and bypass-evaluation behavior remain. Profile generation gains exact review because it can overwrite a shared structured resource. The agent can still save profiles, write notes, assess material, and link references.

An agent operation that only changes purpose or material linkage need not generate prose. Empty new notes remain an empty contribution. An omitted notes change preserves existing notes and their policy. These cases avoid unnecessary model calls.

### Worker, delivery, and replay callers carry owned results

```ts
// processNextResearchAssessment owns lease, request authority, and exact input.
const input = await assessmentOwner.loadQueuedInput(jobId, leaseToken);
const decision = await evaluate(input.authority, 'research', input.decision, {
	admission: input.admission,
});
await assessmentOwner.finish(jobId, leaseToken, decision);

// Gmail's existing prepare/review/operation pipeline owns the delivery.
const file = await managedFiles.stage(context, { documentId, version });
const bound = { ...existingReview, files: [file.binding] };
// runGoogleOperation persists bound and installs its final transport guard.
await runGoogleOperation(context, {
	...existingOperation, bound,
	execute: handle => existingGmailSend(handle, file.bytes),
});

// Cache capture consumes metadata that survived capabilityDto parsing.
const reply = capabilityDto(referenceResult, reference => ({ reference }));
const replayBinding = captureCapabilityReplay(reply);
```

`assessmentOwner` and `managedFiles` name internal functions in the current owner files. They are not additional orchestrators. Research's public operations remain its current getters and commands. Gmail and Drive keep their existing public operations. Each owner hides staging, policy construction, and revalidation.

## Shape

### Grounded model of the current code

Observed in production source, without executing it:

- `content-policy.ts` distinguishes stored version policy from observed resource access. `vaultPolicy()` returns derivation policy. `observeVaultFile()` adds the document, ancestors, exact version, and hash. `assertPolicyAccess()` evaluates owners and guards. `assertExternalDelivery()` additionally rejects protected or ineligible content. These are different questions already present in the implementation.
- `case-profile.ts` writes fields and revision snapshots with `db.batch()`. Its reader filters document IDs and documented facts, but returns all other freeform fields. `researchCaseSnapshot()` builds a raw profile for assessments. `case-assessment.ts` rebuilds mutable input, computes freshness, and returns cached `result_json`. Its current exposure filter recognizes only Vault chunk IDs. It does not persist contributor policies.
- `case-references.ts` embeds the canonical assessment in each reference and writes arbitrary notes. The reference reader accepts a transaction, but calls an assessment reader that uses global `database`. `research-capability-service.ts` wraps these plain values in new objects.
- `captureCapabilityReplay()` reconstructs research guards from selected top-level properties and `item.result.excerpts`. It misses `reference.assessment.result.excerpts`. `runCapability()` already copies WeakMap exposure through two Zod parses when exposure exists. The missing domain exposure, rather than Zod alone, is the primary defect.
- `getAgentSettings()` returns plain settings. Instruction and knowledge owners authorize stored policies, but discard them from the returned DTO. `settingsReplayPolicies()` then loads policies again for writes. The prompt loader separately excludes disabled instructions. It cannot supply policies for disabled text returned by the settings tool.
- `searchKnowledgeEngine()` observes a research reference, then independently calls `selectedResearchSources()` to resolve its mutable version again. Vault candidates are revalidated before `rerank()`, but TypeSafe then awaits configuration and a reservation on the platform connection. Citation review supplies a custom guarded `send`, which is a neighboring precedent, not a complete common contract.
- `prepareSharedWriting()` reserves an attempt under `documentTransaction()`, releases it, loads attachment bytes, and calls `generateStructured()`. That runtime awaits credits and model resolution before `agent.generate()`. Its post-result checks protect publication, not the earlier external disclosure.
- Gmail attachments and Drive replacement use `vaultPolicy()`. Personal sharing persists an exact version but reads its stored policy without retaining the observed ancestor obligations. `pinnedArtifactTemplate()` already separates `policy` from `authorization`, but repeats its own original-author exception.
- Google operations install `withGoogleWriteGuard()`. `googleRequest()` invokes that guard after token acquisition and on its single 401 retry. This existing final boundary should consume a complete file binding. It should not be replaced by a check only in `prepare()`.
- `vault-annexes.tsx` fences reopen GET with an abort controller, but analysis and generation callbacks update plan, result, error, and busy state unconditionally. The exact server plan contract already preserves independent analyses and old authorized plans. The client must correlate responses, not change that contract.

This traced model explains the bounded ownership choices below. The accepted [architecture](lume-architecture-synthesis.md), [provenance contract](lume-provenance-synthesis.md), and [parent annex correction](lume-provenance-round2-parent.md) constrain the repair. The [census](lume-source-round3-census.json) and its [source](lume-source-round3-census.mts) enumerate handoffs. They are not evidence of exhaustive coverage.

### Data first

Keep existing `ContentPolicy` format 1 unchanged. Add domain bindings around it. All construction brands and storage representations are private to their owner. Raw JSON is parsed only when it crosses authenticated ingress, persistence, cache, or provider boundaries.

```ts
// content-policy.ts. Existing policy vocabulary and guard evaluation stay here.
type ContentResult<T> = Readonly<{
	value: T;
	binding: ContentBinding;
}> & OwnedResultBrand;

type ContentBinding = Readonly<{
	format: 2;
	payloadDigest: string;
	policies: readonly ContentPolicy[];
	identities: readonly ResultIdentity[];
	sources?: Readonly<Record<string, ContentPolicy>>;
}>;

// A closed union in the existing replay contract, not arbitrary JSON paths.
type ResultIdentity = ExistingExactIdentity
	| { kind: 'research-profile'; caseId: string; revision: number; digest: string }
	| { kind: 'research-reference'; id: string; revision: number; digest: string }
	| { kind: 'research-assessment'; id: string; resultDigest: string };

// Private to research. Lists retain stable entry identities in persisted binding.
type ResearchPart<T> = Readonly<{
	entryId: string;
	value: T;
	policy: ContentPolicy;
}>;
type ProfileContributions = Readonly<{
	legalQuestion: ResearchPart<string>;
	objective: ResearchPart<string>;
	thesis: ResearchPart<string | null>;
	documentedFacts: readonly ResearchPart<DocumentedFact>[];
	allegedFacts: readonly ResearchPart<string>[];
	gaps: readonly ResearchPart<string>[];
	documentSelections: readonly ResearchPart<PinnedVaultSelection>[];
}>;
type ReferenceContributions = Readonly<{
	notes: ResearchPart<string>;
	materialVersionId: string;
	assessmentId: string | null;
}>;
type AssessmentInput = Readonly<{
	profileRevision: number;
	state: ResearchAssessmentState;
	excerpts: readonly BoundResearchExcerpt[];
	policy: ContentPolicy;
	inputFingerprint: string;
	authority: RequestAuthority;
}>;

type ResearchTextChange =
	| { kind: 'person'; submission: AuthenticatedResearchSubmission }
	| { kind: 'request'; submissionId: PersonSubmissionId }
	| { kind: 'confirm'; approvalId: string };

type AuthenticatedResearchSubmission = Readonly<{
	contribution: ValidatedProfileEdit | ValidatedNotesEdit;
	readToken: string | null;
	seedId: string | null;
	authority: RequestAuthority;
}> & AuthenticatedSubmissionBrand;

// Managed file binding separates the actor's read obligation from disclosure.
type ManagedFileBinding = Readonly<{
	format: 1;
	documentId: string;
	version: number;
	versionId: string;
	sha256: string;
	byteSize: number;
	access: ContentPolicy;
	disclosure: ContentPolicy;
	contribution:
		| { kind: 'independent-original'; authorId: string; receipt: string }
		| { kind: 'derived'; receipt: string }
		| { kind: 'legacy-human'; authorId: string; evidence: LegacyOriginalEvidence }
		| { kind: 'unknown'; recordedWriterId: string | null };
}> & ManagedFileBrand;
```

`payloadDigest` binds the serialized visible DTO to the saved binding. Each domain part also binds its own canonical value. Use `contentDigest(domainTag, canonicalInput(value))` with fixed domain tags and explicit schema normalization. Do not hash arbitrary object insertion order. `ResearchPart` is an internal persistence model, not a wire type.

A profile needs these fixed fields and bounded entry lists because it already exposes fields selectively. This is not a general per-fact memory system. An assessment needs one combined policy for its inseparable generated verdict and actual excerpts. A reference needs its notes policy plus the policies of the assessment and material metadata it actually returns. No cached aggregate policy needs to be synchronized with these parts.

The policy of a visible result is derived from the visible parts at read time. Policies of hidden facts do not restrict an unrelated visible human objective. The complete persisted profile retains all parts, including those hidden from the current editor. An assessment combines exactly the parts and evidence bytes it used. Its later reader does not replace them with today's profile policies.

### Ownership and signatures

```ts
// research/case-profile.ts. Public domain operations.
function getResearchCaseProfile(
	context: WorkspaceContext, caseId: string, tx?: Transaction,
): Promise<ContentResult<ProfileView | null>> { throw new Error('not implemented'); }

function saveResearchCaseProfile(
	context: WorkspaceContext,
	command: { caseId: string; expectedVersion: number; change: ResearchTextChange },
): Promise<ContentResult<ProfileView>> { throw new Error('not implemented'); }

// research/case-references.ts. Notes use the same research contribution contract.
function updateResearchCaseReference(
	context: WorkspaceContext,
	command: ReferenceIdentityChange & { notes?: ResearchTextChange },
): Promise<ContentResult<ResearchCaseReference>> { throw new Error('not implemented'); }

// add/get/list use equivalent owned-result signatures. Removal has no prose output.

// research/case-assessment.ts. Queueing and worker completion remain domain-owned.
function assessResearchCaseMaterial(
	context: WorkspaceContext, input: { caseId: string; materialVersionId: string },
): Promise<ContentResult<ResearchCaseAssessment>> { throw new Error('not implemented'); }

function getResearchCaseAssessment(
	context: WorkspaceContext, assessmentId: string, tx?: Transaction,
): Promise<ContentResult<ResearchCaseAssessment>> { throw new Error('not implemented'); }

// Existing content-policy.ts replaces duplicate attach/copy exposure decisions.
function capabilityDto<T, U extends object>(
	result: ContentResult<T>, map: (value: T) => U,
): U & ExposedDtoBrand { throw new Error('not implemented'); }

function parseCapabilityOutput<T extends object>(
	schema: DomainOutputSchema<T>, exposed: T & ExposedDtoBrand,
): T & ExposedDtoBrand { throw new Error('not implemented'); }

// application/capability-replay.ts. Serialization, not domain reconstruction.
function captureCapabilityReplay(result: ExposedDto): ReplayBinding {
	throw new Error('not implemented');
}
function replayCapabilityResult(
	context: WorkspaceContext, saved: unknown, binding: unknown,
): Promise<ExposedDto> { throw new Error('not implemented'); }

// content-policy.ts. Internal to existing file-owning domain operations.
function bindManagedFile(
	context: WorkspaceContext, ref: { documentId: string; version?: number }, tx: Transaction,
): Promise<ManagedFileBinding> { throw new Error('not implemented'); }
function assertManagedFileAccess(
	userId: string, file: ManagedFileBinding, tx: Transaction,
): Promise<void> { throw new Error('not implemented'); }
function assertManagedFileDisclosure(
	senderId: string, recipient: InternalPerson | ExternalAudience,
	file: ManagedFileBinding, tx: Transaction,
): Promise<void> { throw new Error('not implemented'); }
```

Only the current owner constructs an owned result. `capabilityDto()` deliberately exposes policy through the existing WeakMap mechanism and recomputes the mapped payload digest. It does not search nested values. `parseCapabilityOutput()` carries that metadata through Zod's new object. HTTP clients and models still receive ordinary DTOs. Metadata is serialized separately in replay and history storage.

The core public change is one result contract, not a chain of `loadPolicy`, `checkPolicy`, `wrapResult`, and `fixReplay` calls imposed on every adapter. Research operations hide generation, evidence selection, projection, and persistence. The small DTO helper performs transport adaptation only. This follows boundary-discipline and laziness-protocol.

### Domain-owned structured generation

Add `research/case-content.ts` for the shared research knowledge currently missing from profile and notes writers. Its exported operations are used only by `case-profile.ts`, `case-references.ts`, and `case-assessment.ts`. It owns field schema, visible projection, revision merge, seed binding, and research proposal interpretation. It does not own case membership, catalog installation policy, provider selection, or an additional event store.

Both direct human submissions and generated contributions reach this contract. The profile and reference owners retain their identities, CAS rules, and SQL. `case-content.ts` returns a validated contribution update for the owning transaction. The same contract prevents notes laundering and profile laundering.

For generation, reuse the authenticated input assembly and attempt lifecycle in `documents/shared-writing.ts`. Replace its `sharedPage` Boolean and the assumption that every non-page result is external text with a private closed purpose union:

```ts
type WritingPurpose =
	| { kind: 'page'; target: PageTarget }
	| { kind: 'outbound-text'; target: ExistingOutboundTarget }
	| { kind: 'research-profile'; target: ProfileRevisionTarget }
	| { kind: 'research-notes'; target: ReferenceRevisionTarget };

// A server-only mechanism. No capability imports this to supply a prompt or policy.
function generateAdmittedResearch<T>(
	context: WorkspaceContext,
	request: ResearchGenerationRequest<T>,
): Promise<ResearchGenerationReceipt<T>> { throw new Error('not implemented'); }
```

The research request is branded and constructed by `case-content.ts`. It contains the fixed domain schema and application instructions. The mechanism still owns submission resolution, exact input snapshots, images, configured eligible context, lease recovery, tool-free generation, and immutable output receipt. It does not decide profile visibility. It does not impose external-delivery eligibility on a shared case profile. Research policies may legitimately include restricted case evidence.

Profile generation emits typed fields and source-entry handles. The domain validates document and chunk handles against the exact selected source manifest. It does not trust model claims of attribution. Every generated field inherits the complete actual generation policy, even when the model says that only one source informed that field. Document-linked facts also retain their evidence policy. New human-only fields get their own submission policy. This bounded conservative treatment preserves field projection without pretending to prove semantic independence of model fields.

For editing, load the exact baseline entries being continued. An unchanged field keeps its policy. A changed field retains its baseline and seed obligations plus the submitted or generated contribution. A documented fact cannot become an alleged fact with fewer restrictions. Reordering uses stable entry IDs. Removing a fact from the current profile does not erase its policy from an existing assessment or cached revision. Adding a new independent human fact does not acquire the policies of unrelated removed facts.

The read token records the IDs and version of entries shown to the form. A filtered DTO omitting facts cannot delete invisible persisted facts. A missing read token on a write to an existing filtered profile is a conflict. There is no `complete: true` or `independent: true` assertion from the client. Fresh independent generation is a new authenticated request without the prior profile in its input. It does not automatically consume existing profile text as a base. Continuing an existing profile uses its exact base and retains its restrictions. A deliberate fresh replacement can replace the current result after exact review and CAS, while history keeps the old result. The transport cannot silently select the fresh path merely by dropping a seed.

Use the existing `content_seed` with a research purpose and domain scope for the form's read token and managed prefill. It stores the visible entry identities, revision, canonical digest, and seed policies. Its schema permits this without a conversation. The authenticated form submission is a sealed in-process value whose receipt commits with the research revision. Do not put it in `content_submission`, which currently requires a conversation and message. Chat generation continues to use the existing durable `content_submission` record. Both paths reach the same research contribution contract, with distinct input lifetimes and no new general submission store.

The attempt key stays the existing submission, generation, and operation tuple. Research target includes expected revision and a schema-version tag. A retry recovers the same provider input and output. A deliberate regeneration uses a new generation identity. Approval binds target, original invocation, contribution changes, exact receipt, and policy. It consumes atomically with the profile revision or reference write. Failed CAS, cancellation, failed output validation, and denied admission leave content and policies unchanged. Two profile editors compete through one canonical revision CAS. Two independent proposals keep separate attempt records. This follows make-operations-idempotent and separate-before-serializing-shared-state.

### Exact persisted assessments and historical reads

At queue creation, `case-assessment.ts` assembles a typed immutable `AssessmentInput` under the current transaction and source admission. It includes the visible profile revision, exact selected Vault versions and extracted hashes, exact catalog material version and chunks, question version, bounded state, coverage, excerpts, and combined policy. It stores this input and policy with the assessment. The fingerprint includes the same pins and truncated bytes actually sent. `researchCaseSnapshot()` becomes this owner's policy-bearing input loader. It stops exposing an unfiltered raw profile as a second generation route.

The worker loads this queued input instead of rebuilding a same-looking state from mutable pointers. It verifies exact hashes, extraction identity, live access, original request authority, and its lease. A changed current profile can mark the work stale according to existing product rules. It cannot substitute different text under the old fingerprint. Provider admission authorizes the saved contributors after TypeSafe reservation waits. Completion checks the lease and current authority, then writes result JSON and result policy atomically.

The saved assessment policy covers profile text, Vault evidence, catalog text, metadata, and the generated answers. The domain reader first authorizes that policy, independently of `current`. Only afterward does it report freshness against the current profile, material pointer, configuration, or question version. An authorized V1 result remains readable with `status: 'stale'` after V2 is published. A revoked V1 catalog or Vault contributor suppresses the saved result. It cannot remain readable because its status is stale. Neutral assessment identity and status may remain available.

The existing `research-material` guard conservatively requires AI permission and local catalog permissions in `lume_resource_visible`. Keep that compatibility behavior for assessment results in this repair. Do not silently broaden historical human reads when AI permission is revoked. Ordinary catalog human readers retain their existing separate `localAllowed` path. A later purpose-specific permission split would need its own design and proof.

`referenceView()` receives an owned assessment result on the same transaction. It projects notes under their own policy and composes only the fields actually returned. A hidden notes field does not hide independent reference purpose. A suppressed assessment contributes no excerpt bytes. Its neutral unavailable metadata has an explicit case policy. Full keyed replay instead authorizes all policies of its original exact DTO and denies replay if any contributor is revoked. It may return NOT_FOUND rather than manufacture a partial historical result. This preserves the exact-result contract.

### Policy-bearing domain results through adapters, replay, and history

Research getters and writers always return `ContentResult`, including empty lists and null profile results with explicit case-scoped metadata classification. `research-capability-service.ts` uses `capabilityDto()` for its wrappers. Do not copy metadata by remembering particular nested assessment fields.

`getAgentSettings()` follows the same owned result contract. Instruction reads load text and policy in one row query. Knowledge reads carry separate document-metadata and note policies. Template reads carry the exact file metadata policy. Disabled instructions are included with their actual policies. Prompt inclusion remains a separate choice. Empty classifications are explicit. Missing policy never becomes `personPolicy()` merely because a settings DTO exists.

`agent-instructions.ts` and `agent-knowledge.ts` retain their existing writers and visibility rules. Their getters now return policy-bearing rows. Settings aggregation combines those rows and template metadata. The prompt loaders select only the relevant returned policies instead of independently reloading them. A note withheld by its reader contributes no text policy to the returned value. Its linked document metadata still carries a policy.

In `capabilities/contracts.ts`, add one owned-result classification to the existing definitions of affected content-bearing operations. The dispatcher requires exposure for those definitions before output parsing and cache capture. Definitions marked `none` remain explicit metadata-only operations. Unsupported private content retains known policies plus owner-only uncertainty. There is no new capability-name exception list.

`captureCapabilityReplay()` serializes the owner binding and exact DTO digest. `replayCapabilityResult()` validates the digest, immutable identities, current policy access, original session, and current source admission for agent use. It returns the same exposure. It never loads current content to infer the historical result's policy. Profile revision and reference revision readers supply authoritative historical identity checks. Their checks use the passed transaction. Generic replay does not inspect `profile`, `assessment`, `reference`, `result`, `excerpts`, or arbitrary recursive field names.

For existing artifact, page, document, and annex results, move their exact identity capture into their existing owners when adopting this result contract. Preserve their current historical semantics. Until those owners are migrated, retain explicitly typed domain capture adapters for those known identities. Do not retain generic research reconstruction as a fallback for new results.

`recordToolProvenance()` consumes returned policies and source maps. It records every known obligation and adds uncertainty when declared classification is incomplete. It does not replace known guards with an empty uncertain policy. New affected tools cannot reach that fallback because owned exposure is mandatory. Conversation and artifact history retains the exact policies of the messages or results actually consumed. Fresh authenticated shared requests still use their own selected input snapshots. The legacy conversation union remains only a conservative compatibility reader, never the source of a new shared request's eligibility.

### Research chunk and policy pinning

Add one domain-owned source operation in `research/case-references.ts` or `case-material.ts`. Both selection functions in `ai-sources.ts` delegate to it:

```ts
type ResearchSelection =
	| { kind: 'current-reference'; caseId: string; referenceId: string }
	| { kind: 'pinned-reference'; caseId: string; referenceId: string; materialVersionId: string };

function selectResearchEvidence(
	context: WorkspaceContext, selections: readonly ResearchSelection[], query?: string,
): Promise<readonly BoundResearchChunk[]> { throw new Error('not implemented'); }

type BoundResearchChunk = Readonly<{
	chunk: ResearchSourceChunk;
	policy: ContentPolicy;
	referenceId: string;
	materialVersionId: string;
	materialSha256: string;
}>;
```

The owner checks the person's selected reference scope, case, exact material identity, same-material relation for historical pins, and installation permissions. It resolves each mutable reference once, then reads chunks by that immutable version. It constructs the observation and source map from the same rows. A legitimate V1-to-V2 reference change cannot create V1 policy attached to V2 text. Keep historical worker and artifact resolution behavior, including current reference deletion rules, as explicitly distinct selections.

`knowledge/retrieval.ts` consumes bound chunks directly. Remove its preliminary `observeResearch()` loop and its policy map reconstructed from reference IDs. The same bound result feeds `sourcesFromTool()` and `recordSources()`. Validate that every cached research chunk belongs to its claimed material version. A non-excerpt note edit does not automatically change the policy of a material chunk it did not use.

### Managed exact file access and original-author disclosure

`bindManagedFile()` is the single file-binding owner in `content-policy.ts`. It resolves the selected version, original version author, stored derivation policy, observed source document and ancestors, exact digest, and byte size together. It returns two policies:

- `access` includes the stored derivation obligations plus document and observed ancestors. It authorizes the sender to stage, retry, render, or dispatch these exact bytes. It is never erased by the disclosure exception.
- `disclosure` governs the recipient. By default it includes those resource obligations too. Only a proven independent original contributed by this exact sender can omit its own container obligations for disclosure. Inherited obligations and owner fences never disappear.

The independent-original check requires the pinned version's actual author, an eligible independent contribution, and no inherited guards or owners. A generated, exported, copied, edited, or application-prefilled version cannot become independent because `created_by` names the latest writer. Add a small version-level contribution tag if current origin evidence cannot distinguish these paths. Authenticated direct upload stamps original author and submission receipt. Managed transforms stamp derivation. Version replacement preserves prior obligations and records derivation. A new uploader does not acquire another person's original authority.

The binding resolves an explicit historical version directly. Do not observe the active version and then attach another version's storage bytes. Current document location and retained observed ancestors restrict that historical read. File staging opens the binding's `stored_name` internally and verifies byte count and SHA-256. Final access checks verify the immutable version row still matches the binding. Drive also preserves its existing requirement that the reviewed active local and remote versions have not changed. Unknown contribution status never grants the author exception.

The current `pinnedArtifactTemplate()` heuristic is moved into this owner and strengthened with that contribution tag. Its callers receive both policies. For a template that the person independently authored, recipient disclosure does not require access to the person's private case. The renderer and sender still require current exact-file access before staging and dispatch. A selected inaccessible template still fails without fallback.

Gmail's `Prepared` retains each file binding separately from outgoing subject/body policy. Its reviewed operation persists file bindings and attachment digests. Drive replacement stores the same binding alongside its existing remote version. `assertExecution()` evaluates outgoing text disclosure, sender file access, and file disclosure. The existing transport guard repeats these checks after Google OAuth refresh and before every write request. A remote draft created by this operation retains its file bindings through `draftBinding()`. Reusing its attachments cannot drop the managed file obligations by reading them back from Gmail as opaque attachments. Existing unknown-result reconciliation remains read-only and never resends to recover an ambiguous send.

Personal shares persist the file binding with `document_version_id`. Creation checks sender access and recipient disclosure in the same transaction as insertion. Internal recipients of another person's protected original must satisfy the retained disclosure policy. External audiences remain denied unless the disclosure policy qualifies for external delivery. Share reads stage pinned bytes, verify digest, then recheck active share, recipient, sender's current access policy, and recipient's disclosure policy. Do not evaluate the sender-only access policy as the recipient. That would incorrectly make an authorized disclosure of one's original require the recipient to join a private case.

The personal email outbox uses the same persisted binding and original sender session. Its dispatch admission occurs inside the actual HTTP or `EMAIL.send` transport, after configuration preparation, for each retry. Mark dispatch intent under the lease before transport and retain current unknown-outcome behavior. Revocation before admission sends nothing. Revocation after an already admitted send cannot retract delivered bytes. Streamed recipient reads have the corresponding limit after bytes begin.

### Final provider admission and every retry

Use one small server-owned admission object rather than arbitrary `beforeSend` closures at each caller. Its factory lives with existing context and policy code. The provider owns when it evaluates the object.

```ts
type RequestAuthority =
	| { kind: 'interactive'; context: WorkspaceContext; sessionId: string }
	| { kind: 'queued'; originalContext: OriginalRequestContext;
		originalSessionId: string; job: { id: string; leaseToken: string } };

type ProviderAdmission = Readonly<{
	authority: RequestAuthority;
	operation: CapabilityName;
	policies: readonly ContentPolicy[];
	inputDigest: string;
}> & ProviderAdmissionBrand;

// ai-runtime.ts. Source-bearing structured execution requires admission.
function generateStructured<T>(
	request: AdmittedStructuredRequest<T>,
): Promise<T> { throw new Error('not implemented'); }

// typesafe/client.ts. Preserve existing purpose, budget, and accounting semantics.
function evaluate(
	authority: RequestAuthority, purpose: DecisionPurpose,
	request: DecisionInput,
	options: { admission: ProviderAdmission; signal?: AbortSignal; deadlineMs?: number },
): Promise<Evaluation> { throw new Error('not implemented'); }
```

Keep administrative connection probes and application-only tests explicitly separate from source-bearing execution. They do not acquire a synthetic user's authority or a caller-selectable bypass. Existing other structured producers can be migrated through an overload that demands a trusted application-only request or admission. No protected caller may keep the old optional admission form.

The admission validator takes the existing short shared ACL transaction before session and resource locks. It checks the original session with `clock_timestamp()`, membership, original guest capability, source ACL and pinned policy, Lume admission for the operation and every source case, cancellation, and active attempt or worker lease. It checks the session again after its own waits. It finishes before starting provider network I/O. It does not hold the global gate while a provider responds.

The protected boundary is admission of a prepared application request to a concrete transport attempt. ACL mutations completed before this admission transaction must prevent dispatch. A mutation ordered after admission can race with the immediately invoked network call. The design does not claim atomicity between a PostgreSQL commit and a remote disclosure, nor cancellation of bytes already sent. There must be no application staging, credential-refresh, budget-reservation, retry backoff, queue wait, or provider-resolution await between final admission and transport entry. Socket scheduling and provider-internal processing remain beyond that boundary.

For structured models, checking only before `agent.generate()` is insufficient to cover retries or framework repair calls. `ai-providers.ts` must construct a request-local model adapter with guarded HTTP transport. `modelFor()` currently gives CLIProxyAPI an injected fetch but gives other providers a router credential object. The installed `OpenAICompatibleConfig` does not expose `fetch`. Therefore a proposal to merely add `fetch` to that object is not an implementation.

Use native provider factories with request-local transport injection for guarded structured work. Preserve the existing provider and protocol, effort options, task selection, and accounting. The exhaustive provider union is the existing `AI_PROVIDERS`. Each of `openai`, `anthropic`, `google`, `deepseek`, `inception`, `openrouter`, `vercel`, and `cliproxyapi` must resolve through a guarded adapter for source-bearing requests. This may require explicit provider adapter dependencies. It is bounded provider plumbing in `ai-providers.ts`, not a new generation framework. Private chat need not be migrated in this repair merely to move the structured boundary.

The injected fetch wrapper performs final admission and then calls the actual fetch without another awaited preparation. It refuses redirects for protected requests. It runs for initial structured output, SDK retries, schema repair requests, and any secondary output-model request. The runtime freezes the admitted prompt, schema, instructions, and image digests. The adapter owns wire encoding and binds its request-body digest to that immutable invocation. Framework formatting may change the envelope, but may not introduce history, private session continuation, tools, or new source text. A repair call that includes generated output retains that output's policy and the original contributors. Provider-side automatic fallback chains are disabled for this tool-free shared path unless every fallback uses the same guarded transport and fresh task session. A raw router fallback is never permitted. Construction must fail visibly if a configured protected adapter cannot preserve the transport binding. That is an implementation blocker to resolve, not an accepted removal of the provider feature.

CLIProxyAPI retains `store: false`, a fresh task session, and no previous response identifier. Shared structured generation has no tools, memory, transcript, native search, or reused private provider session. Other providers keep their protocols with the same stateless invariant. The guard is request-local. Do not replace global fetch or create a global mutable current policy.

TypeSafe currently sets `maxRetries: 0`. Keep that value. `evaluate()` performs final admission after config, reservation, credential decryption, and request construction, immediately before its concrete transport. Every rerank batch carries the policy of the candidates sent in that batch and the original request authority. Citation review and research assessment use the same option. Test transport injection remains an internal seam behind admission. An admission denial propagates as a domain authorization failure. It must not become a provider credential failure, circuit-breaker event, or a degraded successful rerank returning revoked sources. Provider unavailable results can retain the existing degraded behavior after current source revalidation.

Batch admission also includes the query's policy and any generated paragraph sent for citation review. Candidate source policies alone cannot account for planner-supplied query text or private generated output. The invocation supplies its known source policies plus uncertainty for those private values. This preserves known revocation guards without certifying private text as eligible shared input. The final validator authorizes their current use but does not change their origin.

Research worker retries use the stored original authority and immutable input, with a fresh lease and fresh admission each time. Persist the requesting session and invocation context on queued source-bearing assessments. Never reconstruct a session-free human context to bypass expiry. Legacy queued rows without recoverable request authority cannot newly send protected text. They become unavailable with a retry-from-authenticated-request path. Do not apply this rule to independent system maintenance jobs that never disclose user source bytes.

Google's single 401 retry obtains a new token, calls its existing write guard again, and uses the same immutable text and file binding. Personal email's bounded retries recheck the outbox lease, original sender session, share state, and file binding at each HTTP or binding entry. Unknown sends are not automatically retried. Application generation-attempt lease recovery reuses the exact recorded input and obtains fresh admission. No retry inherits a positive ACL decision.

### Annex response ownership

In `vault-annexes.tsx`, use one component-local monotonically increasing selection epoch and operation token for reopen, analysis, and generation. The captured identity contains case ID, scan ID, selection epoch, and operation sequence. Generation also captures plan ID and the existing items/folder signature.

Selection change or reset increments the epoch synchronously, aborts cancellable requests, clears displayed plan/result/error, and resets the busy operation. Completion, catch, and finally update state only if both selection epoch and operation token remain current. Analysis wins over an older reopen GET on the same scan because it advances the operation token. Returning A to B to A does not make the original A response current. A response's `scanDocumentId` must also match its captured request. Generation requires `plan.scanDocumentId === scanId` before posting.

An obsolete generation may have successfully created A's files. Ignoring its response does not claim server cancellation or undo that result. The exact server idempotency key permits later recovery. Keep per-signature retry identity for the operation rather than letting a stale callback overwrite the new selection's key. No global request registry is needed. Human label and range editing, keyboard controls, existing mobile form, and explicit generate review remain.

The server still permits valid managed plan reopen, older authorized plans, and an independent new analysis after unrelated old petition revocation. It retains only the exact plan's sources. The UI fence never introduces an actor/case/scan lifetime policy union.

### Module map and deletions

- `content-policy.ts` remains the policy parser, flat guard evaluator, source observer, exposure carrier, and managed-file binding owner. It gains the single explicit original-author decision. It does not become a universal content database.
- `research/case-content.ts` is the new bounded research contribution contract. Profile fields and reference notes use it. Its internal types are not importable by capability adapters as an alternative raw writer.
- `research/case-profile.ts` owns profile revision CAS, projection, and SQL. `research/case-references.ts` owns notes, reference revisions, material identity, and complete nested results. `research/case-assessment.ts` owns exact queued input, lease, result policy, and authorized freshness reporting.
- `documents/shared-writing.ts` keeps authenticated input and attempt mechanism, with explicit purpose and schema-specific output. It loses the two-mode `sharedPage` shortcut. `documents/service.ts` keeps the short content transaction and existing private document writers.
- `application/research-capability-service.ts` performs error and DTO adaptation. Remove `application/research-case-service.ts`'s pass-through re-exports if no policy or compatibility responsibility remains. Direct domain imports shorten the trace.
- `application/agent-settings-service.ts` aggregates policy-bearing reads. Delete `settingsReplayPolicies()` after migrating callers. Remove the independent policy reloads from instruction and knowledge prompt assembly where the reader already supplies the same exact policy.
- `application/capability-replay.ts` retains storage validation and exact replay. Delete its research top-level shape loop, chunk-ID reconstruction, settings reconstruction, and the fallback that treats absent research exposure as a usable substitute. Move canonical artifact/page/file/annex identity construction to those owners as they adopt the same handoff.
- `case-pages/provenance.ts` consumes exposure and preserves legacy compatibility. Its affected-tool paths lose property guessing and duplicate `observePage` or `observeVaultFile` rereads. Keep compatibility helpers still needed for old provenance rows until those readers are deliberately retired.
- `knowledge/retrieval.ts` uses bound research chunks and policy-bearing Vault candidates. `ai-sources.ts` retains public selection compatibility but loses independent mutable version resolution. `typesafe/rerank.ts` carries batch admission; `citations/review.ts` loses its custom source-loop transport wrapper after adopting common TypeSafe admission.
- `ai-runtime.ts` requires admission for source-bearing structured work. `ai-providers.ts` owns exhaustive guarded adapter construction. Neither accepts a freeform planner policy claim.
- Gmail, Drive, personal shares, and template rendering consume `ManagedFileBinding`. Delete their delivery-only `vaultPolicy()` shortcuts and `pinnedArtifactTemplate()`'s duplicate original-owner policy surgery. Preserve `vaultPolicy()` for the stored derivation readers that actually need it.
- `vault-annexes.tsx` owns only its request correlation. No unit3 case tasks, notifications, Lume flag UI, or visual redesign enters this repair.

An agent opening only the profile writer sees one required `ResearchTextChange` and one contribution contract. It cannot copy a nearby raw save that silently marks planner text human. An agent opening only a reference adapter sees an owned result and a single DTO mapping. An agent adding a protected provider call must supply admission, and a new provider member fails the exhaustive guarded adapter map. Enforce restricted imports for the generation mechanism and internal research contribution builders in the existing lint configuration. Brands alone are not a runtime security boundary. Server validation and persisted receipts still enforce them.

The nine finding groups have explicit owners:

1. A1 belongs to complete reference results and owned replay binding. Nested assessment contributors survive DTO mapping and cache serialization.
2. A2 belongs to `research/case-content.ts` and the profile command. Authenticated input and generated receipts replace raw planner field writes.
3. A3 belongs to the exact assessment result reader. Current authorization precedes freshness reporting.
4. A4 and C2 belong to the guarded structured provider transport. Image, credit, configuration, and framework waits precede final admission.
5. B1 and C1 belong to managed file binding and existing delivery owners. Sender access and recipient disclosure remain distinct through staging and reads.
6. B2 belongs to the policy-bearing settings getter and common DTO handoff. Disabled instructions retain their policies.
7. B3 belongs to TypeSafe final transport admission for every rerank batch, including query policy.
8. B4 belongs to the annex component's selection epoch and operation token. Server plan provenance remains unchanged.
9. C3 belongs to the research evidence selector. It returns one immutable text/version/policy pairing.

### Additive persistence and compatibility

Use the next unused migration after 0083. Never edit 0075 through 0083, including 0080a. Exact names should follow current migration conventions.

Add research-owned policy JSON to profile and profile revision rows, including stable entry IDs. Add note policy to references and a small reference revision table keyed by reference ID and version because reference rows currently overwrite notes. It stores the exact snapshot and policies needed for replay, not another activity ledger. Add immutable assessment input JSON, input policy, result policy, and original request authority. Existing profile revisions remain the historical owner. Bind generated research outputs using existing `content_generation_attempt.output` JSON with an additive output-format/schema tag. Existing page and outbound outputs remain readable by their original codec.

Add a version contribution tag only where needed to prove independent original status. Add persisted file binding to personal shares. Google operation encrypted `__bound` already accommodates the new file bindings. New share and research writes require complete bindings in the owning transaction. SQL JSON checks or owner validation reject malformed policy/byte pairs. Do not replace `ContentPolicy` with a new provenance schema.

Legacy research fields without policy cannot be retroactively certified from `updated_by` or `reviewed_by`. Those columns identify writers, not whether a planner supplied the bytes. Retain stored text and revisions. Recover any trustworthy submission or generation receipt and every known source obligation. Unresolved freeform parts remain uncertain and privately visible to the actual recorded writer under known guards. Other participants receive neutral withheld-field information, not the unknown bytes. This deliberately narrows unproven research text because the demonstrated planner leak crosses the shared-resource boundary. It does not quarantine old pages or rewrite them.

A valid independently recorded human profile revision remains shared according to case and field access. An in-place human edit of unresolved generated text preserves its uncertainty. Recovery is a new admitted request or genuinely new independently submitted contribution, with server seed tracking. Confirmation is not source certification. Legacy assessments with recoverable complete input identity can retain authorized historical reads. Results whose exact contributors cannot be recovered expose neutral status and preserve stored data until recomputed. They do not invent an eligible policy from their excerpts alone.

For legacy files, preserve the accepted legacy-human convention only when existing origin records, source references, and version history give no contradictory managed-derivation evidence. Label this as a historical compatibility assumption. Unknown generated files never gain the original-author exception. New managed copies and edits always record derivation, even if the underlying contribution was a person upload. Existing recognized artifact exports and connector imports are inspected before allowing a legacy exception.

Replay binding format 1 stays supported for owners whose exact existing binding is complete. A legacy research replay produced by the shallow reconstruction lacks a completeness proof. Preserve its effect record and idempotency reservation, deny its content replay, and permit the user to read the current resource through the canonical owner. Never rerun the write to repair a cache. New format 2 payload digest and identities distinguish the complete owner-issued binding. This does not change generic pending/unknown reservation recovery semantics.

## Synthesis decision

This candidate selects domain-owned research generation and field projection as the base. Parent synthesis across candidates has not occurred. The decision here combines the existing source-policy mechanism with one missing research contract. It adds exact result handoffs and a transport-owned admission check rather than a universal event ledger. It preserves independent requests, shared structured editing, and existing delivery confirmations.

The public research command tells the domain whether it receives an authenticated contribution, a current request to generate, or an exact confirmation. The caller never constructs a policy manifest or asks a generic outbound writer to understand a research profile. The domain hides schema, partial visibility, receipts, nested assessments, and baseline retention behind its current operations. This is the smallest interface that contains the review findings.

## Tradeoffs accepted

- We accept fixed research field and list-entry bindings in exchange for preserving visibility and hidden-field edits without a generic JSON policy interpreter.
- We accept all-source policy inheritance for every field from one generation in exchange for avoiding unverifiable model attribution. Separate independent human fields can remain less restricted.
- We accept a reference revision snapshot table in exchange for exact historical note replay. It has one domain owner and does not duplicate a universal event system.
- We accept conservative denial of incomplete legacy research bytes in exchange for preventing the proven planner leak from surviving migration. Stored data remains intact.
- We accept explicit request-local provider adapter work in exchange for guarding framework retries and secondary structured calls. A pre-`agent.generate()` callback alone does not buy that guarantee.
- We accept admission linearization before concrete transport entry in exchange for releasing the schema-wide ACL gate before slow network work. We cannot make PostgreSQL and remote delivery atomic.
- We accept rejecting an exact historical replay after one contributor revocation in exchange for preserving exact cached outcomes. The canonical current reader can independently return a projected result.

## Alternatives considered

### Viable alternative A, central typed research draft receipts

A central shared writer could expose `prepareResearchDraft(submissionId, target, schemaKind)` and own the full structured draft, field policies, prefill seed, and receipt. Research would accept only `applyResearchDraft(receiptId, expectedVersion)` or authenticated human patches. The generator would return policy-bearing entry values, never raw title/content JSON. The research owner would still validate source handles, CAS, field projection, and persistence.

This is structurally different from the selected command. Generation and its field-policy representation belong to a central draft service. Profile and notes writers consume an external domain-complete receipt. It is viable if the central writer owns a closed registry for these two research schemas and if application adapters cannot substitute receipts between targets.

Its public interface has two operations and an exposed receipt lifecycle. Callers must distinguish preparation from application and locate the right draft after a conflict. The central writer must know profile field identity, notes seeding, document-linked facts, material-reference targets, and partial-visibility merges. Research must know the same schema to apply and project it. That splits policy ownership across the central draft service and research. Adding a profile field would require coordinated changes in both owners. The losing interface hides provider work but exposes domain synchronization and temporal choreography. It loses on interface depth for this bounded repair.

### Selected alternative B, research command owns generation and contributions

`saveResearchCaseProfile(change)` and reference note commands resolve their own authenticated request or exact confirmation. The domain builds the structured schema and contribution policy. It asks the existing writing mechanism only to execute an admitted stateless request and retain an exact attempt. A caller never handles a generated draft receipt directly. A domain proposal stores that receipt privately.

The mechanism hides provider staging and lease recovery. The research domain hides structured evidence, visibility, field merging, and result completeness. Changing a profile field changes its domain schema and projection together. This contains complexity in the callee instead of making the adapter coordinate phases. It is the selected shape.

### Rejected shortcut, one policy for the whole mutable profile

A single `content_policy` combined with all profile sources is smaller to persist, but it cannot preserve the current field/document visibility behavior. It either leaks unguarded alleged facts or makes a person's independent objective disappear when another person's fact is revoked. Recombining every historical source creates the rejected lifetime union. Giving generated-only writes a whole-row policy while leaving human edits policy-free creates a second laundering route. This shortcut is not viable under the stated product invariants.

### Rejected shortcut, pre-call callbacks and recursive replay inference

A `beforeGenerate` callback plus a recursive scan of JSON fields would be easy to graft. It leaves SDK retries, nested renamed fields, freeform notes, disabled instructions, and actual owner knowledge outside the contract. It changes the location of the shallow reconstruction without removing its premise. It cannot represent exact managed-file access separately from disclosure.

## Open questions and risks

These are implementation proof obligations for the parent, not requests to pause for preference.

1. Can every configured model provider's native adapter preserve the current protocol and task behavior while injecting request-local fetch, including structured-output repair and secondary model calls? The local router type lacks this hook. Actual adapter selection and regression coverage are required before claiming complete provider admission.
2. Can the writer recover trustworthy legacy research submissions and original upload evidence without guessing from reviewer identity? The migration must inventory real provenance records. Unrecoverable entries follow the conservative read behavior above.
3. Does the existing profile form issue enough stable entry identity to preserve invisible facts and distinguish moves across documented and alleged lists? The proposed read token and internal entry IDs must be exercised through the actual capability and UI, not only merge helper tests.
4. Does an authenticated original-author share remain readable for a recipient outside the private case while sender revocation, contributor revocation, deletion, and tampered bytes still deny it? This is the decisive file-binding distinction. `access` must never accidentally be evaluated as recipient policy.
5. Does catalog permission mutation participate in the same existing ACL ordering as admission? Applied 0076 installs broad triggers, but the final writer must verify real mutation paths and wall-clock expiry after held waits. No network call may occur while holding that gate.
6. Do Google draft attachment reuse and remote replacement retries preserve file bindings, including imported managed copies and unknown-outcome reconciliation? These neighboring paths were static findings, not runtime-cleared paths.
7. Can assessment completion preserve authorized stale results while preventing use of revoked exact V1 contributors or a session-free worker reconstruction? The persisted input and result policy need production-entry tests.

The current four runtime negative proofs are the nested reference replay, private planner profile write, stale catalog assessment, and image-staging dispatch leak. Their [research reproduction](lume-source-round3-repro.test.ts) and [image reproduction](lume-source-image-dispatch-repro.test.ts) were read, not executed. Fixture failures and the unrelated citation sanity test are not additional proofs.

Remaining static groups need these concrete acceptance proofs:

- Deliver another person's restricted original through real Gmail prepare/send, Drive replacement, personal share creation, recipient read, and deferred email transport. Hold storage or refresh, revoke, resume, and assert zero dispatch or response bytes. Include the positive own-original recipient case and a managed copy denial.
- Read a disabled protected instruction through `k5_agent_settings_get`, create a private artifact from that invocation, revoke the source, and assert both artifact and assistant history are unavailable. Include retained knowledge notes and template metadata through actual output parsing.
- Hold the TypeSafe platform reservation row, start actual retrieval rerank, complete source revocation or natural session expiry, then release. Assert no external send. Repeat on a later batch. Admission denial must not masquerade as an unavailable-provider success.
- Switch the actual annex selector while A analysis or generation waits. Let A complete after B and after A-to-B-to-A. Assert plan, busy, errors, and links belong to the latest request. Reopen an old authorized plan and create an independent new analysis after old petition revocation.
- Switch a reference from V1 to V2 between selection stages. Assert chunk, material version, digest, policy, and citation cache remain one immutable pairing. This proves historical correctness. Do not advertise it as a demonstrated cross-material permission bypass.
- Exercise profile human editing, hidden facts, seeded agent notes, CAS conflict, approval replay, worker retry, authorized stale history, and exact result replay through canonical owners. Include malformed legacy bindings and effect-preserving cache denial.
- Exercise provider retries, Google 401 refresh, framework structured repair, cancellation, session logout, and natural expiry after waits at actual transport entry. Stubs may replace external providers only. They must capture bytes and call count.

The sole writer must run the repository's required lint, typecheck, relevant tests, affected e2e, and route/compilation build checks after implementation. Desktop, mobile, keyboard, loading, empty, withheld, and error behavior follow `apps/web/DESIGN.md`. This candidate ran none. Prior passing suites are recorded evidence from the parent, not proof of these changes. Generic reservation recovery, the earlier intermittent navigation cause, and observed session-endpoint 429s remain unresolved unless separately proven.

## Next implementation step

Implement the research contribution contract and owned-result handoff for one real profile save, assessment read, and nested reference replay, while preparing the mandatory request-local provider transport boundary before enabling new generated research writes.
