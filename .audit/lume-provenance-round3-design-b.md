# Candidate B. Domain-owned research content and complete policy handoffs

## Usage (caller's view)

A person keeps editing the case profile in the existing form. The authenticated HTTP adapter binds the submitted fields to the exact edit seed before calling the research owner. The owner preserves field policies and optimistic concurrency. It returns the currently visible projection, with its policy attached inside the server.

```ts
// Proposed signatures and pseudocode throughout this document.
// The current profile PUT route continues through handleCapability/runCapability.
import { writeResearchContent } from '@/lib/research/case-content';

const context = workspaceContext(await apiWorkspace(request, true));
const result = await writeResearchContent(context, {
	kind: 'profile', caseId, expectedVersion: body.expectedVersion,
	write: await bindResearchFormSubmission(context, body, request.signal),
});
return Response.json(result.value, { headers: { 'Cache-Control': 'private, no-store' } });
```

The private agent can still help create and edit profiles and reference notes. It supplies a resource selector, never the text to publish. The research owner resolves the original human submission, selected current sources, and any explicitly continued research revision. It generates a fresh structured result without the planner transcript, memory, or tool continuation. A useful agent operation remains available.

```ts
import { writeResearchContent } from '@/lib/research/case-content';
import { mapContentResult } from '@/lib/content-policy';

// research-capability-service.saveProfile after runCapability scopes the target.
const result = await writeResearchContent(context, {
	kind: 'profile', caseId: input.caseId, expectedVersion: input.expectedVersion,
	write: { kind: 'submitted-generation' },
});
return mapContentResult(result, profile => ({ profile }));

// The same domain writer commits notes, their policy, and link changes together.
return writeResearchContent(context, {
	kind: 'reference', target: {
		kind: 'update', referenceId: input.referenceId,
		expectedVersion: input.expectedVersion, purpose: input.purpose,
	}, write: { kind: 'submitted-generation' },
});
```

A worker consumes the immutable assessment input captured by its research owner. A Gmail attachment uses an exact managed-file binding. Neither caller assembles access rules from arbitrary result fields.

```ts
// case-assessment.processNextResearchAssessment, within its existing lease.
const input = await loadAssessmentInput(context, assessmentId, leaseToken);
const evaluation = await evaluate(context, 'research', input.decision, {
	admission: input.admission, signal: context.signal, send: options.send,
});
await finishAssessment(context, assessmentId, leaseToken, input, evaluation);

// gmail.preparedFiles. The managed-file owner stages bytes and retains both policies.
const file = await stageManagedFile(context, { documentId: ref.documentId });
prepared.files.push(file.mailFile);
prepared.managedFiles.push(file.binding);
// runGoogleOperation persists these bindings in __bound, and its existing
// transport write guard rechecks them after token waits and on the 401 retry.
```

These are proposed APIs. No production code accompanies this candidate. The parent owns final synthesis and implementation.

## Shape

Keep `ContentPolicy` format 1 and its flat guards, observed versions, eligibility, owners, origin, digest, and receipt. Extend its handoff, not its meaning. Use three bounded authorities.

1. `research/case-content.ts` owns profile and reference-note authorship, field policy, clean structured generation, and revision writes. `case-assessment.ts` owns assessment inputs and result policy. The domain returns complete policy-bearing projections.
2. A managed-file operation in the existing file owner binds exact bytes to both the sender's access and the content's disclosure authority. `artifact-file.ts` uses that owner for templates instead of keeping a special authorship algorithm.
3. The existing runtime and transports own final admission. Their domain callers provide a sealed admission description, not a callback that can return permission without checking anything.

The following types are server-only. Brands have private constructors. Database JSON and HTTP JSON become these types only at their owning boundary. Public DTO schemas remain the transport fence.

