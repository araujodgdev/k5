# Source-policy candidate 2

## Usage (caller's view)

Lume prepares a shared proposal from the authenticated person's submitted request and authorized sources, then displays the exact proposal in the existing conversation. The personalized private agent can request that operation, but cannot supply its generated prose as the shared writer's instructions or replacement content. The same content service commits person and agent changes. The owner can archive a private draft without authorizing a wider audience.

These are server-side domain calls, after `requireWorkspace()` and HTTP parsing. `sendId` identifies an immutable, server-stored human submission; it is not a model-authored instruction. Neither a browser nor a tool supplies lineage, completeness, actor identity, or approval state.

```ts
// 1. The existing private chat asks for a proposal in its frozen case/page scope.
// The tool has no title, content, summary, writing instructions, or source-text argument.
import { prepareCasePage } from '@/lib/content-generation';
const proposal = await prepareCasePage(context, { sendId: context.sendId });
// Human UI obtains exact title/content/destination through readProposal().
// Model gets { proposalId, state: 'awaiting-review' }, with application-written wording.

// 2. The editor and approval endpoint use the same version/authorization writer.
import { saveDocument, readProposal } from '@/lib/document-content';
await saveDocument(context, {
  kind: 'person-edit', document: { kind: 'case-page', caseId, id: pageId },
  expectedVersion: 7, submissionId: editorSubmission.id,
});
await readProposal(context, proposal.id); // exact human preview, current access checked
const result = await saveDocument(context, {
  kind: 'confirm-proposal', proposalId: proposal.id,
}); // exact version result; duplicate confirmation returns the same receipt

// 3. Save a particular private version into the owner's Library.
import { archiveArtifact } from '@/lib/document-content';
const archived = await archiveArtifact(context, {
  artifact: { id: artifactId, version: 3 },
  destination: { kind: 'library' }, format: 'docx', requestId,
});
// Content, template, file digest, source obligations and owner-only fence travel together.
// Messages/portal/connectors later obtain a delivery from the same content boundary.
```

For “corrija esta página e deixe mais breve”, `workspace.ask` sends the person's instruction separately from `{document, version, selectionRange}`. The server reloads the exact source version and selection. It never puts a shared title/excerpt into ordinary person-authored text. Display labels remain in the UI. For “crie uma cronologia neste caso usando estes arquivos”, the captured send includes the selected case/folder and references; the shared writer receives that original instruction and the authorized file versions. A normal conversation may already contain working memory, Honcho context, Gmail results and cancelled approvals: none prevents these operations, and none silently supplies shared content.

## Problem

The accepted architecture keeps `ai_artifact` private to its owner/home office and `case_page`/`case_page_version` case-owned. It also requires exact reviewed copying, current case/folder access for every reader, durable source restrictions, frozen per-send scope and existing Mastra/AI SDK execution. The failed source subdesign confuses three things: what the person explicitly contributed, what bytes a model actually consumed, and which current permissions a derived version must continue to honor. Its permanent conversation Boolean blocks normal work; its pre-write provenance commits alter unchanged artifacts; its current-page recursion creates A/B/A failures and concurrent cycles; copies and approval-history text bypass it. This candidate replaces that bounded subsystem, preserving the ownership, shell and editor contracts. Editor restore/draft/revocation lifecycle repairs remain with the separate writer.

## Shape

### Two whole-system shapes

Both shapes use immutable version policies and protected copy exits below. They differ at the trust boundary, rather than in locking or naming.

**Shape A: one instrumented conversation, with lineage at every producer.** Every instruction loader, stored message part, tool result, memory update and attachment transformation produces `InputEnvelope`. Private generation uses their union. A shared call selects eligible envelopes from the same personalized conversation; it does not accept a model-produced summary of ineligible envelopes. Model-generated messages and memory inherit their generating call's manifest. Historical unknown memory remains private-only; new direct preference records can be reusable without that fence. Source-aware memory can be an indexed collection of separately derived entries instead of opaque Markdown.

```ts
type InputEnvelope =
  | { kind: 'contribution'; submission: SubmissionId; bytes: ByteSlice }
  | { kind: 'source'; observed: SourceObservation; bytes: ByteSlice }
  | { kind: 'derived'; generation: GenerationId; bytes: ByteSlice }
  | { kind: 'unknown'; owner: Owner; reason: UnknownReason; bytes: ByteSlice };

// This shape's consumer explicitly chooses an eligible projection of the conversation.
const stream = await conversationInputs.load(context, { conversationId, throughSend });
const answer = await conversationGenerator.generate(context, {
  stream, destination: { kind: 'case-page', caseId, folderId },
});
// Internally: split eligible entries, reauthorize sources, include only eligible history,
// replace opaque memory with separately tracked entries, seal all provider inputs.
// Without enough eligible intent, ask for a direct instruction instead of a summary.
```

This is viable only if the actual private model generating shared text never sees excluded envelopes. A model previously exposed to private envelopes cannot be asked to promise it will ignore them; rebuilding its eligible context is mandatory. Source-aware memory and history can preserve richer shared personalization, but introduce a broad change to every memory/history producer and processor. Its public interface looks small while its eligibility semantics leak into many producers. Existing opaque Mastra/Honcho and legacy transcripts cannot be retroactively certified.

**Shape B, recommended: a task-scoped generator established at authenticated ingress.** A server-captured send establishes explicit human contributions, destination, reference identities and any linked earlier shared task. A stateless shared-generation call constructs its own input bundle from these records and authoritative loaders. It takes no private planner prose, private agent title/content arguments, opaque memories, or private assistant history. A model executing inside this bundle may search/read through source-aware registry capabilities; those observations extend only this generation's manifest. The ordinary private conversation remains personalized and persistent. Results and human approval appear in that same conversation.

```ts
const proposal = await prepareCasePage(context, { sendId });
// Internally: resolve the ingress record; load bounded task history and exact references;
// run the existing assigned provider with no private memory/provider continuation;
// admit each tool result before it reaches that call; seal inputs and propose exact output.
```

Shape B wins because eligibility is decided where inputs enter one bounded generation, rather than by reconstructing complete historical model memory. It does not replace the agent runtime or create a visible clean conversation. A second provider call has a separate generation/session identity and no `previousResponseId`, provider continuation, or Mastra memory processor from private chat. Private chat can choose to invoke this operation; only the captured send supplies its natural-language intent. Already-authorized explicit copy/restore operations do not need another generation call.

### Data structures and public interface

Below is the production-oriented type sketch. Branded values are produced only inside their owning server module. DTOs and JSON columns are parsed behind the interface; no exported function accepts a supplied `VersionPolicy` or `GenerationManifest`.

