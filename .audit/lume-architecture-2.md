```tsx
// Proposed interfaces, not existing APIs.

// Office layout: the conversation survives canvas navigation.
<LumeShell identity={{ userId, officeId }} bootstrap={chatBootstrap}>
  {children}
</LumeShell>

// Case/file links and launcher items use one navigation interface.
const canvas = useCanvas();
await canvas.open({ kind: "case", id: caseId });
await canvas.open({ kind: "page", id: page.artifactId });

// The existing editor sends saved selections into the persistent conversation.
<DocumentWorkspace
  document={{ kind: "page", id: page.artifactId }}
  variant="panel"
  onAsk={lume.ask}
/>
```

These call sites define the recommended design: keep Next.js routes as the canvas, mount one private conversation above them, and publish shared pages through an explicit copy operation.

The current `/app/agents` implementation lives in [[section]/page.tsx](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/app/(office)/[section]/page.tsx:27). It mounts `AgentChat` with a conversation/case key. That ownership must move into the persistent shell; navigation must no longer replace the chat instance.

[AgentChat](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/agent-chat.tsx:592) already captures case, selected files, references, open document and selection when submitting. [ChatTurn](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:44) carries that request into [startChatRun](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-run.ts:113). Preserve this pipeline, Mastra, conversation leases, reconnect behavior and approvals.

Two structurally distinct approaches were considered:

- **Route-backed canvas with persistent shell, recommended.** Existing server pages keep loading and authorizing resources. A small controller handles tabs, navigation and next-message context. It hides URL mapping and document-save coordination behind `open()` and `close()`.
- **Single client workspace with a module-rendering registry.** Every module becomes a panel under one route. This could retain every mounted screen, but requires replacing server-page composition, duplicating resource loading and migrating many existing navigation flows. Its callers must understand more loading and authorization states.

Accept remounting canvas screens in exchange for retaining server routing. Preserve editor drafts through the existing draft provider; persist tab descriptors instead of retaining every module component.

```ts
type CanvasResource =
  | { kind: "module"; slug: NavSlug }
  | { kind: "case" | "file" | "page" | "artifact"; id: string };

type PanelMode = "floating" | "focused" | "collapsed";
type MobilePane = "chat" | "canvas";
type DocumentTarget = { kind: "artifact" | "page"; id: string };

type NextMessageContext = {
  caseId: string | null;
  documentIds: readonly string[];
  researchReferenceIds: readonly string[];
  openDocumentId: string | null;
  selection: { artifactId: string; excerpt: string } | null;
  module: NavSlug | null;
};

interface CanvasController {
  open(resource: CanvasResource): Promise<void>;
  close(resource: CanvasResource): Promise<boolean>;
  snapshotForSend(): NextMessageContext;
}

type EditableDocument = {
  id: string;
  title: string;
  content: string;
  version: number;
  visibility: "private" | "case";
};

type CasePage = {
  artifactId: string;
  caseId: string;
  folderId: string | null;
  title: string;
  version: number;
};

// Proposed server interfaces. Context always comes from the session.
loadEditableDocument(
  context: WorkspaceContext, target: DocumentTarget
): Promise<EditableDocument>;

saveEditableDocument(
  context: WorkspaceContext,
  target: DocumentTarget,
  input: {
    title: string; content: string;
    expectedVersion: number; snapshot: boolean;
  }
): Promise<EditableDocument>;

publishCasePage(
  context: WorkspaceContext,
  input: {
    artifactId: string; version: number; caseId: string;
    folderId: string | null; idempotencyKey: string;
  }
): Promise<CasePage>;
```

`CanvasController` owns presentation and navigation. It grants no access. Server loaders resolve IDs into authorized resources before registering their case/document context. While a destination loads, disable contextual submission instead of sending with the previous screen’s context.

The module map is:

- New `components/lume/lume-shell.tsx` and `canvas-provider.tsx` own panel mode, tab order, launcher, mobile pane and validated canvas context.
- Refactor `components/agent-chat.tsx` into the persistent conversation UI. Move its embedded document panel into the canvas; retain transport, attachments, voice, history, tool steps and approval decisions.
- New `lib/canvas.ts` owns resource keys and canonical URLs. Derive module entries from `lib/navigation.ts`, retaining feature flags and administration access.
- Extend `vault-case-view.tsx` into the case space. Keep files, folders, processes, references and annexes; add pages, tasks, honorários and activity. Sharing uses `collaboration-panel.tsx`.
- New `application/case-pages-service.ts` owns page publication and access. Shared pages reuse artifact content/version storage through an authorized document interface.
- Extend `application/agenda-service.ts` for explicitly shared case tasks. Extend existing mutation services to append case activity events.

[Lume’s office layout](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/app/(office)/layout.tsx) already contains onboarding, legal gates, draft preservation and WebMCP. Keep those responsibilities. Move `/app/calc` and `/app/honorarios/propostas`, currently outside this group, into it without changing their URLs. `/app/agents` becomes a compatibility entry that selects the private conversation and focuses the panel. `/app/command-center` remains the real overview canvas.

The supplied prototype replaces the old square, colorful design rules. Use its semantic palette: canvas `#FDFDFB`, panel `#FAFAF8`, ink `#1C1B19`, peach `#E08A6B`, subtle borders and a restrained floating shadow. The desktop panel uses the prototype’s `clamp(360px, 33.333%, 500px)` width, 10px inset and 16px radius. Focused mode centers the conversation; collapsed mode retains an accessible Lume control and real pending status. Update `DESIGN.md`, shared tokens, primitives and old module hover styles together. Set light as the default while retaining saved theme preferences.