```ts
// content-policy.ts. The policy payload remains the existing ContentPolicy.
type ContentResult<T> = Readonly<{
	value: T;
	exposure: ContentExposure;
	[contentResultBrand]: true;
}>;
type ContentExposure = Readonly<{
	policies: readonly ContentPolicy[];
	sources: Readonly<Record<string, ContentPolicy>>;
	identities: readonly ResultIdentity[];
	payloadDigest: string;
}>;
type ResultIdentity =
	| { kind: 'research-profile'; caseId: string; version: number; digest: string }
	| { kind: 'research-reference'; id: string; version: number; digest: string }
	| { kind: 'research-assessment'; id: string; inputDigest: string; resultDigest: string }
	| ExistingExactResultIdentity;

// Only trusted domain owners create ContentResult. These transforms preserve
// exact domain identities, and recompute the canonical projected DTO digest.
declare function mapContentResult<A, B>(
	result: ContentResult<A>, map: (value: A) => B,
): ContentResult<B>;
declare function parseContentResult<S extends z.ZodType>(
	schema: S, result: ContentResult<unknown>,
): ContentResult<z.output<S>>;

// research/case-content.ts. This finite contract serves two research resources.
type ResearchWrite =
	| { kind: 'person'; submission: ResearchFormSubmission }
	| { kind: 'submitted-generation' }
	| { kind: 'approved'; approvalId: string };
type ResearchContentCommand =
	| { kind: 'profile'; caseId: string; expectedVersion: number; write: ResearchWrite }
	| { kind: 'reference'; target: ResearchReferenceTarget;
		write: ResearchWrite | { kind: 'retain-notes' } | { kind: 'empty-notes' } };
type ResearchReferenceTarget =
	| { kind: 'add'; caseId: string; materialVersionId: string;
		assessmentId: string; purpose: ReferencePurpose; bypassEvaluation: boolean }
	| { kind: 'update'; referenceId: string; expectedVersion: number;
		purpose?: ReferencePurpose; materialVersionId?: string; assessmentId?: string };

declare function writeResearchContent(
	context: WorkspaceContext, command: ResearchContentCommand,
): Promise<ContentResult<ResearchProfileProjection | ResearchCaseReference>>;
// Discriminated overloads give profile callers only the profile projection.
// No public load/check/generate/commit choreography is introduced.
// retain-notes is update-only; empty-notes is add-only and creates an app constant.
type ProfileTextFields = Pick<ResearchCaseProfile,
	'legalQuestion' | 'objective' | 'thesis' | 'documentedFacts' | 'allegedFacts' | 'gaps'>;
type ResearchProfileProjection =
	(ResearchCaseProfile & { withheldFields?: readonly (keyof ProfileTextFields)[] })
	| Readonly<{
	state: 'restricted'; caseId: string; version: number;
	fields: Partial<ProfileTextFields>; withheldFields: readonly (keyof ProfileTextFields)[];
}>;
// Existing complete DTO remains valid. The finite restricted projection is
// explicit in the getter/output schemas and cannot be passed to assessment input.

type ResearchFormSubmission = Readonly<{
	id: string; target: ResearchContentTarget; baseRevision: number | null;
	submittedDigest: string; seedId: string | null;
	[researchFormSubmissionBrand]: true;
}>;
type ResearchContentTarget =
	| { kind: 'profile'; caseId: string }
	| { kind: 'reference-notes'; reference: ResearchReferenceTarget };

// Private persisted representation. It is not an agent input or browser policy.
type ProfilePolicyBundle = Readonly<{
	format: 1; snapshotDigest: string;
	legalQuestion: ContentPolicy; objective: ContentPolicy;
	thesis: ContentPolicy | null;
	allegedFacts: readonly PolicyEntry[]; gaps: readonly PolicyEntry[];
	documentedFacts: readonly PolicyEntry[];
}>;
type PolicyEntry = Readonly<{
	entryId: string; valueDigest: string; policy: ContentPolicy;
}>;
type RetainedResearchRevision<T, P> = Readonly<{
	version: number; value: T; policy: P; receipt: string;
}>;
type AssessmentInput = Readonly<{
	profileRevision: number; materialVersionId: string; materialDigest: string;
	decision: ResearchDecisionInput; excerpts: readonly BoundAssessmentExcerpt[];
	inputPolicy: ContentPolicy; inputDigest: string;
	admission: ProviderAdmission;
}>;
type BoundAssessmentExcerpt = Readonly<{
	excerpt: ResearchAssessmentResult['excerpts'][number];
	policy: ContentPolicy;
	pin: VaultChunkPin | ResearchChunkPin;
}>;
type ResearchChunkPin = Readonly<{
	referenceId?: string; materialVersionId: string; materialDigest: string;
	chunkId: string; textDigest: string;
}>;

// ai-sources.ts. One resolution supplies both selected bytes and their policy.
type ResearchSelection =
	| { kind: 'current'; referenceIds: readonly string[] }
	| { kind: 'pinned'; references: readonly PinnedResearchReference[] };
declare function selectedResearchContent(
	context: WorkspaceContext, caseId: string,
	selection: ResearchSelection, query?: string,
): Promise<ContentResult<readonly SourceChunk[]>>;

// Managed-file internals live with Vault exact-version reads, not in connectors.
type ManagedFileBinding = Readonly<{
	format: 1;
	identity: { documentId: string; versionId: string; version: number; digest: string };
	authorization: ContentPolicy;
	disclosure: ContentPolicy;
	authority:
		| { kind: 'retained-sources' }
		| { kind: 'own-original'; authorId: string; contributionReceipt: string };
}>;
declare function stageManagedFile(
	context: WorkspaceContext, selector: { documentId: string; version?: number },
): Promise<StagedManagedFile>;
// Vault's internal assertion is shared by Google operations and personal shares.
// Selector version is optional only at initial selection, never after staging.

// application/context.ts. This is authority to recheck, never a permission cache.
type ProviderAdmission = Readonly<{
	actor: AdmissionActor;
	operation: CapabilityName | ResearchWorkerOperation;
	policies: readonly ContentPolicy[];
	managedFiles: readonly ManagedFileBinding[];
	payloadDigest: string;
	[providerAdmissionBrand]: true;
}>;
type AdmissionActor =
	| { kind: 'session'; userId: string; officeId: string; sessionId: string;
		invocation?: 'agent' | 'webmcp'; caseScope?: TrustedCaseScope }
	| { kind: 'research-worker'; assessmentId: string; leaseToken: string;
		requestedBy: string; officeId: string; originalSessionId: string };

// ai-runtime and typesafe/client consume an admission for protected content.
// Existing synthetic/configuration probes use an explicit source-free variant.
type ProtectedCall<T> = Readonly<{
	value: T; admission: ProviderAdmission;
}>;
declare function generateStructured<S extends z.ZodType>(
	context: StructuredActor, task: AiTaskKey | ResolvedTaskModel,
	input: ProtectedCall<StructuredInput>, schema: S,
	options?: StructuredOptions<z.output<S>>,
): Promise<z.output<S>>;
declare function evaluate(
	context: DecisionActor, purpose: DecisionPurpose,
	request: ResearchDecisionInput | OtherDecisionInput,
	options: DecisionOptions & { admission: ProviderAdmission },
): Promise<Evaluation>;
```

`StructuredInput`, schemas, prompts, and provider-specific wire types stay inside the runtime or research generation implementation. A protected call uses an immutable in-memory payload. It never rereads a mutable source while retaining an old policy.

The branded result replaces the current accidental guarantee that a `WeakMap` annotation survives every object spread. The HTTP boundary unwraps `value`. `runCapability` preserves the envelope through both schema parses, idempotency capture, and tool provenance. It may attach the already validated exposure to the returned DTO using `exposeContent` for existing chat consumers. That last adaptation does not authorize anything or guess policies. A composed reference/settings result retains all exact constituent identities and policies; its payload digest binds the final projection. These identities are replay metadata, not new `ContentPolicy.observed` kinds or a changed policy format.

### Module ownership and deletions

Paths below are relative to `apps/web/src/lib` unless stated otherwise.