```ts
type DocumentRef =
  | { kind: 'artifact'; id: string }
  | { kind: 'case-page'; caseId: string; id: string };
type ContentVersion =
  | { kind: 'artifact'; id: string; version: number }
  | { kind: 'case-page'; caseId: string; id: string; version: number }
  | { kind: 'vault'; id: string; versionId: string }
  | { kind: 'portal-file'; id: string }
  | { kind: 'instruction'; id: string; version: number }
  | { kind: 'generation-output'; id: string }; // immutable sealed payload, private staging
type PageTarget = { caseId: string; folderId: string | null };
type VaultDestination = { kind: 'library' }
  | { kind: 'case-folder'; caseId: string; folderId: string | null };
type ArchiveRequest = {
  artifact: { id: string; version: number }; destination: VaultDestination;
  format: 'pdf' | 'docx'; requestId: string;
};
type OutboundTarget =
  | { kind: 'gmail'; connectionId: string; threadId: string | null; recipients: readonly EmailAddress[] }
  | { kind: 'drive'; connectionId: string; fileId: string }
  | { kind: 'whatsapp'; conversationId: string };
type DeliveryDestination =
  | { kind: 'download' }
  | { kind: 'vault'; target: VaultDestination }
  | { kind: 'message-share'; threadId: string; recipientId: string }
  | { kind: 'portal'; clientId: string; accessId: string }
  | OutboundTarget;
type DeliveryRequest = {
  source: ContentVersion; destination: DeliveryDestination; requestId: string;
  format: 'original' | 'text' | 'pdf' | 'docx';
  template: { kind: 'document-default' } | { kind: 'selected'; documentId: string }
    | { kind: 'plain' };
};
type PreparedDocumentChange =
  | { kind: 'create-page'; target: PageTarget; title: string; content: string }
  | { kind: 'edit'; document: DocumentRef; expectedVersion: number; title: string; content: string }
  | { kind: 'copy-artifact'; source: ContentVersion; target: PageTarget; title: string; content: string }
  | { kind: 'restore'; document: DocumentRef; expectedVersion: number; historical: ContentVersion };

// Internal only: an observed resource is not necessarily a continuing ACL obligation.
type SourceObservation = {
  resource: SourceIdentity; contentVersion: string; contentDigest: string;
  admittedDigest: string; // exact text/range/labels/image/file bytes used
  policyAtObservation: PolicySnapshot; // resource scope and observed ancestor IDs
  upstreamPolicy: PolicyId; // immutable policy of the observed version
};
type AccessObligation =
  | { kind: 'case-current'; caseId: string }
  | { kind: 'folder-current'; folderId: string; caseId: string }
  | { kind: 'document-current'; documentId: string }
  | { kind: 'page-current'; pageId: string; caseId: string }
  | { kind: 'research-current'; materialId: string; policyId: string }
  | { kind: 'connector-current'; accountId: string; sourceId: string };
// These checks authorize base resource ACLs, NEVER another version's lineage recursively.
type VersionPolicy = {
  id: PolicyId;
  fence:
    | { kind: 'eligible' }
    | { kind: 'owner-only'; owner: Owner; reasons: UnknownReason[] }
    | { kind: 'legacy-audience'; principalIds: readonly string[]; reason: 'legacy-unpinned' };
  obligations: readonly AccessObligation[]; // sorted, deduplicated flattened closure
  observations: readonly ObservationId[]; // immutable evidence, not read-time graph edges
  contributions: readonly SubmissionId[];
};
type HumanSubmission = {
  id: SubmissionId; owner: Owner; origin: 'typed' | 'upload' | 'voice' | 'editor' | 'settings';
  payloadDigest: string; payload: StoredPayload;
  bindings: readonly SourceSelection[]; // app-inserted source material is separate
  target: AuthorizedScope; parentSharedTask: SharedTaskId | null;
};
type GenerationManifest = {
  id: GenerationId; owner: Owner; mode: 'private' | 'shared';
  runId: string; step: number; parentGenerationId: GenerationId | null;
  inputParts: readonly AdmittedPart[]; inputDigest: string; policyId: PolicyId;
  providerTask: string; modelPlanDigest: string; outputDigest: string | null;
};
type AdmittedPart = {
  kind: 'application' | 'contribution' | 'source' | 'derived' | 'unknown-private';
  payloadDigest: string; observationId?: ObservationId; submissionId?: SubmissionId;
  policyId?: PolicyId; representation: 'text' | 'image' | 'file' | 'tool-schema';
};
type Proposal = {
  id: ProposalId; operation: PreparedDocumentChange; policyId: PolicyId;
  generationId: GenerationId | null; payloadDigest: string; destinationDigest: string;
  sourceVersion: ContentVersion | null; expectedVersion: number | null;
};
type WriteReceipt = {
  document: DocumentRef; version: number; title: string;
  proposalId: ProposalId | null; contentDigest: string;
};

// content-generation.ts: only the authenticated ingress reference crosses this boundary.
function prepareCasePage(ctx: WorkspaceContext, request: { sendId: string }): Promise<ProposalHandle>;
function prepareOutboundContent(ctx: WorkspaceContext, request: {
  sendId: string; destination: OutboundTarget;
}): Promise<DeliveryProposalHandle>; // bound to the existing connector confirmation

// document-content.ts: sole owner of content/version/lineage/proposal commits.
function readDocument(ctx: WorkspaceContext, ref: DocumentRef, version?: number): Promise<DocumentView>;
function saveDocument(ctx: WorkspaceContext, command:
  | { kind: 'person-create'; target: PageTarget; submissionId: string }
  | { kind: 'person-edit'; document: DocumentRef; expectedVersion: number; submissionId: string }
  | { kind: 'private-agent-write'; preparedWriteId: string }
  | { kind: 'restore'; document: DocumentRef; expectedVersion: number; restoreVersion: number }
  | { kind: 'confirm-proposal'; proposalId: string }
): Promise<WriteReceipt>;
function proposePublication(ctx: WorkspaceContext, request: {
  artifact: { id: string; version: number }; target: PageTarget;
}): Promise<ProposalHandle>;
function readProposal(ctx: WorkspaceContext, proposalId: string): Promise<ExactPreview>;
function archiveArtifact(ctx: WorkspaceContext, request: ArchiveRequest): Promise<ArchiveReceipt>;

// Distinct file operation: exact rendering and the existing destination's execution.
// This is the only path that gives application-managed copies/sends policy-bearing bytes.
function prepareDelivery(ctx: WorkspaceContext, request: DeliveryRequest): Promise<PreparedDelivery>;
function commitDelivery(ctx: WorkspaceContext, deliveryId: string): Promise<DeliveryReceipt>;
// Bodies: throw new Error('not implemented'). Transaction pseudocode follows below.
```

`SourceIdentity` includes Vault/version/chunk, case/page/version, rule/version, attachment/digest, research/material-version, URL/response-digest, connector/account/source/revision, and exported template/version. A source observation is evidence of what was read. A current-ACL obligation says who may still consume its derivatives. A directly contributed attachment or private human draft can be explicitly contributed to the captured destination without forcing recipients to access its private container; its known upstream obligations remain. Merely owning an opaque model output confers no such release. This distinction is necessary for the accepted private-original/shared-copy contract.

### Ingress and actual shared inputs

`/api/chat` stores `HumanSubmission` alongside the existing user message and immutable scope, before execution. Its typed field comes from the explicit composer/editor/settings submission, not from flattened UIMessage text assembled by the application. The server supplies origin; a client cannot submit `origin: 'human'` or declare arbitrary text complete. Model-invoked settings and content operations use their generation receipt, even if a human confirms them. User confirmation authorizes a write; it does not turn its bytes into a person-authored contribution.

The server takes references from the submitted selection/scope and direct resource chips. A selected range carries page/version/range or a validated selection digest; stale or unresolvable ranges require reselection. `workspace.ask`'s display title/excerpt is never duplicated in the typed field. Titles, folder names and focus labels loaded for the model are source parts, with their own source policy and injection treatment. A display-only label is not later scraped into the model prompt.

The private agent's shared-writing capability accepts no title/content or free-form plan. The authenticated context supplies `sendId`; model-requested IDs are validated against this send, its authorized target, or choices produced inside the bounded call. A missing target uses the existing resource-selection UI; it does not trigger a model-authored natural-language instruction handoff. A plain typed case name can be resolved by the bounded call's authorized discovery tool. Resolved titles/IDs enter through source loading. Tool schemas for shared generation are derived from the capability registry's required source-admission contract and existing guest publication/scope policy.

