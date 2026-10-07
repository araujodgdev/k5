# Candidate 3: bounded generation with versioned content policy

## Usage (caller's view)

Lume keeps the existing private conversation and personalization. A request to write shared content starts a bounded generation **within that conversation**. The writing model receives the person's recorded request, authorized source snapshots and eligible writing preferences. It does not receive a private-model plan, conversation summary or working memory. The proposal appears in the existing review surface and uses the same version service as a person saving a page.

These are proposed domain APIs, not claims about APIs already present. Identity and invocation are constructed on the server; browser and model input cannot set them.

```ts
// 1. Existing chat capability executor. The private agent supplies an operation and
// resource identities, never prose to be laundered into the writing prompt.
import { proposeDocumentChange } from '@/lib/documents/service';

const proposal = await proposeDocumentChange(context, {
  kind: 'generate',
  request: context.userRequest, // server-held current submission, not a tool argument
  target: { kind: 'case-page', caseId, pageId, expectedVersion: 7 },
});
// { approvalId, previewUrl, state: 'pending' }; exact title/content stay in review UI.
// Private chat receives only a fixed status, not proposal text or destination labels.
```

For “Resuma os próximos passos nesta página”, generation reads page v7 and the explicitly selected documents from that send. Existing private memory remains available to the private assistant. “Resuma os próximos passos” is the original submitted text, not a rewritten instruction from that assistant. If the selected passage came from a page, it is loaded as page data, even though a person selected it.

```ts
// 2. Human autosave and reviewed publication use the same content/version owner.
import { saveDocument, proposeDocumentChange, confirmDocumentChange } from '@/lib/documents/service';

await saveDocument(contextFromRequireWorkspace, {
  kind: 'person-edit', document: pageRef, expectedVersion: 7,
  text: { title: submittedTitle, content: submittedContent },
}); // ordinary autosave; no new approval

const publication = await proposeDocumentChange(contextFromRequireWorkspace, {
  kind: 'copy-to-page', source: { document: artifactRef, version: 4 },
  destination: { caseId, folderId: null },
});
// GET publication.previewUrl loads the exact frozen proposal after current authorization.
await confirmDocumentChange(contextFromRequireWorkspace, publication.approvalId);
// Returns the committed page/version; duplicate confirmation returns that same receipt.
```

A directly authored private draft can be published without making its conversation available. A draft with protected upstream inputs keeps their restrictions. An untracked agent draft cannot acquire sharing eligibility through a failed edit or a confirmation.

```ts
// 3. Existing SaveForm; policy is evaluated against the actual destination and render.
import { archiveDocument } from '@/lib/documents/service';

const copy = await archiveDocument(contextFromRequireWorkspace, {
  source: { document: artifactRef, version: 4 },
  destination: { kind: 'library' }, format: 'docx',
  idempotencyKey: submittedOperationId,
});
// A permitted owner-only draft can be archived here. The Vault version carries its
// owner fence, known source guards, unresolved-origin classification and template pin.
// Moving or sharing that file later cannot remove them.
```

## Problem

Private ownership, input admission, exact review and later delivery are different decisions. The current implementation uses a permanent conversation Boolean for all four, initializes artifact policy before content succeeds, and recursively authorizes other pages' current dependency graphs. This prevents normal personalized page writing while leaving preview, Vault, portal and background-generation holes. Keep the accepted `ai_artifact`/`case_page` separation, session-derived identity, existing Mastra/AI SDK execution, current case/folder ACLs and the editor contract. Replace only source-policy ownership, generation admission and application-managed propagation. The concurrent editor draft/revocation repair is independent; only `workspace.ask`'s source-input representation changes here.

## Shape

### Recommendation and invariant

Choose **bounded request generation plus immutable, flattened version policy**. Trusted provenance is established by the server that assembles the actual writing request. Publication consumes a committed version policy; it never infers policy from citation references, a model's source list, a clean conversation, a prompt instruction or an injection verdict.

The load-bearing invariant is:

> Every generated or copied content version has a policy bound to its exact bytes. A content delivery checks its own current access path and every retained source restriction. An unknown model input limits delivery to the existing owner; it is never certified by review.

Person-origin inputs are a separate product trust boundary: the application can prove that a person explicitly submitted bytes, not who originally authored everything in those bytes. Known application sources never become person-origin merely because they were selected, reviewed, quoted or inserted into `role: user`.

### Two whole-system shapes, with concrete control flow

**Shape A — one source-aware conversation execution.** All loaders return typed fragments, the Mastra memory processor emits provenance-bearing fragments, the final provider request contains an immutable input receipt, and every assistant/tool output inherits the request's flattened policy. Page writes take generated text and a server-created output receipt from that same execution.

```ts
type ConversationPart =
  | { kind: 'person-event'; eventId: string }
  | { kind: 'source'; observationId: string }
  | { kind: 'derived'; outputId: string }
  | { kind: 'unresolved'; owner: Owner; bytesDigest: string };

async function runSourceAwareTurn(ctx: WorkspaceContext, turnId: string): Promise<TurnOutput> {
  // Load history, rules, knowledge, memory and tools as ConversationParts.
  // Resolve and authorize every part immediately before each provider call.
  // Unknown memory makes this call's output owner-only, not the conversation forever.
  // Provider/tool intermediates inherit all admitted restrictions.
  throw new Error('not implemented');
}
async function proposeFromTurn(ctx: WorkspaceContext, outputId: string, target: PageTarget) {
  // Load output bytes + policy; exact review; atomic version/approval commit.
  throw new Error('not implemented');
}
```

Caller example: `const reply = await runSourceAwareTurn(ctx, turnId); await proposeFromTurn(ctx, reply.documentOutputId, target)`. A known direct preference and known Vault sources work without a second call. An existing learned-memory card, an old model-authored rule or an untracked assistant summary makes the proposed output owner-only. Exact review cannot remove that restriction. To serve normally personalized users, Shape A must either exclude unresolved fragments for that turn before the provider call, structurally rebuild and attest all memories/history, or make a second bounded generation anyway. An instruction telling the model to ignore memory does not change this result. This is genuinely a different trust boundary: provenance follows the original assistant execution, including its planning and history, rather than a separately assembled writing request.

**Shape B — selected.** The private assistant remains free to discuss the request using personalized context. Its page-writing capability carries only bounded resource identities and operation selectors. `proposeDocumentChange` reloads the server's original request, constructs a tool-free writing call, binds its complete input receipt to the resulting text, then creates an exact proposal. The private assistant's generated title, rewritten request, inferred facts, freeform plan, section headings and error text are not forwarded. No new chat or durable Mastra thread is created.

```ts
async function proposeDocumentChange(ctx: WorkspaceContext, change: ProposalRequest) {
  // Generate: request event -> authorized snapshot bundle -> existing structured
  // runtime without memory/tools/history -> immutable proposal + bound policy.
  // Copy/restore: exact version -> current authorization -> immutable proposal.
  throw new Error('not implemented');
}
```

