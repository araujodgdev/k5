# Candidate 1: generation from a submitted request, policy on immutable versions

## Usage (caller's view)

A person stays in the existing conversation, with their private memory and personalization. They select a page and ask, “Resuma os pedidos em três parágrafos, usando os documentos selecionados.” Lume returns an exact proposed page revision in the existing confirmation UI. The shared drafting call receives that submitted instruction, the authorized page version, selected sources and eligible writing preferences. It receives no instruction, summary, title or replacement text composed by the private conversational model.

The consumer has three operations, illustrated below. Names describe the proposed production interface; these are not executable examples of today's implementation. `context` always comes from `requireWorkspace()` and the existing capability scoping, never a browser-supplied office or actor flag.

```ts
import { proposeCasePage } from '@/lib/content-generation';
import { writeContent, confirmContentChange, deliverContent } from '@/lib/content';

// Existing chat tool: its public input is empty. The server supplies the current send.
// A private model can request a proposal; it cannot supply the proposal's instructions.
const proposal = await proposeCasePage(context, submittedRequestId);
// -> { approvalId, reviewUrl, status: 'pending' } — no title/content in tool history.

// Existing editor: the authenticated HTTP adapter records a person-edit submission.
// An application-seeded draft carries its existing origin; typing does not erase it.
const saved = await writeContent(context, {
  kind: 'person-edit', submissionId, target: pageRef, expectedVersion: 12,
});
// -> committed version 13; no new approval step for ordinary human editing.
const confirmed = await confirmContentChange(context, approvalId);
// -> stable { ref, version, outcome }; repeat confirmation returns the same outcome.

// Existing “Salvar no Cofre”: the service captures the actual default/selected template.
const archive = await deliverContent(context, {
  kind: 'vault-copy', source: { kind: 'artifact', id, version: 7 },
  destination: { kind: 'own-library' }, format: 'docx', requestId,
});
// -> private Vault version with the source/template policy retained, including quarantine.
```

“Continue como combinamos” is not permission to replay an untraceable assistant summary into shared drafting. If the submitted request lacks enough intent, Lume asks for a concrete instruction in the same conversation and offers the existing source picker. A direct instruction such as the first example works without a new conversation, memory deletion, or an extra preliminary confirmation.

## Problem

The accepted private-artifact/shared-page split and exact publication review are sound. The source mechanism is not: `complete` describes an entire mutable conversation rather than the bytes that made a version; successful-tool hooks miss previews and other inputs; and live page recursion substitutes today's derivation graph for the version actually observed. The repaired boundary must support normal personalized work, preserve current source access through copies, and commit provenance with content. This candidate covers source admission, generation and managed content exits. It deliberately excludes the concurrent editor draft/restore/revocation repair, tasks, finance and shell redesign.

## Shape

**Recommendation:** retain the private conversation as the conversational interface, but give shared drafting a server-constructed input packet derived from an authenticated submission. Every generated or copied version owns an immutable source manifest. That manifest contains observed source versions/digests and a flattened set of live authorization obligations. Reading a derived page does not recursively read other pages' current provenance.

There are two deep boundaries:

1. `content-generation.ts` owns which bytes enter a model call and binds its output to an input receipt. It hides loader classification, history selection, memory handling, the final provider check and propagation through intermediate model outputs.
2. `content/index.ts` owns authorization of content versions, mutations, exact review and managed delivery. It hides canonical legacy classification, obligation evaluation, CAS, approval recovery, rendering/template policy and destination restrictions. Existing domain services adapt their domain inputs to this boundary; they do not independently decide whether provenance permits sharing.

Callers provide a request/version/destination, not `complete`, a claimed source list, a fabricated receipt, a policy override or an authorization callback. Human and agent page writes end in the same transaction owner. Private artifacts retain `(homeOfficeId, userId)` ownership; no dependency grants access to them. This is boundary-discipline and interface depth, not a second agent runtime.

The full implementable contract follows the rationale, including types, database transaction pseudocode and exit coverage.

## Synthesis decision

Reserved for the parent. Candidate recommendation: select the submitted-request generation boundary and immutable flattened policy described here. I have not read another candidate or a grading rubric. The alternative below is independently viable but has a substantially wider migration burden and worse behavior for existing opaque memory.

## Tradeoffs accepted

- We accept an additional bounded drafting invocation in exchange for a usable shared workflow even when the private conversation contains untraceable memory. The existing Mastra/AI SDK provider selection, billing, cancellation and trace mechanisms are reused.
- We accept that learned preferences with no recoverable origin influence private conversation but do not automatically influence shared text. Direct, attributable preferences still apply. Nothing is deleted; the user can submit a new explicit preference in the normal composer/settings UI.
- We accept conservative retention of obligations across ordinary edits and restores in exchange for not guessing which sentence “removed” a source. Fresh regeneration from eligible inputs creates a new versioned resource rather than cleansing an unknown draft by attestation.
- We accept bounded, deduplicated policy storage per version in exchange for finite authorization work and no mutable dependency-graph invariant.
- We accept a shared/exclusive authorization gate per affected office around short database operations in exchange for a defined ordering with concurrent ACL changes. Network calls and rendering never run under those locks.
- We accept conservative blocking of unprovable legacy sharing, and some legacy history omitted from model replay, in exchange for not promoting 0075's defective `complete=true` into proof. Private data and approval records are preserved.
- We accept that external delivery of content with nondelegable live ACL obligations is unavailable when that channel cannot enforce them. A confirmation, including a connector confirmation, is not a release of another person's sources.

## Alternatives considered

### Alternative A: origin-aware conversation execution, without a separate drafting invocation

The whole private runtime would accept only labeled inputs. Loaders establish provenance at each ingestion point; the final conversational model output inherits every admitted input. Shared tools accept that output receipt directly. Per-entry memory, assistant messages, tool results and summaries all become derivations with their own current-access checks.

```ts
type ConversationInput =
  | { kind: 'person'; contributionId: string }
  | { kind: 'resource'; observationId: string }
  | { kind: 'derived'; receiptId: string }
  | { kind: 'opaque-private'; ownerId: string; knownObligationIds: string[] };

const turn = await conversationExecution.run(context, {
  submissionId, historyIds, instructionIds, memoryEntryIds,
});
await writeContent(context, {
  kind: 'generated-change', generationId: turn.generationId, target, expectedVersion,
});
// writeContent can offer shared review only if the actual output's receipt is share-eligible.
```

Its control flow is loader → labeled conversation → one model invocation → labeled output → exact review → atomic version commit. Each tool result updates the current invocation receipt before the next provider call. Working-memory entries record the receipt of the model that wrote them; recall can omit inaccessible entries and their derived assistant messages. All copies and deliveries use the same immutable-version policy as the recommendation.

This is structurally different: trust is established for the complete conversational execution before its ordinary output is used for publication. There is no reconstructed submitted-request packet and no isolated shared drafting call. Interface depth is high for a caller that already has `turn.generationId`; the execution layer must hide the entire prompt/memory/history dependency system.