Concretely, add `k5_case_pages_prepare` to the agent surface and remove raw `k5_case_pages_create/update` title/content schemas from that surface. Person HTTP create/update remain editor-submission operations. Agent publication/restore remain exact resource/version operations, never a text handoff. The registry supports different typed transport projections for these existing surfaces, with one domain writer underneath. A bounded guest call still cannot load general CRM/agenda, another case, or home-office knowledge absent an already permitted explicit submission path; `sharedGeneration: 'read'` never overrides the existing guest policy.

The captured scope is an identity snapshot, not a lasting access grant. Regeneration resolves the original `sendId` and its original reference/range/version identities with current authorization. It cannot substitute the current canvas. A changed edit target fails the original CAS and requires a refreshed, newly reviewed proposal. A retry of one generation attempt uses a unique `(send_id, attempt_id, operation)` reservation and recovers its staged/finished proposal; a deliberate regeneration receives a new server-owned attempt ID. Cancellation before proposal persistence leaves no content change. The bounded call's run is a child stage of the existing chat lease/cancellation, not a fourth concurrently admitted user turn.

The bounded shared call admits precisely:

1. Versioned application-authored system instructions, tool schemas, pt-BR defaults, task/model configuration constants and clock. User-written task/settings descriptions are not application constants.
2. This direct human submission, its bound uploads/voice bytes or deterministic extraction/transcription lineage, and prior direct submissions explicitly linked to this shared task. “As above” may use a prior eligible shared proposal/version, reauthorized as a derived source. It cannot pull private conversation summaries. Missing intent returns a targeted clarification in the same conversation.
3. The exact focused page version for an edit, selected range, selected source versions, and labels loaded through source adapters. Each source receives current-access checks, immutable observation and its observed version's flattened policy.
4. Eligible direct-person writing rules/style settings with recorded submission lineage; generated rules with an eligible manifest and source obligations; configured knowledge whose document version and usage-note lineage can be loaded. Legacy or opaque generated rule prose is excluded from this call. A knowledge record's selected document remains usable even if its old model-authored usage note is unknown: load the document under ACL and omit the note. Search-only listings carry policies for their names/labels rather than poisoning a conversation.
5. Subsequent bounded-tool results admitted in the same generation, including authorized discovery metadata. Public web results require a captured response identity/digest and public policy; research retains its established redistribution/AI eligibility checks. Connector material keeps current account/source restrictions and is private-only unless that adapter can prove an eligible recipient policy. A list of source URLs alone never proves completeness.

Working memory, learned memory, private assistant messages, private tool results, full approval summaries and private model-produced settings are deliberately absent. The private chat continues to use them, subject to its private admission rule below. Existing “prefiro respostas curtas” in opaque memory is not parsed or proclaimed safe: shared writing uses direct eligible settings, the current request's style instruction, or normal defaults. The person can optionally select `breve/formal/...` as a direct style choice. This is a scoped loss of inferred personalization in shared output, not deletion or global disabling of preferences. Stored personalization still shapes private answers and navigation assistance.

This boundary admits human-submitted material as an explicit contribution to this task. It proves who submitted which bytes and destination, not original authorship or permission over arbitrary pasted/uploaded third-party bytes. Application-known source bindings and copies must retain their obligations even when displayed in a user role. Arbitrary manual paste, downloaded/reuploaded files without a known origin, and old memory ancestry cannot be recovered. The product does not claim to solve those cases by prompting, injection classification, source_refs, citation results, or a model promise.

### Provider admission and private chat

Use the existing assigned provider/model, cancellation, concurrency lease, usage accounting and AI SDK/Mastra execution. One provider dispatch wrapper constructs the final request from `AdmittedPart`s and seals its manifest before dispatch. It observes the actual serialized messages, binary parts, tool descriptions and provider continuation options. The shared call is rejected if any unknown part, extra processor injection, legacy history item or private session continuation would reach that request. Its runtime has no working-memory processor, semantic recall or private memory tools. Do not take `agentMemory.readMemory()` as the injection boundary: the traced Mastra processor reads the resource directly and injects a different value.

The manifest is per actual provider invocation/step, not one mutable manifest for an entire tool loop. Each response seals its output digest and tool-call payload digests before execution. A private artifact tool call obtains an internal `preparedWriteId` tied to that step's admitted policy and exact returned tool payload. `saveDocument({kind: 'private-agent-write', ...})` loads it server-side, preserves canonical existing-version policy, and applies the normal private-agent approval rule. Later tools cannot retroactively change that write's receipt, and an unfinished step cannot certify content. Multi-stage background drafts union the policies of every consumed intermediate output and template; an opaque old run input yields an explicit owner-only policy. No current background artifact is allowed to omit its version binding.

Each shared tool result is loaded, parsed to its DTO, divided into source/application parts, reauthorized and guarded, then appended to the provider request. Withheld content contributes no consumed-content observation; the refusal is fixed application wording plus an opaque request identifier. Do not forward raw error.message/stack, model-authored error text, source titles in errors, or full approval exceptions. Source-aware result projection belongs to the same registry entry as its schema and executor, not a second `recordToolProvenance`/`GUARDED_TOOLS` name switch.

```ts
type ModelAdmission =
  | { kind: 'application'; project: ApplicationResultProjection }
  | { kind: 'source'; resolve: AuthoritativeSourceProjection }
  | { kind: 'private-only'; reason: UnknownReason;
      knownSources: AuthoritativeSourceProjection | 'none' };
type CapabilityRegistration = ExistingCapability & {
  modelAdmission: ModelAdmission;
  sharedGeneration: 'read' | 'unavailable';
};
// Required exhaustively by the registry definition; guest eligibility is still intersected.
// The projection can select resource refs/ranges, never accept an asserted policy from a DTO.
// Runtime tool selection and injection guarding derive from these registered semantics.
```

Native provider searches that insert hidden result text into their internal generation cannot attest this admission bundle. Disable those tools only for bounded shared writing until their adapter provides an equivalent observable boundary. The shared call can use the existing application web/research path with captured results; private chat retains native search. No new capability-name allowlist compensates for unknown native behavior.

Private generation uses the same admission representation but permits `unknown-private` with an owner-only fence. New assistant messages and generated artifacts inherit the manifest of the actual private call, including known protected obligations. This does not pretend opaque memory is complete. Replaying new source-derived history first checks its stored policy; revoked segments and their derivatives are withheld. Full approval previews are always human-only: reconstruct model-visible `{approvalId, state, operationKind}` from authoritative records with fixed descriptions, rather than replaying `data-approval.summary`. A title/destination is either omitted or separately loaded as an authorized source label.

An application-prefilled editor, Gmail response, delegated-task message or settings form is source/derived input, even if submitted through a person UI. Capture its server-owned prefill/base-version binding and preserve that policy on edits; do not label the whole field a new independent contribution when the person clicks Save/Send. Only independent typed fields and upload events obtain contribution origin. Transcription is a recorded transformation of that exact submitted audio, not a claim that model-transcribed words were manually authored. Its transform must consume only the submitted audio and versioned application constants; extra source context would add obligations.

Keep old stored messages/approval metadata intact. At replay, omit legacy preview summaries. Legacy assistant/tool parts without recoverable admission are private-only and cannot seed shared generation; a part with known revoked dependencies is withheld even in private chat. Legacy app-inserted ask messages are never promoted to direct contributions. The private owner may still read their stored conversation; provider replay is a separate access-controlled use, not a rewrite of history. Historical unknown private text remains an explicitly uncertified private input where no source identity can be recovered; this limitation cannot be repaired by assigning invented empty obligations.