- `content-policy.ts` remains the authority for policy composition, parsing, observation, and finite guard evaluation. Add only the result envelope and preserving transforms. Keep existing version classification and SQL compatibility behavior.
- `research/case-content.ts` becomes the sole writer of profile and reference revisions, including link metadata changed alongside notes. Its private helpers handle field policies and exact generation. `case-profile.ts` owns profile reads and projections. `case-references.ts` owns reference reads, exact material/link validation, and composition with nested assessment exposure. Move the existing save/add/update transaction bodies into the single writer and remove the old exported write paths after migrating callers. Read/validation helpers accept the supplied transaction connection; they cannot independently save notes or increment a reference version. This is a bounded move of two existing research writers, not a universal document plugin interface.
- `research/case-assessment.ts` owns the immutable input and result bindings. Its worker and reader use the same retained contributors. `researchCaseSnapshot` stops returning a raw unrestricted profile to the worker.
- `documents/shared-writing.ts` keeps page/outbound generation. Its existing authenticated submission resolution becomes one narrow internal input owner used by both document and research generation. It returns exact admitted submission inputs, including seed and continuation bindings. Research cannot call the raw recorder to pretend planner strings are human text. Do not copy `configuredInputs` or continuation inference into research.
- Reuse `content_generation_attempt` for preparation lease and receipt where its SQL representation already fits. Keep research output schemas, policy bundles, and approval commit with research. If its TypeScript `Attempt.output` must change, make it a finite discriminated persisted union for text, profile, and notes. Do not add a generic schema-name registry or arbitrary caller prompt callback.
- The extracted submission resolver must replace the current `sharedPage` binary audience branch with finite case-shared versus external input admission. Research generation uses case-shared source eligibility and scoped destination checks. It must not fall through `!sharedPage` into `assertExternalDelivery`, which would incorrectly reject legitimate protected case sources. Research still owns its structured schema and persistence; a profile never becomes an outbound title/body.
- `application/research-capability-service.ts` maps results with `mapContentResult`. Delete policy reconstruction there and remove the `application/research-case-service.ts` re-export layer if no distinct application behavior remains. Call canonical owners directly.
- `application/capability-replay.ts` serializes explicit exposure and exact result identity. Delete its research top-level `profile/assessment/reference`, `documentIds`, and `result.excerpts` inspection. Delete the call to `settingsReplayPolicies`. Move `researchSearchReplayPolicies` knowledge to its actual producing research results and remove that reconstruction helper. Vault/page/artifact/annex result bindings come from their existing owners rather than a growing generic field-name switch.
- `application/agent-settings-service.ts` composes instruction, knowledge-note, document-metadata, and template exposures returned by their owners. Delete the separately timed `settingsReplayPolicies` database reconstruction. Settings writes and consumed approval outcomes use this same classified getter.
- `case-pages/provenance.ts` consumes returned policies. Remove migrated content-result shape guessing and second observation of current page/document versions. Retain its legacy provenance reader and conservative uncertainty fallback for explicitly unsupported private results. Such fallback cannot be used to cache a known content-bearing write.
- `ai-sources.ts` owns exact research selection and policy together. Delete retrieval's separate `researchPolicies` observation pass followed by `selectedResearchSources`. Existing current/pinned wrappers migrate to the single selection owner, then disappear or become private local helpers.
- The existing Vault exact-version file owner supplies managed bindings to `artifact-file.ts`, Gmail, Drive, and personal shares. Delete their direct `vaultPolicy` delivery decisions and `artifact-file.ts`'s duplicated original-author exception.
- `ai-runtime.ts`, `ai-providers.ts`, and `typesafe/client.ts` own final provider admission. Delete citation review's custom authorization transport closure after migrating its text and candidate policies into the same admission. `typesafe/rerank.ts` accepts protected candidate batches rather than naked text.
- `components/vault-annexes.tsx` owns its active request state. Replace the disconnected `busy`, reopen abort, and unconditional analyze/generate completions with a request-identified local state. This adds no server-wide scan history rule.

For the next agent editing only `research-capability-service.ts`, the executor's declared return type requires `ContentResult`. Wrapping it in `{ profile: result.value }` fails that type. The nearest working example uses `mapContentResult`. An agent editing Gmail sees a required `managedFiles` field on the prepared operation and a staged-file example, not an optional `policy?`. An agent editing the protected runtime cannot pass a prompt string without an admission. These requirements belong to the existing capability definitions/executor registration and module import boundaries. They do not depend on the agent remembering an audit document.

## Traced model and design constraints

This is a read-only source trace. The binding evidence is [round3 verdict](lume-provenance-round3-verdict.md), the three complete [A](lume-provenance-round2-review-a.md), [B](lume-provenance-round2-review-b.md), and [C](lume-provenance-round2-review-c.md) reports, and the [census](lume-source-round3-census.json) with its [producer](lume-source-round3-census.mts). The census is bounded call-site evidence, not a completeness or vulnerability scanner.

The accepted [architecture](lume-architecture-synthesis.md) and [provenance](lume-provenance-synthesis.md) contracts require private planner isolation, exact current source checks, independent submissions, and immutable historical contributors. [The parent correction](lume-provenance-round2-parent.md) specifically rejects a lifetime union of annex plans. Earlier implementation reports describe intended repaired behavior. The round3 verdict overrides those reports where it supplies contrary evidence.

The actual production flow explains the failures.

1. Profile HTTP routes and published agent tools both enter `runCapability`, then `research-capability-service`, then `saveResearchCaseProfile`. The canonical writer currently accepts arbitrary freeform fields and batches current text plus a profile revision without policy. `getResearchCaseProfile` filters document IDs and documented facts, while returning the remaining freeform text. `researchCaseSnapshot` separately exposes the raw profile to assessment generation.
2. `getResearchCaseAssessment` rebuilds today's fingerprint, labels a mismatch stale, and returns saved `result_json`. Its special Vault chunk check can remove a result. It does not apply a retained exact catalog contributor policy. `referenceView` nests this assessment. `captureCapabilityReplay` checks only top-level `item.result.excerpts` and misses that nested text.
3. `getAgentSettings` returns plain lists. Instruction and note readers check stored policies but drop them. Disabled instructions remain in the getter and are absent from `instructionsPrompt`. `recordToolProvenance` records uncertainty without these known dependencies. The two output schema parses preserve only annotations present on the root object, so nested annotations alone cannot repair this.
4. `vaultPolicy` classifies stored contribution bytes. `observeVaultFile` separately adds the current document and ancestor guards. Gmail, Drive replacement, and personal sharing use the former. `pinnedArtifactTemplate` already separates authorization from disclosure and checks the pinned version's author. This is the local precedent for the managed-file repair.
5. `prepareSharedWriting` checks inside `documentTransaction`, releases it, then awaits images. `generateStructured` awaits credits and configuration before `agent.generate`. TypeSafe retrieval checks candidates before configuration and the shared platform-row reservation. Citation review's custom send wrapper demonstrates a later check, but is not a complete session/admission contract.
6. `googleRequest` awaits access tokens and invokes its write guard for every send, including its explicit 401 refresh retry. This mechanism is reusable once the stored operation contains both file obligations. The personal-email worker also preserves original sender session and an outbox lease. Its transport offers both HTTP fetch and `EMAIL.send`; both entries need the retained binding.
7. Research retrieval independently observes the reference's version and resolves chunks. A legitimate version update between those reads can pair V1 policy with V2 bytes. Annex reopen has an abort controller; analyze and generate completions do not use its request identity.

The root problem is split ownership of retained authority. The proposal removes reconstruction and places the last dispatch check at a transport entry. It does not replace authentication, the editor, collaboration ACL, or the provider accounting system.

## Research fields, generation, and persisted authority

### Preserve a structured resource

A profile is not an email body. A single aggregate policy used as a yes/no profile guard would hide independent human fields whenever one documented fact becomes unreadable. Store policies on the finite profile slots. Store a separate notes policy in each exact reference revision. There is no generic recursion through JSON keys.