It loses here because existing memory and old assistant messages cannot be recovered into attributable entries. Keeping them in the one model call makes its output private-only; excluding all of them changes the normal private conversation. A practical implementation would need a separately reconstructed eligible conversational branch and regenerate there, which reintroduces the chosen boundary with more persistent state. Prompt instructions telling the model to “ignore” opaque inputs do not repair this. The new per-entry memory system would also exceed this bounded repair. This alternative is not rejected because its labels are harder to implement; its useful output and its private personalization compete for the same model context.

### Alternative B: submitted-request generation with independent private chat — selected

```ts
// Private conversation remains fully useful, including opaque-private personalization.
await runPrivateChat(context, submittedRequestId);
// The planner has no text-bearing handoff and cannot select additional source handles.
await proposeCasePage(context, submittedRequestId);
// Internally: immutable submission -> authorized input packet -> model -> stored proposal.
```

The source-policy boundary establishes trusted provenance when constructing the actual drafting packet, not by certifying the private planner's output. Publication obtains its policy from that generation's receipt or from an exact existing version. The model can discover additional resources only inside the bounded drafting execution, through registry-owned source adapters subject to the same case/guest policy. This keeps the public interface small while excluding an entire class of model-produced handoff laundering.

## Open questions and risks

- Which existing instruction or human-draft versions have durable, payload-bound person-origin evidence beyond `updated_by` and absence of agent flags? The traced files do not establish that. The implementation must leave ambiguous versions quarantined; it must not ask a user to certify missing lineage.
- Does every configured provider adapter expose the fully assembled application prompt, including tool/file inputs, at an interceptable request boundary? The provider-boundary regression below must answer this for enabled adapters. An unsupported adapter cannot issue share-eligible generation receipts until covered.
- Can the external research source lifecycle guarantee a retained immutable version after material replacement/deletion? If not, store the admitted material and digest privately and keep the live source handle as an obligation; inability to authorize it later denies derived access.

These are evidence gaps with fail-safe implementation choices, not requests for permission or a new architecture round.

## Next implementation step

Implement additive 0076 storage plus the canonical version classifier and one full submitted-request → recorded provider input → exact page proposal → atomic confirmation slice, before changing the remaining callers to use it.

## Implementation contract

### Core data and public functions

The following sketch is intentionally not implemented. Internal brand constructors and database writers are not exported. Runtime database ownership/digest checks remain necessary; TypeScript brands alone are not authorization.

```ts
type VersionRef =
  | { kind: 'artifact'; id: string; version: number }
  | { kind: 'case-page'; caseId: string; id: string; version: number }
  | { kind: 'vault'; id: string; version: number };

type ContentRef = Omit<Extract<VersionRef, {kind: 'artifact'}>, 'version'>
  | Omit<Extract<VersionRef, {kind: 'case-page'}>, 'version'>;

// This is application-visible contribution, not a claim of copyright/authorship.
type Contribution = {
  id: string; actorId: string; homeOfficeId: string;
  origin: 'typed-message' | 'person-edit' | 'upload' | 'person-setting';
  payloadDigest: string; immutablePayloadRef: string;
  submittedAt: string; destination: ContentRef | DocumentDestination | null;
  // A document editor/import can be seeded by the application. That lineage survives edits.
  inheritedManifestId: string | null;
};

type SubmittedRequest = {
  id: string; conversationId: string; messageId: string; revision: number;
  instructionContributionId: string;
  scope: StoredMessageScope; // Existing domain scope, authorized by the server.
  selected: readonly SourceSelection[];
  attachmentContributionIds: readonly string[];
  explicitPriorContributionIds: readonly string[];
  // No summary from the planner, quoted assistant answer or preassembled system prompt.
};

type SourceSelection = {
  ref: VersionRef;
  selection?: { start: number; end: number; digest: string };
};

type LiveGuard =
  | { kind: 'case-access'; caseId: string; officeId: string }
  | { kind: 'folder-access'; folderId: string; caseId: string; officeId: string }
  | { kind: 'resource-access'; resourceKind: 'page' | 'vault' | 'research';
      id: string; officeId: string }
  | { kind: 'private-source'; ownerId: string; homeOfficeId: string;
      resourceKind: 'connector' | 'attachment' | 'setting'; id: string };

type Observation = {
  id: string;
  source: VersionRef
    | { kind: 'case' | 'folder' | 'instruction' | 'memory' | 'research';
        id: string; revision: string }
    | { kind: 'external'; provider: string; id: string; revision: string };
  contentDigest: string;
  // Captured source-version lineage, never “whatever this page depends on now”.
  inheritedManifestId: string | null;
  observedPolicyDigest: string;
  admittedParts: readonly { digest: string; role: 'data' | 'label' | 'file' }[];
};

type Manifest = {
  id: string; format: 2;
  classification:
    | { kind: 'attributed' }
    | { kind: 'private-unresolved'; ownerId: string;
        reason: 'legacy' | 'opaque-memory' | 'unclassified-input' };
  // Canonical sorted unique set, expanded before sealing. No live derivation recursion.
  guards: readonly LiveGuard[];
  observations: readonly string[];
  contributions: readonly string[];
};

type GenerationReceipt = {
  id: string; ownerId: string; homeOfficeId: string;
  submittedRequestId: string | null; workflowRunId: string | null;
  manifestId: string;
  providerCalls: readonly { ordinal: number; applicationInputDigest: string;
    inputObjectRef: string; outputDigest: string }[];
  output:
    | { kind: 'document'; title: string; content: string; digest: string }
    | { kind: 'tool-call'; callId: string; payloadRef: string; digest: string };
  state: 'complete'; // Complete provider step/value, not necessarily the whole chat turn.
};

type ContentChange =
  | { kind: 'person-edit'; submissionId: string; target: ContentRef;
      expectedVersion: number }
  | { kind: 'person-create'; submissionId: string; destination: DocumentDestination }
  | { kind: 'generated-change'; generationId: string; target: ContentRef | DocumentDestination;
      expectedVersion?: number }
  | { kind: 'publish-artifact'; source: Extract<VersionRef, {kind: 'artifact'}>;
      destination: CaseDestination; requestId: string }
  | { kind: 'restore'; target: ContentRef; expectedVersion: number;
      restoreVersion: number; requestId: string };

type CaseDestination = { kind: 'case'; caseId: string; folderId: string | null };
type DocumentDestination = CaseDestination
  | { kind: 'private-artifact'; artifactKind: 'draft' | 'chronology' | 'document' };
type ReviewRef = { approvalId: string; reviewUrl: string; status: 'pending' };
type CommitResult = { ref: ContentRef; version: number; outcome: 'committed' };

type DeliverySource =
  | { kind: 'version'; ref: VersionRef }
  | { kind: 'person-submission'; submissionId: string }
  | { kind: 'generated-payload'; generationId: string };
type ContentDelivery =
  | { kind: 'vault-copy'; source: VersionRef;
      destination: { kind: 'own-library' } | CaseDestination;
      format: 'pdf' | 'docx'; requestId: string }
  | { kind: 'message-share'; source: Extract<VersionRef, {kind: 'vault'}>;
      threadId: string; requestId: string }
  | { kind: 'portal-publication'; source: VersionRef;
      clientId: string; requestId: string }
  | { kind: 'connector-dispatch'; operationId: string;
      body: DeliverySource; attachments: readonly VersionRef[] }
  | { kind: 'download'; source: VersionRef; format: 'original' | 'pdf' | 'docx' };

async function proposeCasePage(ctx: WorkspaceContext, submittedRequestId: string): Promise<ReviewRef>;
async function readContent(ctx: WorkspaceContext, ref: VersionRef): Promise<AuthorizedContent>;
async function writeContent(ctx: WorkspaceContext, change: ContentChange): Promise<ReviewRef | CommitResult>;
async function reviewContentChange(ctx: WorkspaceContext, approvalId: string): Promise<ExactReview>;
async function confirmContentChange(ctx: WorkspaceContext, approvalId: string): Promise<CommitResult>;
async function deliverContent(ctx: WorkspaceContext, delivery: ContentDelivery): Promise<DeliveryResult>;
```