### Immutable versions and finite source checks

Every successful content version has exactly one immutable policy. When reading a source version, flatten its recorded obligations and add the source's base current ACL plus its observed case/protected ancestor folder IDs. Pin content version, content digest, admitted range/bytes digest and the policy snapshot. Retain observed ancestor restrictions even if the source/copy later moves out of that folder. Current policy of those anchors can revoke access; a snapshot is evidence, not a frozen grant.

The source page's **current resource ACL** is checked directly: existence, current case membership, current folder ancestry and case/office consistency. Its **historical source version policy** supplies the upstream obligations attached to the bytes actually observed. Do not read the source page's current content policy to authorize an old derivative. A later edit adding a new confidential source to B must not retroactively add that source to old A derived from B v1. Conversely, moving B to a less restricted location cannot erase an observed protected folder anchor, and revoking membership/anchor access stops old A reads.

Example: A v1 and B v1 have independent policies. A v2 observes B v1; B v2 observes A v1. They flatten immutable policies, plus base resource/anchor atoms. Concurrent commits do not form recursive policy edges. A v3 may observe B v2; it receives B v2's flattened atoms without traversing A's current policy. A/B/A works with valid access. A self-resource atom is harmless because it checks only base ACL; no recursive self-lineage exclusion is needed to make the operation work.

Normal edits union the previous version's obligations with the new generating/contribution policy. Person edits cannot drop known restrictions by submitting replacement text. Restore unions current and restored version obligations; source facts follow both the retained current restrictions and restored bytes. Dropping obligations requires a new separately authored/rebuilt document, not an ambiguous edited derivative. The old content remains unchanged.

Deduplicate obligations by canonical resource/policy-anchor identity. Evidence may retain several observed versions for one resource without multiplying ACL checks. Access is a bulk lookup of distinct atoms, with request-scoped memoization by actor and policy ID; no process cache survives revocation. Lists filter policy before returning titles, counts, excerpts, history or search matches. Version reads authorize current page base ACL and the requested historical policy; they do not require access to unrelated current-version source content. Editing/restoring current content requires its current policy too.

Choose explicit bounds initially: at most 256 distinct obligations and 1,024 observations per generation/version policy, plus existing text/attachment budgets. Never truncate obligations to fit. Over-budget shared work fails with a usable instruction to select fewer references; private generation may retain an owner-only over-budget policy with the known indexed obligation set, never an empty certified policy. Flattening is linear in stored distinct atoms and admitted observations, rather than exponential in graph paths. Content-bearing evidence is not repeatedly copied into descendants: reference immutable observation IDs and flattened atom rows.

Legacy graphs use a separate, bounded compatibility resolver: iterative traversal with global visited nodes and independent malformed/missing detection. A cycle is not evidence of no restrictions, and no recursive traversal is used for new versions. For old rows whose observed versions cannot be recovered, conservatively flatten the union of all reachable legacy current dependencies into a `legacy-unpinned` fence; shared transmission/republication remains blocked. Missing IDs, malformed JSON, case mismatch, deleted anchors or traversal-budget exhaustion fail closed. Existing valid human-only pages with no dependencies and a proven human write can be classified eligible. Version history with doubtful origin is never retro-certified from the current conversation's cleaner manifest.

Unpinned legacy pages may remain readable only to actors who pass base ACL plus every recoverable reachable obligation and an immutable `legacy-audience` fence. Establish that fence from the currently authorized principal intersection at cutover under the case policy locks; never infer a historical audience that was not recorded. While a legacy version has no stored fence, deny its model admission/new shared writes and require this compatibility classification before ordinary reads. New case participants cannot become eligible for unknown old bytes merely through case membership. Cycles with all nodes present/access-valid can be read finitely by this compatibility path, but edits retain the fence and cannot certify a new shareable version. Since 0075 page versions have no durable writer-origin column, an empty dependency array and `user_id` alone do not establish a human-only write. Without separate concrete evidence those pages also retain the legacy fence. Preserve data for rebuilding rather than making a current recursive cycle permanently unrecoverable.

### Exact proposals and transaction ownership

`document-content` is the sole content/version/policy writer for both private artifacts and shared pages. `content-generation` may create a sealed generation receipt and staged proposal, but never changes a content version. A proposal stores exact title/content, target, CAS base, source artifact/page version, immutable policy ID, payload digest and canonical operation. No later conversation union changes that proposal. Approval previews read that exact record with current source checks; they do not re-run mutable loaders or rebuild content from current artifact text.

Generation orchestration persists those receipts through the content owner's nonpublic admission/staging entry points, restricted to the provider wrapper and ingress adapters. It does not independently insert policy rows. Read a source's bytes, exact version and version-policy binding coherently (joined immutable version lookup, or transaction snapshot of a legacy current row); never pair content from version N with policy from the resource's later current version. Every new content change creates a historical version row, replacing the old artifact helper's sampled snapshot behavior for new versions while retaining old history unchanged.

`prepareCasePage` owns one short transaction to persist generation output and `capability_approval`/proposal extension together, after the provider completes and current access is rechecked. For publication without generation, the transaction reads the exact artifact version and its canonical policy, and stores the exact copied content. Do not call today's nontransactional `createApprovalProposal()` and then independently insert lineage; add a transaction-reader overload/private insert in the content owner. The immutable snapshot survives navigation, cancellation and retries.

Confirmation owns **one** `withTransaction(async tx => ...)`, using the existing `Transaction.prepare` interface. `database.batch` is useful for unconditional statement groups but cannot implement read/branch/CAS approval transitions safely. Do not call `ai-store.updateArtifact(database, ...)` from inside this transaction: that helper owns a separate batch/connection. Replace its mutating export with the central transactional writer; retain the pure edit application/citation logic.

The confirmation transport accepts only the proposal ID/decision with strict parsing. The executor loads the canonical stored operation; it never accepts a client invocation flag or replacement content/destination alongside that ID. Human preview access cannot grant permission to the source version, and no private conversation/submission/generation payload becomes readable by shared-page participants merely because its policy ID is attached to a shared version.

```ts
return withTransaction(async tx => {
  const proposal = await tx.prepare(
    'SELECT ... FROM capability_approval a JOIN content_proposal p ON ... ' +
    'WHERE a.id=? AND a.user_id=? AND a.office_id=? FOR UPDATE OF a,p'
  ).get(proposalId, ctx.userId, homeOfficeId(ctx));
  requireExactActorOperationAndPayload(proposal);

  // Lock policy domains in canonical order; re-read resource locations after locking.
  // A consumed retry skips source-artifact-current-version CAS, not current ACL checks.
  await lockCurrentPolicyDomains(tx, proposal);
  if (proposal.status === 'consumed') {
    return readExactReceiptWithCurrentAuthorization(tx, ctx, proposal.result);
  }
  requireApprovedAndUnexpired(proposal);
  await checkDestinationAndCurrentSources(tx, ctx, proposal);
  const current = await lockTargetRow(tx, proposal.document); // SELECT ... FOR UPDATE
  compareExpectedVersion(current, proposal.expectedVersion);
  await checkPinnedCopyVersionIfRequired(tx, proposal); // copy source exact version
  const applied = applyAndValidatePreparedChange(current, proposal);
  const policy = mergeImmutablePolicies(current?.policyId, proposal.policyId);
  // Below are tx.prepare(...).run/get calls, no database.* and no external side effect.
  await insertPolicyAndVersion(tx, applied, policy);
  await updateCurrentContentCAS(tx, applied);
  const receipt = exactReceipt(applied);
  await tx.prepare("UPDATE capability_approval SET status='consumed', " +
    'consumed_at=CURRENT_TIMESTAMP,chat_result=? WHERE id=? AND status=\'approved\'')
    .run(fixedChatResult(receipt), proposalId);
  await persistExactResultPointer(tx, proposalId, receipt);
  return receipt;
});
```

