I've read the code and the prototype, but I haven't changed any files or run any checks. The package below assumes the conversation panel lives in the office layout and the URL decides what the canvas shows. Each step can be verified separately.

# Design package: Lume panel + canvas + case spaces

## Problem and constraints

Most of the backend already does what's needed:
- **Context freezing works today.** `api/chat/route.ts` validates `caseId`/`documentIds`/`openDocumentId`/`selection`, then calls `startChatRun` with a frozen `ChatTurn.request`.
- **Approvals are bound to the original input.** `requireAndConsumeApproval` compares the canonical input, and `decideAgentApproval` runs the stored input.
- **Mid-turn revocation is checked.** `assertCapabilityAllowed` re-reads the session and the case before each privileged step.
- **Conversations are private.** `ai_conversation` is scoped by `office_id+user_id`.

What actually blocks the experience:
1. **The chat is a page, not a shell.** `AgentChat` renders from `[section]/page.tsx` (there's no `agents/page.tsx`) and puts documents in a `?doc=` split. Leaving the page stops it (an unmount effect calls `stop()`).
2. **Pages can't be shared.** Every artifact read goes through `ownedArtifact(owner)`, about 15 call sites.
3. **Tasks are office-only.** `agenda_activity` checks the case against the creator's office (`validateReferences`), so participants can't share tasks.
4. **No case activity read model exists.**
5. **Broken agent "open" paths in `ui-service.openResource`.** It checks `office_id` only, so shared cases fail. It also points artifacts to `/app/documents?artifactId=` and runs to `/app/documents?runId=`, and neither route exists (only `documents/[id]`).
6. **Stale transport risk.** The chat transport is memoized on `context`, so the scope can be stale if `useChat` keeps its first transport.

## Usage (caller's view)

```tsx
// app/app/(office)/layout.tsx  (AppSidebar removed; layout stays cheap: router.refresh() re-runs it)
<LumeShell user={{ id: user.id, name: user.name, avatarUrl }} aiNoticeAccepted={aiNotice}
  flags={{ whatsappEnabled, adsEnabled, platformAdmin }} invitationCount={invitationCount}>
  <WebMCPProvider whatsappEnabled={whatsappEnabled}>{children}</WebMCPProvider>
</LumeShell>
```

```tsx
// vault/cases/[id]/page.tsx
const space = await caseSpace(context, id);              // CapabilityError NOT_FOUND → notFound()
return <>
  <CanvasResource resource={{ kind: 'case', caseId: id, title: space.case.name }} />
  <CaseSpace space={space} section={section} folderId={folderId} items={await caseItems(context, id, { section, folderId })} />
</>;

// documents/[id]/page.tsx
const access = await artifactAccess(context, id);
return <>
  <CanvasResource resource={{ kind: 'page', artifactId: id, title: access.row.title, caseId: access.caseId }} />
  <DocumentWorkspace artifactId={id} variant="page" />   {/* onAsk/revision come from useLume() */}
</>;
```

```ts
// agent-chat.tsx RuntimeThread: the transport becomes stable; scope is read once, at send
prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({ body: {
  conversationId, ...lume.scopeForNextMessage(), researchReferenceIds, attachmentIds,
  message: messages.findLast(m => m.role === 'user'), trigger, messageId, timeZone, ...takeSelection() } })
```

```ts
// any server artifact path (replaces ownedArtifact everywhere)
const access = await artifactAccess(context, artifactId);
const saved = await updateArtifact(database, access, { title, content, version, editorId: context.userId });
if (!saved) throw new ApiError(409, `${saved === null ? 'Outra pessoa' : ''} salvou uma versão mais nova.`);
```

## Shape

### Client shell (`src/components/lume-shell/`, only `index.ts` importable; enforce with `no-restricted-imports`)

```ts
export type CanvasResource =
  | { kind: 'office' } | { kind: 'module'; slug: NavSlug }
  | { kind: 'case'; caseId: string; title: string }
  | { kind: 'page'; artifactId: string; title: string; caseId: string | null }
  | { kind: 'file'; documentId: string; title: string; caseId: string | null };
export type ChatScope = { caseId?: string; openDocumentId?: string; documentIds: string[]; label: string };
export type PanelMode = 'floating' | 'focus' | 'collapsed';
export type MobileView = 'chat' | 'canvas';
export type CanvasTab = { href: string; title: string; kind: CanvasResource['kind'] };
export type ShellState = { mode: PanelMode; tabs: CanvasTab[]; mobileView: MobileView; scopeDismissedHref: string | null };

// shell-state.ts: pure, unit-tested
export function shellReducer(s: ShellState, a:
  | { type: 'navigated'; href: string; resource: CanvasResource } | { type: 'closeTab' | 'pruneTab'; href: string }
  | { type: 'setMode'; mode: PanelMode } | { type: 'showMobile'; view: MobileView } | { type: 'dismissScope' }): ShellState;
export function chatScopeFor(r: CanvasResource, dismissed: boolean): ChatScope;  // case→{caseId}; page→{openDocumentId,caseId}; file→{caseId,documentIds:[id]}
export function restoreShell(raw: string | null, userId: string): ShellState;   // wrong user/version → defaults
export function serializeShell(s: ShellState, userId: string): string;

// use-lume.ts
export type LumeApi = {
  scopeForNextMessage(): ChatScope;                // canvas scope; explicit sources picked in the panel are added on top
  ask(r: { text: string; selection?: { artifactId: string; excerpt: string } }): void;
  open(href: string, o?: { background?: boolean }): void;     // mobile: switches to canvas
  artifactRevision(id: string): number; notifyArtifactChanged(id: string): void;
  activeRun: { scope: ChatScope; label: string } | null;     // from the last user message's stored scope
};
```

- **Panel.** `LumeShell` renders the existing `AgentChat` with no `initialData`; it already loads through `/api/conversations`.
- **Canvas.** `children` is the canvas: the tab strip, the launcher (derived from `appNavigation` plus `listCases`, so there's no second list), search, notifications, the theme switch and the avatar.
- **Tabs.** A tab is a visited URL; clicking it calls `router.push`.
- **`/app/agents`** renders a `FocusChat` marker that sets mode `focus` and passes `conversationId` deep links through.
- **AI notice.** `AiDataNotice` moves into the panel and replaces the composer until accepted.
- **Removed:** the `?doc=` split and `mobileTabs`.

### Server

```ts
// src/lib/artifact-access.ts
export type ArtifactAccess = { row: ArtifactRow; role: 'creator' | 'case_member'; caseId: string | null; caseOfficeId: string | null };
export async function artifactAccess(c: WorkspaceContext, id: string): Promise<ArtifactAccess>;
//  creator (office_id,user_id) | case_id set ∧ caseAccess ∧ vault_folder_visible(folder_id,user) ∧ agentAllowed(c, case)
export function artifactView(a: ArtifactAccess): PublicArtifact;   // conversationId only for creator
export async function placeArtifact(c: WorkspaceContext, id: string, to: { caseId: string; folderId: string | null } | null): Promise<ArtifactAccess>; // creator only; folder.case_id must match

// src/lib/case-space.ts
export type CaseSection = 'all' | 'pages' | 'files' | 'tasks' | 'fees' | 'activity';
export async function caseSpace(c, caseId): Promise<{ case: VaultCase; access: CaseAccess; people: Person[]; agentAccess: boolean }>;
export async function caseItems(c, caseId, q: { section: 'all' | 'pages' | 'files'; folderId: string | null; cursor?: string }): Promise<{ items: CaseItem[]; next: string | null }>;
export async function caseTasks(c, caseId): Promise<AgendaActivity[]>;    // own (any visibility) + others' shared_with_case
export async function caseActivity(c, caseId, before?: string): Promise<{ entries: CaseActivityEntry[]; next: string | null }>;
export type CaseActivityEntry = { id: string; at: string; actor: { kind: 'person' | 'lume'; name: string };
  action: 'file.added' | 'page.created' | 'page.updated' | 'participant.added' | 'participant.removed' | 'task.shared' | 'task.completed'; subject: string; href?: string };
```

**Activity.** It's computed at read time as a union with no new table, following the `listOfficeAudit` pattern:
- `vault_document`, filtered by `vault_folder_visible`, with `vault_agent_origin` marking work the Lume did
- case `ai_artifact` rows, filtered by folder visibility, with `created_by_agent`
- `collaboration_audit` rows for the case
- shared tasks only

**Fees.** `listHonorarios(homeContext, { caseId })` is unchanged; its `authorize` refuses a case-scoped context, so it must be called with the home context.

### Chat changes

- **Scope stored on the message.** `api/chat/route.ts` writes `input.metadata = { scope }` built from the validated body, with a server-resolved label. The bubble shows it as a context chip.
- **Regenerate uses the stored scope.** On `trigger === 'regenerate-message'` the route ignores the scope in the request and re-authorizes the stored one, so a revoked case is refused.
- **Running steps are real.** `chat-turn.ts` emits `data-tool {state:'running'}` on `tool-call`, then replaces it by the same id on the result.
- **"Plano do Lume"** means the real steps grouped by `places`, plus pending approvals. There are no queued tasks or sub-agents, and `MAX_STEPS=8` still applies.
- **Open page access.** The `ownedArtifact` read of the open page in `chat-turn.ts` becomes `artifactAccess`.
- **Private-folder reads before shared writes.** `WorkspaceContext.restrictedReads?: Set<string>` records non-public folder ids read during the turn. A case-page write whose folder isn't inside each of those folders throws `requireAgentApproval`, so the person must press Confirmar.

**Agent "open" and "Editar".**
- When `k5_ui_open_resource` returns an `href`, it opens a tab. The tab comes to the front only if the person hasn't navigated since sending.
- "Editar" on an approval card rejects the proposal and opens the module's own composer in the canvas with the text filled in. That send is a human action, so the approval is never mutated.

## Schema: `db/postgres/0075_case_spaces.sql` (next free number)

```sql
ALTER TABLE vault_case ADD COLUMN agent_access BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE ai_artifact ADD COLUMN case_office_id TEXT, ADD COLUMN case_id TEXT,
  ADD COLUMN folder_id TEXT REFERENCES vault_folder(id) ON DELETE SET NULL,
  ADD COLUMN updated_by TEXT REFERENCES "user"(id),
  ADD CONSTRAINT ai_artifact_case_pair CHECK ((case_id IS NULL) = (case_office_id IS NULL)),
  ADD CONSTRAINT ai_artifact_folder_case CHECK (folder_id IS NULL OR case_id IS NOT NULL),
  ADD CONSTRAINT ai_artifact_case_fk FOREIGN KEY (case_office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE SET NULL;
CREATE INDEX ai_artifact_case_idx ON ai_artifact(case_office_id, case_id, updated_at DESC) WHERE case_id IS NOT NULL;

ALTER TABLE agenda_activity ADD COLUMN case_office_id TEXT, ADD COLUMN shared_with_case BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE agenda_activity SET case_office_id = office_id WHERE case_id IS NOT NULL;  -- validateReferences only allowed own-office cases
-- DO block: drop the single-column case_id FK (look up its name in pg_constraint), then:
ALTER TABLE agenda_activity ADD CONSTRAINT agenda_activity_case_pair CHECK ((case_id IS NULL) = (case_office_id IS NULL)),
  ADD CONSTRAINT agenda_activity_case_fk FOREIGN KEY (case_office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE SET NULL;
CREATE INDEX agenda_activity_shared_case ON agenda_activity(case_office_id, case_id) WHERE shared_with_case;
```

`vault_case_office_identity` already provides the composite key. Apply it locally with `pnpm db:setup`; production gets it through CI.

## Visibility semantics

| Content | Who sees it |
| --- | --- |
| Conversations, memory, approvals, the "Lume is working" strip | Only the requester. The strip comes from the panel's own run; there's no presence. |
| Case pages | Creator, plus case members who pass `vault_folder_visible` for the page folder. Root = everyone in the case. Members can edit. Portal publishing stays creator-only. |
| Files | Unchanged folder rules. |
| Tasks/meetings | Your own always. Others' only when `shared_with_case`, read-only; the creator edits. Tasks made in the case space default to shared. Existing rows stay private. Reminders go to the creator. |
| Honorários | Existing rule: creator manages; participants of the linked case read values; `pricing` only when `canManage`. Not in activity. |
| Activity | Events from the rows above, each filtered by its rule. Never conversation content. |
| `agent_access=false` | `assertCapabilityAllowed`, in its `caseScope` branch with `invocation` set, refuses participants' Lume. Toggling is an owner-only new `collaborationAction` `{action:'agentAccess'}`. It's audited, and the agent can only change it after Confirmar. |

## Concurrent page edits

- **Optimistic versioning stays.** `updateArtifact` keeps `WHERE version=?` and drops the owner predicate once access is checked.
- **Who saved is recorded.** It writes `updated_by`; `ai_artifact_version.user_id` already records the editor.
- **409 handling already exists.** `DocumentWorkspace` keeps the local text and lets the person choose a version. Add the other editor's name to the message.
- **Remote changes.** While a page is visible and has no local edits, it checks the version on focus and every 30 s, then reloads with the existing change highlight. With local edits, the conflict surfaces at save.
- **Agent edits.** A participant's Lume editing someone else's page always needs approval, because it didn't create the page in that conversation.
- **No real-time co-editing or CRDT.**

## Login refresh and revocation

- **Session refresh** moves from `AppSidebar` into the shell: `authClient.getSession()` on each pathname change and when the tab becomes visible. No timer, so idle expiry still works.
- **401 anywhere** (chat, stream, a tab) clears the user-keyed local state and calls `router.replace('/sign-in')`.
- **Logout** clears local state, and a `BroadcastChannel('k5-session')` tells the browser's other tabs.
- **Case revocation:** the tab gets `NOT_FOUND`, shows "Caso não encontrado ou acesso removido." and is pruned. A running turn fails at its next `caseAccess`; regenerate is refused.

## Mobile

- The default view is chat. A tap on "Abrir" or `lume.open` switches to the canvas; the header's back arrow returns to chat.
- Both views stay mounted, the hidden one with `inert`/`hidden`, so the stream and the draft survive switching.
- Mobile view lives in `sessionStorage`. Mode, tabs and conversation id live in `localStorage` under `lume.shell.v1:<userId>`.
- iOS page kills recover through the existing `resume: true` and `/api/chat/[id]/stream`.

## Approaches

**A. Panel in the layout, URL is the canvas (chosen).** The App Router keeps `(office)/layout.tsx` mounted, so the panel never unmounts. Every existing page becomes canvas content unchanged. Deep links, the back button and server rendering keep working, and authorization stays in each page. Tab switches unmount pages, which is acceptable because `DocumentDraftsProvider` already sits in the layout and preserves drafts.

**B. One client canvas with a resource registry.** A single `/app/space` would keep resources alive in client state and fetch everything through APIs. Tabs would keep scroll and editor state, but every module page would have to be rewritten as API-driven client code. Deep links and the back button would break, and authorization reads would be duplicated. It would also put a large registry inside the shell that every page depends on. Rejected for scope and leakage.

A third option, Next parallel routes (an `@panel` slot), adds nothing over a persistent layout.

## Build sequence (one commit per step, one PR)

1. **Access core.** Migration 0075, `artifactAccess` at every `ownedArtifact` site, `updateArtifact(access)`, the `ui-service` path and access fixes, `agent_access` with its action.
   - Tests in `collaboration.test.ts` and `ai-store.test.ts`: a participant reads a root page; a page in a private folder is hidden; a revoked member gets 404; a participant's Lume is denied when `agent_access` is off; `conversationId` is hidden; two users saving give a 409.
2. **Case tasks and activity.** `validateReferences` uses `caseAccess`; add `shared_with_case`, `caseTasks` and `caseActivity`.
   - Tests in a new `case-space.test.ts`: others' private tasks never appear; private-folder files are absent from activity; a participant sees fees and a stranger doesn't.
3. **Chat.** Stored scope, regenerate reuse, running steps, the `restrictedReads` gate, `artifactAccess` for the open page.
   - Tests in `chat-route.test.ts`: regenerate ignores a different request scope; revoked case refused; private read then shared write needs approval.
4. **Visual tokens.** Light default (`defaultTheme="light"`; stored preferences remain), radius, soft `line`, monochrome navigation, peach `brand`. Rewrite `DESIGN.md`.
5. **Shell.** `LumeShell`, modes, tabs, launcher, scope chip, mobile switch, persistence, session handling; remove `AppSidebar` and `?doc=`.
   - New `e2e/lume-shell.e2e.ts`: navigating during a run changes the chip but the strip stays on the original case; collapse and expand; reload keeps tabs; mobile defaults to chat and "Abrir" switches; keyboard on tabs and launcher.
   - Update `app-shell`, `workspace` and `agent-approvals` e2e tests.
6. **Case space.** Sections; share dialog with the toggle and portal summary; "Nova página". This needs a human create path: `POST /api/cases/[id]/pages`, because `k5_artifacts_create` is agent-only. Add a `caseId` input to the agent tool.
   - Update `collaboration.e2e.ts`; new `case-space.e2e.ts`; verify with the `verify-lume` skill on desktop and mobile, light and dark.
7. **Docs.** `README.md` routes, `docs/colaboracao.md` table, `apps/web/README.md`.

## Risks and scope

- **Large change.** Seven commits touching the shell, about 15 artifact call sites, the agenda and every screen's tokens. The `DESIGN.md` rewrite also invalidates old visual rules.
- **Leak through page content.** If the model quotes private material without citing it, `restrictedReads` misses it. The approval gate only covers reads it records.
- **Useful tab state is lost.** Switching tabs unmounts the page, so scroll position and open dialogs go.
- **Keep the layout cheap.** It must not bootstrap messages on every `router.refresh()`.

## Decisions for you

- On mobile, should deep links (notifications) open the canvas instead of the default chat?
- Should `agent_access=false` also block the case owner's own Lume, or only participants'?
- Should participants keep seeing fee values (the current documented rule) inside the case space?
- Should "O que o Lume fez hoje" on Início use only sources that record agent origin, or be dropped?

**First step:** write `0075_case_spaces.sql` and `artifactAccess`, plus the collaboration tests that fail without them.