An immutable profile policy bundle aligns with its exact scalar values and entry identities. Its digest covers the canonical structured snapshot, including source IDs and ordering. The owner verifies this binding before constructing a read projection. A malformed or mismatched bundle fails closed. A bundle is a domain-owned collection of existing policies, not a second policy algebra.

Human saves preserve unchanged slot policies. A changed slot in an actual continued edit inherits that slot's prior policy and its server-owned seed policy. Documented facts additionally retain the exact documents/chunks they cite. Removing an ID or replacing a sentence does not erase inherited restrictions. An unchanged independent slot retains its own policy. A new row in a continued list retains the displayed list seed's contributors, so dropping an entry token cannot erase provenance; genuinely new human creation without a prior content seed starts with the authenticated person's contribution policy.

Use server-issued entry tokens in a sidecar edit seed to preserve policy through reorder and duplicate text. `research-case-linker.tsx` currently trims and filters plain arrays before its full-form save. Its draft must retain the server token with each row through edits/reorder and submit the aligned token sidecar after filtering. The fact/text DTO shapes can remain compatible; tokens identify entries in a bound visible baseline, never arbitrary policy IDs. A token for a hidden row, another revision, or another actor fails admission. `research-case-references.tsx` likewise retains the exact notes seed through its save. A whole-list replacement or legacy client without row identity conservatively retains the prior affected list obligations; unchanged canonical values can retain their exact old policy. No similarity heuristic infers authorship. A new independent generation is different and does not read that old list.

At read time, authorize case access and then each returned slot. Preserve the existing document-ID and documented-fact visibility checks. Hide a documented fact if any cited document or its retained policy is unavailable. Filter inaccessible alleged facts and gaps by their own policy. A withheld optional thesis becomes null with an explicit withheld marker. If a required scalar cannot be disclosed, return the finite restricted projection with accessible fields, field availability, and version rather than an apparently complete valid profile with fabricated values. The person can still edit accessible fields; the server seed preserves omitted restricted fields unchanged. Its existence/version is neutral status only where current case access allows it. The UI uses plain pt-BR field/status text and cannot silently resave omitted fields as deletions.

The envelope contains precisely the policies of emitted content plus the profile's case guard. The assessment input owner uses an authorized unredacted projection for the requesting actor, and refuses evaluation when required evidence is missing. It cannot call an unrestricted raw snapshot as an alternate path.

### Generate from human intent at the research boundary

`writeResearchContent` switches by trusted invocation and write variant. Absence of `context.invocation` alone is not proof of human origin. A human form operation must carry the opaque submission created by authenticated ingress, including any app-provided edit seed. Agent and WebMCP paths cannot construct that submission. Generated writes derive from `context.submissionId` and `generationId` recorded before the private planner ran.

Add finite research targets to server-owned submission scope. A target includes profile case/version or reference/version. An explicitly continued revision is an input with its own policy. The target's CAS version alone is not source content. A new independently admitted request can address the same resource without reading an unrelated previous result. Distinguish that from an instruction to edit the displayed profile, which includes the exact displayed baseline through the server seed. No model-selected flag or source-certification checkbox can remove the baseline.

The private planner's `legalQuestion`, `allegedFacts`, `gaps`, thesis, and notes never enter the clean prompt. Agent input schemas accept identifiers, versions, and closed structural choices. For `k5_research_save_profile`, a legacy raw agent call without a recorded submission fails with an actionable error. With a valid recorded request, the capability still produces a profile through clean generation. For add/update reference, closed purpose/material/assessment operations remain available. Creating or changing nonempty notes uses the research content contract. An application constant empty note needs no model call.

The structured runtime returns the existing profile schema or a notes schema. Generation produces no evidence or per-field provenance labels that the application trusts. Every generated slot inherits all actual admitted inputs seen by that generation. A claimed `documentIds: []` cannot reduce those obligations. Human-entered independent slots can have narrower policies because the form admission, not the model, establishes them.

The profile writer validates fact/document/chunk relationships against the exact observed sources. It rejects fabricated citations and unsupported selected material before committing. State, policy bundle, revision history, CAS, and any consumed approval/result pointer commit on one transaction connection. Generation and storage reads run outside locks. An invalid output, lost lease, failed CAS, cancellation, or rollback leaves both text and policy unchanged.

Reference writes use the same policy contract for notes. The reference owner composes its returned notes exposure, exact catalog metadata exposure, and the nested assessment exposure. Changing material version does not silently erase a note's historical contributors. Updating purpose alone does not union fresh conversation sources into unchanged notes. Re-adding a deleted reference retains the exact old result as historical data and classifies the new write independently as appropriate to its actual notes input.

Shared generated profile edits use the current review/proposal facility for exact structured field changes where confirmation is required. An existing reference-link confirmation is extended with the exact generated notes and policy; it does not gain a second confirmation. Approval means approval of this payload, not certification that private planner output is human input. Model history receives opaque result IDs and fixed operation status. Full fields remain available only through current-authorized review and canonical research readers.

### Pin assessment input and authorize the saved result

When `assessResearchCaseMaterial` queues a job, capture the authorized profile revision, actually selected Vault chunk text, catalog material version and digest, actual excerpts, coverage, questions/config identity, and combined input policy together. Persist this bounded input beside the existing assessment row. Keep input-fingerprint uniqueness, budgets, modes, and attempts. A queued entry cannot silently adopt a newer profile or material version when the worker wakes.

The worker rechecks its original requester session, current case membership, source policies, Lume admission for actual cases, and its live lease before dispatch. It uses `contextForCase` to resolve current guest authority, but does not replace the original requester/session with the worker's authority. Persist the serializable original actor/session and input bindings; construct the branded admission with the current lease when loading `AssessmentInput`, rather than persisting an old live lease or permission result. Rows admitted from a sessionless internal fixture are not a production worker bypass. Persist original session identity for new user-triggered assessments. Older queued rows without trusted dispatch identity do not dispatch protected text automatically; retain them for an explicit new request.

The result policy covers all inputs to scores, distributions, coverage, and excerpts. It protects the whole generated assessment, not only excerpt strings. Atomically bind the canonical result digest and policy to `result_json` under the current lease. An after-generation check can prevent persistence; it is never described as undoing a provider disclosure.

Currentness and authorization are separate. Recompute currentness from today's input fingerprint if needed. Authorize the stored result's exact contributor policy before returning any result. A V1 result remains available when V2 exists and V1 is still authorized. Revoked installation AI permission, catalog restriction, missing protected contributors, or lost Vault access suppresses `result` and generated scores with a neutral unavailable reason. `status: 'stale'` is not permission to return bytes. Local catalog browsing can continue to use `localAllowed`; the policy governing an AI-derived assessment retains the accepted stricter AI/material guard.