Source checks can race concurrent ACL changes even after graph recursion is removed. Use the existing transaction-scoped PostgreSQL advisory-lock pattern, not a new global graph lock. Define policy domains as cases and private owner/account domains. Access-sensitive commits take `pg_advisory_xact_lock_shared(hashtextextended(?,0))` in sorted order. Membership/revocation, Lume disable, protected-folder visibility, source deletion and location/move mutations take the corresponding exclusive lock. Add this discipline to the existing collaboration/Vault ACL mutation functions, including HTTP/WebMCP paths; an approval does not carry a cached permission.

Within these locks, recheck authenticated actor/session eligibility, capability/guest scope and the case Lume switch for agent operations. Base source checks include all protected ancestors even for creators. At provider dispatch recheck source/case policy immediately before sending; do not claim a revocation can retract a request already dispatched. All later provider steps, commits and managed reads use current authorization.

Re-read locations/ancestor IDs under the locks; if their domains differ from discovery, abort and retry the entire short transaction with a bounded retry count. Cross-case moves lock old/new domains in sorted order. Policy-domain acquisition precedes destination content-row locking. Folder/association writers follow the same order. The target approval lock is safe first only because ACL writers never lock approval rows. Source content edits do not require a graph-wide lock: observed policies are immutable and the selected source version must exist. Ordinary reads use current ACL at their access check; a revocation cannot retract bytes already delivered. Never hold a PostgreSQL transaction across model generation, file rendering or external connector network I/O.

Cancellation updates only approval status. A stale CAS, invalid targeted edit, source revocation, render failure or database exception rolls back version, content, policy and consumption together. An approved-but-unsuccessful proposal remains recoverable; its conflict can be displayed, cancelled, or replaced by a newly reviewed proposal without silently consuming it. Duplicate confirmations serialize on the approval and return the frozen result version, not whatever content the page later contains. A consumed result remains recoverable after TTL, subject to current access to that exact version. Rejected proposals cannot mutate, and altered input/destination is never accepted for an existing proposal ID.

Person edits/create/restore need no new proposal gate: authenticated UI submission and normal existing action semantics suffice. Agent page changes and explicit private-artifact publication retain exact review. Agent private edits retain the current own-conversation-versus-other-document approval rule, but staged lineage is committed only with the successful write. New agent artifacts and background run artifacts must have a policy at their first version. Citation checking after a commit may report issues; it cannot initialize or relax authorization.

### Canonical legacy classification and private archives

One resolver serves artifact read-to-generation, publication, export, archive, portal and connector exits. It considers the **exact version**, existing provenance, agent/run/conversation/source-reference origin, and known history; no caller reads raw `ai_source_provenance` to decide that missing means unrestricted.

- A new recorded direct human draft is eligible with its explicitly known upstream policy. A legacy artifact with no agent/run/conversation/source-ref evidence can retain the current human-draft convention, documented as a legacy ownership assumption, not proof of original authorship. Its later person save records explicit submission but preserves any known obligations.
- Legacy or current untracked agent/run output is owner-only/unknown with all recoverable obligations. An old `complete=true` row is not proof of exhaustive actual input admission; retain its known restrictions and classify pre-boundary agent output as unknown. `complete=false` remains unknown. Versionless artifact provenance applies conservatively to all recoverable old versions.
- A failed/cancelled proposal never writes classification to the unchanged artifact. A new agent edit of unknown text stays unknown even if its new call is eligible; human approval cannot certify its old text.

An owner may archive their readable exact private version into their home Library or their own currently private folder, with no extra sharing approval. The destination must be owner-only under current case/ancestor policy and the actor must still have access to every known source. Unknown ancestry permits only this same-owner archival fence; it does not become eligible after conversion. The copy's version carries known obligations plus the owner-only fence. Known revoked dependencies deny archival even if the bytes are locally retained in the old artifact. The classification cannot enforce a revocation against a completely unidentified historical source; that is an explicit legacy limitation, never a share certificate.

For recovery of an unsafe legacy model output, offer **“Criar nova versão a partir das fontes”** in the existing conversation. The owner selects currently accessible original references and submits a new instruction/style choice. Bounded generation does not consume the unsafe draft, its title, excerpt, private summary, or a model-written rewrite instruction. It creates a new independent private artifact/proposal with a fresh manifest. The unknown original remains private and archivable. Human manual re-authoring in a new document remains possible; it is an explicit new contribution, not automatic repair of old lineage. If indispensable sources cannot be identified or are revoked, automated shared recovery is unavailable.

### Policy-bearing files and later exits

`prepareDelivery` resolves the exact content version and canonical policy; resolves the actual selected/default template; captures template version/digest and its policy; renders outside the database; then persists a staged delivery with rendered-byte digest and a union policy. `commitDelivery` reauthorizes, verifies pinned content/template selections and exact bytes, and commits the existing destination record and version-policy attachment together. File copy identity includes content version/digest, format, destination and template observation/version/digest. A changed default template never silently substitutes bytes in an already reviewed/pinned delivery. A selected template missing or revoked is an error, not the current `.catch(() => undefined)` silent fallback. An explicitly requested plain/default-free rendering uses its own delivery identity.

Explicit contribution scope can cover a template originally submitted by this owner for use as their letterhead: record its upload/submission and the directly configured template-use purpose. This licenses the owner's private container for that defined rendering purpose; it does not drop a case/folder obligation, copied protected ancestry or a model-generated template's fence. Default selection alone, template ownership, and an old updater ID cannot establish this scope. An unproven default remains private-only for owner downloads; shared rendering offers an eligible/plain template choice. No loader relabels retrieved template text as person-authored. Capture the template's actual bytes/policy in either case.

This is a bounded file/derived-content boundary, not classification of arbitrary enterprise traffic. Existing services still own their domain records, clients, connector policies and confirmations; they cannot obtain policy-bearing generated bytes through an alternate raw exporter. For transaction-local copies, `commitDelivery` performs their existing inserts through transaction-aware private functions, or supplies its owned transaction to those functions. No copy record can commit without its version-policy attachment. Export-only downloads use the same preparation/checks without creating a new audience grant.

Object storage cannot join PostgreSQL rollback. Stage rendered bytes under an unlisted immutable digest key before the short commit transaction; only a committed version/file row makes them reachable through an authorized download route. A failed commit leaves an inaccessible staged object eligible for cleanup, not an untracked publicly addressable copy. A retry verifies the same digest/template/content identity and reuses it. Do not publish a storage URL before source authorization and the database binding commit.

The minimum application-managed coverage is:

| Existing exit | Enforcement and retained policy |
| --- | --- |
| `saveArtifactToVault` / `copyIntoVault` | Canonical version policy; permit same-owner archive; attach policy to the exact new Vault version, including template input. Shared-folder copies require eligible provenance and retain effective source restrictions. |
| Vault reads, lists, chunks/search, versions, downloads | Intersect existing document/folder access with that version's policy. Hide restricted titles/counts/chunks; a downstream source read flattens this exact version's policy. Ordinary independent person uploads retain their normal policy. |
| `updateDocument` moves / folder visibility / participant changes | Preserve version policy; location changes cannot remove obligations or owner-only fence. Acquire policy-domain locks for concurrent commits. A folder may broaden while a derived file remains effectively restricted. No new approval for ordinary owner moves. |
| `personal-chat/shares.createShare/readDocumentShare` | Bind policy to the pinned Vault version, not current content. A recipient must satisfy every current protected-source obligation as well as the existing share grant. New copy grants cannot satisfy upstream ACL by granting themselves. Revocation, source deletion and source-case continuity deny subsequent reads. |
| Portal artifact publication and downloads | Use the delivery boundary and persist union policy on `client_portal_file`; recheck client eligibility/source policy on every download, including revoked upstream sources. An external client normally has no internal protected-source grant: deny such derived release unless an existing independent source-access rule actually permits that client. Exact portal publication of direct person-authored/source-free content remains normal. A portal confirmation never grants protected upstream access. |
| Gmail attachments, Drive version upload/replacement and later Drive-share operation | Preserve existing exact confirmations/version/digest checks. Validate outgoing bytes' policy against recipients/audience before dispatch; store origin/policy binding for app-managed Drive copies so a later app-managed permission change rechecks it. Private unknown archives and internal ACL-protected derivatives cannot be sent to unverifiable external audiences. |
| Direct generated Gmail/Docs/WhatsApp text from private agent | Treat text as derived from the private generation, not as human-authored because confirmed. It may send through existing confirmations only if its policy supports the destination. Otherwise use the same bounded generator from direct user intent/permitted sources to prepare the confirmed message. This closes a text escape while retaining the connectors and their confirmations. |
| Artifact/page exports and templates | Check owner/resource plus exact version policy before and after rendering; union selected/default template lineage. Owner download can retain owner-only fence. Shared recipients get only bytes they currently may access. |

For known protected sources, a shared page/file's effective audience is destination access intersected with current obligations. It need not be denied just because some case participants lack a source; the preview states **“Participantes com acesso à pasta e às fontes utilizadas.”** The reader still checks every atom. An unknown owner-only version cannot be copied into a shared location as an eligible version. A later move may change its location but not its effective owner-only audience; lists filter it and UI explains its retained privacy. This avoids making normal folder administration depend on a new approval bureaucracy.

Known external connector inputs whose audience cannot be checked become owner-only. There is no inference that OAuth access implies permission to disclose. Public web/research material is eligible only under its loader's actual public/redistribution policy. Internal message recipients can be checked as persons; arbitrary email addresses, portal clients and external Drive audiences do not automatically satisfy internal case/folder ACLs. This introduces precise denials for protected derived material, not a new blanket connector approval. Existing source-independent person-authored sends and their current confirmations remain.

Recipient checks are a concrete policy query: `authorizeAudience(ctx, exactVersionPolicy, destination, tx)` loads each obligation's authoritative current recipient rule. K5 person destinations require ordinary base resource ACL for that person. A connector adapter may establish a same-audience envelope for an exact email/thread (original visible participants) or current Drive source permission set; this permits bounded reply/edit to that audience without treating all mailbox contents as transferable. It must compare normalized exact recipients, account authorization generation and source identity/version; any added/unknown recipient fails that proof. When those facts are unavailable, the external input is owner-only. `prepareOutboundContent` admits the original human request and authorized same-audience sources, omits private memory and private planner prose, and returns the exact output for the existing connector confirmation. It introduces no additional approval round. Application-managed direct external content is still an explicit transmission beyond the app's revocation control after dispatch.

The outbound result is a sealed generation-output payload and delivery proposal, not a pretend page/artifact mutation. Its exact text, recipients, external revision precondition where available, policy and digest are bound to the connector's existing approval/pending record. `saveDocument` confirms only document proposals; connector confirmation dispatches its bound delivery through the existing reconciliation owner. Model/guard/retrieval/render services remain the configured processing endpoints under the product's existing AI consent and processor policy; they do not count as new human recipients. Their inputs still require admission/current access, and arbitrary connector destinations receive no such processing exemption.

External sends are not database-atomic: stage exact payload/policy with the connector's existing durable pending/dispatch/reconciliation record, check current access immediately before dispatch, and retain the outcome. A lost network response is reconciled rather than blindly re-sent. Do not repurpose local approval consumption as proof of a remote send. The protected-content policy decision must happen before the external side effect; once delivered it cannot be revoked through K5. Existing Drive/Gmail pending/unknown mechanisms are reused, not replaced by a new generic send engine.

Downloads and manual copy cannot carry enforceable ACL outside the application. K5 controls future managed reads/copies/grants and its own connector sends; it cannot retract downloaded files, clipboard bytes, external recipients' copies, manual external sharing, or a manual reupload with no known origin. The design promises none of those. Known app-managed origin survives format changes and delivery; manual bytes without an observable identity are explicit person submissions under the stated product limit.

### Storage and additive migration

Use `0076_content_source_policy.sql` if still unused at writer start; otherwise the next unused number. `0075_case_pages.sql` is already applied to the disposable verification database and must remain untouched. The developer database remains unmigrated. This candidate executes no migration.

Add these bounded records, with parsed internal schemas and tenant-aware ownership:

- `content_submission`: immutable authenticated contribution bytes/digests, typed origin, source bindings, frozen scope and optional parent shared-task ID. It is not a universal event ledger; it records only ingress used in content derivations. Existing messages remain the chat record.
- `content_policy`, `content_policy_obligation`, `content_policy_observation`: immutable policy header/fence, canonical unique atom rows and immutable observation evidence. Index `(policy_id, atom_key)` and source/resource keys. The observation records digest/version/policy anchors, not full protected content redundantly.
- `content_generation`: per-call owner/mode, manifest, provider-input digest, policy and sealed output digest. Protected input payloads use existing version/attachment storage; application system prompt versions may be stored by hash/version.
- `content_version_policy`: one unique binding per `(resource_kind, resource_id, version_key)` for artifacts, pages, Vault versions, portal files and instruction versions. Add current-policy pointers to content owners only as indexed convenience; binding is authoritative. All new writes must create a binding in the same transaction; enforce via deferred constraint triggers for new version/file rows after the boundary activation cutoff. Missing required binding fails closed at readers.
- `content_proposal`: extension of `capability_approval`, containing exact operation/payload, policy/generation refs, source/destination/CAS digests and recoverable exact result. Keep old `case_page_approval` and `chat_result` data intact. Add staged file-delivery policy refs to the existing durable destination/copy/connector records. An internal prepared-write row binds a provider response/tool-call digest to a generation step and exact private write arguments; it is not accepted as browser-authored content.

Do not destructively rewrite `source_dependencies`, `ai_source_provenance`, old approvals or origin metadata. Read them only through a compatibility adapter, then write new policy bindings for new versions. Backfill known old obligations conservatively with `legacy-audience`/owner-only classification; unknown origins remain unknown. Partial references cannot yield an eligible generation manifest. Native old human uploads can retain their established resource access under documented legacy assumptions; pages require the version-origin evidence/fence described above. App-generated copies identified by `vault_agent_origin`/`artifact:<id>:v<version>` must resolve the original canonical policy, never be treated as independent uploads.

Pending old page/artifact approvals retain their exact input but lack a sealed actual-input manifest. Permit an exact owner archival operation where appropriate; require a fresh reviewed proposal for a new shared write. Do not consume or delete the old proposal, and do not transplant a newly eligible conversation's policy onto it. Previously consumed results remain discoverable, subject to current compatibility access. Keep old full previews in storage for the human owner with source checks; never replay them to the model.

### Module map and subtraction