This hides more policy behind a smaller consumer interface. A caller supplies intent identity and destination, not a correctness-critical prompt/provenance pair. It avoids making successful page writing depend on recovery of historical memory authorship. Shape A remains appropriate for private-chat replay protection and conservative private-output classification; it is not the selected sharing eligibility mechanism.

### Data structures first

The following sketch is domain-level. Database rows, Zod DTOs, Mastra objects and provider wire formats stay private. Opaque handles have private constructors and are also verified against stored owner/receipt data at runtime; a TypeScript cast or guessed ID is not authority.

```ts
declare const handleBrand: unique symbol;
type Opaque<Name extends string> = Readonly<{ id: string; [handleBrand]: Name }>;
type Owner = { userId: string; homeOfficeId: string };
type DocumentRef =
  | { kind: 'artifact'; id: string }
  | { kind: 'case-page'; caseId: string; id: string };
type VersionRef = { document: DocumentRef; version: number };
type DocumentText = { title: string; content: string };
type NewDocumentTarget =
  | { kind: 'new-artifact' }
  | { kind: 'new-case-page'; caseId: string; folderId: string | null };
type PageTarget =
  | { kind: 'new-case-page'; caseId: string; folderId: string | null }
  | { kind: 'case-page'; caseId: string; pageId: string; expectedVersion: number };

// Actual authenticated ingress, not an inference from role:user or updated_by.
type PersonEvent = {
  id: string; owner: Owner; conversationId: string | null;
  origin: 'typed-request' | 'person-editor' | 'person-upload' | 'person-setting';
  textDigest: string; submissionId: string;
  scope: AuthorizedSendScope; // existing frozen scope semantics
};
type UserRequestRef = Opaque<'UserRequestRef'>;
type AuthorizedSendScope = Readonly<{
  document: DocumentRef | null; caseId: string | null;
  sourcePicks: readonly SourcePick[]; selection: StoredSelection | null;
  personInstructionIds: readonly string[];
}>;
// SourcePick contains a real typed resource identity; StoredSelection contains
// a committed-version locator/digest. Neither contains a model-authored instruction.

// Evaluated against current DB state; never recurse into current content policy.
type AccessGuard =
  | { kind: 'case'; officeId: string; caseId: string }
  | { kind: 'folder'; officeId: string; caseId: string; folderId: string }
  | { kind: 'vault-document'; officeId: string; documentId: string }
  | { kind: 'case-page'; officeId: string; caseId: string; pageId: string }
  | { kind: 'external-source'; accountId: string; sourceId: string; adapter: ExternalSourceKind };
// Missing/tombstoned/inconsistent guards deny. External guard availability alone
// does not establish redistribution permission.

type SharingDisposition =
  | { kind: 'eligible' }
  | { kind: 'owner-only'; owner: Owner; reason: 'unresolved-input' | 'legacy-model' | 'private-source' };

// This is internal and immutable, not a public setter accepting complete:true.
type VersionPolicy = {
  id: string; schema: 2; bytesDigest: string;
  disposition: SharingDisposition;
  guards: readonly AccessGuard[]; // flattened, canonical, deduplicated
  observations: readonly SourceObservation[];
  contributionIds: readonly string[];
};
type SourceObservation = {
  id: string;
  resource: ObservedResource; // page/artifact/Vault/attachment/rule/research/external
  version: string; contentDigest: string; policyDigest: string;
  admittedRange: { kind: 'whole' } | { kind: 'excerpt'; digest: string };
  observedOfficeId: string | null; observedPolicyRevision: string;
};
type ModelInputReceipt = {
  id: string; owner: Owner; purpose: 'private-chat' | 'document-generation';
  requestId: string; promptDigest: string; policyId: string;
  modelTask: string; serializerVersion: number;
};
type GeneratedDocument = Opaque<'GeneratedDocument'>; // server-bound receipt + exact text
type AuthorizedContent = Opaque<'AuthorizedContent'>; // exact version + policy + use
type PreparedFile = Opaque<'PreparedFile'>; // exact bytes + render inputs + merged policy

type ProposalRequest =
  | { kind: 'generate'; request: UserRequestRef; target: PageTarget }
  | { kind: 'copy-to-page'; source: VersionRef; destination: { caseId: string; folderId: string | null } }
  | { kind: 'restore'; document: DocumentRef; expectedVersion: number; restoreVersion: number };
type PersonSave =
  | { kind: 'person-create'; target: NewDocumentTarget; text: DocumentText }
  | { kind: 'person-edit'; document: DocumentRef; expectedVersion: number; text: DocumentText };
type PrivateModelSave = {
  kind: 'private-generated';
  target: { kind: 'new-artifact' } | { kind: 'artifact'; id: string; expectedVersion: number };
  output: GeneratedDocument;
};
// Existing artifact tool adaptation binds actual model-produced arguments to the
// server-held provider-call receipt. Background composition binds included call
// receipts. Neither may mint GeneratedDocument from an asserted source list.
// saveDocument refuses person-* variants in an agent/WebMCP invocation.

type ContentVersionRef = VersionRef
  | { kind: 'vault-version'; documentId: string; version: number }
  | { kind: 'portal-file'; fileId: string }
  | { kind: 'attachment'; attachmentId: string };
type RenderChoice = {
  format: 'pdf' | 'docx';
  template: { kind: 'default' } | { kind: 'none' }
    | { kind: 'selected'; documentId: string; expectedVersion: number };
};
type ArchiveRequest = {
  source: VersionRef;
  destination: { kind: 'library' } | { kind: 'case-folder'; caseId: string; folderId: string | null };
  format: 'pdf' | 'docx'; idempotencyKey: string;
};
type DeliveryTarget =
  | { kind: 'case-page'; caseId: string; folderId: string | null }
  | ArchiveRequest['destination']
  | { kind: 'message-share'; threadId: string; recipient: ResolvedRecipient }
  | { kind: 'portal'; clientId: string }
  | { kind: 'connector'; operation: ConnectorOperation; audience: ResolvedAudience };
type DeliveryCommand = {
  source: AuthorizedContent | PreparedFile; target: DeliveryTarget;
  operationId: string; expectedInputDigest: string;
};
// Recipients/audiences are resolved by the existing sink's authorization code,
// then verified by policy; they are not client booleans such as allHaveAccess.
type CommittedVersion = {
  document: DocumentRef; version: number; bytesDigest: string;
  resultId: string; policyId: string;
};
type ProposalReceipt = {
  approvalId: string; previewUrl: string;
  state: 'pending' | 'cancelled' | 'committed'; result?: CommittedVersion;
};
type ExactReview = {
  approvalId: string; text: DocumentText; destination: HumanDestinationView;
  audience: HumanAudienceView; expectedVersion: number | null;
  contentDigest: string; sourceVersions: readonly HumanSourceVersionView[];
};

// documents/service.ts owns content, version binding, lineage and proposal outcomes.
declare function getDocument(ctx: WorkspaceContext, ref: VersionRef | DocumentRef): Promise<DocumentView>;
declare function saveDocument(ctx: WorkspaceContext, save: PersonSave | PrivateModelSave): Promise<CommittedVersion>;
declare function proposeDocumentChange(ctx: WorkspaceContext, request: ProposalRequest): Promise<ProposalReceipt>;
declare function getDocumentProposal(ctx: WorkspaceContext, approvalId: string): Promise<ExactReview>;
declare function confirmDocumentChange(ctx: WorkspaceContext, approvalId: string): Promise<CommittedVersion>;
declare function cancelDocumentChange(ctx: WorkspaceContext, approvalId: string): Promise<ProposalReceipt>;
declare function archiveDocument(ctx: WorkspaceContext, request: ArchiveRequest): Promise<VaultVersionRef>;

// content-policy.ts exports operations, never an arbitrary policy constructor.
declare function generateDocument(ctx: WorkspaceContext, request: UserRequestRef,
  target: PageTarget): Promise<GeneratedDocument>;
declare function requireContent(ctx: ViewerContext, ref: ContentVersionRef,
  purpose: 'person-read' | 'model-read' | 'copy', tx?: Transaction): Promise<AuthorizedContent>;
declare function prepareFile(ctx: WorkspaceContext, source: ContentVersionRef,
  render: RenderChoice): Promise<PreparedFile>;
declare function authorizeDelivery(ctx: WorkspaceContext, delivery: DeliveryCommand,
  tx: Transaction): Promise<AuthorizedDelivery>;
declare function withAclMutation<T>(officeIds: readonly string[],
  change: (tx: Transaction) => Promise<T>): Promise<T>;
```