`ContentDelivery` is a discriminated domain command for a Vault copy, pinned message share, portal artifact publication, connector attachment/body, or authenticated download. Each contains a version or stored submission/generation identity, exact destination and idempotency key. It never contains `policy`, `isHuman`, a caller-assembled rendered file or a generic callback. Existing Google/WhatsApp operation state machines retain their transport, confirmations and unknown-result reconciliation; the content boundary prepares and authorizes their exact immutable payload and updates the existing operation row in the same database transaction. It does not replace connector business logic.

`readContent` and list/search projections use the same internal access evaluator. Server loaders may return `AuthorizedContent` to the generation module, but only that module can turn it into an admitted model part. HTTP serialization strips internal handles. Normal exports and citations do not get an alternate “raw” reader.

### Trusted submission and source admission

`workspace.ask` sends only the person's typed instruction plus a `DocumentRef`, expected version and selection range/digest. The title/excerpt displayed in the composer are display state, not text appended to the user message. The server resolves the source version and extracts the range itself. Unsaved editor selections need an authenticated person-edit submission bound to the base version and inherited manifest, or a save first; arbitrary client excerpt text is never source-free context. This specifies ask semantics only; draft preservation remains the other writer's responsibility.

The chat route persists a `SubmittedRequest` with the frozen per-send scope. It accepts new direct text only on the authenticated person submission endpoint. Agent/WebMCP calls cannot mint `Contribution`s. App-generated prefills, source chips, quoted assistant responses and imported/generated settings retain their source/generation handle even when visually placed in a user bubble. A settings editor saving an application-seeded rule also retains that seed's lineage. A person clicking “Confirmar” on agent-generated text is not a new direct-text event.

The application can prove which authenticated person submitted which exact bytes through its controls. It cannot prove that typed/pasted text was independently authored, or recognize every file that was downloaded and later re-uploaded. New original uploads are explicit contributions with file/extraction digests; known in-app copy/import paths preserve lineage, and recognized app export identities/digests do not get relabeled as new uploads. This is an explicit product boundary, not an injection detector or a claim to solve offline copying.

The private planner's page-writing capability becomes `request-page-proposal` with no text/title/query/source-list fields. The server binds its current `submittedRequestId`, destination and selections. Arbitrary destination changes from the planner are rejected; the person must have supplied/selected the destination, or the bounded model can resolve a directly named destination using scoped discovery. Destination labels are then admitted sources. No choice of planner-supplied strings or planner-chosen source handles influences shared output. Ambiguous destination resolution returns a source-picker/clarification response.

The bounded generation packet includes:

- The immutable direct instruction, explicitly selected prior direct contributions, and submitted uploads. Ambiguous references to excluded assistant prose cause clarification. It does not automatically replay all past human messages: those can belong to other cases or contain app-inserted legacy content.
- The exact target page's title/body/version and inherited manifest, plus server-resolved selections. A target is not a free-text model handoff.
- Enabled personal/office writing rules whose exact version has attributable lineage and disclosure authority for this use. Person-authored personal style rules can be contributed by their author through the existing setting/selection intent. Office rules remain subject to office access; guest-case generation cannot silently import another office's settings. Opaque generated/legacy rules remain active in private chat but are excluded from shared drafting.
- Configured knowledge from `knowledgePrompt` refactored to return source records, including search-only titles and usage notes. Each admitted title/note/body is covered, with protected knowledge represented by its actual Vault version and upstream manifest. A knowledge “usage note” written by a model requires its own receipt.
- Versioned public research/web material from this bounded call and authorized scoped resource tool outputs, as described below.
- Fixed application instructions, schema/tool descriptions and deterministic clock/locale values. These are deployment-owned inputs; user/model-generated “configuration” text is never placed in this category.

Unknown working/learned memory is **absent from shared generation**, not renamed a style instruction. No model extracts “safe preferences” from it for the packet. Existing directly authored style preferences are usable if their source event is known; a new explicit “use frases curtas” contribution is also usable. This avoids both deleting personalization and pretending old memory is clean.

Shared drafting uses the current runtime/provider factory with automatic Mastra working-memory injection, semantic recall, transcript replay and private write tools absent **for that invocation**. Its output is a candidate, never a committed page. The private conversation remains mounted and keeps its memory. The proposal's final text reaches the person through a current-authorized review endpoint, not a private-model instruction/result.

### Actual input coverage, including private chat

The admission boundary sits immediately before each provider invocation, after runtime processors have assembled the application prompt. Each text/file part must match an admitted atom or an explicitly recorded deterministic formatting/schema transformation. A final digest covers the ordered role/part structure, labels, files and tool inputs/results; file receipts hash actual bytes, not just URLs. Unaccounted additions reject shared generation. Provider-managed persistent threads or retained remote conversation IDs are disabled for this invocation; stateless caching of the same admitted input is acceptable. Hidden vendor training/system behavior is outside the application's provenance claim.

All model calls in a generation are included, not only the last call. Model-produced search queries, intermediate outlines and tool arguments inherit the complete admitted manifest of the call that produced them. A later generation stage cannot strip obligations by selecting only its final paragraph. Model provider options that contain tenant/generated text are inputs too.

A receipt seals one completed provider step and its produced value. When a private model emits an artifact-edit or send tool call, its complete arguments are bound to a tool-call receipt **before** the executor can mutate content or prepare delivery. Tool-call arguments delivered incrementally are buffered until that value is complete. The executor's result then becomes a newly observed input for the next provider step. Do not wait until the entire conversational turn finishes to assign lineage to a tool that already wrote, and do not retroactively merge later tools into an earlier version. The final bounded page proposal uses the completed document-output receipt, with prior-step manifests included. A process crash leaves an incomplete generation record unusable, without half-committed content.

There is one required execution descriptor colocated with each entry of the existing server executor registry:

```ts
type ModelResultSpec<N extends CapabilityName> =
  | { kind: 'source'; observe: SourceObserver<N> }
  | { kind: 'constant'; project: ConstantResultProjector<N> }
  | { kind: 'private'; observe: PrivateResultObserver<N> };

type ExecutorEntry<N extends CapabilityName> = {
  execute: (ctx: WorkspaceContext, input: CapabilityInput<N>) => Promise<CapabilityOutput<N>>;
  modelResult: ModelResultSpec<N>;
};
// One mapped registry, checked with satisfies; no independent tool-name allowlist.
type ExecutorRegistry = { [N in CapabilityName]: ExecutorEntry<N> };
```