| Module | Knowledge owned / change |
| --- | --- |
| `content-generation.ts` | Builds bounded shared inputs from ingress; provider-boundary manifest; tools admitted using registry semantics; creates sealed receipts/proposals. Existing chat/background provider wrappers use its private admission machinery. |
| `document-content.ts` with nonpublic `document-content/` internals | Owns canonical classification, base/current-source policy checks, immutable policies, content/version CAS and approval-result transactions, exact copy/archive/export/delivery policy. Exports domain operations above; internals contain SQL/storage/render adaptation. |
| `capabilities/contracts.ts` + executor registrations in `agent-tools/index.ts` | Required model-admission contracts and generated tool projections; intersect existing scope/guest policy. Agent shared writing accepts a captured send handle, not private planner content. HTTP/person routes still parse ordinary editor submissions. |
| `chat-prompt.ts`, `chat-turn.ts`, scope/message ingress and `workspace.ask` | Separate human and source inputs; preserve original per-send/regeneration scope; replay policy-bearing history and metadata-only approvals; retain private runtime/memory. No draft lifecycle changes. |
| Existing Vault/messages/portal/Google/WhatsApp adapters | Use the single delivery/content access boundary while retaining existing domain ownership and confirmations. Add transaction-aware private insert/access hooks where needed. |

Delete the conversation `complete` veto, `agentSources()` conversation accumulation, mutable `recordProvenance()` union/AND writes, pre-approval `preserveProvenance()`, recursive `sourceAccess()` over current page policies, and the hand-maintained provenance capability-name switch. Replace raw provenance reads in Vault with canonical version classification. Replace full `data-approval.summary` prompt replay and ask's duplicated title/excerpt text. Remove exported `ai-store.updateArtifact` mutation and scattered run/artifact/page content inserts once callers use the single writer; retain artifact ownership readers, conversations and pure formatting/edit helpers where they are internal to the new boundary. Remove the private agent's ability to submit free-form shared replacement content. Old public service entry points are migrated and deleted, not retained as alternate writers/re-exports.

Use ESLint restricted-import rules to make private content internals, raw mutation helpers and raw render-to-delivery functions unavailable to outside callers. A registry typing check requires admission semantics for each new capability. Source adapters return opaque observed handles; callers cannot fabricate a `VersionPolicy` via normal imports. Database triggers make a missing new version binding a transaction failure rather than an unnoticed security omission. These measures encode the shortest correct implementation path, per encode-lessons-in-structure and boundary-discipline.

Interface depth: callers express a human write, a bounded proposal, an exact publication or a delivery. They do not coordinate provenance writes, source traversal, approval consumption, template snapshots or policy attachment. The content owner hides those invariants. Existing domain services retain their own business records, and one transaction composes their private inserts. This is not a chain of load/validate/taint/save pass-through layers. Source adapters contain real resource-specific authority; the registry stores that decision once, per minimize-reader-load and single-source-of-truth.

### Required regressions and evidence

These are implementation requirements, not tests executed by this runner. Exercise real admission before services; hand-seeded eligible policies may supplement but cannot replace them.

1. **Personalized shared generation:** real authenticated `/api/chat` send with existing working memory, Honcho context, writing rules, configured search-only/always knowledge and ordinary discovery. The same conversation gets an exact case-page proposal; private chat still receives its personalization. A disallowed private-memory sentinel never reaches the shared provider. Include cross-home-office participant and guest scope.
2. **Contribution distinction:** direct typed request/new upload is recorded as a contribution; app title/excerpt, retrieved chunk, generated settings and model summary cannot obtain that origin. Legacy user-role ask text stays unknown. A private planner tries to provide protected prose as title/content/plan/tool argument; schema and ingress resolution reject it before shared dispatch.
3. **Provider bytes:** an external provider-boundary stub captures final serialized request/messages, images/files, tool schemas and headers/options. Seed distinct sentinels in every input class: working memory, learned memory, knowledge body/note/title, focus labels, selected excerpt, attachment text/images, tools/errors, approval preview, private history and generated rules. Assert admitted sentinels carry expected policy and excluded/revoked/guard-withheld sentinels are absent. Assert no private `Session-Id`/continuation. Exercise the actual Mastra processor and AI SDK serialization, not a mock of `prepareCasePage`.
4. **History/approvals:** direct publication in a conversation that never read its source; cancel/failed confirmation; then revoke source and send again. Full preview remains absent from provider replay. New derived assistant history with revoked policy is withheld. Forged approval/changed destination/payload cannot commit. Exact human UI still shows the full authorized preview.
5. **Version policies:** actual source loading/generation produces A/B/A writes. PostgreSQL barriers make concurrent A-from-B-v1 and B-from-A-v1 both commit and remain readable. Later source edits do not infect historical derivations; ACL revocation/move/deleted observed ancestor still denies. Dense shared ancestors check each atom once; bounds fail without discarding obligations. Missing/malformed legacy source and cyclic legacy graph use the deliberate compatibility outcome.
6. **Rollback/replay:** real PostgreSQL failure injection after policy insert, after version insert, before approval update and before commit. Assert unchanged artifact content/version/classification on cancellation, invalid edit, stale CAS and failed write, including unsafe legacy artifact attempted from an eligible call. Parallel duplicate confirmations create one version/page and return the exact same receipt. Later editing changes current content but not consumed-result version; expiry does not destroy an already consumed result. A private multi-step tool loop seals provenance at each provider response; a later discovery cannot alter an earlier artifact's policy. Regeneration uses original send scope/current ACL, while duplicate same-attempt preparation reuses its result.
7. **ACL concurrency:** two real PostgreSQL connections synchronize publication/archive against membership revocation, folder visibility/move and Lume disable. Confirm the policy-domain locking order linearizes safely with no window certifying unauthorized content; a denial leaves no partial copy. Use timeouts to catch deadlock/order violations. Confirm human and agent writes reach the same service and creator has no bypass.
8. **Archival and templates:** unknown generated draft and traceable same-owner draft archive to Library/own private folder; known revoked source denies. Missing provenance classified identically at publication/archive/portal. Default and selected DOCX templates add observed policy; template changed/revoked between render/commit cannot substitute reviewed bytes or share silently. PDFcn path correctly has no template when none is consumed; portal PDF uses its actual DOCX template lineage.
9. **Application exits:** archive then move/broaden folder; eligible and ineligible recipients attempt pinned message-share read after active file version changes; revoke upstream source; portal publication/download; Gmail attachment/Drive replacement/Drive permission change; private generated outbound text. Test read/list/count/search/download/citations where relevant, not just write rejection. Verify future grant/read denial despite preserved file bytes. Ordinary person-authored page publication and source-independent connector sends keep current confirmations.
10. **Legacy migration/recovery:** disposable fixture first applies unchanged 0075, then additive migration; preserves exact content/metadata/approval rows. Human legacy, agent/run legacy, already copied Vault origin and portal source_ref classifications differ correctly. Existing authorized legacy-page readers retain access through the finite fence; a newly added participant cannot read those unknown old bytes. Fresh current background generation always creates a binding, at least owner-only when inputs are opaque. Rebuilding an unknown draft consumes selected sources/direct request and never the old text.
11. **Product flow:** affected e2e sends through the existing conversation, `Pedir ao Lume`, exact proposal review, human edit, archive and source revocation on desktop/mobile. Keep editor restore/access-loss behavior delegated to the independent writer; integrate only source-input semantics here.

A provider stub proves the application's serialization/admission, authorization and transaction behavior with deterministic outputs. It is not live-model evidence that a provider follows instructions, interprets sources correctly, or avoids every injection. A small opt-in live-model run can demonstrate same-conversation proposal usefulness and real tool interoperability; it still cannot prove ACL completeness by model assertions. No model output is needed to validate the application-owned policy invariants.

### Evidence for bounded deviations