`GeneratedDocument`, `PreparedFile` and `AuthorizedDelivery` expose read-only view data plus operation-bound opaque receipt identities, not an editable `policy`. Documents service verifies the receipt, byte digest, owner and allowed use before writing. `authorizeDelivery` handles a finite domain union of page publication, Vault archive/move, message grant, portal publication and connector delivery. It is not a public “ignore restrictions” option or arbitrary callback. Source policy owns classification and the only merge implementation, per single-source-of-truth and boundary-discipline. Document service owns all committed document/version bindings, per split-ownership avoidance.

### Exact admission: what reaches writing

The writer input is built in this order, before calling `createAgent`/`generateStructured`:

1. Application-owned writing instructions, output schema and locale; an existing resolved task model and connection. Configured provider/model identifiers are operational choices, not imported textual instructions. No configurable freeform system prompt enters without a content policy.
2. The exact current typed request event, plus previous **explicitly selected direct person events** if the person asks to continue their instructions. No automatic entire-history replay. A bare “faça isso” with only an assistant plan as antecedent receives a scoped clarification in the same conversation; the assistant plan is not secretly copied into the writer prompt.
3. Current target snapshot for an edit, server-resolved selection, and the explicit per-send source selection. `workspace.ask` sends only `request.instruction` as typed text. A separate descriptor contains document identity, expected version and selection locator/digest. The server derives title/excerpt from that version and verifies the locator. Unsaved selection cannot be matched to committed bytes: save/reselect or explicitly submit the unsaved text as an editor contribution **with the document's baseline policy retained**. The browser excerpt never becomes an independent direct-authorship event.
4. Configured `always` knowledge loaded as document snapshots with policy; bounded `search` knowledge contributes no raw listing unless actually admitted as a resource fragment. Search queries for writing come from the original direct request and selected resources, not a query rewritten by the private model. Eligible results are snapshotted; references and titles are data from the same source envelope. Missing/ineligible implicit knowledge is omitted with a fixed notice. A missing explicitly requested source or edit target stops the proposal with a recoverable source-unavailable result.
5. Eligible style: direct person setting events, application-owned finite style choices, or policy-bearing generated rules. Raw legacy rules without ingress proof, working memory and learned memory are deliberately excluded from this call. Direct events for new rules establish that the person entered them; `updated_by`, agent approval or the person's ownership alone does not. Agent-created/edited rules inherit their actual execution policy. For legacy preferences, a person can explicitly choose “Formal”/“Conciso” or submit a new rule; no model extracts supposedly harmless facts from old memory. Existing private chat still uses its stored preferences and memories.
6. Explicitly selected direct upload events bound to the request/destination, including their names, extracted text, original images and any DOCX embedded images actually sent. A upload is proof of submission of particular bytes, not authorship. Application-managed attachment imports/copies carry their prior policy. Extraction/transcription is a derivative of the upload receipt; transcription is never retroactively labeled typed text. Attachments not selected for this writing request are excluded, regardless of prior private-chat use.

The private model can suggest a target/source **identity** for discovery, but cannot pass labels, text, style, counts, headings or a freeform prompt. Its optional identity suggestions are resolved by existing capability and guest scope rules and surfaced as source picks. Only picks confirmed by the original explicit selection or a later direct person selection enter writing. Thus a private-model-selected filename or encoded tool argument cannot become a covert text instruction. Case-page create/update agent schemas replace `title/content` with operation/target IDs; current submission identity comes from server context. Copy/restore capabilities remain exact-version operations, without asking the private model to rewrite text.

Every automatic loader still applies `assertCapabilityAllowed` and the existing scoped resource access path for the initiating invocation. Bounded generation is not authority to load home-office private artifacts, CRM or out-of-case sources for a guest. Traceability does not widen its capability set. The person's direct instruction and allowed case picks can produce a proposal even when ineligible implicit private knowledge is omitted.

Private chat may discuss the proposal afterward, but the writer's result returns to it only as a constant status and opaque link. If actual proposal text is requested in chat, it is reloaded through `requireContent` with its policy. Private chat's paraphrase of that result has private-execution policy, not the writing result's sharing eligibility.

The actual write call uses the existing runtime with **no memory, tools, native web search, recall, private transcript, private focus prompt or external conversation/session continuation**. `generateStructured` already calls `createAgent` without memory/tools (`src/lib/ai-runtime.ts:generateStructured`); add an overload accepting the opaque assembled input instead of a caller-built raw prompt for transferable content. Keep usage, billing, cancellation, provider selection and legal/citation rules. `taskSession` is not assumed to isolate provider state: pass a generation-specific request session where supported and prohibit provider thread/previous-response reuse for this purpose. Do not implement a new agent framework.

All titles, destination labels, names, omission notices and template/style text admitted to the model have an envelope. Static notices are application constants; arbitrary provider or tool error messages never enter writing. Run the existing injection check over untrusted admitted fragments, including shared titles and selections, **before serialization**. Withheld fragments and their text-bearing notices are excluded; only fixed notices remain. A verdict is a probabilistic safety check, never ACL proof. An edited page still retains its prior policy even if its text was withheld from generation.

### Private chat remains useful, without a second provenance allowlist

Replace `recordToolProvenance`'s capability-name switches and `GUARDED_TOOLS`' independent name list with required exposure metadata on the existing capability registry and provenance-bearing server executor results. The registry still derives tools, WebMCP publication and guest availability. Do not add a second capability-name allowlist for the writer: it is tool-free.