All canonical getters return the envelope. Reference nesting, list projection, history, citation exposure, approval previews, and keyed replay compose that envelope rather than traversing DTO fields. A reference can still return accessible independent notes and metadata when its assessment result is withheld.

## Adapter, settings, and replay behavior

Declare content-bearing execution in the existing capability definition/registration. Those executors return `ContentResult`, including a null/redacted projection with a case-only exposure when appropriate. Explicit `exposure: 'none'` applies only to genuinely source-free structural output. Do not maintain another exemption list by capability name.

`runCapability` parses the value through the existing output schema while preserving metadata. It captures and reattaches the same metadata after a keyed result returns. The generic idempotency store persists the canonical DTO bytes/digest, complete exposure, source map, and exact result identity. Identity checking delegates to canonical typed resource readers or immutable revision records. It never resolves the latest profile policy to authorize an old DTO.

Version the replay binding format for this stronger contract. Existing format-1 research/settings bindings do not become certified merely because they contain a material or case guard. A legacy completed operation that cannot establish a domain-complete exact binding returns an unavailable-result error. It must not execute the write again. A typed compatibility reader may recover only from an immutable matching research revision/result whose digest and retained policy already match the cached payload. No recursive JSON field guessing or current-version reconstruction is allowed.

Keep unaffected valid historical exact bindings under their existing compatibility path. The producer migration removes the generic reconstruction branch for each owner in the same implementation wave. Missing exposure on a declared content-bearing keyed write is an error, not `uncertainPolicy` with empty guards. The existing unknown/pending idempotency states remain conservative. This repair does not claim to solve generic reservation recovery.

Instruction readers include disabled items in their policy-bearing list. They fetch text/version/policy on the same transaction connection. Knowledge readers include the document metadata's exact observation and each visible note's retained policy. Template getters likewise carry the selected file's policy. `getAgentSettings` composes only returned content. The enabled-prompt filter remains separate from settings visibility and never determines whether a getter's returned text needs policy.

For the demonstrated disabled instruction derived from S, the getter envelope retains S. `recordToolProvenance` transfers that policy to `context.contentSources`; `privateGenerationPolicy` preserves uncertainty plus S when creating a private artifact. Assistant-message policy and future history admission then enforce S's revocation. Uncertainty prevents sharing and does not substitute for known contributor guards.

## Managed exact files and author disclosure

`stageManagedFile` observes the selected exact version under the existing short ACL transaction. It reads the pinned storage key outside that transaction, verifies digest and size, and rechecks the exact identity/access after the storage wait. The staged binding contains two different policies.

- `authorization` includes the stored version's inherited policy, the document's intrinsic access, and observed ancestor obligations. The sender must satisfy it at preparation, dispatch, and deferred recipient reads. Exact historical version reads use the pinned row, not the active version's bytes.
- `disclosure` is the policy the recipient must satisfy. By default it includes the managed resource/ancestor obligations as well as inherited content restrictions. A reader of another person's restricted original cannot send it to an unsupported external audience. An internal recipient must satisfy its actual restrictions.

The own-original exception removes only the location obligations acquired while observing that original. It never changes `authorization`, stored source policy, origin, or inherited obligations. It requires all of the following facts established by the owner.

1. The pinned version's actual original contributor is the disclosing actor. Case ownership, office membership, current visibility, and folder administration are insufficient.
2. The stored content is independently eligible, has no owner fence, and has no inherited protected guards.
3. Its receipt/origin metadata identifies a direct original contribution, or satisfies the accepted conservative legacy-human convention with no contradictory generated/copy/export lineage. `created_by` on a copied or replacement version alone is insufficient.
4. Application-known derivation is preserved. A generated/exported/edited managed file does not regain original status because its new storage row names the copier. A source-free but derived export may be eligible under its own retained policy, but does not qualify for dropping newly acquired location guards as an original.

This generalizes `pinnedArtifactTemplate`'s authorization/disclosure split and strengthens its lineage check. The recipient of a legitimately disclosed independent own original uses `disclosure`, so it need not join the author's private case. The sender still uses `authorization`. A later sender-access revocation, share revocation, or source deletion can end application-managed recipient access under the current sharing contract.

Google operations persist `managedFiles` with reviewed file digests and exact byte identity in `__bound`. Their final guard checks the original invocation/session, connection authorization generation, current operation lease, exact file rows, sender authorization, and recipient disclosure policy. It preserves the existing `assertExternalDelivery` rule for text and unsupported external source restrictions. Gmail attachment staging cannot resolve a different active version on retry. Drive's remote-version precondition and byte checks remain in force.

Gmail draft-preserved attachments retain their managed-file manifest from the stored draft binding. Fetching those same bytes back from Google does not reset their provenance to an unclassified remote attachment. A new independently uploaded external attachment remains the accepted person-input boundary. A managed attachment with a missing or mismatched retained manifest cannot gain the exception through a draft round trip.

Personal share creation persists the binding with the pinned document version. Creation, list metadata, invitation claim, `readDocumentShare`, and email dispatch consume it. After a recipient storage read, recheck the share state and recipient identity, exact digest, sender authorization, and the recipient's disclosure policy. Do not require the recipient to satisfy the sender-only `authorization` for an own-original grant. Conversely, `recipientAllowed` alone never bypasses another author's folder restrictions.

Old shares and pending Google operations lack captured ancestor obligations. They cannot be upgraded from empty stored policies by assuming the sender was the author. A bounded read of their exact version and lineage can prove the narrow own-original case. Otherwise retain any recoverable restrictions and make that old delivery unavailable until it is freshly reviewed under the new binding. Do not delete the old operation, share, policy, or result, and do not resend an unknown outcome.

## Final provider admission and retries

The protected boundary is invocation of the actual outbound HTTP fetch or provider binding with the staged protected payload. It is not reservation, `agent.generate` entry, or result acceptance. No global ACL gate stays held while provider network work runs.

The runtime prepares immutable payloads, stages images, resolves credentials/configuration, and completes accounting reservations first. Its admission owner then evaluates original actor/session with `expiresAt > clock_timestamp()`, current membership, required case capability, source Lume admission, complete content policies, exact file identities, and any attempt/worker lease. Cancellation is checked again immediately before transport entry. The payload digest includes structured state and actual image/file digests, not just the textual prompt.