All three original reviews remain accepted as findings. Their editor lifecycle items are outside this candidate. The source repair replaces the mechanisms causing their traced failures rather than disputing them:

- `chat-turn.ts:162`/`:167`, `agent-memory.ts:49`, `honcho-memory.ts:queueMemoryChange`, and the traced Mastra processor establish that personalization cannot become safe by ownership or by calling the truncated memory reader. Hence bounded generation and an explicit private-only memory fence, rather than relabeling memory or removing it.
- `lume-workspace.tsx:173`, `chat-prompt.ts:32`, `chat-turn.ts:185` establish ask's duplicate unguarded user-text path. Only source-input construction changes here; no editor lifecycle redesign.
- `agent-knowledge.ts:knowledgePrompt` and `agent-instructions.ts:saveInstruction/instructionsPrompt` expose versionable documents/rules but currently return strings. Rule `updated_by` identifies the authenticated updater, not whether a private agent authored it. Hence structured loader output and no legacy authorship backfill from updater ID.
- `agent-tools/index.ts:runCapability` records provenance after execution and before DTO parse; `application/agent-approvals.ts:describeAgentApproval` and `chat-prompt.ts:46` expose preview text on exceptions. Hence projection/admission before provider consumption and metadata-only approval replay.
- `application/artifacts-service.ts:createArtifact/saveArtifact/editArtifact`, `ai-store.ts:updateArtifact`, and `case-pages/service.ts:mutate` establish independent artifact-provenance commits versus existing page transaction ownership. Hence a sole transactional version writer and no cleaner-conversation certification of legacy text.
- `case-pages/service.ts:resolveMutation/requirePage`, `case-pages/provenance.ts:sourceAccess`, `db/postgres.ts:postgresTransaction` establish unversioned current recursive edges and READ COMMITTED write skew. Hence flattened observed-version policies; advisory locks protect current ACL commits, not acyclicity of a live graph.
- `collaboration/access.ts:caseAccess` already accepts a transaction reader and distinguishes destination office/home identity; current `documentAccess` uses the global database. The content boundary uses transaction-aware base access for sources instead of accidentally escaping to another connection.
- `application/vault-service.ts:saveArtifactToVault/copyIntoVault`, `personal-chat/shares.ts:createShare/readDocumentShare`, and `vault.ts:updateDocument/assertVaultDocumentMove` establish both same-owner archival and later copy audience changes. Hence version-bound obligations on the copied file and recipient reads, beyond an origin pointer.
- `artifact-file.ts:artifactTemplate/artifactVaultFile` shows DOCX uses a selected/default template while PDFcn uses title/content only; `client-portal/service.ts:publishPortalArtifact` consumes a template even for its PDF. Hence capture the template actually consumed, not a blanket format assumption.
- `document-workflows.ts:223`, connector imports/exports and portal `source_ref` establish current generated/copy writers outside shared pages. They must attach at least conservative version policy; omitting them would retain the laundering exit.

These are source-level traces, not runtime reproductions. The accepted contract's no-design-restart rule is superseded only here by the lead verdict. No tasks/fees/activity/runtime replacement or editor draft/revocation work is introduced.

### Red-flag audit

- **Shallow module:** `prepareCasePage` hides input reconstruction/provider admission/proposal construction; content operations hide version/source/approval/copy atomicity. Callers do not manually record/merge lineage.
- **Information leakage:** storage JSON, ACL atom representation, Mastra messages and registry wire DTOs stay internal. Callers pass domain references, submission IDs and proposal IDs.
- **Temporal decomposition:** modules own generation knowledge and content-policy state, not separately exposed load/taint/validate/save steps. Proposed input assembly is internal to its domain owner.
- **Pass-through:** route/executor parsing is existing transport adaptation; no new service that only forwards the same content/provenance arguments. Old mutation wrappers are removed after migration.
- **Split ownership:** one central writer commits content/version/policy/approval state; source adapters cannot update published policy. Existing sinks own records through composed transactions, not independent provenance side writes.
- **Two ways:** private planner cannot also write shared title/content; raw artifact/page mutations and raw generated-file exits lose external imports. Human and agent paths use the same content authorization writer.
- **Importable internals:** restricted imports plus private branded handles and deferred binding constraints block the attractive shortcut of fabricating an eligible manifest or inserting an untracked new version.
- **Hand-synced list:** required registry admission semantics derive bounded tool availability and guard treatment. No new runtime provenance allowlist or separate exempt-tool set.

## Synthesis decision

Reserved for the parent. This runner recommends Shape B: task-scoped generation from authenticated ingress, immutable flattened version obligations, and one transactional content/copy boundary. Shape A is a concrete whole-system alternative, not another runner's proposal. No other candidate output or grading rubric was read.

## Tradeoffs accepted

- We accept one additional generation call for shared writing in exchange for a bounded actual-input guarantee while keeping useful private personalization.
- We accept that opaque learned/working memory and unproven generated settings do not shape shared prose in exchange for avoiding unsupported claims about their protected ancestry. Direct task/style instructions still work.
- We accept conservative obligation retention on edit/restore in exchange for finite version checks without text-level declassification heuristics. A genuinely independent rebuild is the recovery path.
- We accept indexed flattened atom/evidence storage and explicit policy-domain locks in exchange for predictable A/B/A and concurrency behavior. We do not serialize source content graphs.
- We accept owner-only archival of unknown model drafts in exchange for private preservation without turning conversion into a share certificate.
- We accept precise denials for protected derived portal/connector audiences with no independent source grant in exchange for preserving source ACLs. Person-authored/source-independent sends retain their normal actions and existing confirmations.
- We accept that manual downloads/paste/reuploads and already delivered external bytes escape application control in exchange for a bounded product policy rather than invented byte-level enforcement.
- We accept conservative legacy fences and fresh rebuilds in exchange for preserving stored content/approvals without fabricating historical completeness.

## Alternatives considered

Shape A instruments all producer/history/memory entries and constructs an eligible conversation projection for shared generation. It hides source-union policy but exposes source eligibility throughout loaders and memory updates; callers must understand why an apparently person-owned memory/history entry is excluded. It can support richer future personalized shared writing. It loses here because historical Markdown memory and model-derived history cannot be reconstructed, and normal work would depend on a large processor/storage conversion before the reopened source subsystem becomes usable.

Keeping one private generation and asking the model to write only from named safe references is rejected, not a third viable shape: those references cannot prove it ignored already-consumed hidden memory, titles, previews or results. A reviewed full output and an injection classifier similarly do not establish source completeness.

## Open questions and risks

- Do all configured provider adapters expose final serialized messages and continuation options to the proposed dispatch wrapper, especially native searches and CLIProxyAPI headers? The implementation must prove this at the boundary; adapters without it remain private-only for these inputs.
- Which old instruction/page/version rows retain enough authenticated surface evidence to distinguish a direct person submission from an approved private-agent write? Only concrete historical evidence can reduce the conservative legacy fence; updater IDs and empty dependency arrays cannot.
- Do all present folder/member/source-delete mutations have a single reachable service hook for policy-domain locking, including SQL-side cascades? The implementer must inventory this bounded set before relying on concurrent authorization commits; otherwise add the lock at the lowest common mutation boundary.
- Can each existing connector recipient/audience be independently resolved to source-authorized people, and can existing Drive-origin records identify a later app-managed permission change? Unresolvable protected audiences are denied, not guessed. This is a known functionality tradeoff, not a request for parent approval.

## Next implementation step

Build additive version-policy/submission storage and the provider admission fixture first, then route one real personalized `workspace.ask` send through bounded generation and an atomic exact page proposal before migrating the remaining writers and delivery exits.