```ts
type ModelExposure =
  | { kind: 'constant'; value: ConstantResult } // schema admits literals/enums only
  | { kind: 'resource'; content: AuthorizedContent }
  | { kind: 'derived'; output: StoredModelOutput }
  | { kind: 'private-unresolved'; owner: Owner; payload: unknown };
// defineCapability ties contract + executor + exposure adaptation at one registry entry.
// A new payload-bearing result cannot default to constant or transferable.
```

Source-returning executors form their envelope in the same loader that authorizes and captures the actual content, before model delivery. A user ID/reference list supplied by a model is not that envelope. Discovery returns authorized resource metadata envelopes; listing cases or folders does not poison future independent writing requests. A new/unadapted capability is private-unresolved and guard-treated, never silently source-free. Dynamic/provider-executed web tools are private-unresolved in private chat and absent from writing. Public web/research snapshots can enter writing only through a server adapter with pinned bytes and verified applicable AI/redistribution permissions; otherwise they remain private-only. Connector read access is not redistribution permission. Initially Gmail/Drive direct results and imports with unverified redistribution remain owner-only with known account/resource guards, rather than guessing another case's or external recipients' entitlement.

At private provider calls, the assembly path records known guards for history, actual tool outputs, configured knowledge, labels, attachments, focus content, writing rules and memory. Assistant outputs and model-authored summaries inherit the union of **that call's** admitted policies. Unknown working/learned memory is explicitly private-unresolved; it is not declared safe. Mastra's actual processor-injected working-memory bytes must be included, not just `readMemory()`'s truncated application copy. Wrap its observed resource read with a receipt and cover the final model message list at the provider adapter. If an unobserved processor adds bytes, that entire private output is owner-only. A transferable writer has no such processor.

New stored replayable source/assistant parts carry receipt IDs. Reauthorization precedes replay; deny/omit a whole affected assistant or source part after a known source revocation rather than attempting semantic redaction. Private conversation display/loading applies the same check to protected source-derived parts. Direct human events remain. Legacy assistant/tool parts are unresolved and cannot be used by writing; recoverable known legacy dependencies are also checked for private replay. Unrecoverable memory origins remain an explicit private-only limitation, not an assertion that hidden revoked sources can be detected. Updates to model-maintained memory/learned cards retain known guards and unresolved status, including previously unresolved memory incorporated into the new card.

Approval UI is separate. Persist `approvalId`, capability and enum state in chat parts; derive constant model status from those fields. Full preview stays in the proposal table and authorized review endpoint. Ignore **all** old `data-approval.summary` strings during prompt replay, even cancelled/failed summaries; preserve their stored records. Generic `data-tool`, citation and research display parts do not get raw-string replay privileges: reload their envelope or classify them private-unresolved with known guards. Error state replay uses codes, never arbitrary `result` text. This repairs B5/C1 rather than assuming approval-required exceptions pass the normal successful-result recorder.

### Version policy and authorization work

New policy is flattened at the moment a source version is observed. A page source contributes:

- An observation of the exact page version/title/content or admitted excerpt and immutable policy digest.
- Its **base current-resource** access guard: case membership, location and protected ancestor ACLs.
- The already flattened guards/disposition from the observed version.
- Guards for its observed case and every then-protected ancestor. These survive a later move out of that location.

The page guard checks current page existence, case/office consistency and present folder access. It does **not** read that page's current `VersionPolicy` recursively. The old observed version's immutable policy supplies its historical upstream obligations. Current source ACL revocation therefore remains effective, while an unrelated later change to a source page cannot invent new provenance for bytes observed earlier. Retained observed-folder guards protect against moving a source or derivative out of another person's restricted folder. Changing that source folder's access legitimately changes the guard's current entitlement; deleting a retained source/guard denies, not an unrestricted tombstone. Historical content and policy pins are retained for lineage; a missing/corrupt pin is unresolved/denied, never resolved by reading today's bytes.

For a private artifact copied by its owner, the artifact's own ownership predicate is the copy authorization, not an upstream owner fence automatically added to a shareable direct contribution. Its actual known upstream guards are retained. Otherwise every publication of a directly authored private artifact would be owner-only by construction. Automatic reading of a private Vault resource still adds its current resource guard. A person may explicitly contribute their own directly submitted root upload/draft at exact review, using its submission evidence; this can release that root's owner access requirement, but cannot release inherited guards, an unknown model origin, another person's resource or app-inserted text. This release is represented as that contribution's exact reviewed destination, not a global policy flag.

Policies contain at most 512 unique guards and 512 direct observations per derived version, plus at most the existing prompt/file budgets. Deduplication uses canonical resource keys. Reading/listing evaluates each unique guard once per request and batches same-kind queries; request memoization is permitted only within one authorization snapshot. No global positive-access cache. Exceeding budget fails with “Use menos fontes nesta proposta”; it never truncates restrictions. Listing/search/version/history/citation/activity surfaces filter before returning titles, counts or snippets. Storage indexes support `(content_kind, content_id, version)` and policy-to-guard resource IDs. No recursively expanding authorization DAG or eventual cache is needed.

Example: A v1 has S; B v2 observes A v1 and inherits S plus base A; A v3 observes B v2 and inherits S, base A and base B. Self base A is a normal ACL test, not a provenance recursion. A/B/A succeeds. Concurrent A v2 and B v2 each observe the other's already committed v1: their immutable observations and flattened guards can both commit. There is no acyclicity invariant to serialize, and neither becomes unreadable through a live graph cycle. Immutable generation receipts may retain derivation edges for explanation; authorization does not traverse them.

On human edit, conservatively retain the base version's guards/disposition and union any structurally included app-source policy. A human save does not cleanse a model draft, even if the submitted text resembles a replacement. Restore retains current baseline obligations and unions the chosen historical version's obligations; neither approval nor an agent changes this rule. A new independent directly authored document may start without those inputs. Automatically copying an old unknown artifact into that new document is not an independent contribution.

The same retention applies to in-place edits of model-produced settings/rules and tracked Vault copies. A direct person update may add a contribution but cannot erase the baseline unresolved origin. A newly entered independent rule or finite style choice can stand on its own ingress event; duplicating the old model rule through an application copy operation retains its policy.

### Transaction ownership and concurrency

`documents/service.ts` is the sole writer of artifact/page content, committed version policy and document proposal results. All human routes, capability executors, autosaves, restores and `document-workflows.ts` migrate to it. Private artifact identity stays `(home office, authenticated user)`, including in another owner's case scope. Shared identity resolves through `caseAccess`/`contextForCase`. Creator status never bypasses destination or source guards. Guests retain the existing narrow case capability boundary. Enforce the case Lume switch both before generation/source loading and again before an agent mutation; a human save is independent.