Use one per-call guarded transport closure. It captures immutable payload authority and performs the check for every transport invocation. It cannot be supplied through capability JSON. It is not a global fetch patch or a cached permit. Provider-specific serialization must finish before that closure invokes the underlying transport. The provider factory binds the actual staged wire request to the admitted application payload; the wire digest and application payload digest are different identities, not strings to compare directly. This correspondence belongs to each finite provider adapter, not a universal body parser. An asynchronous middleware that runs later requires the guard below it.

```ts
// ai-providers.ts, private pseudocode. No await follows admit before raw fetch
// except the network promise itself. All provider construction happens earlier.
async function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
	const staged = bindExactOutboundRequest(input, init, protectedPayload);
	await assertProviderAdmission(admission, staged.payloadBinding);
	staged.signal.throwIfAborted();
	return rawFetch(staged.request, { ...staged.init, redirect: 'manual' });
}
```

`assertProviderAdmission` uses the existing short ACL read transaction and trusted actor helpers. Session expiry uses database wall time after waits. Recheck all source cases, including those outside the destination case, through `assertSourcesAdmitted`. Human file sharing does not acquire an agent-only Lume requirement; generated calls and worker calls do.

Current `modelFor` gives CLIProxyAPI an explicit custom fetch. Other providers return Mastra router configurations without a per-call fetch field. An outer check around `agent.generate` therefore cannot establish this design. Protected structured calls need per-call native SDK model factories in `ai-providers.ts`, each receiving the guarded fetch. Preserve each current provider's protocol, endpoint, credentials, effort, and model ID. Cover OpenAI, Anthropic, Google, DeepSeek, Inception, OpenRouter, Vercel gateway, and CLIProxyAPI with an exhaustive `AiProvider` mapping. Derive compatible endpoint facts from the existing registry where possible. Do not redirect ordinary direct-provider traffic through a new gateway.

The installed Mastra `OpenAICompatibleConfig` exposes no fetch property. Its `MastraGateway.customFetch` sends through a gateway and changes routing, so it is not an acceptable shortcut. Factory wiring is a concrete implementation/protocol risk that the parent must verify before accepting protected calls on each provider. An unsupported protected adapter fails before sending; it cannot silently fall back to an unguarded router. Ordinary source-free connection probes retain their explicit existing path.

For the new protected structured path, set runtime retries to zero initially. If the provider SDK attempts its own retry, the custom fetch still rechecks every request. Schema recovery or an explicitly retried generation uses the same immutable attempt inputs and a fresh admission check. A new deliberate generation gets a new attempt. No retry can substitute the latest source version while retaining an earlier receipt.

TypeSafe `evaluate` checks admission after configuration and the `typesafe_platform_connection FOR UPDATE` reservation wait. `sendDecision` retains `maxRetries: 0`. Guard its actual transport, and also guard the supplied test `DecisionTransport` entry so stubs exercise the same contract. Keep protected authorization failures distinct from provider credential failures. A denied call does not trip the platform credential circuit. Each rerank batch carries its candidate policies and query policy and is admitted independently. Failure can preserve the baseline ranking only after canonical current-result authorization, so a ranking fallback cannot expose revoked candidates.

Citation review passes policies for the reviewed text as well as candidate sources. Its old closure checks only candidate policies; replace that closure with the same TypeSafe admission. Assessment retries after a recovered lease recheck the persisted input and original session. TypeSafe disabled mode sends nothing. Shadow mode is still an external dispatch and requires admission.

Google retains `withGoogleWriteGuard` and the `googleRequest` per-send hook. Extend that hook's sealed operation authority with the managed-file bindings. The hook runs after initial token acquisition and after forced refresh on a 401. A 401 may mean the operation was not accepted, but the first HTTP request already disclosed its bytes. Revocation before the second send must stop the second disclosure. Reconciliation that reads remote state does not resend local protected payloads. Explicit failed-operation retry is a new dispatch under the retained binding; unknown outcomes keep the existing reconciliation-only behavior.

Personal email admits both HTTP transport and Cloudflare `EMAIL.send` after message construction and configuration. The original sender session and outbox lease are retained on every permitted retry. The final marker update belongs to the short admission transaction. A failure before any transport call is a denied/cancelled operation. A network failure after transport invocation remains unknown under the existing reconciliation contract. Never hold the ACL gate until an HTTP response or binding completion.

This mechanism prevents a revocation, natural expiry, or Lume denial observed after staging/configuration/reservation waits from being bypassed by an earlier check. It does not establish a distributed transaction with the provider. There remains a narrow interval between the final database observation/transaction release and transport invocation. A mutation or clock expiry in that interval can win after admission. Bytes already dispatched cannot be retracted. Do not claim stronger linearizable revocation than the actual check boundary. Deterministic races must target real waits before admission, and tests must inspect actual provider requests.

## Exact research selection and annex request state

`selectedResearchContent` resolves the reference pointer once inside an ACL read transaction. It binds the selected material version, material digest, citation metadata, and returned chunks to one policy. The owner verifies every chunk's material version and text digest. It returns the source map with that same exposure. Retrieval, chat scope/turn loading, document workflows, and citation candidates consume this result.

Current selection can change on a later independent request. A running request never changes versions mid-resolution. Pinned worker and artifact references continue to resolve their saved V1 version, with current material/reference eligibility checks. Updating the reference to V2 does not cause V1 bytes to inherit V2's policy. A missing exact version or contradictory material identity fails closed. Existing current/pinned selection limits and coverage reporting remain.

In `VaultAnnexes`, use one local selection epoch plus operation ID. Reopen, analyze, and generate capture case ID, scan ID, epoch, and request ID. Analyze also captures the petition request snapshot. Generation captures the exact plan ID and generation signature/idempotency key. Completion, catch, and finally update state only if all captured identities still match the active operation.

Changing scan increments the epoch, clears plan/result/error, and aborts cancellable requests. Starting analyze supersedes the older reopen response for that scan. Generate is available only when `plan.scanDocumentId === active.scanId`; completion cannot display A's files beneath B's selector. A late completion remains a valid server result for A and does not become a source-policy mutation. A later explicit reopen of A uses current authorization. Returning A then B then A still has different epochs, so an old A callback cannot win.

Keep server semantics from the parent correction. A new analysis binds only its actual scan/petition inputs. Reopen without a plan ID uses the owned latest authorized managed plan contract. An older explicit authorized plan retains its exact immutable sources. An unrelated revoked old petition does not block new independent analysis. No lifetime scan union, selector-disabling workaround, or removal of plan reopen is proposed.

## Migration and compatibility

Additive migrations only. Never edit 0075 through 0083, including 0080a. Choose the next unused migration number after inspecting the actual directory at implementation time. This candidate does not reserve or write one.