The contract registry still defines surfaces/effects/guest permissions. Derive shared drafting tools from published read capabilities with a usable source/constant adapter and the existing access policy; neither `kind: source` nor being published grants access. Existing `sharedCaseCapabilities` remains an authorization constraint. No general private artifact, agenda or CRM capability is granted to guests. The source observer must use authoritative versioned loader results; parsing IDs out of an arbitrary string is not evidence. `constant` can project only application enums/status/identifiers validated independently of model/resource text; arbitrary DTO `description`, error messages and titles cannot qualify. Unsupported results remain usable as opaque private context, but are unavailable in shared drafting. This makes a new capability incomplete at compile time until its model boundary is chosen.

The injection guard consumes these source tags instead of maintaining a separate `GUARDED_TOOLS` name list. It can withhold source data for behavioral safety, but cannot authorize content or remove obligations of any bytes already admitted. Refusals/errors expose fixed codes and neutral text to the model. An error containing a source title, selection, remote response or model-supplied string must be observed as data or omitted. No thrown executor result bypasses admission.

Coverage decisions by origin:

- **History:** new assistant/tool parts have generation receipts; direct contributions have submission IDs. Reauthorize known guards before replay. Exclude an inaccessible derived message as a whole, including its summary/title, rather than trying to redact inferred spans. Exclude unlabeled old assistant/tool summaries from new provider replay; preserve stored transcript data. Old role=user text is not blanket-certified, especially legacy `ask` bubbles. Fresh direct submissions continue to work.
- **Approval UI:** persist private exact proposal bytes in the content proposal, not in `data-approval.summary`. Chat history receives only approval ID, operation enum and pending/confirmed/cancelled/failed status with neutral messages. UI preview fetches exact bytes through `reviewContentChange` with current source/destination access, even after rejection or failure. Legacy full summaries remain in storage but are suppressed in all new model projections and chat preview hydration. An explicit “discuss this proposal” action loads it as a normal observed source.
- **Focus/labels/search:** names, folder paths, case names, document statuses and snippets are source data, including metadata-only results. Every displayed-to-model source contributes its guards; discovery does not permanently poison a conversation. Search returns only authorized hits/counts and must not leak forbidden titles through errors.
- **Attachments/audio:** bind original bytes and extraction/transcription output to the actual submission. Transcription is a derived transform of the direct audio contribution; transcription-service prompts also pass admission. DOCX embedded images and omission notices stay with the same source. Selecting a Vault file uses Vault policy, not the “upload” contribution category.
- **Memory:** private working-memory reads are explicit admitted `private-unresolved` inputs with all known legacy guards; new memory updates inherit the full current generation manifest. The Mastra store callback must return/admit the actual value used, not merely inspect a truncated copy. Keep the private memory tool and equivalent memory behavior, but route both read injection and update persistence through the same labeled adapter. Whole-memory lineage is sufficient for this repair; no per-fact memory project is required. If a known source is revoked, omit the entire affected memory value for that turn. Learned/Honcho context remains private-unresolved unless a complete derivation receipt exists; new queued memory derivatives retain known guards. It never enters shared drafting.
- **Web/research/connectors:** public web content is an observation with URL/fetch digest and public-source status established by the server fetch path, not a model assertion. Research references keep material/version identities and any case/folder restrictions. Direct Gmail/Drive results retain account/item/revision and are private-unresolved or private-source restricted where recipient ACL completeness is unavailable; they are excluded from shared drafting until an authorized, policy-preserving import/source adapter can establish the applicable obligations. An import does not remove those guards. Private chat may still use them. Web search queries based on protected sources are themselves external deliveries; only eligible public/direct-contribution queries may be sent, or the operation is withheld. A list of permitted URLs is not proof of source completeness.
- **Generated settings/templates:** carry generation lineage; explicit approval does not turn them into person-authored settings. Export templates are pinned separately at rendering, even if generation never read them. No default-template loophole.

The private chat is allowed to use unresolved person-owned memory under its existing private ownership boundary. This is explicitly **not** proof that unknown historical protected sources remain authorized. Known guards are always checked; unknown ancestry cannot be reconstructed. Consequently that output remains private-unresolved for every managed sharing exit. This limitation is unavoidable while preserving historical personalization; it must never be disguised as complete provenance.

### Immutable policy and finite current-access evaluation

An observed source has two different obligations:

1. **Current resource access:** does this viewer still have the source's intrinsic case/folder/resource ACL? Check current membership, deletion, present location and protected ancestors through existing authorization. A creator has no bypass. Do not recurse into the source page's latest content manifest to answer this question.
2. **Historical content obligations:** what obligations accompanied the exact source version actually observed? Union that sealed manifest and the observed placement's case/folder anchors. Later unrelated edits of the source cannot replace this history. A moved source cannot silently detach a previously captured protected ancestor. Changes to those original ancestors' ACLs still take effect because their guards are live. Deletion or missing anchors deny.

Only the source authority can change its live ACL. An downstream copy owner cannot remove its upstream guards by editing the copy, moving it or broadening its folder. Captured policy is a set of authority handles and a policy digest, not a frozen recipient list that would ignore revocation. It records the evaluated revision for audit; current ACL evaluation remains authoritative. A legitimate broadening by the original source authority may enlarge that guard's audience. No downstream confirmation can do so.

Publication of an owned private artifact is special only about its **container**: the owner deliberately copies that version out of their own private container. It does not transplant the private artifact's owner-only read predicate onto the new page. Its upstream manifest is retained unchanged. Similarly, an explicitly selected original personal upload or personally authored Library source can contribute its owner's own disclosure authority when there is verified contribution origin and no other person's protected ancestor. This release applies solely to the submitter's container, to the exact reviewed destination. Ownership of a generated copy never releases its upstream guards or its unresolved classification. Shared-case sources, including ones the user created, retain case/folder obligations; no general creator exception is introduced.

At sealing, flatten source manifests to a sorted unique set of guards; keep observation/version edges only as audit evidence. Effective access to a page or Vault version is `current container ACL AND every sealed guard AND classification permits this viewer/use`. Membership checks use the viewer, not the generation author. For a private-unresolved archive, the classification adds the original private owner as an additional restriction even if the containing folder later becomes public.

Example: A1 read B1; B1 had read A0. A2 can inherit B1's guards plus its observation of A0 without traversing current A2 again. Two concurrent edits A2←B1 and B2←A1 are legal: both observed already committed versions. There are no live mutable derivation edges to race. A subsequent edit of A works. Current revocation of access to A/B still denies affected reads via the resource-access guards. If A acquires an unrelated new source X in A3, content previously derived from A1 does not inherit X retroactively; it retains A1's obligations and A's current intrinsic ACL. This distinction is intentional.