Use the existing `withTransaction` from `src/lib/database.ts` and its `Transaction.prepare`, which pins one PostgreSQL connection. It has no `batch`, automatic retries or isolation upgrade (`src/lib/db/postgres.ts:postgresTransaction`). Do not call `database.batch`, `recordProvenance`, `requireAndConsumeApproval` or `updateArtifact(database, ...)` inside a purported outer transaction.

1. **Capture/generate.** In a short `withTransaction`, capture authorized exact source/input snapshots and receipt under source-policy ACL read gates; commit only generation input records. Release locks before provider work. On response, bind output digest to the exact receipt and reauthorize known sources. A failed/aborted generation records an attempt outcome but modifies no existing document/provenance. For multi-call document workflows, every extraction, outline, section and review call has a receipt; intermediates inherit admitted policy. Final composition unions policies of included outputs plus deterministic render inputs. Raw serialized legacy `writingRules`/`knowledge` fields stay unresolved; new jobs store source/request handles and snapshots.
2. **Proposal.** In one short `withTransaction`, verify generated/copy/restore receipt, exact source/destination, base version and current guards; insert `capability_approval` and a frozen document proposal containing exact title/content, policy, source pins, audience rule/people shown, destination ACL fingerprint, byte digest and expected versions. Existing `createApprovalProposal` needs a transaction-reader overload/private insert helper. Do not separately insert an approval and then `case_page_approval`. An immutable proposal is not committed artifact policy.
3. **Confirm.** `withTransaction(async tx => ...)`: lock the actor-owned approval `FOR UPDATE`; verify capability/canonical operation and immutable proposal digest; if consumed, load its exact result receipt and reauthorize that historical result. Otherwise require pending/approved, unexpired and actor-bound confirmation; acquire ACL read gates; recheck session, target role, current destination/source access and destination audience fingerprint; lock target content row `FOR UPDATE`; check expected version; apply/validate edits; insert new policy and version binding; update target with `WHERE version=?`; insert version history; mark approval consumed and save exact result identity/version/digest and chat outcome. All succeed or all roll back. Confirmation can transition pending directly to consumed in this transaction; if the existing separate approve endpoint sets approved first, it remains approved/retryable after rollback. Route document approvals directly here instead of preconsuming in the generic approval helper.
4. **Ordinary human/own-agent private write.** The same transaction kernel without a required proposal where current product rules do not require one. A person event is recorded with the successful write. Existing own-conversation agent refinement remains ungated, but its current private-call receipt is mandatory and cannot broaden prior policy. Unapproved changes to somebody's person-authored draft remain a proposal.
5. **Copies/delivery.** Prepare object-storage bytes outside the DB transaction from pinned authorized content/template. The final destination transaction rechecks digest, pins, current authorization and receipt, inserts destination row/version/policy together. A temporary object is unreachable until that commit and is cleaned up after failure. Deduplication identity includes source version, render/template version/digest, format, destination and operation input hash. A lost response reloads the committed exact receipt. External dispatch has its existing durable pending/unknown reconciliation; authorize again at the last worker dispatch boundary and attach the version policy to retained app copies. Do not pretend PostgreSQL rolls back a provider send.

Known-source authorization must also be ordered against ACL mutation. Use transaction-scoped **shared advisory gates per affected office** while validating/committing/delivering, and exclusive gates for case membership, association removal affecting cases, folder visibility/parent/delete and Vault location/ownership changes. Keys are `content-acl:<officeId>`, sorted across offices, using existing `tx.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))')`; `withAclMutation` uses the exclusive form inside `withTransaction`. All existing ACL mutation owners must adopt it before these reads are authoritative. Content edits take shared ACL gates and their own target row lock, so reciprocal A/B edits do not take exclusive locks on each other's content rows. The office gate is intentionally coarse for relatively rare ACL writes; it avoids membership phantom/write-skew without graph locks or a new authorization database. Snapshot/delivery authorization linearizes before a revocation that waits for the gate; later operations deny. External-source revocation can only be checked at the adapter boundary, with explicit fail-closed unavailability.

Cancellation locks the same approval and only changes a pending/approved decision to rejected. If confirmation already committed, cancellation returns the committed outcome; if cancellation wins, confirmation cannot mutate. Stale CAS, invalid targeted edits, audience change, revoked sources and injected failures roll back content/version/policy/consumption/result together. An immutable stale proposal is still retrievable for the entitled actor; a rebase creates a new exact proposal, never silently changes it. Duplicate confirmation returns the originally committed historical version receipt, not the page's latest text. A later revoked result returns a safe outcome status with no protected payload. Concurrent duplicate confirmations serialize on the approval row; unrelated content versions do not share mutable provenance accumulators, per separate-before-serializing-shared-state and make-operations-idempotent.

### Canonical classification and the smallest coherent set of exits

One canonical version resolver runs for every read, model admission, copy, export, retry and delivery. New epoch-2 rows need a valid digest-bound policy. An absent/malformed binding for a new generated/copied row is an integrity denial. For pre-boundary artifacts, absence of all origin indicators (`created_by_agent`, `run_id`, `conversation_id`, nonempty `source_refs`) permits the existing legacy direct-draft classification, with any known restrictions still retained. That is a narrow historical product convention, not proof of every past input. Any model indicator or inconsistent metadata yields owner-only unresolved lineage. A 0075 `complete=true` row cannot override that classification, since failed pre-CAS writes could have created it; `complete=false` and every known dependency remain conservative evidence. Do not infer trust from a provenance row existing.

An owner-only unresolved draft can be archived into the owner's Library or own genuinely private folder if the **effective destination audience is that same singleton**, the actor retains destination access and every recoverable known source guard currently allows the actor. “Creator” is not equivalent to private: check ancestors and folder membership. The copy inherits owner-only status and known obligations, so it never becomes transferable by choosing a different exit. A complete source-derived eligible draft can likewise be privately archived; source dependencies themselves are no reason to deny preservation. If a known source is revoked, archive/export of the derived bytes denies rather than manufacturing a new accessible copy.

For policy-bearing content, effective access is `current destination access ∩ version guards ∩ disposition`. At application-managed sharing boundaries:

- **Vault reads, search, counts, file versions and download:** require the exact version's policy as well as ordinary Vault ACL. Pinned versions have independent bindings. A document containing a restrictive active version cannot leak names/counts through unfiltered listing. Direct root uploads retain existing owner-controlled sharing behavior; tracked derivatives retain upstream restrictions.
- **Moves and folder visibility:** location changes never rewrite version policy. Changing a folder affects its ordinary ACL; guards/owner fences still filter each contained version. Reject a direct move of an owner-only copy to an audience broader than its singleton, rather than silently appearing as a shared empty item. Broader folder visibility need not trigger a new approval for every child; protected derivative rows remain filtered. Check current and observed source folders after moves.
- **Personal-chat pinned shares:** bind the exact `vault_document_version` policy to the share. Check the actual internal recipient at creation, claim and every read, in addition to current share/grant/source-case checks. A grant cannot replace a retained source ACL. External recipients have no authenticated source ACL; restricted/owner-only derivatives cannot be granted to them. Their invitation is not source authorization. Existing direct owner-upload shares and confirmations continue.
- **Portal artifact publication:** use the exact artifact policy and rendered-file policy, and attach it to `client_portal_file`. Client access is a different audience, so retained staff/case/folder guards or owner-only status deny publication unless that actual client has all required source entitlement through a supported existing policy. Initially no such staff-ACL bridge is assumed. Eligible direct contributions remain publishable through the existing action. Both managed and client download recheck file policy; `source_ref` is explanatory metadata, not enforcement.
- **Connector sends/replacements/shares:** validate every attached/copied file version and generated message/body through the same delivery decision at proposal and actual dispatch. Unknown or restricted output cannot be released by the existing Gmail/Drive/WhatsApp confirmation. Recipient K5 identity may establish current internal source entitlement; a raw external email/account cannot. For an externally editable Drive target, where future readers cannot be controlled or current audience proved, permit only eligible unrestricted content. Existing connector confirmations remain the user action; add policy validation, not another confirmation ceremony. A raw private-agent-generated body gets that private execution's policy. Offer bounded recomposition from the person's request and admissible inputs for a send that otherwise contains unresolved memory; never reclassify the approved model body as person-authored. This is the same input boundary for a finite set of current app delivery exits, not a general DLP scanner.
- **Templates and format/exports:** resolve selected template, otherwise default, exactly once to a Vault version/digest. Include template bytes, names and policy in `PreparedFile` and any model use. DOCX/PDF layout transformations do not erase it. `artifact-file.ts:artifactTemplate` currently returns bytes only and catches read failure; replace this with a pinned policy-bearing render input. Do not silently change a forbidden/missing expected template into no template. Offer an explicit “sem modelo” render choice with a new render receipt. Private archive/download can use an owner-private template; broader delivery then remains restricted. Include the template pin in copy idempotency.

Root source access and derivative access are deliberately different: the person authorized to contribute their own direct upload may share that root with existing product controls. They cannot use that authority to remove restrictions inherited from another protected source. A direct manual upload through a raw-file endpoint is the same submission boundary as typing/pasting; application-managed generated bytes must not use that raw endpoint internally to erase policy.

Downloads and manual copy cannot be revoked once bytes leave the application. Enforce current authorization immediately before providing bytes and never claim control afterward. Connector delivery is likewise irreversible after remote acceptance; upstream revocation stops future managed dispatch and reads, not an already sent message. For restricted content sent to external identities whose independent source entitlement cannot be proved, denial is the only supported product policy. Do not promise continuing ACL enforcement on arbitrary remote systems. Explicit person paste/re-upload from outside the app is an unavoidable trust limit, documented as submission responsibility rather than certified source completeness.

### Additive storage and conservative legacy handling

The inspected migration directory ends at `0075_case_pages.sql`. Use **0076_content_policy.sql**, checking it remains the next unused number when the sole writer starts. Migration 0075 was already applied to the disposable verification DB: do not alter or rerun it. This candidate runs no migration, including on the developer DB.

Add these bounded content records, with foreign keys/indexes and no destructive conversion:

- `content_policy`: immutable schema, disposition/owner/reason, byte digest, canonical flattened guards, observations, contribution references and policy digest.
- `content_version_policy`: unique `(kind, id, version)` binding for artifacts, pages, Vault versions and portal files; immutable policy FK/digest. Every artifact version number gets a binding even if autosave omits a history text row. Observed autosave bytes are retained in the relevant input snapshot before replacement.
- `content_submission`: authenticated direct-event origin, owner, exact bytes/digest or immutable attachment pointer, conversation/message/submission identity and authorized frozen scope. This is a bounded input record, not a universal event ledger.
- `content_generation`: exact admitted input snapshots/references, purpose/owner/model task/prompt digest, immutable output receipt and outcome. Retain only actual bounded inputs; no hidden model reasoning. Private output receipts can point to these records and known guards.
- `document_change_proposal`: FK to existing `capability_approval`, frozen operation/text/digests/policy/pins/destination/versions/audience fingerprint, original invocation (`person` or `agent` with request/turn identity), plus exact committed result receipt. Preserve existing `case_page_approval` rows and approval statuses; do not replace their input in place. Confirmation uses the stored invocation to recheck the Lume switch and guest bounds; a human clicking Confirmar does not turn an agent proposal into an ungated human write.

Existing JSON dependency/provenance columns remain for compatibility and conservative backfill; new writes stop making them authoritative. New bindings do not require emptying existing content, memory, approvals or metadata. Policy rows and source snapshots are append-only except controlled retention of unreferenced failed-generation staging; no cascade deletes of referenced source/policy pins.

Legacy page versions lack reliable per-version agent/human origin in 0075 (`case_page_version` stores user, text and dependencies). Do not backfill them as verified merely because dependencies are empty or creator is present. Compute known guards from existing dependencies with a bounded **iterative visited-once** walk; cycles are a finite union, not automatic ACL denial. Parse errors, missing nodes, inconsistent office/case and budget overflow fail closed. The walk establishes a conservative known guard floor only; it does not recover the observed historical source version or prove completeness. Thus legacy page versions with no trustworthy external origin record are quarantined from general participant content reads, onward publication and generation. Preserve rows and show a neutral unavailable/recreation affordance without title leakage. Existing reliable direct submission evidence may classify a specific version, but no such evidence is presumed in this trace.

For entitled authors, provide an explicit private recovery copy **only after** normal current page/case/folder and every known source guard authorize that author. That copy is owner-only unresolved and never opens a creator bypass. If those checks fail, it stays unavailable. This is a preservation path, not legacy certification. Prefer regeneration from the person's newly typed request and newly authorized original sources into a new page; do not give the old unknown text to the writer. For a legacy artifact, the original private artifact and a permitted private archive remain available under owner/known-source policy. A human can create a fresh independent document; copying/approving/editing the legacy model output inside the app remains unresolved. No “confirm all sources” checkbox and no clean-chat workaround.

Legacy pending/approved proposals remain stored. They can finish only if their exact bytes can acquire a defensible epoch-2 classification and current policy without claiming recovered unknown inputs. Otherwise report that sources must be selected again and create a fresh proposal, preserving the old outcome/data. Consumed proposals keep their original result identity; if exact-version policy is unresolved or currently denied, retry returns status only. Backfill must be resumable and conflict-safe against new writes: insert absent bindings for observed unchanged versions, never overwrite an existing epoch-2 binding or mutable content.

### Compact module map and removals

All source anchors are relative to `apps/web/`; line numbers are those in the supplied traces and may move with the sole editor writer.