Necessary additions are bounded to the owners.

- Profile current/revision policy bundles and their structured digests. Existing revision snapshots remain intact.
- Reference notes policy and immutable reference revisions needed to bind a keyed historical response. Do not add a universal content-history table.
- Assessment immutable input, input/result policy and digest, and original requester/session authority. Existing result JSON, status, criteria, leases, and fingerprints remain available.
- Personal-share managed-file binding. Google operation JSON already has a durable `__bound` slot; use it for the manifest. Add an explicit binding format to distinguish complete new receipts from old shallow ones.
- If required by the finite research attempt output, an additive attempt result discriminator and schema version. Existing document-text attempts retain their schema and receipt identity.

Do not mass-rewrite legacy content policies to eligible. For existing research fields with no policy, recover known document/material guards and provenance evidence from exact stored revisions where possible. Neither `reviewed_by`, `updated_by`, a case role, nor absence of an agent log proves independent human authorship.

A legacy field with a verifiable authenticated submission/receipt can use that exact policy. Otherwise its text remains uncertain and ineligible for a new automated shared derivative. Where private agent origin is known or cannot be safely separated from unclassified freeform profile/notes text, restrict that text to its recorded author/requester plus recoverable source obligations. Keep neutral case/reference metadata and legitimately visible documented evidence available separately. If there is no reliable author identity, withhold the unclassified text rather than assign a new author. This may narrow access to old unclassified profile fields; it is a justified privacy repair, not deletion or retroactive certification.

The original human author can keep editing visible legacy fields with inherited uncertainty and restrictions. A person can create an independently admitted replacement from a new authenticated request and selected accessible sources without feeding the uncertain prior text. An existing full-form PUT seeded from legacy content is a continued edit and cannot clean that baseline merely by changing every string. Record this distinction in the domain seed/submission, not a browser checkbox.

For old assessment results, exact input/result binding recovery requires more than current chunk IDs. Verify historical revision/material identity and content digests. If this cannot be established, preserve the stored row but withhold the generated result. A newly requested independent assessment can use the current admitted profile/material. A recoverable authorized stale historical result remains readable. Empty policies or present stale status never confer authority.

Existing accepted page/artifact compatibility rules remain unchanged. This research-specific read behavior does not quarantine all old pages, change original-artifact ownership, delete approvals, or apply a production migration from the candidate task.

## Coverage of the nine finding groups

The following are proposed closures. None is implemented or verified by this artifact.

1. A1 is closed by complete nested assessment exposure at `referenceView`, preservation through `mapContentResult` and both output parses, and exact envelope replay. The parent has a real negative proof of the old replay path.
2. A2 is closed by the research content writer and authenticated structured generation for profile fields and reference notes. The raw planner input never becomes person input. The parent has a real negative proof for profile laundering; neighboring notes remain a static obligation until exercised.
3. A3 is closed by authorizing the retained assessment result policy independently of stale status. Authorized old versions remain available. The parent has a real negative proof for revoked catalog text.
4. A4/C2 is closed by transport admission after images, credentials, and reservations. The parent has a real negative proof showing actual shared generation sent text after source revocation during storage, then rejected the result.
5. B1/C1 is closed by dual managed-file policy and a proved pinned-version original-author exception throughout Gmail, Drive, template rendering, personal shares, claims, and deferred reads. It remains a static finding pending real dispatch and recipient-read reproduction.
6. B2 is closed by policy-bearing settings results, including disabled instructions, and consumption by private derivation/history. It remains static pending a production tool-to-artifact regression.
7. B3 is closed by required TypeSafe admission on every rerank batch after its platform-row reservation wait. It remains static pending the held-platform-row reproduction.
8. B4 is closed by the annex selection epoch and active operation identity. It remains static pending the actual browser race.
9. C3 is closed by one immutable research selection result pairing bytes and policy. It remains a static historical binding defect pending version-switch reproduction. This design does not re-label it as a proven cross-material permission bypass.

## Rationale

### Problem

Lume already has a useful retained policy model. Its remaining failures occur when structured domain output, copied file bytes, or deferred provider work crosses a boundary without complete authority. Research freeform fields cannot use private planner text as shared input. A reader cannot inherit another author's disclosure authority. The repair must preserve human profile edits, exact authorized history, independent requests, existing approvals, and schema compatibility without adding a larger content platform.

### Usage (caller's view)

The opening examples are the usage specification. Research calls one domain write operation and returns classified projections. Workers consume exact saved input. Connector preparation stages one classified managed file. Each caller leaves policy composition, generation authority, and dispatch timing to the owner that knows those facts.

### Shape

Select domain-owned structured research content, complete result envelopes, dual managed-file policy, and final transport admission. Per [Model the Domain](C:/Users/douglas.araujo/.agents/skills/principle-model-the-domain/SKILL.md), the profile uses fixed slots and exact entry identities rather than scattered field-name tests. Per [Boundary Discipline](C:/Users/douglas.araujo/.agents/skills/principle-boundary-discipline/SKILL.md), authenticated ingress and domain storage readers validate authority before typed consumers run. Per [Type System Discipline](C:/Users/douglas.araujo/.agents/skills/principle-type-system-discipline/SKILL.md), content executors require branded results and protected calls require admission descriptions. Per [Laziness Protocol](C:/Users/douglas.araujo/.agents/skills/principle-laziness-protocol/SKILL.md), existing owners retain persistence and transport mechanisms while public callers avoid multi-stage coordination. The larger complexity remains inside these owners.

### Synthesis decision

Candidate-local selection is approach A below. No other candidate was read and no cross-candidate synthesis is claimed. The parent should compare this package with the other independent candidates. Carry forward the existing template's dual policy distinction and Google's per-send retry guard. Reject generic research DTO reconstruction and any design that releases retained file access merely because stored contribution policy is empty.

### Tradeoffs accepted

- We accept research-specific field policy storage in exchange for preserving independently visible human fields and documented-fact filtering.
- We accept conservative classification of untraceable old profile/notes text in exchange for avoiding retroactive certification of private generated text.
- We accept provider adapter work for protected calls in exchange for checking the real transport boundary on every request.
- We accept a final admission race interval after the database observation in exchange for keeping global ACL locks out of slow network work. This is an explicit limit, not a claim of atomic external disclosure.
- We accept bounded complete-envelope denial on revoked cached results in exchange for keeping the exact original keyed result and avoiding duplicate writes.

### Alternatives considered