Bound each sealed manifest to 4,096 unique guards and 512 direct observations for one generation, with the existing prompt/file budgets also enforced. Exceeding a bound returns a neutral actionable source-limit result; never truncate obligations. The bounds are product execution limits, not assertions that the real source set is smaller. Read evaluation batches guards by kind and caches success/failure per `(viewer, guard)` only inside the current request/authorization transaction. Dense DAGs cannot cause recursive exponential work. No across-request authorization cache survives an ACL change.

Legacy 0075 graph parsing uses an iterative visited set, a total work budget and strict schema parsing to collect conservative known guards; missing nodes, malformed refs or cycles mark the result unresolved. It never follows current graphs without a bound and never guesses an observed version. Cycles do not block unrelated new attributed resources. An existing malformed/cyclic shared page is quarantined from ordinary shared reads and writes; an authorized original custodian can use a private recovery view only when its known source guards and base ACL still pass. Otherwise only a neutral unavailable/recovery action is returned. A fresh bounded generation can create a separate page from selected accessible sources without reading the quarantined page. It does not claim to repair unknown history.

### Database ownership, approvals and transaction boundaries

New storage is additive; proposed migration is **0076_content_source_policy.sql**, the next unused number in the inspected directory. Recheck that number immediately before writing it. Do not alter applied 0075 or run any migration in the developer database.

Use these records, without a universal event ledger:

- `content_manifest(id, format, classification, owner_id, guards_json, observation_ids_json, contribution_ids_json, digest)`, immutable, canonical hash/dedup within the owner's security boundary. Server evaluation can use a manifest across derived audiences without exposing its private input receipts to those readers.
- `content_observation(id, source_kind, source_id, source_version, content_digest, inherited_manifest_id, policy_digest, parts_json)`, immutable, privately readable by authorized provenance services. Preserve source identifiers without delete cascades that erase obligations.
- `content_version_policy(kind, resource_id, version, content_digest, manifest_id, origin_kind, origin_id)`, unique on resource/version, for every committed revision, including artifact autosaves that are not exposed as history snapshots. Historical retained content and any later snapshot must bind to its original policy.
- `content_submission(id, user_id, home_office_id, conversation_id, message_id, revision, body_json, digest)`, for direct contributions and frozen sends; generated/app-inserted fragments have explicit source handles. Persist only needed payloads under the existing private retention policy.
- `content_generation(id, owner_id, submitted_request_id/run_id, attempt, state, manifest_id, input_receipts_json, output_json, output_digest)`. Receipts refer to private immutable input objects for actual admitted text/files, not unrestricted public logs.
- `content_change(approval_id, exact_change_json, exact_content_json, manifest_id, generation_id, base_version, content_digest, result_kind, result_id, result_version)`. Reuse `capability_approval`; add this one typed extension for content mutations. Existing page approvals remain preserved.
- Add manifest/version-policy references to generated copy/portal/share/connector operation records where their immutable content version is not already enough. Pin rendered identity including template/version/digest and output digest.

The service owns one `withTransaction` per successful database mutation. Existing `database.batch` is atomic but starts its own transaction and cannot be nested into `withTransaction` via `Transaction`, which currently exposes only `prepare` (`db/postgres.ts`, `database.ts`). Refactor `ai-store.ts:updateArtifact`'s row-lock/CAS/history SQL into a private tx-aware writer owned by the content service; retain its snapshot timing behavior. Move all artifact content writers, including `document-workflows.ts:executeRun`, to it. Do not “also write provenance” before/after its existing batch.

`createApprovalProposal` currently writes through global `database`. Add a transaction-bound internal form accepting `tx`, used by this service for proposal creation; do not create an approval and its manifest extension in separate commits. `requireAndConsumeApproval` is unsuitable for content commits because it consumes before the domain mutation. Content confirmation checks/consumes in its transaction, while other unchanged capability flows retain their existing semantics.

Proposal creation loads exact source/base versions, validates edit applicability before creating a proposal, captures immutable bytes and seals the manifest. It reauthorizes all inputs after generation/rendering. It then atomically inserts the pending approval and `content_change`; no document state changes. The full body, destination IDs, expected version, operation, source version, template if applicable and manifest digest are bound by `canonicalInput`. Preview labels come from current-authorized destinations; changing a destination or content requires a new proposal. A changed ACL that still permits the operation is not a reason to mutate the stored body/manifest or silently broaden it.

```ts
// Internal pseudocode inside content/index.ts; imports existing helpers from '@/lib/database'.
async function confirmContentChange(ctx, approvalId) {
  return withTransaction(async tx => {
    // Preliminary immutable proposal read supplies office lock keys; it returns no preview.
    const identity = await locateOwnedProposal(tx, ctx, approvalId);
    // All keys sorted. Shared gates coexist for A/B concurrent edits.
    for (const officeId of identity.policyOfficeIds.sort()) {
      await tx.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))')
        .get(`content-access:${officeId}`);
    }
    const approval = await tx.prepare(
      'SELECT * FROM capability_approval WHERE id=? AND user_id=? AND office_id=? FOR UPDATE'
    ).get(approvalId, ctx.userId, homeOffice(ctx));
    const change = await loadAndVerifyExactContentChange(tx, approval, identity);
    await assertLiveActorAndSourcePolicy(tx, ctx, change);
    if (approval.status === 'consumed') {
      // Return the stored exact result/version, not today's page. Authorize that result now.
      return authorizedStoredCommitResult(tx, ctx, change);
    }
    requireApprovedUnexpired(approval);
    const target = await lockTargetAndAuthorize(tx, ctx, change); // SELECT ... FOR UPDATE
    requireExpectedVersion(target, change.baseVersion);
    // No subsequent conversation read/union; its later turns cannot change this proposal.
    const committed = await commitExactVersion(tx, ctx, target, change);
    await insertVersionPolicy(tx, committed, change.manifestId, change.contentDigest);
    await tx.prepare('UPDATE content_change SET result_kind=?,result_id=?,result_version=? WHERE approval_id=?')
      .run(committed.kind, committed.id, committed.version, approvalId);
    await tx.prepare("UPDATE capability_approval SET status='consumed',consumed_at=CURRENT_TIMESTAMP,chat_result=? WHERE id=?")
      .run(neutralResult(committed), approvalId);
    return commitResult(committed);
  });
}
```

`commitExactVersion` inserts current content and the immutable history snapshot/manifest attachment in this transaction; page version creation is mandatory. Human page writes use the same function after recording/validating their submitted event, with no approval if existing product policy does not require one. Ordinary human modifications inherit existing upstream obligations. Restore unions the current and restored manifests conservatively; it never resets policy. For an owned agent draft whose normal targeted edit needs no confirmation, direct commit still uses the same generation receipt/CAS transaction. Invalid edits, stale versions and cancellation do not modify an artifact, its classification or its policy.

The shared/exclusive office gates cover the existing case membership, protected folder access/parent changes, content moves/deletions and case Lume switch writers. Those writers obtain `pg_advisory_xact_lock` with the same sorted keys before mutations. `assertCapabilityAllowed` and base resource access need a tx-bound variant so checks do not escape to the pool. After acquiring gates, the transaction's live-session check uses `SELECT ... FROM session ... FOR SHARE`; Better Auth session deletion/global logout then orders against that row lock without replacing its revocation implementation. Today's ordinary session SELECT does not already provide this guarantee. No assumption that plain `BEGIN` makes the prior checks atomic. The central content boundary obtains all source/destination office keys from trusted immutable records; unknown/missing keys deny. A source cannot silently migrate offices; any supported move locks both. Each lock only spans database work. This is an access/revocation ordering device; the data shape, not the gate, solves A/B/A and reciprocal derivations.