| Owner/module | Implement or adapt | Replace/delete |
| --- | --- | --- |
| `src/lib/content-policy.ts` | Canonical classification, exact source loading/receipts, flattened policy, bounded generation serialization, render policy and delivery/ACL gates; internals unexported | `case-pages/provenance.ts:sourceAccess` recursion, permanent `recordProvenance` union and `recordToolProvenance` name switches |
| `src/lib/documents/service.ts` | One ownership-aware version/approval transaction kernel; human save, private write, page proposal/confirm/restore/archive | Pre-content `artifacts-service.ts:preserveProvenance`; direct `ai-store.ts:updateArtifact`/route writes; independent workflow artifact inserts |
| Existing chat/capability adapters | Direct ingress + stored send scope, typed exposure in registry, request-only page generation tools, receipt-aware history and status-only approvals | `chat-turn.ts:162–175` conversation-wide completeness veto; raw `chat-prompt.ts:46` approval summary replay; `GUARDED_TOOLS` independent list; raw title/excerpt interpolation in `lume-workspace.tsx:ask` |
| Existing Vault, share, portal, render and connector owners | Call policy boundary at actual exact-version reads/copy transactions/dispatch; retain policy in new versions/files; ACL mutation gates | `vault-service.ts:saveArtifactToVault` raw `readProvenance` special case; origin-only copies; template bytes-only/failure-swallowing exports |

The policy module hides source format, legacy rules, flattening, current ACL evaluation and model serialization. The document module hides transactions, ownership, CAS and exact approval recovery. Existing HTTP/tool adapters parse transport input and select the domain operation; they do not orchestrate load/check/policy/save themselves. Existing services may retain compatibility adapters while callers migrate, but there is one implementation per operation and old direct writers/exports are removed before acceptance. Add import restrictions for old write helpers and an architecture check for production document writers; do not leave a new “safe” API next to a usable untracked writer. No changes to editor draft generations, restore-response handling or navigation invalidation belong to this candidate.

### Evidence and disposition of the independent findings

No review finding is dismissed. The fresh trace explains why each is addressed at a boundary rather than by a name/Boolean exception:

- **A1/B1/C3:** `chat-turn.ts:167`, `service.ts:agentSources` and `agent-memory.ts:49` reintroduce private memory on every turn. Selected writing has no memory/history processor and derives intent from `content_submission`; private chat retains those features.
- **A2/B4/C4/C5:** `vault-service.ts:402` calls raw `readProvenance` before choosing the destination; `copyIntoVault` retains only `vault_agent_origin`. Canonical classification + destination intersection + pinned copied-version policy closes both laundering and private-archive rejection.
- **A3/B3/C2:** `artifacts-service.ts:saveArtifact/editArtifact` calls `preserveProvenance` before approval/CAS/edit validation. Only the successful version transaction binds new policy, and canonical legacy classification precedes merging.
- **B5/C1:** `agent-approvals.ts:describeAgentApproval` returns full `approvalPreview` after an approval-required exception, outside successful `runCapability` provenance recording; `chat-prompt.ts` replays it. Review-only snapshots and status-only replay remove that input altogether. Normal source-aware admission is required if preview text is later requested.
- **C6:** `lume-workspace.tsx:ask` inserts title/selection into the typed message, while `chat-turn.ts:185` guards only structured selection. Instruction-only ingress and server-resolved selection give that source one path.
- **A4/B2/C7/C8:** `sourceAccess` traverses current page dependencies with a path-local set, and `postgresTransaction` uses plain `BEGIN`; concurrent targets lock different page rows. Immutable flattened observed-version policy removes the live graph invariant and repeated traversal. ACL gates address access mutation separately.
- **A5/B6:** editor lifecycle findings remain valid and assigned to the separate writer. This candidate does not attempt to repair their draft/restore/invalidation state machines.
- **Additional traced exits:** `document-workflows.ts:223–225` still inserts untracked artifacts; `artifact-file.ts:artifactTemplate`, `client-portal/service.ts:publishPortalArtifact`, `personal-chat/shares.ts:createShare/readDocumentShare` and `google/gmail/service.ts` confirm that generated content/template bytes leave through policies independent of page publication. They must adopt the selected content-version boundary in the same source-policy implementation, rather than being claimed safe by existing origin IDs.

### Required regressions and acceptance evidence

These are required implementation tests, **not tests run by this design runner**. Successful hand-seeded `complete=true` calls are insufficient.

1. **Real ingress/provider boundary:** populate working memory, learned-memory return, legacy rules and an assistant history with different sentinel strings; submit a real typed page request through the route/scope path. Capture the writer provider adapter's actual serialized text/multimodal request. Assert only the direct request, admitted selected-source bytes, eligible style and constants occur; sentinels, private plan/tool args, focus duplicates, approval summary, titles from omitted sources, native-search results and provider session history do not. Assert no memory/tool processor is configured. The personalized private provider request must still contain its permissible private memory. Simulate a malicious planner supplying prose/encoded IDs; it cannot change admitted input. Do not test only the prompt-builder return value.
2. **Authorship admission:** direct typed request, person setting, upload/extraction and explicit upload-to-destination contributions work. App-inserted excerpt/title, selected unsaved editor text, transcription, connector import, agent-created approved rule, learned memory and model summary retain their actual policy. Proof cannot be manufactured by an approval or `role:user`. Withheld selection/title sentinels are absent from both immediate prompt and future replay.
3. **Per-send/regeneration:** navigate between send and generation; repeat/regenerate against the stored original request/scope and pinned source inputs, while applying current authorization. Never substitute the current canvas or today's source text. If an original input is unavailable, fail/omit according to explicit versus implicit-source rules. Tests cover guests and the case Lume switch at admission and confirmation.
4. **Preview isolation:** direct artifact publication/restore proposal whose only source access is through preview, then cancellation/failure/revocation. No summary text enters any later provider request. Authorized review retains exact bytes; denied review exposes no title/content. Legacy `data-approval` parts are also excluded. If separately admitted preview text is used, its version policy is inherited.
5. **PostgreSQL atomicity:** clean human draft and untracked legacy artifact; unapproved, cancelled, stale-version and invalid targeted edits leave every content/version/policy binding unchanged. Inject failure after content update, history insert, policy insert and approval-result write; all roll back. Approval remains retryable when appropriate. Prove a stale edit cannot certify a legacy model artifact.
6. **PostgreSQL concurrent decisions:** two real connections/barriers confirm the same proposal, confirm versus cancel, and two writers on the same target. Exactly one result version/consumption wins, duplicates recover exact result, conflicts preserve unchanged baseline. Lose the response after commit; replay is not another write. Advance the page afterward; duplicate confirmation still returns the historical receipt, subject to current authorization.
7. **Version/source behavior:** real admission creates A, B, A through one personalized conversation; all valid edits succeed. Concurrent reciprocal source observations pin old versions and remain readable. Dense DAG-like use authorizes each unique guard once with a measured call budget. Missing/malformed pins deny. Changing source content does not change the obligations of observed bytes; revoking current membership/ancestor permissions denies versions, listings, snippets, agent reads, exports and copies, including for creators.
8. **ACL transaction ordering:** two PostgreSQL connections coordinate source revocation and confirmation/copy/claim, also adding a participant or changing destination folder audience. ACL writer uses the exclusive office gate; content authorization uses shared gates. Assert linearizable before/after behavior and re-review on destination fingerprint changes. Test association removal across multiple offices in deterministic lock order, without unrelated content-write deadlocks.
9. **Archive and downstream exits:** direct-human, traceable restricted and unresolved/legacy drafts can archive into their permitted singleton Library/private folder; known revocation denies. Public archive/move, folder widening, inactive/pinned Vault versions, personal-chat grants and external claims cannot broaden inherited policy. Portal publication/download and connector worker dispatch apply the same classification. Direct person-authored uploads and publications retain normal workflows and existing connector confirmations; no new blanket approval appears.
10. **Render/background workflows:** selected/default template policies and bytes are pinned; template mutation/revocation after proposal is handled deliberately; explicit no-template choice is a new receipt. Idempotence includes template digest. New background chronology/draft outputs carry final policies from actual extraction/outline/section inputs, including generated settings and research permissions, with one atomic artifact/version binding. Provider failure or process loss does not create an untracked artifact.
11. **Migration/legacy:** apply 0075 then the additive next migration to a disposable real fixture populated with human/model artifacts, legacy cyclic/missing page dependencies and pending/consumed approvals. Content/metadata remain; trustworthy bindings survive resumed backfill; unknowns are not made eligible by old `complete=true`. Test privately entitled recovery, denied creator recovery, and regeneration from new sources without the old unknown bytes.