On mobile, default to full chat and switch to full canvas through explicit controls. Keep the conversation mounted in both states. Use dynamic viewport height, safe-area padding, 44px targets, scrollable resource tabs and a document-to-case back path. Store selected conversation, tabs, panel mode and mobile pane per user/office; a fresh session defaults to chat. Store no transcript in that presentation record. Revalidate restored resources before displaying their titles.

The authorization semantics must remain explicit:

- **Files and pages:** case participation plus the complete ancestor-folder policy. Apply it to lists, counts, search, preview, exports, history, citations and agent reads.
- **Private content:** conversations, attachments, memory, research history, Google connections and original drafts remain personal. Publishing copies one reviewed document version, never its conversation or memory. Use a separate shared DTO without private provenance IDs.
- **Tasks:** existing agenda records remain personal. New case tasks are deliberately shared and optionally folder-bound. Owner and participants can collaborate when the folder permits it. Assignees must be current case members; shared tasks expose no private CRM records, Google events or delegation conversations.
- **Honorários:** preserve the existing policy in [honorarios/service.ts](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/honorarios/service.ts:20). Case participants already read linked agreements; only their creator manages them. Pricing is hidden from other viewers. Agreements without a case stay personal. Call this service with the viewer’s home-office context and a case filter, since it rejects guest `caseScope`.
- **Activity:** show committed resource changes, filtered by current resource access. Omit inaccessible events entirely, including names and counts. Private prompts, approvals and execution traces never become shared activity.
- **Sharing:** retain owner-managed participants and existing association rules. The client portal continues to require explicit publication.

Reuse [caseAccess/documentAccess](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/collaboration/access.ts:11). Extend `scopeCapability` only for operations bounded to one case. Never grant general agenda, CRM, finance or private-artifact access through participation.

Add the next migration after `0074`; do not modify applied migrations:

1. Add `ai_artifact.scope`, defaulting to `private`. Create `case_page` metadata containing artifact ID, case office, case ID, folder ID and publication identity. Publication creates a new `scope=case` artifact with no conversation/run linkage. Existing artifacts remain private.
2. Add `agenda_activity.scope`, defaulting to `personal`, and optional folder ID. Require a case for shared scope, initially restrict it to tasks, and reject private client references. Validate case-office/folder consistency and assignees transactionally.
3. Add `case_activity_event` with resource identity, actor, version, timestamp and a unique mutation/event key. Insert events with successful mutations.
4. Persist the prototype’s Lume permission switch on `vault_case`, defaulting to enabled. Only the owner changes it. Enforce it during agent source loading and every subsequent case action; it grants no additional permission.

Shared pages reuse `ai_artifact_version` and the existing editor. Keep `ownedArtifact()` private-only. Add authorized page resolution and version writes that record the acting author instead of filtering every shared version by the creator.

[DocumentWorkspace](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/document/document-workspace.tsx:66) already serializes saves, detects version conflicts and preserves unsaved text during Lume revisions. Adapt its persistence, versions, format, review and export calls to `DocumentTarget`. Retain compare-and-swap writes and explicit conflict resolution; concurrent participants do not receive automatic merge or live cursors. Publication must validate source permissions and reject disclosure from reserved sources into a broader destination without authorization from their creator.

Navigation updates context for the **next** message. Submission copies the snapshot and consumes its selection once. Map it to the existing chat fields; add only a validated module hint for module context. Display the active execution’s original target separately from the next-message target. Returning results opens or invalidates resource tabs without redirecting an unrelated document the user is editing.

[decideAgentApproval](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/agent-approvals.ts:188) already executes stored normalized input. Preserve that behavior. Editing a proposed message creates a replacement proposal; confirmation must never read the current composer, canvas or selection.

Update [openResource](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/ui-service.ts:7): its document lookup lacks folder checks, and artifact destinations use older query URLs. Resolve authorized resources and return canonical paths, including `/app/documents/[id]`.

Move navigation-triggered session renewal out of `AppSidebar` into the shell. Preserve idle expiry and global logout. Continue [assertCapabilityAllowed](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/context.ts:50) before privileged steps. On authentication/access failures, clear affected client caches and stop displaying restricted resources; transient network failure must preserve drafts. Existing cached-message fallback must not run after a 401/403/404.

Implement and verify in these independently reviewable units:

1. **Shell and design:** launcher reaches every existing module; desktop states and mobile switching preserve conversation/draft state. Verify keyboard focus, light/dark themes and reduced motion.
2. **Context bridge:** start a real turn in case A, navigate to B, confirm an A approval, then send in B. Assert original execution/approval targets remain A.
3. **Shared pages:** create, publish, edit, restore and export. Verify two-user version conflicts, private-original isolation and nested-folder denial.
4. **Case tasks and finance:** verify shared assignment/completion, private-task exclusion, participant revocation and existing creator-only financial writes.
5. **Activity and sharing:** verify transactional events, retry deduplication, filtered totals, participant removal and independently published portal files.
6. **Real agent integration:** publish contracts in `capabilities/contracts.ts` and executors in `agent-tools/index.ts`. Derive status from actual tool events and job records.
7. **Regression checks:** run lint, typecheck, tests and configured build. Extend `agent-approvals`, `collaboration`, `document-saving` and `honorarios` e2e coverage; add a desktop/mobile canvas journey with reload, Back and revocation.

The substantive backend scope is shared editable pages, case-task authorization, activity events and enforced case AI policy. The prototype’s timed plan and writing animation provide visual examples only. Existing runs survive browser disconnection; the Node/Cloudflare implementations do not establish guaranteed recovery across process/object restarts.

Read-only inspection completed. No files changed; application checks were not run.