ACL mutations and confirmations thus have a clear order. If revocation wins, confirmation fails without consuming. If confirmation wins, later reads already apply the new revocation. Byte-producing reads authorize before and after object storage/rendering and before returning bytes. No design can retract bytes already sent over a socket.

The approval button may persist an `approved` decision separately from execution, as today. Failure leaves it approved/retryable with its exact original payload; expired/stale changes require a newly reviewed proposal but preserve the original record and decision. A dropped response after commit is recovered through the result pointer. Duplicate approval requests for already approved/consumed content become idempotent lookups instead of `approveProposal`'s current unconditional conflict. A cancelled proposal can never execute. Competing reject/confirm operations lock the same approval row. Retries after revocation return no protected content; an unavailable response must not imply a second commit or expose a result title.

### Archive, publication and every managed audience-changing exit

Canonical classification is used by **all** exits: a v2 manifest bound to the exact content/version is authoritative; missing, mismatched or malformed v2 data is unresolved. An old 0075 `complete=true` is not v2 proof. Preserve and carry every recoverable known guard even for unresolved versions. No raw `readProvenance() === undefined` shortcut remains.

A same-owner Library copy or that person's own private case folder is allowed when current source access is valid and no new recipient is introduced. The latter also requires all ancestor/case access. An unresolved draft may be archived with an explicit private-unresolved manifest and original owner restriction; it does not become share-eligible. A traceable restricted draft likewise archives without removing any guard. Revoked known sources deny the copy even when its destination is private. An existing successful copy's retry rechecks its current effective policy.

The copy operation resolves selected/default export template **before** rendering and pins its Vault version, bytes and manifest. Missing/inaccessible requested templates cause an explicit error, not `artifactTemplate()`'s current silent fallback. A template change after preparation cannot change the reviewed bytes; a new copy captures a new template. Its deterministic identity includes source version/digest, destination, format, template version/digest and renderer format version. Rendering and object-storage staging occur outside transactions. The final database transaction rechecks source/template/destination access and inserts copy, Vault version, origin and manifest together. Failed inserts clean up unreferenced staged blobs; the current deterministic-ID reconciliation pattern is retained.

Managed exits have these concrete semantics:

- **Case publication:** exact reviewed copy. Destination access is intersected with sealed source guards on list, body, versions, exports, citations, search and activity projections. The review says “Disponível a quem tem acesso ao destino e às fontes utilizadas.” It does not imply every case participant will see the page. No private conversation, memory or artifact owner ACL is copied into the shared object.
- **Vault reads and retrieval:** `findVaultDocument`, `readVaultDocumentFile`, version/original download authorization, chunk retrieval, search and list/count projection all evaluate the version's effective manifest. Keep low-level object storage private to authorized loaders. A public-folder listing cannot leak a restricted derived file's name/count/snippet. Copy origin metadata alone is never the access rule.
- **Moves and folder visibility:** retain immutable manifest attachments. The containing ACL may broaden; its intersection with inherited guards and private-unresolved owner restriction cannot broaden upstream access. Use the office gate for concurrent changes. There is no need to enumerate all downstream copies and rewrite their policies on every source revocation.
- **Personal-chat pinned shares:** `createShare` pins both the actual Vault version and its manifest; requires the sender's current access and, for an internal recipient, that recipient's current upstream source guards. Existing share grants can release the copy's own folder/container according to current product policy but cannot release upstream guards. `readDocumentShare`, message hydration/name projection and claim flows recheck pinned-version guards for the viewer; updating the document's active version never swaps the share's bytes/policy. External token recipients cannot prove private case/folder membership, so protected/unresolved derivatives are denied. Source-free human documents keep the existing external-sharing path.
- **Portal artifact publication:** `publishPortalArtifact` uses canonical version policy and the same captured rendering path. A portal client is not implicitly a case participant. Allow only manifests whose obligations can actually be satisfied for that client on each portal read; in the present product this means attributable content with no nondelegable internal/private guards. Preserve a manifest reference in the portal file and recheck before every download/list/name projection. Existing portal revocation still applies. Retrying an old idempotency key must reauthorize before returning a file.
- **Connector sends/replacements:** carry exact body/subject/attachment/template manifests into the existing Google/WhatsApp operation, bind recipient/destination and payload hashes to its existing confirmation, and recheck immediately before dispatch/retry. Do not double-prompt. The capability's generated text inherits its current model-call receipt even if passed as a raw `body` field; otherwise copying page text into an email body bypasses attachment policy. Human connector editors record direct submissions and preserve app-seeded generation lineage. External channels cannot enforce future case ACL revocation on sent bytes, so protected/unresolved payloads cannot be sent through them. Offer a bounded composition from eligible selected inputs in the same conversation, not “approve to override.” Existing direct human/source-free sends continue unchanged. Remote unknown-result reconciliation remains with the connector, with no claim of a cross-system atomic transaction.
- **Downloads/manual copy:** authorize the user and all known guards at delivery. A private-unresolved owner may export their own quarantined copy under the same private archival policy. State explicitly that this is a release of bytes to that authenticated owner; the app cannot retract them or control offline redistribution, screenshots, manual paste or later disguised re-upload. Recognized in-app duplication/import does preserve policy. This design controls application-managed destinations, not impossible DLP outside the app.

The smallest coherent coverage is a version-manifest join in each authoritative managed read/delivery service, plus input receipts for generated payloads. It is not enough to guard the initial “Salvar no Cofre” button or only attachments. Receipt storage is limited to content generation, shared reads entering models and managed copies; it is not an event ledger for all application actions.

### Existing document workflows, regeneration and recovery

`document-workflows.ts`'s extract/outline/section/divergence stages become consumers of the same admission primitives. Each selected Vault chunk, research material, template, writing-rule/knowledge record and direct run instruction is an observed input. Checkpoints persist their generating receipt and exact output digest. A resumed stage loads/reauthorizes its original immutable inputs and prior checkpoint manifests; it cannot simply reuse serialized `writingRules`/`knowledge` strings as trusted new inputs. Generation artifacts are committed through `writeContent` with the worker's existing run lease checked in the same transaction; completion/result pointer and content creation cannot split or duplicate on retry. Queued legacy runs lacking attributable receipts may finish privately as unresolved, never as silently untracked output.

Regenerating a chat send uses its stored instruction/scope/selections, not the current canvas or memory-derived planner summary. Current ACLs are rechecked. Use pinned source versions where retained. If a version disappeared, request explicit reselection; do not silently substitute current text. A new generation has a new attempt/receipt and, if it proposes different content, a new exact review. The existing persistent conversation and per-send semantics remain.