Provider stubs at the real configured adapter boundary prove which application bytes and options were admitted and exercise deterministic failure paths. They do not prove live model quality, injection resistance, citation correctness or lack of a provider's undisclosed retention. A bounded live-model smoke test can demonstrate a reviewable useful page with personalization present in private chat; it is supplementary and cannot certify ACL completeness. Root checks/e2e are the sole implementer's later responsibility. This runner ran none.

### Design red-flags audit

- **Shallow module/pass-through:** source policy owns canonical classification, snapshots, flattening, authorization, serialization and delivery. Document service owns an entire version/approval transition. Callers do not coordinate policy setters, CAS and consumption. Compatibility HTTP/tool adapters add transport/invocation adaptation only.
- **Information leakage:** transport DTOs, provenance JSON and provider prompts are internal. Public callers pass intent/version/destination identities, not Boolean completeness or raw policy. Render inputs are pinned behind `PreparedFile`.
- **Temporal decomposition:** capture and commit are separate transactions because provider/storage work cannot hold DB locks, but share one domain owner and immutable receipts; there are no independent public load/validate/taint/save services.
- **Split ownership/two ways:** page, private artifact, background writer and approved writes share one transaction kernel. Remove direct artifact mutation exports and all untracked workflow writes. Copy/sink owners cannot construct a transferable policy themselves.
- **Importable internals:** policy constructors/SQL row readers remain unexported in their owning files; brands are backed by owner/digest checks. Restrict imports of obsolete writer helpers, not just document the preferred route.
- **Hand-synced lists:** capabilities/exposure are defined together in the existing registry; tools derive from it. Writer has zero tools. Delete provenance/injection capability-name lists instead of extending them indefinitely.

## Synthesis decision

Reserved for the parent. This candidate recommends Shape B as the base: provenance begins at actual bounded generation admission and travels with exact content versions; known access is a flat current-policy intersection. Use per-call source-aware private receipts for replay and conservative private-output classification, without making the private conversation the source of sharing eligibility. No other candidate was read and no parent grading rubric was consulted.

## Tradeoffs accepted

- We accept another real model call for shared writing in exchange for independence from unrecoverable private memory/history. Users retain the same conversation and see a normal proposal; latency/cost is observable and must use existing usage accounting.
- We accept that learned factual personalization and unattested legacy freeform style do not influence shared writing in exchange for not labeling model memory safe. Known direct preferences and explicit finite style choices can influence it; private assistance remains personalized.
- We accept conservative policy retention through human edits/restores in exchange for avoiding semantic declassification guesses. Recovery uses new independently submitted intent/sources and a new document, not an approval checkbox.
- We accept restricted derivatives being visible to fewer people than the destination case permits in exchange for keeping source revocation effective. Exact review explains that effective audience; original private artifacts remain private.
- We accept additive policy/input storage and coarse office-level ACL mutation gates in exchange for version-pinned finite work and an implementable ordering contract. Routine content edits remain concurrent.
- We accept quarantine of unverifiable legacy shared versions and denial of unverifiable external redistribution in exchange for preserving content without certifying unknown origins. Private preservation is still available when current known permissions allow it.
- We accept the explicit manual submission/download trust limit in exchange for a bounded application policy rather than a promise to control arbitrary bytes outside the app.

## Alternatives considered

- **Shape A, unified source-aware execution:** it hides provenance propagation from callers, but exposes every loader/processor/history record as a prerequisite for normally personalized sharing. Existing unknown memory forces a source exclusion/rebuild or bounded retry, so it loses as the shared-writing contract. Its private replay/output-receipt mechanics remain useful.
- **Review private-model prose as a contribution:** it offers a small interface but hides no enforceable source boundary; a reviewed title/prompt can encode protected facts and unknown memory. Human approval proves intent to execute, not source entitlement. Rejected.
- **Live page graph with memoization/serialized mutations:** it reduces repeated work or prevents some cycles but still assigns today's unrelated source dependencies to yesterday's observed bytes and couples A/B/A to conversation accumulation. It addresses graph mechanics rather than trusted-input establishment; rejected as the selected authorization representation.

## Open questions and risks

- Can the configured providers or `taskSession` resume remote context despite a fresh tool-free request? Until verified at each supported adapter, document generation forbids continuation identifiers and sharing eligibility requires evidence that its request is self-contained; adapter options are included in the provider-boundary test.
- Does any existing durable record prove direct human ingress for a particular legacy page/rule version? The inspected schema does not; default to quarantine/unattested style and permit only evidence-specific backfill, not actor-ID inference.
- Can external research/connector adapters prove AI use and redistribution entitlement for actual intended recipients, with revocation checks? Default to owner-only/unavailable redistribution where they cannot. Do not block source-policy implementation waiting for a broader connector entitlement project.
- Will current ACL mutation owners all adopt the office gate in the same implementation, including association removals and worker paths? Acceptance requires a writer inventory and concurrency test; a partially adopted locking convention cannot be claimed to close revocation races.
- How much input retention is needed for legal review and operational storage limits? Store bounded admitted snapshots/receipts referenced by surviving versions and proposals; choose routine unreferenced-attempt cleanup without deleting policy evidence needed for current content. No universal event ledger is introduced.

## Next implementation step

Build the additive canonical version-policy resolver and one bounded-generation/provider-boundary regression using real user submission, existing private memory and an authorized case page, then wire its opaque output into the shared artifact/page transaction kernel before replacing copy and delivery paths.

---

Design runner scope: required grounding artifacts and targeted production paths read only; no git, tests, servers, browser, migrations, dependency changes, secret reads or production edits. Only this assigned design file is written. Parent owns synthesis and the sole implementation writer owns verification.