Approach A gives the research domain structured generation and policy projection. The shared submission resolver and protected runtime remain reusable mechanisms. Research owns its schema, field visibility, revisions, assessment joins, and writes. Its public caller sees one finite operation and a complete result. This is selected because these are already research-owned facts, and its field policies preserve product behavior without teaching document code the profile model.

Approach B is a viable unified structured shared writer. Extend `documents/shared-writing` and the shared document service into a finite sum of text documents, profiles, and reference notes. Give each variant a schema, target resolver, field-policy projector, revision loader, and commit handler. The shared writer owns proposal generation and commit. Research exposes structural reads through that writer. Proper handlers can preserve authenticated input, per-field visibility, CAS, and assessment contributor binding, so this is not rejected as inherently unsafe.

Its losing interface would resemble the following.

```ts
type SharedWriteTarget = PageTarget | OutboundTarget | ProfileTarget | ReferenceNotesTarget;
type StructuredWriteHandler<T, P> = {
	resolveTarget(context: WorkspaceContext, target: SharedWriteTarget): Promise<TargetState>;
	inputSchema: z.ZodType<T>;
	bindPolicies(input: AdmittedInputs, previous: P | null, output: T): P;
	project(context: WorkspaceContext, version: StructuredVersion<T, P>): Promise<ContentResult<T>>;
	commit(tx: Transaction, target: TargetState, output: T, policy: P): Promise<ResultIdentity>;
};
declare function writeSharedResource(
	context: WorkspaceContext, target: SharedWriteTarget, request: SharedWriteRequest,
): Promise<ContentResult<SharedResource>>;
```

This hides common reservation and generation machinery, but exposes domain representation and commit behavior through five handler responsibilities. A profile field change now requires coordinated knowledge of its schema, policy projector, shared writer target union, commit adapter, and research read path. Treating profile JSON as a title/content body would be a shallow variant that fails visibility requirements. Making the real unified writer viable enlarges the chosen repair more than reusing the input/runtime mechanisms directly in the existing research owners.

A row-wide research policy is a separate smaller contender. It can stop the leaks and simplify storage. It loses because a restricted fact would hide independent profile fields and reference notes, contradicting current field/document visibility. A generic recursive JSON policy collector also loses. It cannot know which text came from the planner, which omitted fields still contributed to generation, or which historical versions the bytes describe.

### Open questions and risks

- Can every configured provider's protected SDK factory preserve its current protocol and expose a per-call fetch below all waits and retries? The current router object cannot prove this, and a gateway substitution would change behavior.
- Which exact legacy research revisions have an authenticated submission receipt that proves human origin? Without that evidence, the conservative read behavior above applies and some old unclassified fields become author-only or unavailable.
- Can the existing reference/profile forms preserve server entry identities through reorder and omitted restricted fields without accidentally submitting deletions? The seed contract and actual UI save paths need proof.
- Do all personal-share metadata and claim paths consume the dual binding, including deferred email and both transport entries? A partial migration would leave the same file authority bug reachable through another adapter.
- Can the implementation keep transaction-bound research readers on the supplied connection and establish existing ACL/session lock ordering? Current `referenceView` calls the assessment reader without passing its transaction.
- Do crash recovery and approval consumption retain the exact research result without enabling duplicate writes? Generic pending/unknown reservation recovery remains an acknowledged separate limitation.

### Next implementation step

Implement the complete research result envelope and persisted assessment contributor policy first, migrate reference nesting and replay through it, and exercise the unchanged parent A1/A3 negative proofs before adding clean profile/notes generation.

## Remaining proof obligations

I read the parent [research negative test](lume-source-round3-repro.test.ts) and [image-dispatch negative test](lume-source-image-dispatch-repro.test.ts). I did not run them. The parent verdict records four negative proofs. The copied citation sanity test is not a fifth security scenario. Passing prior suites do not prove this proposed repair.

The eventual writer and parent should demonstrate these behaviors through canonical entry points.

1. Re-run the four unchanged negative proofs with production owners. The keyed nested reference exposes no revoked excerpt, another participant receives no planner profile sentinel, revoked catalog text is withheld, and revocation during image storage prevents any protected provider request.
2. Add positive human profile and note edits, per-field/document visibility, guest projections, same-case agent generation from authenticated intent, and exact continued edits. Inspect the actual provider request for planner/memory sentinels. Verify that a failed CAS or generation does not alter policy.
3. Prove stale V1 remains readable after an authorized V2 update, then becomes unreadable after exact source revocation. Exercise ordinary getters, nested references, keyed replay, review, assistant history, and citation exposure. Unknown legacy content must not become eligible through migration or a whole-form edit.
4. Reproduce the restricted original belonging to associate B with A as a permitted reader. Gmail and Drive must make zero protected transport calls, and an unauthorized personal-share recipient must receive no bytes or revealing metadata. B's eligible own original must still work for a recipient with no access to B's private case. A copied/exported/edited version must not acquire B's exception.
5. Hold object-storage, OAuth refresh, reservation, or worker waits independently. Revoke the original session, allow natural expiry, remove source access, or deny Lume before release. Inspect final HTTP and binding entries, every rerank batch, Google's 401 second send, TypeSafe shadow mode, research lease retry, and explicit generation retry. Post-result denial alone fails this proof.
6. Reproduce disabled instruction S through the settings getter into a real private artifact and assistant history. Revoking S must suppress later derived reads while preserving private ownership and known guards.
7. Hold the real TypeSafe platform row while the production reranker waits, revoke access on another connection, then release. No candidate text reaches the provider. This proves the actual final boundary, not a mocked precheck.
8. Switch the reference from V1 to V2 between the old observation/selection points. Assert the new path pairs text, material/chunk version, digest, source map, and policy from one version in retrieval and citations.
9. In the actual annex browser flow, delay analyze A, select B, then resolve A. Neither A's plan, result, error, nor busy completion may overwrite B. Also prove same-scan reopen versus analyze, A/B/A epochs, exact generation retry, old authorized plan reopen, and independent fresh analysis after unrelated old-source revocation. Verify desktop, mobile, keyboard, loading, empty, and error behavior against `DESIGN.md`.
10. Validate additive migration/read compatibility, original checksums, exact approval replay, rollback, and transaction connection use. Parent then runs the required root checks/build and affected e2e selection. Existing session429/network, intermittent navigation, and generic reservation recovery observations remain open unless separately resolved with evidence.

Throughput checkpoint is n/a for this read-only investigation. No child, test, database query, browser action, git command, commit, deployment, or production/test edit was performed. Only this assigned design artifact was written. The shape was screened against the architect red flags. Domain facts have one owner, policy-preserving transformations replace spread-and-reconstruct patterns, no public stage choreography is required, and no universal framework or unit3 work is introduced.
