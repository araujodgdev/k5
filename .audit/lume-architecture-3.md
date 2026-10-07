```tsx
// Proposed APIs: mount once inside OfficeLayout's existing DocumentDraftsProvider.
import { LumeWorkspace } from "@/components/lume-workspace";
import { loadLumeBootstrap } from "@/lib/application/lume-bootstrap";

const workspace = await requireWorkspace();
const bootstrap = await loadLumeBootstrap(workspaceContext(workspace));

return (
  <LumeWorkspace
    key={`${workspace.user.id}:${workspace.office.officeId}`}
    bootstrap={bootstrap}
  >
    {children}
  </LumeWorkspace>
);
```

```tsx
// Existing case route becomes a canvas resource, retaining server authorization.
import { loadCaseSpace } from "@/lib/application/case-space-service";

const context = workspaceContext(await requireWorkspace());
return <CaseSpace model={await loadCaseSpace(context, id, searchParams)} />;
```

```tsx
// The existing editor gains a resource reference; it does not become a new editor.
const document = { kind: "case-page", caseId, id: pageId } as const;
const lume = useLume();

useCanvasScope({ kind: "document", document });

return (
  <DocumentWorkspace
    resource={document}
    variant="panel"
    onAsk={lume.ask}
  />
);
```

These are proposed interfaces, not existing APIs.

**Problem and grounded execution model**

The application already has the necessary agent execution architecture. The refactor should change presentation and introduce explicitly shared resources while preserving private chat ownership.

The current flow is:

- [OfficeLayout](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/app/(office)/layout.tsx) authenticates, gates terms, and owns document drafts. `/app/agents` actually renders through [`[section]/page.tsx`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/app/(office)/[section]/page.tsx), which bootstraps private conversations, AI consent and modalities.
- [`RuntimeThread`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/agent-chat.tsx:570) supplies `caseId`, document/reference IDs, `openDocumentId` and a consumed selection at submission.
- [`POST /api/chat`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/api/chat/route.ts:26) authorizes sources before admission and constructs the fixed run request. [`chat-run.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-run.ts) owns execution/followers; [`chat-turn.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:102) invokes Mastra, private memory and existing capabilities.
- [`decideAgentApproval`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/agent-approvals.ts:188) executes stored normalized input. Navigation must never rewrite that proposal.
- [`ai-store.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/ai-store.ts:16) scopes conversations and artifacts by both person and office. Artifacts are private; saving one into the Cofre currently creates a PDF/DOCX copy, not a shared editable page.

I inspected the primary prototype source and rendered the self-contained case, sharing and mobile frames. Its floating geometry—10px inset, 16px panel radius, `clamp(360px, 33.333%, 500px)`—is the implementation reference. Its illustrative workflow stages are not evidence of backend capabilities.

**Core shape**

```ts
type DocumentRef =
  | { kind: "artifact"; id: string }
  | { kind: "case-page"; caseId: string; id: string };

type CaseSection =
  | "all" | "pages" | "files" | "tasks" | "honorarios" | "activity";

type CanvasLocation =
  | { kind: "module"; href: string }
  | {
      kind: "case"; caseId: string;
      folderId: string | null; section: CaseSection;
    }
  | { kind: "document"; document: DocumentRef }
  | { kind: "task"; caseId: string | null; id: string }
  | { kind: "honorario"; caseId: string | null; id: string };

type PanelMode = "floating" | "focused" | "collapsed";
type MobileSurface = "chat" | "canvas";

type PromptSnapshot = Readonly<{
  location: CanvasLocation;
  documentIds: readonly string[];
  researchReferenceIds: readonly string[];
  selection?: Readonly<{ document: DocumentRef; excerpt: string }>;
}>;

type PageWrite = {
  expectedVersion: number;
  title: string;
  content: string;
  snapshot: boolean;
};

declare function loadLumeBootstrap(
  context: WorkspaceContext
): Promise<LumeBootstrap>;

declare function loadCaseSpace(
  context: WorkspaceContext, caseId: string, query: CaseQuery
): Promise<CaseSpaceModel>;

declare function readCasePage(
  context: WorkspaceContext, page: Extract<DocumentRef, { kind: "case-page" }>
): Promise<EditorDocument>;

declare function saveCasePage(
  context: WorkspaceContext,
  page: Extract<DocumentRef, { kind: "case-page" }>,
  input: PageWrite
): Promise<EditorDocument>;
```

`CanvasLocation` identifies context; it grants no authority. Server adapters resolve IDs and parse transport data before domain services execute.

The public surface hides URL normalization, permission resolution, editor endpoint differences and request serialization. Callers select a resource or perform one operation; they do not coordinate authorization, tenant switching and persistence separately.

**Module map**

- **New `components/lume-workspace.tsx`:** persistent chat host, launcher, resource tabs, panel modes and mobile surface. Only conversation selection remounts its runtime; canvas navigation and presentation changes do not.
- **New `lib/canvas-navigation.ts`:** canonical resource keys, route mapping and context descriptors. Tabs store descriptors; the active tab renders existing Next.js route children. Avoid an additional client router or keeping every module mounted.
- **Existing `agent-chat.tsx`:** retain runtime, composer, attachments, microphone, approvals and reconnection. Remove its ownership of the document split. Replace `DocumentLinksContext` with shell resource opening/invalidation.
- **New `application/case-space-service.ts`:** authorized case projections, shared-page operations and curated activity. Reuse collaboration access, Vault operations, Agenda task behavior and Honorários services.
- **Existing document workspace/drafts:** add an internal resource adapter for private-artifact versus case-page endpoints. Namespace draft keys by resource kind; retain save serialization, conflict handling, versions and exports.
- **Existing [`navigation.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/navigation.ts):** derive the launcher from current definitions and rollout/admin checks. Include settings, profile, integrations, billing and existing utility actions.
- **Existing [`ui-service.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/ui-service.ts):** resolve case/document access before returning destinations. Its artifact destination currently uses `/app/documents?artifactId=…`; change it to the actual `/app/documents/[id]` route. Wire authorized `k5_ui_open_resource` results into canvas opening; current `resourceHref` does not handle that output.

Preserve Processos, Referências, Anexos, folder controls and current owner-only restrictions through case actions rather than dropping them from the new tabs.

**Context and approval invariants**

Capture a copied `PromptSnapshot` synchronously when sending, keyed to that message. The transport maps it onto the existing [`chat-contract`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-contract.ts), preserving its established fields. Add validated canvas metadata and case-page focus/selection only where existing fields cannot represent them; carry these through `ChatTurn.request`.

Navigation updates the composer’s **next-message** context. Moving from case A to B clears A’s selection and case-bound source overrides. An admitted run keeps A, even if its result arrives while B is visible. Late results invalidate their actual resource; they must not hijack the active tab.

Frozen input does not freeze permissions. Recheck access during execution. Shared-page text is third-party content and must use the existing injection guard rather than being inserted as trusted instructions.

Keep the approval path unchanged in principle: actor, capability, target, version and exact payload determine execution. Editing a proposed outbound message creates a replacement proposal. It cannot mutate an already approved payload.

**Visibility and migrations**

Use additive migrations after the current `0074`; reserve filenames against the live branch.

1. **Shared pages:** add `case_page` and `case_page_version`, with case-owning `office_id`, `case_id`, optional `folder_id`, author, content, version, timestamps and tombstone. Enforce matching case/folder ownership. Add source provenance for generated pages. Keep `ai_artifact`, conversation ownership and memory tables unchanged.
2. **Shared tasks:** add explicit `visibility = personal | case` and optional folder scope to `agenda_activity`; existing rows remain personal. Case visibility requires a case, task kind and matching case office. Shared tasks exclude private CRM links. Add indexes for case/task/folder queries.
3. **Activity:** add a case event ledger for committed resource changes, with actor, source, resource reference and version. Record events atomically with mutations; use unique mutation identities to prevent replay duplicates.
4. **Prototype Lume switch:** add `vault_case.agent_enabled`, default enabled, with owner-only modification. Check it at admission and subsequent case-bound agent operations. It is a policy switch, not an agent membership.
5. **Honorários:** no new financial schema is needed for the case tab.

Specific semantics:

- **Files and pages:** require current case membership plus all ancestor folder permissions. The owner does not gain access to another creator’s private folder. Lists, counts, previews, versions, exports, search, activity and agent tools must agree. For source-derived pages, source restrictions must remain effective; a public destination cannot launder protected source content.
- **Private artifacts:** appear in their owner’s canvas only. Publishing creates a separate page from an explicitly reviewed payload; it never shares the conversation, memory, attachment records or private citation transcript.
- **Tasks:** linking a personal task to a case does not share it. Explicit publication exposes its reviewed task fields. New case tasks are collaborative; assignees must be current authorized participants. Refactor [`agenda-service.ts`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/agenda-service.ts) authorization/reference validation and notification eligibility. Do not add broad `k5_agenda_*` access to the guest whitelist.
- **Delegation:** reuse `task-delegation.ts`, but shared-task access resolves the case office while the resulting conversation and delegation lookup remain in the requesting person’s home office.
- **Honorários:** reuse [`accessibleAgreements`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/honorarios/service.ts:23): linked-case participants consult; only the creator manages. Preserve private pricing and avoid exposing CRM profiles, integrations or unrelated balances.
- **Activity/sharing:** display authorized shared-resource outcomes, never private prompts, pending approvals, memory updates or complete office audit logs. Reuse [`CollaborationPanel`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/collaboration-panel.tsx) in the sharing dialog. Portal publication remains separate, as specified in [`colaboracao.md`](C:/Users/douglas.araujo/Documents/dgstack/k5/docs/colaboracao.md).

**Concurrency, sessions and mobile persistence**

[`DocumentWorkspace`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/document/document-workspace.tsx:168) already preserves edits on 409 and avoids replacing dirty text when Lume changes the document. Reuse this behavior. Case-page saves use version comparison and transactional history; two writers produce one success and one conflict. “Manter a minha” reads the latest authorized version before saving another version. Collaborative live cursors/CRDT are outside this refactor.

Move navigation session refresh from [`AppSidebar`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/components/app-sidebar.tsx:85) into the persistent shell, including meaningful resource-query navigation. Preserve [`assertCapabilityAllowed`](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/context.ts:54), global logout and save-before-exit. Background refresh/reconnection must not extend idle sessions. On 401, clear private client state; revoked resources disappear on failed authorization. Cached content must never become a fallback for 401/403/404.

Desktop defaults to floating; focused and collapsed states preserve the runtime. Mobile defaults to chat on first entry, switches to full canvas on explicit opening and preserves both drafts while switching. Persist only owner-scoped presentation preferences and resource IDs—not document bodies or chat text. Restore IDs through fresh authorization. Use `100dvh`, safe areas, keyboard resizing, inert hidden surfaces and 44px controls.

**Two approaches and selection**

**A — persistent route shell with explicit case resources, recommended.** Existing server routes remain the canvas renderer. Private chat stays mounted; narrowly scoped services add shared pages/tasks. This hides navigation and permission adaptation behind small interfaces while preserving established runtime boundaries.

**B — unified workspace resource engine.** Convert modules, documents and cases into one resource table/API and render all tabs through a client registry. This centralizes resource dispatch but makes callers and adapters coordinate route history, module loading, ACL inheritance and personal/case ownership. It requires a broader migration and replaces working route/editor boundaries.

Choose A. Accept a document adapter and explicit task visibility in exchange for preserving private ownership and existing execution. Borrow B’s canonical resource identity only.

**Independently verifiable implementation sequence**

1. Update design tokens and `DESIGN.md` to the prototype: light default, optional dark, monochrome navigation, peach accent, subtle borders and soft radii.
2. Mount the persistent shell; migrate AI consent/modalities/bootstrap and sidebar utility behaviors. Convert legacy agents links into focused-shell intents. Verify all launcher destinations, history, drafts and panel states.
3. Connect typed canvas context and existing durable transport. Test A→B navigation during execution, next-message B context, reconnect, stop and original-input approvals.
4. Implement shared pages plus the editor adapter. Verify two-person editing, conflicts, restore/export, dirty navigation and protected-folder/source denial.
5. Implement explicit shared tasks and case Honorários projections. Verify assignment, completion, delegation privacy, financial permissions and notification recipients.
6. Implement real case activity, sharing, revocation, portal controls and enforced Lume policy.
7. Complete mobile/theme/accessibility and loading/empty/error states. Run root lint, typecheck, test and build; extend chat/lease/collaboration/auth tests and affected document-saving, approvals, tasks, Honorários and collaboration e2e suites.

The first coding step is the shell extraction with unchanged chat transport.

Material limits: prototype “assistants” and staged plans must derive from actual tool/run events; Gmail’s currently policy-dependent sending requires reconciliation with the prototype’s mandatory outbound confirmation. Do not imply autonomous parallel workers, judicial deadline calculation, comments or live coediting without implementing those capabilities.

No files were changed. Verification here consisted of source tracing and prototype inspection; application tests were not run.