Recovery of a legacy model output is deliberately narrow: keep/archive it privately, select accessible source versions and type the desired task in the same conversation, then generate a **new** artifact/page without admitting the old output, its title or a model summary of it. Compare privately only if old known source guards permit; the comparison itself is private-unresolved and cannot feed the new generation. A human can still create original content through the ordinary editor, but an application “copy old draft,” “rewrite this output,” or prefilled summary carries the old classification. Clicking review, changing a title, overwriting a few words or merely asserting “I wrote this” cannot cleanse it.

### Migration and rollout

0075 is already applied to the disposable verification database. Preserve its tables, current content, history, approvals, `source_dependencies`, origins and metadata. Add 0076 only. The developer database remains unmigrated in this design task.

Backfill is evidence-based and cannot certify missing inputs. Original uploads with retained server upload events/digests and demonstrably person-authored versions with payload-bound evidence can receive contribution manifests. `created_by_agent`, `run_id`, `conversation_id` and `source_refs` are positive evidence of potential automation, not an exhaustive history. Their absence and `updated_by` alone do not prove a legacy version was never edited by an agent. Such ambiguous rows remain unresolved; this deliberately tightens the old `isUntrackedHumanArtifact` heuristic. The change is justified by `artifacts-service.ts:saveArtifact/editArtifact`, which can update an originally human row without converting its origin flags, and the review's pre-CAS certification defect. Do not destroy them or ask for a false certification.

Translate old dependency identifiers into conservative live guards using bounded traversal, without inventing historical source versions. Malformed/missing/cyclic legacy lineages are unresolved and denied on shared surfaces. Existing shared rows lacking sufficient evidence are preserved but quarantined from ordinary shared disclosure, including their titles. This is an observable migration cost, not a transparent repair; offer the scoped fresh-generation recovery. Do not backfill old resource-wide provenance onto all historical versions and call that exact lineage.

Pending/approved old content approvals keep their stored decisions and exact input. They do not gain a v2 manifest merely by retrying. Revalidate and offer a new proposal from attributable inputs; an unprovable old payload stays private. Consumed approvals keep their result pointers; reporting their exact historical result requires current authorization and classification. Cancelled records remain cancelled. Suppress unsafe legacy approval summaries at projection time without deleting their audit data.

Switch all listed managed exits and all new generation writers to the canonical service before enabling share-eligible v2 generation. During rollout missing policy is unresolved, never “legacy unrestricted.” Existing source-free, demonstrably human flows retain their normal interaction; new human editing has no new approval bureaucracy. No dual-write live graph or permanent compatibility writer is retained.

### Compact module map and deletions

- `src/lib/content/index.ts`: substantive public domain service above; version classification, read/write/review/confirmation/delivery policy. Owns content/version/proposal commits. The file is not a forwarding barrel.
- `src/lib/content/policy.ts`: private canonical manifests, flat guard evaluation, authorization gates and bounded legacy interpretation. Its entry points are accessible only inside the content boundary and authorized input loader implementation.
- `src/lib/content/storage.ts`: private tx-aware artifact/page/copy policy persistence; rendering integration uses existing pure exporters. No public `saveProvenance`, `skipSources` or raw-content write.
- `src/lib/content-generation.ts`: submitted-request packet assembly, private/bounded input admission, output receipts, provider-boundary checks; calls existing runtime/provider functions. No new scheduler, agent framework or model router.
- Existing `chat-scope-server.ts`, chat route/prompt/turn, instruction/knowledge/memory loaders and `agent-tools/index.ts`: actual adapter changes described above, not parallel services. The one executor registry owns each tool's admission description.
- Existing Vault/share/portal/connector modules retain their domain storage/protocols but route content-bearing operations through `deliverContent` and the same effective-access evaluator. Their internal transaction insert functions are called by the service; no caller-supplied callback becomes a public policy bypass.

Enforce private internal imports with repository lint restrictions and no exports from storage/policy modules to unrelated callers; add a dependency-boundary check that rejects the prohibited imports. A future move to a package with `exports` can harden this, but is unnecessary for this repair. SQL write ownership is also checked by the migration/caller sweep; TypeScript visibility cannot stop arbitrary SQL alone.

Delete/replace `case-pages/provenance.ts`'s `recordProvenance`, `recordToolProvenance`, resource-wide `complete` merge and recursive `sourceAccess`; do not leave callers on them. Remove `agentSources()` and its “conversa nova sem memória” recovery. Replace `preserveProvenance()` and all pre-approval provenance mutations. Replace text-bearing shared-page agent create/update inputs with the request-bound proposal tool; retain human route DTOs as adapters to person submissions. Replace full approval-summary replay and ask's title/excerpt concatenation. Replace `GUARDED_TOOLS` membership with the registry descriptor. Remove direct artifact insert/update/restore bypasses, including workflow writes. Preserve old DB fields as historical evidence, not a second policy source. Retain citation `source_refs` for citation features; they do not acquire authorization meaning.

### Required regressions and evidence

No tests were run in this design task. These are acceptance regressions for the implementer, not claims of runtime proof.

1. **Normal personalized shared drafting through real admission:** seed actual working and learned memory, a direct writing preference, configured knowledge and discovery responses; submit a real scoped chat request for a case page. The bounded generation must produce an exact reviewable proposal while stored private personalization remains unchanged. No hand-seeded `complete=true` or fabricated generation manifest. Repeat A/B/A in one persistent conversation.
2. **Provider request bytes:** replace only the configured external provider endpoint with a recording stub. Drive chat route, Mastra processors, tools, template/knowledge loaders and approval rendering. Put distinct sentinel bytes in memory, prior assistant text, generated rules, title/selection, tool errors, approval summaries, attachment names/text/images and connector results. Assert the actual outbound shared-generation request contains only intended admitted bytes/files and all expected direct/style/source inputs; private chat still receives eligible private memory. Test after all runtime processors, not a mocked prompt-builder return. Ensure no hidden provider thread ID or history replay is used.
3. **Planner laundering:** have the private stub emit arbitrary instructions, a malicious title, source IDs outside the send and model-produced “user intent.” The proposal API rejects/ignores those fields and binds the actual send. A structured prompt-injection rejection must remove the only source representation, including legacy ask duplicates. Direct typed text and genuinely new upload events work; seeded/generated text cannot mint a direct contribution.
4. **Approval history and access:** publication invoked without first opening the artifact, cancelled/failed/confirmed/restored previews, and source revocation before a later turn. No preview/title/body sentinel in model history or unguarded chat hydration. Current review endpoints deny revoked bytes. Explicitly loading the preview as a source propagates its policy.
5. **Real PostgreSQL atomicity:** inject exceptions after content update, after version insert, after manifest attachment and before result-pointer/consumption update. Every failure rolls back all changes. Stale CAS, invalid targeted edit and cancellation leave a clean human draft unchanged and cannot certify a legacy agent draft. Approval creation plus extension is atomic. Test artifact autosave revisions as well as history snapshots.
6. **Real PostgreSQL concurrency:** use two independent connections and barriers for simultaneous confirmations of the same approval; one version/result. Two writers with the same expected version produce one success and one retryable conflict. Reciprocal A2←B1/B2←A1 commits remain readable. Revocation versus confirmation, folder broadening versus copy and source deletion versus rendering obey the gate ordering. A gate accidentally omitted in an ACL writer must fail these tests. A dense 20-page DAG stays within linear/flat guard evaluations; count actual queries/guard visits rather than wall-clock guesses.
7. **Version semantics:** after A1 is used, add unrelated protected X only to A2; a derivative of A1 retains A1 obligations, not X. Revoke A's base access or an A1 source and deny derivative. Move a copy/publicize its folder and verify guards remain. Restore carries historical plus current obligations. Missing source/version, malformed policy, old cycles and budget exhaustion fail safely without leaking title/count.
8. **Archive and export template:** traceable restricted draft archives to own Library/private folder; unknown draft archives privately unresolved; known revoked source denies. Later moves, broadening and sharing cannot remove policy. Default template and selected template both contribute actual versions; changing default invalidates neither pinned bytes nor exact review, and new exports receive the new policy/identity. Retry after staged-blob failure is idempotent.
9. **Every managed exit through real service entry points:** pinned internal/external personal-chat shares, token claims and message names; direct portal artifact publication and retries; Gmail body/subject/attachments, Drive replacement, WhatsApp text/media; Vault list/search/chunks/download; artifact and shared-page exports. Test actor/recipient distinctions, private-original isolation, guest capability denial and confirmation reuse. Do not test only a central service call while production entry points bypass it.
10. **Workflow receipts:** queue a real document run with selected sources, template, writing/knowledge configuration and a stub provider; resume checkpoints, revoke a source between stages and race duplicate workers. Newly generated artifacts always have a bound policy; legacy queued runs cannot become attributed through resume. Run lease, completion pointer, artifact content and policy are consistent after failure.
11. **Legacy migration on PostgreSQL:** apply 0076 after existing 0075 fixtures; preserve all rows/metadata/approval states; ambiguous human-origin flags, untracked agent/run artifacts and pre-CAS certified rows remain unresolved. Never run or rewrite 0075 as a repair. Existing exact consumed outcomes remain recoverable subject to current access.
12. **Affected UI e2e:** existing personalized conversation creates/edits a page, reviews exact destination/content, archives privately, handles a stale approval without losing the pending proposal, and performs recovery from a legacy draft in the same conversation. Verify desktop/mobile and keyboard for changed ask/review controls only. Coordinate with, but do not duplicate or redesign, the separate editor lifecycle repair.

Recording provider stubs prove the application boundary and transaction behavior, not a live model's faithfulness, quality or resistance to every injection. A live-provider smoke test, when separately run by the parent, can demonstrate a real usable proposal and inspect the same receipt; it cannot prove general noninterference. Report these evidence levels separately.

### Red-flag audit

- **Shallow module/pass-through:** the public content service resolves exact inputs and owns policy/commit/recovery; callers do not coordinate classify → approve → save-policy → write. Domain adapters translate actual transport/business concepts only. The generation boundary owns the complete admission/result invariant.
- **Information leakage:** wire DTOs remain in route/capability adapters; callers cannot construct `Manifest` or transmit `complete`. Only refs/request IDs cross the domain API. Immutable source policy does not expose raw private memory to page metadata.
- **Temporal decomposition:** admission and generation receipts share one owner; content/version/approval operations share another. No separate public “record source,” “validate sources,” and “apply write” sequence can be reordered by a caller.
- **Split ownership:** one tx-aware writer owns each artifact/page content version and policy attachment; existing background writers are migrated in the same unit. Original domain ACLs retain their original authority, coordinated only for atomic observation. A copy's metadata is not a second ACL implementation.
- **Two ways to do one task:** old provenance helpers, raw artifact writers and text-bearing agent page writes are removed, not retained as compatibility shortcuts. History/approval models use one admitted-input projection, including exceptions.
- **Importable internals:** explicit import restrictions and a failing boundary check prohibit external storage/policy imports; only the public content service is used for mutations. No public callback, castable Boolean or “trusted caller” mode bypasses runtime receipt verification.
- **Hand-synced list:** execution and model-result admission metadata live in the same exhaustively typed capability registry entry. Shared drafting/injection behavior is derived from it and existing access rules; no growing provenance tool-name list. Managed domain exit coverage is a finite call-site migration with behavioral regressions, not a second runtime capability registry.

### Grounding and review disposition

Read in full: the architect skill, runner prompt, rationale template, design red flags, accepted synthesis, original unit-2 brief, lead verdict, fresh provenance trace, and reviews A/B/C. Inspected relevant production helpers read-only to settle transaction/registry/version questions. No other candidate output or parent rubric was read.

All source findings remain accepted: A1/B1/C3 → bounded shared admission; A2/B4/C4/C5 → canonical classification and retained copy policy; A3/B3/C2 → atomic content/version/manifest commit; B5/C1 → preview-only human endpoint and safe replay; C6 → separate typed instruction and observed selection; A4/B2/C7/C8 → immutable observed versions and flat guards. A5/B6 belong to the independent editor writer and are neither dismissed nor redesigned here.

Specific evidence for deliberate departures from today's modules:

- `src/lib/case-pages/provenance.ts:recordProvenance/sourceAccess` permanently ANDs completeness and recursively reads current `source_dependencies`; replacing both is necessary, not a cache tweak.
- `src/lib/case-pages/service.ts:mutate/resolveMutation` unions later conversation provenance and returns the current page for a consumed retry despite storing `result_version`; the proposal now fixes lineage and returns its exact committed result.
- `src/lib/application/artifacts-service.ts:preserveProvenance/saveArtifact/editArtifact` writes policy before approval/CAS and does not establish historical human authorship through origin flags. This justifies atomic version policy and conservative legacy classification.
- `src/lib/ai-store.ts:updateArtifact`, `src/lib/db/postgres.ts:postgresTransaction/postgresDatabase`, `src/lib/database.ts:withTransaction` establish the actual batch/connection limitations used in the transaction sketch.
- `src/lib/application/approvals-service.ts:createApprovalProposal/requireAndConsumeApproval/approveProposal` establishes global writes, early consumption and non-idempotent repeated approval; content proposals must use the tx-bound path.
- `src/lib/agent-tools/index.ts:runCapability/toolFor`, `src/lib/capabilities/contracts.ts:Capability`, `src/lib/chat-prompt.ts:chatPromptMessages` establish where tools, exceptions, metadata and history reach the model; successful-tool hooks alone cannot certify inputs.
- `src/lib/agent-memory.ts:agentMemory/readMemory` confirms that the processor reads a different value from the truncated application helper. The proposed provider check and adapter cover the actual injected value.
- `src/lib/application/vault-service.ts:saveArtifactToVault/copyIntoVault`, `src/lib/artifact-file.ts:artifactTemplate/artifactVaultFile`, `src/lib/personal-chat/shares.ts:createShare/readDocumentShare` establish missing-provenance bypass, mutable template input and independently pinned recipient grants.
- The full fresh trace supplies the remaining scoped portal/connector/research paths; `src/lib/document-workflows.ts:executeRun` independently confirms new artifacts are currently inserted without transactional policy. These are required integration points, not unrelated subsystem re-investigation.

This is a design package only. No git commands, tests, servers, browser sessions, migrations, dependency changes, secret reads, production edits or delegation were performed.
